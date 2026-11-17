// geschrieben nach: Auftrag „Sichern + Wiederherstellen“ (15.11.2026) und dem Schema des Kerns (database/schema.ts); Werte erfunden, keine Anfrage verlässt den Test

import { beforeEach, describe, expect, it } from "vitest"
import { sqlDriverFor } from "@/api/client/core-database"
import { forgetDatabases, openDatabaseSync } from "../../../test/expo-sqlite"
import { LOCAL_LISTS_QUESTION } from "../anilist/changes"
import { keepCollection, storedAnswer, storedCollection } from "../anilist/store"
import { type CoreDatabase, openCoreDatabase } from "../database/database"
import {
    account,
    anilistChanges,
    appearance,
    extensionUserConfigs,
    homeItems,
    mangaPreferences,
    playlists,
    settingsSections,
    torrentKept,
    watchPositions,
} from "../database/schema"
import { disabledIds } from "../extensions/manage/installed"
import type { ExtensionPlace } from "../extensions/manage/installed"
import type { CoreEnvironment } from "../registry"
import { BACKUP_FORMAT_VERSION, type BackupFile, backupFileName, backupSummary, makeBackup, readBackup, restoreBackup } from "./backup"

type Json = Record<string, unknown>

const CLOCK = Date.parse("2026-11-15T10:00:00.000Z")
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl"

/** One device: its database, its extensions folder and file cache, its secured storage */
function device(name: string) {
    let database: Promise<CoreDatabase> | null = null
    const files = new Map<string, string>()
    const cache = new Map<string, string>()
    const secrets = new Map<string, string>()
    const place = {
        folder: {
            names: async () => [...files.keys()],
            read: async (file: string) => files.get(file) ?? null,
            write: async (file: string, text: string) => void files.set(file, text),
            remove: async (file: string) => void files.delete(file),
            stamp: async (file: string) => (files.has(file) ? `${files.get(file)!.length}.0` : null),
        },
        serverCache: async (bucket: string) => cache.get(bucket) ?? null,
        serverCacheStamp: async () => null,
        writeServerCache: async (bucket: string, text: string) => void cache.set(bucket, text),
    } as unknown as ExtensionPlace
    const environment = {
        database: () => database ??= openCoreDatabase(sqlDriverFor(openDatabaseSync(name) as never), () => CLOCK),
        secret: async (key: string) => secrets.get(key) ?? null,
        now: () => CLOCK,
        extensions: async () => place,
    } as unknown as CoreEnvironment
    return { environment, files, cache, secrets, place, db: () => environment.database() }
}

const manifest = (id: string) => JSON.stringify({ id, name: `Ext ${id}`, version: "1.0.0", type: "onlinestream-provider", language: "typescript", payload: "class Provider {}" })
const collection = (mediaId: number, progress: number) => ({
    MediaListCollection: { lists: [{ status: "CURRENT", name: "Watching", isCustomList: false, entries: [{ id: -mediaId, status: "CURRENT", progress, score: 0, media: { id: mediaId, title: { userPreferred: `Title ${mediaId}` } } }] }] },
})

