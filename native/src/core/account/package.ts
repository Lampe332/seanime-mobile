// geschrieben nach: Plan „Account + Sync“ (Abschnitte 3, 5, 6.5, 6.6), core/backup/backup.ts (makeBackup, readBackup, restoreBackup, withoutSecrets, preferencesWithoutSecrets) und lib/app-backup-keys.ts (isDeviceKey, von der App hereingereicht)

import { eq } from "drizzle-orm"
import { type BackupFile, type BackupTable, type RestoreMode, makeBackup, readBackup, restoreBackup, withoutSecrets } from "../backup/backup"
import { type CoreDatabase, inOrder } from "../database/database"
import { extensionUserConfigs, settingsSections, torrentKept, watchPositions } from "../database/schema"
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

export type SyncPackage = BackupFile & {
    /** Values of the secured storage (SYNCED_SECRETS), by name */
    secrets: Record<string, string>
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
    return { ...withoutDeviceTables(file), preferences: packagePreferences(file.preferences, () => false), secrets }
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

async function applySecretColumns(database: CoreDatabase, pkg: SyncPackage, mode: RestoreMode): Promise<void> {
    for (const name of Object.keys(SECRET_TABLES) as SecretTable[]) {
        const { table, key, column } = SECRET_TABLES[name]
        const keyColumn = (table as unknown as Record<string, Parameters<typeof eq>[0]>)[key]!
        for (const row of pkg.tables[name] ?? []) {
            const id = row[key]
            if (typeof id !== "string") continue
            const [current] = await inOrder(database, () => database.select().from(table).where(eq(keyColumn, id))) as Json[]
            if (!current) continue
            const value = mode === "replace" ? row[column] : fillSecrets(current[column], row[column])
            if (JSON.stringify(value) === JSON.stringify(current[column])) continue
            await inOrder(database, () => database.update(table).set({ [column]: value } as never).where(eq(keyColumn, id)))
        }
    }
}

/** In a merge the newer watch position wins (changedAt), the device's or the package's */
async function newerWatchPositions(database: CoreDatabase, pkg: SyncPackage): Promise<void> {
    for (const row of pkg.tables.watchPositions ?? []) {
        const mediaId = row.mediaId
        if (typeof mediaId !== "number" || typeof row.changedAt !== "number") continue
        const [current] = await inOrder(database, () => database.select().from(watchPositions).where(eq(watchPositions.mediaId, mediaId)))
        if (!current || current.changedAt >= row.changedAt) continue
        await inOrder(database, () => database.update(watchPositions).set(row as never).where(eq(watchPositions.mediaId, mediaId)))
    }
}

/**
 * Puts a package into this device. "replace": the package's state wins (import on a new device, or newer data while
 * this device changed nothing); "merge": the device's rows stay and the package adds what is missing, watch positions go
 * by time, secrets the device lacks are filled in. Returns the preferences the app writes into its own store.
 * A secret the package does not hold is never removed from the device.
 */
export async function applyPackage(environment: PackageEnvironment, pkg: SyncPackage, mode: RestoreMode, current: { preferences: Record<string, string>, isDeviceKey: (key: string) => boolean }): Promise<{ preferences: Record<string, string> }> {
    if (!environment.keepSecret) throw new Error("the secured storage cannot be written here")
    pkg = withoutDeviceTables(pkg)
    await restoreBackup(environment, pkg, mode, { preferences: current.preferences })
    const database = await environment.database()
    await applySecretColumns(database, pkg, mode)
    if (mode === "merge") await newerWatchPositions(database, pkg)
    for (const [name, value] of Object.entries(pkg.secrets)) {
        if (mode === "merge" && await environment.secret(name)) continue
        await environment.keepSecret(name, value)
    }
    const preferences = mode === "replace"
        ? pkg.preferences
        : Object.fromEntries(Object.entries(pkg.preferences).filter(([key]) => !(key in current.preferences)))
    return { preferences: packagePreferences(preferences, current.isDeviceKey) }
}
