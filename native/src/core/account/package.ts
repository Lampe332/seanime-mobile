// geschrieben nach: Plan „Account + Sync“ (Abschnitte 3, 5, 6.5, 6.6), core/backup/backup.ts (makeBackup, readBackup, restoreBackup, withoutSecrets, preferencesWithoutSecrets) und lib/app-backup-keys.ts (isDeviceKey, von der App hereingereicht)

import { eq } from "drizzle-orm"
import { type BackupFile, type BackupTable, type RestoreMode, makeBackup, preferencesWithoutSecrets, readBackup, restoreBackup, withoutSecrets } from "../backup/backup"
import { type CoreDatabase, inOrder } from "../database/database"
import { extensionUserConfigs, settingsSections, torrentKept } from "../database/schema"
import { DEBRID_KEY_SECRET } from "../debrid/debrid"
import { ACCOUNT_TOKEN_SECRET } from "../move/move"
import { NAKAMA_PASSWORD_SECRET } from "../nakama/guest"
import type { CoreEnvironment } from "../registry"
import { type PackageBinding, decryptPackage, encryptPackage, toB64 } from "./crypto"
import { isAccountKey } from "./session"
import type { Sodium } from "./sodium"

/*
 * The sync package: the backup file (backup.ts makeBackup) PLUS the secrets the file backup leaves out, because the
 * package is end-to-end encrypted and only the user's own devices can open it. The file backup itself is unchanged and
 * stays without secrets.
 *
 * What the file backup removes today, and the package carries:
 * 1. Secured storage of the device (CoreEnvironment.secret), never in the file:
 *    - ACCOUNT_TOKEN_SECRET  "seanime-core.account-token"      the AniList token (move/move.ts)
 *    - DEBRID_KEY_SECRET     "seanime-core-debrid-api-key"     the debrid / TorBox key (debrid/debrid.ts)
 *    - NAKAMA_PASSWORD_SECRET "seanime-nakama-host-password"   the Nakama host password (nakama/guest.ts)
 * 2. Fields that `withoutSecrets` strips (named like password/token/secret/api key/cookie/credential, or a JWT text):
 *    - settings.content           (settings sections, e.g. qbittorrentPassword, remoteServerPassword)
 *    - extensionConfigs.values    (an extension's user config, e.g. apiKey: the extensions' keys)
 *    - torrentKept.content
 * 3. App preferences that `preferencesWithoutSecrets` drops (a key named like a secret, a JWT value, secret JSON fields).
 *
 * Never in the package: the device's own keys (the app's isDeviceKey, lib/app-backup-keys.ts), the account's own keys
 * and session (isAccountKey, session.ts; they live only in the secured storage), downloads, and the changes still
 * waiting for AniList (DEVICE_TABLES): each device sends its own, so nothing reaches AniList twice or from a device the
 * user did not act on. The file backup keeps them (a restore is the user's own step on that device).
 *
 * The core imports no package (core.test.ts): gzip (fflate) and isDeviceKey come from the app, like libsodium.
 */

/** gzip in the shape of fflate's gzipSync/gunzipSync; the app hands in `{ gzip: d => gzipSync(d, { mtime: 0 }), gunzip: gunzipSync }` */
export interface Gzip {
    gzip(data: Uint8Array): Uint8Array
    gunzip(data: Uint8Array): Uint8Array
}

/** The app's side of a package: its version, its preferences and which of their keys belong to the device */
export type AppSide = { appVersion: string, preferences: Record<string, string>, isDeviceKey: (key: string) => boolean }

export const SYNCED_SECRETS = [ACCOUNT_TOKEN_SECRET, DEBRID_KEY_SECRET, NAKAMA_PASSWORD_SECRET] as const

/** Tables whose column may hold secrets, with their key column (the same three as backup.ts WITH_SECRETS) */
const SECRET_TABLES = {
    settings: { table: settingsSections, key: "section", column: "content" },
    extensionConfigs: { table: extensionUserConfigs, key: "id", column: "values" },
    torrentKept: { table: torrentKept, key: "key", column: "content" },
} as const
type SecretTable = keyof typeof SECRET_TABLES

