// geschrieben nach: Aufzeichnungen MANGA.* vom 13.11.2026 (nur die Form, manga.recorded.json), dem Vertrag manga-provider.d.ts und docs/EIGENER-KERN.md §4n; kein Server-Quelltext

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { sqlDriverFor } from "@/api/client/core-database"
import { forgetDatabases, openDatabaseSync } from "../../../test/expo-sqlite"
import type { HttpFetch } from "../anilist/client"
import { keepCollection } from "../anilist/store"
import { type CoreDatabase, openCoreDatabase } from "../database/database"
import { mangaMappings } from "../database/schema"
import type { ExtensionPlace } from "../extensions/manage/installed"
import { closeExtensionSandboxes } from "../extensions/manage/manage"
import { nodeSandboxEngine } from "../extensions/sandbox/node-engine"
import { type CoreEnvironment, matchCoreRoute } from "../registry"
import { chapterNumberOf } from "./library"
import { CHAPTERS_KEEP_MS, chaptersOf, forgetMangaCache, searchRating } from "./manga"
import { removeMapping, setMapping } from "./mappings"
import { forgetSourceRefresh } from "./source-refresh"
import recorded from "./manga.recorded.json"

/* A provider after the contract, with made-up values: it logs each call, so that the tests see what the core asked. */
const PROVIDER_TS = `/// <reference path="./manga-provider.d.ts" />
class Provider {
    getSettings(): Settings {
        return { supportsMultiLanguage: false, supportsMultiScanlator: false }
    }
    async search(opts: QueryOptions): Promise<SearchResult[]> {
        console.log("search " + opts.query + " " + (opts.year ?? "-"))
        if (opts.query === "nothing") return []
        return [
            { id: "m-0", title: "Sky Garden", synonyms: ["Garden of the Sky", "Sora no Niwa"], year: 2019, image: "https://img.example/0.jpg" },
            { id: "m-1", title: "Sky Garden 2", year: 2022 },
            { id: "m-2", title: "Swan" },
        ]
    }
    async findChapters(id: string): Promise<ChapterDetails[]> {
        console.log("findChapters " + id)
        if (id === "broken") throw new Error("the site changed")
        const list: ChapterDetails[] = []
        for (let index = 4; index >= 0; index--) list.push({ id: id + "/c" + index, url: "https://manga.example/" + index, title: "Chapter " + (index + 1), chapter: String(index + 1), index, updatedAt: "2026-01-02T03:04:05+00:00" })
        return list
    }
    async findChapterPages(id: string): Promise<ChapterPage[]> {
        console.log("findChapterPages " + id)
        if (id.endsWith("c4")) return []
        return [2, 0, 1].map(index => ({ url: "https://cdn.example/" + id + "/" + index + ".jpg", index, headers: { Referer: "https://manga.example/" } }))
    }
}`

type Shape = string | Shape[] | { [key: string]: Shape }

function kindOf(value: unknown): string {
    if (value === null) return "null"
    if (Array.isArray(value)) return "array"
    return typeof value
}

/** Where `value` does not have the recorded form: every recorded field with its kind, no field more */
function differences(shape: Shape, value: unknown, at = "data"): string[] {
    if (typeof shape === "string") return kindOf(value) === shape ? [] : [`${at}: ${kindOf(value)} instead of ${shape}`]
    if (Array.isArray(shape)) {
        if (!Array.isArray(value)) return [`${at}: ${kindOf(value)} instead of array`]
        if (shape.length === 0 || value.length === 0) return shape.length === value.length ? [] : [`${at}: empty`]
        return differences(shape[0], value[0], `${at}[0]`)
    }
    if (kindOf(value) !== "object") return [`${at}: ${kindOf(value)} instead of object`]
    const object = value as Record<string, unknown>
    const found = Object.keys(shape).flatMap(key => (key in object ? differences(shape[key], object[key], `${at}.${key}`) : [`${at}.${key}: missing`]))
    return [...found, ...Object.keys(object).filter(key => !(key in shape)).map(key => `${at}.${key}: not recorded`)]
}

/** A made-up value of a recorded form */
function madeUp(shape: Shape): unknown {
    if (shape === "string") return "x"
    if (shape === "number") return 1
    if (shape === "boolean") return false
    if (shape === "null") return null
    if (shape === "object") return {}
    if (Array.isArray(shape)) return shape.length === 0 ? [] : [madeUp(shape[0])]
    if (typeof shape === "string") return null
    return Object.fromEntries(Object.entries(shape).map(([key, part]) => [key, madeUp(part)]))
}

