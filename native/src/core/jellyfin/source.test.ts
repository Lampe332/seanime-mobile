// geschrieben nach: Seanime_Jellyfin_Plan.md §2, §3 und §5 Punkt 2 und dem Aufbau von core/nakama/guest.test.ts; der Server ist hier ein Test-Double, alle Titel, Kennungen und das Token sind erfunden

import { eq } from "drizzle-orm"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { sqlDriverFor } from "@/api/client/core-database"
import { forgetDatabases, openDatabaseSync } from "../../../test/expo-sqlite"
import type { HttpFetch } from "../anilist/client"
import { type CoreDatabase, openCoreDatabase } from "../database/database"
import { anilistListEntries, anilistMedia, mediaserverMappings, mediaserverSeries, settingsSections } from "../database/schema"
import { type CoreEvent, onCoreEvent } from "../events"
import { libraryEntry } from "../library/library"
import { type CoreEnvironment, matchCoreRoute } from "../registry"
import {
    MEDIASERVER_TOKEN_SECRET,
    RETRY_PAUSE_MS,
    SERIES_FRESH_MS,
    forgetServerSource,
    keepServerToken,
    playServerFile,
    refreshServerLibrary,
    removeServerMapping,
    saveServerMapping,
    saveServerSettings,
    serverFileOfPath,
    serverOverview,
    serverSettingsOf,
    serverStreamAddress,
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
/** Set: the server never answers until the test lets go (the fetch ignores the signal, as a stuck one would) */
let stuck: (() => void)[] | null = null
/** The readings started in the background (the host's `unasked`), so that a test can wait for them instead of a timer */
let background: Promise<unknown>[] = []
let secretReads = 0
/** The `IndexNumber`s of each series' episodes on the server */
let serverEpisodeNumbers = [1, 2]
const readingsDone = () => Promise.all(background.map(work => work.catch(() => undefined)))

const media = (id: number) => ({ id, status: "FINISHED", episodes: 2, format: "TV", title: { userPreferred: NAMES[id], romaji: NAMES[id] }, startDate: { year: 2020 } })
const answer = (code: number, data: unknown) => ({ status: code, headers: { get: () => null }, text: async () => JSON.stringify(data) })

const httpFetch = (async (url: string, init: { headers?: Record<string, string>, body?: string }) => {
    if (url.startsWith(BASE)) {
        calls.push({ url, headers: init.headers ?? {} })
        const held = stuck
        if (held) await new Promise<void>(resolve => held.push(resolve))
        if (silent) throw new TypeError("Network request failed")
        if (status !== 200) return answer(status, {})
        const path = url.slice(BASE.length).split("?")[0]
        if (path === "/Items") {
            return answer(200, { Items: SERIES.map(show => ({ Id: show.id, Type: "Series", Name: show.name, ProductionYear: 2020, ProviderIds: show.ids, Path: "" })), TotalRecordCount: SERIES.length })
        }
        const [, id, kind] = /^\/Shows\/([^/]+)\/(Seasons|Episodes)$/.exec(path) ?? []
        if (kind === "Seasons") return answer(200, { Items: [{ Id: `${id}-s1`, SeriesId: id, IndexNumber: 1, Name: "Season 1", ProductionYear: 2020, ProviderIds: {} }] })
        if (kind === "Episodes") {
            return answer(200, { Items: serverEpisodeNumbers.map(number => ({
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
    secret: async (name: string) => (secretReads++, secrets.get(name) ?? null),
    keepSecret: async (name: string, value: string | null) => void (value === null ? secrets.delete(name) : secrets.set(name, value)),
    database: async () => database ??= await openCoreDatabase(sqlDriverFor(openDatabaseSync("core.db") as never), () => now),
    now: () => now,
    pause: async () => {},
    unasked: (_what: string, work: () => Promise<unknown>) => {
        const running = work()
        background.push(running)
        return running
    },
} as unknown as CoreEnvironment

/** The server read once, as "read again" in the settings does it */
const readServer = () => refreshServerLibrary(environment)

const ownEntry = { media: media(OWN), mediaId: OWN, libraryData: { allFilesLocked: false, sharedPath: "/made", unwatchedCount: 1, mainFileCount: 1 } }
const nakamaEntry = { media: media(NAKAMA), mediaId: NAKAMA, nakamaLibraryData: { unwatchedCount: 2, mainFileCount: 2 } }
const collection = () => ({ lists: [{ type: "CURRENT", status: "CURRENT", entries: [ownEntry, nakamaEntry] }], stats: { totalEntries: 2 } })

function entriesOf(result: unknown): Json[] {
    return ((result as { lists: { entries: Json[] }[] }).lists).flatMap(list => list.entries)
}

beforeEach(async () => {
    await readingsDone()
    forgetDatabases()
    forgetServerSource()
    database = null
    silent = false
    status = 200
    calls = []
    stuck = null
    background = []
    serverEpisodeNumbers = [1, 2]
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
        await readServer()
        const entry = entriesOf(await withServerLibrary(collection(), environment)).find(item => item.mediaId === SERVER_ONLY)
        expect(entry?.libraryData).toMatchObject({ mainFileCount: 2, unwatchedCount: 1 })
        expect(entry?.mediaServerLibraryData).toEqual({ serverId: "srv-1", seriesId: "sA", unwatchedCount: 1, mainFileCount: 2 })
        expect(entry?.listData).toMatchObject({ progress: 1, status: "CURRENT" })
        expect((await (await environment.database()).select().from(mediaserverSeries)).map(row => row.seriesId).sort()).toEqual(["sA", "sB", "sC", "sD"])
    })

    it("keeps an own title and its files as they are: they come first", async () => {
        await readServer()
        const entries = entriesOf(await withServerLibrary(collection(), environment))
        expect(entries.filter(item => item.mediaId === OWN)).toEqual([ownEntry])
        expect(entries.find(item => item.mediaId === OWN)).toBe(ownEntry)
        const page = { mediaId: OWN, media: media(OWN), libraryData: ownEntry.libraryData, episodes: [], localFiles: [{ path: "/made/1.mkv" }] }
        expect(await withServerFiles(page, environment)).toBe(page)
    })

    it("lets Nakama come before the media server", async () => {
        await readServer()
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
        await readServer()
        const entries = entriesOf(await withServerLibrary(collection(), environment))
        expect(entries.some(item => item.mediaId === UNSURE)).toBe(false)
        const page = { mediaId: UNSURE, media: media(UNSURE) }
        expect(await withServerFiles(page, environment)).toBe(page)
        const unassigned = await unassignedServerShows(environment)
        expect(unassigned).toEqual([{ serverId: "srv-1", seriesId: "sB", name: NAMES[UNSURE], year: 2020, type: "Series", seasons: [{ id: "sB-s1", name: "Season 1", index: 1, episodes: 2 }], suggestion: { anilistId: UNSURE, rule: "S4", episodes: 2 } }])
    })

    it("lets a row made by hand beat the automatic match, and gives it back when the row is taken away", async () => {
        await readServer()
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
        await readServer()
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

describe("the anime page of a title the server has only in part", () => {
    it("lists the server's episodes as there, and not among those missing; without the server the page stays as it was", async () => {
        serverEpisodeNumbers = [1, 3]
        const opened = await environment.database()
        await opened.update(anilistMedia).set({ content: { ...media(SERVER_ONLY), episodes: 26 } }).where(eq(anilistMedia.anilistId, SERVER_ONLY))
        await opened.update(anilistListEntries).set({ content: { id: SERVER_ONLY, progress: 0, status: "CURRENT", score: 0, repeat: 0, startedAt: {}, completedAt: {}, createdAt: 1, updatedAt: 2 } })
            .where(eq(anilistListEntries.anilistId, SERVER_ONLY))
        forgetServerSource()
        await readServer()
        const base = await libraryEntry({ path: { id: String(SERVER_ONLY) }, query: null, body: null } as never, environment) as Json
        const missing = (page: Json) => ((page.downloadInfo as Json).episodesToDownload as Json[] | undefined ?? []).map(item => item.episodeNumber)
        const all = Array.from({ length: 26 }, (_, at) => at + 1)
        expect(missing(base)).toEqual(all)
        const page = await withServerFiles(base, environment) as Json
        expect(page._isMediaServerEntry).toBe(true)
        expect((page.episodes as Json[]).map(episode => episode.episodeNumber)).toEqual([1, 3])
        expect(missing(page)).toEqual(all.filter(number => number !== 1 && number !== 3))
        expect({ ...(page.downloadInfo as Json), episodesToDownload: undefined }).toEqual({ ...(base.downloadInfo as Json), episodesToDownload: undefined })
        expect((page.nextEpisode as Json).episodeNumber).toBe(1)
        expect(page.libraryData).toMatchObject({ mainFileCount: 2, unwatchedCount: 2 })
        await saveServerSettings({ token: null }, environment)
        expect(await withServerFiles(base, environment)).toBe(base)
        expect(missing(base)).toEqual(all)
    })
})

describe("reading the server, as the settings page sees it", () => {
    it("says it reads while a reading runs, and no more after it worked or failed", async () => {
        const held: (() => void)[] = []
        stuck = held
        const running = readServer()
        await vi.waitFor(() => expect(held.length).toBeGreaterThan(0))
        expect((await serverOverview(environment)).reading).toBe(true)
        stuck = null
        for (const go of held) go()
        await running
        expect(await serverOverview(environment)).toMatchObject({ reading: false, series: 4, problem: "" })
        silent = true
        await expect(readServer()).rejects.toThrow()
        expect(await serverOverview(environment)).toMatchObject({ reading: false, series: 4, problem: "unreachable" })
    })
})

describe("the media server's token", () => {
    it("lives only in the safe store: not in the settings, not in an address, and a password is never kept", async () => {
        const rest = await keepServerToken({ library: { autoScan: true }, mediaserver: { token: "second-token", password: "made-up-pass", sendProgress: true } }, environment)
        expect(rest).toEqual({ library: { autoScan: true } })
        expect(secrets.get(MEDIASERVER_TOKEN_SECRET)).toBe("second-token")
        expect(await serverSettingsOf(environment)).toEqual({ serverId: "srv-1", serverName: "", url: BASE, userId: "u1", username: "made", device: "Pixel", deviceId: "dev-1", version: "4.2.0", sendProgress: true })
        const kept = JSON.stringify(await (await environment.database()).select().from(settingsSections))
        for (const secret of [TOKEN, "second-token", "made-up-pass"]) expect(kept).not.toContain(secret)
        await readServer()
        expect(calls.length).toBeGreaterThan(0)
        for (const call of calls) {
            expect(call.url).not.toContain("second-token")
            expect(call.headers.Authorization).toContain("Token=\"second-token\"")
        }
        expect(JSON.stringify(await (await environment.database()).select().from(mediaserverSeries))).not.toContain("second-token")
    })

    it("empties the kept series when the user signs out", async () => {
        await readServer()
        await withServerLibrary(collection(), environment)
        await saveServerSettings({ token: null }, environment)
        expect(secrets.has(MEDIASERVER_TOKEN_SECRET)).toBe(false)
        expect(await (await environment.database()).select().from(mediaserverSeries)).toEqual([])
    })
})

describe("the library never waits for the media server", () => {
    const page = () => ({ mediaId: SERVER_ONLY, media: media(SERVER_ONLY) })
    const shown = async () => entriesOf(await withServerLibrary(collection(), environment)).some(item => item.mediaId === SERVER_ONLY)
    const seriesAsked = () => calls.filter(call => new URL(call.url).pathname.endsWith("/Items")).length

    it("answers at once, also when the server never answers", async () => {
        const held: (() => void)[] = []
        stuck = held
        const given = collection()
        expect(await withServerLibrary(given, environment)).toBe(given)
        const opened = page()
        expect(await withServerFiles(opened, environment)).toBe(opened)
        expect(background).toHaveLength(1)
        stuck = null
        silent = true
        for (const go of held) go()
        await readingsDone()
        expect(seriesAsked()).toBe(1)
    })

    it("keeps an old state visible when the server fails", async () => {
        await readServer()
        now += SERIES_FRESH_MS + 1
        silent = true
        expect(await shown()).toBe(true)
        await readingsDone()
        expect(background).toHaveLength(1)
        expect(await shown()).toBe(true)
        expect(await withServerFiles(page(), environment)).toMatchObject({ _isMediaServerEntry: true })
        expect(await (await environment.database()).select().from(mediaserverSeries)).toHaveLength(4)
    })

    it("tries again after a failure only when the pause is over", async () => {
        silent = true
        expect(await shown()).toBe(false)
        await readingsDone()
        expect(background).toHaveLength(1)
        const asked = calls.length
        silent = false
        now += RETRY_PAUSE_MS - 1000
        expect(await shown()).toBe(false)
        await withServerFiles(page(), environment)
        await readingsDone()
        expect(background).toHaveLength(1)
        expect(calls).toHaveLength(asked)
        now += 2000
        expect(await shown()).toBe(false)
        await readingsDone()
        expect(background).toHaveLength(2)
        expect(await shown()).toBe(true)
    })

    it("starts one reading for two requests at once", async () => {
        const given = collection()
        const opened = page()
        expect(await Promise.all([withServerLibrary(given, environment), withServerFiles(opened, environment)])).toEqual([given, opened])
        await readingsDone()
        expect(background).toHaveLength(1)
        expect(seriesAsked()).toBe(1)
        expect(await shown()).toBe(true)
        expect(background).toHaveLength(1)
        expect(seriesAsked()).toBe(1)
    })

    it("reads again from the settings without the pause, and keeps the old state when that fails", async () => {
        silent = true
        await shown()
        await readingsDone()
        silent = false
        expect(await readServer()).toHaveLength(4)
        expect(await shown()).toBe(true)
        silent = true
        await expect(readServer()).rejects.toThrow()
        expect(await shown()).toBe(true)
    })

    it("asks nothing and reads no token without a media server", async () => {
        await saveServerSettings({ url: "", userId: "", token: "" }, environment)
        calls = []
        secretReads = 0
        const given = collection()
        expect(await withServerLibrary(given, environment)).toBe(given)
        const opened = page()
        expect(await withServerFiles(opened, environment)).toBe(opened)
        await expect(readServer()).rejects.toThrow()
        await readingsDone()
        expect(calls).toEqual([])
        expect(background).toEqual([])
        expect(secretReads).toBe(0)
    })
})

describe("playing a server episode", () => {
    const PATH = "mediaserver://srv-1/sA-e1"
    const play = (body: unknown) => matchCoreRoute("POST", "/api/v1/mediaserver/play")!.route.answer({ path: "/api/v1/mediaserver/play", query: null, body } as never, environment)
    const reason = (work: Promise<unknown>) => work.then(() => "", (error: Error) => error.message)

    async function watched(body: unknown): Promise<Json> {
        const events: CoreEvent[] = []
        const stop = onCoreEvent(event => void events.push(event))
        try {
            expect(await play(body)).toBe(true)
            // the core hands events on after a tick
            await vi.waitFor(() => expect(events.some(event => event.type === "native-player")).toBe(true))
        } finally {
            stop()
        }
        const player = events.find(event => event.type === "native-player")?.payload as { type: string, payload: Json } | undefined
        expect(player?.type).toBe("watch")
        return player!.payload
    }

    it("opens the player with the original file: static, with source, device and play session, and no token in the address", async () => {
        await readServer()
        const watch = await watched({ path: PATH, mediaId: SERVER_ONLY })
        const address = new URL(String(watch.streamUrl))
        expect(`${address.origin}${address.pathname}`).toBe(`${BASE}/Videos/sA-e1/stream`)
        expect(address.searchParams.get("static")).toBe("true")
        expect(address.searchParams.get("mediaSourceId")).toBe("sA-m1")
        expect(address.searchParams.get("deviceId")).toBe("dev-1")
        expect(address.searchParams.get("playSessionId")).toMatch(/^[0-9a-f]{32}$/)
        expect(String(watch.streamUrl)).not.toContain(TOKEN)
        expect(String(watch.streamUrl).toLowerCase()).not.toContain("api_key")
        expect(watch).toMatchObject({ streamType: "localfile", streamPath: PATH, mimeType: "video/x-matroska", media: { id: SERVER_ONLY } })
        expect(watch.episode).toMatchObject({ _isMediaServerEpisode: true, mediaServerEpisode: { serverId: "srv-1", seriesId: "sA", episodeId: "sA-e1" } })
    })

    it("carries the token only in the Authorization header, with all five fields", async () => {
        await readServer()
        const watch = await watched({ path: PATH, mediaId: SERVER_ONLY })
        const header = String((watch.requestHeaders as Record<string, string>).Authorization)
        expect(header.startsWith("MediaBrowser ")).toBe(true)
        for (const field of ["Client=", "Device=\"Pixel\"", "DeviceId=\"dev-1\"", "Version=\"4.2.0\"", `Token="${TOKEN}"`]) expect(header).toContain(field)
        expect(JSON.stringify({ ...watch, requestHeaders: null })).not.toContain(TOKEN)
    })

    it("builds the address from the session alone", () => {
        const session = { serverId: "srv-1", url: BASE, userId: "u1", token: TOKEN, identity: { device: "Pixel", deviceId: "dev-1", version: "4.2.0" } }
        const address = serverStreamAddress(session as Parameters<typeof serverStreamAddress>[0], "e 1", "m1", "abc")
        expect(address).toBe(`${BASE}/Videos/e%201/stream?static=true&mediaSourceId=m1&deviceId=dev-1&playSessionId=abc`)
    })

    it("says why it cannot start: not signed in, no address, an episode not in the kept data", async () => {
        await readServer()
        expect(await reason(play({ path: "mediaserver://srv-1/sA-e9", mediaId: SERVER_ONLY }))).toBe("The episode is not in the media server's library")
        expect(await reason(play({ path: PATH, mediaId: OWN }))).toBe("The episode is not in the media server's library")
        expect(await reason(play({ path: "/made/file.mkv", mediaId: SERVER_ONLY }))).toBe("path and mediaId are needed")
        await saveServerSettings({ token: "" }, environment)
        const signedOut = await reason(play({ path: PATH, mediaId: SERVER_ONLY }))
        expect(signedOut).toBe("Not signed in to a media server")
        await saveServerSettings({ url: "" }, environment)
        const noAddress = await reason(playServerFile({ path: "/api/v1/mediaserver/play", query: null, body: { path: PATH, mediaId: SERVER_ONLY } } as never, environment))
        expect(noAddress).toBe("The media server's address is missing")
        expect(signedOut + noAddress).not.toContain(TOKEN)
    })
})

describe("matching by hand", () => {
    const route = async (method: "GET" | "POST" | "DELETE", address: string, body: unknown = null) => {
        const matched = matchCoreRoute(method, address)
        if (!matched) throw new Error(`no route ${method} ${address}`)
        return matched.route.answer({ path: matched.path, query: null, body }, environment)
    }
    const failure = async (work: Promise<unknown>) => {
        try {
            await work
        }
        catch (error) {
            return { message: (error as Error).message, status: (error as { status?: number }).status }
        }
        throw new Error("did not fail")
    }
    const libraryIds = async () => entriesOf(await withServerLibrary(collection(), environment)).map(item => item.mediaId as number).sort()
    const pageNumbers = async (id: number) => {
        const page = await withServerFiles({ mediaId: id, media: { ...media(id), episodes: 24 } }, environment) as Json
        return ((page.episodes ?? []) as Json[]).map(episode => episode.episodeNumber)
    }

    it("tells the dialog which series a title has now, by which rule, and with which rows made by hand", async () => {
        await readServer()
        expect(await route("GET", `/api/v1/mediaserver/mapping/${SERVER_ONLY}`)).toEqual({
            anilistId: SERVER_ONLY, serverId: "srv-1", seriesId: "sA", name: NAMES[SERVER_ONLY], year: 2020, rule: "S1", certain: true, episodes: 2,
            seasons: [{ id: "sA-s1", name: "Season 1", index: 1, episodes: 2 }], mappings: [],
        })
        expect(await route("GET", `/api/v1/mediaserver/mapping/${UNSURE}`)).toMatchObject({ seriesId: "sB", rule: "S4", certain: false })
        expect(await route("GET", `/api/v1/mediaserver/mapping/${ABSENT}`)).toBeNull()
        await route("POST", "/api/v1/mediaserver/mapping", { itemId: "sA-s1", mediaId: ABSENT, episodeOffset: -12 })
        expect(await route("GET", `/api/v1/mediaserver/mapping/${ABSENT}`)).toMatchObject({ seriesId: "sA", rule: "manual", certain: true, mappings: [{ itemId: "sA-s1", episodeOffset: -12 }] })
        expect(await failure(route("GET", "/api/v1/mediaserver/mapping/abc"))).toEqual({ message: "The AniList id must be a whole number", status: 400 })
        const status = await serverOverview(environment)
        expect(status.unmatched).toEqual([{ seriesId: "sB", name: NAMES[UNSURE], year: 2020, seasons: [{ id: "sB-s1", name: "Season 1", index: 1, episodes: 2 }], suggestion: { anilistId: UNSURE, title: NAMES[UNSURE] } }])
    })

    it("subtracts the offset from the server's numbers: episodes 1..12 with -12 are 13..24", async () => {
        serverEpisodeNumbers = Array.from({ length: 12 }, (_, at) => at + 1)
        await readServer()
        await route("POST", "/api/v1/mediaserver/mapping", { itemId: "sB", mediaId: UNSURE, episodeOffset: -12 })
        expect(await pageNumbers(UNSURE)).toEqual(Array.from({ length: 12 }, (_, at) => at + 13))
        await route("POST", "/api/v1/mediaserver/mapping", { itemId: "sB", mediaId: UNSURE, episodeOffset: 2 })
        expect(await pageNumbers(UNSURE)).toEqual(Array.from({ length: 10 }, (_, at) => at + 1))
    })

    it("never gives one server episode to two titles: the row saved last wins", async () => {
        await readServer()
        await route("POST", "/api/v1/mediaserver/mapping", { itemId: "sA", mediaId: ABSENT })
        now += 1000
        await route("POST", "/api/v1/mediaserver/mapping", { itemId: "sA-s1", mediaId: UNSURE })
        expect(await pageNumbers(UNSURE)).toEqual([1, 2])
        expect(await pageNumbers(ABSENT)).toEqual([])
        expect(await pageNumbers(SERVER_ONLY)).toEqual([])
        now += 1000
        await route("POST", "/api/v1/mediaserver/mapping", { itemId: "sA", mediaId: ABSENT, episodeOffset: 0 })
        expect(await pageNumbers(ABSENT)).toEqual([1, 2])
        expect(await pageNumbers(UNSURE)).toEqual([])
        const owners = new Map<string, number[]>()
        for (const id of [SERVER_ONLY, UNSURE, OWN, NAKAMA, ABSENT]) {
            const page = await withServerFiles({ mediaId: id, media: media(id) }, environment) as Json
            for (const episode of (page.episodes ?? []) as Json[]) {
                const key = (episode.mediaServerEpisode as Json).episodeId as string
                owners.set(key, [...owners.get(key) ?? [], id])
            }
        }
        for (const [episode, ids] of owners) expect(ids, episode).toHaveLength(1)
    })

    it("takes a series given to no title out of the library and out of the list of series not matched", async () => {
        await readServer()
        expect(await libraryIds()).toContain(SERVER_ONLY)
        const status = await route("POST", "/api/v1/mediaserver/mapping", { itemId: "sA", mediaId: 0 }) as Json
        expect(await libraryIds()).not.toContain(SERVER_ONLY)
        expect((status.unmatched as Json[]).map(show => show.seriesId)).toEqual(["sB"])
        await route("POST", "/api/v1/mediaserver/mapping", { itemId: "sB-s1", mediaId: 0 })
        expect((await serverOverview(environment)).unmatched).toEqual([])
        expect(await unassignedServerShows(environment)).toEqual([])
    })

    it("lists a series given to no title under left out, counts it there, and gives it back when the row is taken away", async () => {
        await readServer()
        const before = await serverOverview(environment)
        expect(before).toMatchObject({ leftOut: [], leftOutSeries: 0 })
        expect(before.matched + before.unmatched.length + before.leftOutSeries).toBe(before.series)
        await route("POST", "/api/v1/mediaserver/mapping", { itemId: "sA", mediaId: 0 })
        const left = await serverOverview(environment)
        expect(left.leftOut).toEqual([{
            itemId: "sA", seriesId: "sA", name: NAMES[SERVER_ONLY], year: 2020, seasonName: null,
            seasons: [{ id: "sA-s1", name: "Season 1", index: 1, episodes: 2 }],
        }])
        expect(left.unmatched.map(show => show.seriesId)).not.toContain("sA")
        expect(left).toMatchObject({ series: before.series, matched: before.matched - 1, leftOutSeries: 1 })
        expect(left.matched + left.unmatched.length + left.leftOutSeries).toBe(left.series)
        await removeServerMapping("sA", environment)
        const back = await serverOverview(environment)
        expect(back).toMatchObject({ leftOut: [], leftOutSeries: 0, matched: before.matched })
        expect(await libraryIds()).toContain(SERVER_ONLY)
    })

    it("names the season when only a season is given to no title", async () => {
        await readServer()
        await route("POST", "/api/v1/mediaserver/mapping", { itemId: "sB-s1", mediaId: 0 })
        const status = await serverOverview(environment)
        expect(status.leftOut).toEqual([{
            itemId: "sB-s1", seriesId: "sB", name: NAMES[UNSURE], year: 2020, seasonName: "Season 1",
            seasons: [{ id: "sB-s1", name: "Season 1", index: 1, episodes: 2 }],
        }])
        expect(status.unmatched).toEqual([])
        expect(status.matched + status.unmatched.length + status.leftOutSeries).toBe(status.series)
    })

    it("shows the library as it is now right after a change, from the kept series, without asking the server", async () => {
        await readServer()
        await withServerLibrary(collection(), environment)
        calls = []
        silent = true
        await route("POST", "/api/v1/mediaserver/mapping", { itemId: "sA", mediaId: ABSENT })
        expect(await libraryIds()).toEqual(expect.arrayContaining([ABSENT]))
        expect(await libraryIds()).not.toContain(SERVER_ONLY)
        const status = await route("DELETE", "/api/v1/mediaserver/mapping", { itemId: "sA" }) as Json
        expect(status.matched).toBe(3)
        expect(await libraryIds()).toContain(SERVER_ONLY)
        expect(await libraryIds()).not.toContain(ABSENT)
        expect(calls).toEqual([])
    })

    it("says what is wrong with an input and changes nothing", async () => {
        await readServer()
        const rows = async () => (await environment.database()).select().from(mediaserverMappings)
        const save = (body: unknown) => failure(route("POST", "/api/v1/mediaserver/mapping", body))
        expect(await save({ itemId: "nowhere", mediaId: ABSENT })).toEqual({ message: "The series or season is not among the media server's series", status: 404 })
        expect(await save({ itemId: "sA", mediaId: "205" })).toEqual({ message: "mediaId must be an AniList id (a whole number), or 0 for no title", status: 400 })
        expect(await save({ itemId: "sA", mediaId: 2.5 })).toMatchObject({ status: 400 })
        expect(await save({ itemId: "sA", mediaId: -1 })).toMatchObject({ status: 400 })
        expect(await save({ itemId: "sA", mediaId: ABSENT, episodeOffset: "12" })).toEqual({ message: "episodeOffset must be a whole number", status: 400 })
        expect(await save({ mediaId: ABSENT })).toMatchObject({ status: 400 })
        expect(await rows()).toEqual([])
        expect(await failure(route("DELETE", "/api/v1/mediaserver/mapping", { itemId: "sA" }))).toEqual({ message: "There is no match made by hand for this series or season", status: 404 })
        expect(await libraryIds()).toContain(SERVER_ONLY)
        // signed out, the kept series are gone: nothing to give
        await saveServerSettings({ token: "" }, environment)
        expect(await save({ itemId: "sA", mediaId: ABSENT })).toMatchObject({ status: 404 })
        expect(await rows()).toEqual([])
    })
})
