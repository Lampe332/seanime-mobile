// geschrieben nach: Plan „Account + Sync“ (Abschnitte 6.5, 6.6, 8 Rollback-Schutz, 10.2) und dem Server-Vertrag account-server/src/routes.ts (sync/meta, sync/snapshot mit If-Match und X-Dek-Id, account/keys/device)

import type { RestoreMode } from "../backup/backup"
import { AccountApiError, type AccountClient, ConflictError, RateLimitedError, UnauthorizedError } from "./client"
import { AccountCryptoError, UntrustedKeyChangeError } from "./crypto"
import { pickUpDeviceKey } from "./devices"
import {
    type Gzip, type Ledger, type PackageEnvironment, type SyncPackage, applyPackage, ledgerStamps, makePackage, openPackage, packageHash, packageItems, sealPackage,
    settledLedger, stampChanges,
} from "./package"
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
 * - "Delete synced data" never lowers the version: the server counts on and says "no data" (size 0). A device that meets
 *   that takes nothing and uploads its own data as the next version.
 * - A newer package while this device changed nothing replaces the local state; with changes on both sides they merge
 *   part by part, the newer change wins and a removal stays one (package.ts mergePackages; each device keeps the change
 *   times of its parts in a ledger, LedgerStore).
 * - Another device rotated the DEK: this device fetches the new DEK sealed to its own key (account/keys/device) and
 *   syncs on, but only when its current DEK vouches for the new one (chain MAC, devices.ts pickUpDeviceKey). Otherwise
 *   "key-untrusted": start fresh ran elsewhere, or someone without the key (a taken-over Google account, a changed
 *   server) tried to switch the account to a key of its own. The device then neither imports nor uploads.
 *   "key-changed" when the server has no newer key for it (it was removed).
 * - The server asks for a key change (a device was removed or signed out): the sync goes on and reports the flag; the
 *   user changes the key on the "Change encryption key" screen and picks the devices that keep it (S2). Nothing rotates
 *   on its own, so the new key never reaches a device the user did not keep.
 */

export const SYNC_INTERVAL_MS = 5 * 60 * 1000
const MAX_UPLOAD_ATTEMPTS = 3

export type SyncTrigger = "interval" | "start" | "leave" | "manual"

export type SyncOutcome =
    | { state: "signed-out" }
    /** NEU-2: the server ended the session because this device was removed; the app drops the key and the session */
    | { state: "removed" }
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

/**
 * This device's data, as a package and back (package.ts does the work; the app adds its preferences and safety backup).
 * `account` is the signed-in account's id: the change times a device keeps belong to one account.
 */
export interface LocalData {
    make(account: string): Promise<SyncPackage>
    apply(pkg: SyncPackage, mode: RestoreMode, account: string): Promise<void>
    /** A local backup before an import replaces the device's state */
    safetyBackup(): Promise<void>
}

/** LocalData of the core plus the app's own preference store */
export function coreLocalData(environment: PackageEnvironment, app: {
    appVersion: string
    preferences: () => Record<string, string>
    /** lib/app-backup-keys.ts isDeviceKey */
    isDeviceKey: (key: string) => boolean
    /** Writes `preferences` into the app's store and takes the `removed` keys out of it */
    writePreferences: (preferences: Record<string, string>, removed: string[]) => void
    safetyBackup: () => Promise<void>
    /** Where the device keeps the change times of its parts (the app: one key of its store that isDeviceKey names) */
    ledger: LedgerStore
}): LocalData {
    const side = () => ({ appVersion: app.appVersion, preferences: app.preferences(), isDeviceKey: app.isDeviceKey })

    // The ledger of the secured storage's values lives there too: a hash of a password never lies in the app's store
    const readLedger = async (account: string): Promise<Ledger | null> => {
        const parts = [await app.ledger.read(), await environment.secret(SECRET_LEDGER)].map(text => parseLedger(text, account))
        if (!parts[0]) return null
        return { items: { ...parts[0].items, ...parts[1]?.items }, deleted: { ...parts[0].deleted, ...parts[1]?.deleted } }
    }
    const writeLedger = async (account: string, ledger: Ledger): Promise<void> => {
        const part = (secret: boolean) => {
            const mine = (record: Record<string, unknown>) => Object.fromEntries(Object.entries(record).filter(([key]) => key.startsWith("s/") === secret))
            return JSON.stringify({ account, items: mine(ledger.items), deleted: mine(ledger.deleted) })
        }
        const [open, secret] = [part(false), part(true)]
        if (await app.ledger.read() !== open) await app.ledger.write(open)
        if (environment.keepSecret && await environment.secret(SECRET_LEDGER) !== secret) await environment.keepSecret(SECRET_LEDGER, secret)
    }
    /** The device's package with the change times of its parts; what changed since the last look is stamped now */
    const look = async (account: string): Promise<SyncPackage> => {
        const pkg = await makePackage(environment, side())
        const ledger = stampChanges(await readLedger(account), packageItems(pkg), environment.now())
        await writeLedger(account, ledger)
        return { ...pkg, stamps: ledgerStamps(ledger) }
    }

    return {
        make: look,
        apply: async (pkg, mode, account) => {
            const mine = mode === "merge" ? await look(account) : null
            const applied = await applyPackage(environment, pkg, mode, { ...side(), stamps: mine?.stamps })
            app.writePreferences(applied.preferences, applied.removedPreferences)
            // the device's parts as they are now carry the times the package gave them: nothing of it counts as a change here
            await writeLedger(account, settledLedger(await readLedger(account), packageItems(await makePackage(environment, side())), applied.stamps))
        },
        safetyBackup: app.safetyBackup,
    }
}

