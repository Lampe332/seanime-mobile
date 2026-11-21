// geschrieben nach: App-Typen der Manga-Downloads (native/src/api/generated/types.ts, endpoint.types.ts), dem Vertrag manga-provider.d.ts und docs/EIGENER-KERN.md §4o Phase 4b-C2 und Phase 4c-2 (Form der alten Ablage am Gerät beobachtet, Werte erfunden); kein Server-Quelltext
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { sqlDriverFor } from "@/api/client/core-database"
import type { ChapterDownloader_DownloadID, Manga_ChapterContainer, Manga_DownloadListItem, Manga_MediaDownloadData, Manga_PageContainer, Models_ChapterDownloadQueueItem } from "@/api/generated/types"
import { forgetDatabases, openDatabaseSync } from "../../../test/expo-sqlite"
import { type CoreDatabase, openCoreDatabase } from "../database/database"
import { mangaDownloads } from "../database/schema"
import type { LoaderEvent, LoaderRequest, LoaderStatus } from "../download/loader"
import { onCoreEvent } from "../events"
import type { ExtensionPlace } from "../extensions/manage/installed"
import { closeExtensionSandboxes } from "../extensions/manage/manage"
import { nodeSandboxEngine } from "../extensions/sandbox/node-engine"
import type { OfflineDevice } from "../offline/offline"
import { type CoreEnvironment, matchCoreRoute } from "../registry"
import { folderName, forgetMangaDownloads, pageFile, repeatOldChapters } from "./downloads"
import { type OldChapterFolder, oldChapters } from "./legacy"
import { forgetMangaCache } from "./manga"

/* A provider after the contract with made-up values; chapter "c-2" has one page that needs other headers */
const PROVIDER_TS = `/// <reference path="./manga-provider.d.ts" />
class Provider {
    getSettings(): Settings {
        return { supportsMultiLanguage: false, supportsMultiScanlator: false }
    }
    async search(opts: QueryOptions): Promise<SearchResult[]> {
        return [{ id: "m-0", title: "Sky Garden", year: 2019 }]
    }
    async findChapters(id: string): Promise<ChapterDetails[]> {
        return [0, 1, 2, 3].map(index => ({ id: "c-" + index + (index === 3 ? "/x y" : ""), url: "https://manga.example/" + index, title: "Chapter " + (index + 1), chapter: String(index + 1), index }))
    }
    async findChapterPages(id: string): Promise<ChapterPage[]> {
        if (id === "c-1") throw new Error("the site changed")
        return [1, 0, 2].map(index => ({ url: "https://cdn.example/" + id + "/" + index + (index === 2 ? ".png?x=1" : ".jpg"), index, headers: { Referer: id === "c-2" && index === 2 ? "https://other.example/" : "https://manga.example/" } }))
    }
}`

const ROOT = "file:///data/files/core-manga"

let files: Map<string, string>
let place: ExtensionPlace
let database: Promise<CoreDatabase> | null
let environment: CoreEnvironment
let requests: LoaderRequest[]
let forgotten: string[]
let removed: string[]
let listeners: ((event: LoaderEvent) => void)[]
let statuses: Map<string, LoaderStatus>
let events: string[]
let stopEvents: () => void = () => undefined
/** The server's manga folder as the device lists it (phase 4c-2); null: the device has none */
let oldFolders: OldChapterFolder[] | null
let lines: string[]

const device = (): OfflineDevice => ({
    loader: {
        enqueue: async request => void requests.push(request),
        cancel: async () => undefined,
        status: async id => statuses.get(id) ?? null,
        forget: async id => void forgotten.push(id),
        listen: listener => {
            listeners.push(listener)
            return () => void (listeners = listeners.filter(item => item !== listener))
        },
    },
    root: "file:///data/files/core-offline",
    mangaRoot: ROOT,
    removeFolder: async address => void removed.push(address),
    ...(oldFolders ? { oldMangaRoot: "file:///data/files/manga", oldManga: async () => structuredClone(oldFolders ?? []) } : {}),
    told: line => void lines.push(line),
    network: async () => ({ known: true, connected: true, metered: false }),
    onNetwork: () => () => undefined,
})

