// geschrieben nach: Aufzeichnung api-anilist-schreibend vom 13.11.2026 (changes.recorded.json) und Plan „Eigener Kern" Stufe 2b (was die Warteschlange halten muss); AniList ist hier ein Test-Double, keine Anfrage verlässt den Test

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { sqlDriverFor } from "@/api/client/core-database"
import { forgetDatabases, openDatabaseSync } from "../../../test/expo-sqlite"
import { type CoreDatabase, openCoreDatabase } from "../database/database"
import { account, anilistChanges } from "../database/schema"
import { type CoreEvent, onCoreEvent } from "../events"
import { type CoreEnvironment, matchCoreRoute } from "../registry"
import {
    CHANGES_LOCKED,
    anilistSyncState,
    CHANGES_UNCHECKED,
    KEPT_FOR_LATER,
    entryWithWaitingChange,
    forgetChanges,
    localEntryDates,
    sendWaitingChanges,
    waitingChanges,
} from "./changes"
import recorded from "./changes.recorded.json"
import { watchAnilistState } from "./cache-only"
import { AnilistFailure, type HttpFetch, askAnilist, changeAnilist, rejectsSignIn } from "./client"
import { VIEWER_ID, saveEntryMutation } from "./queries"
import { keepAnswer } from "./store"
import { listEntryPayload } from "@/main/_features/media/_lib/list-entry-form"

/*
 * AniList is played by a small double that keeps list entries the way AniList does as far as the recording shows it:
 * a change sets the fields sent and leaves the others, a first progress starts the entry today, reaching "completed"
 * completes it today. It can be down, answer with a status, or refuse the next change. No test sends anything anywhere.
 */

type Json = Record<string, unknown>
type Day = { year: number | null, month: number | null, day: number | null }
type Entry = { id: number, status: string, score: number, progress: number, repeat: number, private: boolean, startedAt: Day, completedAt: Day, updatedAt: number, createdAt: number }

const TEST_ACCOUNT = 1234567
const ANIME = 105333
const MANGA = 98416
const KINDS: Record<number, "ANIME" | "MANGA"> = { [ANIME]: "ANIME", 1: "ANIME", 20: "ANIME", 21: "ANIME", [MANGA]: "MANGA" }
const NO_DAY: Day = { year: null, month: null, day: null }
const NAMES: Record<string, string> = { CURRENT: "Watching", PLANNING: "Planning", COMPLETED: "Completed", PAUSED: "Paused", DROPPED: "Dropped", REPEATING: "Rewatching" }

let clock = 0
let database: Promise<CoreDatabase> | null = null
let token: string | null = null
let entries = new Map<number, Entry>()
let nextNumber = 7001
let reach: "up" | "down" | number = "up"
/** AniList's reasons for refusing the next change */
let refuse: string[] | null = null
let viewer = TEST_ACCOUNT
let asked: { operation: string, variables: Json, document: string }[] = []
let onlyAccount: number | null = null
let events: CoreEvent[] = []
/** AniList turns the token away: "Invalid token" with 400, as it answers an expired or revoked one */
let tokenRefused = false

function todayOf(time: number): Day {
    const date = new Date(time)
    return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() }
}

function titleOf(id: number): Json {
    const manga = KINDS[id] === "MANGA"
    return {
        id, idMal: null, siteUrl: `https://anilist.co/${manga ? "manga" : "anime"}/${id}`, status: "FINISHED", type: KINDS[id], format: manga ? "MANGA" : "TV",
        bannerImage: null, synonyms: [], isAdult: false, countryOfOrigin: "JP", meanScore: 80, description: "A title", genres: ["Adventure"],
        title: { userPreferred: `Title ${id}`, romaji: `Title ${id}`, english: null, native: null },
        coverImage: { extraLarge: "https://example.org/cover.jpg", large: null, medium: null, color: null },
        startDate: { year: 2019, month: 7, day: 5 }, endDate: NO_DAY,
        ...(manga ? { chapters: 236 } : { episodes: 24, season: "SUMMER", seasonYear: 2019, duration: 24, trailer: null, nextAiringEpisode: null }),
    }
}

function put(mediaId: number, fields: Partial<Entry>) {
    const seconds = Math.floor(clock / 1000)
    entries.set(mediaId, { id: nextNumber++, status: "CURRENT", score: 0, progress: 0, repeat: 0, private: false, startedAt: NO_DAY, completedAt: NO_DAY, updatedAt: seconds, createdAt: seconds, ...fields })
}

