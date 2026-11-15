// geschrieben nach: Auftrag „Sichern + Wiederherstellen“ (15.11.2026), dem Schema des Kerns (database/schema.ts), den Ablagen der Erweiterungen (extensions/manage/installed.ts) und der Listen (anilist/store.ts, anilist/changes.ts); kein Server-Quelltext

import { eq } from "drizzle-orm"
import type { SQLiteTable } from "drizzle-orm/sqlite-core"
import { LOCAL_LISTS_QUESTION, withoutAnilistAccount } from "../anilist/changes"
import { type ListCollection, type ListKind, keepAnswer, keepCollection, storedCollection } from "../anilist/store"
import { type CoreDatabase, inOrder } from "../database/database"
import {
    anilistAnswers,
    anilistChanges,
    appearance,
    extensionSandboxSettings,
    extensionUserConfigs,
    homeItems,
    mangaMappings,
    mangaPreferences,
    metadataParents,
    offlineSettings,
    onlinestreamMappings,
    playlists,
    settingsSections,
    silencedAnime,
    torrentKept,
    watchPositions,
} from "../database/schema"
import { CoreError } from "../errors"
import { disabledIds, forgetRead, writeDisabled } from "../extensions/manage/installed"
import type { CoreEnvironment } from "../registry"

/*
 * One file with what the user made in the app, for a new phone or a new install: the settings, the look, the home
 * screen, where each anime was stopped, the playlists, the installed extensions with what was set for them, the manga
 * choices, the changes still waiting for AniList, the local account's lists and the app's own preferences (handed in by
 * the app, the core does not know its store).
 *
 * Never in the file: the AniList token, the debrid key and the Nakama password (they live in the device's secured
 * storage, not here), any field named like a password, key or token, and nothing that is only a copy of something
 * elsewhere (AniList's answers, episode metadata, the scanned files, the downloads and their files).
 */

type Json = Record<string, unknown>

export const BACKUP_FORMAT = "seanime-mobile-backup"
export const BACKUP_FORMAT_VERSION = 1

/** The core's tables in the file, by the name they have there */
const TABLES = {
    settings: settingsSections,
    appearance,
    homeItems,
    watchPositions,
    waitingChanges: anilistChanges,
    extensionConfigs: extensionUserConfigs,
    sandboxSettings: extensionSandboxSettings,
    onlinestreamMappings,
    mangaMappings,
    mangaPreferences,
    offlineSettings,
    silencedAnime,
    metadataParents,
    playlists,
    torrentKept,
} satisfies Record<string, SQLiteTable>

export type BackupTable = keyof typeof TABLES
const TABLE_NAMES = Object.keys(TABLES) as BackupTable[]

/** The column of a table that holds values a user typed, where a password or key could be among them */
const WITH_SECRETS: Partial<Record<BackupTable, string>> = { settings: "content", extensionConfigs: "values", torrentKept: "content" }

export type BackupFile = {
    format: typeof BACKUP_FORMAT
    formatVersion: number
    /** The app version that wrote it */
    appVersion: string
    createdAt: string
    tables: Partial<Record<BackupTable, Json[]>>
    /** The files of the extensions folder (`<id>.json`, with their code) and the ids switched off */
    extensions: { files: Record<string, string>, disabled: string[] }
    /** The local account's lists (no AniList account), or the ones kept for uploading to AniList; null: none */
    localLists: Partial<Record<ListKind, ListCollection>> | null
    /** The app's own preferences, key → stored text */
    preferences: Record<string, string>
}

export type BackupSummary = {
    appVersion: string
    createdAt: string
    extensions: number
    playlists: number
    watchPositions: number
    settings: number
    homeItems: number
    waitingChanges: number
    localListEntries: number
    mangaPreferences: number
    preferences: number
}

/** "Replace": the file's state wins; "merge": what is on the device stays, only what is missing is added */
export type RestoreMode = "replace" | "merge"

/* ---- Secrets ---- */

/** Names of fields that hold a secret (hostPassword, vcTranslateApiKey, a token, …) */
const SECRET_NAME = /password|passwd|passcode|passphrase|token|secret|api[-_]?key|cookie|credential/i
/** A text that looks like a signed token (JWT, as AniList's) */
const TOKEN_TEXT = /^eyJ[\w-]+\.[\w-]+\./

