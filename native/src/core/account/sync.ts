// geschrieben nach: Plan „Account + Sync“ (Abschnitte 6.5, 6.6, 8 Rollback-Schutz, 10.2) und dem Server-Vertrag account-server/src/routes.ts (sync/meta, sync/snapshot mit If-Match und X-Dek-Id, account/keys/device)

import type { RestoreMode } from "../backup/backup"
import { AccountApiError, type AccountClient, ConflictError, RateLimitedError, UnauthorizedError } from "./client"
import { AccountCryptoError, UntrustedKeyChangeError } from "./crypto"
import { pickUpDeviceKey } from "./devices"
import { type Gzip, type PackageEnvironment, type SyncPackage, applyPackage, makePackage, openPackage, packageHash, sealPackage } from "./package"
import type { AccountSession, AccountState } from "./session"
import type { Sodium } from "./sodium"

/*
 * The sync: every 5 minutes while the app is in front, at start, when the user leaves it and on "Sync now"; there is no
 * background job. A package is uploaded only when its plaintext hash changed. The upload names the version it builds on
 * (If-Match); when another device was faster (409) this device downloads, decrypts, merges and uploads again.
 * - A device that signed in to an account with data never uploads first: it reports "import-available" until the user
 *   imports (a local backup is made before) — so a fresh install can never overwrite the account.
 * - Rollback: the device remembers the highest version it saw and refuses an older one; the package's AAD binds it to
 *   account, version and DEK, so the server can neither swap packages nor pass an old one off as new.
 * - A newer package while this device changed nothing replaces the local state; with changes on both sides they merge
 *   (restoreBackup "merge", watch positions by time, package.ts).
 * - Another device rotated the DEK: this device fetches the new DEK sealed to its own key (account/keys/device) and
 *   syncs on, but only when its current DEK vouches for the new one (chain MAC, devices.ts pickUpDeviceKey). Otherwise
 *   "key-untrusted": start fresh ran elsewhere, or someone without the key (a taken-over Google account, a changed
 *   server) tried to switch the account to a key of its own. The device then neither imports nor uploads.
 *   "key-changed" when the server has no newer key for it (it was removed).
 * - The server asks for a rotation (a device was removed): the sync tries it, and when it can't run here (the password
 *   is needed, the sign-in is too old, an unverified device is in the list) it syncs on and keeps the flag (M-4).
 */

export const SYNC_INTERVAL_MS = 5 * 60 * 1000
const MAX_UPLOAD_ATTEMPTS = 3

export type SyncTrigger = "interval" | "start" | "leave" | "manual"

export type SyncOutcome =
    | { state: "signed-out" }
    /** Signed in, but the DEK is not on this device yet (approval or recovery code) */
    | { state: "needs-key" }
    | { state: "skipped" }
    | { state: "import-available", version: number }
    | { state: "up-to-date", version: number }
    | { state: "uploaded", version: number }
    /** The account's newer package replaced the unchanged local state */
    | { state: "updated", version: number }
    | { state: "merged", version: number }
    /** The account uses a key this device cannot get (the device was removed) */
    | { state: "key-changed" }
    /** The account switched to a key this device's key does not vouch for (start fresh elsewhere, or an attack): sync stops */
    | { state: "key-untrusted" }
    | { state: "rollback-rejected", version: number, highest: number }
    | { state: "rate-limited", retryAfter: number | null }

/** The server's flags with every result; `recoveryRenewalNeeded`: "recovery code needs renewal" (a rotation dropped it) */
export type SyncFlags = { rotationRequired: boolean, rewrapNeeded: boolean, recoveryRenewalNeeded: boolean }
export type SyncResult = SyncOutcome & SyncFlags
const NO_FLAGS: SyncFlags = { rotationRequired: false, rewrapNeeded: false, recoveryRenewalNeeded: false }

/** This device's data, as a package and back (package.ts does the work; the app adds its preferences and safety backup) */
export interface LocalData {
    make(): Promise<SyncPackage>
    apply(pkg: SyncPackage, mode: RestoreMode): Promise<void>
    /** A local backup before an import replaces the device's state */
    safetyBackup(): Promise<void>
}

/** LocalData of the core plus the app's own preference store */
export function coreLocalData(environment: PackageEnvironment, app: {
    appVersion: string
    preferences: () => Record<string, string>
    /** lib/app-backup-keys.ts isDeviceKey */
    isDeviceKey: (key: string) => boolean
    writePreferences: (preferences: Record<string, string>) => void
    safetyBackup: () => Promise<void>
}): LocalData {
    return {
        make: () => makePackage(environment, { appVersion: app.appVersion, preferences: app.preferences(), isDeviceKey: app.isDeviceKey }),
        apply: async (pkg, mode) => {
            const { preferences } = await applyPackage(environment, pkg, mode, { preferences: app.preferences(), isDeviceKey: app.isDeviceKey })
            app.writePreferences(preferences)
        },
        safetyBackup: app.safetyBackup,
    }
}

