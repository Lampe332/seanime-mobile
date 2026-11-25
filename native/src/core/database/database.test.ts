import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core"
import { beforeEach, describe, expect, it } from "vitest"
import { sqlDriverFor } from "@/api/client/core-database"
import { forgetDatabases, openDatabaseSync } from "../../../test/expo-sqlite"
import { inOrder, openCoreDatabase } from "./database"
import { bringUpToDate, SCHEMA_STEPS, type SchemaStep, type SqlDriver } from "./migrations"
import * as schema from "./schema"

/*
 * The core's own database on a real SQLite (Node's, through the same driver code the device uses): the steps make the
 * tables on an empty database, each step once, and the tables are the ones the queries are written against.
 */

/** The database "core.db" as the app opens it; the same name again is the same database, like after a new start. */
const driver = (): SqlDriver => sqlDriverFor(openDatabaseSync("core.db") as never)

async function rows(sql: string): Promise<unknown[][]> {
    return (await driver()(sql, [], "all")).rows as unknown[][]
}

const tableNames = async () => (await rows("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).map(row => row[0])

beforeEach(() => forgetDatabases())

describe("schema steps", () => {
    it("make the tables on an empty database and write down what they did", async () => {
        expect(await tableNames()).toEqual([])
        expect(await bringUpToDate(driver(), 1000)).toEqual(SCHEMA_STEPS.map(step => step.step))
        expect(await tableNames()).toEqual(["account", "anilist_answers", "anilist_changes", "anilist_list_entries", "anilist_media", "appearance", "episode_metadata", "extension_sandbox_settings", "extension_settings", "extension_user_configs", "home_items", "local_files", "manga_chapter_numbers", "manga_downloads", "manga_mapping_move", "manga_mappings", "manga_moves", "manga_preferences", "mediaserver_mappings", "mediaserver_series", "metadata_parents", "move_parts", "offline_items", "offline_moves", "offline_settings", "onlinestream_mapping_move", "onlinestream_mappings", "own_shows", "playlist_move", "playlists", "scan_summaries", "schema_steps", "server_answers", "settings_sections", "silenced_anime", "torrent_kept", "watch_positions"])
        expect(await rows("SELECT step, name, applied_at FROM schema_steps")).toEqual(SCHEMA_STEPS.map(step => [step.step, step.name, 1000]))
        for (const table of ["settings_sections", "appearance", "home_items", "account", "watch_positions", "move_parts", "anilist_media", "anilist_list_entries", "anilist_answers", "server_answers", "anilist_changes"]) expect(await rows(`SELECT count(*) FROM ${table}`)).toEqual([[0]])
    })

    it("are taken once: a second start changes nothing", async () => {
        await bringUpToDate(driver(), 1000)
        await driver()("INSERT INTO settings_sections (section, content, changed_at) VALUES ('library', '{}', 5)", [], "run")
        expect(await bringUpToDate(driver(), 2000)).toEqual([])
        expect(await rows("SELECT applied_at FROM schema_steps")).toEqual(SCHEMA_STEPS.map(() => [1000]))
        expect(await rows("SELECT section FROM settings_sections")).toEqual([["library"]])
    })

    it("have rising numbers without gaps, so a later stage only ever adds one at the end", () => {
        expect(SCHEMA_STEPS.map(step => step.step)).toEqual(SCHEMA_STEPS.map((_step, index) => index + 1))
    })

    it("take only the new step when a later stage adds one, and keep the data", async () => {
        await bringUpToDate(driver(), 1000)
        await driver()("INSERT INTO home_items (position, item_id, kind) VALUES (0, 'a', 'kind')", [], "run")
        const later: SchemaStep[] = [...SCHEMA_STEPS, { step: SCHEMA_STEPS.length + 1, name: "a later stage", statements: ["CREATE TABLE later_things (id INTEGER PRIMARY KEY)"] }]
        expect(await bringUpToDate(driver(), 2000, later)).toEqual([SCHEMA_STEPS.length + 1])
        expect(await tableNames()).toContain("later_things")
        expect(await rows("SELECT item_id, schema_version FROM home_items")).toEqual([["a", 0]])
    })

    it("take step 21 (media server) on a database of stage 20 and keep its data", async () => {
        const upTo20 = SCHEMA_STEPS.filter(step => step.step <= 20)
        expect(await bringUpToDate(driver(), 1000, upTo20)).toEqual(upTo20.map(step => step.step))
        await driver()("INSERT INTO own_shows (media_id, progress, listed, changed_at) VALUES (-7, 3, 1, 5)", [], "run")
        await driver()("INSERT INTO settings_sections (section, content, changed_at) VALUES ('library', '{}', 5)", [], "run")
        expect(await tableNames()).not.toContain("mediaserver_series")
        expect(await bringUpToDate(driver(), 2000)).toEqual(SCHEMA_STEPS.filter(step => step.step > 20).map(step => step.step))
        expect(await rows("SELECT media_id, progress, listed FROM own_shows")).toEqual([[-7, 3, 1]])
        expect(await rows("SELECT section FROM settings_sections")).toEqual([["library"]])
        expect(await rows("SELECT step, applied_at FROM schema_steps WHERE step >= 20")).toEqual([[20, 1000], ...SCHEMA_STEPS.filter(step => step.step > 20).map(step => [step.step, 2000])])
        const database = await openCoreDatabase(driver(), () => 3000)
        await database.insert(schema.mediaserverSeries).values({ serverId: "srv", seriesId: "s1", content: { series: { id: "s1" } } as never, fetchedAt: 3000 })
        await database.insert(schema.mediaserverMappings).values({ serverId: "srv", itemId: "s1", mediaId: 1, episodeOffset: 0, origin: "manual", changedAt: 3000 })
        expect((await database.select().from(schema.mediaserverSeries)).map(row => row.seriesId)).toEqual(["s1"])
        await expect(database.insert(schema.mediaserverMappings).values({ serverId: "srv", itemId: "s1", mediaId: 2, episodeOffset: 0, origin: "manual", changedAt: 3000 })).rejects.toThrow()
    })

    it("leave nothing behind when a step fails", async () => {
        const broken: SchemaStep[] = [{ step: 1, name: "broken", statements: ["CREATE TABLE half (id INTEGER)", "CREATE TABLE (nonsense"] }]
        await expect(bringUpToDate(driver(), 1000, broken)).rejects.toThrow()
        expect(await tableNames()).toEqual(["schema_steps"])
        expect(await rows("SELECT count(*) FROM schema_steps")).toEqual([[0]])
        // and the real steps still run afterwards
        expect(await bringUpToDate(driver(), 2000)).toEqual(SCHEMA_STEPS.map(step => step.step))
    })

    it("refuse a database written by a newer app and do not touch it", async () => {
        await bringUpToDate(driver(), 1000)
        await driver()("INSERT INTO schema_steps (step, name, applied_at) VALUES (99, 'from the future', 1)", [], "run")
        await expect(bringUpToDate(driver(), 2000)).rejects.toThrow("newer app")
        await expect(openCoreDatabase(driver(), () => 2000)).rejects.toThrow("newer app")
        expect((await rows("SELECT step FROM schema_steps ORDER BY step")).flat()).toEqual([...SCHEMA_STEPS.map(step => step.step), 99])
    })
})

describe("the tables the queries are written against", () => {
    it("are the tables the steps make: same names, same columns", async () => {
        await bringUpToDate(driver(), 1000)
        const described = Object.values(schema).map(table => getTableConfig(table as SQLiteTable))
        expect(described.map(table => table.name).sort()).toEqual(await tableNames())
        for (const table of described) {
            // PRAGMA table_info: cid, name, type, notnull, default, pk
            const real = (await rows(`PRAGMA table_info(${table.name})`)).map(row => ({ name: row[1], type: row[2], notNull: row[3] === 1, primary: row[5] === 1 }))
            const wanted = table.columns.map(column => ({ name: column.name, type: column.getSQLType().toUpperCase(), notNull: column.notNull, primary: column.primary }))
            expect(real, table.name).toEqual(wanted)
        }
    })

    it("can be read and written through Drizzle, and are still there after a new start", async () => {
        const database = await openCoreDatabase(driver(), () => 1000)
        await database.insert(schema.settingsSections).values({ section: "library", content: { libraryPaths: ["a"], autoScan: true }, changedAt: 7 })
        await database.insert(schema.homeItems).values({ position: 0, itemId: "x", kind: "kind", options: { rows: 2 } })
        const again = await openCoreDatabase(driver(), () => 2000)
        expect(await again.select().from(schema.settingsSections)).toEqual([{ section: "library", content: { libraryPaths: ["a"], autoScan: true }, changedAt: 7 }])
        expect(await again.select().from(schema.homeItems)).toEqual([{ position: 0, itemId: "x", kind: "kind", schemaVersion: 0, options: { rows: 2 } }])
    })

    it("undo a transaction that fails halfway", async () => {
        const database = await openCoreDatabase(driver(), () => 1000)
        await expect(database.transaction(async transaction => {
            await transaction.insert(schema.homeItems).values({ position: 0, itemId: "x", kind: "kind" })
            await transaction.insert(schema.homeItems).values({ position: 0, itemId: "twice", kind: "kind" })
        })).rejects.toThrow()
        expect(await database.select().from(schema.homeItems)).toEqual([])
    })

    it("run pieces of work one after the other, also after one failed", async () => {
        const database = await openCoreDatabase(driver(), () => 1000)
        const order: string[] = []
        const slow = inOrder(database, async () => {
            await new Promise(resolve => setTimeout(resolve, 20))
            order.push("first")
        })
        const failing = inOrder(database, async () => {
            order.push("second")
            throw new Error("failed")
        })
        const last = inOrder(database, async () => order.push("third"))
        await expect(failing).rejects.toThrow("failed")
        await Promise.all([slow, last])
        expect(order).toEqual(["first", "second", "third"])
    })
})

describe("the database's line (5a-2b)", () => {
    it("waits through waitInLine only while the work before is not done, and keeps the order", async () => {
        const waited: string[] = []
        const database = await openCoreDatabase(sqlDriverFor(openDatabaseSync("line.db") as never), () => 0, async pending => {
            waited.push("line")
            return pending
        })
        const done: string[] = []
        // the same caller one after the other: the work before is done, nothing is waited for
        await inOrder(database, async () => void done.push("a"))
        await inOrder(database, async () => void done.push("b"))
        expect(waited).toEqual([])
        // two at once: the second waits for the first
        let release = () => {}
        const first = inOrder(database, () => new Promise<void>(resolve => (release = () => (done.push("c"), resolve()))))
        const second = inOrder(database, async () => void done.push("d"))
        await Promise.resolve()
        expect(waited).toEqual(["line"])
        release()
        await Promise.all([first, second])
        expect(done).toEqual(["a", "b", "c", "d"])
        // a failed work does not stop the line
        await expect(inOrder(database, async () => { throw new Error("x") })).rejects.toThrow("x")
        await inOrder(database, async () => void done.push("e"))
        expect(done.at(-1)).toBe("e")
    })
})
