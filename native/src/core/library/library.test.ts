// geschrieben nach: Form der Aufzeichnung api vom 13.11.2026 (library.recorded.json: nur Arten, keine Werte), öffentliche Doku von ani.zip (Felder der Antwort) und docs/EIGENER-KERN.md §4p; kein Server-Quelltext
import { beforeEach, describe, expect, it } from "vitest"
import { sqlDriverFor } from "@/api/client/core-database"
import { forgetDatabases, openDatabaseSync } from "../../../test/expo-sqlite"
import type { HttpFetch } from "../anilist/client"
import { type CoreDatabase, openCoreDatabase } from "../database/database"
import { anilistListEntries, anilistMedia, offlineItems } from "../database/schema"
import { type CoreEnvironment, matchCoreRoute } from "../registry"
import { episodesOut } from "./library"
import { METADATA_FRESH_MS, METADATA_URL } from "./metadata"
import recorded from "./library.recorded.json"

/*
 * The core's library (§4p) against the recorded form: every field the core gives has the recorded kind; fields of the
 * recording the core leaves out are named (no local files in the core yet). Titles, numbers and addresses are made up.
 */

type Json = Record<string, unknown>

const MEDIA_ID = 4242
const DAY = 24 * 60 * 60 * 1000

const media = (fields: Json = {}): Json => ({
    id: MEDIA_ID, idMal: 1, siteUrl: "https://anilist.example/anime/4242", status: "FINISHED", season: "SPRING", type: "ANIME", format: "TV",
    seasonYear: 2020, bannerImage: "https://img.example/b.jpg", episodes: 4, synonyms: ["made up"], isAdult: false, countryOfOrigin: "JP",
    meanScore: 80, description: "made up", genres: ["Made"], duration: 24, trailer: { id: "x", site: "youtube", thumbnail: "https://img.example/t.jpg" },
    title: { english: "Made Up", native: "Made", romaji: "Meido Appu", userPreferred: "Meido Appu" },
    coverImage: { color: "#fff", extraLarge: "https://img.example/xl.jpg", large: "https://img.example/l.jpg", medium: "https://img.example/m.jpg" },
    startDate: { day: 1, month: 4, year: 2020 }, endDate: { day: 1, month: 6, year: 2020 }, ...fields,
})

const serviceEpisode = (n: number, airDate = `2020-04-0${n}`) => ({
    tvdbShowId: 9, tvdbId: 100 + n, seasonNumber: 1, episodeNumber: n, absoluteEpisodeNumber: n, title: { en: `Made episode ${n}`, "x-jat": `Meido ${n}` },
    airDate, airDateUtc: `${airDate}T00:00:00Z`, runtime: 24, overview: `Text ${n}`, image: `https://img.example/e${n}.jpg`, episode: String(n),
    anidbEid: 500 + n, length: 24, airdate: airDate, rating: "8", summary: `Other text ${n}`,
})

const service = (episodes = [1, 2, 3, 4].map(n => serviceEpisode(n))) => ({
    titles: { "x-jat": "Meido Appu", en: "Made Up", ja: "Made" },
    episodes: Object.fromEntries(episodes.map(episode => [String(episode.episodeNumber), episode])),
    episodeCount: episodes.length, specialCount: 0, images: [],
    mappings: { animeplanet_id: "x", kitsu_id: 1, mal_id: 1, type: "TV", anilist_id: MEDIA_ID, anisearch_id: 1, anidb_id: 77, notifymoe_id: "y", livechart_id: 1, thetvdb_id: 9, imdb_id: null, themoviedb_id: "5" },
})

let now = Date.UTC(2026, 10, 14)
let database: CoreDatabase | null = null
let serviceAnswer: unknown = service()
let serviceUp = true
let serviceAsked = 0
let pauses = 0

const httpFetch: HttpFetch = async url => {
    if (url === METADATA_URL + MEDIA_ID) {
        serviceAsked++
        if (!serviceUp) throw new TypeError("no network")
        return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify(serviceAnswer) }
    }
    throw new TypeError(`no network in tests: ${url}`)
}

const environment = {
    fetch: httpFetch,
    secret: async () => null,
    server: async () => {
        throw new Error("the server is not asked")
    },
    database: async () => database ??= await openCoreDatabase(sqlDriverFor(openDatabaseSync("core.db") as never), () => now),
    now: () => now,
    pause: async () => void pauses++,
} as unknown as CoreEnvironment

async function ask(endpoint: string): Promise<Json> {
    const matched = matchCoreRoute("GET", endpoint)
    if (!matched) throw new Error(`no route: ${endpoint}`)
    return await matched.route.answer({ path: matched.path, query: null, body: null }, environment) as Json
}