async function call<T>(method: "GET" | "POST" | "DELETE", endpoint: string, body?: unknown): Promise<T> {
    const match = matchCoreRoute(method, endpoint)
    if (!match) throw new Error(`no route for ${method} ${endpoint}`)
    return await match.route.answer({ path: match.path, query: undefined, body }, environment) as T
}

/** Lets the loader's listener and what follows it run */
const settle = () => new Promise(resolve => setTimeout(resolve, 20))

function loaderSays(event: LoaderEvent): void {
    listeners.forEach(listener => listener(event))
}

beforeEach(async () => {
    if (place) await closeExtensionSandboxes(place)
    await forgetMangaDownloads()
    forgetDatabases()
    forgetMangaCache()
    requests = []
    forgotten = []
    removed = []
    listeners = []
    statuses = new Map()
    events = []
    oldFolders = null
    lines = []
    stopEvents = onCoreEvent(event => void events.push(event.type))
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
        serverMangaMappings: async () => [{ provider: "manga", mediaId: 30, mangaId: "m-0" }],
        engine: async () => nodeSandboxEngine,
        fetch: async url => {
            throw new TypeError(`no network in tests: ${url}`)
        },
        log: () => undefined,
    }
    database = null
    let now = 1_700_000_000_000
    environment = {
        fetch: async () => {
            throw new TypeError("no network")
        },
        secret: async () => null,
        database: () => database ??= openCoreDatabase(sqlDriverFor(openDatabaseSync("core.db") as never), () => now),
        now: () => now++,
        pause: async () => undefined,
        extensions: async () => place,
        offline: async () => device(),
    }
})

afterEach(async () => {
    await forgetMangaDownloads()
    stopEvents()
})

const queue = () => call<Models_ChapterDownloadQueueItem[]>("GET", "/api/v1/manga/download-queue")
const data = () => call<Manga_MediaDownloadData>("POST", "/api/v1/manga/download-data", { mediaId: 30, cached: false })