const anilist: HttpFetch = async (_url, init) => {
    const { query, variables } = JSON.parse(init.body ?? "{}") as { query: string, variables: Json }
    const operation = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "?"
    asked.push({ operation, variables, document: query })
    if (reach === "down") throw new TypeError("Network request failed")
    const answer = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
        status, headers: { get: (name: string) => headers[name.toLowerCase()] ?? null }, text: async () => JSON.stringify(body),
    })
    if (tokenRefused && init.headers?.Authorization) return answer(400, { errors: [{ message: "Invalid token", status: 400, locations: [{ line: 1, column: 1 }] }], data: null })
    if (typeof reach === "number") return answer(reach, { errors: [{ message: "AniList is having a bad day", status: reach }], data: null }, { "retry-after": "60" })
    const ok = (data: unknown) => answer(200, { data })
    if (query.trimStart().startsWith("mutation") && refuse) {
        const reasons = refuse
        refuse = null
        return answer(400, { errors: [{ message: "validation", status: 400, validation: { field: reasons } }], data: null })
    }
    const seconds = Math.floor(clock / 1000)
    if (operation === "ViewerId") return ok({ Viewer: { id: viewer } })
    if (operation === "LoginViewer") return ok({ Viewer: { id: viewer, name: "tester", avatar: null, isBlocked: false, options: null } })
    if (operation === "ViewerEntry") {
        const id = variables.id as number
        if (!KINDS[id]) return answer(404, { errors: [{ message: "Not Found.", status: 404 }], data: { Media: null } })
        return ok({ Media: { mediaListEntry: entries.get(id) ?? null } })
    }
    if (operation === "ListCollection") {
        const kind = /type: (ANIME|MANGA)/.exec(query)?.[1]
        const lists = new Map<string, Json[]>()
        for (const [mediaId, entry] of entries) {
            if (KINDS[mediaId] !== kind) continue
            lists.set(entry.status, [...(lists.get(entry.status) ?? []), { ...entry, media: titleOf(mediaId) }])
        }
        return ok({ MediaListCollection: { lists: [...lists].map(([status, items]) => ({ status, name: NAMES[status], isCustomList: false, entries: items })) } })
    }
    if (operation === "SaveEntry") {
        const mediaId = variables.mediaId as number
        const before = entries.get(mediaId)
        const entry: Entry = before ? { ...before } : { id: nextNumber++, status: "CURRENT", score: 0, progress: 0, repeat: 0, private: false, startedAt: NO_DAY, completedAt: NO_DAY, updatedAt: seconds, createdAt: seconds }
        if ("status" in variables) entry.status = variables.status as string
        if ("scoreRaw" in variables) entry.score = variables.scoreRaw as number
        if ("progress" in variables) entry.progress = variables.progress as number
        if ("repeat" in variables) entry.repeat = variables.repeat as number
        if ("startedAt" in variables) entry.startedAt = variables.startedAt as Day
        else if (!before && entry.status === "CURRENT") entry.startedAt = todayOf(clock)
        if ("completedAt" in variables) entry.completedAt = variables.completedAt as Day
        else if (entry.status === "COMPLETED" && before?.status !== "COMPLETED") entry.completedAt = todayOf(clock)
        entry.updatedAt = seconds
        entries.set(mediaId, entry)
        return ok({ SaveMediaListEntry: { ...entry, media: titleOf(mediaId) } })
    }
    if (operation === "DeleteEntry") {
        for (const [mediaId, entry] of entries) if (entry.id === variables.id) entries.delete(mediaId)
        return ok({ DeleteMediaListEntry: { deleted: true } })
    }
    throw new Error(`the double does not know ${operation}`)
}

const environment: CoreEnvironment = {
    fetch: anilist,
    secret: async name => (name === "seanime-core.account-token" ? token : null),
    keepSecret: async (name, value) => {
        if (name === "seanime-core.account-token") token = value
    },
    database: () => database ??= openCoreDatabase(sqlDriverFor(openDatabaseSync("core.db") as never), () => clock),
    now: () => clock,
    pause: async () => undefined,
    onlyAccount: () => onlyAccount,
}

function ask(method: string, endpoint: string, body?: unknown): Promise<unknown> {
    const match = matchCoreRoute(method, endpoint)
    expect(match?.route.area, `${method} ${endpoint}`).toBe("anilist")
    return match!.route.answer({ path: match!.path, query: null, body }, environment)
}

const edit = (body: unknown) => ask("POST", "/api/v1/anilist/list-entry", body)
const remove = (body: unknown) => ask("DELETE", "/api/v1/anilist/list-entry", body)
const watched = (mediaId: number, episodeNumber: number, totalEpisodes = 24) => ask("POST", "/api/v1/library/anime-entry/update-progress", { mediaId, episodeNumber, totalEpisodes })

type Lists = { MediaListCollection: { lists: { status: string, name: string, isCustomList: boolean, entries?: (Json & { media: Json })[] }[] } }

/** The lists as the app gets them; with AniList down they are the core's own */
async function lists(kind: "ANIME" | "MANGA" = "ANIME"): Promise<Lists> {
    return await ask("GET", kind === "ANIME" ? "/api/v1/anilist/collection/raw" : "/api/v1/manga/anilist/collection/raw") as Lists
}

async function entryInLists(mediaId: number, kind: "ANIME" | "MANGA" = "ANIME") {
    for (const list of (await lists(kind)).MediaListCollection.lists) {
        const entry = list.entries?.find(item => item.media.id === mediaId)
        if (entry) return { list, entry }
    }
    return null
}

async function signIn(username: string) {
    const opened = await environment.database()
    await opened.insert(account).values({ id: 1, username, createdAt: clock, changedAt: clock })
        .onConflictDoUpdate({ target: account.id, set: { username, changedAt: clock } })
}

const rows = async () => (await environment.database()).select().from(anilistChanges).orderBy(anilistChanges.id)
const sent = (operation: string) => asked.filter(item => item.operation === operation)
/** Events arrive in a turn of their own */
const settled = () => new Promise(resolve => setTimeout(resolve, 5))

let stopListening = () => undefined as void
beforeAll(() => {
    stopListening = onCoreEvent(event => events.push(event))
})
afterAll(() => {
    stopListening()
    forgetChanges()
})

beforeEach(async () => {
    forgetDatabases()
    forgetChanges()
    database = null
    // far apart, so that the rate limit all requests share never reaches from one test into the next
    clock = (clock || Date.parse("2026-11-13T09:00:00.000Z")) + 3_600_000
    token = "test-token"
    entries = new Map()
    reach = "up"
    refuse = null
    viewer = TEST_ACCOUNT
    onlyAccount = null
    tokenRefused = false
    await signIn("someone")
    asked = []
    await settled()
    events = []
})

