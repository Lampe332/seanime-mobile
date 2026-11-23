// geschrieben nach: öffentliche AniList-Doku (Media.relations, Rate-Limit 90/min, 429 mit Retry-After) und docs/EIGENER-KERN.md §4p; kein Server-Quelltext
import { beforeEach, describe, expect, it } from "vitest"
import { sqlDriverFor } from "@/api/client/core-database"
import { forgetDatabases, openDatabaseSync } from "../../../test/expo-sqlite"
import { CoreError } from "../errors"
import { onCoreEvent } from "../events"
import { type CoreDatabase, openCoreDatabase } from "../database/database"
import { type CoreEnvironment, type CoreMethod, matchCoreRoute } from "../registry"
import { ANILIST_URL, type HttpFetch } from "./client"
import { keepCollection, storedCollection } from "./store"

/*
 * Missed sequels when the lists are not kept yet, for long lists (more than one request) and when AniList's rate limit is
 * reached in the middle. Titles and numbers are made up.
 */

type Json = Record<string, unknown>

let clock = 0
let database: CoreDatabase | null = null
let slept: number[] = []
let asked: { operation: string, variables: Json }[] = []
/** The relations AniList answers, by anime */
let relations: Record<number, Json[]> = {}
/** The user's lists as AniList answers them; null: AniList cannot be reached for them */
let anilistLists: Json[] | null = null
/** Answers of RelatedAnime in order; the rest is answered normally */
let relatedStatuses: { status: number, retryAfter?: string }[] = []
/** AniList does not answer RelatedAnime before this is over (a long list at the app's start); null: at once */
let relatedHeld: Promise<void> | null = null
/** The work the core started that no request waits for */
let unasked: Promise<unknown> = Promise.resolve()

const reply = (status: number, data: unknown, headers: Record<string, string> = {}) => ({
    status, headers: { get: (name: string) => headers[name] ?? null }, text: async () => JSON.stringify(data),
})

const anilist: HttpFetch = async (url, init) => {
    if (url !== ANILIST_URL) throw new TypeError(`no network in tests: ${url}`)
    const { query, variables } = JSON.parse(init.body ?? "{}") as { query: string, variables: Json }
    const operation = /query (\w+)/.exec(query)?.[1] ?? "?"
    asked.push({ operation, variables })
    if (operation === "ViewerName") return reply(200, { data: { Viewer: { name: "someone" } } })
    if (operation === "ListCollection") {
        if (!anilistLists) throw new TypeError("no network")
        return reply(200, { data: { MediaListCollection: { lists: anilistLists } } })
    }
    if (operation === "RelatedAnime") {
        await relatedHeld
        const next = relatedStatuses.shift()
        if (next && next.status !== 200) return reply(next.status, { errors: [{ message: "Too Many Requests.", status: next.status }] }, next.retryAfter ? { "Retry-After": next.retryAfter } : {})
        const ids = (variables.ids ?? []) as number[]
        return reply(200, { data: { Page: { pageInfo: { hasNextPage: false }, media: ids.map(id => ({ id, relations: { edges: relations[id] ?? [] } })) } } })
    }
    throw new TypeError(`unexpected question: ${operation}`)
}

const environment = {
    fetch: anilist,
    secret: async () => "token",
    server: async () => ({}),
    database: async () => database ??= await openCoreDatabase(sqlDriverFor(openDatabaseSync("core.db") as never), () => clock),
    now: () => clock,
    pause: async () => undefined,
    unasked: (_what: string, work: () => Promise<unknown>) => unasked = work(),
    sleep: async (milliseconds: number) => {
        slept.push(milliseconds)
        clock += milliseconds
    },
} as unknown as CoreEnvironment

async function call(method: CoreMethod, endpoint: string): Promise<unknown> {
    const matched = matchCoreRoute(method, endpoint)
    if (!matched) throw new Error(`no route: ${method} ${endpoint}`)
    return matched.route.answer({ path: matched.path, query: null, body: null }, environment)
}