/** Tables of the backup that stay on the device: never put into a package, never taken from one (also not an older build's) */
const DEVICE_TABLES = ["waitingChanges"] as const satisfies readonly BackupTable[]

function withoutDeviceTables<T extends BackupFile>(file: T): T {
    const tables = { ...file.tables }
    for (const name of DEVICE_TABLES) delete tables[name]
    return { ...file, tables }
}

/**
 * When each part of a package last changed (`changed`) and what was removed and when (`deleted`), by the part's key
 * (packageItems). Unix milliseconds of the device that made the change.
 */
export type Stamps = { changed: Record<string, number>, deleted: Record<string, number> }

export type SyncPackage = BackupFile & {
    /** Values of the secured storage (SYNCED_SECRETS), by name */
    secrets: Record<string, string>
    /** Missing in a package of a build before the times were kept: its rows then count by their own changedAt, the rest as oldest */
    stamps?: Stamps
}

type Json = Record<string, unknown>
export type PackageEnvironment = Pick<CoreEnvironment, "database" | "secret" | "now" | "extensions" | "keepSecret">

/** The preferences a package may carry: all of the user's, with their secrets, never the device's or the account's */
export function packagePreferences(preferences: Record<string, string>, isDeviceKey: (key: string) => boolean): Record<string, string> {
    return Object.fromEntries(Object.entries(preferences).filter(([key, value]) => typeof value === "string" && !isDeviceKey(key) && !isAccountKey(key)))
}

async function rawRows(database: CoreDatabase, name: SecretTable): Promise<Json[]> {
    return await inOrder(database, () => database.select().from(SECRET_TABLES[name].table)) as Json[]
}

/** The package of this device: the backup, its stripped columns with their secrets, the preferences and the secured storage */
export async function makePackage(environment: PackageEnvironment, app: AppSide): Promise<SyncPackage> {
    const file = withoutDeviceTables(await makeBackup(environment, { appVersion: app.appVersion, preferences: app.preferences }))
    const database = await environment.database()
    for (const name of Object.keys(SECRET_TABLES) as SecretTable[]) file.tables[name] = await rawRows(database, name)
    const secrets: Record<string, string> = {}
    for (const name of SYNCED_SECRETS) {
        const value = await environment.secret(name)
        if (value) secrets[name] = value
    }
    return { ...file, preferences: packagePreferences(app.preferences, app.isDeviceKey), secrets }
}

/** Stable text of a package for the "did anything change" hash: without the moment it was made */
function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical)
    if (value === null || typeof value !== "object") return value
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Json)[key])]))
}

export function packageHash(sodium: Sodium, pkg: SyncPackage): string {
    const text = JSON.stringify(canonical({ ...pkg, createdAt: "" }))
    return toB64(sodium, sodium.crypto_hash_sha256(new TextEncoder().encode(text)))
}

/** JSON → gzip → XChaCha20-Poly1305, bound to account, version and DEK */
export function sealPackage(sodium: Sodium, zip: Gzip, pkg: SyncPackage, dek: Uint8Array, binding: PackageBinding): Uint8Array {
    const zipped = zip.gzip(new TextEncoder().encode(JSON.stringify(pkg)))
    return encryptPackage(sodium, zipped, dek, binding)
}

/** Reads a package back; throws AccountCryptoError (not this account/version/key, changed) or CoreError (not a package) */
export function openPackage(sodium: Sodium, zip: Gzip, blob: Uint8Array, dek: Uint8Array, binding: PackageBinding): SyncPackage {
    const text = new TextDecoder().decode(zip.gunzip(decryptPackage(sodium, blob, dek, binding)))
    return readPackage(text)
}