describe("changing a list entry, held against the recording", () => {
    it("answers like the server and sends AniList what the request says", async () => {
        await lists()
        asked = []
        expect(await edit(recorded.requests.editAdd)).toBe(recorded.answer)
        expect(sent("SaveEntry")[0].variables).toEqual({ mediaId: ANIME, status: "PLANNING", scoreRaw: 0, progress: 0, startedAt: NO_DAY, completedAt: NO_DAY })
        expect(asked.map(item => item.operation)).toEqual(["SaveEntry"])

        // AniList cannot be asked: what follows is what the core kept of its answer
        reach = "down"
        const added = await entryInLists(ANIME)
        expect({ status: added?.list.status, name: added?.list.name, isCustomList: added?.list.isCustomList }).toEqual(recorded.afterAdd.list)
        const { media, ...own } = added!.entry
        expect(Object.keys(own).sort()).toEqual(Object.keys(recorded.afterAdd.entry).sort())
        expect(own).toMatchObject({ status: "PLANNING", progress: 0, score: 0, repeat: 0, private: false, startedAt: {}, completedAt: {} })
        expect(media.id).toBe(ANIME)

        reach = "up"
        expect(await edit(recorded.requests.edit)).toBe(recorded.answer)
        // a date the request leaves out is taken away
        expect(sent("SaveEntry")[1].variables).toEqual({ mediaId: ANIME, status: "CURRENT", scoreRaw: 80, progress: 3, startedAt: { year: 2026, month: 11, day: 1 }, completedAt: NO_DAY })
        reach = "down"
        const edited = await entryInLists(ANIME)
        expect(edited?.list.name).toBe(recorded.afterEdit.list.name)
        expect(edited?.entry).toMatchObject({ ...recorded.afterEdit.entry, id: added!.entry.id, createdAt: added!.entry.createdAt, updatedAt: Math.floor(clock / 1000) })
        expect(await waitingChanges(environment)).toBe(0)
    })

    it("refuses what AniList refused, in AniList's words, with the server's status", async () => {
        for (const refused of [recorded.errors.editWithoutScore, recorded.errors.editWithoutScoreAndProgress]) {
            await expect(edit(refused.request)).rejects.toMatchObject({ message: refused.anilistSaid.join(" "), status: recorded.errors.status })
        }
        expect(asked).toEqual([])

        // what only AniList can know: it refuses, the change is gone, the caller gets its words
        const words = recorded.errors.editUnknownTitle.anilistSaid
        refuse = words
        await expect(edit({ ...recorded.errors.editUnknownTitle.request, mediaId: 20 })).rejects.toMatchObject({ message: words.join(" "), status: recorded.errors.status })
        expect(await waitingChanges(environment)).toBe(0)

        await expect(remove(recorded.errors.deleteWithoutType.request)).rejects.toMatchObject({ message: recorded.errors.deleteWithoutType.error, status: recorded.errors.status })
        await expect(remove(recorded.errors.deleteNotInList.request)).rejects.toMatchObject({ message: recorded.errors.deleteNotInList.error, status: recorded.errors.status })
        expect(sent("DeleteEntry")).toEqual([])
    })

    it("leaves the status the server left after a progress", async () => {
        for (const step of recorded.statusAfterProgress) {
            entries = new Map()
            if (step.before) put(1, { status: step.before, progress: 5, completedAt: step.before === "COMPLETED" ? { year: 2026, month: 1, day: 2 } : NO_DAY })
            await lists()
            asked = []
            expect(await watched(1, step.progress, step.total), step.case).toBe(recorded.answer)
            expect(asked.map(item => item.variables), step.case).toEqual([{ mediaId: 1, status: step.after, progress: step.progress }])
            expect(entries.get(1)?.startedAt, step.case).toEqual("startedToday" in step ? todayOf(clock) : NO_DAY)
            if ("completedToday" in step) expect(entries.get(1)?.completedAt, step.case).toEqual(todayOf(clock))
        }
    })

    it("sets a manga's chapters the same way and asks for a manga's fields", async () => {
        await lists("MANGA")
        expect(await ask("POST", "/api/v1/manga/update-progress", recorded.requests.mangaProgress)).toBe(recorded.answer)
        expect(sent("SaveEntry")[0].variables).toEqual({ mediaId: MANGA, status: "CURRENT", progress: 5 })
        expect(sent("SaveEntry")[0].document).toContain("chapters")
        await settled()
        expect(events).toEqual([recorded.events.manga])
        reach = "down"
        expect((await entryInLists(MANGA, "MANGA"))?.list.status).toBe("CURRENT")
    })

    it("never lowers the progress nor reopens a completed entry by itself (auto), while a mark of the user still may (4.3.1)", async () => {
        const progress = (kind: "anime" | "manga", mediaId: number, number: number, total: number, auto: boolean) => kind === "anime"
            ? ask("POST", "/api/v1/library/anime-entry/update-progress", { mediaId, episodeNumber: number, totalEpisodes: total, ...(auto ? { auto } : {}) })
            : ask("POST", "/api/v1/manga/update-progress", { mediaId, chapterNumber: number, totalChapters: total, ...(auto ? { auto } : {}) })
        // the manga reader opened from Downloads without the list's data: chapter 3 of a manga read to 120 and completed
        put(MANGA, { status: "COMPLETED", progress: 120, completedAt: { year: 2026, month: 1, day: 2 } })
        put(ANIME, { status: "CURRENT", progress: 7 })
        put(1, { status: "COMPLETED", progress: 5, completedAt: { year: 2026, month: 1, day: 2 } })
        await lists("MANGA")
        await lists()
        asked = []
        expect(await progress("manga", MANGA, 3, 0, true)).toBe(true)
        expect(await progress("manga", MANGA, 120, 0, true)).toBe(true)
        expect(await progress("anime", ANIME, 2, 24, true)).toBe(true)
        expect(sent("SaveEntry")).toEqual([])
        expect(entries.get(MANGA)).toMatchObject({ status: "COMPLETED", progress: 120 })
        expect(entries.get(ANIME)).toMatchObject({ status: "CURRENT", progress: 7 })
        // further than the entry: the progress goes up, a completed entry stays completed (the player's 80 %, a bonus chapter)
        expect(await progress("anime", 1, 6, 0, true)).toBe(true)
        expect(await progress("manga", MANGA, 121, 0, true)).toBe(true)
        expect(sent("SaveEntry").map(item => item.variables)).toEqual([{ mediaId: 1, status: "COMPLETED", progress: 6 }, { mediaId: MANGA, status: "COMPLETED", progress: 121 }])
        expect(entries.get(1)).toMatchObject({ status: "COMPLETED", progress: 6, completedAt: { year: 2026, month: 1, day: 2 } })
        // the user's own mark goes through as before: down, and "current"
        asked = []
        expect(await progress("manga", MANGA, 3, 0, false)).toBe(true)
        expect(sent("SaveEntry").map(item => item.variables)).toEqual([{ mediaId: MANGA, status: "CURRENT", progress: 3 }])
    })

    it("holds the same line for a change that waits for AniList (the core's lists show it at once)", async () => {
        put(MANGA, { status: "CURRENT", progress: 10 })
        await lists("MANGA")
        reach = "down"
        await ask("POST", "/api/v1/manga/update-progress", { mediaId: MANGA, chapterNumber: 11, totalChapters: 0, auto: true })
        expect((await entryInLists(MANGA, "MANGA"))?.entry).toMatchObject({ progress: 11 })
        await ask("POST", "/api/v1/manga/update-progress", { mediaId: MANGA, chapterNumber: 4, totalChapters: 0, auto: true })
        expect((await entryInLists(MANGA, "MANGA"))?.entry).toMatchObject({ progress: 11 })
        reach = "up"
        await sendWaitingChanges(environment)
        expect(entries.get(MANGA)).toMatchObject({ progress: 11 })
    })

    it("tells the app what the server told it, and has the server read its lists again", async () => {
        put(ANIME, { status: "PLANNING" })
        await lists()
        await edit(recorded.requests.edit)
        await settled()
        expect(events).toEqual([recorded.events.anime])

        // the number of rewatches: sent alone, followed by no event
        events = []
        asked = []
        expect(await ask("POST", "/api/v1/library/anime-entry/update-repeat", recorded.requests.repeat)).toBe(recorded.answer)
        expect(asked.map(item => item.variables)).toEqual([{ mediaId: ANIME, repeat: 2 }])
        await settled()
        expect(events).toEqual(recorded.events.repeat ? [recorded.events.repeat] : [])
    })

    it("removes the entry by AniList's own number of it", async () => {
        put(ANIME, { progress: 3 })
        const number = entries.get(ANIME)!.id
        await lists()
        expect(await remove(recorded.requests.delete)).toBe(recorded.answer)
        expect(sent("DeleteEntry")[0].variables).toEqual({ id: number })
        expect(entries.has(ANIME)).toBe(false)
        reach = "down"
        expect(await entryInLists(ANIME)).toBeNull()
        await settled()
        expect(events).toEqual([recorded.events.anime])
    })
})