export function isSecretName(name: string): boolean {
    return SECRET_NAME.test(name)
}

/** The value without any field named like a secret and without texts that look like a token, at any depth */
export function withoutSecrets(value: unknown): unknown {
    if (Array.isArray(value)) return value.filter(item => !(typeof item === "string" && TOKEN_TEXT.test(item))).map(withoutSecrets)
    if (value === null || typeof value !== "object") return value
    const result: Json = {}
    for (const [key, field] of Object.entries(value)) {
        if (isSecretName(key) || (typeof field === "string" && TOKEN_TEXT.test(field))) continue
        result[key] = withoutSecrets(field)
    }
    return result
}

/** `into` with the secret fields of `from` put back (a restored setting keeps the password the device has) */
function withSecretsOf(from: unknown, into: unknown): unknown {
    if (from === null || typeof from !== "object" || Array.isArray(from) || into === null || typeof into !== "object" || Array.isArray(into)) return into
    const result: Json = { ...(into as Json) }
    for (const [key, field] of Object.entries(from)) {
        if (isSecretName(key)) result[key] = field
        else if (key in result) result[key] = withSecretsOf(field, result[key])
    }
    return result
}

/** The app's preferences without secrets: a key named like one goes, a JSON value loses its secret fields */
export function preferencesWithoutSecrets(preferences: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {}
    for (const [key, text] of Object.entries(preferences)) {
        if (typeof text !== "string" || isSecretName(key) || TOKEN_TEXT.test(text)) continue
        try {
            result[key] = JSON.stringify(withoutSecrets(JSON.parse(text)))
        }
        catch {
            result[key] = text
        }
    }
    return result
}

/* ---- Making the file ---- */

type Environment = Pick<CoreEnvironment, "database" | "secret" | "now" | "extensions">

const KINDS: ListKind[] = ["ANIME", "MANGA"]
/** A file of the extensions folder the backup takes and gives back: an extension's manifest, never a path */
const EXTENSION_FILE = /^[\w.-]+\.json$/

async function localLists(environment: Environment, database: CoreDatabase): Promise<BackupFile["localLists"]> {
    const local = await withoutAnilistAccount(environment)
    const lists: Partial<Record<ListKind, ListCollection>> = {}
    for (const kind of KINDS) {
        const collection = local ? await storedCollection(database, kind) : await keptLocalLists(database, kind)
        if (collection && entryCount(collection) > 0) lists[kind] = collection
    }
    return Object.keys(lists).length > 0 ? lists : null
}

async function keptLocalLists(database: CoreDatabase, kind: ListKind): Promise<ListCollection | null> {
    const rows = await inOrder(database, () => database.select({ answer: anilistAnswers.answer }).from(anilistAnswers)
        .where(eq(anilistAnswers.question, LOCAL_LISTS_QUESTION(kind))))
    return (rows[0]?.answer as ListCollection | undefined) ?? null
}

function entryCount(collection: ListCollection | null | undefined): number {
    return (collection?.MediaListCollection?.lists ?? []).reduce((sum, list) => sum + (list.entries?.length ?? 0), 0)
}

/** Everything the user made, as one file. `preferences` are the app's own (its key-value store). */
export async function makeBackup(environment: Environment, app: { appVersion: string, preferences: Record<string, string> }): Promise<BackupFile> {
    const database = await environment.database()
    const tables: BackupFile["tables"] = {}
    for (const name of TABLE_NAMES) {
        const rows = await inOrder(database, () => database.select().from(TABLES[name] as SQLiteTable)) as Json[]
        const column = WITH_SECRETS[name]
        tables[name] = column ? rows.map(row => ({ ...row, [column]: withoutSecrets(row[column]) })) : rows
    }
    const extensions: BackupFile["extensions"] = { files: {}, disabled: [] }
    if (environment.extensions) {
        const place = await environment.extensions()
        for (const name of (await place.folder.names()).filter(name => EXTENSION_FILE.test(name)).sort()) {
            const text = await place.folder.read(name)
            if (text !== null) extensions.files[name] = text
        }
        extensions.disabled = [...await disabledIds(place)].sort()
    }
    return {
        format: BACKUP_FORMAT,
        formatVersion: BACKUP_FORMAT_VERSION,
        appVersion: app.appVersion,
        createdAt: new Date(environment.now()).toISOString(),
        tables,
        extensions,
        localLists: await localLists(environment, database),
        preferences: preferencesWithoutSecrets(app.preferences),
    }
}

