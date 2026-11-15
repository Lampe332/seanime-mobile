// geschrieben nach: Aufzeichnung api-schreibend vom 13.11.2026 (SETTINGS.GettingStarted, SaveSettings, PatchSetting, SaveMediaPlayerSettings, THEME.UpdateTheme, STATUS.UpdateHomeItems: Anfrage, Antwort, Zustand vorher und nachher) und dem App-Code src/api/hooks/settings.hooks.ts, theme.hooks.ts, status.hooks.ts

import { asc } from "drizzle-orm"
import { type CoreDatabase, inOrder } from "../database/database"
import { appearance, homeItems, settingsSections } from "../database/schema"
import { CoreError } from "../errors"
import type { CoreEnvironment } from "../registry"
import { statusWithoutServer } from "../start/without-server"
import {
    APPEARANCE_FIELDS_BEFORE_LISTS,
    APPEARANCE_SHAPE,
    type Fields,
    type FieldValue,
    FIRST_START_FIXED,
    NO_TIME,
    SAVED_SECTIONS,
    SETTINGS_SECTIONS,
    SETTINGS_SHAPE,
    type SettingsSection,
} from "./shape"

/*
 * The settings, the look of the app and the home items, kept in the core's own database. Every function here answers
 * one interface the way the server was recorded answering it.
 *
 * The app reads settings and look as part of the status (GET /api/v1/status), which also carries account and server
 * facts that are not the core's yet. Until they are, the status still comes from the server and only its two fields
 * `settings` and `themeSettings` are replaced by the core's (statusWithOwnSettings).
 *
 * Not in any recording, so decided here and marked as own: what happens with a wrong kind of value, with an unknown
 * path, and with a save before the first start. These are refused with a text of the core's own.
 */


function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function emptyOf(sample: FieldValue): FieldValue {
    if (Array.isArray(sample)) return []
    if (typeof sample === "string") return ""
    if (typeof sample === "number") return 0
    return false
}

const KIND_NAMES: Record<string, string> = { string: "text", number: "number", boolean: "yes/no value" }

/** The value as it is stored: the given one if it is of the field's kind, the empty value if it is missing. */
function fittedValue(sample: FieldValue, value: unknown, where: string): FieldValue {
    if (value === undefined || value === null) return emptyOf(sample)
    if (Array.isArray(sample)) {
        if (!Array.isArray(value) || value.some(entry => typeof entry !== "string" && typeof entry !== "number")) {
            throw new CoreError(`${where} must be a list`)
        }
        return value as (string | number)[]
    }
    if (typeof value !== typeof sample || (typeof value === "number" && !Number.isFinite(value))) {
        throw new CoreError(`${where} must be a ${KIND_NAMES[typeof sample]}`)
    }
    return value as FieldValue
}

/** Exactly the fields of the shape, in its order; anything else in `given` is dropped. */
function fitted(shape: Fields, given: unknown, where: string): Fields {
    if (given !== undefined && given !== null && !isRecord(given)) throw new CoreError(`${where} must be an object`)
    const result: Fields = {}
    for (const [name, sample] of Object.entries(shape)) result[name] = fittedValue(sample, given?.[name], `${where}.${name}`)
    return result
}

function isoTime(milliseconds: number): string {
    return new Date(milliseconds).toISOString()
}

type Reader = Pick<CoreDatabase, "select">
type Writer = Pick<CoreDatabase, "select" | "insert" | "update" | "delete">

/** The settings as the status carries them, or null before the first start. */
async function readSettings(database: Reader): Promise<Record<string, unknown> | null> {
    // only the server's sections: the app's own switches (incognito.ts) share the table but are not part of the status
    const rows = (await database.select().from(settingsSections)).filter(row => (SETTINGS_SECTIONS as readonly string[]).includes(row.section))
    if (rows.length === 0) return null
    const stored = new Map(rows.map(row => [row.section, row.content]))
    const section = (name: SettingsSection) => fitted(SETTINGS_SHAPE[name], stored.get(name), name)
    return {
        id: 1,
        createdAt: NO_TIME,
        updatedAt: isoTime(Math.max(...rows.map(row => row.changedAt))),
        library: section("library"),
        mediaPlayer: section("mediaPlayer"),
        torrent: section("torrent"),
        manga: section("manga"),
        anilist: section("anilist"),
        listSync: null,
        autoDownloader: section("autoDownloader"),
        discord: section("discord"),
        notifications: section("notifications"),
        nakama: section("nakama"),
    }
}