/** A device with something of every kind, the local account (no AniList account) signed in */
async function filled() {
    const one = device("a.db")
    const db = await one.db()
    await db.insert(settingsSections).values([
        { section: "torrent", content: { defaultTorrentClient: "qbittorrent", qbittorrentPassword: "hunter2", qbittorrentHost: "127.0.0.1" }, changedAt: CLOCK },
        { section: "nakama", content: { enabled: true, remoteServerURL: "http://192.0.2.10:43211", remoteServerPassword: "nakama-pass" }, changedAt: CLOCK },
        { section: "library", content: { autoUpdateProgress: true }, changedAt: CLOCK },
    ])
    await db.insert(appearance).values({ id: 1, content: { accentColor: "#ff00aa" }, createdAt: CLOCK, changedAt: CLOCK })
    await db.insert(homeItems).values([{ position: 0, itemId: "continue", kind: "continue-watching", schemaVersion: 1, options: null }, { position: 1, itemId: "lib", kind: "library", schemaVersion: 1, options: { grid: true } }])
    await db.insert(watchPositions).values({ mediaId: 21, kind: "onlinestream", episodeNumber: 3, positionSeconds: 612.5, durationSeconds: 1420, filepath: "", addedAt: CLOCK, changedAt: CLOCK, expiresAt: null })
    await db.insert(anilistChanges).values({ account: "", mediaId: 30, kind: "ANIME", action: "save", change: { fields: { progress: 2 }, base: null }, createdAt: CLOCK, changedAt: CLOCK })
    await db.insert(extensionUserConfigs).values({ id: "ext-a", version: 1, values: { language: "de", apiKey: "abc123" }, origin: "core", changedAt: CLOCK })
    await db.insert(mangaPreferences).values({ mediaId: 99, provider: "ext-b", filters: { scanlators: ["x"] }, origin: "core", changedAt: CLOCK })
    await db.insert(playlists).values([{ name: "Evening", episodes: [{ mediaId: 21, episodeNumber: 4 }], createdAt: CLOCK, updatedAt: CLOCK }])
    await db.insert(torrentKept).values({ key: "settings", content: { autoSelect: true, slowSeeding: false }, changedAt: CLOCK })
    await keepCollection(db, "ANIME", collection(21, 3), CLOCK)
    one.files.set("ext-a.json", manifest("ext-a"))
    one.files.set("ext-b.json", manifest("ext-b"))
    one.cache.set("extension-settings", JSON.stringify({ 1: { value: { disabledExtensionIds: { "ext-b": true } } } }))
    one.secrets.set("seanime-nakama-host-password", "nakama-pass")
    return one
}

const PREFERENCES = {
    "seanime-mobile-language": "\"de\"",
    "marketplace-url": "\"https://example.org/marketplace.json\"",
    "sea-server-auth-token": `"${JWT}"`,
    "debrid-settings": JSON.stringify({ provider: "realdebrid", apiKey: "debrid-key" }),
}

/** A file without its time, to compare two of them */
const comparable = ({ createdAt: _createdAt, ...file }: BackupFile) => file

beforeEach(() => {
    forgetDatabases()
})

describe("making a backup", () => {
    it("holds every part, versioned, without any password, key or token", async () => {
        const one = await filled()
        const file = await makeBackup(one.environment, { appVersion: "4.0.0", preferences: PREFERENCES })
        const text = JSON.stringify(file)
        expect(file).toMatchObject({ format: "seanime-mobile-backup", formatVersion: BACKUP_FORMAT_VERSION, appVersion: "4.0.0", createdAt: "2026-11-15T10:00:00.000Z" })
        for (const secret of ["hunter2", "nakama-pass", "abc123", "debrid-key", JWT, "qbittorrentPassword", "remoteServerPassword", "sea-server-auth-token"]) expect(text).not.toContain(secret)
        expect(file.tables.settings?.find(row => row.section === "torrent")?.content).toEqual({ defaultTorrentClient: "qbittorrent", qbittorrentHost: "127.0.0.1" })
        expect(file.preferences).toEqual({ "seanime-mobile-language": "\"de\"", "marketplace-url": "\"https://example.org/marketplace.json\"", "debrid-settings": "{\"provider\":\"realdebrid\"}" })
        expect(file.extensions).toEqual({ files: { "ext-a.json": manifest("ext-a"), "ext-b.json": manifest("ext-b") }, disabled: ["ext-b"] })
        expect(backupSummary(file)).toEqual({
            appVersion: "4.0.0", createdAt: "2026-11-15T10:00:00.000Z", extensions: 2, playlists: 1, watchPositions: 1, settings: 3, homeItems: 2,
            waitingChanges: 1, localListEntries: 1, mangaPreferences: 1, preferences: 3,
        })
    })

    it("takes the lists only of the local account; signed in, AniList's lists stay out", async () => {
        const one = await filled()
        await (await one.db()).insert(account).values({ id: 1, username: "someone", createdAt: CLOCK, changedAt: CLOCK })
        one.secrets.set("seanime-core.account-token", "t")
        expect((await makeBackup(one.environment, { appVersion: "4.0.0", preferences: {} })).localLists).toBeNull()
    })
})

