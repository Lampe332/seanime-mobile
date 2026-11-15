// geschrieben nach: DB-Kopien vom 13.11.2026 (a-scratch-frisch, b-scratch-nach-aufzeichnung, c-test bereinigt: Tabellen `accounts`, `settings`, `themes` mit Spalten und Wert-Arten, Datei-Cache `watch_history`), den Aufzeichnungen api-schreibend (STATUS.GetStatus: welches Feld zu welcher Spalte gehört) und docs/EIGENER-KERN.md §4c; kein Server-Quelltext

import { type CoreDatabase, inOrder } from "../database/database"
import { account, appearance, homeItems, moveParts, settingsSections, watchPositions } from "../database/schema"
import { APPEARANCE_SHAPE, type Fields, type FieldValue, SETTINGS_SECTIONS, SETTINGS_SHAPE, type SettingsSection } from "../settings/shape"

/*
 * The move: what the server has stored in its own files is read once and written into the core's database, part by
 * part. The server's files are only read. Rules:
 *
 * - Once per database: any row in `move_parts` means the move has run. It can be run again on purpose.
 * - A part the core already has data of its own for is left alone ("kept").
 * - Every part on its own: one that fails does not stop the others, and the result says what was missing.
 * - What the server stored and the core has no place for yet is taken along unchanged (`move_parts.leftovers`).
 * - The account's token goes to the device's secured storage and nowhere else: not into the database, not into a
 *   result, not into a log line. Results carry counts and names of fields, never values.
 */

/** The tables of the server's database this move reads */
export type OldTable = "accounts" | "settings" | "themes" | "custom_source_identifiers" | "onlinestream_mappings" | "manga_mappings" | "playlists"

/** The server's files, read only. The app hands this in (device: a copy in memory; tests: a database built there). */
export type OldData = {
    /** Every row of a table, column name → value as SQLite gives it. null: the server's database is not there. */
    rows: (table: OldTable) => Promise<Record<string, unknown>[] | null>
    /** The text of a file of the server's file cache ("watch_history"), null when there is none */
    cacheFile: (bucket: string) => Promise<string | null>
}

/** The device's secured storage (Android Keystore). The core does not know it; the app hands it in. */
export type SecretStore = {
    read: (name: string) => Promise<string | null>
    write: (name: string, value: string) => Promise<void>
    /** Removes a value (signing out, phase 5a-3); left out: not available */
    forget?: (name: string) => Promise<void>
}

/** Under this name the AniList token lies in the secured storage */
export const ACCOUNT_TOKEN_SECRET = "seanime-core.account-token"

export const MOVE_PARTS = ["account", "settings", "appearance", "homeItems", "watchHistory"] as const
export type MovePart = (typeof MOVE_PARTS)[number]

/**
 * - `moved`: taken over, `count` pieces
 * - `empty`: the server had nothing for this part
 * - `kept`: the core has data of its own for this part; nothing was written
 * - `missing`: the file the part is read from is not there
 * - `failed`: the file is there but could not be read; `reason` says why
 */
export type MoveOutcome = "moved" | "empty" | "kept" | "missing" | "failed"

export type MoveResult = {
    part: MovePart
    outcome: MoveOutcome
    /** Rows written: sections of the settings, home items, watch positions; 1 for account and look */
    count: number
    /** Names of fields the server had and the core has no place for; their values lie in `move_parts.leftovers` */
    extraFields: string[]
    /** Names of fields whose value was not of the kind the core stores; the field got its empty value, the raw value lies in the leftovers */
    unfitFields: string[]
    reason?: string
}

export type MoveEnvironment = {
    database: CoreDatabase
    old: OldData
    secrets: SecretStore
    now: () => number
}

/** A problem whose text is safe to show: it never carries a value read from the server's files */
class MoveProblem extends Error {}

type Done = Omit<MoveResult, "part"> & { leftovers?: Record<string, unknown> }
type Writer = Parameters<Parameters<CoreDatabase["transaction"]>[0]>[0]

const done = (outcome: MoveOutcome, count = 0, more: Partial<Done> = {}): Done => ({ outcome, count, extraFields: [], unfitFields: [], ...more })