async function writeSections(database: Writer, sections: Partial<Record<SettingsSection, Fields>>, now: number) {
    for (const name of SETTINGS_SECTIONS) {
        const content = sections[name]
        if (!content) continue
        await database.insert(settingsSections).values({ section: name, content, changedAt: now })
            .onConflictDoUpdate({ target: settingsSections.section, set: { content, changedAt: now } })
    }
}

async function requireSettings(database: Reader): Promise<Record<string, unknown>> {
    const settings = await readSettings(database)
    if (!settings) throw new CoreError("the settings have not been set up yet")
    return settings
}

function unpinnedMenuItems(value: unknown): string[] | null {
    if (value === undefined || value === null) return null
    if (!Array.isArray(value) || value.some(entry => typeof entry !== "string")) throw new CoreError("theme.unpinnedMenuItems must be a list of texts")
    return value as string[]
}

/** The look as the status carries it: id 0 and no times while nothing was saved. */
async function readAppearance(database: Reader): Promise<Record<string, unknown>> {
    const row = (await database.select().from(appearance))[0]
    const fields = Object.entries(fitted(APPEARANCE_SHAPE, row?.content, "theme"))
    return {
        id: row ? 1 : 0,
        createdAt: row ? isoTime(row.createdAt) : NO_TIME,
        updatedAt: row ? isoTime(row.changedAt) : NO_TIME,
        ...Object.fromEntries(fields.slice(0, APPEARANCE_FIELDS_BEFORE_LISTS)),
        unpinnedMenuItems: unpinnedMenuItems(row?.content.unpinnedMenuItems),
        homeItems: null,
        ...Object.fromEntries(fields.slice(APPEARANCE_FIELDS_BEFORE_LISTS)),
    }
}

type Environment = Pick<CoreEnvironment, "database" | "now"> & Partial<Pick<CoreEnvironment, "secret">>

/** GET /api/v1/status: the core's own status (start/without-server.ts), the first start and every save answer with it */
export async function statusWithOwnSettings(environment: Environment): Promise<unknown> {
    return statusWithoutServer(environment, await ownSettingsAndLook(await environment.database()))
}

/** The two fields of the status that are this area's: the settings (null before the first start) and the look */
export function ownSettingsAndLook(database: CoreDatabase): Promise<{ settings: Record<string, unknown> | null, themeSettings: Record<string, unknown> }> {
    return inOrder(database, async () => ({
        settings: await readSettings(database),
        themeSettings: await readAppearance(database),
    }))
}

function requestBody(body: unknown): Record<string, unknown> {
    if (!isRecord(body)) throw new CoreError("the request must be an object")
    return body
}

function savedSections(body: Record<string, unknown>): Partial<Record<SettingsSection, Fields>> {
    return Object.fromEntries(SAVED_SECTIONS.map(name => [name, fitted(SETTINGS_SHAPE[name], body[name], name)]))
}

/** POST /api/v1/start: the first start. Stores the settings the app sends and answers with the status. */
export async function firstStart(body: unknown, environment: Environment): Promise<unknown> {
    const sections = savedSections(requestBody(body))
    for (const name of SETTINGS_SECTIONS) {
        if (FIRST_START_FIXED[name]) sections[name] = { ...sections[name], ...FIRST_START_FIXED[name] }
    }
    sections.autoDownloader = { ...SETTINGS_SHAPE.autoDownloader }
    const database = await environment.database()
    await inOrder(database, () => database.transaction(transaction => writeSections(transaction, sections, environment.now())))
    return statusWithOwnSettings(environment)
}

/** PATCH /api/v1/settings: replaces the eight sections a save carries (the answer, the status, is start.ts `statusAfterSave`). */
export async function saveSettings(body: unknown, environment: Environment): Promise<void> {
    const sections = savedSections(requestBody(body))
    const database = await environment.database()
    await inOrder(database, () => database.transaction(async transaction => {
        await requireSettings(transaction)
        await writeSections(transaction, sections, environment.now())
    }))
}

