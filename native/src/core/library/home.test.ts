// geschrieben nach: Form der Aufzeichnung api vom 13.11.2026 (home.recorded.json: nur Arten, keine Werte), öffentliche AniList-Doku (Media.relations, Media.airingSchedule, MediaSeason) und docs/EIGENER-KERN.md §4p; kein Server-Quelltext
import { beforeEach, describe, expect, it } from "vitest"
import { saveTorrentSettings } from "../torrent/torrent"
import { sqlDriverFor } from "@/api/client/core-database"
import { forgetDatabases, openDatabaseSync } from "../../../test/expo-sqlite"
import { ANILIST_URL, type HttpFetch } from "../anilist/client"
import { keepCollection } from "../anilist/store"
import { LONGEST_PIECE_MS, type PieceWhere, createBlockingWatch } from "../blocking"
import { type CoreDatabase, openCoreDatabase } from "../database/database"
import { anilistMedia, localFiles, watchPositions } from "../database/schema"
import { type CoreEnvironment, type CoreMethod, matchCoreRoute } from "../registry"
import { resumeEpisodeNumber, seasonsAround } from "./home"
import { METADATA_URL } from "./metadata"
import recorded from "./home.recorded.json"

/*
 * Home, schedule, missed sequels and the marks of an anime's page (phase 5a-3) against the recorded form: every field the
 * core gives has the recorded kind. Titles, numbers and addresses are made up.
 */

type Json = Record<string, unknown>

const DAY = 24 * 60 * 60 * 1000
let now = Date.UTC(2026, 10, 14, 12)
const seconds = (milliseconds: number) => Math.floor(milliseconds / 1000)

const media = (id: number, fields: Json = {}): Json => ({
    id, idMal: 1, siteUrl: `https://anilist.example/anime/${id}`, status: "RELEASING", season: "FALL", type: "ANIME", format: "TV",
    seasonYear: 2026, bannerImage: "https://img.example/b.jpg", episodes: 12, synonyms: ["made up"], isAdult: false, countryOfOrigin: "JP",
    meanScore: 80, description: "made up", genres: ["Made"], duration: 24, trailer: { id: "x", site: "youtube", thumbnail: "https://img.example/t.jpg" },
    title: { english: `Made ${id}`, native: "Made", romaji: `Meido ${id}`, userPreferred: `Meido ${id}` },
    coverImage: { color: "#fff", extraLarge: `https://img.example/${id}-xl.jpg`, large: "https://img.example/l.jpg", medium: "https://img.example/m.jpg" },
    startDate: { day: 1, month: 10, year: 2026 }, endDate: {},
    nextAiringEpisode: { airingAt: seconds(now + DAY), timeUntilAiring: 86400, episode: 6 }, ...fields,
})

const entry = (id: number, status: string, fields: Json = {}, mediaFields: Json = {}): Json => ({
    id: id * 10, score: 70, progress: 3, status, repeat: 0, private: false, startedAt: { year: 2026, month: 10, day: 2 }, completedAt: {},
    updatedAt: 100, createdAt: 50, ...fields, media: media(id, mediaFields),
})

const serviceEpisode = (n: number) => ({
    episodeNumber: n, absoluteEpisodeNumber: n, title: { en: `Made episode ${n}` }, airDate: `2026-10-0${Math.min(n, 9)}`, overview: `Text ${n}`,
    summary: `Other ${n}`, image: `https://img.example/e${n}.jpg`, anidbEid: 500 + n, length: 24, runtime: 24,
})
const service = (id: number) => ({
    titles: { en: `Made ${id}` }, episodes: Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map(n => [String(n), serviceEpisode(n)])),
    episodeCount: 12, specialCount: 0, images: [], mappings: { anilist_id: id, anidb_id: 77 },
})

let database: CoreDatabase | null = null
let anilistUp = true
let asked: { query: string, variables: Json }[] = []
let relations: Record<number, Json[]> = {}
let schedules: Record<number, Json[]> = {}

const reply = (data: unknown) => ({ status: 200, headers: { get: () => null }, text: async () => JSON.stringify(data) })

const httpFetch: HttpFetch = async (url, init) => {
    if (url.startsWith(METADATA_URL)) return reply(service(Number(url.slice(METADATA_URL.length))))
    if (url === ANILIST_URL) {
        if (!anilistUp) throw new TypeError("no network")
        const { query, variables } = JSON.parse(init.body ?? "{}") as { query: string, variables: Json }
        asked.push({ query, variables })
        const ids = (variables.ids ?? []) as number[]
        if (query.includes("RelatedAnime")) {
            return reply({ data: { Page: { pageInfo: { hasNextPage: false }, media: ids.map(id => ({ id, relations: { edges: relations[id] ?? [] } })) } } })
        }
        if (query.includes("AiringSchedules")) {
            return reply({ data: { Page: { pageInfo: { hasNextPage: false }, media: ids.map(id => ({ id, airingSchedule: { nodes: schedules[id] ?? [] } })) } } })
        }
    }
    throw new TypeError(`no network in tests: ${url}`)
}