describe("the queue of changes", () => {
    it("keeps a change while AniList cannot be reached, shows it at once and sends it later", async () => {
        put(ANIME, { status: "PLANNING", createdAt: 1700000000 })
        await lists()
        reach = "down"
        expect(await edit(recorded.requests.edit)).toBe(true)
        expect(await waitingChanges(environment)).toBe(1)
        await settled()
        expect(events).toEqual([{ type: "info-toast", payload: KEPT_FOR_LATER }])

        // the lists and the anime's page show the change although AniList has not seen it
        const shown = await entryInLists(ANIME)
        expect(shown?.list.status).toBe("CURRENT")
        expect(shown?.entry).toMatchObject({ status: "CURRENT", score: 80, progress: 3, startedAt: recorded.afterEdit.entry.startedAt, completedAt: {} })
        const page = await entryWithWaitingChange(await environment.database(), ANIME, { mediaId: ANIME, listData: { status: "PLANNING" } }) as { mediaId: number, listData: Json }
        expect(Object.keys(page.listData)).toEqual(Object.keys(recorded.afterEdit.listData))
        expect(page).toMatchObject({ mediaId: ANIME, listData: { ...recorded.afterEdit.listData, updatedAt: Math.floor(clock / 1000) } })
        expect(entries.get(ANIME)?.status).toBe("PLANNING")

        reach = "up"
        events = []
        asked = []
        await sendWaitingChanges(environment)
        expect(sent("SaveEntry").map(item => item.variables)).toEqual([{ mediaId: ANIME, status: "CURRENT", scoreRaw: 80, progress: 3, startedAt: { year: 2026, month: 11, day: 1 }, completedAt: NO_DAY }])
        expect(entries.get(ANIME)).toMatchObject({ status: "CURRENT", score: 80, progress: 3 })
        expect(await waitingChanges(environment)).toBe(0)
        await settled()
        expect(events).toEqual([recorded.events.anime])
        // nothing waits any more: the page is the server's again
        expect(await entryWithWaitingChange(await environment.database(), ANIME, { listData: { status: "x" } })).toEqual({ listData: { status: "x" } })
    })

    it("sends in the order the changes were made and lets nothing overtake one that cannot go out", async () => {
        await lists()
        reach = "down"
        for (const mediaId of [20, 1, 21]) await watched(mediaId, 2)
        expect((await rows()).map(row => row.mediaId)).toEqual([20, 1, 21])

        reach = 503
        asked = []
        await sendWaitingChanges(environment)
        expect(asked.length).toBe(1)
        expect((await rows()).map(row => [row.mediaId, row.attempts])).toEqual([[20, 4], [1, 0], [21, 0]])

        reach = "up"
        asked = []
        await sendWaitingChanges(environment)
        expect(sent("SaveEntry").map(item => item.variables.mediaId)).toEqual([20, 1, 21])
        expect(await waitingChanges(environment)).toBe(0)
        // titles the lists did not know: they are there once AniList answered
        reach = "down"
        expect((await entryInLists(21))?.entry).toMatchObject({ progress: 2, status: "CURRENT" })
    })

    it("merges the changes of one title into one, the later value winning", async () => {
        put(ANIME, { progress: 1 })
        await lists()
        reach = "down"
        await watched(ANIME, 2)
        await watched(ANIME, 3)
        await edit({ mediaId: ANIME, status: "PAUSED", score: 70, progress: 4, startedAt: { year: 2026, month: 11, day: 1 }, type: "anime" })
        await ask("POST", "/api/v1/library/anime-entry/update-repeat", { mediaId: ANIME, repeat: 1 })
        expect(await waitingChanges(environment)).toBe(1)
        expect((await entryInLists(ANIME))?.entry).toMatchObject({ status: "PAUSED", score: 70, progress: 4, repeat: 1 })

        reach = "up"
        asked = []
        await sendWaitingChanges(environment)
        expect(sent("SaveEntry").map(item => item.variables)).toEqual([
            { mediaId: ANIME, status: "PAUSED", scoreRaw: 70, progress: 4, repeat: 1, startedAt: { year: 2026, month: 11, day: 1 }, completedAt: NO_DAY },
        ])
    })

    it("does not shrink a progress AniList moved on from meanwhile", async () => {
        // watched further on another device while the change waited: AniList's progress stays
        put(ANIME, { progress: 2 })
        await lists()
        reach = "down"
        await watched(ANIME, 3)
        entries.get(ANIME)!.progress = 8
        reach = "up"
        asked = []
        await sendWaitingChanges(environment)
        expect(asked.map(item => item.operation)).toEqual(["ViewerEntry"])
        expect(entries.get(ANIME)?.progress).toBe(8)
        expect(await waitingChanges(environment)).toBe(0)
        reach = "down"
        expect((await entryInLists(ANIME))?.entry.progress).toBe(8)

        // an edit that waited keeps what the user chose, but not its smaller progress
        await edit({ mediaId: ANIME, status: "PAUSED", score: 90, progress: 9, type: "anime" })
        entries.get(ANIME)!.progress = 12
        reach = "up"
        asked = []
        await sendWaitingChanges(environment)
        expect(sent("SaveEntry").map(item => item.variables)).toEqual([{ mediaId: ANIME, status: "PAUSED", scoreRaw: 90, startedAt: NO_DAY, completedAt: NO_DAY }])
        expect(entries.get(ANIME)).toMatchObject({ progress: 12, status: "PAUSED", score: 90 })

        // AniList is where the change started from: going back was the user's wish, also later
        reach = "down"
        await watched(ANIME, 5)
        reach = "up"
        await sendWaitingChanges(environment)
        expect(entries.get(ANIME)?.progress).toBe(5)

        // sent at once it is the user's wish as it is, without asking first (recorded: 7, then episode 2 marked -> 2)
        entries.get(ANIME)!.progress = 7
        await lists()
        asked = []
        await watched(ANIME, 2)
        expect(asked.map(item => item.operation)).toEqual(["SaveEntry"])
        expect(entries.get(ANIME)?.progress).toBe(2)
    })

    it("sends a removal alone after changes, and a removal first when changes follow it", async () => {
        put(ANIME, { progress: 2, score: 60 })
        put(1, { progress: 4, score: 50 })
        await lists()
        reach = "down"
        await watched(ANIME, 3)
        await remove({ mediaId: ANIME, type: "anime" })
        await remove({ mediaId: 1, type: "anime" })
        await watched(1, 1)
        expect((await rows()).map(row => [row.mediaId, row.action])).toEqual([[ANIME, "delete"], [1, "save"]])
        expect(await entryInLists(ANIME)).toBeNull()
        expect((await entryInLists(1))?.entry).toMatchObject({ progress: 1, score: 0 })

        reach = "up"
        asked = []
        await sendWaitingChanges(environment)
        expect(asked.map(item => item.operation)).toEqual(["ViewerEntry", "DeleteEntry", "ViewerEntry", "DeleteEntry", "SaveEntry"])
        expect(entries.has(ANIME)).toBe(false)
        // nothing of the removed entry is left in the new one
        expect(entries.get(1)).toMatchObject({ progress: 1, score: 0, status: "CURRENT" })
    })

    it("drops a change AniList refuses and says so; keeps one AniList could not be asked for", async () => {
        put(ANIME, { progress: 2 })
        await lists()
        reach = "down"
        await watched(ANIME, 3)
        await settled()
        events = []
        reach = "up"
        refuse = ["The progress is not possible."]
        const outcomes = await sendWaitingChanges(environment)
        expect([...outcomes.values()]).toEqual([{ refused: "The progress is not possible." }])
        expect(await waitingChanges(environment)).toBe(0)
        await settled()
        expect(events.map(event => event.type)).toEqual(["error-toast", recorded.events.anime.type])
        expect(String(events[0].payload)).toContain("The progress is not possible.")
        // the lists show AniList's entry again
        reach = "down"
        expect((await entryInLists(ANIME))?.entry.progress).toBe(2)

        // not reachable, a server error, the rate limit: the change stays, whether it is new or waited
        for (const trouble of ["down", 500, 503, 429] as const) {
            reach = trouble
            expect(await watched(ANIME, 4)).toBe(true)
            await sendWaitingChanges(environment)
            expect(await waitingChanges(environment), String(trouble)).toBe(1)
            clock += 120_000
        }
        expect(entries.get(ANIME)?.progress).toBe(2)
        reach = "up"
        await sendWaitingChanges(environment)
        expect(entries.get(ANIME)?.progress).toBe(4)
    })

    it("still has the queue after the app was closed, and sends it before the lists are read", async () => {
        put(ANIME, { progress: 2 })
        await lists()
        reach = "down"
        await watched(ANIME, 3)

        // a new start: nothing in memory, the same database file
        database = null
        forgetChanges()
        expect(await waitingChanges(environment)).toBe(1)
        reach = "up"
        asked = []
        expect((await entryInLists(ANIME))?.entry.progress).toBe(3)
        expect(asked.map(item => item.operation)).toEqual(["ViewerEntry", "SaveEntry", "ListCollection"])
        expect(await waitingChanges(environment)).toBe(0)
    })

    it("does not lose a waiting change when the lists are read and the change still cannot go out", async () => {
        put(ANIME, { progress: 2 })
        await lists()
        reach = "down"
        await watched(ANIME, 3)
        // the lists can be read, the change is refused for now: only changes get a 503 here
        const real = environment.fetch
        environment.fetch = async (url, init) => {
            reach = (init.body ?? "").includes("ListCollection") ? "up" : 503
            return real(url, init)
        }
        try {
            expect((await entryInLists(ANIME))?.entry.progress).toBe(3)
            expect(entries.get(ANIME)?.progress).toBe(2)
            expect(await waitingChanges(environment)).toBe(1)
        }
        finally {
            environment.fetch = real
        }
    })

    it("never sends a change made with another account", async () => {
        put(ANIME, { progress: 2 })
        await lists()
        reach = "down"
        await watched(ANIME, 3)
        await signIn("someone else")
        reach = "up"
        asked = []
        await sendWaitingChanges(environment)
        expect(asked).toEqual([])
        expect(await waitingChanges(environment)).toBe(0)
        expect(entries.get(ANIME)?.progress).toBe(2)
    })
})