// ---- reading the server's values ----

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function decodeUtf8(bytes: Uint8Array): string {
    let text = ""
    for (let i = 0; i < bytes.length;) {
        const first = bytes[i++]
        const next = () => bytes[i++] & 0x3f
        if (first < 0x80) text += String.fromCharCode(first)
        else if (first < 0xe0) text += String.fromCodePoint(((first & 0x1f) << 6) | next())
        else if (first < 0xf0) text += String.fromCodePoint(((first & 0x0f) << 12) | (next() << 6) | next())
        else text += String.fromCodePoint(((first & 0x07) << 18) | (next() << 12) | (next() << 6) | next())
    }
    return text
}

/** A stored value without bytes: a blob (the server stores JSON that way) becomes its text */
function plain(value: unknown): unknown {
    return ArrayBuffer.isView(value) ? decodeUtf8(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) : value
}

function textOf(value: unknown): string | null {
    const read = plain(value)
    if (read === null || read === undefined) return null
    return typeof read === "string" ? read : String(read)
}

/** JSON kept as text or blob; `undefined` when it is no JSON */
function jsonOf(value: unknown): unknown {
    const text = textOf(value)
    if (text === null) return null
    try {
        return JSON.parse(text)
    }
    catch {
        return undefined
    }
}

/**
 * The server writes times as "2026-11-13 10:28:00.123456789+00:00" (database) and "2026-11-12T19:00:32.180207533Z"
 * (file cache). The core keeps milliseconds; what is finer than that is dropped. null: not a time.
 */
export function timeOf(value: unknown): number | null {
    const match = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d):(\d\d)(?:\.(\d+))?\s*(Z|[+-]\d\d:\d\d)?$/.exec(textOf(value)?.trim() ?? "")
    if (!match) return null
    const [, year, month, day, hour, minute, second, fraction = "", zone = "Z"] = match
    const utc = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second, +fraction.padEnd(3, "0").slice(0, 3))
    if (zone === "Z") return utc
    const offset = (+zone.slice(1, 3) * 60 + +zone.slice(4, 6)) * 60_000
    return zone[0] === "+" ? utc - offset : utc + offset
}

/** The column of a field: libraryPath → library_path, openWebURLOnStart → open_web_url_on_start, …AniList… → …anilist… */
export function columnOf(field: string): string {
    return field.replace(/AniList/g, "Anilist").replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2").replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()
}

/** Two sections carry their name in front of every column, and one field has a column name of its own */
const SECTION_PREFIX: Partial<Record<SettingsSection, string>> = { autoDownloader: "auto_downloader_", nakama: "nakama_" }
const OWN_COLUMN: Record<string, string> = { "mediaPlayer.host": "player_host" }

/** Which column of the table `settings` holds a field of a section */
export function settingsColumnOf(section: SettingsSection, field: string): string {
    return OWN_COLUMN[`${section}.${field}`] ?? (SECTION_PREFIX[section] ?? "") + columnOf(field)
}

/** Columns that are the row itself, not a setting: the core has its own id and keeps its own times */
const ROW_COLUMNS = ["id", "created_at", "updated_at"]

const UNFIT = Symbol("unfit")

/** The stored value as the kind the field has in the core. Yes/no is stored as 0/1, a list as JSON, nothing as NULL. */
function fieldValue(sample: FieldValue, stored: unknown): FieldValue | typeof UNFIT {
    const value = plain(stored)
    if (Array.isArray(sample)) {
        if (value === null || value === undefined) return []
        const list = jsonOf(value)
        if (list === null) return []
        return Array.isArray(list) && list.every(entry => typeof entry === "string" || typeof entry === "number") ? list : UNFIT
    }
    if (typeof sample === "boolean") {
        if (value === null || value === undefined) return false
        if (value === 0 || value === 1) return value === 1
        return typeof value === "boolean" ? value : UNFIT
    }
    if (typeof sample === "number") {
        if (value === null || value === undefined) return 0
        return typeof value === "number" && Number.isFinite(value) ? value : UNFIT
    }
    if (value === null || value === undefined) return ""
    return typeof value === "string" ? value : UNFIT
}

function emptyOf(sample: FieldValue): FieldValue {
    return Array.isArray(sample) ? [] : typeof sample === "string" ? "" : typeof sample === "number" ? 0 : false
}

type Taken = { fields: Fields, used: string[], unfit: Record<string, unknown> }