async function titleInLists(fields: Json = {}, entry: Json | null = { id: 1, progress: 2, status: "CURRENT", score: 0, repeat: 0, startedAt: {}, completedAt: {}, createdAt: 1, updatedAt: 2 }) {
    const opened = await environment.database()
    const [row] = await opened.insert(anilistMedia).values({ anilistId: MEDIA_ID, kind: "ANIME", content: media(fields), changedAt: now }).returning({ id: anilistMedia.id })
    if (entry) await opened.insert(anilistListEntries).values({ anilistId: 1, media: row.id, kind: "ANIME", list: 0, position: 0, content: entry, changedAt: now })
}

/** The form of a value as library.recorded.json writes it */
function formOf(value: unknown): unknown {
    if (value === null) return "null"
    if (Array.isArray(value)) return value.length ? [formOf(value[0])] : []
    if (typeof value === "object") return Object.fromEntries(Object.entries(value as Json).map(([key, field]) => [key, formOf(field)]))
    return typeof value
}

/** Every field of `core` is in `recordedForm` with the same kind; returns the recorded fields the core left out */
function compare(core: unknown, recordedForm: unknown, path = ""): string[] {
    const form = formOf(core)
    if (Array.isArray(recordedForm)) {
        expect(Array.isArray(form), path).toBe(true)
        return (form as unknown[]).length && recordedForm.length ? compare((core as unknown[])[0], recordedForm[0], `${path}[0]`) : []
    }
    if (typeof recordedForm === "object" && recordedForm !== null) {
        expect(typeof form, path).toBe("object")
        const missing: string[] = []
        for (const key of Object.keys(core as Json)) {
            expect(Object.keys(recordedForm), `${path}.${key}`).toContain(key)
            missing.push(...compare((core as Json)[key], (recordedForm as Json)[key], `${path}.${key}`))
        }
        for (const key of Object.keys(recordedForm)) if (!(key in (core as Json))) missing.push(`${path}.${key}`)
        return missing
    }
    expect(form, path).toBe(recordedForm)
    return []
}

beforeEach(() => {
    forgetDatabases()
    database = null
    serviceAnswer = service()
    serviceUp = true
    serviceAsked = 0
    pauses = 0
    now = Date.UTC(2026, 10, 14)
})

describe("the core's library against the recorded form", () => {
    it("episode collection: every field as recorded, titles and pictures from the metadata", async () => {
        await titleInLists()
        const answer = await ask(`/api/v1/anime/episode-collection/${MEDIA_ID}`)
        // the episodes of the metadata are a map by number: each one against the recorded first
        const metadataEpisodes = (answer.metadata as Json).episodes as Json
        for (const episode of Object.values(metadataEpisodes)) expect(compare(episode, recorded.episodeCollection.metadata.episodes["1"])).toEqual([])
        expect(compare({ ...answer, metadata: { ...(answer.metadata as Json), episodes: { 1: metadataEpisodes["1"] } } }, recorded.episodeCollection)
            // the made-up anime has titles in fewer languages than the recorded one
            .filter(field => !field.startsWith(".metadata.titles."))).toEqual([])
        const episodes = answer.episodes as Json[]
        expect(episodes.map(episode => episode.episodeNumber)).toEqual([1, 2, 3, 4])
        expect(episodes[1]).toMatchObject({ displayTitle: "Episode 2", episodeTitle: "Made episode 2", aniDBEpisode: "2", localFile: null, isDownloaded: false })
        expect(episodes[1].episodeMetadata).toEqual({ anidbId: 502, image: "https://img.example/e2.jpg", airDate: "2020-04-02", length: 24, summary: "Text 2", overview: "Text 2", hasImage: true, title: "Made episode 2" })
        const metadata = answer.metadata as Json
        expect(metadata.titles).toEqual({ main: "Meido Appu", en: "Made Up", ja: "Made" })
        expect(metadata.mappings).toEqual({ kitsuId: 1, malId: 1, type: "TV", anilistId: MEDIA_ID, anisearchId: 1, anidbId: 77, livechartId: 1, thetvdbId: 9, themoviedbId: "5" })
    })

    it("anime entry: every field as recorded; without local files no library data", async () => {
        await titleInLists()
        const answer = await ask(`/api/v1/library/anime-entry/${MEDIA_ID}`)
        // the core has no folders of the user's own files yet (stage 5b): the recorded entry had some
        expect(compare(answer, recorded.animeEntry)).toEqual([".listData.completedAt", ".libraryData"])
        expect(answer).toMatchObject({ mediaId: MEDIA_ID, anidbId: 77, currentEpisodeCount: 4, episodes: [], localFiles: [], nextEpisode: null, _isNakamaEntry: false })
        expect(answer.listData).toEqual({ progress: 2, status: "CURRENT", createdAt: 1, updatedAt: 2 })
        const info = answer.downloadInfo as Json
        expect((info.episodesToDownload as Json[]).map(episode => episode.episodeNumber)).toEqual([3, 4])
        expect(info).toMatchObject({ canBatch: true, batchAll: false, rewatch: false, hasInaccurateSchedule: false, absoluteOffset: 0 })
    })

    it("a completed anime: everything to watch again", async () => {
        await titleInLists({}, { id: 1, progress: 4, status: "COMPLETED", completedAt: { year: 2026, month: 11, day: 1 }, createdAt: 1, updatedAt: 2 })
        const answer = await ask(`/api/v1/library/anime-entry/${MEDIA_ID}`)
        expect((answer.listData as Json).completedAt).toBe("2026-11-01T00:00:00Z")
        const info = answer.downloadInfo as Json
        expect(info.rewatch).toBe(true)
        expect((info.episodesToDownload as Json[]).length).toBe(4)
    })
})