describe("the guard", () => {
    it("changes only the account the host named, and nothing when it cannot check", async () => {
        put(ANIME, { progress: 2 })
        await lists()
        asked = []
        onlyAccount = 1
        await expect(watched(ANIME, 3)).rejects.toMatchObject({ message: CHANGES_LOCKED, status: 403 })
        // 0 is how the throw-away app says "no account named yet"
        onlyAccount = 0
        await expect(remove({ mediaId: ANIME, type: "anime" })).rejects.toMatchObject({ message: CHANGES_LOCKED, status: 403 })
        expect(asked.map(item => item.operation)).toEqual(["ViewerId"])
        expect(await waitingChanges(environment)).toBe(0)

        onlyAccount = TEST_ACCOUNT
        expect(await watched(ANIME, 3)).toBe(true)
        expect(entries.get(ANIME)?.progress).toBe(3)

        // another sign-in: asked again, and refused before anything is queued, also for what would wait
        token = "another-token"
        viewer = 5
        await expect(watched(ANIME, 4)).rejects.toMatchObject({ message: CHANGES_LOCKED, status: 403 })
        forgetChanges()
        reach = "down"
        await expect(watched(ANIME, 4)).rejects.toMatchObject({ message: CHANGES_UNCHECKED, status: 403 })
        expect(await waitingChanges(environment)).toBe(0)
        expect(entries.get(ANIME)?.progress).toBe(3)
    })

    it("lets only changeAnilist send a mutation, and only with a token", async () => {
        const client = { fetch: anilist, token: async () => token, now: () => clock }
        await expect(askAnilist(client, saveEntryMutation("ANIME"), { mediaId: ANIME })).rejects.toThrow(/only reads/)
        await expect(changeAnilist(client, VIEWER_ID, {})).rejects.toThrow(/mutations only/)
        token = null
        await expect(changeAnilist(client, saveEntryMutation("ANIME"), { mediaId: ANIME })).rejects.toBeInstanceOf(AnilistFailure)
        expect(asked).toEqual([])
    })

})

