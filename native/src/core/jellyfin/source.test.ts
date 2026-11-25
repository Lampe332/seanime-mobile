// geschrieben nach: Seanime_Jellyfin_Plan.md §2, §3 und §5 Punkt 2 und dem Aufbau von core/nakama/guest.test.ts; der Server ist hier ein Test-Double, alle Titel, Kennungen und das Token sind erfunden

import { beforeEach, describe, expect, it } from "vitest"
import { sqlDriverFor } from "@/api/client/core-database"
import { forgetDatabases, openDatabaseSync } from "../../../test/expo-sqlite"
import type { HttpFetch } from "../anilist/client"
import { type CoreDatabase, openCoreDatabase } from "../database/database"
import { anilistListEntries, anilistMedia, mediaserverMappings, mediaserverSeries, settingsSections } from "../database/schema"
import { type CoreEnvironment, matchCoreRoute } from "../registry"
import {
    MEDIASERVER_TOKEN_SECRET,
    forgetServerSource,
    keepServerToken,
    removeServerMapping,
    saveServerMapping,
    saveServerSettings,
    serverFileOfPath,
    serverSettingsOf,
    unassignedServerShows,
    withServerFiles,
    withServerLibrary,
} from "./source"

type Json = Record<string, unknown>
const BASE = "https://media.example/jellyfin"
const TOKEN = "made-up-server-token"
const [SERVER_ONLY, UNSURE, OWN, NAKAMA, ABSENT] = [201, 202, 203, 204, 205]
const NAMES: Record<number, string> = { 201: "Crimson Harbor", 202: "Silent Orchard", 203: "Paper Lantern", 204: "Iron Meadow", 205: "Glass Tide" }
const SERIES = [
    { id: "sA", name: NAMES[SERVER_ONLY], ids: { AniList: "201" } },
    { id: "sB", name: NAMES[UNSURE], ids: {} },
    { id: "sC", name: NAMES[OWN], ids: { AniList: "203" } },
    { id: "sD", name: NAMES[NAKAMA], ids: { AniList: "204" } },
]

let now = Date.UTC(2026, 10, 25)
let database: CoreDatabase | null = null
let silent = false
let status = 200
let calls: { url: string, headers: Record<string, string> }[] = []
const secrets = new Map<string, string>()

const media = (id: number) => ({ id, status: "FINISHED", episodes: 2, format: "TV", title: { userPreferred: NAMES[id], romaji: NAMES[id] }, startDate: { year: 2020 } })
const answer = (code: number, data: unknown) => ({ status: code, headers: { get: () => null }, text: async () => JSON.stringify(data) })

const httpFetch = (async (url: string, init: { headers?: Record<string, string>, body?: string }) => {
    if (url.startsWith(BASE)) {
        calls.push({ url, headers: init.headers ?? {} })
        if (silent) throw new TypeError("Network request failed")
        if (status !== 200) return answer(status, {})
        const path = url.slice(BASE.length).split("?")[0]
        if (path === "/Items") {
            return answer(200, { Items: SERIES.map(show => ({ Id: show.id, Type: "Series", Name: show.name, ProductionYear: 2020, ProviderIds: show.ids, Path: "" })), TotalRecordCount: SERIES.length })
        }
        const [, id, kind] = /^\/Shows\/([^/]+)\/(Seasons|Episodes)$/.exec(path) ?? []
        if (kind === "Seasons") return answer(200, { Items: [{ Id: `${id}-s1`, SeriesId: id, IndexNumber: 1, Name: "Season 1", ProductionYear: 2020, ProviderIds: {} }] })
        if (kind === "Episodes") {
            return answer(200, { Items: [1, 2].map(number => ({
                Id: `${id}-e${number}`, SeriesId: id, SeasonId: `${id}-s1`, ParentIndexNumber: 1, IndexNumber: number, Name: `Made ${number}`, ProviderIds: {},
                MediaSources: [{ Id: `${id}-m${number}`, Container: "mkv", MediaStreams: [] }],
            })) })
        }
        return answer(404, {})
    }
    if (url.includes("anilist.co")) return answer(200, { data: { Media: media(Number((JSON.parse(init.body ?? "{}") as { variables?: { id?: number } }).variables?.id)) } })
    if (url.startsWith("https://api.ani.zip")) return answer(404, {})
    throw new TypeError(`no network in tests: ${url}`)
}) as unknown as HttpFetch

const environment = {
    fetch: httpFetch,
    secret: async (name: string) => secrets.get(name) ?? null,
    keepSecret: async (name: string, value: string | null) => void (value === null ? secrets.delete(name) : secrets.set(name, value)),
    database: async () => database ??= await openCoreDatabase(sqlDriverFor(openDatabaseSync("core.db") as never), () => now),
    now: () => now,
    pause: async () => {},
} as unknown as CoreEnvironment