let serverAsked: string[] = []
const environment = {
    fetch: httpFetch,
    secret: async () => "token",
    server: async (method: CoreMethod, endpoint: string) => {
        serverAsked.push(`${method} ${endpoint}`)
        return { from: "server" }
    },
    database: async () => database ??= await openCoreDatabase(sqlDriverFor(openDatabaseSync("core.db") as never), () => now),
    now: () => now,
    pause: async () => undefined,
} as unknown as CoreEnvironment

async function call(method: CoreMethod, endpoint: string, body: unknown = null): Promise<unknown> {
    const matched = matchCoreRoute(method, endpoint)
    if (!matched) throw new Error(`no route: ${method} ${endpoint}`)
    return matched.route.answer({ path: matched.path, query: null, body }, environment)
}

async function lists(entries: Json[]) {
    const byStatus = new Map<string, Json[]>()
    for (const item of entries) byStatus.set(item.status as string, [...(byStatus.get(item.status as string) ?? []), item])
    await keepCollection(await environment.database(), "ANIME", {
        MediaListCollection: { lists: [...byStatus].map(([status, items]) => ({ status, name: status, isCustomList: false, entries: items })) },
    }, now)
}

function formOf(value: unknown): unknown {
    if (value === null) return "null"
    if (Array.isArray(value)) return value.length ? [formOf(value[0])] : []
    if (typeof value === "object") return Object.fromEntries(Object.entries(value as Json).map(([key, field]) => [key, formOf(field)]))
    return typeof value
}

/** Every field of `core` is in `recordedForm` with the same kind (all elements of a list are checked) */
function expectForm(core: unknown, recordedForm: unknown, path = "") {
    if (Array.isArray(recordedForm)) {
        expect(Array.isArray(core), path).toBe(true)
        if (recordedForm.length) for (const [index, item] of (core as unknown[]).entries()) expectForm(item, recordedForm[0], `${path}[${index}]`)
        return
    }
    if (typeof recordedForm === "object" && recordedForm !== null) {
        expect(formOf(core) !== null && typeof core === "object", path).toBe(true)
        // a map by AniList number (stream.listData): the recording names its keys "{mediaId}"
        const byId = (recordedForm as Json)["{mediaId}"]
        if (byId) {
            for (const [key, item] of Object.entries(core as Json)) expectForm(item, byId, `${path}.${key}`)
            return
        }
        for (const key of Object.keys(core as Json)) {
            expect(Object.keys(recordedForm), `${path}.${key}`).toContain(key)
            expectForm((core as Json)[key], (recordedForm as Json)[key], `${path}.${key}`)
        }
        return
    }
    expect(formOf(core), path).toBe(recordedForm)
}

beforeEach(() => {
    forgetDatabases()
    database = null
    anilistUp = true
    asked = []
    relations = {}
    schedules = {}
    serverAsked = []
    now = Date.UTC(2026, 10, 14, 12)
})

/** The "streaming titles in your anime lists" switch of online streaming (the library's settings) */
const onlineInLists = (on: boolean) => call("PATCH", "/api/v1/settings", { library: { includeOnlineStreamingInLibrary: on } })