/** The fields of a shape out of a row; `column` names the column of each */
function take(shape: Fields, row: Record<string, unknown>, column: (field: string) => string): Taken {
    const taken: Taken = { fields: {}, used: [], unfit: {} }
    for (const [field, sample] of Object.entries(shape)) {
        const name = column(field)
        taken.used.push(name)
        const value = fieldValue(sample, row[name])
        if (value === UNFIT) taken.unfit[name] = plain(row[name])
        taken.fields[field] = value === UNFIT ? emptyOf(sample) : value
    }
    return taken
}

/** What of a row no field took: taken along as it is (NULL columns too, so nothing has to be guessed later) */
function rest(row: Record<string, unknown>, used: string[]): Record<string, unknown> {
    return Object.fromEntries(Object.entries(row).filter(([name]) => !used.includes(name)).map(([name, value]) => [name, plain(value)]))
}

/** The one row of a table that has one row per app (the lowest id, should there ever be more) */
async function oneRow(old: OldData, table: OldTable): Promise<Record<string, unknown> | null | undefined> {
    let rows: Record<string, unknown>[] | null
    try {
        rows = await old.rows(table)
    }
    catch {
        throw new MoveProblem(`table ${table} could not be read`)
    }
    if (rows === null) return null
    return [...rows].sort((a, b) => Number(a.id) - Number(b.id))[0]
}

const hasRows = async (writer: Writer, table: typeof account | typeof appearance | typeof homeItems | typeof settingsSections | typeof watchPositions) =>
    (await writer.select().from(table).limit(1)).length > 0

/** Reads first, then writes in one transaction; nothing is written when the core has data of its own. */
function write(environment: MoveEnvironment, own: (writer: Writer) => Promise<boolean>, work: (writer: Writer) => Promise<Done>): Promise<Done> {
    return inOrder(environment.database, () => environment.database.transaction(async writer => (await own(writer)) ? done("kept") : work(writer)))
}

// ---- the parts ----

async function moveAccount(environment: MoveEnvironment): Promise<Done> {
    const row = await oneRow(environment.old, "accounts")
    if (row === null) return done("missing")
    if (row === undefined) return done("empty")
    const token = textOf(row.token) ?? ""
    const username = textOf(row.username) ?? ""
    if (!token && !username) return done("empty")
    // a column this code does not know may be a secret as well: by its name it goes to the secured storage, too
    const others = rest(row, ["id", "created_at", "updated_at", "username", "token", "viewer"])
    const secret = Object.keys(others).filter(name => /token|secret|password|key/i.test(name))
    const leftovers = Object.fromEntries(Object.entries(others).filter(([name]) => !secret.includes(name)))
    const now = environment.now()
    return write(environment, writer => hasRows(writer, account), async writer => {
        await writer.insert(account).values({
            id: 1,
            username,
            viewer: textOf(row.viewer),
            createdAt: timeOf(row.created_at) ?? now,
            changedAt: timeOf(row.updated_at) ?? now,
        })
        // last, so a failure here takes the row back with it
        if (token) await environment.secrets.write(ACCOUNT_TOKEN_SECRET, token)
        for (const name of secret) {
            const value = textOf(others[name])
            if (value) await environment.secrets.write(`seanime-core.account.${name}`, value)
        }
        return done("moved", 1, { extraFields: Object.keys(others), leftovers })
    })
}

async function moveSettings(environment: MoveEnvironment): Promise<Done> {
    const row = await oneRow(environment.old, "settings")
    if (row === null) return done("missing")
    if (row === undefined) return done("empty")
    const used = [...ROW_COLUMNS]
    const unfit: Record<string, unknown> = {}
    const sections = SETTINGS_SECTIONS.map(section => {
        const taken = take(SETTINGS_SHAPE[section], row, field => settingsColumnOf(section, field))
        used.push(...taken.used)
        Object.assign(unfit, taken.unfit)
        return { section, content: taken.fields, changedAt: timeOf(row.updated_at) ?? environment.now() }
    })
    const extra = rest(row, used)
    return write(environment, writer => hasRows(writer, settingsSections), async writer => {
        await writer.insert(settingsSections).values(sections)
        return done("moved", sections.length, { extraFields: Object.keys(extra), unfitFields: Object.keys(unfit), leftovers: { ...extra, ...unfit } })
    })
}