/* ---- Reading and checking a file ---- */

function isRecord(value: unknown): value is Json {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** The file as text, checked: format, version, the shape of every part. Throws a CoreError the user can read. */
export function readBackup(text: string): BackupFile {
    let parsed: unknown
    try {
        parsed = JSON.parse(text)
    }
    catch {
        throw new CoreError("this file is not a backup of the app (not JSON)", 400)
    }
    if (!isRecord(parsed) || parsed.format !== BACKUP_FORMAT) throw new CoreError("this file is not a backup of the app", 400)
    const version = parsed.formatVersion
    if (typeof version !== "number" || !Number.isInteger(version) || version < 1) throw new CoreError("the backup has no valid format version", 400)
    if (version > BACKUP_FORMAT_VERSION) throw new CoreError(`the backup was made by a newer app version (${String(parsed.appVersion)}); update the app first`, 400)

    const tables: BackupFile["tables"] = {}
    if (parsed.tables !== undefined && !isRecord(parsed.tables)) throw new CoreError("the backup's tables are broken", 400)
    for (const name of TABLE_NAMES) {
        const rows = (parsed.tables as Json | undefined)?.[name]
        if (rows === undefined) continue
        if (!Array.isArray(rows) || !rows.every(isRecord)) throw new CoreError(`the backup's part "${name}" is broken`, 400)
        tables[name] = rows
    }
    const extensions = isRecord(parsed.extensions) ? parsed.extensions : {}
    const files = isRecord(extensions.files) ? extensions.files : {}
    for (const [name, content] of Object.entries(files)) {
        if (!EXTENSION_FILE.test(name) || typeof content !== "string") throw new CoreError("the backup's extensions are broken", 400)
    }
    const disabled = Array.isArray(extensions.disabled) ? extensions.disabled.filter((id): id is string => typeof id === "string") : []
    const lists: Partial<Record<ListKind, ListCollection>> = {}
    if (isRecord(parsed.localLists)) {
        for (const kind of KINDS) {
            const collection = parsed.localLists[kind]
            if (isRecord(collection) && isRecord(collection.MediaListCollection) && Array.isArray(collection.MediaListCollection.lists)) lists[kind] = collection as ListCollection
        }
    }
    const preferences: Record<string, string> = {}
    if (isRecord(parsed.preferences)) {
        for (const [key, value] of Object.entries(parsed.preferences)) if (typeof value === "string") preferences[key] = value
    }
    return {
        format: BACKUP_FORMAT,
        formatVersion: version,
        appVersion: typeof parsed.appVersion === "string" ? parsed.appVersion : "",
        createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : "",
        tables,
        extensions: { files: files as Record<string, string>, disabled },
        localLists: Object.keys(lists).length > 0 ? lists : null,
        preferences,
    }
}

/** The name a backup is saved under: the day of the device's own calendar, e.g. seanime-mobile-backup-2026-11-15.json */
export function backupFileName(date: Date): string {
    const two = (part: number) => String(part).padStart(2, "0")
    return `seanime-mobile-backup-${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}.json`
}

/** What the file holds, for the question before restoring */
export function backupSummary(file: BackupFile): BackupSummary {
    const count = (name: BackupTable) => file.tables[name]?.length ?? 0
    return {
        appVersion: file.appVersion,
        createdAt: file.createdAt,
        extensions: Object.keys(file.extensions.files).length,
        playlists: count("playlists"),
        watchPositions: count("watchPositions"),
        settings: count("settings"),
        homeItems: count("homeItems"),
        waitingChanges: count("waitingChanges"),
        localListEntries: KINDS.reduce((sum, kind) => sum + entryCount(file.localLists?.[kind]), 0),
        mangaPreferences: count("mangaPreferences"),
        preferences: Object.keys(file.preferences).length,
    }
}

/* ---- Restoring ---- */

function chunks<T>(items: T[], size = 50): T[][] {
    const result: T[][] = []
    for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size))
    return result
}

