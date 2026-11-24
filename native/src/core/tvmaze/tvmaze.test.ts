import { beforeEach, describe, expect, it } from "vitest"
import { sqlDriverFor } from "@/api/client/core-database"
import { forgetDatabases, openDatabaseSync } from "../../../test/expo-sqlite"
import type { HttpFetch } from "../anilist/client"
import { type CoreDatabase, openCoreDatabase } from "../database/database"
import { CoreError } from "../errors"
import { type CoreEnvironment, matchCoreRoute } from "../registry"
import { TvmazeFailure, askTvmaze, newTvmazeRateLimit } from "./client"
import { ownShowOf } from "./own-shows"
import { fromTvmazeId, isTvmazeId, mediaOfShow, metadataOfShow, plainText, searchOtherSources, SHOW_FRESH_MS, toTvmazeId } from "./tvmaze"

/*
 * TVmaze and AniList are played by a test double: TVmaze by its address, AniList (POST graphql.anilist.co) by the
 * query's name. The show is shaped like TVmaze's answer for /shows/{id}?embed=episodes.
 */

type Json = Record<string, unknown>
type Answer = { status?: number, headers?: Record<string, string>, body?: unknown, fails?: boolean }

let clock = 0
let database: Promise<CoreDatabase> | null = null
let asked: string[] = []
let answers: Record<string, Answer | Answer[]> = {}
let slept: number[] = []

const double: HttpFetch = async (url, init) => {
    const key = url.startsWith("https://graphql.anilist.co") ? `anilist:${/query\s+(\w+)/.exec((JSON.parse(init.body ?? "{}") as { query: string }).query)?.[1]}` : url.replace("https://api.tvmaze.com", "")
    asked.push(key)
    const planned = answers[key]
    const answer = Array.isArray(planned) ? (planned.length > 1 ? planned.shift()! : planned[0]) : planned
    if (!answer || answer.fails) throw new TypeError("Network request failed")
    const headers = new Map(Object.entries(answer.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]))
    return { status: answer.status ?? 200, headers: { get: name => headers.get(name.toLowerCase()) ?? null }, text: async () => JSON.stringify(answer.body) }
}

const environment: CoreEnvironment = {
    fetch: double,
    secret: async () => null,
    database: () => database ??= openCoreDatabase(sqlDriverFor(openDatabaseSync("core.db") as never), () => clock),
    now: () => clock,
    pause: async () => undefined,
    sleep: async milliseconds => {
        slept.push(milliseconds)
        clock += milliseconds
    },
}

const NOW = Date.parse("2026-11-21T12:00:00.000Z")

const episode = (season: number, number: number | null, airstamp: string, type = "regular"): Json => ({
    id: season * 100 + (number ?? 0), season, number, type, name: number ? `Folge ${number}` : "Spécial",
    airdate: airstamp.slice(0, 10), airstamp, runtime: 52,
    image: number === 1 ? { medium: "https://static.tvmaze.com/e1-m.jpg", original: "https://static.tvmaze.com/e1-o.jpg" } : null,
    summary: "<p>Une &amp; deux</p>",
})

const SHOW: Json = {
    id: 95063,
    url: "https://www.tvmaze.com/shows/95063/dreamland",
    name: "Dreamland",
    type: "Animation",
    language: "French",
    genres: ["Drama", "Fantasy"],
    status: "Running",
    runtime: null,
    averageRuntime: 52,
    premiered: "2026-10-05",
    ended: null,
    rating: { average: 7.4 },
    network: { id: 1, name: "France 2", country: { name: "France", code: "FR" } },
    webChannel: null,
    externals: { tvrage: null, thetvdb: 456789, imdb: "tt1234567" },
    image: { medium: "https://static.tvmaze.com/m.jpg", original: "https://static.tvmaze.com/o.jpg" },
    summary: "<p><b>Dreamland</b> raconte l&#39;histoire.</p><p>Deuxième.</p>",
}
const EPISODES = [
    episode(1, 1, "2026-10-05T19:10:00+00:00"),
    episode(1, 2, "2026-11-16T19:10:00+00:00"),
    episode(1, null, "2026-11-20T19:10:00+00:00", "significant_special"),
    episode(1, 3, "2026-11-23T19:10:00+00:00"),
    episode(1, 4, "2026-11-30T19:10:00+00:00"),
]
const SHOW_PATH = "/shows/95063?embed=episodes"
const IMAGES_PATH = "/shows/95063/images"
const IMAGES = [
    { id: 1, type: "poster", main: true, resolutions: { original: { url: "https://static.tvmaze.com/poster.jpg" } } },
    { id: 2, type: "background", main: true, resolutions: { original: { url: "https://static.tvmaze.com/bg.jpg" } } },
]