const ownEntry = { media: media(OWN), mediaId: OWN, libraryData: { allFilesLocked: false, sharedPath: "/made", unwatchedCount: 1, mainFileCount: 1 } }
const nakamaEntry = { media: media(NAKAMA), mediaId: NAKAMA, nakamaLibraryData: { unwatchedCount: 2, mainFileCount: 2 } }
const collection = () => ({ lists: [{ type: "CURRENT", status: "CURRENT", entries: [ownEntry, nakamaEntry] }], stats: { totalEntries: 2 } })

function entriesOf(result: unknown): Json[] {
    return ((result as { lists: { entries: Json[] }[] }).lists).flatMap(list => list.entries)
}

beforeEach(async () => {
    forgetDatabases()
    forgetServerSource()
    database = null
    silent = false
    status = 200
    calls = []
    secrets.clear()
    now = Date.UTC(2026, 10, 25)
    const opened = await environment.database()
    for (const id of [SERVER_ONLY, UNSURE, OWN, NAKAMA, ABSENT]) {
        const [kept] = await opened.insert(anilistMedia).values({ anilistId: id, kind: "ANIME", content: media(id), changedAt: now }).returning({ id: anilistMedia.id })
        await opened.insert(anilistListEntries).values({ anilistId: id, media: kept.id, kind: "ANIME", list: 0, position: id,
            content: { id, progress: 1, status: "CURRENT", score: 0, repeat: 0, startedAt: {}, completedAt: {}, createdAt: 1, updatedAt: 2 }, changedAt: now })
    }
    await saveServerSettings({ serverId: "srv-1", url: `${BASE}/`, userId: "u1", username: "made", device: "Pixel", deviceId: "dev-1", version: "4.2.0", token: TOKEN }, environment)
})