describe("manga downloads in the core", () => {
    it("names folders and files safely", () => {
        expect(folderName("c-0")).toBe("c-0")
        expect(folderName("c-3/x y")).toMatch(/^c-3_x_y-[0-9a-z]+$/)
        expect(folderName("..")).not.toBe("..")
        expect(pageFile(2, "https://cdn.example/a/2.PNG?x=1")).toBe("002.png")
        expect(pageFile(14, "https://cdn.example/a/page")).toBe("014.jpg")
    })

    it("queues chapters, loads one at a time as one request of the loader, and answers in the app's shapes", async () => {
        expect(await call("POST", "/api/v1/manga/download-chapters", { mediaId: 30, provider: "manga", chapterIds: ["c-0", "c-2"], startNow: false })).toBe(true)
        expect(requests).toEqual([])
        const waiting = await queue()
        expect(waiting.map(item => [item.chapterId, item.chapterNumber, item.status])).toEqual([["c-0", "1", "not_started"], ["c-2", "3", "not_started"]])
        const first: Models_ChapterDownloadQueueItem = waiting[0]
        expect(Object.keys(first).sort()).toEqual(["chapterId", "chapterNumber", "createdAt", "id", "mediaId", "provider", "status", "updatedAt"])
        expect(first.createdAt).toMatch(/^\d{4}-\d\d-\d\dT/)
        const queued: Manga_MediaDownloadData = await data()
        expect(queued).toEqual({ downloaded: {}, queued: { manga: [{ chapterId: "c-0", chapterNumber: "1" }, { chapterId: "c-2", chapterNumber: "3" }] } })

        expect(await call("POST", "/api/v1/manga/download-queue/start")).toBe(true)
        expect(requests).toHaveLength(1)
        const request = requests[0]
        expect(request.id).toMatch(/^manga-\d+$/)
        expect(request.headers).toEqual({ Referer: "https://manga.example/" })
        expect(request.parts?.map(part => part.path)).toEqual([`${ROOT}/manga/30/c-0/000.jpg`, `${ROOT}/manga/30/c-0/001.jpg`, `${ROOT}/manga/30/c-0/002.png`])
        expect(request.parts?.every(part => part.headers === undefined)).toBe(true)
        expect((await queue()).map(item => item.status)).toEqual(["downloading", "not_started"])

        loaderSays({ type: "done", id: request.id, bytes: 300, resumedFrom: 0 })
        await settle()
        // the next chapter starts from the loader's event, no timer; one page brings its own headers
        expect(requests).toHaveLength(2)
        expect(requests[1].parts?.[2].headers).toEqual({ Referer: "https://other.example/" })
        expect(forgotten).toContain(request.id)
        loaderSays({ type: "done", id: requests[1].id, bytes: 300, resumedFrom: 0 })
        await settle()
        expect(await queue()).toEqual([])
        expect(await data()).toEqual({ downloaded: { manga: [{ chapterId: "c-0", chapterNumber: "1" }, { chapterId: "c-2", chapterNumber: "3" }] }, queued: {} })
        const list: Manga_DownloadListItem[] = await call("GET", "/api/v1/manga/downloads")
        expect(list).toEqual([{ mediaId: 30, downloadData: { manga: [{ chapterId: "c-0", chapterNumber: "1" }, { chapterId: "c-2", chapterNumber: "3" }] } }])
        const containers = await call<Manga_ChapterContainer[]>("GET", "/api/v1/manga/downloaded-chapters/30")
        expect(containers.map(container => [container.mediaId, container.provider, container.chapters?.map(chapter => chapter.id)])).toEqual([[30, "manga", ["c-0", "c-2"]]])

        const pages: Manga_PageContainer = await call("POST", "/api/v1/manga/pages", { mediaId: 30, provider: "manga", chapterId: "c-0", doublePage: false })
        expect(pages).toEqual({
            mediaId: 30, provider: "manga", chapterId: "c-0", pageDimensions: null, isDownloaded: true,
            pages: [0, 1, 2].map(index => ({ provider: "manga", url: `${ROOT}/manga/30/c-0/00${index}.${index === 2 ? "png" : "jpg"}`, index, headers: {} })),
        })
        // the double-page view reads the saved files too (4.3.0)
        expect(await call("POST", "/api/v1/manga/pages", { mediaId: 30, provider: "manga", chapterId: "c-0", doublePage: true })).toEqual(pages)
        const online = await call<Manga_PageContainer>("POST", "/api/v1/manga/pages", { mediaId: 30, provider: "manga", chapterId: "c-3/x y", doublePage: false })
        expect(online.isDownloaded).toBe(false)
        expect(online.pages?.[0].url).toMatch(/^https:/)
        expect(events).toContain("chapter-download-queue-updated")
        expect(events).toContain("refreshed-manga-download-data")
    })

    it("marks a chapter as errored when its pages fail or a page does not load, goes on with the next, and resets", async () => {
        await call("POST", "/api/v1/manga/download-chapters", { mediaId: 30, provider: "manga", chapterIds: ["c-1", "c-0", "c-2"], startNow: true })
        // c-1: the provider fails; c-0 is on its way
        expect(requests.map(request => request.parts?.[0].path)).toEqual([`${ROOT}/manga/30/c-0/000.jpg`])
        loaderSays({ type: "failed", id: requests[0].id, kind: "SOURCE_REFUSED", httpStatus: 403, message: "a page was refused" })
        await settle()
        expect((await queue()).map(item => [item.chapterId, item.status])).toEqual([["c-1", "errored"], ["c-0", "errored"], ["c-2", "downloading"]])
        loaderSays({ type: "done", id: requests[1].id, bytes: 10, resumedFrom: 0 })
        await settle()
        expect((await data()).downloaded).toEqual({ manga: [{ chapterId: "c-2", chapterNumber: "3" }] })
        expect(await call("POST", "/api/v1/manga/download-queue/reset-errored")).toBe(true)
        expect((await queue()).map(item => item.status)).toEqual(["errored", "downloading"])
        expect(requests).toHaveLength(3)
    })

    it("stops, clears the queue and deletes saved chapters with their folders", async () => {
        await call("POST", "/api/v1/manga/download-chapters", { mediaId: 30, provider: "manga", chapterIds: ["c-0", "c-2", "c-3/x y"], startNow: true })
        await call("POST", "/api/v1/manga/download-queue/stop")
        expect(forgotten).toContain(requests[0].id)
        expect((await queue()).map(item => item.status)).toEqual(["not_started", "not_started", "not_started"])
        await call("POST", "/api/v1/manga/download-queue/start")
        loaderSays({ type: "done", id: requests[1].id, bytes: 10, resumedFrom: 0 })
        await settle()
        expect(await call("DELETE", "/api/v1/manga/download-queue")).toBe(true)
        expect(await queue()).toEqual([])
        expect(removed).toEqual([`${ROOT}/manga/30/c-2`, expect.stringMatching(new RegExp(`^${ROOT}/manga/30/c-3_x_y-`))])
        const ids: ChapterDownloader_DownloadID[] = [{ provider: "manga", mediaId: 30, chapterId: "c-0", chapterNumber: "1" }]
        expect(await call("DELETE", "/api/v1/manga/download-chapter", { downloadIds: ids })).toBe(true)
        expect(removed.at(-1)).toBe(`${ROOT}/manga/30/c-0`)
        expect(await data()).toEqual({ downloaded: {}, queued: {} })
        expect(await call("GET", "/api/v1/manga/downloads")).toEqual([])
    })

    it("reads its table in steps with a pause between them on the first call (8-ms round 2)", async () => {
        await call("POST", "/api/v1/manga/download-chapters", { mediaId: 30, provider: "manga", chapterIds: ["c-0"], startNow: false })
        await forgetMangaDownloads()
        const opened = await environment.database()
        const [stored] = await opened.select().from(mangaDownloads)
        await opened.insert(mangaDownloads).values(Array.from({ length: 129 }, (_, index) => ({ ...stored, id: stored.id + 1 + index, chapterId: `x-${index}`, folder: `manga/30/x-${index}` })))
        const parts: (string | undefined)[] = []
        environment = { ...environment, pause: async part => void parts.push(part) }
        const read = await data()
        expect(read.queued.manga).toHaveLength(130)
        expect(parts.filter(part => part === "manga downloads: rows").length).toBeGreaterThanOrEqual(2)
    })

    it("after a restart takes what the loader finished and starts again what it lost", async () => {
        await call("POST", "/api/v1/manga/download-chapters", { mediaId: 30, provider: "manga", chapterIds: ["c-0"], startNow: true })
        statuses.set(requests[0].id, { id: requests[0].id, state: "done", bytes: 30, total: null, validator: null, failure: null })
        await forgetMangaDownloads()
        expect((await data()).downloaded).toEqual({ manga: [{ chapterId: "c-0", chapterNumber: "1" }] })
        await call("POST", "/api/v1/manga/download-chapters", { mediaId: 30, provider: "manga", chapterIds: ["c-2"], startNow: true })
        await forgetMangaDownloads()
        // the loader knows nothing of it any more: it starts again by itself
        await data()
        await settle()
        expect(requests).toHaveLength(3)
        expect((await queue()).map(item => item.status)).toEqual(["downloading"])
    })

    it("lets go of a chapter paused, deleted or cleared while its pages are asked for (4.3.1)", async () => {
        // the start waits right after the provider gave the pages, as a slow provider would
        let open = () => undefined as void
        const hold = () => new Promise<void>(resolve => { open = resolve })
        let gate: Promise<void> | null = null
        const slow = (base: CoreEnvironment): CoreEnvironment => ({ ...base, pause: async part => { if (part === "manga download: request" && gate) await gate } })
        const plain = environment
        environment = slow(plain)

        // paused: nothing goes to the loader, the chapter waits again
        gate = hold()
        const paused = call("POST", "/api/v1/manga/download-chapters", { mediaId: 30, provider: "manga", chapterIds: ["c-0"], startNow: true })
        await settle()
        expect((await queue()).map(item => item.status)).toEqual(["downloading"])
        await call("POST", "/api/v1/manga/download-queue/stop")
        open()
        await paused
        expect(requests).toEqual([])
        expect((await queue()).map(item => [item.chapterId, item.status])).toEqual([["c-0", "not_started"]])

        // deleted: not handed to the loader, not written back, not marked as failed
        gate = hold()
        const started = call("POST", "/api/v1/manga/download-queue/start")
        await settle()
        await call("DELETE", "/api/v1/manga/download-chapter", { downloadIds: [{ provider: "manga", mediaId: 30, chapterId: "c-0", chapterNumber: "1" }] })
        open()
        await started
        expect(requests).toEqual([])
        expect(await queue()).toEqual([])

        // the queue cleared: the same
        gate = hold()
        const cleared = call("POST", "/api/v1/manga/download-chapters", { mediaId: 30, provider: "manga", chapterIds: ["c-2"], startNow: true })
        await settle()
        await call("DELETE", "/api/v1/manga/download-queue")
        open()
        await cleared
        expect(requests).toEqual([])
        // nothing came back into the table either
        gate = null
        await forgetMangaDownloads()
        expect(await queue()).toEqual([])
        expect(await data()).toEqual({ downloaded: {}, queued: {} })
    })

    it("removes a waiting or failed chapter from the queue with what it had (4.3.1)", async () => {
        await call("POST", "/api/v1/manga/download-chapters", { mediaId: 30, provider: "manga", chapterIds: ["c-1", "c-0"], startNow: true })
        // c-1 failed at the provider, c-0 loads
        expect((await queue()).map(item => [item.chapterId, item.status])).toEqual([["c-1", "errored"], ["c-0", "downloading"]])
        await call("DELETE", "/api/v1/manga/download-chapter", { downloadIds: [{ provider: "manga", mediaId: 30, chapterId: "c-1", chapterNumber: "2" }] })
        expect((await queue()).map(item => item.chapterId)).toEqual(["c-0"])
        expect(removed).toEqual([`${ROOT}/manga/30/c-1`])
        await call("DELETE", "/api/v1/manga/download-chapter", { downloadIds: [{ provider: "manga", mediaId: 30, chapterId: "c-0", chapterNumber: "1" }] })
        expect(forgotten).toContain(requests[0].id)
        expect(await queue()).toEqual([])
    })

    it("refuses an unknown chapter and leaves the queue as it was", async () => {
        await expect(call("POST", "/api/v1/manga/download-chapters", { mediaId: 30, provider: "manga", chapterIds: ["nope"], startNow: true })).rejects.toThrow("chapter not found")
        expect(await queue()).toEqual([])
    })
})