/** The rows a table gets from the file: with the device's secrets put back; in a merge only what does not clash */
function rowsFor(name: BackupTable, rows: Json[], current: Json[], mode: RestoreMode): Json[] {
    const column = WITH_SECRETS[name]
    const key = name === "settings" ? "section" : name === "torrentKept" ? "key" : name === "extensionConfigs" ? "id" : null
    const now = new Map(key ? current.map(row => [row[key], row]) : [])
    const withSecrets = column && key ? rows.map(row => ({ ...row, [column]: withSecretsOf(now.get(row[key])?.[column], row[column]) })) : rows
    if (mode === "replace") return withSecrets
    // a merge: playlists by name and waiting changes by title get numbers of this database; the home screen is taken only when empty
    if (name === "homeItems") return current.length === 0 ? withSecrets : []
    if (name === "playlists") {
        const names = new Set(current.map(row => row.name))
        return withSecrets.filter(row => !names.has(row.name)).map(({ dbId: _dbId, ...row }) => row)
    }
    if (name === "waitingChanges") return withSecrets.map(({ id: _id, ...row }) => row)
    return withSecrets
}

/**
 * Puts a file's state into the core. "replace": every part the file has replaces the device's; "merge": rows the
 * device already has stay, missing ones are added. Secrets the device has stay in both. Returns the preferences the app
 * writes into its own store (replace: all of the file's; merge: the ones the app does not have yet).
 */
export async function restoreBackup(environment: Environment, file: BackupFile, mode: RestoreMode, current: { preferences: Record<string, string> } = { preferences: {} }): Promise<{ preferences: Record<string, string> }> {
    const database = await environment.database()
    await inOrder(database, () => database.transaction(async transaction => {
        for (const name of TABLE_NAMES) {
            const rows = file.tables[name]
            if (!rows) continue
            const table = TABLES[name] as SQLiteTable
            const present = await transaction.select().from(table) as Json[]
            const wanted = rowsFor(name, rows, present, mode)
            if (mode === "replace") await transaction.delete(table)
            for (const part of chunks(wanted)) {
                if (mode === "replace") await transaction.insert(table).values(part as never)
                else await transaction.insert(table).values(part as never).onConflictDoNothing()
            }
        }
    }))

    if (file.localLists) {
        const local = await withoutAnilistAccount(environment)
        for (const kind of KINDS) {
            const collection = file.localLists[kind]
            if (!collection) continue
            if (local) {
                if (mode === "replace" || entryCount(await storedCollection(database, kind)) === 0) await keepCollection(database, kind, collection, environment.now())
            }
            // signed in to AniList: kept aside, for "Upload local lists" (anilist/changes.ts)
            else if (mode === "replace" || !(await keptLocalLists(database, kind))) await keepAnswer(database, LOCAL_LISTS_QUESTION(kind), collection, environment.now())
        }
    }

    if (environment.extensions && (Object.keys(file.extensions.files).length > 0 || mode === "replace")) {
        const place = await environment.extensions()
        const installed = (await place.folder.names()).filter(name => EXTENSION_FILE.test(name))
        const now = environment.now()
        if (mode === "replace") {
            for (const name of installed) if (!(name in file.extensions.files)) await place.folder.remove(name)
        }
        const added: string[] = []
        for (const [name, text] of Object.entries(file.extensions.files)) {
            if (mode === "merge" && installed.includes(name)) continue
            await place.folder.write(name, text)
            added.push(name.replace(/\.json$/, ""))
        }
        const off = new Set(file.extensions.disabled)
        const before = await disabledIds(place)
        const ids = mode === "replace" ? new Set([...before, ...off]) : new Set(added)
        for (const id of ids) {
            const disabled = off.has(id) && (mode === "replace" || added.includes(id))
            if (disabled !== before.has(id)) await writeDisabled(place, id, disabled, now)
        }
        forgetRead(place)
    }

    const preferences = mode === "replace"
        ? { ...file.preferences }
        : Object.fromEntries(Object.entries(file.preferences).filter(([key]) => !(key in current.preferences)))
    // a hand-edited file brings no secret into the store either
    return { preferences: preferencesWithoutSecrets(preferences) }
}
