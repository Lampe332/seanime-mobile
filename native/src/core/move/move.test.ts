import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { beforeEach, describe, expect, it } from "vitest"
import { sqlDriverFor } from "@/api/client/core-database"
import { forgetDatabases, openDatabaseSync } from "../../../test/expo-sqlite"
import { type CoreDatabase, openCoreDatabase } from "../database/database"
import { settingsSections } from "../database/schema"
import { readHomeItems, statusWithOwnSettings } from "../settings/settings"
import { APPEARANCE_SHAPE, type FieldValue, SETTINGS_SECTIONS, SETTINGS_SHAPE } from "../settings/shape"
import observed from "./move.observed.json"
import { ACCOUNT_TOKEN_SECRET, MOVE_PARTS, type MoveEnvironment, type OldData, columnOf, moveFromServer, moveFromServerOnce, moveSummary, settingsColumnOf, timeOf } from "./move"

/*
 * The move of the server's data into the core's database. The server's database is built here from the schema the DB
 * copies show (move.observed.json), filled with made-up values; nothing in this file is a real value.
 */

const TOKEN = "made-up-token-0123456789"
const NOW = 1_800_000_000_000
const OLD_TIME = "2026-11-13 10:28:00.123456789+00:00"
const OLD_TIME_MS = Date.UTC(2026, 10, 13, 10, 28, 0, 123)
const LISTS: Record<string, unknown[]> = { library_paths: ["/made/up/a", "/made/up/b"], nakama_host_unshared_anime_ids: [11, 22] }
const HOME_ITEMS = [
    { id: "one", type: "anime-continue-watching", schemaVersion: 2 },
    { id: "two", type: "anime-library", schemaVersion: 1, options: { statuses: ["CURRENT"], layout: "grid" }, colour: "teal" },
]
const WATCH_HISTORY = {
    "101": {
        value: { currentTime: 12.5, duration: 1400.25, episodeNumber: 3, filepath: "", kind: "onlinestream", mediaId: 101, timeAdded: "2026-11-12T19:00:32.180207533Z", timeUpdated: "2026-11-12T19:01:31.119288046Z", mood: "fine" },
        expiration: "2300-08-27T19:01:31.119291424Z",
    },
    "202": {
        value: { currentTime: 0, duration: 600, episodeNumber: 1, filepath: "/made/up.mkv", kind: "mediastream", mediaId: 202, timeAdded: "2026-11-11T15:43:11.9932Z", timeUpdated: "2026-11-11T15:43:11Z" },
        expiration: "2300-08-26T15:43:11.993248716Z",
    },
}

const parsed = (value: unknown) => JSON.parse(String(value)) as Record<string, unknown>

type Column = { name: string, type: string }

function columnsOf(old: DatabaseSync, table: string): Column[] {
    return (old.prepare(`PRAGMA table_info(${table})`).all() as unknown as Column[]).map(({ name, type }) => ({ name, type: type.toLowerCase() }))
}

/** A made-up value of the column's kind, different for every column */
function madeUp({ name, type }: Column, index: number): SQLInputValue {
    if (name === "id") return 1
    if (name === "created_at" || name === "updated_at") return OLD_TIME
    if (name in LISTS) return JSON.stringify(LISTS[name])
    if (type === "numeric") return index % 2
    if (type === "integer") return 1000 + index
    if (type === "real") return index + 0.5
    return `text of ${name}`
}

function insert(old: DatabaseSync, table: string, values: Record<string, SQLInputValue>) {
    const names = Object.keys(values)
    old.prepare(`INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`).run(...Object.values(values))
}

function filled(old: DatabaseSync, table: string, own: Record<string, SQLInputValue> = {}): Record<string, SQLInputValue> {
    const values = { ...Object.fromEntries(columnsOf(old, table).map((column, index) => [column.name, madeUp(column, index)])), ...own }
    insert(old, table, values)
    return values
}

function emptyOld(): DatabaseSync {
    const old = new DatabaseSync(":memory:")
    for (const statement of Object.values(observed.tables)) old.exec(statement)
    return old
}

function fullOld() {
    const old = emptyOld()
    const settings = filled(old, "settings")
    const themes = filled(old, "themes", {
        unpinned_menu_items: JSON.stringify(["schedule", "manga"]),
        home_items: new TextEncoder().encode(JSON.stringify(HOME_ITEMS)),
    })
    const accounts = filled(old, "accounts", { username: "made-up-user", token: TOKEN, viewer: new TextEncoder().encode(JSON.stringify({ name: "made-up-user", id: 7 })) })
    return { old, settings, themes, accounts }
}