const media = (id: number, fields: Json = {}): Json => ({
    id, type: "ANIME", status: "FINISHED", format: "TV", title: { userPreferred: `Made ${id}` }, startDate: { year: 2020, month: 1, day: id % 28 + 1 }, ...fields,
})
const entry = (id: number, status: string): Json => ({ id: id * 10, status, progress: 1, media: media(id) })
const listsOf = (entries: Json[]): Json[] => {
    const byStatus = new Map<string, Json[]>()
    for (const item of entries) byStatus.set(item.status as string, [...(byStatus.get(item.status as string) ?? []), item])
    return [...byStatus].map(([status, items]) => ({ status, name: status, isCustomList: false, entries: items }))
}
const sequel = (id: number) => ({ relationType: "SEQUEL", node: media(id) })
const related = () => asked.filter(question => question.operation === "RelatedAnime")

beforeEach(() => {
    forgetDatabases()
    database = null
    // far apart, so the shared rate limit of one test never reaches into the next
    clock = (clock || Date.parse("2026-11-20T09:00:00.000Z")) + 3_600_000
    slept = []
    asked = []
    relations = {}
    anilistLists = null
    relatedStatuses = []
    relatedHeld = null
    unasked = Promise.resolve()
})

describe("missed sequels", () => {
    it("reads the lists when none are kept yet instead of answering an empty list", async () => {
        anilistLists = listsOf([entry(1, "COMPLETED"), entry(2, "PLANNING")])
        relations = { 1: [sequel(100), sequel(2)] }
        const sequels = await call("GET", "/api/v1/anilist/list-missed-sequels") as Json[]
        expect(sequels.map(item => item.id)).toEqual([100])
        expect(asked.map(question => question.operation)).toContain("ListCollection")
        // the lists read are kept for the next time
        expect(await storedCollection(await environment.database(), "ANIME")).not.toBeNull()
    })

    it("fails without lists and keeps nothing, so that a later request answers with the real sequels", async () => {
        relations = { 1: [sequel(100)] }
        const error = await call("GET", "/api/v1/anilist/list-missed-sequels").catch(caught => caught)
        expect(error).toBeInstanceOf(CoreError)
        expect(related()).toHaveLength(0)
        anilistLists = listsOf([entry(1, "COMPLETED")])
        expect((await call("GET", "/api/v1/anilist/list-missed-sequels") as Json[]).map(item => item.id)).toEqual([100])
    })

    it("asks 25 anime at a time and finds the sequels of all of them", async () => {
        const ids = Array.from({ length: 30 }, (_, index) => index + 1)
        await keepCollection(await environment.database(), "ANIME", { MediaListCollection: { lists: listsOf(ids.map(id => entry(id, "COMPLETED"))) as never } }, clock)
        relations = { 3: [sequel(103)], 28: [sequel(128)] }
        const sequels = await call("GET", "/api/v1/anilist/list-missed-sequels") as Json[]
        expect(related().map(question => (question.variables.ids as number[]).length)).toEqual([25, 5])
        expect(sequels.map(item => item.id).sort()).toEqual([103, 128])
    })

    it("waits for the rate limit reached in the middle and keeps the pages read before it", async () => {
        const ids = Array.from({ length: 30 }, (_, index) => index + 1)
        await keepCollection(await environment.database(), "ANIME", { MediaListCollection: { lists: listsOf(ids.map(id => entry(id, "COMPLETED"))) as never } }, clock)
        relations = { 3: [sequel(103)], 28: [sequel(128)] }
        relatedStatuses = [{ status: 200 }, { status: 429, retryAfter: "30" }]
        const sequels = await call("GET", "/api/v1/anilist/list-missed-sequels") as Json[]
        expect(sequels.map(item => item.id).sort()).toEqual([103, 128])
        expect(slept).toEqual([30_000])
        // the first 25 once, the last five twice (429, then the answer)
        expect(related().map(question => (question.variables.ids as number[])[0])).toEqual([1, 26, 26])
    })

    it("a rate limit too far off fails the request instead of answering \"no sequels\"", async () => {
        await keepCollection(await environment.database(), "ANIME", { MediaListCollection: { lists: listsOf([entry(1, "COMPLETED")]) as never } }, clock)
        relations = { 1: [sequel(100)] }
        relatedStatuses = [{ status: 429, retryAfter: "120" }]
        const error = await call("GET", "/api/v1/anilist/list-missed-sequels").catch(caught => caught)
        expect(error).toBeInstanceOf(CoreError)
        clock += 180_000
        expect((await call("GET", "/api/v1/anilist/list-missed-sequels") as Json[]).map(item => item.id)).toEqual([100])
    })

    /** The app starts again: the answer of the last run is kept, AniList is slow with the relations */
    async function keptThenStartedAgain(): Promise<() => void> {
        await keepCollection(await environment.database(), "ANIME", { MediaListCollection: { lists: listsOf([entry(1, "COMPLETED")]) as never } }, clock)
        relations = { 1: [sequel(100)] }
        expect((await call("GET", "/api/v1/anilist/list-missed-sequels") as Json[]).map(item => item.id)).toEqual([100])
        clock += 3_600_000
        asked = []
        let release = () => undefined as void
        relatedHeld = new Promise<void>(resolve => release = resolve)
        return release
    }
    const soon = () => new Promise<string>(resolve => setTimeout(() => resolve("still waiting for AniList"), 50))

    it("answers with the kept sequels at once at the app's start, reads AniList after it and tells the app what changed", async () => {
        const release = await keptThenStartedAgain()
        relations = { 1: [sequel(100), sequel(101)] }
        const first = await Promise.race([call("GET", "/api/v1/anilist/list-missed-sequels"), soon()])
        expect(first).not.toBe("still waiting for AniList")
        expect((first as Json[]).map(item => item.id)).toEqual([100])
        // asked again meanwhile (Discover, an invalidation): the same answer, AniList is not asked twice
        expect((await call("GET", "/api/v1/anilist/list-missed-sequels") as Json[]).map(item => item.id)).toEqual([100])
        const events: string[] = []
        const end = onCoreEvent(event => events.push(event.type))
        release()
        await unasked
        await new Promise(resolve => setTimeout(resolve, 10))
        end()
        expect(events).toEqual(["refreshed-missed-sequels"])
        expect(related()).toHaveLength(1)
        // what the app then asks for is the new answer, and AniList is not read again for it
        expect((await call("GET", "/api/v1/anilist/list-missed-sequels") as Json[]).map(item => item.id)).toEqual([101, 100])
        expect(related()).toHaveLength(1)
    })

    it("leaves a kept sequel out at once when it is in a list by now, and tells the app nothing when AniList agrees", async () => {
        const release = await keptThenStartedAgain()
        await keepCollection(await environment.database(), "ANIME", { MediaListCollection: { lists: listsOf([entry(1, "COMPLETED"), entry(100, "PLANNING")]) as never } }, clock)
        const events: string[] = []
        const end = onCoreEvent(event => events.push(event.type))
        expect(await Promise.race([call("GET", "/api/v1/anilist/list-missed-sequels"), soon()])).toEqual([])
        release()
        await unasked
        await new Promise(resolve => setTimeout(resolve, 10))
        end()
        expect(events).toEqual([])
    })

    it("keeps answering with the kept sequels when AniList fails after the answer", async () => {
        const release = await keptThenStartedAgain()
        relatedStatuses = [{ status: 500 }]
        release()
        expect((await call("GET", "/api/v1/anilist/list-missed-sequels") as Json[]).map(item => item.id)).toEqual([100])
        await unasked.catch(() => undefined)
        // not read: the next request reads again
        relatedStatuses = []
        relations = { 1: [sequel(101)] }
        expect((await call("GET", "/api/v1/anilist/list-missed-sequels") as Json[]).map(item => item.id)).toEqual([100])
        await unasked
        expect((await call("GET", "/api/v1/anilist/list-missed-sequels") as Json[]).map(item => item.id)).toEqual([101])
    })
})