const answers = recorded.answers as Record<string, { method: string, endpoint: string, status: number, requestFields?: string[], data?: Shape, error?: string }>
const ENTRY_FORM = answers.GetMangaEntry.data as { [key: string]: Shape }
const DETAILS_FORM = answers.GetMangaEntryDetails.data as Shape

function madeUpMedia(): Record<string, unknown> {
    return { ...(madeUp(ENTRY_FORM.media) as Record<string, unknown>), id: 30, title: { native: "x", romaji: "Sky Garden", userPreferred: "Sky Garden" }, synonyms: ["SG"], startDate: { day: 1, month: 2, year: 2019 } }
}

/** The user's entry as AniList gives it (anilist/queries.ts entryFields), made up */
function madeUpListEntry(status: string, progress: number): Record<string, unknown> {
    return { id: 7, score: 0, progress, status, repeat: 0, private: false, startedAt: progress > 0 ? { year: 2024, month: 3, day: 9 } : { year: null, month: null, day: null }, completedAt: { year: null, month: null, day: null }, updatedAt: 1_700_000_100, createdAt: 1_700_000_000 }
}

let files: Map<string, string>
let place: ExtensionPlace
let database: Promise<CoreDatabase> | null
let environment: CoreEnvironment
let now: number
let calls: string[]
let serverMappingReads: number
let anilist: { media: unknown, details: unknown } | null
let anilistAsked: string[]

const httpFetch: HttpFetch = async (url, init) => {
    if (!url.startsWith("https://graphql.anilist.co") || !anilist) throw new TypeError("Network request failed")
    const question = String(init.body ?? "")
    anilistAsked.push(question.includes("MangaDetails") ? "details" : "manga")
    const data = question.includes("MangaDetails") ? { Media: anilist.details } : { Media: anilist.media }
    return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ data }) }
}

beforeEach(async () => {
    if (place) await closeExtensionSandboxes(place)
    forgetDatabases()
    forgetMangaCache()
    now = 1_000_000
    calls = []
    serverMappingReads = 0
    anilistAsked = []
    anilist = { media: { ...madeUpMedia(), mediaListEntry: null }, details: madeUp(DETAILS_FORM) }
    files = new Map([["manga.json", JSON.stringify({
        id: "manga", name: "Test manga", version: "1.0.0", manifestURI: "https://ext.example/manga/manifest.json", language: "typescript",
        type: "manga-provider", description: "", author: "tester", icon: "", website: "", readme: "", lang: "en", payload: PROVIDER_TS,
    })]])
    place = {
        folder: {
            names: async () => [...files.keys()],
            read: async name => files.get(name) ?? null,
            write: async (name, text) => void files.set(name, text),
            remove: async name => void files.delete(name),
            stamp: async name => (files.has(name) ? `${files.get(name)!.length}.1` : null),
        },
        serverCache: async () => null,
        serverCacheStamp: async () => null,
        writeServerCache: async () => undefined,
        customSourceNumbers: async () => ({}),
        serverMangaMappings: async () => {
            serverMappingReads++
            return [{ provider: "manga", mediaId: 31, mangaId: "from-server" }, { provider: "", mediaId: 32, mangaId: "no-provider" }]
        },
        engine: async () => nodeSandboxEngine,
        fetch: async url => {
            throw new TypeError(`no network in tests: ${url}`)
        },
        log: (_id, _level, text) => void calls.push(text),
    }
    database = null
    environment = {
        fetch: httpFetch,
        secret: async () => null,
        database: () => database ??= openCoreDatabase(sqlDriverFor(openDatabaseSync("core.db") as never), () => now),
        now: () => now,
        pause: async () => undefined,
        extensions: async () => place,
    }
})


async function ask(method: string, endpoint: string, body: unknown): Promise<unknown> {
    const match = matchCoreRoute(method, endpoint)
    expect(match?.route.area, `${method} ${endpoint}`).toBe("manga")
    return match!.route.answer({ path: match!.path, query: null, body }, environment)
}

const CHAPTERS = { mediaId: 30, provider: "manga" }