/*
 * Leftover of stage 2 (docs/EIGENER-KERN.md §4g "Datum löschen ungeprüft"): a start and end date taken away again by
 * the core's way of writing. AniList's public documentation (FuzzyDateInput: year, month and day may each be null) is
 * the source for the form; here it is checked that the core sends exactly that and keeps the entry without the dates.
 */
describe("taking a start and end date away", () => {
    it("sends both as { year: null, month: null, day: null } and keeps them empty", async () => {
        await lists()
        const dated = { mediaId: ANIME, status: "COMPLETED", score: 80, progress: 3, startedAt: { year: 2026, month: 11, day: 1 }, completedAt: { year: 2026, month: 11, day: 3 }, type: "anime" }
        await edit(dated)
        expect((await entryInLists(ANIME))?.entry).toMatchObject({ startedAt: { year: 2026, month: 11, day: 1 }, completedAt: { year: 2026, month: 11, day: 3 } })
        asked = []
        // the app's date fields emptied: null, or a date without a year
        await edit({ ...dated, startedAt: null, completedAt: { year: null, month: null, day: null } })
        expect(sent("SaveEntry").at(-1)!.variables).toMatchObject({ startedAt: NO_DAY, completedAt: NO_DAY })
        reach = "down"
        const entry = (await entryInLists(ANIME))?.entry as Record<string, unknown>
        expect([entry.startedAt, entry.completedAt].map(day => JSON.stringify(day))).not.toContain(JSON.stringify({ year: 2026, month: 11, day: 1 }))
        expect(JSON.stringify(entry.completedAt)).not.toContain("2026")
    })

    it("takes them away when the sheet sends its emptied date fields", async () => {
        await lists()
        const form = { status: "COMPLETED" as const, score: 8, progress: 3, startedAt: new Date(2026, 10, 1), completedAt: new Date(2026, 10, 3) }
        // the request body as the app sends it (JSON, so an undefined key would not arrive at all)
        const send = (body: unknown) => edit(JSON.parse(JSON.stringify(body)))
        await send(listEntryPayload(form, ANIME, "anime"))
        expect(sent("SaveEntry").at(-1)!.variables).toMatchObject({ startedAt: { year: 2026, month: 11, day: 1 }, completedAt: { year: 2026, month: 11, day: 3 } })
        await send(listEntryPayload({ ...form, startedAt: null, completedAt: null }, ANIME, "anime"))
        expect(sent("SaveEntry").at(-1)!.variables).toMatchObject({ startedAt: NO_DAY, completedAt: NO_DAY })
        expect((await entryInLists(ANIME))?.entry).toMatchObject({ startedAt: {}, completedAt: {} })
    })
})