/** One text the device keeps (the ledger of its parts' change times) */
export interface LedgerStore {
    read(): string | null | Promise<string | null>
    write(text: string): void | Promise<void>
}

/** The ledger's part for the values of the secured storage, kept in the secured storage itself */
const SECRET_LEDGER = "seanime-account.sync-ledger"

function parseLedger(text: string | null, account: string): Ledger | null {
    if (!text) return null
    try {
        const stored = JSON.parse(text) as { account?: unknown, items?: Ledger["items"], deleted?: Ledger["deleted"] }
        // another account's times say nothing about this one's parts
        if (stored.account !== account || typeof stored.items !== "object" || stored.items === null) return null
        return { items: stored.items, deleted: stored.deleted ?? {} }
    }
    catch {
        return null
    }
}

export type SyncApi = Pick<AccountClient, "syncMeta" | "snapshot" | "putSnapshot" | "deviceKey" | "deleteSync">

/** After "Delete synced data" the server keeps the version (counted on) with size 0: a version, but nothing to take */
const holdsData = (meta: { version: number, size: number }) => meta.version > 0 && meta.size > 0

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
            if (!holdsData(meta)) {
                await this.deps.session.updateSync({ imported: true, highestVersion: Math.max(state.highestVersion, meta.version) })
                return { state: "up-to-date", version: meta.version, ...flags }
            }
            await this.deps.local.safetyBackup()
            const remote = await this.download(state)
            await this.deps.local.apply(remote.pkg, "replace", state.userId)
            const hash = packageHash(this.deps.sodium, await this.deps.local.make(state.userId))
            await this.deps.session.updateSync({ imported: true, highestVersion: remote.version, lastHash: hash, lastSyncAt: this.deps.now() })
            return { state: "updated", version: remote.version, ...flags }
        })))
    }

    /**
     * "Delete synced data": the account's package goes. The highest version seen stays (the server counts on, a lower one
     * is still a rollback); without the hash this device uploads its data again at its next sync.
     */
    deleteSynced(): Promise<void> {
        return this.serial(async () => {
            await this.deps.api.deleteSync()
            await this.deps.session.updateSync({ lastHash: null, lastSyncAt: null })
        })
    }

    /**
     * Runs a step that ends or changes the account on this device (sign-out, a removed device's clean-up, deleting the
     * account) between two syncs, never during one: a sync that is still running would write its sync state back after
     * the step cleared it, and the next sign-in would find it.
     */
    exclusive<T>(work: () => Promise<T>): Promise<T> {
        return this.serial(work)
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
            if (error instanceof UnauthorizedError) return { state: error.code === "device_removed" ? "removed" : "signed-out", ...flags }
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
        const current = await this.metaOrState()
        if ("state" in current) return current
        const flags: SyncFlags = { rotationRequired: current.rotationRequired, rewrapNeeded: current.rewrapNeeded, recoveryRenewalNeeded: current.recoveryRenewalNeeded === true }
        return this.guard(async state => {
            const { session, local, sodium, api, now } = this.deps
            this.check(state, current)
            if (!state.imported) {
                if (holdsData(current)) return { state: "import-available", version: current.version, ...flags }
                await session.updateSync({ imported: true })
            }

            let pkg = await local.make(state.userId)
            let hash = packageHash(sodium, pkg)
            let base = current.version
            let merged = false
            if (!holdsData(current)) {
                // nothing in the account (never was, or deleted): this device's data goes up as the next version
                if (current.version > state.highestVersion) await session.updateSync({ highestVersion: current.version })
            }
            else if (current.version > state.highestVersion) {
                const remote = await this.download(state)
                if (hash === state.lastHash) {
                    // nothing changed here since the last sync: the account's state is the newer one
                    await local.apply(remote.pkg, "replace", state.userId)
                    await session.updateSync({ highestVersion: remote.version, lastHash: packageHash(sodium, await local.make(state.userId)), lastSyncAt: now() })
                    return { state: "updated", version: remote.version, ...flags }
                }
                await local.apply(remote.pkg, "merge", state.userId)
                await session.updateSync({ highestVersion: remote.version })
                pkg = await local.make(state.userId)
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
                await local.apply(remote.pkg, "merge", state.userId)
                await session.updateSync({ highestVersion: remote.version })
                state.highestVersion = remote.version
                pkg = await local.make(state.userId)
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
            if (!state.dek || !state.dekId) {
                this.deps.sodium.memzero(state.dek ?? new Uint8Array(0))
                return { state: "needs-key", ...NO_FLAGS } as const
            }
            this.deps.sodium.memzero(state.dek)
            const meta = await this.deps.api.syncMeta()
            await this.deps.session.addServerRemoved(state.userId, meta.removedDevices)
            return meta
        }
        catch (error) {
            if (error instanceof UnauthorizedError) return { state: error.code === "device_removed" ? "removed" : "signed-out", ...NO_FLAGS } as const
            if (error instanceof RateLimitedError) {
                this.backoffUntil = this.deps.now() + (error.retryAfter ?? 60) * 1000
                return { state: "rate-limited", retryAfter: error.retryAfter, ...NO_FLAGS } as const
            }
            throw error
        }
    }
}