export function readPackage(text: string): SyncPackage {
    const file = readBackup(text)
    const parsed = JSON.parse(text) as Json
    const secrets: Record<string, string> = {}
    if (parsed.secrets && typeof parsed.secrets === "object" && !Array.isArray(parsed.secrets)) {
        for (const name of SYNCED_SECRETS) {
            const value = (parsed.secrets as Json)[name]
            if (typeof value === "string" && value !== "") secrets[name] = value
        }
    }
    const stamps = readStamps(parsed.stamps)
    return { ...withoutDeviceTables(file), preferences: packagePreferences(file.preferences, () => false), secrets, ...(stamps ? { stamps } : {}) }
}

function readStamps(value: unknown): Stamps | null {
    if (!isRecord(value)) return null
    const times = (part: unknown) => Object.fromEntries(Object.entries(isRecord(part) ? part : {}).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])))
    return { changed: times(value.changed), deleted: times(value.deleted) }
}

/* ---- Applying a package ---- */

const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value)

/** `into` with the secret fields of `from` it lacks (a field `withoutSecrets` would strip), at any depth */
function fillSecrets(into: unknown, from: unknown): unknown {
    if (!isRecord(from)) return into
    if (into === null || into === undefined) return from
    if (!isRecord(into)) return into
    const stripped = withoutSecrets(from) as Json
    const result: Json = { ...into }
    for (const [key, value] of Object.entries(from)) {
        if (!(key in stripped)) {
            if (!(key in result)) result[key] = value
        }
        else if (key in result) result[key] = fillSecrets(result[key], value)
    }
    return result
}

/* ---- The parts of a package, their change times and the merge ---- */

/*
 * Two devices change different things between two syncs, so a merge goes part by part: a row of a table, a preference, an
 * extension's file, a secret. For each part the newer change wins, and a part that was removed stays removed until it
 * is made again later (a tombstone in `deleted`), so a deleted playlist or an uninstalled extension does not come back
 * from the other device.
 * The tables hold no time of removal and the preferences no time at all, so each device keeps a ledger (LedgerStore in
 * sync.ts): the content hash and change time of every part it last saw. Before a package is made the device's data is
 * compared with it; what differs was changed since, what is gone was removed. The times travel in the package (Stamps).
 */

/** How a table's rows are told apart across devices (never by a number the database gave them) */
const ROW_KEYS = {
    settings: ["section"],
    appearance: ["id"],
    watchPositions: ["mediaId"],
    extensionConfigs: ["id"],
    sandboxSettings: ["id"],
    onlinestreamMappings: ["provider", "mediaId"],
    mangaMappings: ["provider", "mediaId"],
    mangaPreferences: ["mediaId"],
    offlineSettings: ["id"],
    silencedAnime: ["anilistId"],
    metadataParents: ["mediaId"],
    playlists: ["name"],
    torrentKept: ["key"],
} as const satisfies Record<Exclude<BackupTable, "homeItems" | (typeof DEVICE_TABLES)[number]>, readonly string[]>
type RowTable = keyof typeof ROW_KEYS
const ROW_TABLES = Object.keys(ROW_KEYS) as RowTable[]
/** The number a device's database gave a row: not part of its content, and never carried to another device's row */
const OWN_NUMBER: Partial<Record<string, string>> = { playlists: "dbId", metadataParents: "id" }
/** The home screen is one arrangement: taken or left as a whole */
const HOME = "t/homeItems"
const SECRET_PART = "s/"
const PREFERENCE_PART = "p/"

const tableOf = (key: string) => key.split("/")[1]!