describe("the file name", () => {
    it("is seanime-mobile-backup-YYYY-MM-DD.json by the device's own calendar day, with two-digit month and day", () => {
        expect(backupFileName(new Date(2026, 0, 5, 23, 59))).toBe("seanime-mobile-backup-2026-01-05.json")
        expect(backupFileName(new Date(2026, 10, 15, 0, 1))).toBe("seanime-mobile-backup-2026-11-15.json")
    })
})

describe("reading a file", () => {
    it("refuses what is not a backup, a newer format and a file name that is a path", async () => {
        const file = JSON.stringify(await makeBackup((await filled()).environment, { appVersion: "4.0.0", preferences: {} }))
        expect(() => readBackup("not json")).toThrow("not a backup")
        expect(() => readBackup(JSON.stringify({ format: "other" }))).toThrow("not a backup")
        expect(() => readBackup(file.replace(`"formatVersion":${BACKUP_FORMAT_VERSION}`, "\"formatVersion\":99"))).toThrow("newer app version")
        expect(() => readBackup(file.replace("\"ext-a.json\"", "\"../ext-a.json\""))).toThrow("extensions are broken")
        expect(() => readBackup(file.replace("\"playlists\":[", "\"playlists\":[1,"))).toThrow("\"playlists\" is broken")
        expect(readBackup(file).appVersion).toBe("4.0.0")
    })
})