describe("library collection (home)", () => {
    beforeEach(() => call("POST", "/api/v1/start", { library: { includeOnlineStreamingInLibrary: true } }))

    it("gives the streamed anime only while a streaming-in-lists switch is on", async () => {
        await lists([entry(1, "CURRENT"), entry(2, "CURRENT", { progress: 1 })])
        const opened = await environment.database()
        for (const id of [7]) await opened.insert(anilistMedia).values({ anilistId: id, kind: "ANIME", content: media(id), changedAt: now })
        await opened.insert(watchPositions).values({ mediaId: 7, kind: "onlinestream", episodeNumber: 2, positionSeconds: 10, durationSeconds: 1400, filepath: "", addedAt: now, changedAt: now, expiresAt: null })
        const withStream = await call("GET", "/api/v1/library/collection") as Json
        expect(((withStream.stream as Json).anime as Json[]).map(item => item.id).sort()).toEqual([1, 2])
        await onlineInLists(false)
        const allOff = await call("GET", "/api/v1/library/collection") as Json
        expect(allOff.stream).toBeUndefined()
        expect(allOff.continueWatchingList).toEqual([])
        // torrent streaming on with its switch: as before
        await saveTorrentSettings({ path: {}, query: null, body: { settings: { enabled: true, includeInLibrary: true } } }, environment)
        expect(await call("GET", "/api/v1/library/collection")).toEqual(withStream)
        // its switch alone, the area off: nothing streamed
        await saveTorrentSettings({ path: {}, query: null, body: { settings: { enabled: false, includeInLibrary: true } } }, environment)
        expect((await call("GET", "/api/v1/library/collection") as Json).stream).toBeUndefined()
    })

    it("has the recorded form, the watched anime and their next episodes", async () => {
        await lists([entry(1, "CURRENT"), entry(2, "CURRENT", { progress: 5 }), entry(3, "COMPLETED"), entry(4, "REPEATING", { progress: 0, updatedAt: 200 })])
        const collection = await call("GET", "/api/v1/library/collection") as Json
        expectForm(collection, recorded.libraryCollection)
        const stream = collection.stream as Json
        // 2 has watched every aired episode (next to air is 6): no next episode; 4 was changed last
        expect((stream.anime as Json[]).map(item => item.id)).toEqual([4, 1, 2])
        expect((stream.continueWatchingList as Json[]).map(item => [(item.baseAnime as Json).id, item.episodeNumber])).toEqual([[4, 1], [1, 4]])
        expect(Object.keys(stream.listData as Json).sort()).toEqual(["1", "2", "4"])
        expect((collection.lists as Json[]).every(list => (list.entries as unknown[]).length === 0)).toBe(true)
        expect(serverAsked).toEqual([])
    })

    it("shows an anime once in Continue watching when its next episode is on the device (AniList away)", async () => {
        await lists([entry(1, "CURRENT"), entry(2, "CURRENT", { progress: 1 })])
        const opened = await environment.database()
        await opened.insert(localFiles).values({ path: "/videos/made/ep4.mkv", name: "ep4.mkv", mediaId: 1, episode: 4, anidbEpisode: "4", type: "main",
            locked: false, ignored: false, size: 1, parsed: {}, folders: [], changedAt: now })
        anilistUp = false
        const collection = await call("GET", "/api/v1/library/collection") as Json
        const row = [...collection.continueWatchingList as Json[], ...(collection.stream as Json).continueWatchingList as Json[]]
            .map(item => [(item.baseAnime as Json).id, item.episodeNumber])
        expect(row.sort()).toEqual([[1, 4], [2, 2]])
    })

    it("puts the last watched anime first", async () => {
        await lists([entry(1, "CURRENT", { updatedAt: 300 }), entry(2, "CURRENT", { updatedAt: 100 })])
        const opened = await environment.database()
        await opened.insert(watchPositions).values({ mediaId: 2, kind: "onlinestream", episodeNumber: 3, positionSeconds: 10, durationSeconds: 1400, filepath: "", addedAt: now, changedAt: now, expiresAt: null })
        const stream = (await call("GET", "/api/v1/library/collection") as Json).stream as Json
        expect((stream.anime as Json[]).map(item => item.id)).toEqual([2, 1])
    })

    it("adds anime watched outside the lists to Continue watching, once, unfinished episode first (S-scan #3)", async () => {
        await lists([entry(1, "CURRENT"), entry(3, "COMPLETED")])
        const opened = await environment.database()
        // the anime pages kept 7, 8 and 9 when they were opened; none is on a list
        for (const id of [7, 8, 9]) await opened.insert(anilistMedia).values({ anilistId: id, kind: "ANIME", content: media(id), changedAt: now })
        const position = (mediaId: number, episodeNumber: number, positionSeconds: number, changedAt: number, expiresAt: number | null = null) =>
            ({ mediaId, kind: "onlinestream", episodeNumber, positionSeconds, durationSeconds: 1400, filepath: "", addedAt: changedAt, changedAt, expiresAt })
        await opened.insert(watchPositions).values([
            position(7, 2, 300, now - 2000), // unfinished: episode 2 again
            position(8, 1, 1300, now - 1000), // watched past 80 %: the next one
            position(9, 5, 1350, now - 500), // 5 was the last aired episode (6 airs tomorrow): nothing to continue
            position(3, 4, 10, now), // on a list (completed): not again
            position(1, 2, 10, now - 100, now - 1), // expired
        ])
        const stream = (await call("GET", "/api/v1/library/collection") as Json).stream as Json
        expect((stream.continueWatchingList as Json[]).map(item => [(item.baseAnime as Json).id, item.episodeNumber])).toEqual([[1, 4], [8, 2], [7, 2]])
        expect((stream.anime as Json[]).map(item => item.id)).toEqual([1])
    })

    it("resumes the watched position's episode until 80 % of it, then the next one", () => {
        expect(resumeEpisodeNumber({ episodeNumber: 3, positionSeconds: 1000, durationSeconds: 1400 })).toBe(3)
        expect(resumeEpisodeNumber({ episodeNumber: 3, positionSeconds: 1120, durationSeconds: 1400 })).toBe(4)
        expect(resumeEpisodeNumber({ episodeNumber: 3, positionSeconds: 50, durationSeconds: 0 })).toBe(3)
    })

    it("holds the thread at most 8 ms in one piece when every step before a statement is slow, and names its places (8-ms round 2)", async () => {
        await lists([entry(3, "COMPLETED")])
        const opened = await environment.database()
        const clock = { now: 0 }
        const pieces: { milliseconds: number, where: PieceWhere }[] = []
        const watch = createBlockingWatch({ now: () => clock.now, onPiece: (milliseconds, _what, where) => void pieces.push({ milliseconds, where }), free: () => new Promise<void>(resolve => setTimeout(resolve, 0)) })
        // the first call after switching on: each step before a statement takes 6 ms (on the tablet 16.6 ms before the first one)
        const slow = { ...environment, database: async () => (clock.now += 6, opened), pause: watch.pause, mark: watch.mark } as CoreEnvironment
        watch.enter("GET /api/v1/library/collection")
        const matched = matchCoreRoute("GET", "/api/v1/library/collection")!
        await matched.route.answer({ path: matched.path, query: null, body: null }, slow)
        watch.leave()
        expect(Math.max(...pieces.map(piece => piece.milliseconds))).toBeLessThanOrEqual(LONGEST_PIECE_MS)
        expect(pieces.flatMap(piece => piece.where.sections.map(section => section.name))).toEqual(expect.arrayContaining(["library: database", "library: kept lists", "library: own files"]))
    })

})