/** Every part of a package by its key: `t/<table>/<row key>`, `x/<extension file>`, `d/<disabled extension>`, `l/<list kind>`, `p/<preference>`, `s/<secret>` */
export function packageItems(pkg: SyncPackage): Map<string, unknown> {
    const items = new Map<string, unknown>()
    const put = (key: string, value: unknown) => {
        // two rows of one name (playlists may share theirs) stay two parts
        let free = key
        for (let n = 2; items.has(free); n++) free = `${key}#${n}`
        items.set(free, value)
    }
    for (const name of ROW_TABLES) {
        for (const row of pkg.tables[name] ?? []) put(`t/${name}/${ROW_KEYS[name].map(column => String(row[column])).join("/")}`, row)
    }
    if ((pkg.tables.homeItems?.length ?? 0) > 0) items.set(HOME, pkg.tables.homeItems)
    for (const [name, text] of Object.entries(pkg.extensions.files)) items.set(`x/${name}`, text)
    for (const id of pkg.extensions.disabled) items.set(`d/${id}`, true)
    for (const [kind, collection] of Object.entries(pkg.localLists ?? {})) items.set(`l/${kind}`, collection)
    for (const [key, text] of Object.entries(pkg.preferences)) items.set(PREFERENCE_PART + key, text)
    for (const [name, value] of Object.entries(pkg.secrets)) items.set(SECRET_PART + name, value)
    return items
}

/** `base` with the given parts as its whole content */
function packageFrom(base: SyncPackage, items: Map<string, unknown>, stamps: Stamps): SyncPackage {
    const tables: SyncPackage["tables"] = { homeItems: (items.get(HOME) as Json[] | undefined) ?? [] }
    for (const name of ROW_TABLES) tables[name] = []
    const files: Record<string, string> = {}
    const disabled: string[] = []
    const lists: Record<string, unknown> = {}
    const preferences: Record<string, string> = {}
    const secrets: Record<string, string> = {}
    for (const [key, value] of items) {
        const name = key.slice(2)
        if (key === HOME) continue
        if (key.startsWith("t/")) tables[tableOf(key) as RowTable]!.push(value as Json)
        else if (key.startsWith("x/")) files[name] = value as string
        else if (key.startsWith("d/")) disabled.push(name)
        else if (key.startsWith("l/")) lists[name] = value
        else if (key.startsWith(PREFERENCE_PART)) preferences[name] = value as string
        else if (key.startsWith(SECRET_PART)) secrets[name] = value as string
    }
    return {
        ...base,
        tables,
        extensions: { files, disabled: disabled.sort() },
        localLists: Object.keys(lists).length > 0 ? lists as SyncPackage["localLists"] : null,
        preferences,
        secrets,
        stamps,
    }
}

/** A part's content as text, the same on every device: without the number its database gave the row */
function contentOf(key: string, value: unknown): string {
    const own = key.startsWith("t/") ? OWN_NUMBER[tableOf(key)] : undefined
    if (!own || !isRecord(value)) return JSON.stringify(canonical(value))
    const { [own]: _own, ...content } = value
    return JSON.stringify(canonical(content))
}

/** The time a row carries itself (changedAt / updatedAt); 0 for everything that has none */
function ownTime(key: string, value: unknown): number {
    if (!key.startsWith("t/") || !isRecord(value)) return 0
    const time = value.changedAt ?? value.updatedAt
    return typeof time === "number" && Number.isFinite(time) ? time : 0
}

/** The change times of a package's parts: its stamps, and for a package without them the rows' own times */
function stampsOf(pkg: SyncPackage, items = packageItems(pkg)): Stamps {
    const changed: Record<string, number> = {}
    for (const [key, value] of items) changed[key] = pkg.stamps?.changed[key] ?? ownTime(key, value)
    const deleted = Object.fromEntries(Object.entries(pkg.stamps?.deleted ?? {}).filter(([key]) => !items.has(key)))
    return { changed, deleted }
}

/** What this device last saw of each part: `[content hash, change time]`, and the removed parts with their time */
export type Ledger = { items: Record<string, [hash: number, time: number]>, deleted: Record<string, number> }

/** cyrb53: a 53-bit hash of a text, enough to see that a part changed */
function hashOf(text: string): number {
    let h1 = 0xdeadbeef
    let h2 = 0x41c6ce57
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i)
        h1 = Math.imul(h1 ^ code, 2654435761)
        h2 = Math.imul(h2 ^ code, 1597334677)
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
    return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