function ask(method: string, endpoint: string, body?: unknown): Promise<unknown> {
    const match = matchCoreRoute(method, endpoint)
    expect(match, endpoint).toBeTruthy()
    return match!.route.answer({ path: match!.path, query: null, body }, environment)
}

beforeEach(() => {
    forgetDatabases()
    database = null
    // far apart, so the shared rate limits of one test never reach into the next
    clock = Math.max(clock + 3_600_000, NOW)
    asked = []
    slept = []
    answers = { [SHOW_PATH]: { body: { ...SHOW, _embedded: { episodes: EPISODES } } }, [IMAGES_PATH]: { body: IMAGES } }
})

describe("tvmaze ids", () => {
    it("are the negative TVmaze number; AniList's are positive", () => {
        expect(fromTvmazeId(95063)).toBe(-95063)
        expect(toTvmazeId(-95063)).toBe(95063)
        expect(isTvmazeId(-95063)).toBe(true)
        expect(isTvmazeId(21)).toBe(false)
        expect(isTvmazeId(0)).toBe(false)
    })
})

describe("a TVmaze show as an AniList anime", () => {
    it("has the fields entries and cards use", () => {
        const media = mediaOfShow(SHOW, EPISODES, NOW, "https://static.tvmaze.com/bg.jpg")
        expect(media).toEqual({
            id: -95063,
            type: "ANIME",
            format: "TV",
            status: "RELEASING",
            title: { romaji: "Dreamland", english: "Dreamland", userPreferred: "Dreamland" },
            synonyms: [],
            coverImage: { extraLarge: "https://static.tvmaze.com/o.jpg", large: "https://static.tvmaze.com/o.jpg", medium: "https://static.tvmaze.com/m.jpg" },
            bannerImage: "https://static.tvmaze.com/bg.jpg",
            description: "Dreamland raconte l'histoire.\n\nDeuxième.",
            genres: ["Drama", "Fantasy"],
            isAdult: false,
            siteUrl: "https://www.tvmaze.com/shows/95063/dreamland",
            startDate: { year: 2026, month: 10, day: 5 },
            season: "FALL",
            seasonYear: 2026,
            duration: 52,
            countryOfOrigin: "FR",
            meanScore: 74,
            episodes: 4,
            nextAiringEpisode: { airingAt: Date.parse("2026-11-23T19:10:00Z") / 1000, timeUntilAiring: Date.parse("2026-11-23T19:10:00Z") / 1000 - NOW / 1000, episode: 3 },
        })
    })

    it("is finished when ended, not yet released before its premiere", () => {
        const ended = mediaOfShow({ ...SHOW, status: "Ended", ended: "2026-11-30" }, [], Date.parse("2027-01-01"))
        expect(ended.status).toBe("FINISHED")
        expect(ended.endDate).toEqual({ year: 2026, month: 11, day: 30 })
        expect(ended.nextAiringEpisode).toBeUndefined()
        expect(mediaOfShow({ ...SHOW, status: "To Be Determined", premiered: "2027-02-01" }, [], NOW).status).toBe("NOT_YET_RELEASED")
        expect(mediaOfShow({ ...SHOW, premiered: "2025-12-01" }, [], NOW)).toMatchObject({ season: "WINTER", seasonYear: 2026 })
    })

    it("has episode metadata numbered across the seasons, specials apart", () => {
        const metadata = metadataOfShow(SHOW, [...EPISODES, episode(2, 1, "2027-10-01T19:10:00+00:00")])!
        expect(Object.keys(metadata.episodes as Json)).toEqual(["1", "2", "3", "4", "5"])
        expect((metadata.episodes as Json)["1"]).toMatchObject({ title: "Folge 1", image: "https://static.tvmaze.com/e1-o.jpg", hasImage: true, airDate: "2026-10-05", length: 52, summary: "Une & deux" })
        expect((metadata.episodes as Json)["5"]).toMatchObject({ seasonNumber: 2, episodeNumber: 1, absoluteEpisodeNumber: 5 })
        expect(metadata).toMatchObject({ titles: { en: "Dreamland" }, episodeCount: 5, specialCount: 1, mappings: { thetvdbId: 456789 } })
        expect(metadataOfShow(SHOW, [])).toBeNull()
        expect(plainText("a<br/>b &lt;c&gt;")).toBe("a\nb <c>")
    })
})