describe("upcoming episodes", () => {
    it("has the recorded form, soonest first, without dropped or aired ones", async () => {
        await lists([
            entry(1, "CURRENT", {}, { nextAiringEpisode: { airingAt: seconds(now + 2 * DAY), timeUntilAiring: 1, episode: 6 } }),
            entry(2, "PLANNING", {}, { nextAiringEpisode: { airingAt: seconds(now + DAY), timeUntilAiring: 1, episode: 2 } }),
            entry(3, "DROPPED"),
            entry(4, "CURRENT", {}, { nextAiringEpisode: { airingAt: seconds(now - DAY), timeUntilAiring: -1, episode: 5 } }),
        ])
        const answer = await call("GET", "/api/v1/library/upcoming-episodes") as { episodes: Json[] }
        expectForm(answer, recorded.upcomingEpisodes)
        expect(answer.episodes.map(item => [item.mediaId, item.episodeNumber, item.timeUntilAiring])).toEqual([[2, 2, 86400], [1, 6, 172800]])
        expect((answer.episodes[1].episodeMetadata as Json).title).toBe("Made episode 6")
    })
})

describe("schedule", () => {
    it("has the recorded form and takes the anime of the seasons around and the airing ones", async () => {
        await lists([
            entry(1, "CURRENT"),
            entry(2, "COMPLETED", {}, { status: "FINISHED", season: "SUMMER", seasonYear: 2026, nextAiringEpisode: undefined }),
            entry(3, "COMPLETED", {}, { status: "FINISHED", season: "SPRING", seasonYear: 2026, nextAiringEpisode: undefined }),
            entry(4, "DROPPED"),
            entry(5, "PLANNING", {}, { status: "FINISHED", format: "MOVIE", season: "SUMMER", seasonYear: 2026, episodes: 1, nextAiringEpisode: undefined }),
        ])
        schedules = {
            1: [{ airingAt: seconds(now + DAY), episode: 12 }, { airingAt: seconds(now - DAY), episode: 11 }],
            2: [{ airingAt: seconds(now - 60 * DAY), episode: 3 }],
            5: [{ airingAt: seconds(now - 120 * DAY), episode: 1 }],
        }
        const items = await call("GET", "/api/v1/library/schedule") as Json[]
        expectForm(items, recorded.schedule)
        expect((asked[0].variables.ids as number[]).sort()).toEqual([1, 2, 5])
        expect(items.map(item => [item.mediaId, item.episodeNumber, item.isMovie, item.isSeasonFinale])).toEqual([[5, 1, true, true], [2, 3, false, false], [1, 11, false, false], [1, 12, false, true]])
        expect(items[3].time).toBe("12:00")
        expect(items[3].dateTime).toBe("2026-11-15T12:00:00Z")
        expect(items[3].image).toBe("https://img.example/1-xl.jpg")
        // AniList down: the kept answer
        anilistUp = false
        expect(await call("GET", "/api/v1/library/schedule")).toEqual(items)
    })

    it("knows the seasons around a day (winter is December to February)", () => {
        expect([...seasonsAround(Date.UTC(2026, 10, 14))]).toEqual(["SUMMER 2026", "FALL 2026", "WINTER 2027"])
        expect([...seasonsAround(Date.UTC(2026, 11, 5))]).toEqual(["FALL 2026", "WINTER 2027", "SPRING 2027"])
        expect([...seasonsAround(Date.UTC(2027, 0, 5))]).toEqual(["FALL 2026", "WINTER 2027", "SPRING 2027"])
    })
})