/**
 * The ledger after a look at the device's data: a part whose content differs from the ledger changed since (its own
 * newer changedAt, else now), a part the ledger knew and the device no longer has was removed now. Without a ledger
 * (first sync of this account here) every part starts with its own time and nothing counts as removed.
 * `settling`: the times of a package whose applying was cut short before its ledger was written (sync.ts). A part
 * that differs from the ledger came from that package and keeps its time; a part the package brings or removes and
 * the device lacks counts as no removal of the device. Nothing of it is a change made here.
 */
export function stampChanges(before: Ledger | null, items: Map<string, unknown>, now: number, settling?: Stamps): Ledger {
    const ledger: Ledger = { items: {}, deleted: {} }
    for (const [key, value] of items) {
        const hash = hashOf(contentOf(key, value))
        const known = before?.items[key]
        if (known && known[0] === hash) {
            ledger.items[key] = known
            continue
        }
        const brought = settling?.changed[key]
        if (typeof brought === "number") {
            ledger.items[key] = [hash, brought]
            continue
        }
        const own = ownTime(key, value)
        if (!before) {
            ledger.items[key] = [hash, own]
            continue
        }
        const last = Math.max(known?.[1] ?? 0, before.deleted[key] ?? 0)
        ledger.items[key] = [hash, own > last && own <= now ? own : Math.max(now, last + 1)]
    }
    for (const [key, time] of Object.entries(before?.deleted ?? {})) if (!items.has(key)) ledger.deleted[key] = time
    for (const [key, known] of Object.entries(before?.items ?? {})) {
        if (items.has(key)) continue
        const removed = settling?.deleted[key]
        if (typeof removed === "number") ledger.deleted[key] = removed
        else if (typeof settling?.changed[key] !== "number") ledger.deleted[key] = Math.max(now, known[1] + 1)
    }
    return ledger
}

/** The ledger after a package was applied: the device's parts as they are now, with the times the package gave them */
export function settledLedger(before: Ledger | null, items: Map<string, unknown>, stamps: Stamps): Ledger {
    const ledger: Ledger = { items: {}, deleted: {} }
    for (const [key, value] of items) {
        const hash = hashOf(contentOf(key, value))
        const known = before?.items[key]
        ledger.items[key] = [hash, stamps.changed[key] ?? (known && known[0] === hash ? known[1] : ownTime(key, value))]
    }
    for (const [key, time] of Object.entries(stamps.deleted)) if (!items.has(key)) ledger.deleted[key] = time
    return ledger
}

/** The change time of all a device holds when it joins an account without importing: before any change made in the account */
const BEFORE_THE_ACCOUNT = -1

/**
 * The ledger of a device that joins the account anew without importing (the account has no data, or so the server
 * says): all it holds counts as older than anything the account's devices hold, and nothing as removed by it. Its
 * package can so add parts to the other devices, never replace or remove one of theirs.
 */
export function joiningLedger(items: Map<string, unknown>): Ledger {
    return { items: Object.fromEntries([...items].map(([key, value]) => [key, [hashOf(contentOf(key, value)), BEFORE_THE_ACCOUNT]])), deleted: {} }
}

export function ledgerStamps(ledger: Ledger): Stamps {
    return { changed: Object.fromEntries(Object.entries(ledger.items).map(([key, known]) => [key, known[1]])), deleted: { ...ledger.deleted } }
}

/** Whether a part may hold a password, key or token: the device keeps its ledger entry in the secured storage (sync.ts) */
export function mayHoldSecret(key: string, value?: unknown): boolean {
    if (key.startsWith(SECRET_PART)) return true
    if (key.startsWith("t/")) return tableOf(key) in SECRET_TABLES
    if (!key.startsWith(PREFERENCE_PART) || typeof value !== "string") return false
    const name = key.slice(PREFERENCE_PART.length)
    if (!(name in preferencesWithoutSecrets({ [name]: value }))) return true
    try {
        const parsed: unknown = JSON.parse(value)
        return JSON.stringify(withoutSecrets(parsed)) !== JSON.stringify(parsed)
    }
    catch {
        return false
    }
}

