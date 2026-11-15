import { beforeEach, describe, expect, it } from "vitest"
import { sqlDriverFor } from "@/api/client/core-database"
import { forgetDatabases, openDatabaseSync } from "../../../test/expo-sqlite"
import { type CoreDatabase, openCoreDatabase } from "../database/database"
import { account } from "../database/schema"
import { CoreError } from "../errors"
import { type CoreEnvironment, matchCoreRoute } from "../registry"
import { firstStart, patchSetting } from "../settings/settings"
import { NOTHING_KEPT } from "./anilist"
import recorded from "./anilist.recorded.json"
import { type HttpFetch, askAnilist, newRateLimit, waitBeforeNext } from "./client"
import * as queries from "./queries"

/*
 * The server's answers of 13.11.2026, trimmed to a few items each (anilist.recorded.json). AniList is played by a test
 * double that answers the core's queries with the recorded data, the way AniList sends it (with its nulls and empty
 * lists). Values such as popularity change on AniList every day, so the tests hold the form and pass the values through.
 */

type Json = Record<string, unknown>
type Answer = { status?: number, headers?: Record<string, string>, body?: unknown, fails?: boolean }

let clock = 0
let database: Promise<CoreDatabase> | null = null
let token: string | null = null
/** What the double was asked: operation name, variables, whether a token came with it */
let asked: { operation: string, variables: Json, authorized: boolean }[] = []
/** Answers by operation name; a list is used up one by one, its last one stays */
let answers: Record<string, Answer | Answer[]> = {}
/** What the core waited for (environment.sleep) */
let slept: number[] = []

const anilist: HttpFetch = async (_url, init) => {
    const { query, variables } = JSON.parse(init.body ?? "{}") as { query: string, variables: Json }
    const operation = /query\s+(\w+)/.exec(query)?.[1] ?? "?"
    asked.push({ operation, variables, authorized: !!init.headers?.Authorization })
    const planned = answers[operation]
    const answer = Array.isArray(planned) ? (planned.length > 1 ? planned.shift()! : planned[0]) : planned
    if (!answer || answer.fails) throw new TypeError("Network request failed")
    const headers = new Map(Object.entries(answer.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]))
    return { status: answer.status ?? 200, headers: { get: name => headers.get(name.toLowerCase()) ?? null }, text: async () => JSON.stringify(answer.body) }
}

const environment: CoreEnvironment = {
    fetch: anilist,
    secret: async name => (name === "seanime-core.account-token" ? token : null),
    database: () => database ??= openCoreDatabase(sqlDriverFor(openDatabaseSync("core.db") as never), () => clock),
    now: () => clock,
    pause: async () => undefined,
    sleep: async milliseconds => {
        slept.push(milliseconds)
        clock += milliseconds
    },
}