describe("missed sequels", () => {
    it("has the recorded form and leaves out sequels in the lists or not yet out", async () => {
        await lists([entry(1, "COMPLETED"), entry(2, "COMPLETED"), entry(3, "PLANNING"), entry(9, "CURRENT")])
        relations = {
            1: [{ relationType: "SEQUEL", node: media(10, { status: "FINISHED", nextAiringEpisode: null }) }, { relationType: "PREQUEL", node: media(11) }, { relationType: "SEQUEL", node: media(3) }],
            2: [{ relationType: "SEQUEL", node: media(12, { status: "NOT_YET_RELEASED" }) }, { relationType: "SEQUEL", node: media(13) }, { relationType: "SEQUEL", node: media(10, { status: "FINISHED" }) }],
        }
        const sequels = await call("GET", "/api/v1/anilist/list-missed-sequels") as Json[]
        expectForm(sequels, recorded.missedSequels)
        expect(sequels.map(item => item.id).sort()).toEqual([10, 13])
        expect("nextAiringEpisode" in sequels[0]).toBe(false)
        expect(asked[0].variables.ids).toEqual([1, 2])
        anilistUp = false
        expect(await call("GET", "/api/v1/anilist/list-missed-sequels")).toEqual(sequels)
    })
})

describe("marks of an anime's page", () => {
    it("silences and unsilences in the recorded forms", async () => {
        expect(await call("GET", "/api/v1/library/anime-entry/silence/7")).toBe(false)
        expect(await call("POST", "/api/v1/library/anime-entry/silence", { mediaId: 7 })).toBe(true)
        const silenced = await call("GET", "/api/v1/library/anime-entry/silence/7")
        expect(silenced).toEqual({ id: 7, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() })
        expect(await call("POST", "/api/v1/library/anime-entry/silence", { mediaId: 7 })).toBe(true)
        expect(await call("GET", "/api/v1/library/anime-entry/silence/7")).toBe(false)
        await expect(call("POST", "/api/v1/library/anime-entry/silence", {})).rejects.toThrow("invalid mediaId")
    })

    it("saves, replaces and deletes the parent of the metadata in the recorded forms", async () => {
        const none = await call("GET", "/api/v1/metadata/parent/7")
        expectForm(none, recorded.metadataParent)
        expect(none).toEqual({ id: 0, createdAt: "0001-01-01T00:00:00Z", updatedAt: "0001-01-01T00:00:00Z", mediaId: 0, parentId: 0, specialOffset: 0 })
        const saved = await call("POST", "/api/v1/metadata/parent", { mediaId: 7, parentId: 3, specialOffset: 12 }) as Json
        expectForm(saved, recorded.metadataParent)
        expect([saved.mediaId, saved.parentId, saved.specialOffset]).toEqual([7, 3, 12])
        now += 1000
        const replaced = await call("POST", "/api/v1/metadata/parent", { mediaId: 7, parentId: 4, specialOffset: 0 }) as Json
        expect([replaced.id, replaced.parentId, replaced.specialOffset, replaced.createdAt === saved.createdAt, replaced.updatedAt === saved.updatedAt]).toEqual([saved.id, 4, 0, true, false])
        expect(await call("GET", "/api/v1/metadata/parent/7")).toEqual(replaced)
        expect(await call("DELETE", "/api/v1/metadata/parent", { mediaId: 7 })).toBe(true)
        expect(await call("GET", "/api/v1/metadata/parent/7")).toEqual(none)
        await expect(call("POST", "/api/v1/metadata/parent", { mediaId: 7, parentId: 7 })).rejects.toThrow("own parent")
    })

})