describe("details of a title", () => {
    it("go to TVmaze for a negative number", async () => {
        const media = await ask("GET", "/api/v1/anilist/media-details/-95063") as Json
        expect(media).toMatchObject({ id: -95063, title: { english: "Dreamland" }, episodes: 4, bannerImage: "https://static.tvmaze.com/bg.jpg" })
        expect(asked).toEqual([SHOW_PATH, IMAGES_PATH])
    })

    it("go to AniList for a positive number, as before", async () => {
        answers["anilist:AnimeDetails"] = { body: { data: { Media: { id: 21, title: { romaji: "One Piece" } } } } }
        const media = await ask("GET", "/api/v1/anilist/media-details/21") as Json
        expect(media).toEqual({ id: 21, title: { romaji: "One Piece" } })
        expect(asked).toEqual(["anilist:AnimeDetails"])
    })

    it("are the kept answer when TVmaze cannot be reached", async () => {
        const first = await ask("GET", "/api/v1/anilist/media-details/-95063") as Json
        answers = {}
        clock += 60_000
        const again = await ask("GET", "/api/v1/anilist/media-details/-95063") as Json
        // the same show; only the time until the next episode went on
        expect({ ...again, nextAiringEpisode: null }).toEqual({ ...first, nextAiringEpisode: null })
        expect((again.nextAiringEpisode as Json).timeUntilAiring).toBe((first.nextAiringEpisode as Json).timeUntilAiring as number - 60)
        // kept within SHOW_FRESH_MS: answered from the store without asking TVmaze
        expect(asked).toEqual([SHOW_PATH, IMAGES_PATH])
        // after that TVmaze is asked again, and when it fails the kept show is still the answer
        clock += SHOW_FRESH_MS
        const later = await ask("GET", "/api/v1/anilist/media-details/-95063") as Json
        expect(later).toMatchObject({ id: -95063, title: { english: "Dreamland" } })
        expect(asked).toEqual([SHOW_PATH, IMAGES_PATH, SHOW_PATH])
    })

    it("are asked of TVmaze again once kept longer than SHOW_FRESH_MS", async () => {
        await ask("GET", "/api/v1/anilist/media-details/-95063")
        clock += SHOW_FRESH_MS - 1
        await ask("GET", "/api/v1/anilist/media-details/-95063")
        expect(asked).toEqual([SHOW_PATH, IMAGES_PATH])
        clock += 1
        await ask("GET", "/api/v1/anilist/media-details/-95063")
        expect(asked).toEqual([SHOW_PATH, IMAGES_PATH, SHOW_PATH, IMAGES_PATH])
    })

    it("fail with 500 when nothing is kept, with 404 when TVmaze has no such show", async () => {
        answers = {}
        await expect(ask("GET", "/api/v1/anilist/media-details/-95063")).rejects.toEqual(new CoreError("no cached data available", 500))
        answers = { [SHOW_PATH]: { status: 404, body: { name: "Not Found", status: 404 } } }
        const failure = await ask("GET", "/api/v1/anilist/media-details/-95063").catch(error => error as CoreError)
        expect(failure).toBeInstanceOf(CoreError)
        expect((failure as CoreError).status).toBe(404)
    })

    it("are an entry page with the episodes not in the library", async () => {
        const entry = await ask("GET", "/api/v1/library/anime-entry/-95063") as { mediaId: number, media: Json, listData?: unknown, libraryData?: unknown, downloadInfo: { episodesToDownload: { episodeNumber: number }[] } }
        expect(entry).toMatchObject({ mediaId: -95063, media: { id: -95063, title: { english: "Dreamland" } } })
        expect(entry.listData).toBeUndefined()
        expect(entry.libraryData).toBeUndefined()
        expect(entry.downloadInfo.episodesToDownload.map(item => item.episodeNumber)).toEqual([1, 2])
    })

    it("give the episodes of a TVmaze title to the episode collection", async () => {
        const collection = await ask("GET", "/api/v1/anime/episode-collection/-95063") as { hasMappingError: boolean, episodes: Json[], metadata: Json }
        expect(collection.hasMappingError).toBe(false)
        // two aired by now (the third airs on 23.11.)
        expect(collection.episodes.map(item => item.episodeTitle)).toEqual(["Folge 1", "Folge 2"])
        expect(collection.metadata.episodeCount).toBe(4)
    })
})