function oldData(old: DatabaseSync | null, cache: Record<string, string> = {}): OldData {
    return {
        rows: async table => (old ? old.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[] : null),
        cacheFile: async bucket => cache[bucket] ?? null,
    }
}

let database: CoreDatabase
let secrets: Map<string, string>

const driver = () => sqlDriverFor(openDatabaseSync("core.db") as never)

function environment(old: OldData): MoveEnvironment {
    return {
        database,
        old,
        secrets: { read: async name => secrets.get(name) ?? null, write: async (name, value) => void secrets.set(name, value) },
        now: () => NOW,
    }
}

async function table(name: string): Promise<Record<string, unknown>[]> {
    const names = ((await driver()(`PRAGMA table_info(${name})`, [], "all")).rows as unknown[][]).map(row => String(row[1]))
    const rows = (await driver()(`SELECT * FROM ${name} ORDER BY 1`, [], "all")).rows as unknown[][]
    return rows.map(row => Object.fromEntries(names.map((column, index) => [column, row[index]])))
}

const CORE_TABLES = ["account", "appearance", "home_items", "move_parts", "settings_sections", "watch_positions"]

/** Everything the core's database holds, as one text */
const everything = async () => JSON.stringify(await Promise.all(CORE_TABLES.map(async name => [name, await table(name)])))

const outcomes = (results: { part: string, outcome: string }[]) => Object.fromEntries(results.map(result => [result.part, result.outcome]))

/** What a stored value has to be in the core, for a field of this kind */
function expected(sample: FieldValue, stored: SQLInputValue): FieldValue {
    if (Array.isArray(sample)) return JSON.parse(String(stored)) as FieldValue
    if (typeof sample === "boolean") return stored === 1
    return stored as FieldValue
}

beforeEach(async () => {
    forgetDatabases()
    secrets = new Map()
    database = await openCoreDatabase(driver(), () => NOW)
})

describe("which column holds which field", () => {
    const columnNames = (name: keyof typeof observed.tables) => columnsOf(emptyOld(), name).map(column => column.name)

    it("names a column of the observed table for every field of the settings, each column once", () => {
        const columns = columnNames("settings")
        const used = SETTINGS_SECTIONS.flatMap(section => Object.keys(SETTINGS_SHAPE[section]).map(field => settingsColumnOf(section, field)))
        expect(used.filter(name => !columns.includes(name))).toEqual([])
        expect(new Set(used).size).toBe(used.length)
        // what the server stores and the app's settings do not show: taken along as leftovers
        expect(columns.filter(name => !used.includes(name))).toEqual(["id", "created_at", "updated_at", "automatic_sync", "sync_origin"])
    })

    it("names a column of the observed table for every field of the look", () => {
        const columns = columnNames("themes")
        const used = Object.keys(APPEARANCE_SHAPE).map(columnOf)
        expect(used.filter(name => !columns.includes(name))).toEqual([])
        expect(columns.filter(name => !used.includes(name))).toEqual(["id", "created_at", "updated_at", "unpinned_menu_items", "home_items"])
    })

    it("knows the names that are not simply the field's", () => {
        expect(settingsColumnOf("mediaPlayer", "host")).toBe("player_host")
        expect(settingsColumnOf("library", "openWebURLOnStart")).toBe("open_web_url_on_start")
        expect(settingsColumnOf("discord", "richPresenceShowAniListMediaButton")).toBe("rich_presence_show_anilist_media_button")
        expect(settingsColumnOf("nakama", "remoteServerURL")).toBe("nakama_remote_server_url")
        expect(settingsColumnOf("autoDownloader", "interval")).toBe("auto_downloader_interval")
        expect(columnOf("mobileCustomCSS")).toBe("mobile_custom_css")
    })

    it("reads the server's two ways of writing a time, down to the millisecond", () => {
        expect(timeOf(OLD_TIME)).toBe(OLD_TIME_MS)
        expect(timeOf("2026-11-13 12:28:00.5+02:00")).toBe(Date.UTC(2026, 10, 13, 10, 28, 0, 500))
        expect(timeOf("2026-11-12T19:00:32.180207533Z")).toBe(Date.UTC(2026, 10, 12, 19, 0, 32, 180))
        expect(timeOf("2300-08-27T19:01:31Z")).toBe(Date.UTC(2300, 7, 27, 19, 1, 31))
        expect(timeOf("yesterday")).toBeNull()
        expect(timeOf(null)).toBeNull()
    })
})