describe("manga answers against the recorded form", () => {
    it("registers the six reading interfaces with the recorded method and address, area manga; the rest stays with the server", () => {
        for (const name of ["GetMangaEntry", "GetMangaEntryDetails", "GetMangaEntryChapters.mangadex", "GetMangaEntryPages", "GetMangaMapping.mangadex", "MangaManualSearch.mangadex"]) {
            const { method, endpoint } = answers[name]
            expect(matchCoreRoute(method, endpoint.replace("{id}", "30"))?.route.area, name).toBe("manga")
        }
        // the downloads are the core's since phase 4b-C2 (downloads.test.ts), the source refresh since 7f
        for (const method of ["GET", "POST", "DELETE"]) expect(matchCoreRoute(method, "/api/v1/manga/source-refresh")?.route.area).toBe("manga")
        for (const [method, endpoint] of [["POST", "/api/v1/manga/local-page"]]) {
            expect(matchCoreRoute(method, endpoint), endpoint).toBeNull()
        }
    })

    it("chapters: the provider's chapters in its own order, in the recorded form; searched with the romaji title and year", async () => {
        const answer = await ask("POST", "/api/v1/manga/chapters", CHAPTERS) as { chapters: Record<string, unknown>[] }
        expect(differences(answers["GetMangaEntryChapters.mangadex"].data!, answer)).toEqual([])
        expect(answer.chapters.map(chapter => chapter.index)).toEqual([4, 3, 2, 1, 0])
        expect(answer.chapters[4]).toEqual({ provider: "manga", id: "m-0/c0", url: "https://manga.example/0", title: "Chapter 1", chapter: "1", index: 0, updatedAt: "2026-01-02T03:04:05+00:00" })
        expect(calls).toEqual(["search Sky Garden 2019", "findChapters m-0"])
        expect(Object.keys(answer)).toEqual(["mediaId", "provider", "chapters"])
    })

    it("chapters: kept for an hour, asked anew after; an error is not kept; nothing fitting is an error", async () => {
        await ask("POST", "/api/v1/manga/chapters", CHAPTERS)
        await ask("POST", "/api/v1/manga/chapters", CHAPTERS)
        expect(calls.filter(call => call.startsWith("findChapters"))).toHaveLength(1)
        now += CHAPTERS_KEEP_MS + 1
        await ask("POST", "/api/v1/manga/chapters", CHAPTERS)
        expect(calls.filter(call => call.startsWith("findChapters"))).toHaveLength(2)
        await (await environment.database()).insert(mangaMappings).values({ provider: "manga", mediaId: 40, mangaId: "broken", origin: "core", changedAt: 1 })
        await expect(ask("POST", "/api/v1/manga/chapters", { mediaId: 40, provider: "manga" })).rejects.toThrow("manga: findChapters failed: the site changed")
        await expect(ask("POST", "/api/v1/manga/chapters", { mediaId: 40, provider: "manga" })).rejects.toThrow("the site changed")
        expect(calls.filter(call => call === "findChapters broken")).toHaveLength(2)
        anilist = { media: { ...madeUpMedia(), id: 41, title: { romaji: "nothing" }, mediaListEntry: null }, details: null }
        await expect(ask("POST", "/api/v1/manga/chapters", { mediaId: 41, provider: "manga" })).rejects.toThrow("no matching entry found")
        await expect(ask("POST", "/api/v1/manga/chapters", { mediaId: 30, provider: "unknown" })).rejects.toThrow("manga provider not found: unknown")
        await expect(ask("POST", "/api/v1/manga/chapters", { provider: "manga" })).rejects.toThrow("mediaId is required")
    })

    it("pages: the provider's pages by their index with its headers, in the recorded form", async () => {
        const body = { mediaId: 30, provider: "manga", chapterId: "m-0/c0", doublePage: false }
        const answer = await ask("POST", "/api/v1/manga/pages", body) as { pages: Record<string, unknown>[] }
        expect(differences(answers.GetMangaEntryPages.data!, answer)).toEqual([])
        expect(answer.pages.map(page => page.index)).toEqual([0, 1, 2])
        expect(answer.pages[0]).toEqual({ provider: "manga", url: "https://cdn.example/m-0/c0/0.jpg", index: 0, headers: { Referer: "https://manga.example/" } })
        expect(answer).toMatchObject({ mediaId: 30, provider: "manga", chapterId: "m-0/c0", pageDimensions: null, isDownloaded: false })
        // 4.3.0: the double-page view gets the same pages, the reader pairs them (it was a 503 "needs the server")
        expect(await ask("POST", "/api/v1/manga/pages", { ...body, doublePage: true })).toEqual(answer)
        // the server was asked which chapters it has downloaded, nothing else
        await expect(ask("POST", "/api/v1/manga/pages", { ...body, chapterId: "m-0/c4" })).rejects.toThrow("no pages found")
        // an empty answer is not kept: trying again asks the provider again instead of failing from the cache for 10 minutes
        await expect(ask("POST", "/api/v1/manga/pages", { ...body, chapterId: "m-0/c4" })).rejects.toThrow("no pages found")
        expect(calls.filter(call => call === "findChapterPages m-0/c4")).toHaveLength(2)
    })

    it("mapping: null without one, in the recorded form; the server's mappings are taken over once, invalid rows left out", async () => {
        const none = await ask("POST", "/api/v1/manga/get-mapping", { provider: "manga", mediaId: 30 })
        expect(differences(answers["GetMangaMapping.mangadex"].data!, none)).toEqual([])
        expect(none).toEqual({ mangaId: null })
        expect(await ask("POST", "/api/v1/manga/get-mapping", { provider: "manga", mediaId: 31 })).toEqual({ mangaId: "from-server" })
        expect(serverMappingReads).toBe(1)
        expect(await (await environment.database()).select().from(mangaMappings)).toEqual([{ provider: "manga", mediaId: 31, mangaId: "from-server", origin: "server", changedAt: 1_000_000 }])
        // a mapping is used for the chapters instead of a search
        const manage = { place, database: environment.database, fetch: httpFetch, now: () => now, tellServer: async () => undefined }
        await setMapping(manage, "manga", 30, "chosen")
        await ask("POST", "/api/v1/manga/chapters", CHAPTERS)
        expect(calls).toEqual(["findChapters chosen"])
        await removeMapping(manage, "manga", 30)
        expect(await ask("POST", "/api/v1/manga/get-mapping", { provider: "manga", mediaId: 30 })).toEqual({ mangaId: null })
        expect(serverMappingReads).toBe(1)
    })

    it("manual search: the results with their rating, in the recorded form, empty fields left out", async () => {
        const found = await ask("POST", "/api/v1/manga/search", { provider: "manga", query: "sky garden" }) as Record<string, unknown>[]
        expect(differences(answers["MangaManualSearch.mangadex"].data!, found)).toEqual([])
        expect(found.map(result => Object.keys(result))).toEqual([
            ["provider", "id", "title", "synonyms", "year", "image", "searchRating"],
            ["provider", "id", "title", "year", "searchRating"],
            ["provider", "id", "title", "searchRating"],
        ])
        expect(found[0].searchRating).toBe(1)
        expect(calls).toEqual(["search sky garden -"])
    })

    it("search rating: the best share of letter pairs over the title and its synonyms", () => {
        expect(searchRating("Sky Garden", ["sky garden"])).toBe(1)
        expect(searchRating("abc", ["xyz"])).toBe(0)
        expect(searchRating("night", ["nacht", "nightly"])).toBeCloseTo((2 * 4) / (4 + 6))
        expect(searchRating("", ["x"])).toBe(0)
    })

    it("manga page: from AniList with the user's entry, listData in the recorded form; without an entry no listData", async () => {
        anilist = { media: { ...madeUpMedia(), mediaListEntry: madeUpListEntry("PLANNING", 0) }, details: null }
        const entry = await ask("GET", "/api/v1/manga/entry/30", null) as Record<string, unknown>
        expect(differences(ENTRY_FORM, entry)).toEqual([])
        expect(entry.listData).toEqual({ status: "PLANNING", createdAt: 1_700_000_000, updatedAt: 1_700_000_100 })
        anilist = { media: { ...madeUpMedia(), mediaListEntry: madeUpListEntry("CURRENT", 12) }, details: null }
        const reading = await ask("GET", "/api/v1/manga/entry/30", null) as Record<string, unknown>
        expect(reading.listData).toEqual({ progress: 12, status: "CURRENT", startedAt: "2024-03-09T00:00:00Z", createdAt: 1_700_000_000, updatedAt: 1_700_000_100 })
        const collectionForm = answers.GetMangaCollection.data as { lists: { entries: { listData: Shape }[] }[] }
        expect(differences(collectionForm.lists[0].entries[0].listData, reading.listData, "listData")).toEqual([])
        anilist = { media: { ...madeUpMedia(), mediaListEntry: null }, details: null }
        expect(Object.keys(await ask("GET", "/api/v1/manga/entry/30", null) as object)).toEqual(["mediaId", "media"])
    })

    it("details: AniList's answer in the recorded form, kept for when AniList cannot be reached", async () => {
        const details = await ask("GET", "/api/v1/manga/entry/30/details", null)
        expect(differences(DETAILS_FORM, details)).toEqual([])
        anilist = null
        expect(await ask("GET", "/api/v1/manga/entry/30/details", null)).toEqual(details)
        await expect(ask("GET", "/api/v1/manga/entry/31/details", null)).rejects.toThrow()
    })
})