/** PATCH /api/v1/settings/path: sets one field, named as "section.field" (the answer as for `saveSettings`). */
export async function patchSetting(body: unknown, environment: Environment): Promise<void> {
    const { path, value } = requestBody(body)
    if (typeof path !== "string") throw new CoreError("path must be a text")
    const [sectionName, fieldName, ...more] = path.split(".")
    const shape = (SETTINGS_SECTIONS as readonly string[]).includes(sectionName) ? SETTINGS_SHAPE[sectionName as SettingsSection] : undefined
    if (!shape || !fieldName || more.length > 0 || !(fieldName in shape)) throw new CoreError(`unknown setting "${path}"`)
    if (value === undefined || value === null) throw new CoreError(`${path} needs a value`)
    const fittedField = fittedValue(shape[fieldName], value, path)
    const database = await environment.database()
    await inOrder(database, () => database.transaction(async transaction => {
        const settings = await requireSettings(transaction)
        const section = { ...(settings[sectionName] as Fields), [fieldName]: fittedField }
        await writeSections(transaction, { [sectionName]: section }, environment.now())
    }))
}

/** PATCH /api/v1/settings/media-player: replaces the media player section. The recorded answer is `true`. */
export async function saveMediaPlayerSettings(body: unknown, environment: Environment): Promise<boolean> {
    const mediaPlayer = fitted(SETTINGS_SHAPE.mediaPlayer, requestBody(body).mediaPlayer, "mediaPlayer")
    const database = await environment.database()
    await inOrder(database, () => database.transaction(async transaction => {
        await requireSettings(transaction)
        await writeSections(transaction, { mediaPlayer }, environment.now())
    }))
    return true
}

/** PATCH /api/v1/theme: stores the look and answers with it. The id and times the app sends along do not count. */
export async function updateAppearance(body: unknown, environment: Environment): Promise<unknown> {
    const theme = requestBody(body).theme
    if (!isRecord(theme)) throw new CoreError("theme must be an object")
    const content = { ...fitted(APPEARANCE_SHAPE, theme, "theme"), unpinnedMenuItems: unpinnedMenuItems(theme.unpinnedMenuItems) }
    const database = await environment.database()
    return inOrder(database, async () => {
        const now = environment.now()
        await database.insert(appearance).values({ id: 1, content, createdAt: now, changedAt: now })
            .onConflictDoUpdate({ target: appearance.id, set: { content, changedAt: now } })
        return readAppearance(database)
    })
}

/** GET /api/v1/status/home-items: the home items in their order, null while there are none. */
export async function readHomeItems(environment: Environment): Promise<unknown> {
    const database = await environment.database()
    return inOrder(database, async () => {
        const rows = await database.select().from(homeItems).orderBy(asc(homeItems.position))
        if (rows.length === 0) return null
        return rows.map(row => ({
            id: row.itemId,
            type: row.kind,
            ...(row.options === null || row.options === undefined ? {} : { options: row.options }),
            schemaVersion: row.schemaVersion,
        }))
    })
}

/** POST /api/v1/status/home-items: replaces the home items. The recorded answer is empty (no JSON at all). */
export async function updateHomeItems(body: unknown, environment: Environment): Promise<undefined> {
    const items = requestBody(body).items ?? []
    if (!Array.isArray(items)) throw new CoreError("items must be a list")
    const rows = items.map((item: unknown, position) => {
        if (!isRecord(item) || typeof item.id !== "string" || typeof item.type !== "string") {
            throw new CoreError(`items[${position}] needs an id and a type`)
        }
        const schemaVersion = item.schemaVersion ?? 0
        if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion)) throw new CoreError(`items[${position}].schemaVersion must be a number`)
        return { position, itemId: item.id, kind: item.type, schemaVersion, options: item.options ?? null }
    })
    const database = await environment.database()
    await inOrder(database, () => database.transaction(async transaction => {
        await transaction.delete(homeItems)
        if (rows.length > 0) await transaction.insert(homeItems).values(rows)
        // the home items belong to the look: a look that was saved before counts as changed now (DB copy b)
        await transaction.update(appearance).set({ changedAt: environment.now() })
    }))
    return undefined
}
