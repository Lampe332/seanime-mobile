// geschrieben nach: Plan „Account + Sync“ (Abschnitte 6.5, 6.6, 8 Rollback-Schutz, 10.2) und dem Server-Vertrag account-server/src/routes.ts (sync/meta, sync/snapshot mit If-Match und X-Dek-Id, account/keys/device)

import type { RestoreMode } from "../backup/backup"
import { AccountApiError, type AccountClient, ConflictError, RateLimitedError, UnauthorizedError } from "./client"
import { AccountCryptoError, UntrustedKeyChangeError } from "./crypto"
import { pickUpDeviceKey } from "./devices"
import {
    type Gzip, type Ledger, type PackageEnvironment, type SyncPackage, applyPackage, joiningLedger, ledgerStamps, makePackage, mayHoldSecret, openPackage, packageHash,
    packageItems, sealPackage, settledLedger, stampChanges,
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
 * - A newer package is never taken as it is, also when this device changed nothing: it is merged part by part, the newer
 *   change wins and a removal stays one (package.ts mergePackages; each device keeps the change times of its parts in a
 *   ledger, LedgerStore). What the package does not know stays on the device and goes up with the next version. Only
 *   the import the user asks for replaces the device's state, after a local backup.
 *   The server is not trusted with this (SECURITY-AUDIT N-3): it can say "no data" to a device that just signed in and
 *   get that device's package, validly sealed, for the next version. Such a device joins with what it holds
 *   (LocalData.startOver, after a local backup): its parts count as older than anything in the account and it names no
 *   removal, so its package can add a part to the other devices, never replace or remove one of theirs. With wrong
 *   sizes or versions the server can keep devices from syncing, never make one drop what it holds.
 * - A step that ends the account here (sign-out, …) waits only a moment for a running sync; a sync that hangs is given
 *   up and can write nothing more (exclusive).
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
/** How long a step that ends the account on this device (sign-out, …) waits for a running sync before it gives it up */
export const EXCLUSIVE_PATIENCE_MS = 5000

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
    /** The account's newer package was merged into this device (or imported), which holds nothing the package lacks */
    | { state: "updated", version: number }
    /** The account's newer package was merged into this device, and what the device holds beyond it went up */
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
    /** `ahead` (after a merge): the device holds something the package does not, so its state is worth an upload */
    apply(pkg: SyncPackage, mode: RestoreMode, account: string): Promise<{ ahead: boolean }>
    /**
     * The device joins the account anew (a sign-in that did not import): the change times it kept are forgotten. All it
     * holds counts as older than anything in the account and nothing as removed by it (package.ts joiningLedger), so
     * its package can add to the other devices and never replace or remove a part of theirs.
     */
    startOver(account: string): Promise<void>
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

    /*
     * A ledger entry is the content hash of a part (cyrb53: quick, and a short password could be guessed against it).
     * So the entries of every part that may hold a password, key or token (package.ts mayHoldSecret: the secured
     * storage's values, the rows of the tables with secret columns, the preferences with secret fields) live in the
     * secured storage; the app's store gets the rest.
     */
    const readLedger = async (account: string): Promise<Ledger | null> => {
        const parts = [await app.ledger.read(), await environment.secret(SECRET_LEDGER)].map(text => parseLedger(text, account))
        if (!parts[0]) return null
        return { items: { ...parts[0].items, ...parts[1]?.items }, deleted: { ...parts[0].deleted, ...parts[1]?.deleted } }
    }
    /** `items`: the device's parts the ledger was made from (their content tells which of them may hold a secret) */
    const writeLedger = async (account: string, ledger: Ledger, items: Map<string, unknown>): Promise<void> => {
        const part = (secret: boolean) => {
            const mine = (record: Record<string, unknown>) => Object.fromEntries(Object.entries(record).filter(([key]) => mayHoldSecret(key, items.get(key)) === secret))
            return JSON.stringify({ account, items: mine(ledger.items), deleted: mine(ledger.deleted) })
        }
        const [open, secret] = [part(false), part(true)]
        if (await app.ledger.read() !== open) await app.ledger.write(open)
        if (environment.keepSecret && await environment.secret(SECRET_LEDGER) !== secret) await environment.keepSecret(SECRET_LEDGER, secret)
    }
    /** The device's package with the change times of its parts; what changed since the last look is stamped now */
    const look = async (account: string): Promise<SyncPackage> => {
        const pkg = await makePackage(environment, side())
        const items = packageItems(pkg)
        const ledger = stampChanges(await readLedger(account), items, environment.now())
        await writeLedger(account, ledger, items)
        return { ...pkg, stamps: ledgerStamps(ledger) }
    }

    return {
        make: look,
        apply: async (pkg, mode, account) => {
            const mine = mode === "merge" ? await look(account) : null
            const applied = await applyPackage(environment, pkg, mode, { ...side(), stamps: mine?.stamps })
            app.writePreferences(applied.preferences, applied.removedPreferences)
            // the device's parts as they are now carry the times the package gave them: nothing of it counts as a change here
            const items = packageItems(await makePackage(environment, side()))
            await writeLedger(account, settledLedger(await readLedger(account), items, applied.stamps), items)
            return { ahead: applied.ahead }
        },
        startOver: async account => {
            const items = packageItems(await makePackage(environment, side()))
            await writeLedger(account, joiningLedger(items), items)
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
const SECRET_LEDGER = "seanime-core-sync-ledger"

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
/** What a sync that was given up (SyncEngine.exclusive) meets at its next step: it ends there */
class GivenUp extends Error {}

type Unlocked = AccountState & { dek: Uint8Array, dekId: string }

type Parts = {
    api: SyncApi
    session: AccountSession
    sodium: Sodium
    gzip: Gzip
    local: LocalData
    now: () => number
}

export class SyncEngine {
    private queue: Promise<unknown> = Promise.resolve()
    private backoffUntil = 0
    /** Counts the times the waiting and running syncs were given up: a sync asked for under an older count is over */
    private givenUp = 0

    constructor(private readonly deps: Parts & {
        /** EXCLUSIVE_PATIENCE_MS, shorter in tests */
        patienceMs?: number
    }) {}

    /** Whether a trigger should run now: the 5-minute tick only after 5 minutes, the others always */
    isDue(trigger: SyncTrigger, state: Pick<AccountState, "lastSyncAt">): boolean {
        if (trigger !== "manual" && this.deps.now() < this.backoffUntil) return false
        if (trigger !== "interval") return true
        return state.lastSyncAt === null || this.deps.now() - state.lastSyncAt >= SYNC_INTERVAL_MS
    }

    sync(trigger: SyncTrigger): Promise<SyncResult> {
        const run = this.parts()
        return this.serial(() => this.unlessGivenUp(() => this.withKeyPickup(run, () => this.run(run, trigger))))
    }

    /**
     * The server, the secured storage and the device's data for one sync. Once that sync is given up, every call of
     * theirs throws GivenUp, before it acts and when its answer comes: a sync that hung on the network can write neither
     * the account's state nor data after the step that did not wait for it any longer.
     */
    private parts(): Parts {
        const asked = this.givenUp
        const check = () => {
            if (asked !== this.givenUp) throw new GivenUp()
        }
        const guarded = <T extends object>(target: T): T => new Proxy(target, {
            get: (_, name) => {
                const value: unknown = Reflect.get(target, name)
                if (typeof value !== "function") return value
                return async (...given: unknown[]) => {
                    check()
                    let answer: unknown
                    try {
                        answer = await (value as (...given: unknown[]) => unknown).apply(target, given)
                    }
                    catch (error) {
                        check()
                        throw error
                    }
                    check()
                    return answer
                }
            },
        })
        const { api, session, local, sodium, gzip, now } = this.deps
        return { api: guarded(api), session: guarded(session), local: guarded(local), sodium, gzip, now }
    }

    /** A sync that was given up changes nothing and counts like a tick that did not run */
    private async unlessGivenUp(work: () => Promise<SyncResult>): Promise<SyncResult> {
        try {
            return await work()
        }
        catch (error) {
            if (error instanceof GivenUp) return { state: "skipped", ...NO_FLAGS }
            throw error
        }
    }

    /** On "key-changed" the new DEK sealed to this device is fetched once and the work runs again */
    private async withKeyPickup(run: Parts, work: () => Promise<SyncResult>): Promise<SyncResult> {
        const first = await work()
        if (first.state !== "key-changed") return first
        const flags: SyncFlags = { rotationRequired: first.rotationRequired, rewrapNeeded: first.rewrapNeeded, recoveryRenewalNeeded: first.recoveryRenewalNeeded }
        try {
            if (!(await pickUpDeviceKey({ api: run.api, session: run.session, sodium: run.sodium }))) return first
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
        const run = this.parts()
        return this.serial(() => this.unlessGivenUp(() => this.withKeyPickup(run, () => this.guard(run, async (state, flags) => {
            const meta = await run.api.syncMeta()
            this.check(state, meta)
            if (!holdsData(meta)) {
                await run.local.safetyBackup()
                await run.local.startOver(state.userId)
                await run.session.updateSync({ imported: true, highestVersion: Math.max(state.highestVersion, meta.version) })
                return { state: "up-to-date", version: meta.version, ...flags }
            }
            await run.local.safetyBackup()
            const remote = await this.download(run, state)
            await run.local.apply(remote.pkg, "replace", state.userId)
            const hash = packageHash(run.sodium, await run.local.make(state.userId))
            await run.session.updateSync({ imported: true, highestVersion: remote.version, lastHash: hash, lastSyncAt: run.now() })
            return { state: "updated", version: remote.version, ...flags }
        }))))
    }

    /**
     * "Delete synced data": the account's package goes. The highest version seen stays (the server counts on, a lower one
     * is still a rollback); without the hash this device uploads its data again at its next sync.
     */
    deleteSynced(): Promise<void> {
        const run = this.parts()
        return this.serial(async () => {
            try {
                await run.api.deleteSync()
                await run.session.updateSync({ lastHash: null, lastSyncAt: null })
            }
            catch (error) {
                // the user signed out meanwhile: nothing of the account is left here to update
                if (!(error instanceof GivenUp)) throw error
            }
        })
    }

    /**
     * Runs a step that ends or changes the account on this device (sign-out, a removed device's clean-up, deleting the
     * account) between two syncs, never during one: a sync that is still running would write its sync state back after
     * the step cleared it, and the next sign-in would find it.
     * The step waits for a running sync only for a moment (EXCLUSIVE_PATIENCE_MS). A sync that hangs on the network is
     * then given up, with every sync waiting behind it: none of them writes anything more (parts), and the step runs.
     */
    exclusive<T>(work: () => Promise<T>): Promise<T> {
        let timer: ReturnType<typeof setTimeout> | undefined
        const patience = new Promise<"late">(resolve => {
            timer = setTimeout(() => resolve("late"), this.deps.patienceMs ?? EXCLUSIVE_PATIENCE_MS)
        })
        const next = Promise.race([this.queue.then(() => "free" as const), patience]).then(turn => {
            clearTimeout(timer)
            if (turn === "late") this.givenUp++
            return work()
        })
        // what is asked for from now on waits for this step, not for the sync that hangs
        this.queue = next.catch(() => undefined)
        return next
    }

    private serial<T>(work: () => Promise<T>): Promise<T> {
        const next = this.queue.then(work, work)
        this.queue = next.catch(() => undefined)
        return next
    }

    /** Loads the account, maps the server's answers that end a sync to their state */
    private async guard(run: Parts, work: (state: Unlocked, flags: SyncFlags) => Promise<SyncResult>, flags: SyncFlags = NO_FLAGS): Promise<SyncResult> {
        const state = await run.session.load()
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

    private async download(run: Parts, state: Unlocked): Promise<{ pkg: SyncPackage, version: number }> {
        const snapshot = await run.api.snapshot()
        if (!snapshot) throw new AccountApiError(404, "not_found", "The account has no synced data.")
        if (snapshot.version < state.highestVersion) throw new Rollback(snapshot.version, state.highestVersion)
        if (snapshot.dekId !== state.dekId) throw new KeyChanged()
        const pkg = openPackage(run.sodium, run.gzip, snapshot.bytes, state.dek, { userId: state.userId, version: snapshot.version, dekId: state.dekId })
        return { pkg, version: snapshot.version }
    }

    private async run(run: Parts, trigger: SyncTrigger): Promise<SyncResult> {
        const loaded = await run.session.load()
        if (loaded && !this.isDue(trigger, loaded)) return { state: "skipped", ...NO_FLAGS }
        const current = await this.metaOrState(run)
        if ("state" in current) return current
        const flags: SyncFlags = { rotationRequired: current.rotationRequired, rewrapNeeded: current.rewrapNeeded, recoveryRenewalNeeded: current.recoveryRenewalNeeded === true }
        return this.guard(run, async state => {
            const { session, local, sodium, api, now } = run
            this.check(state, current)
            if (!state.imported) {
                if (holdsData(current)) return { state: "import-available", version: current.version, ...flags }
                // nothing to import, says the server: the device joins with what it holds, which counts as older than all
                // of the account's. Should the account hold data after all, its parts replace the device's without the
                // import question, so the device's state is backed up now as before an import
                await local.safetyBackup()
                await local.startOver(state.userId)
                await session.updateSync({ imported: true })
            }

            let pkg = await local.make(state.userId)
            let hash = packageHash(sodium, pkg)
            let base = current.version
            let merged = false
            /**
             * A newer package of the account, merged into this device (never taken as it is). False when the device then
             * holds nothing the package lacks: there is nothing to send.
             */
            const takeNewer = async (): Promise<boolean> => {
                const remote = await this.download(run, state)
                const { ahead } = await local.apply(remote.pkg, "merge", state.userId)
                pkg = await local.make(state.userId)
                hash = packageHash(sodium, pkg)
                base = remote.version
                state.highestVersion = remote.version
                await session.updateSync(ahead ? { highestVersion: base } : { highestVersion: base, lastHash: hash, lastSyncAt: now() })
                merged = true
                return ahead
            }
            if (!holdsData(current)) {
                // nothing in the account (never was, or deleted): this device's data goes up as the next version
                if (current.version > state.highestVersion) await session.updateSync({ highestVersion: current.version })
            }
            else if (current.version > state.highestVersion) {
                if (!(await takeNewer())) return { state: "updated", version: base, ...flags }
            }
            else if (hash === state.lastHash) {
                await session.updateSync({ lastSyncAt: now() })
                return { state: "up-to-date", version: current.version, ...flags }
            }

            for (let attempt = 1; ; attempt++) {
                const blob = sealPackage(sodium, run.gzip, pkg, state.dek, { userId: state.userId, version: base + 1, dekId: state.dekId })
                try {
                    const stored = await api.putSnapshot(blob, base, state.dekId)
                    await session.updateSync({ highestVersion: stored.version, lastHash: hash, lastSyncAt: now(), imported: true })
                    return { state: merged ? "merged" : "uploaded", version: stored.version, ...flags }
                }
                catch (error) {
                    if (!(error instanceof ConflictError && error.code === "version_conflict") || attempt >= MAX_UPLOAD_ATTEMPTS) throw error
                }
                // another device was faster: its package, merged with this device's, goes up as the next version
                if (!(await takeNewer())) return { state: "updated", version: base, ...flags }
            }
        }, flags)
    }

    private async metaOrState(run: Parts) {
        try {
            const state = await run.session.load()
            if (!state) return { state: "signed-out", ...NO_FLAGS } as const
            if (!state.dek || !state.dekId) {
                run.sodium.memzero(state.dek ?? new Uint8Array(0))
                return { state: "needs-key", ...NO_FLAGS } as const
            }
            run.sodium.memzero(state.dek)
            const meta = await run.api.syncMeta()
            await run.session.addServerRemoved(state.userId, meta.removedDevices)
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