export type MergedPackage = {
    pkg: SyncPackage
    /** The device holds something the account's package does not (a part, a newer change, a removal): worth an upload */
    ahead: boolean
}

/**
 * The device's package and the account's as one: per part the newer change; a removal counts like a change. A part the
 * account's package does not know (no part, no removal) always stays: a package can come from a device that never held
 * the account's data, and it removes nothing it never saw.
 * On a tie the device's part stays (so against a package without times it does, as before the times were kept) and
 * counts as the newer one from then on, so every device settles on the same part.
 * A secret is never removed from a device by another device's removal, and the device that removed it does not take it
 * back either: each keeps its own state of it, and neither sends it to the other again.
 */
export function mergePackages(local: SyncPackage, remote: SyncPackage): MergedPackage {
    const mine = packageItems(local)
    const theirs = packageItems(remote)
    const myStamps = stampsOf(local, mine)
    const theirStamps = stampsOf(remote, theirs)
    const items = new Map<string, unknown>()
    const stamps: Stamps = { changed: {}, deleted: {} }
    let ahead = false
    const keep = (key: string, value: unknown, time: number) => {
        items.set(key, value)
        stamps.changed[key] = time
    }
    /** The time of a part or removal of the device that stays against the account's */
    const won = (myTime: number, theirTime: number | undefined) => theirTime !== undefined && theirTime >= myTime ? theirTime + 1 : myTime
    for (const key of new Set([...mine.keys(), ...theirs.keys(), ...Object.keys(myStamps.deleted), ...Object.keys(theirStamps.deleted)])) {
        const here = mine.has(key)
        const there = theirs.has(key)
        const secret = key.startsWith(SECRET_PART)
        const myTime = here ? myStamps.changed[key]! : myStamps.deleted[key]
        const theirTime = there ? theirStamps.changed[key]! : theirStamps.deleted[key]
        if (here && there) {
            const [a, b] = [mine.get(key), theirs.get(key)]
            if (contentOf(key, a) === contentOf(key, b)) keep(key, a, Math.max(myTime!, theirTime!))
            else if (theirTime! > myTime!) keep(key, withOwnNumber(key, b, a), theirTime!)
            else {
                keep(key, withSecretsFilled(key, a, b), won(myTime!, theirTime))
                ahead = true
            }
        }
        else if (here) {
            if (theirTime !== undefined && theirTime > myTime!) {
                // removed elsewhere later: gone here too, except a secret, which stays here and is not sent back
                if (secret) keep(key, mine.get(key), myTime!)
                else stamps.deleted[key] = theirTime
            }
            else {
                keep(key, mine.get(key), won(myTime!, theirTime))
                ahead = true
            }
        }
        else if (there) {
            if (myTime !== undefined && myTime >= theirTime!) {
                stamps.deleted[key] = won(myTime, theirTime)
                if (!secret) ahead = true
            }
            else keep(key, withOwnNumber(key, theirs.get(key), undefined), theirTime!)
        }
        else {
            stamps.deleted[key] = Math.max(myTime ?? 0, theirTime ?? 0)
            if (theirTime === undefined && !secret) ahead = true
        }
    }
    return { pkg: packageFrom(local, items, stamps), ahead }
}

/** Another device's row for this device: with the number this device's own row has, or none (the database gives one) */
function withOwnNumber(key: string, row: unknown, mine: unknown): unknown {
    const own = key.startsWith("t/") ? OWN_NUMBER[tableOf(key)] : undefined
    if (!own || !isRecord(row)) return row
    const { [own]: _theirs, ...content } = row
    return isRecord(mine) && mine[own] !== undefined ? { ...content, [own]: mine[own] } : content
}