describe("manga phase 4a-2: mappings, cache, preferences, library", () => {
    it("registers the writing interfaces and the library with the recorded method and address, area manga", () => {
        for (const [method, endpoint] of [["POST", "/api/v1/manga/manual-mapping"], ["POST", "/api/v1/manga/remove-mapping"], ["DELETE", "/api/v1/manga/entry/cache"],
            ["GET", "/api/v1/manga/preferences"], ["PATCH", "/api/v1/manga/preferences/30"], ["POST", "/api/v1/manga/preferences/import"],
            ["GET", "/api/v1/manga/collection"], ["GET", "/api/v1/manga/latest-chapter-numbers"]]) {
            expect(matchCoreRoute(method, endpoint)?.route.area, endpoint).toBe("manga")
        }
        expect(answers.GetMangaCollection.endpoint).toBe("/api/v1/manga/collection")
    })

    it("manual mapping: set → read → remove → read, answers true, forgets the kept chapters of the manga", async () => {
        await ask("POST", "/api/v1/manga/chapters", CHAPTERS)
        expect(await ask("POST", "/api/v1/manga/manual-mapping", { provider: "manga", mediaId: 30, mangaId: "chosen" })).toBe(true)
        expect(await ask("POST", "/api/v1/manga/get-mapping", { provider: "manga", mediaId: 30 })).toEqual({ mangaId: "chosen" })
        await ask("POST", "/api/v1/manga/chapters", CHAPTERS)
        expect(calls.filter(call => call.startsWith("findChapters"))).toEqual(["findChapters m-0", "findChapters chosen"])
        expect(await ask("POST", "/api/v1/manga/remove-mapping", { provider: "manga", mediaId: 30 })).toBe(true)
        expect(await ask("POST", "/api/v1/manga/get-mapping", { provider: "manga", mediaId: 30 })).toEqual({ mangaId: null })
        await expect(ask("POST", "/api/v1/manga/manual-mapping", { provider: "manga", mediaId: 30 })).rejects.toThrow("mangaId is required")
    })

    it("manual mapping preview (5a-2b): chapters of the chosen entry as Manga_MappingPreview, nothing kept, the provider's failure passed on", async () => {
        expect(matchCoreRoute("POST", "/api/v1/manga/manual-mapping/preview")?.route.area).toBe("manga")
        expect(await ask("POST", "/api/v1/manga/manual-mapping/preview", { provider: "manga", mangaId: "chosen" })).toEqual({ chapterCount: 5, latest: "5" })
        expect(calls.filter(call => call.startsWith("findChapters"))).toEqual(["findChapters chosen"])
        expect(await ask("POST", "/api/v1/manga/get-mapping", { provider: "manga", mediaId: 30 })).toEqual({ mangaId: null })
        await expect(ask("POST", "/api/v1/manga/manual-mapping/preview", { provider: "manga", mangaId: "broken" })).rejects.toThrow()
        await expect(ask("POST", "/api/v1/manga/manual-mapping/preview", { provider: "manga" })).rejects.toThrow("mangaId is required")
    })

    it("chapter number as the screens read it: the first number without decimals, none = 0", () => {
        expect([chapterNumberOf("12.5"), chapterNumberOf("Vol. 2 Ch. 7"), chapterNumberOf(""), chapterNumberOf(undefined)]).toEqual([12, 2, 0, 0])
    })

    it("collection: one list per status in AniList's order, custom lists left out, in the recorded form", async () => {
        const form = answers.GetMangaCollection.data as { lists: [{ entries: [{ media: Shape }] }] }
        const media = (id: number) => ({ ...(madeUp(form.lists[0].entries[0].media) as Record<string, unknown>), id })
        await keepCollection(await environment.database(), "MANGA", { MediaListCollection: { lists: [
            { name: "Planning", status: "PLANNING", isCustomList: false, entries: [{ ...madeUpListEntry("PLANNING", 0), media: media(52) }, { ...madeUpListEntry("PLANNING", 0), media: media(51) }] },
            { name: "Mine", status: "CURRENT", isCustomList: true, entries: [{ ...madeUpListEntry("CURRENT", 1), media: media(53) }] },
            { name: "Reading", status: "CURRENT", isCustomList: false, entries: [{ ...madeUpListEntry("CURRENT", 3), media: media(54) }] },
        ] } } as never, now)
        anilist = null
        const answer = await ask("GET", "/api/v1/manga/collection", null) as { lists: { type: string, status: string, entries: Record<string, unknown>[] }[] }
        expect(answer.lists.map(list => [list.type, list.status, list.entries.map(entry => entry.mediaId)])).toEqual([["PLANNING", "PLANNING", [52, 51]], ["CURRENT", "CURRENT", [54]]])
        expect(Object.keys(answer.lists[0].entries[0])).toEqual(["media", "mediaId", "listData"])
        expect(differences(form.lists[0].entries[0].media, answer.lists[1].entries[0].media)).toEqual([])
        expect(answer.lists[1].entries[0].listData).toMatchObject({ progress: 3, status: "CURRENT" })
    })
})