/** The look has two columns that are lists; `home_items` is a part of its own */
const LOOK_LIST_COLUMNS = ["unpinned_menu_items", "home_items"]

async function moveAppearance(environment: MoveEnvironment): Promise<Done> {
    const row = await oneRow(environment.old, "themes")
    if (row === null) return done("missing")
    if (row === undefined) return done("empty")
    const taken = take(APPEARANCE_SHAPE, row, columnOf)
    const unpinned = jsonOf(row.unpinned_menu_items)
    const unpinnedFits = unpinned === null || (Array.isArray(unpinned) && unpinned.every(entry => typeof entry === "string"))
    if (!unpinnedFits) taken.unfit.unpinned_menu_items = plain(row.unpinned_menu_items)
    const extra = rest(row, [...ROW_COLUMNS, ...taken.used, ...LOOK_LIST_COLUMNS])
    const now = environment.now()
    return write(environment, writer => hasRows(writer, appearance), async writer => {
        await writer.insert(appearance).values({
            id: 1,
            content: { ...taken.fields, unpinnedMenuItems: unpinnedFits ? unpinned : null },
            createdAt: timeOf(row.created_at) ?? now,
            changedAt: timeOf(row.updated_at) ?? now,
        })
        return done("moved", 1, { extraFields: Object.keys(extra), unfitFields: Object.keys(taken.unfit), leftovers: { ...extra, ...taken.unfit } })
    })
}

async function moveHomeItems(environment: MoveEnvironment): Promise<Done> {
    const row = await oneRow(environment.old, "themes")
    if (row === null) return done("missing")
    if (row === undefined) return done("empty")
    const items = jsonOf(row.home_items)
    if (items === null) return done("empty")
    if (!Array.isArray(items)) throw new MoveProblem("themes.home_items is not a list")
    if (items.length === 0) return done("empty")
    const rows: (typeof homeItems.$inferInsert)[] = []
    const leftovers: Record<string, unknown> = {}
    const extraFields = new Set<string>()
    let unfit = 0
    items.forEach((item: unknown, index) => {
        const schemaVersion = isRecord(item) ? item.schemaVersion ?? 0 : 0
        if (!isRecord(item) || typeof item.id !== "string" || typeof item.type !== "string" || typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion)) {
            leftovers[`items[${index}]`] = item
            unfit++
            return
        }
        const { id, type, schemaVersion: _version, options, ...more } = item
        if (Object.keys(more).length > 0) {
            leftovers[`items[${index}]`] = more
            for (const name of Object.keys(more)) extraFields.add(name)
        }
        rows.push({ position: rows.length, itemId: id, kind: type, schemaVersion, options: options ?? null })
    })
    return write(environment, writer => hasRows(writer, homeItems), async writer => {
        if (rows.length > 0) await writer.insert(homeItems).values(rows)
        return done("moved", rows.length, { extraFields: [...extraFields], unfitFields: unfit > 0 ? ["items"] : [], leftovers })
    })
}

const WATCH_FIELDS = ["currentTime", "duration", "episodeNumber", "filepath", "kind", "mediaId", "timeAdded", "timeUpdated"]