/** The device's row that won, with the passwords and keys only the other device's row has */
function withSecretsFilled(key: string, mine: unknown, theirs: unknown): unknown {
    const column = key.startsWith("t/") ? (SECRET_TABLES as Record<string, { column: string } | undefined>)[tableOf(key)]?.column : undefined
    if (!column || !isRecord(mine) || !isRecord(theirs)) return mine
    return { ...mine, [column]: fillSecrets(mine[column], theirs[column]) }
}

/** The columns `restoreBackup` strips of their secrets, as the package has them */
async function applySecretColumns(database: CoreDatabase, pkg: SyncPackage): Promise<void> {
    for (const name of Object.keys(SECRET_TABLES) as SecretTable[]) {
        const { table, key, column } = SECRET_TABLES[name]
        const keyColumn = (table as unknown as Record<string, Parameters<typeof eq>[0]>)[key]!
        for (const row of pkg.tables[name] ?? []) {
            const id = row[key]
            if (typeof id !== "string") continue
            const [current] = await inOrder(database, () => database.select().from(table).where(eq(keyColumn, id))) as Json[]
            if (!current || JSON.stringify(row[column]) === JSON.stringify(current[column])) continue
            await inOrder(database, () => database.update(table).set({ [column]: row[column] } as never).where(eq(keyColumn, id)))
        }
    }
}

export type AppliedPackage = {
    /** The preferences the app writes into its own store (only the ones that differ from what it has) */
    preferences: Record<string, string>
    /** Preferences the package knows as removed: the app takes them out of its store */
    removedPreferences: string[]
    /** The change times of what the device holds now, for its ledger (settledLedger) */
    stamps: Stamps
    /** After a merge: the device holds something the package does not (mergePackages); false after a replace */
    ahead: boolean
}

/**
 * Puts a package into this device. "replace": the package's state wins (only the import the user asked for on a new
 * device); "merge": part by part the newer change wins (mergePackages; `current.stamps` are the device's own change
 * times). A secret the package does not hold is never removed from the device.
 * `beforeWriting` gets the change times of what the device will hold, before anything is written (sync.ts keeps them
 * until its ledger has them).
 */
export async function applyPackage(environment: PackageEnvironment, pkg: SyncPackage, mode: RestoreMode, current: { preferences: Record<string, string>, isDeviceKey: (key: string) => boolean, stamps?: Stamps }, beforeWriting?: (stamps: Stamps) => Promise<void>): Promise<AppliedPackage> {
    if (!environment.keepSecret) throw new Error("the secured storage cannot be written here")
    let wanted = withoutDeviceTables(pkg)
    let ahead = false
    if (mode === "merge") {
        const mine = await makePackage(environment, { appVersion: pkg.appVersion, preferences: current.preferences, isDeviceKey: current.isDeviceKey })
        const merged = mergePackages({ ...mine, stamps: current.stamps }, wanted)
        wanted = merged.pkg
        ahead = merged.ahead
    }
    const stamps = stampsOf(wanted)
    await beforeWriting?.(stamps)
    await restoreBackup(environment, wanted, "replace", { preferences: current.preferences })
    await applySecretColumns(await environment.database(), wanted)
    for (const [name, value] of Object.entries(wanted.secrets)) {
        if (await environment.secret(name) !== value) await environment.keepSecret(name, value)
    }
    const theirs = packagePreferences(wanted.preferences, current.isDeviceKey)
    const removedPreferences = Object.keys(stamps.deleted)
        .filter(key => key.startsWith(PREFERENCE_PART)).map(key => key.slice(PREFERENCE_PART.length))
        .filter(key => key in current.preferences && !current.isDeviceKey(key) && !isAccountKey(key))
    return {
        preferences: Object.fromEntries(Object.entries(theirs).filter(([key, value]) => current.preferences[key] !== value)),
        removedPreferences,
        stamps,
        ahead,
    }
}