describe("restoring", () => {
    it("round trip: back up, restore into an empty core, back up again: the same", async () => {
        const one = await filled()
        const file = await makeBackup(one.environment, { appVersion: "4.0.0", preferences: PREFERENCES })
        const two = device("b.db")
        const { preferences } = await restoreBackup(two.environment, readBackup(JSON.stringify(file)), "replace")
        expect(preferences).toEqual(file.preferences)
        const again = await makeBackup(two.environment, { appVersion: "4.0.0", preferences })
        expect(comparable(again)).toEqual(comparable(file))
        expect(two.files.size).toBe(2)
        expect([...await disabledIds(two.place)]).toEqual(["ext-b"])
        expect(await storedCollection(await two.db(), "ANIME")).toEqual(await storedCollection(await one.db(), "ANIME"))
    })

    it("replace keeps the passwords the device has and removes extensions the file does not have", async () => {
        const one = await filled()
        const file = await makeBackup(one.environment, { appVersion: "4.0.0", preferences: {} })
        const two = device("b.db")
        const db = await two.db()
        await db.insert(settingsSections).values({ section: "torrent", content: { defaultTorrentClient: "transmission", qbittorrentPassword: "device-pw" }, changedAt: CLOCK })
        two.files.set("ext-old.json", manifest("ext-old"))
        await restoreBackup(two.environment, file, "replace")
        const torrent = (await db.select().from(settingsSections)).find(row => row.section === "torrent")
        expect(torrent?.content).toEqual({ defaultTorrentClient: "qbittorrent", qbittorrentHost: "127.0.0.1", qbittorrentPassword: "device-pw" })
        expect([...two.files.keys()].sort()).toEqual(["ext-a.json", "ext-b.json"])
    })

    it("a file made by hand brings no password, key or token into the settings, in neither mode", async () => {
        const one = await filled()
        const made = await makeBackup(one.environment, { appVersion: "4.0.0", preferences: {} })
        const byHand = JSON.parse(JSON.stringify(made)) as BackupFile
        const section = (name: string) => byHand.tables.settings!.find(row => row.section === name)!
        section("torrent").content = { ...(section("torrent").content as Json), qbittorrentPassword: "from-file" }
        byHand.tables.settings!.push({ section: "mediaPlayer", content: { host: "192.0.2.20", vlcPassword: "from-file", nested: { apiKey: "from-file", port: 8080 } }, changedAt: CLOCK })
        byHand.tables.extensionConfigs![0]!.values = { language: "de", apiKey: "from-file", session: JWT }
        byHand.tables.torrentKept![0]!.content = { autoSelect: true, slowSeeding: false, token: "from-file" }
        for (const mode of ["replace", "merge"] as const) {
            forgetDatabases()
            const two = device(`${mode}.db`)
            const db = await two.db()
            if (mode === "replace") await db.insert(settingsSections).values({ section: "torrent", content: { qbittorrentPassword: "device-pw" }, changedAt: CLOCK })
            await restoreBackup(two.environment, readBackup(JSON.stringify(byHand)), mode)
            const settings = await db.select().from(settingsSections)
            expect(settings.find(row => row.section === "mediaPlayer")?.content).toEqual({ host: "192.0.2.20", nested: { port: 8080 } })
            expect((settings.find(row => row.section === "torrent")?.content as Json).qbittorrentPassword).toBe(mode === "replace" ? "device-pw" : undefined)
            expect((await db.select().from(extensionUserConfigs))[0]?.values).toEqual({ language: "de" })
            expect((await db.select().from(torrentKept))[0]?.content).toEqual({ autoSelect: true, slowSeeding: false })
            expect(JSON.stringify(await db.select().from(settingsSections))).not.toContain("from-file")
        }
    })

    it("merge keeps what the device has and adds only what is missing", async () => {
        const one = await filled()
        const file = await makeBackup(one.environment, { appVersion: "4.0.0", preferences: PREFERENCES })
        const two = device("b.db")
        const db = await two.db()
        await db.insert(settingsSections).values({ section: "library", content: { autoUpdateProgress: false }, changedAt: CLOCK })
        await db.insert(playlists).values([{ name: "Evening", episodes: [], createdAt: CLOCK, updatedAt: CLOCK }, { name: "Mine", episodes: [], createdAt: CLOCK, updatedAt: CLOCK }])
        await db.insert(homeItems).values({ position: 0, itemId: "mine", kind: "library", schemaVersion: 1, options: null })
        two.files.set("ext-a.json", "{\"id\":\"ext-a\",\"version\":\"2.0.0\"}")
        const { preferences } = await restoreBackup(two.environment, file, "merge", { preferences: { "seanime-mobile-language": "\"en\"" } })

        const sections = Object.fromEntries((await db.select().from(settingsSections)).map(row => [row.section, row.content]))
        expect(sections.library).toEqual({ autoUpdateProgress: false })
        expect(Object.keys(sections).sort()).toEqual(["library", "nakama", "torrent"])
        expect((await db.select().from(playlists)).map(row => row.name).sort()).toEqual(["Evening", "Mine"])
        expect((await db.select().from(homeItems)).map(row => row.itemId)).toEqual(["mine"])
        expect(two.files.get("ext-a.json")).toContain("2.0.0")
        expect(two.files.get("ext-b.json")).toBe(manifest("ext-b"))
        expect([...await disabledIds(two.place)]).toEqual(["ext-b"])
        expect(await db.select().from(anilistChanges)).toHaveLength(1)
        expect(preferences).toEqual({ "marketplace-url": "\"https://example.org/marketplace.json\"", "debrid-settings": "{\"provider\":\"realdebrid\"}" })
    })

    it("signed in to AniList, the local lists of the file are put aside for the upload, AniList's lists stay", async () => {
        const one = await filled()
        const file = await makeBackup(one.environment, { appVersion: "4.0.0", preferences: {} })
        const two = device("b.db")
        const db = await two.db()
        await db.insert(account).values({ id: 1, username: "someone", createdAt: CLOCK, changedAt: CLOCK })
        two.secrets.set("seanime-core.account-token", "t")
        await keepCollection(db, "ANIME", collection(500, 9), CLOCK)
        await restoreBackup(two.environment, file, "replace")
        expect((await storedCollection(db, "ANIME"))?.MediaListCollection.lists[0].entries?.[0]).toMatchObject({ progress: 9 })
        expect(await storedAnswer(db, LOCAL_LISTS_QUESTION("ANIME"))).toEqual(file.localLists?.ANIME)
        // and a backup of that device carries them on
        expect((await makeBackup(two.environment, { appVersion: "4.0.0", preferences: {} })).localLists?.ANIME).toEqual(file.localLists?.ANIME)
    })

    it("a restore of a file without extensions in a merge leaves the folder alone", async () => {
        const two = device("b.db")
        two.files.set("ext-a.json", manifest("ext-a"))
        const empty = readBackup(JSON.stringify({ format: "seanime-mobile-backup", formatVersion: 1, appVersion: "4.0.0", createdAt: "", tables: {}, extensions: { files: {}, disabled: [] }, localLists: null, preferences: {} as Json }))
        await restoreBackup(two.environment, empty, "merge")
        expect([...two.files.keys()]).toEqual(["ext-a.json"])
    })
})