export type SyncApi = Pick<AccountClient, "syncMeta" | "snapshot" | "putSnapshot" | "deviceKey">

class KeyChanged extends Error {}
class Rollback extends Error {
    constructor(readonly version: number, readonly highest: number) {
        super("rollback")
    }
}

type Unlocked = AccountState & { dek: Uint8Array, dekId: string }

export class SyncEngine {
    private queue: Promise<unknown> = Promise.resolve()
    private backoffUntil = 0

    constructor(private readonly deps: {
        api: SyncApi
        session: AccountSession
        sodium: Sodium
        gzip: Gzip
        local: LocalData
        now: () => number
        /** Rotates the DEK when the server asks for it (devices.ts rotate); false or ReauthRequiredError: not now */
        rotate?: () => Promise<boolean>
    }) {}

    /** Whether a trigger should run now: the 5-minute tick only after 5 minutes, the others always */
    isDue(trigger: SyncTrigger, state: Pick<AccountState, "lastSyncAt">): boolean {
        if (trigger !== "manual" && this.deps.now() < this.backoffUntil) return false
        if (trigger !== "interval") return true
        return state.lastSyncAt === null || this.deps.now() - state.lastSyncAt >= SYNC_INTERVAL_MS
    }

    sync(trigger: SyncTrigger): Promise<SyncResult> {
        return this.serial(() => this.withKeyPickup(() => this.run(trigger)))
    }

    /** On "key-changed" the new DEK sealed to this device is fetched once and the work runs again */
    private async withKeyPickup(work: () => Promise<SyncResult>): Promise<SyncResult> {
        const first = await work()
        if (first.state !== "key-changed") return first
        const flags: SyncFlags = { rotationRequired: first.rotationRequired, rewrapNeeded: first.rewrapNeeded, recoveryRenewalNeeded: first.recoveryRenewalNeeded }
        try {
            if (!(await pickUpDeviceKey({ api: this.deps.api, session: this.deps.session, sodium: this.deps.sodium }))) return first
        }
        catch (error) {
            if (error instanceof UntrustedKeyChangeError) return { state: "key-untrusted", ...flags }
            // no key for this device on the server
            if (error instanceof AccountApiError || error instanceof AccountCryptoError) return first
            throw error
        }
        return work()
    }

    /** The user tapped "Import": local backup first, then the account's package replaces the device's state */
    importFromAccount(): Promise<SyncResult> {
        return this.serial(() => this.withKeyPickup(() => this.guard(async (state, flags) => {
            const meta = await this.deps.api.syncMeta()
            this.check(state, meta)
            if (meta.version === 0) {
                await this.deps.session.updateSync({ imported: true })
                return { state: "up-to-date", version: 0, ...flags }
            }
            await this.deps.local.safetyBackup()
            const remote = await this.download(state)
            await this.deps.local.apply(remote.pkg, "replace")
            const hash = packageHash(this.deps.sodium, await this.deps.local.make())
            await this.deps.session.updateSync({ imported: true, highestVersion: remote.version, lastHash: hash, lastSyncAt: this.deps.now() })
            return { state: "updated", version: remote.version, ...flags }
        })))
    }

    private serial<T>(work: () => Promise<T>): Promise<T> {
        const next = this.queue.then(work, work)
        this.queue = next.catch(() => undefined)
        return next
    }

    /** Loads the account, maps the server's answers that end a sync to their state */
    private async guard(work: (state: Unlocked, flags: SyncFlags) => Promise<SyncResult>, flags: SyncFlags = NO_FLAGS): Promise<SyncResult> {
        const state = await this.deps.session.load()
        if (!state) return { state: "signed-out", ...flags }
        if (!state.dek || !state.dekId) return { state: "needs-key", ...flags }
        try {
            return await work(state as Unlocked, flags)
        }
        catch (error) {
            if (error instanceof KeyChanged) return { state: "key-changed", ...flags }
            if (error instanceof Rollback) return { state: "rollback-rejected", version: error.version, highest: error.highest, ...flags }
            if (error instanceof UnauthorizedError) return { state: "signed-out", ...flags }
            if (error instanceof RateLimitedError) {
                this.backoffUntil = this.deps.now() + (error.retryAfter ?? 60) * 1000
                return { state: "rate-limited", retryAfter: error.retryAfter, ...flags }
            }
            if (error instanceof ConflictError && error.code === "dek_mismatch") return { state: "key-changed", ...flags }
            throw error
        }
    }

    private check(state: Unlocked, meta: { version: number, dekId: string | null }): void {
        if (meta.dekId !== null && meta.dekId !== state.dekId) throw new KeyChanged()
        if (meta.version < state.highestVersion) throw new Rollback(meta.version, state.highestVersion)
    }