describe("TVmaze's rate limit", () => {
    it("waits out a 429 and asks again", async () => {
        answers["/shows/1"] = [{ status: 429, headers: { "Retry-After": "2" } }, { body: { id: 1, name: "Under the Dome" } }]
        const client = { fetch: double, now: () => clock, sleep: environment.sleep, rateLimit: newTvmazeRateLimit() }
        expect(await askTvmaze(client, "/shows/1")).toEqual({ id: 1, name: "Under the Dome" })
        expect(slept).toEqual([2000])
        expect(asked).toEqual(["/shows/1", "/shows/1"])
    })

    it("gives up after the retries", async () => {
        answers["/shows/1"] = { status: 429 }
        const client = { fetch: double, now: () => clock, sleep: environment.sleep, rateLimit: newTvmazeRateLimit() }
        await expect(askTvmaze(client, "/shows/1")).rejects.toEqual(new TvmazeFailure("TVmaze's rate limit is reached", 429))
        expect(asked.length).toBe(3)
    })

    it("does not send more than 20 requests in 10 seconds", async () => {
        answers["/shows/1"] = { body: { id: 1 } }
        const client = { fetch: double, now: () => clock, sleep: environment.sleep, rateLimit: newTvmazeRateLimit() }
        for (let index = 0; index < 21; index++) await askTvmaze(client, "/shows/1")
        expect(slept).toEqual([10_000])
    })
})

describe("search of the other sources", () => {
    it("answers in the form of AniList's search, kept for when TVmaze fails", async () => {
        answers["/search/shows?q=Dreamland"] = { body: [{ score: 0.9, show: SHOW }, { score: 0.5, show: { id: 8, name: "Dreamland", type: "Scripted" } }, { score: 0.1, show: { id: 7, name: "Other", type: "Animation" } }] }
        const found = await searchOtherSources(environment, "Dreamland") as { Page: { media: Json[] } }
        // the live-action series of the same name stays out
        expect(found.Page.media.map(media => [media.id, (media.title as Json).english])).toEqual([[-95063, "Dreamland"], [-7, "Other"]])
        answers = {}
        expect(await searchOtherSources(environment, "dreamland ")).toEqual(found)
        expect(await searchOtherSources(environment, "  ")).toEqual({ Page: { pageInfo: { hasNextPage: false, total: 0 }, media: [] } })
    })

    it("is the core's POST /api/v1/other-sources/search", async () => {
        answers["/search/shows?q=Dreamland"] = { body: [{ score: 0.9, show: SHOW }] }
        const found = await ask("POST", "/api/v1/other-sources/search", { query: "Dreamland" }) as { Page: { media: Json[] } }
        expect(found.Page.media).toMatchObject([{ id: -95063, title: { english: "Dreamland" }, coverImage: { large: expect.any(String) } }])
        expect(await ask("POST", "/api/v1/other-sources/search", { query: 7 })).toEqual({ Page: { pageInfo: { hasNextPage: false, total: 0 }, media: [] } })
        expect(await ask("POST", "/api/v1/other-sources/search")).toEqual({ Page: { pageInfo: { hasNextPage: false, total: 0 }, media: [] } })
    })
})