async function moveWatchHistory(environment: MoveEnvironment): Promise<Done> {
    let text: string | null
    try {
        text = await environment.old.cacheFile("watch_history")
    }
    catch {
        throw new MoveProblem("the file watch_history could not be read")
    }
    if (text === null) return done("missing")
    const entries = text.trim() === "" ? {} : jsonOf(text)
    if (!isRecord(entries)) throw new MoveProblem("the file watch_history is not readable as JSON")
    if (Object.keys(entries).length === 0) return done("empty")
    const rows = new Map<number, typeof watchPositions.$inferInsert>()
    const leftovers: Record<string, unknown> = {}
    const extraFields = new Set<string>()
    let unfit = 0
    const now = environment.now()
    for (const [key, entry] of Object.entries(entries)) {
        const value = isRecord(entry) ? entry.value : undefined
        const number = (name: string) => (isRecord(value) && typeof value[name] === "number" && Number.isFinite(value[name]) ? value[name] : null)
        const mediaId = number("mediaId")
        const [position, duration, episode] = [number("currentTime"), number("duration"), number("episodeNumber")]
        if (!isRecord(entry) || !isRecord(value) || mediaId === null || !Number.isInteger(mediaId) || rows.has(mediaId)
            || position === null || duration === null || episode === null || !Number.isInteger(episode)
            || typeof value.kind !== "string" || typeof (value.filepath ?? "") !== "string") {
            leftovers[key] = entry
            unfit++
            continue
        }
        const more: Record<string, unknown> = {}
        for (const [name, extra] of Object.entries(value)) if (!WATCH_FIELDS.includes(name)) more[name] = extra
        for (const [name, extra] of Object.entries(entry)) if (name !== "value" && name !== "expiration") more[`entry.${name}`] = extra
        if (Object.keys(more).length > 0) {
            leftovers[key] = more
            for (const name of Object.keys(more)) extraFields.add(name)
        }
        rows.set(mediaId, {
            mediaId,
            kind: value.kind,
            episodeNumber: episode,
            positionSeconds: position,
            durationSeconds: duration,
            filepath: (value.filepath ?? "") as string,
            addedAt: timeOf(value.timeAdded) ?? now,
            changedAt: timeOf(value.timeUpdated) ?? now,
            expiresAt: timeOf(entry.expiration),
        })
    }
    return write(environment, writer => hasRows(writer, watchPositions), async writer => {
        if (rows.size > 0) await writer.insert(watchPositions).values([...rows.values()])
        return done("moved", rows.size, { extraFields: [...extraFields], unfitFields: unfit > 0 ? ["entries"] : [], leftovers })
    })
}

const PARTS: Record<MovePart, (environment: MoveEnvironment) => Promise<Done>> = {
    account: moveAccount,
    settings: moveSettings,
    appearance: moveAppearance,
    homeItems: moveHomeItems,
    watchHistory: moveWatchHistory,
}

// ---- the run ----

async function movePart(part: MovePart, environment: MoveEnvironment): Promise<MoveResult> {
    let result: Done
    try {
        result = await PARTS[part](environment)
    }
    catch (error) {
        // only a MoveProblem's text is known to be free of values
        result = done("failed", 0, { reason: error instanceof MoveProblem ? error.message : `unexpected ${error instanceof Error ? error.name : "error"}` })
    }
    const { leftovers, ...shown } = result
    const { outcome, count, ...detail } = shown
    try {
        await inOrder(environment.database, async () => {
            const noted = (await environment.database.select().from(moveParts)).find(row => row.part === part)
            // a run that changed nothing leaves the note of the run that did
            if (noted && (outcome === "kept" || (outcome === noted.outcome && outcome !== "moved"))) return
            const row = { outcome, count, detail, leftovers: leftovers && Object.keys(leftovers).length > 0 ? leftovers : null, movedAt: environment.now() }
            await environment.database.insert(moveParts).values({ part, ...row }).onConflictDoUpdate({ target: moveParts.part, set: row })
        })
    }
    catch {
        // without a note the next start tries this part again; a part that is there by then is kept
    }
    return { part, ...shown }
}

/** Runs the move, every part, whether it ran before or not. A part the core has data for is kept as it is. */
export async function moveFromServer(environment: MoveEnvironment): Promise<MoveResult[]> {
    const results: MoveResult[] = []
    for (const part of MOVE_PARTS) results.push(await movePart(part, environment))
    return results
}

/** Runs the move if this database has not seen one yet. null: it has. */
export async function moveFromServerOnce(environment: MoveEnvironment): Promise<MoveResult[] | null> {
    const ran = await inOrder(environment.database, async () => (await environment.database.select().from(moveParts).limit(1)).length > 0)
    return ran ? null : moveFromServer(environment)
}

/** The results as one log line: parts, outcomes, counts and names of fields. No values. */
export function moveSummary(results: MoveResult[]): string {
    return results.map(result => {
        const notes = [
            result.extraFields.length > 0 ? `extra: ${result.extraFields.join(" ")}` : "",
            result.unfitFields.length > 0 ? `unfit: ${result.unfitFields.join(" ")}` : "",
            result.reason ?? "",
        ].filter(Boolean)
        return `${result.part} ${result.outcome} ${result.count}${notes.length > 0 ? ` (${notes.join("; ")})` : ""}`
    }).join(", ")
}