    private async download(state: Unlocked): Promise<{ pkg: SyncPackage, version: number }> {
        const snapshot = await this.deps.api.snapshot()
        if (!snapshot) throw new AccountApiError(404, "not_found", "The account has no synced data.")
        if (snapshot.version < state.highestVersion) throw new Rollback(snapshot.version, state.highestVersion)
        if (snapshot.dekId !== state.dekId) throw new KeyChanged()
        const pkg = openPackage(this.deps.sodium, this.deps.gzip, snapshot.bytes, state.dek, { userId: state.userId, version: snapshot.version, dekId: state.dekId })
        return { pkg, version: snapshot.version }
    }

    private async run(trigger: SyncTrigger): Promise<SyncResult> {
        const loaded = await this.deps.session.load()
        if (loaded && !this.isDue(trigger, loaded)) return { state: "skipped", ...NO_FLAGS }
        let meta = await this.metaOrState()
        if ("state" in meta) return meta
        if (meta.rotationRequired && this.deps.rotate) {
            try {
                if (await this.deps.rotate()) {
                    const again = await this.metaOrState()
                    if ("state" in again) return again
                    meta = again
                }
            }
            catch (error) {
                // not possible here right now (password needed, old sign-in, unverified device, a race): the flag stays
                // and the screens ask for what is missing; the sync itself goes on (M-4)
                if (!(error instanceof AccountApiError || error instanceof AccountCryptoError)) throw error
                if (error instanceof UnauthorizedError) return { state: "signed-out", ...NO_FLAGS }
            }
        }
        const current = meta
        const flags: SyncFlags = { rotationRequired: current.rotationRequired, rewrapNeeded: current.rewrapNeeded, recoveryRenewalNeeded: current.recoveryRenewalNeeded === true }
        return this.guard(async state => {
            const { session, local, sodium, api, now } = this.deps
            this.check(state, current)
            if (!state.imported) {
                if (current.version > 0) return { state: "import-available", version: current.version, ...flags }
                await session.updateSync({ imported: true })
            }

            let pkg = await local.make()
            let hash = packageHash(sodium, pkg)
            let base = current.version
            let merged = false
            if (current.version > state.highestVersion) {
                const remote = await this.download(state)
                if (hash === state.lastHash) {
                    // nothing changed here since the last sync: the account's state is the newer one
                    await local.apply(remote.pkg, "replace")
                    await session.updateSync({ highestVersion: remote.version, lastHash: packageHash(sodium, await local.make()), lastSyncAt: now() })
                    return { state: "updated", version: remote.version, ...flags }
                }
                await local.apply(remote.pkg, "merge")
                await session.updateSync({ highestVersion: remote.version })
                pkg = await local.make()
                hash = packageHash(sodium, pkg)
                base = remote.version
                merged = true
            }
            else if (hash === state.lastHash) {
                await session.updateSync({ lastSyncAt: now() })
                return { state: "up-to-date", version: current.version, ...flags }
            }

            for (let attempt = 1; ; attempt++) {
                const blob = sealPackage(sodium, this.deps.gzip, pkg, state.dek, { userId: state.userId, version: base + 1, dekId: state.dekId })
                try {
                    const stored = await api.putSnapshot(blob, base, state.dekId)
                    await session.updateSync({ highestVersion: stored.version, lastHash: hash, lastSyncAt: now(), imported: true })
                    return { state: merged ? "merged" : "uploaded", version: stored.version, ...flags }
                }
                catch (error) {
                    if (!(error instanceof ConflictError && error.code === "version_conflict") || attempt >= MAX_UPLOAD_ATTEMPTS) throw error
                }
                // another device was faster: its package, merged with this device's, goes up as the next version
                const remote = await this.download(state)
                await local.apply(remote.pkg, "merge")
                await session.updateSync({ highestVersion: remote.version })
                state.highestVersion = remote.version
                pkg = await local.make()
                hash = packageHash(sodium, pkg)
                base = remote.version
                merged = true
            }
        }, flags)
    }

    private async metaOrState() {
        try {
            const state = await this.deps.session.load()
            if (!state) return { state: "signed-out", ...NO_FLAGS } as const
            if (!state.dek || !state.dekId) return { state: "needs-key", ...NO_FLAGS } as const
            return await this.deps.api.syncMeta()
        }
        catch (error) {
            if (error instanceof UnauthorizedError) return { state: "signed-out", ...NO_FLAGS } as const
            if (error instanceof RateLimitedError) {
                this.backoffUntil = this.deps.now() + (error.retryAfter ?? 60) * 1000
                return { state: "rate-limited", retryAfter: error.retryAfter, ...NO_FLAGS } as const
            }
            throw error
        }
    }
}