/* The server's saved chapters in the form seen on the device: `<provider>_<mediaId>_<chapterId>_<number>/` with
 * `registry.json` ({ "<index>": { index, filename, original_url, size, width, height } }) and the page files */
function oldFolder(folder: string, count: number, options: { registry?: boolean, missing?: string } = {}): OldChapterFolder {
    const names = Array.from({ length: count }, (_, index) => `${String(index + 1).padStart(2, "0")}.jpeg`)
    const registry = Object.fromEntries(names.map((filename, index) => [String(index), { index, filename, original_url: `https://cdn.example/${index}.jpg`, size: 100 + index, width: 8, height: 9 }]))
    return { folder, files: [...names.filter(name => name !== options.missing), "registry.json"], registry: options.registry === false ? null : JSON.stringify(registry) }
}

describe("the server's saved chapters (phase 4c-2)", () => {
    beforeEach(() => {
        oldFolders = [
            oldFolder("manga_30_c-0_1", 3),
            oldFolder("manga_30_c_9_9.5", 2),
            oldFolder("manga_30_c-2_3", 2, { registry: false }),
            oldFolder("manga_30_c-3_4", 2, { missing: "02.jpeg" }),
            oldFolder("manga_30_c 4_5", 1),
        ]
    })

    it("reads only complete folders with safe names", () => {
        const found = oldChapters(oldFolders!)
        expect(found.left).toBe(3)
        expect(found.chapters.map(chapter => [chapter.provider, chapter.mediaId, chapter.chapterId, chapter.chapterNumber, chapter.pages.length])).toEqual([["manga", 30, "c-0", "1", 3], ["manga", 30, "c_9", "9.5", 2]])
        expect(found.chapters[0].pages).toEqual([{ index: 0, file: "01.jpeg" }, { index: 1, file: "02.jpeg" }, { index: 2, file: "03.jpeg" }])
    })

    it("takes them over once, shows them as saved and reads their pages from the server's folder", async () => {
        const saved = await data()
        expect(saved).toEqual({ downloaded: { manga: [{ chapterId: "c-0", chapterNumber: "1" }, { chapterId: "c_9", chapterNumber: "9.5" }] }, queued: {} })
        expect(lines).toEqual(["move from the server: saved manga chapters taken 2, left with the server 3"])
        const containers = await call<Manga_ChapterContainer[]>("GET", "/api/v1/manga/downloaded-chapters/30")
        expect(containers).toEqual([{ mediaId: 30, provider: "manga", chapters: [
            { provider: "manga", id: "c-0", url: "", title: "Chapter 1", chapter: "1", index: 1 },
            { provider: "manga", id: "c_9", url: "", title: "Chapter 9.5", chapter: "9.5", index: 9.5 },
        ] }])
        const list = await call<Manga_DownloadListItem[]>("GET", "/api/v1/manga/downloads")
        expect(list.map(item => [item.mediaId, item.downloadData?.manga?.length])).toEqual([[30, 2]])
        const pages = await call<Manga_PageContainer>("POST", "/api/v1/manga/pages", { mediaId: 30, provider: "manga", chapterId: "c-0" })
        expect(pages.isDownloaded).toBe(true)
        expect(pages.pages?.map(page => page.url)).toEqual(["01", "02", "03"].map(name => `file:///data/files/manga/manga_30_c-0_1/${name}.jpeg`))
        expect(requests).toEqual([])
        // a second start of the app: the note says it ran, nothing new, no line
        await forgetMangaDownloads()
        lines = []
        expect((await data()).downloaded).toEqual(saved.downloaded)
        expect(lines).toEqual([])
    })

    it("again adds only new chapters, and removing one removes its folder in the server's place too (4.3.1)", async () => {
        await data()
        oldFolders!.push(oldFolder("manga_30_c-5_6", 1))
        expect(await repeatOldChapters()).toEqual({ taken: 1, left: 5 })
        expect(await repeatOldChapters()).toEqual({ taken: 0, left: 6 })
        expect((await data()).downloaded.manga?.map(chapter => chapter.chapterId)).toEqual(["c-0", "c_9", "c-5"])
        await settle()
        expect(events).toContain("refreshed-manga-download-data")
        await call("DELETE", "/api/v1/manga/download-chapter", { downloadIds: [{ provider: "manga", mediaId: 30, chapterId: "c-0", chapterNumber: "1" }] })
        expect(removed).toEqual(["file:///data/files/manga/manga_30_c-0_1"])
        expect((await data()).downloaded.manga?.map(chapter => chapter.chapterId)).toEqual(["c_9", "c-5"])
        // it does not come back by itself
        await forgetMangaDownloads()
        expect((await data()).downloaded.manga?.map(chapter => chapter.chapterId)).toEqual(["c_9", "c-5"])
    })

    it("without the server's folder there is nothing to take and no note", async () => {
        oldFolders = null
        expect(await data()).toEqual({ downloaded: {}, queued: {} })
        expect(lines).toEqual([])
    })
})