/*
 * The app without AniList (15.11.2026): AniList down in every way the client knows (500, 503, no network, 429), what the
 * app's sync hint reads, a change made while its row is out, a title the lists never held, and the local account.
 */
describe("the app without AniList", () => {
    const failures: (typeof reach)[] = [500, 503, "down", 429]

    it("reads the lists from what was kept while AniList answers 500, 503, nothing or 429", async () => {
        put(ANIME, { progress: 2 })
        const fresh = await lists()
        for (const failure of failures) {
            reach = failure
            expect(await lists(), String(failure)).toEqual(fresh)
            // far apart, so that the 429's wait never reaches into the next round
            clock += 120_000
        }
    })

    it("shows a change at once, keeps it, and sends it once and in order when AniList is back", async () => {
        put(ANIME, { progress: 2 })
        put(1, { progress: 5 })
        await lists()
        const heard: number[] = []
        const stop = watchAnilistState(sent => heard.push(sent))
        try {
            for (const failure of failures) {
                reach = failure
                clock += 120_000
                await watched(ANIME, 3)
                await watched(1, 6)
                expect((await entryInLists(ANIME))?.entry.progress, String(failure)).toBe(3)
                expect(await rows(), String(failure)).toHaveLength(2)
                expect(await anilistSyncState(environment), String(failure)).toMatchObject({ waiting: 2, localAccount: false })
                expect(entries.get(ANIME)!.progress).toBe(2)
                // back: two runs at the same moment (app in front and network back) send each change once
                reach = "up"
                clock += 120_000
                asked = []
                await Promise.all([sendWaitingChanges(environment), sendWaitingChanges(environment)])
                expect(sent("SaveEntry").map(item => item.variables.mediaId), String(failure)).toEqual([ANIME, 1])
                expect([entries.get(ANIME)!.progress, entries.get(1)!.progress]).toEqual([3, 6])
                expect(await anilistSyncState(environment)).toEqual({ waiting: 0, reachable: true, localAccount: false, signInExpired: false })
                put(ANIME, { ...entries.get(ANIME)!, progress: 2 })
                put(1, { ...entries.get(1)!, progress: 5 })
                await lists()
            }
            await settled()
            // the hint hears the runs: with how many went out
            expect(heard).toContain(2)
        }
        finally {
            stop()
        }
    })

    it("keeps a change made while its title's row is being sent and sends it next", async () => {
        put(ANIME, { progress: 2 })
        await lists()
        reach = 500
        await watched(ANIME, 3)
        reach = "up"
        let open = () => undefined as void
        const gate = new Promise<void>(resolve => { open = resolve })
        const slow: CoreEnvironment = {
            ...environment,
            fetch: async (url, init) => {
                if (init.body?.includes("SaveEntry")) await gate
                return anilist(url, init)
            },
        }
        const first = sendWaitingChanges(slow)
        await settled()
        const match = matchCoreRoute("POST", "/api/v1/library/anime-entry/update-progress")!
        const second = match.route.answer({ path: match.path, query: null, body: { mediaId: ANIME, episodeNumber: 4, totalEpisodes: 24 } }, slow)
        await settled()
        open()
        await Promise.all([first, second])
        expect(entries.get(ANIME)!.progress).toBe(4)
        expect(await rows()).toHaveLength(0)
    })

    it("shows a new entry of a title the lists never held while the change waits", async () => {
        await lists()
        await keepAnswer(await environment.database(), "library-media:20", titleOf(20), clock)
        reach = "down"
        await watched(20, 1)
        expect((await entryInLists(20))?.entry).toMatchObject({ progress: 1, status: "CURRENT" })
        reach = "up"
        await sendWaitingChanges(environment)
        expect(entries.get(20)).toMatchObject({ progress: 1, status: "CURRENT" })
    })

    it("lets the local account (no AniList account) keep lists, progress, status and removals on the device alone", async () => {
        token = null
        await (await environment.database()).delete(account)
        await keepAnswer(await environment.database(), `library-media:${ANIME}`, titleOf(ANIME), clock)
        expect((await lists()).MediaListCollection.lists).toEqual([])
        expect(await watched(ANIME, 5)).toBe(true)
        expect((await entryInLists(ANIME))?.entry).toMatchObject({ progress: 5, status: "CURRENT" })
        await edit({ mediaId: ANIME, status: "COMPLETED", score: 80, progress: 24, type: "anime" })
        expect((await entryInLists(ANIME))).toMatchObject({ list: { status: "COMPLETED" }, entry: { progress: 24, score: 80 } })
        await settled()
        expect(events.map(event => event.type)).toContain("refreshed-anilist-anime-collection")
        await remove({ mediaId: ANIME, type: "anime" })
        expect(await entryInLists(ANIME)).toBeNull()
        expect(await rows()).toHaveLength(0)
        expect(asked).toEqual([])
        expect(await anilistSyncState(environment)).toMatchObject({ waiting: 0, localAccount: true })
    })

    it("fills today's date like AniList when the local account completes or starts a title, never over a date of the user", async () => {
        token = null
        await (await environment.database()).delete(account)
        await keepAnswer(await environment.database(), `library-media:${ANIME}`, titleOf(ANIME), clock)
        const date = new Date(clock)
        const today = { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() }
        const user = { year: 2020, month: 5, day: 6 }
        // the sheet sends its empty date fields as {}
        await edit({ mediaId: ANIME, status: "COMPLETED", score: 0, progress: 24, type: "anime", startedAt: {}, completedAt: {} })
        expect((await entryInLists(ANIME))?.entry).toMatchObject({ completedAt: today })
        await edit({ mediaId: ANIME, status: "CURRENT", score: 0, progress: 1, type: "anime", startedAt: {}, completedAt: {} })
        expect((await entryInLists(ANIME))?.entry).toMatchObject({ startedAt: today })
        await edit({ mediaId: ANIME, status: "COMPLETED", score: 0, progress: 24, type: "anime", startedAt: user, completedAt: user })
        expect((await entryInLists(ANIME))?.entry).toMatchObject({ startedAt: user, completedAt: user })
        // a status that stays: an emptied date stays empty
        await edit({ mediaId: ANIME, status: "COMPLETED", score: 0, progress: 24, type: "anime", startedAt: user, completedAt: {} })
        expect(((await entryInLists(ANIME))?.entry as { completedAt?: { year?: number } }).completedAt?.year ?? null).toBeNull()
        expect(localEntryDates({ status: "PLANNING" }, { status: "COMPLETED", completedAt: null }, Date.UTC(2026, 10, 25, 12)).completedAt).toEqual({ year: 2026, month: 11, day: 25 })
        expect(localEntryDates({ status: "PLANNING", completedAt: user }, { status: "COMPLETED", completedAt: null }, clock).completedAt).toBeNull()
        expect(asked).toEqual([])
    })

    it("uploads the local account's lists to the AniList account signed in afterwards (Upload local lists)", async () => {
        token = null
        await (await environment.database()).delete(account)
        await keepAnswer(await environment.database(), `library-media:${ANIME}`, titleOf(ANIME), clock)
        await edit({ mediaId: ANIME, status: "COMPLETED", score: 80, progress: 24, type: "anime" })
        expect(asked).toEqual([])

        const signing = { ...environment, keepSecret: async (_name: string, value: string | null) => void (token = value) }
        const login = matchCoreRoute("POST", "/api/v1/auth/login")!
        await login.route.answer({ path: login.path, query: null, body: { token: "test-token" } }, signing)
        // the first read of AniList's lists replaces the local ones
        expect(await entryInLists(ANIME)).toBeNull()

        expect(await ask("POST", "/api/v1/local/sync-simulated-to-anilist")).toBe(true)
        expect(entries.get(ANIME)).toMatchObject({ status: "COMPLETED", progress: 24, score: 80 })
        expect(await rows()).toHaveLength(0)
        expect((await entryInLists(ANIME))?.entry).toMatchObject({ status: "COMPLETED", progress: 24 })
        // put aside once: a second upload has nothing left
        await expect(ask("POST", "/api/v1/local/sync-simulated-to-anilist")).rejects.toThrow("no local lists")
    })
})