function ask(method: string, endpoint: string, body?: unknown): Promise<unknown> {
    const match = matchCoreRoute(method, endpoint)
    expect(match?.route.area, `${method} ${endpoint}`).toBe("anilist")
    return match!.route.answer({ path: match!.path, query: null, body }, environment)
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** The recorded collection as AniList sends it: null where the server left a field out, [] for no synonyms */
function asAnilistSendsIt(collection: Json): Json {
    const sent = clone(collection) as { MediaListCollection: { lists: { entries: Json[] }[] } }
    for (const list of sent.MediaListCollection.lists) {
        for (const entry of list.entries) {
            for (const date of ["startedAt", "completedAt"]) {
                if (JSON.stringify(entry[date]) === "{}") entry[date] = { year: null, month: null, day: null }
            }
            const media = entry.media as Json
            media.nextAiringEpisode ??= null
            media.synonyms ??= []
            media.bannerImage ??= null
        }
    }
    return sent
}

const ok = (data: unknown): Answer => ({ body: { data } })
const down: Answer = { fails: true }

beforeEach(() => {
    forgetDatabases()
    database = null
    // far apart, so the shared rate limit of one test never reaches into the next
    clock = (clock || Date.parse("2026-11-13T09:00:00.000Z")) + 3_600_000
    token = "test-token"
    asked = []
    slept = []
    answers = { ViewerName: ok({ Viewer: { name: "someone" } }) }
})

/** The fields of a GraphQL selection, as a tree; arguments and the operation's head are left out */
function selection(document: string): Json {
    const text = document.replace(/\([^()]*\)/g, "").replace(/^[^{]*\{/, "{")
    const tokens = text.match(/[{}]|\w+/g) ?? []
    let index = 0
    function block(): Json {
        const fields: Json = {}
        index++ // {
        while (tokens[index] !== "}") {
            const name = tokens[index++]
            fields[name] = tokens[index] === "{" ? block() : true
        }
        index++ // }
        return fields
    }
    return block()
}

/** Every field path of an answer (all items of a list together) */
function fieldTree(value: unknown, tree: Json = {}): Json {
    if (Array.isArray(value)) {
        for (const item of value) fieldTree(item, tree)
        return tree
    }
    if (value && typeof value === "object") {
        for (const [key, field] of Object.entries(value)) {
            const deeper = field && typeof field === "object" ? fieldTree(field, (tree[key] === true || !tree[key] ? {} : tree[key]) as Json) : true
            tree[key] = typeof deeper === "object" && Object.keys(deeper).length === 0 ? (tree[key] ?? true) : deeper
        }
    }
    return tree
}

/** Paths of `recorded` missing from `asked` */
function missing(recordedTree: Json, askedTree: Json, at = ""): string[] {
    return Object.entries(recordedTree).flatMap(([key, field]) => {
        if (!(key in askedTree)) return [`${at}.${key}`]
        return typeof field === "object" && typeof askedTree[key] === "object" ? missing(field as Json, askedTree[key] as Json, `${at}.${key}`) : []
    })
}

describe("the questions asked of AniList", () => {
    it("select every field of the recorded answers", () => {
        const cases: [string, string, unknown][] = [
            ["anime lists", queries.collectionQuery("ANIME"), recorded.animeCollection],
            ["manga lists", queries.collectionQuery("MANGA"), recorded.mangaCollection],
            ["anime details", queries.ANIME_DETAILS, { Media: recorded.details }],
            ["studio", queries.STUDIO_DETAILS, recorded.studio],
            ["anime search", queries.LIST_ANIME, recorded.listAnime],
            ["manga search", queries.LIST_MANGA, recorded.listManga],
            ["recent airing", queries.LIST_RECENT_AIRING, recorded.recent],
            ["statistics", queries.VIEWER_STATS, { Viewer: { statistics: { anime: recorded.stats.animeStats, manga: recorded.stats.mangaStats } } }],
        ]
        for (const [name, document, answer] of cases) expect(missing(fieldTree(answer), selection(document)), name).toEqual([])
    })

    it("are never a mutation, except the two changes, which askAnilist does not send (changes.test.ts)", async () => {
        await expect(askAnilist({ fetch: anilist, token: async () => null, now: () => clock }, "mutation { SaveMediaListEntry(id: 1) { id } }", {}))
            .rejects.toThrow("only reads")
        const changes = [queries.saveEntryMutation("ANIME"), queries.saveEntryMutation("MANGA"), queries.DELETE_ENTRY]
        for (const document of Object.values(queries).flatMap(value => (typeof value === "function" ? [value("ANIME"), value("MANGA")] : [value]))) {
            if (typeof document !== "string" || !/\{/.test(document)) continue
            expect(document.trim().startsWith(changes.includes(document) ? "mutation " : "query "), document.slice(0, 40)).toBe(true)
        }
        for (const document of changes) {
            await expect(askAnilist({ fetch: anilist, token: async () => "test-token", now: () => clock }, document, {})).rejects.toThrow("only reads")
        }
        expect(asked).toEqual([])
    })
})

describe("answers in the recorded form", () => {
    it("anime lists: raw and without custom lists, nulls and empty lists left out", async () => {
        answers.ListCollection = ok(asAnilistSendsIt(recorded.animeCollection))
        expect(await ask("GET", "/api/v1/anilist/collection/raw")).toEqual(recorded.animeCollection)
        expect(await ask("GET", "/api/v1/anilist/collection")).toEqual(recorded.animeCollection)
        expect(asked.filter(question => question.operation === "ListCollection").every(question => question.variables.userName === "someone" && question.authorized)).toBe(true)

        const custom = clone(recorded.animeCollection) as { MediaListCollection: { lists: Json[] } }
        custom.MediaListCollection.lists.push({ ...custom.MediaListCollection.lists[0], name: "Favourites", isCustomList: true, status: undefined })
        answers.ListCollection = ok(custom)
        const raw = await ask("GET", "/api/v1/anilist/collection/raw") as typeof custom
        const main = await ask("GET", "/api/v1/anilist/collection") as typeof custom
        expect(raw.MediaListCollection.lists.map(list => list.name)).toContain("Favourites")
        expect(main.MediaListCollection.lists.map(list => list.name)).not.toContain("Favourites")
    })

    it("manga lists, tags, details, studio, searches and statistics", async () => {
        answers.ListCollection = ok(recorded.mangaCollection)
        expect(await ask("GET", "/api/v1/manga/anilist/collection/raw")).toEqual(recorded.mangaCollection)

        const tagged = clone(recorded.animeCollection) as { MediaListCollection: { lists: { entries: { media: Json }[] }[] } }
        const tags = recorded.animeTags as Record<string, string[]>
        for (const list of tagged.MediaListCollection.lists) {
            for (const entry of list.entries) entry.media = { id: entry.media.id, tags: (tags[String(entry.media.id)] ?? []).map(name => ({ name })) }
        }
        answers.ListCollectionTags = ok(tagged)
        expect(await ask("GET", "/api/v1/anilist/collection/raw/tags")).toEqual(recorded.animeTags)

        answers.AnimeDetails = ok({ Media: { ...clone(recorded.details), title: undefined, bannerImage: null } })
        expect(await ask("GET", "/api/v1/anilist/media-details/105333")).toEqual(recorded.details)
        expect(asked.at(-1)?.variables).toEqual({ id: 105333 })

        answers.StudioDetails = ok(recorded.studio)
        expect(await ask("GET", "/api/v1/anilist/studio-details/73")).toEqual(recorded.studio)

        answers.ListAnime = ok(recorded.listAnime)
        expect(await ask("POST", "/api/v1/anilist/list-anime", recorded.listAnimeRequest)).toEqual(recorded.listAnime)
        expect(asked.at(-1)?.variables).toEqual(recorded.listAnimeRequest)

        answers.ListManga = ok(recorded.listManga)
        expect(await ask("POST", "/api/v1/manga/anilist/list", { ...recorded.listMangaRequest, year: 2017 })).toEqual(recorded.listManga)
        expect(asked.at(-1)?.variables).toMatchObject({ startDate_greater: 20170000, startDate_lesser: 20180000 })

        answers.ListRecentAiring = ok(recorded.recent)
        expect(await ask("POST", "/api/v1/anilist/list-recent-anime", recorded.recentRequest)).toEqual(recorded.recent)

        answers.ViewerStats = ok({ Viewer: { statistics: { anime: recorded.stats.animeStats, manga: recorded.stats.mangaStats } } })
        expect(await ask("GET", "/api/v1/anilist/stats")).toEqual(recorded.stats)
    })

    it("takes the user's name from the account the core keeps, else asks AniList who the token belongs to", async () => {
        answers.ListCollection = ok(recorded.mangaCollection)
        await ask("GET", "/api/v1/manga/anilist/collection/raw")
        expect(asked.map(question => question.operation)).toEqual(["ViewerName", "ListCollection"])

        await (await environment.database()).insert(account).values({ id: 1, username: "kept-user", viewer: null, createdAt: clock, changedAt: clock })
        asked = []
        await ask("GET", "/api/v1/manga/anilist/collection/raw")
        expect(asked).toEqual([{ operation: "ListCollection", variables: { userName: "kept-user" }, authorized: true }])
    })
})

describe("when AniList cannot be reached", () => {
    it("answers from the core's store with the last answer", async () => {
        answers.ListCollection = ok(asAnilistSendsIt(recorded.animeCollection))
        answers.AnimeDetails = ok({ Media: recorded.details })
        answers.StudioDetails = ok(recorded.studio)
        answers.ListAnime = ok(recorded.listAnime)
        answers.ViewerStats = ok({ Viewer: { statistics: { anime: recorded.stats.animeStats, manga: recorded.stats.mangaStats } } })
        await ask("GET", "/api/v1/anilist/collection/raw")
        await ask("GET", "/api/v1/anilist/media-details/105333")
        await ask("GET", "/api/v1/anilist/studio-details/73")
        await ask("POST", "/api/v1/anilist/list-anime", recorded.listAnimeRequest)
        await ask("GET", "/api/v1/anilist/stats")

        answers = { ViewerName: down, ListCollection: down, AnimeDetails: down, StudioDetails: down, ListAnime: down, ViewerStats: down }
        expect(await ask("GET", "/api/v1/anilist/collection/raw")).toEqual(recorded.animeCollection)
        expect(await ask("GET", "/api/v1/anilist/collection")).toEqual(recorded.animeCollection)
        expect(await ask("GET", "/api/v1/anilist/media-details/105333")).toEqual(recorded.details)
        expect(await ask("GET", "/api/v1/anilist/studio-details/73")).toEqual(recorded.studio)
        expect(await ask("POST", "/api/v1/anilist/list-anime", recorded.listAnimeRequest)).toEqual(recorded.listAnime)
        expect(await ask("GET", "/api/v1/anilist/stats")).toEqual(recorded.stats)
    })

    it("a newer read replaces the kept lists: an entry gone on AniList is gone in the store", async () => {
        answers.ListCollection = ok(recorded.animeCollection)
        await ask("GET", "/api/v1/anilist/collection/raw")
        const smaller = clone(recorded.animeCollection) as { MediaListCollection: { lists: { entries: unknown[] }[] } }
        smaller.MediaListCollection.lists[0].entries.pop()
        answers.ListCollection = ok(smaller)
        await ask("GET", "/api/v1/anilist/collection/raw")
        answers.ListCollection = down
        expect(await ask("GET", "/api/v1/anilist/collection/raw")).toEqual(smaller)
    })

    it("does not answer from the store with \"Turn off AniList caching\" on, and does again when it is off", async () => {
        answers.StudioDetails = ok(recorded.studio)
        await ask("GET", "/api/v1/anilist/studio-details/73")
        await firstStart({}, environment)
        await patchSetting({ path: "anilist.disableCacheLayer", value: true }, environment)
        answers = { StudioDetails: down }
        const error = await ask("GET", "/api/v1/anilist/studio-details/73").catch(caught => caught)
        expect(error).toBeInstanceOf(CoreError)
        expect((error as CoreError).message).toBe(NOTHING_KEPT)
        await patchSetting({ path: "anilist.disableCacheLayer", value: false }, environment)
        expect(await ask("GET", "/api/v1/anilist/studio-details/73")).toEqual(recorded.studio)
    })

    it("fails like the recorded server when nothing is kept", async () => {
        answers.StudioDetails = { status: 404, body: { data: { Studio: null }, errors: [{ message: "Not Found.", status: 404 }] } }
        const error = await ask("GET", "/api/v1/anilist/studio-details/999999999").catch(caught => caught)
        expect(error).toBeInstanceOf(CoreError)
        expect({ status: (error as CoreError).status, body: { error: (error as CoreError).message } }).toEqual(recorded.unknownStudio)
        expect(NOTHING_KEPT).toBe(recorded.unknownStudio.body.error)
    })

    it("a 429 with a long Retry-After is not waited for: the kept answer comes at once", async () => {
        answers.ListAnime = ok(recorded.listAnime)
        await ask("POST", "/api/v1/anilist/list-anime", recorded.listAnimeRequest)
        answers.ListAnime = { status: 429, headers: { "Retry-After": "60" }, body: { errors: [{ message: "Too Many Requests.", status: 429 }] } }
        const started = Date.now()
        expect(await ask("POST", "/api/v1/anilist/list-anime", recorded.listAnimeRequest)).toEqual(recorded.listAnime)
        expect(Date.now() - started).toBeLessThan(1000)
    })
    it("nothing kept and the rate limit reached: waits for it once and answers (the schedule after a busy start)", async () => {
        const schedule = { Page: { pageInfo: { hasNextPage: false }, airingSchedules: [{ id: 1, airingAt: 1794747600, episode: 7 }] } }
        answers.ListRecentAiring = [{ status: 429, headers: { "Retry-After": "30" } }, ok(schedule)]
        const request = { page: 1, perPage: 50, airingAt_greater: 1794697200, airingAt_lesser: 1795906800, notYetAired: true, sort: ["TIME"] }
        expect(await ask("POST", "/api/v1/anilist/list-recent-anime", request)).toEqual(schedule)
        expect(slept).toEqual([30_000])
        expect(asked.filter(question => question.operation === "ListRecentAiring")).toHaveLength(2)
    })

    it("nothing kept and the rate limit far off: fails at once, as before", async () => {
        answers.ListRecentAiring = { status: 429, headers: { "Retry-After": "120" } }
        const error = await ask("POST", "/api/v1/anilist/list-recent-anime", { page: 1, perPage: 50 }).catch(caught => caught)
        expect(error).toBeInstanceOf(CoreError)
        expect((error as CoreError).message).toBe(NOTHING_KEPT)
        expect(slept).toEqual([])
    })
})

describe("AniList's rate limit", () => {
    const client = (sleeps: number[], rateLimit = newRateLimit()) => ({ fetch: anilist, token: async () => token, now: () => clock, sleep: async (ms: number) => {
        sleeps.push(ms)
        clock += ms
    }, rateLimit })

    it("waits as long as Retry-After says and asks again", async () => {
        const sleeps: number[] = []
        answers.ListAnime = [{ status: 429, headers: { "Retry-After": "3" } }, ok(recorded.listAnime)]
        expect(await askAnilist(client(sleeps), queries.LIST_ANIME, {})).toEqual(recorded.listAnime)
        expect(sleeps).toEqual([3000])
        expect(asked).toHaveLength(2)
    })

    it("gives up after two more tries", async () => {
        const sleeps: number[] = []
        answers.ListAnime = { status: 429, headers: { "Retry-After": "1" } }
        await expect(askAnilist(client(sleeps), queries.LIST_ANIME, {})).rejects.toMatchObject({ name: "AnilistFailure", status: 429 })
        expect(asked).toHaveLength(3)
    })

    it("keeps to the limit AniList states (90, or 30 while degraded) within a minute", async () => {
        const sleeps: number[] = []
        const rateLimit = newRateLimit()
        answers.ListAnime = { ...ok(recorded.listAnime), headers: { "X-RateLimit-Limit": "30", "X-RateLimit-Remaining": "29" } }
        await askAnilist(client(sleeps, rateLimit), queries.LIST_ANIME, {})
        expect(rateLimit.limit).toBe(30)
        rateLimit.sent = Array.from({ length: 30 }, (_, index) => clock - 50_000 + index)
        expect(waitBeforeNext(rateLimit, clock)).toBe(10_000)
        await askAnilist(client(sleeps, rateLimit), queries.LIST_ANIME, {})
        expect(sleeps).toEqual([10_000])
    })

    it("sends the token only as a header and asks publicly without one", async () => {
        answers.ListAnime = ok(recorded.listAnime)
        token = null
        await askAnilist(client([]), queries.LIST_ANIME, {})
        expect(asked[0].authorized).toBe(false)
    })
})