describe("own shows of the other sources (B3)", () => {
    it("keeps the progress of a TVmaze title on the device and never asks or changes AniList", async () => {
        expect(await ask("POST", "/api/v1/library/anime-entry/update-progress", { mediaId: -95063, episodeNumber: 2, totalEpisodes: 8 })).toBe(true)
        // the player's own progress never lowers it
        expect(await ask("POST", "/api/v1/library/anime-entry/update-progress", { mediaId: -95063, episodeNumber: 1, totalEpisodes: 8, auto: true })).toBe(true)
        const entry = await ask("GET", "/api/v1/library/anime-entry/-95063") as { listData?: { progress: number } }
        expect(entry.listData?.progress).toBe(2)
        expect(asked.filter(key => key.startsWith("anilist:"))).toEqual([])
    })

    it("lists the titles in My shows and takes only TVmaze ids", async () => {
        expect(await ask("GET", "/api/v1/other-sources/my-shows")).toEqual([])
        expect(await ask("POST", "/api/v1/other-sources/my-shows", { mediaId: -95063, listed: true })).toBe(true)
        expect((await ask("GET", "/api/v1/other-sources/my-shows") as Json[]).map(show => show.id)).toEqual([-95063])
        await ask("POST", "/api/v1/other-sources/my-shows", { mediaId: -95063, listed: false })
        expect(await ask("GET", "/api/v1/other-sources/my-shows")).toEqual([])
        const failure = await ask("POST", "/api/v1/other-sources/my-shows", { mediaId: 21, listed: true }).catch(error => error as CoreError)
        expect(failure).toBeInstanceOf(CoreError)
        expect(asked.filter(key => key.startsWith("anilist:"))).toEqual([])
    })

    it("progress and the My shows switch at the same time keep both", async () => {
        await Promise.all([
            ask("POST", "/api/v1/library/anime-entry/update-progress", { mediaId: -95063, episodeNumber: 3, totalEpisodes: 8, auto: true }),
            ask("POST", "/api/v1/other-sources/my-shows", { mediaId: -95063, listed: true }),
        ])
        expect(await ownShowOf(environment, -95063)).toEqual({ progress: 3, listed: true })
        await Promise.all([
            ask("POST", "/api/v1/other-sources/my-shows", { mediaId: -95063, listed: false }),
            ask("POST", "/api/v1/library/anime-entry/update-progress", { mediaId: -95063, episodeNumber: 2, totalEpisodes: 8, auto: true }),
        ])
        expect(await ownShowOf(environment, -95063)).toEqual({ progress: 3, listed: false })
        await ask("POST", "/api/v1/library/anime-entry/update-progress", { mediaId: -95063, episodeNumber: 1, totalEpisodes: 8 })
        expect(await ownShowOf(environment, -95063)).toEqual({ progress: 1, listed: false })
    })

    it("My shows asks TVmaze once per show and then answers from the store", async () => {
        await ask("POST", "/api/v1/other-sources/my-shows", { mediaId: -95063, listed: true })
        await ask("GET", "/api/v1/other-sources/my-shows")
        answers = {}
        expect((await ask("GET", "/api/v1/other-sources/my-shows") as Json[]).map(show => show.id)).toEqual([-95063])
        expect(asked).toEqual([SHOW_PATH, IMAGES_PATH])
    })
})