describe("an expired AniList sign-in", () => {
    it("keeps the changes AniList turned away with its token, says so, and sends them after signing in again", async () => {
        await signIn("tester")
        put(ANIME, { progress: 2 })
        await lists()
        tokenRefused = true
        expect(await watched(ANIME, 3)).toBe(true)
        expect(await edit({ mediaId: ANIME, status: "CURRENT", score: 70, progress: 3, type: "anime" })).toBe(true)
        await settled()
        // nothing dropped, nothing told as "cannot be reached", AniList's entry untouched
        expect(await waitingChanges(environment)).toBe(1)
        expect(events.filter(event => event.type === "error-toast" || event.type === "info-toast")).toEqual([])
        expect(entries.get(ANIME)?.progress).toBe(2)
        expect((await entryInLists(ANIME))?.entry).toMatchObject({ progress: 3, score: 70 })
        expect(await anilistSyncState(environment)).toMatchObject({ waiting: 1, signInExpired: true })
        expect((await rows())[0].lastError).toBe("AniList did not accept the sign-in")

        // the queue run after it keeps the change too, and the timer does not retry a token AniList refused
        const outcomes = await sendWaitingChanges(environment)
        expect([...outcomes.values()]).toEqual(["signin"])
        expect(await waitingChanges(environment)).toBe(1)

        // a new sign-in of the same account: the change goes out by itself
        tokenRefused = false
        const login = matchCoreRoute("POST", "/api/v1/auth/login")!
        await login.route.answer({ path: login.path, query: null, body: { token: "new-token" } }, environment)
        expect(token).toBe("new-token")
        await sendWaitingChanges(environment)
        expect(await waitingChanges(environment)).toBe(0)
        expect(entries.get(ANIME)).toMatchObject({ progress: 3, score: 70 })
        expect(await anilistSyncState(environment)).toMatchObject({ waiting: 0, signInExpired: false })
    })

    it("treats AniList's 401 and its \"Unauthorized.\" the same way, but still drops a change AniList refused for itself", async () => {
        put(ANIME, { progress: 2 })
        await lists()
        reach = 401
        expect(await watched(ANIME, 3)).toBe(true)
        expect(await waitingChanges(environment)).toBe(1)
        expect(await anilistSyncState(environment)).toMatchObject({ signInExpired: true })

        reach = "up"
        await sendWaitingChanges(environment)
        expect(entries.get(ANIME)?.progress).toBe(3)
        expect(await anilistSyncState(environment)).toMatchObject({ signInExpired: false })

        // a refusal of the change itself (validation) is no sign-in trouble
        refuse = ["The progress is not possible."]
        await expect(watched(ANIME, 4)).rejects.toThrow("The progress is not possible.")
        expect(await waitingChanges(environment)).toBe(0)
        expect(await anilistSyncState(environment)).toMatchObject({ signInExpired: false })
    })

    it("tells a turned-away token apart from other refusals", () => {
        expect(rejectsSignIn(400, "Invalid token")).toBe(true)
        expect(rejectsSignIn(400, "Unauthorized.")).toBe(true)
        expect(rejectsSignIn(401, "anything")).toBe(true)
        expect(rejectsSignIn(400, "The score raw must be an integer.")).toBe(false)
        expect(rejectsSignIn(404, "Not Found.")).toBe(false)
    })
})