describe("the move", () => {
    it("takes every part over, field by field", async () => {
        const { old, settings, themes } = fullOld()
        const results = await moveFromServer(environment(oldData(old, { watch_history: JSON.stringify(WATCH_HISTORY) })))
        expect(results.map(result => result.part)).toEqual([...MOVE_PARTS])
        expect(outcomes(results)).toEqual({ account: "moved", settings: "moved", appearance: "moved", homeItems: "moved", watchHistory: "moved" })
        expect(Object.fromEntries(results.map(result => [result.part, result.count]))).toEqual({ account: 1, settings: 9, appearance: 1, homeItems: 2, watchHistory: 2 })

        // settings: every field of every section is the value of its column
        const sections = new Map((await table("settings_sections")).map(row => [row.section, row]))
        let compared = 0
        for (const section of SETTINGS_SECTIONS) {
            const row = sections.get(section)!
            expect(row.changed_at, section).toBe(OLD_TIME_MS)
            const content = parsed(row.content)
            expect(Object.keys(content), section).toEqual(Object.keys(SETTINGS_SHAPE[section]))
            for (const [field, sample] of Object.entries(SETTINGS_SHAPE[section])) {
                expect(content[field], `${section}.${field}`).toEqual(expected(sample, settings[settingsColumnOf(section, field)]))
                compared++
            }
        }
        expect(compared).toBe(Object.keys(settings).length - 5)

        // look
        const [look] = await table("appearance")
        expect([look.id, look.created_at, look.changed_at]).toEqual([1, OLD_TIME_MS, OLD_TIME_MS])
        const lookContent = parsed(look.content)
        for (const [field, sample] of Object.entries(APPEARANCE_SHAPE)) expect(lookContent[field], field).toEqual(expected(sample, themes[columnOf(field)]))
        expect(lookContent.unpinnedMenuItems).toEqual(["schedule", "manga"])
        expect(Object.keys(lookContent).length).toBe(Object.keys(APPEARANCE_SHAPE).length + 1)

        // home items, in their order
        expect(await table("home_items")).toEqual([
            { position: 0, item_id: "one", kind: "anime-continue-watching", schema_version: 2, options: null },
            { position: 1, item_id: "two", kind: "anime-library", schema_version: 1, options: JSON.stringify(HOME_ITEMS[1].options) },
        ])

        // account: name and viewer in the database, the token not
        expect(await table("account")).toEqual([
            { id: 1, username: "made-up-user", viewer: JSON.stringify({ name: "made-up-user", id: 7 }), created_at: OLD_TIME_MS, changed_at: OLD_TIME_MS },
        ])

        // watch positions
        expect(await table("watch_positions")).toEqual([
            {
                media_id: 101, kind: "onlinestream", episode_number: 3, position_seconds: 12.5, duration_seconds: 1400.25, filepath: "",
                added_at: Date.UTC(2026, 10, 12, 19, 0, 32, 180), changed_at: Date.UTC(2026, 10, 12, 19, 1, 31, 119), expires_at: Date.UTC(2300, 7, 27, 19, 1, 31, 119),
            },
            {
                media_id: 202, kind: "mediastream", episode_number: 1, position_seconds: 0, duration_seconds: 600, filepath: "/made/up.mkv",
                added_at: Date.UTC(2026, 10, 11, 15, 43, 11, 993), changed_at: Date.UTC(2026, 10, 11, 15, 43, 11, 0), expires_at: Date.UTC(2300, 7, 26, 15, 43, 11, 993),
            },
        ])
    })

    it("takes along unchanged what the core has no place for, and names it in the result", async () => {
        const { old, settings } = fullOld()
        old.exec("ALTER TABLE accounts ADD COLUMN `nickname` text; ALTER TABLE accounts ADD COLUMN `refresh_token` text")
        old.exec("UPDATE accounts SET nickname = 'made-up-nick', refresh_token = 'made-up-refresh'")
        const results = await moveFromServer(environment(oldData(old, { watch_history: JSON.stringify(WATCH_HISTORY) })))
        const result = Object.fromEntries(results.map(entry => [entry.part, entry]))
        expect(result.settings.extraFields).toEqual(["automatic_sync", "sync_origin"])
        expect(result.homeItems.extraFields).toEqual(["colour"])
        expect(result.watchHistory.extraFields).toEqual(["mood"])
        expect(result.account.extraFields).toEqual(["nickname", "refresh_token"])
        expect(results.flatMap(entry => entry.unfitFields)).toEqual([])

        const notes = new Map((await table("move_parts")).map(row => [row.part, row]))
        expect(parsed(notes.get("settings")!.leftovers)).toEqual({ automatic_sync: settings.automatic_sync, sync_origin: settings.sync_origin })
        expect(parsed(notes.get("homeItems")!.leftovers)).toEqual({ "items[1]": { colour: "teal" } })
        expect(parsed(notes.get("watchHistory")!.leftovers)).toEqual({ 101: { mood: "fine" } })
        // a column that sounds like a secret goes where the token goes
        expect(parsed(notes.get("account")!.leftovers)).toEqual({ nickname: "made-up-nick" })
        expect(secrets.get("seanime-core.account.refresh_token")).toBe("made-up-refresh")
        expect(notes.get("appearance")!.leftovers).toBeNull()
        expect([...notes.values()].map(row => row.moved_at)).toEqual([NOW, NOW, NOW, NOW, NOW])
    })

    it("puts the token into the secured storage and nowhere else", async () => {
        const { old } = fullOld()
        const results = await moveFromServer(environment(oldData(old, { watch_history: JSON.stringify(WATCH_HISTORY) })))
        expect([...secrets]).toEqual([[ACCOUNT_TOKEN_SECRET, TOKEN]])
        expect(await everything()).not.toContain(TOKEN)
        expect(JSON.stringify(results)).not.toContain(TOKEN)
        expect(moveSummary(results)).not.toContain(TOKEN)
        expect(moveSummary(results)).toBe("account moved 1, settings moved 9 (extra: automatic_sync sync_origin), appearance moved 1, homeItems moved 2 (extra: colour), watchHistory moved 2 (extra: mood)")
    })

    it("gives the app the server's values through the settings area", async () => {
        const { old, settings, themes } = fullOld()
        await moveFromServer(environment(oldData(old)))
        const core = { database: async () => database, server: async () => ({ os: "made-up" }), now: () => NOW }
        const status = await statusWithOwnSettings(core) as { settings: Record<string, Record<string, unknown>>, themeSettings: Record<string, unknown> }
        expect(status.settings.library.enableWatchContinuity).toBe(settings.enable_watch_continuity === 1)
        expect(status.settings.mediaPlayer.host).toBe(settings.player_host)
        expect(status.settings.nakama.hostUnsharedAnimeIds).toEqual([11, 22])
        expect(status.settings.updatedAt).toBe(new Date(OLD_TIME_MS).toISOString())
        expect(status.themeSettings.accentColor).toBe(themes.accent_color)
        expect(status.themeSettings.unpinnedMenuItems).toEqual(["schedule", "manga"])
        expect(await readHomeItems(core)).toEqual([
            { id: "one", type: "anime-continue-watching", schemaVersion: 2 },
            { id: "two", type: "anime-library", options: HOME_ITEMS[1].options, schemaVersion: 1 },
        ])
    })

    it("runs once per database; a repeat changes nothing", async () => {
        const { old } = fullOld()
        const source = oldData(old, { watch_history: JSON.stringify(WATCH_HISTORY) })
        expect(outcomes((await moveFromServerOnce(environment(source)))!).settings).toBe("moved")
        const after = await everything()
        expect(await moveFromServerOnce(environment(source))).toBeNull()

        const later = { ...environment(source), now: () => NOW + 5000 }
        const again = await moveFromServer(later)
        expect(outcomes(again)).toEqual({ account: "kept", settings: "kept", appearance: "kept", homeItems: "kept", watchHistory: "kept" })
        expect(await everything()).toBe(after)
        expect([...secrets]).toEqual([[ACCOUNT_TOKEN_SECRET, TOKEN]])
    })

    it("does not overwrite what the core already has", async () => {
        const { old } = fullOld()
        await database.insert(settingsSections).values({ section: "library", content: { libraryPath: "/the/core/own" }, changedAt: 42 })
        const results = await moveFromServerOnce(environment(oldData(old, { watch_history: JSON.stringify(WATCH_HISTORY) })))
        expect(outcomes(results!)).toEqual({ account: "moved", settings: "kept", appearance: "moved", homeItems: "moved", watchHistory: "moved" })
        expect(await table("settings_sections")).toEqual([{ section: "library", content: JSON.stringify({ libraryPath: "/the/core/own" }), changed_at: 42 }])
    })

    it("reports an empty server as empty and writes nothing", async () => {
        const results = await moveFromServer(environment(oldData(emptyOld(), { watch_history: "{}" })))
        expect(outcomes(results)).toEqual({ account: "empty", settings: "empty", appearance: "empty", homeItems: "empty", watchHistory: "empty" })
        for (const name of CORE_TABLES.filter(name => name !== "move_parts")) expect(await table(name), name).toEqual([])
        expect((await table("move_parts")).length).toBe(5)
        // a look without home items: "null", as the copy of the test app has it
        const old = emptyOld()
        filled(old, "themes", { unpinned_menu_items: null, home_items: new TextEncoder().encode("null") })
        expect(outcomes(await moveFromServer(environment(oldData(old))))).toMatchObject({ appearance: "moved", homeItems: "empty" })
        expect(parsed((await table("appearance"))[0].content).unpinnedMenuItems).toBeNull()
    })

    it("says what was missing instead of failing: no files at all", async () => {
        const results = await moveFromServerOnce(environment(oldData(null)))
        expect(outcomes(results!)).toEqual({ account: "missing", settings: "missing", appearance: "missing", homeItems: "missing", watchHistory: "missing" })
        // the move is noted, so it does not run at every start; a repeat on purpose takes what is there by then
        expect(await moveFromServerOnce(environment(oldData(fullOld().old)))).toBeNull()
        const again = await moveFromServer(environment(oldData(fullOld().old)))
        expect(outcomes(again)).toEqual({ account: "moved", settings: "moved", appearance: "moved", homeItems: "moved", watchHistory: "missing" })
    })

    it("moves the other parts when one cannot be read", async () => {
        const { old } = fullOld()
        const source = oldData(old, { watch_history: "{\"101\": {\"value\": made-up-and-broken" })
        const broken: OldData = {
            rows: async name => {
                if (name === "themes") throw new Error(`disk image is malformed near ${TOKEN}`)
                return source.rows(name)
            },
            cacheFile: source.cacheFile,
        }
        const results = await moveFromServer(environment(broken))
        expect(outcomes(results)).toEqual({ account: "moved", settings: "moved", appearance: "failed", homeItems: "failed", watchHistory: "failed" })
        expect(results.map(result => result.reason)).toEqual([undefined, undefined, "table themes could not be read", "table themes could not be read", "the file watch_history is not readable as JSON"])
        expect(JSON.stringify(results)).not.toContain("made-up")
        expect((await table("settings_sections")).length).toBe(9)
        expect(await table("appearance")).toEqual([])
    })

    it("keeps a value of the wrong kind as a leftover and gives the field its empty value", async () => {
        const old = emptyOld()
        filled(old, "settings", { vlc_port: "not a number", library_paths: "a,b", auto_scan: "maybe" })
        const watch = { ...WATCH_HISTORY, 303: { value: { mediaId: "three" }, expiration: null } }
        const results = await moveFromServer(environment(oldData(old, { watch_history: JSON.stringify(watch) })))
        const result = Object.fromEntries(results.map(entry => [entry.part, entry]))
        expect(result.settings.outcome).toBe("moved")
        expect(result.settings.unfitFields.sort()).toEqual(["auto_scan", "library_paths", "vlc_port"])
        const sections = new Map((await table("settings_sections")).map(row => [row.section, parsed(row.content)]))
        expect([sections.get("mediaPlayer")!.vlcPort, sections.get("library")!.libraryPaths, sections.get("library")!.autoScan]).toEqual([0, [], false])
        const notes = new Map((await table("move_parts")).map(row => [row.part, parsed(row.leftovers)]))
        expect(notes.get("settings")).toMatchObject({ vlc_port: "not a number", library_paths: "a,b", auto_scan: "maybe" })
        expect([result.watchHistory.count, result.watchHistory.unfitFields]).toEqual([2, ["entries"]])
        expect(notes.get("watchHistory")![303]).toEqual({ value: { mediaId: "three" }, expiration: null })
    })
})