/*
 * Leftover 4a (docs/EIGENER-KERN.md §4n "Gerätetest MangaFire"): MangaFire counts `index` anew for every language. The
 * core sorted all chapters by `index` and mixed the languages; the server keeps the provider's order, so does the core.
 */
describe("chapters of a provider with several languages", () => {
    it("keep the provider's order, languages not mixed", () => {
        const list = [
            ...[0, 1, 2].map(index => ({ id: "en-" + index, chapter: String(index + 1), index, language: "en" })),
            ...[0, 1].map(index => ({ id: "fr-" + index, chapter: String(index + 1), index, language: "fr" })),
        ]
        expect(chaptersOf("mangafire", list).map(chapter => chapter.id)).toEqual(["en-0", "en-1", "en-2", "fr-0", "fr-1"])
    })
})

describe("manga phase 7f: the source refresh without the server, own rule", () => {
    async function ended(): Promise<Record<string, any>> {
        for (let tries = 0; tries < 200; tries++) {
            const job = await ask("GET", "/api/v1/manga/source-refresh", null) as Record<string, any>
            if (job.status !== "running" && job.status !== "stopping") return job
            await new Promise(resolve => setTimeout(resolve, 10))
        }
        throw new Error("the job did not end")
    }

    afterEach(() => forgetSourceRefresh())

    it("refresh_selected asks the chosen source for the chapter list again and keeps the latest number; the job ends completed", async () => {
        expect(await ask("GET", "/api/v1/manga/source-refresh", null)).toBeNull()
        await ask("POST", "/api/v1/manga/chapters", CHAPTERS)
        await ask("PATCH", "/api/v1/manga/preferences/30", { provider: "manga" })
        const started = await ask("POST", "/api/v1/manga/source-refresh", { mode: "refresh_selected", mediaIds: [30] }) as Record<string, any>
        expect(started).toMatchObject({ mode: "refresh_selected", status: "running", stage: "refreshing", current: 0, total: 1 })
        const job = await ended()
        expect(job).toMatchObject({ status: "completed", stage: "done", current: 1, total: 1, result: { refreshed: 1, failed: 0, notFound: 0, issues: [] } })
        // asked once for the page, once again by the refresh (what the core kept was forgotten)
        expect(calls.filter(call => call.startsWith("findChapters"))).toHaveLength(2)
        expect(await ask("GET", "/api/v1/manga/latest-chapter-numbers", null)).toEqual({ 30: [{ provider: "manga", scanlator: "", language: "", number: 5 }] })
        // an ended job is forgotten by DELETE
        expect(await ask("DELETE", "/api/v1/manga/source-refresh", null)).toBeNull()
        expect(await ask("GET", "/api/v1/manga/source-refresh", null)).toBeNull()
    })

    it("finding or replacing sources says it is not available without the server", async () => {
        for (const mode of ["find_missing", "refresh_and_find", "reevaluate_all"]) {
            await expect(ask("POST", "/api/v1/manga/source-refresh", { mode })).rejects.toThrow("Finding other manga sources is not available without the server")
        }
    })
})