describe("special cases", () => {
    it("no list entry: no listData, every episode to watch, batches for all", async () => {
        await titleInLists({}, null)
        const answer = await ask(`/api/v1/library/anime-entry/${MEDIA_ID}`)
        expect("listData" in answer).toBe(false)
        expect(answer.downloadInfo).toMatchObject({ batchAll: true, rewatch: false })
        expect(((answer.downloadInfo as Json).episodesToDownload as Json[]).length).toBe(4)
    })

    it("the metadata service fails: last kept state of any age; nothing kept: episodes from AniList alone, mapping error", async () => {
        await titleInLists()
        serviceUp = false
        const none = await ask(`/api/v1/anime/episode-collection/${MEDIA_ID}`)
        expect(none.hasMappingError).toBe(true)
        expect("metadata" in none).toBe(false)
        expect((none.episodes as Json[]).map(episode => [episode.displayTitle, episode.episodeTitle, episode.episodeMetadata])).toEqual([1, 2, 3, 4].map(n => [`Episode ${n}`, "", { hasImage: false }]))
        expect((await ask(`/api/v1/library/anime-entry/${MEDIA_ID}`)).anidbId).toBe(0)

        serviceUp = true
        await ask(`/api/v1/anime/episode-collection/${MEDIA_ID}`)
        const asked = serviceAsked
        await ask(`/api/v1/anime/episode-collection/${MEDIA_ID}`)
        expect(serviceAsked).toBe(asked)

        now += METADATA_FRESH_MS + DAY * 30
        serviceUp = false
        const stale = await ask(`/api/v1/anime/episode-collection/${MEDIA_ID}`)
        expect(serviceAsked).toBe(asked + 1)
        expect(stale.hasMappingError).toBe(false)
        expect(((stale.episodes as Json[])[0].episodeMetadata as Json).title).toBe("Made episode 1")
    })

    it("an episode saved on the device and ready is downloaded; one on its way is not", async () => {
        await titleInLists()
        const opened = await environment.database()
        const row = (id: string, episode: string, status: string) => ({ id, mediaId: MEDIA_ID, queueOrder: 0, status, item: { episode, status }, source: {}, tries: 0, retryAt: 0, changedAt: now })
        await opened.insert(offlineItems).values([row("a", "2", "ready"), row("b", "3", "downloading")])
        const episodes = (await ask(`/api/v1/anime/episode-collection/${MEDIA_ID}`)).episodes as Json[]
        expect(episodes.map(episode => episode.isDownloaded)).toEqual([false, true, false, false])
    })

    it("a running anime: the episodes before the next to air; without it, the ones aired; a schedule without next episode is inaccurate", async () => {
        expect(episodesOut(media({ status: "RELEASING", episodes: 12, nextAiringEpisode: { episode: 6, airingAt: 1, timeUntilAiring: 1 } }), null, now)).toBe(5)
        const aired = { episodes: { 1: { airDate: "2026-11-01" }, 2: { airDate: "2026-11-08" }, 3: { airDate: "2026-11-15" }, S1: { airDate: "2026-01-01" } } }
        expect(episodesOut(media({ status: "RELEASING", episodes: 12 }), aired, now)).toBe(2)
        expect(episodesOut(media({ status: "NOT_YET_RELEASED" }), aired, now)).toBe(0)
        expect(episodesOut(media({ episodes: undefined }), { episodeCount: 7 }, now)).toBe(7)
        await titleInLists({ status: "RELEASING", episodes: 12 })
        const answer = await ask(`/api/v1/library/anime-entry/${MEDIA_ID}`)
        expect(answer.downloadInfo).toMatchObject({ hasInaccurateSchedule: true, canBatch: false })
    })

    it("a long-running anime gives the screens' thread its turn between its episodes", async () => {
        serviceAnswer = service([])
        await titleInLists({ episodes: 1100 })
        const answer = await ask(`/api/v1/anime/episode-collection/${MEDIA_ID}`)
        expect((answer.episodes as Json[]).length).toBe(1100)
        expect(pauses).toBe(4)
    })

})