describe("the media server in the library", () => {
    it("shows a title the server has for certain, under the user's list status", async () => {
        const entry = entriesOf(await withServerLibrary(collection(), environment)).find(item => item.mediaId === SERVER_ONLY)
        expect(entry?.libraryData).toMatchObject({ mainFileCount: 2, unwatchedCount: 1 })
        expect(entry?.mediaServerLibraryData).toEqual({ serverId: "srv-1", seriesId: "sA", unwatchedCount: 1, mainFileCount: 2 })
        expect(entry?.listData).toMatchObject({ progress: 1, status: "CURRENT" })
        expect((await (await environment.database()).select().from(mediaserverSeries)).map(row => row.seriesId).sort()).toEqual(["sA", "sB", "sC", "sD"])
    })

    it("keeps an own title and its files as they are: they come first", async () => {
        const entries = entriesOf(await withServerLibrary(collection(), environment))
        expect(entries.filter(item => item.mediaId === OWN)).toEqual([ownEntry])
        expect(entries.find(item => item.mediaId === OWN)).toBe(ownEntry)
        const page = { mediaId: OWN, media: media(OWN), libraryData: ownEntry.libraryData, episodes: [], localFiles: [{ path: "/made/1.mkv" }] }
        expect(await withServerFiles(page, environment)).toBe(page)
    })

    it("lets Nakama come before the media server", async () => {
        const entries = entriesOf(await withServerLibrary(collection(), environment))
        expect(entries.filter(item => item.mediaId === NAKAMA)).toEqual([nakamaEntry])
        expect(entries.find(item => item.mediaId === NAKAMA)).toBe(nakamaEntry)
        const page = { mediaId: NAKAMA, media: media(NAKAMA), libraryData: { mainFileCount: 2 }, _isNakamaEntry: true }
        expect(await withServerFiles(page, environment)).toBe(page)
    })

    it("leaves the library unchanged when the server is silent, answers with an error or is not signed in", async () => {
        const given = collection()
        silent = true
        expect(await withServerLibrary(given, environment)).toBe(given)
        silent = false
        status = 500
        expect(await withServerLibrary(given, environment)).toBe(given)
        const page = { mediaId: SERVER_ONLY, media: media(SERVER_ONLY) }
        expect(await withServerFiles(page, environment)).toBe(page)
        status = 200
        await saveServerSettings({ token: "" }, environment)
        calls = []
        expect(await withServerLibrary(given, environment)).toBe(given)
        expect(calls).toEqual([])
    })

    it("hides an uncertain match but names it among the series that are not assigned", async () => {
        const entries = entriesOf(await withServerLibrary(collection(), environment))
        expect(entries.some(item => item.mediaId === UNSURE)).toBe(false)
        const page = { mediaId: UNSURE, media: media(UNSURE) }
        expect(await withServerFiles(page, environment)).toBe(page)
        const unassigned = await unassignedServerShows(environment)
        expect(unassigned).toEqual([{ serverId: "srv-1", seriesId: "sB", name: NAMES[UNSURE], year: 2020, type: "Series", suggestion: { anilistId: UNSURE, rule: "S4", episodes: 2 } }])
    })

    it("lets a row made by hand beat the automatic match, and gives it back when the row is taken away", async () => {
        await saveServerMapping({ itemId: "sA", mediaId: ABSENT }, environment)
        expect(await (await environment.database()).select().from(mediaserverMappings)).toEqual([{ serverId: "srv-1", itemId: "sA", mediaId: ABSENT, episodeOffset: 0, origin: "manual", changedAt: now }])
        let entries = entriesOf(await withServerLibrary(collection(), environment))
        expect(entries.find(item => item.mediaId === ABSENT)?.mediaServerLibraryData).toMatchObject({ seriesId: "sA", mainFileCount: 2 })
        expect(entries.some(item => item.mediaId === SERVER_ONLY)).toBe(false)
        await saveServerMapping({ itemId: "sB", mediaId: UNSURE, episodeOffset: 1 }, environment)
        entries = entriesOf(await withServerLibrary(collection(), environment))
        expect(entries.find(item => item.mediaId === UNSURE)?.mediaServerLibraryData).toMatchObject({ seriesId: "sB", mainFileCount: 1 })
        await removeServerMapping("sA", environment)
        entries = entriesOf(await withServerLibrary(collection(), environment))
        expect(entries.some(item => item.mediaId === ABSENT)).toBe(false)
        expect(entries.some(item => item.mediaId === SERVER_ONLY)).toBe(true)
    })

    it("answers the anime page of a server title with the server's episodes, through the core's route", async () => {
        const matched = matchCoreRoute("GET", `/api/v1/library/anime-entry/${SERVER_ONLY}`)
        if (!matched) throw new Error("no route")
        const page = await matched.route.answer({ path: matched.path, query: null, body: null }, environment) as Json
        expect(page._isMediaServerEntry).toBe(true)
        expect(page.libraryData).toMatchObject({ mainFileCount: 2, unwatchedCount: 1 })
        const episodes = page.episodes as Json[]
        expect(episodes.map(episode => [episode.episodeNumber, episode._isMediaServerEpisode, episode.mediaServerEpisode])).toEqual([
            [1, true, { serverId: "srv-1", seriesId: "sA", episodeId: "sA-e1" }],
            [2, true, { serverId: "srv-1", seriesId: "sA", episodeId: "sA-e2" }],
        ])
        expect((page.nextEpisode as Json).episodeNumber).toBe(2)
        const paths = (page.localFiles as Json[]).map(file => file.path as string)
        expect(paths.map(serverFileOfPath)).toEqual([{ serverId: "srv-1", episodeId: "sA-e1" }, { serverId: "srv-1", episodeId: "sA-e2" }])
        expect(JSON.stringify(page)).not.toContain(TOKEN)
    })
})

describe("the media server's token", () => {
    it("lives only in the safe store: not in the settings, not in an address, and a password is never kept", async () => {
        const rest = await keepServerToken({ library: { autoScan: true }, mediaserver: { token: "second-token", password: "made-up-pass", sendProgress: true } }, environment)
        expect(rest).toEqual({ library: { autoScan: true } })
        expect(secrets.get(MEDIASERVER_TOKEN_SECRET)).toBe("second-token")
        expect(await serverSettingsOf(environment)).toEqual({ serverId: "srv-1", url: BASE, userId: "u1", username: "made", device: "Pixel", deviceId: "dev-1", version: "4.2.0", sendProgress: true })
        const kept = JSON.stringify(await (await environment.database()).select().from(settingsSections))
        for (const secret of [TOKEN, "second-token", "made-up-pass"]) expect(kept).not.toContain(secret)
        await withServerLibrary(collection(), environment)
        expect(calls.length).toBeGreaterThan(0)
        for (const call of calls) {
            expect(call.url).not.toContain("second-token")
            expect(call.headers.Authorization).toContain("Token=\"second-token\"")
        }
        expect(JSON.stringify(await (await environment.database()).select().from(mediaserverSeries))).not.toContain("second-token")
    })

    it("empties the kept series when the user signs out", async () => {
        await withServerLibrary(collection(), environment)
        await saveServerSettings({ token: null }, environment)
        expect(secrets.has(MEDIASERVER_TOKEN_SECRET)).toBe(false)
        expect(await (await environment.database()).select().from(mediaserverSeries)).toEqual([])
    })
})
