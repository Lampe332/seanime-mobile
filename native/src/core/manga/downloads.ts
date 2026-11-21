// geschrieben nach: Befund der Manga-Download-Schnittstellen der App (Form der Antworten: native/src/api/generated/types.ts Manga_MediaDownloadData, Manga_DownloadListItem, Models_ChapterDownloadQueueItem, ChapterDownloader_DownloadID; Felder der Anfragen: endpoint.types.ts; Aufrufer: api/hooks/manga_download.hooks.ts, main/manga/_lib/manga-downloads.ts, android-downloads/_screens/manga-downloads.tsx), Vertrag manga-provider.d.ts (findChapterPages), docs/EIGENER-KERN.md §4n (Bereich manga) und §4o (Lader, Sammel-Auftrag, Hintergrund-Kette über done); kein Server-Quelltext

import { asc, gt, inArray } from "drizzle-orm"
import { inOrder } from "../database/database"
import { anilistMedia, mangaDownloads, offlineMoves } from "../database/schema"
import type { LoaderEvent, LoaderPart, LoaderRequest } from "../download/loader"
import { CoreError } from "../errors"
import { emitCoreEvent } from "../events"
import type { OfflineDevice } from "../offline/offline"
import type { CoreEnvironment, CoreRequest } from "../registry"
import { oldChapterDetails, oldChapters } from "./legacy"
import { type MangaEnvironment, chapterListOf, mangaPages, pageListOf } from "./manga"

/*
 * Manga chapters saved on the device (phase 4b-C2, area `manga`). The queue and the list live here and in core.db; the
 * pictures of a chapter are loaded by the device's loader (download/loader.ts) as one request of several parts: every
 * page with its headers into a folder of its own, `<provider>/<mediaId>/<chapter>/` under the device's manga folder.
 * One chapter loads at a time, in the order they were queued. The loader's `done` starts the next one, so the queue
 * goes on while the app is not in front. The answers have the form the screens know from the server.
 */

export const QUEUE_EVENT = "chapter-download-queue-updated"
export const DATA_EVENT = "refreshed-manga-download-data"

export type MangaDownloadEnvironment = {
    manga: MangaEnvironment
    device: Pick<OfflineDevice, "loader" | "removeFolder" | "mangaRoot" | "oldMangaRoot" | "oldManga" | "told">
    /** Work no request started (CoreEnvironment.unasked) */
    unasked?: CoreEnvironment["unasked"]
}

type Json = Record<string, unknown>
type Status = "not_started" | "downloading" | "errored" | "ready"
/** A page on disk: its place in the chapter and its file in the chapter's folder */
type SavedPage = { index: number, file: string }

type Row = {
    id: number
    provider: string
    mediaId: number
    chapterId: string
    chapterNumber: string
    /** The chapter as the provider's list gave it (POST /manga/chapters), for GET /manga/downloaded-chapters */
    chapter: Json
    status: Status
    /** Relative to the manga folder */
    folder: string
    pages: SavedPage[]
    error: string
    createdAt: number
    updatedAt: number
    /** Saved by the server (phase 4c-2): `folder` lies under the server's manga folder; deleting the chapter removes it (4.3.1) */
    old: boolean
}

type Service = {
    environment: MangaDownloadEnvironment
    rows: Map<number, Row>
    running: boolean
    pumping: boolean
    nextId: number
    end: () => void
}

let service: Promise<Service> | null = null
/** `core?move=again` came before the service began: its start takes the server's chapters over again */
let oldAgain = false

/** Forgets the service of this app run (tests) */
export async function forgetMangaDownloads(): Promise<void> {
    const running = service
    service = null
    oldAgain = false
    const s = await running?.catch(() => null)
    s?.end()
}

const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value)
const text = (value: unknown): string => typeof value === "string" ? value : typeof value === "number" ? String(value) : ""
const loaderId = (row: Row) => `manga-${row.id}`

function rootOf(environment: MangaDownloadEnvironment): string {
    const root = environment.device.mangaRoot
    if (!root) throw new CoreError("manga downloads are not available here")
    return root.replace(/\/+$/, "")
}

/** A short, stable number of a text (FNV-1a), so that two names made safe the same way stay apart */
function hashOf(value: string): string {
    let hash = 0x811c9dc5
    for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 0x01000193) >>> 0
    return hash.toString(36)
}

/** A name that is safe as one folder: letters, digits, `.`, `_`, `-`; any other name gets a part of its own */
export function folderName(value: string): string {
    const plain = value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80)
    return plain === value && !/^\.*$/.test(value) ? value : `${plain}-${hashOf(value)}`
}

/** The file of a page: its place, three digits, and the picture's ending from the address (jpg when it names none) */
export function pageFile(index: number, url: string): string {
    const ending = /\.(jpe?g|png|webp|gif|avif)$/i.exec(url.split(/[?#]/)[0])?.[1]?.toLowerCase() ?? "jpg"
    return `${String(index).padStart(3, "0")}.${ending}`
}

function dateText(ms: number): string {
    return new Date(ms).toISOString()
}

// ---- the store ----

function rowOf(stored: typeof mangaDownloads.$inferSelect): Row {
    return {
        id: stored.id,
        provider: stored.provider,
        mediaId: stored.mediaId,
        chapterId: stored.chapterId,
        chapterNumber: stored.chapterNumber,
        chapter: stored.chapter,
        status: stored.status as Status,
        folder: stored.folder,
        pages: stored.pages as SavedPage[],
        error: stored.error,
        createdAt: stored.createdAt,
        updatedAt: stored.updatedAt,
        old: stored.old,
    }
}

async function keep(s: Service, row: Row): Promise<void> {
    const database = await s.environment.manga.core.database()
    const values = { ...row }
    await inOrder(database, () => database.insert(mangaDownloads).values(values).onConflictDoUpdate({ target: mangaDownloads.id, set: values }))
}

async function drop(s: Service, ids: number[]): Promise<void> {
    if (ids.length === 0) return
    const database = await s.environment.manga.core.database()
    await inOrder(database, () => database.delete(mangaDownloads).where(inArray(mangaDownloads.id, ids)))
}

function change(s: Service, row: Row, fields: Partial<Row>): Row {
    const changed = { ...row, ...fields, updatedAt: s.environment.manga.core.now() }
    s.rows.set(row.id, changed)
    return changed
}

const tellQueue = () => emitCoreEvent(QUEUE_EVENT)
const tellData = () => emitCoreEvent(DATA_EVENT)

// ---- the queue ----

/** Runs work no request started (an event of the loader) the way the host wants it */
function unasked(s: Service, what: string, work: () => Promise<unknown>): void {
    const run = s.environment.unasked
    void (run ? run(what, work) : work()).catch(() => undefined)
}

async function fail(s: Service, row: Row, error: string): Promise<void> {
    const failed = change(s, row, { status: "errored", error: error.slice(0, 300) })
    await keep(s, failed)
    await s.environment.device.loader.forget(loaderId(row)).catch(() => undefined)
    tellQueue()
}

/** The loader's request of a chapter: every page into the chapter's folder, its headers along when they are not the first page's */
export function requestOf(root: string, row: Row, pages: { url: string, index: number, headers: Record<string, string> }[]): { request: LoaderRequest, saved: SavedPage[] } {
    const folder = `${root}/${row.folder}`
    const common = pages[0].headers
    const same = JSON.stringify(common)
    const saved: SavedPage[] = []
    const parts: LoaderPart[] = pages.map(page => {
        const file = pageFile(page.index, page.url)
        saved.push({ index: page.index, file })
        const part: LoaderPart = { url: page.url, path: `${folder}/${file}` }
        if (JSON.stringify(page.headers) !== same) part.headers = page.headers
        return part
    })
    const title = text(row.chapter.title) || `Chapter ${row.chapterNumber}`
    return { request: { id: loaderId(row), url: parts[0].url, headers: common, path: parts[0].path!, title, parts }, saved }
}

/**
 * A chapter takes its turn: its pages from the provider, then one request of the loader. Paused, removed or the queue
 * cleared on the way (4.3.1), it lets go: nothing is handed to the loader, nothing written back, no error kept.
 */
async function start(s: Service, row: Row): Promise<void> {
    const { environment } = s
    let current = change(s, row, { status: "downloading", error: "" })
    // still the row this start set: stop, delete and clearing the queue all replace or drop it
    const mine = () => s.rows.get(row.id) === current
    await keep(s, current)
    tellQueue()
    try {
        const pages = await pageListOf(environment.manga, row.provider, row.mediaId, row.chapterId)
        if (!mine()) return
        await environment.manga.core.pause("manga download: request")
        if (!mine()) return
        environment.manga.core.mark?.("manga download: request")
        const { request, saved } = requestOf(rootOf(environment), current, pages)
        current = change(s, current, { pages: saved })
        await environment.manga.core.pause("manga download: keep")
        if (!mine()) return
        environment.manga.core.mark?.("manga download: keep")
        await keep(s, current)
        if (!mine()) return
        await environment.device.loader.enqueue(request)
        if (!mine()) await environment.device.loader.forget(request.id).catch(() => undefined)
    }
    catch (error) {
        if (!mine()) return
        await fail(s, current, error instanceof Error ? error.message : String(error))
    }
}

/** Starts the next chapter when the queue runs and none loads */
async function pump(s: Service): Promise<void> {
    if (s.pumping) return
    s.pumping = true
    try {
        while (s.running) {
            const rows = [...s.rows.values()]
            if (rows.some(row => row.status === "downloading")) return
            const next = rows.filter(row => row.status === "not_started").sort((a, b) => a.id - b.id)[0]
            if (!next) return
            await start(s, next)
        }
    }
    finally {
        s.pumping = false
    }
}

async function onLoaderEvent(s: Service, event: LoaderEvent): Promise<void> {
    if (!event.id.startsWith("manga-") || event.type === "progress") return
    const row = s.rows.get(Number(event.id.slice(6)))
    if (!row || row.status !== "downloading") return
    if (event.type === "done") {
        await keep(s, change(s, row, { status: "ready", error: "" }))
        await s.environment.device.loader.forget(event.id).catch(() => undefined)
        tellQueue()
        tellData()
    }
    else {
        await fail(s, row, `${event.kind}${event.httpStatus ? ` ${event.httpStatus}` : ""}: ${event.message}`)
    }
    await pump(s)
}

/** Rows of the table read and shaped in one step */
const ROWS_PER_STEP = 50

function serviceOf(environment: MangaDownloadEnvironment): Promise<Service> {
    service ??= (async () => {
        const database = await environment.manga.core.database()
        // read in steps: the first call read and shaped the whole table in one piece (12.0 ms on the tablet, 8-ms round 2, §4r)
        const rows = new Map<number, Row>()
        for (let after = 0; ;) {
            const page = await database.select().from(mangaDownloads).where(gt(mangaDownloads.id, after)).orderBy(asc(mangaDownloads.id)).limit(ROWS_PER_STEP)
            for (const stored of page) rows.set(stored.id, rowOf(stored))
            if (page.length < ROWS_PER_STEP) break
            after = page[page.length - 1].id
            await environment.manga.core.pause("manga downloads: rows")
        }
        const s: Service = { environment, rows, running: false, pumping: false, nextId: Math.max(0, ...rows.keys()) + 1, end: () => undefined }
        const again = oldAgain
        oldAgain = false
        const moved = await takeOldChapters(s, again).catch(() => null)
        if (moved) environment.device.told?.(`move from the server${again ? " (again)" : ""}: saved manga chapters taken ${moved.taken}, left with the server ${moved.left}`)
        s.end = environment.device.loader.listen(event => unasked(s, "event of the loader", () => onLoaderEvent(s, event)))
        // after a restart: what the loader finished meanwhile is ready, what it still holds goes on, the rest starts again
        for (const row of [...rows.values()].filter(row => row.status === "downloading")) {
            const status = await environment.device.loader.status(loaderId(row)).catch(() => null)
            if (status?.state === "done") await onLoaderEvent(s, { type: "done", id: loaderId(row), bytes: status.bytes, resumedFrom: 0 })
            else if (status?.state !== "running" && status?.state !== "queued") await keep(s, change(s, row, { status: "not_started" }))
            s.running = true
        }
        void pump(s)
        return s
    })().catch(error => {
        service = null
        throw error
    })
    return service
}

async function remove(s: Service, rows: Row[]): Promise<void> {
    rootOf(s.environment)
    for (const row of rows) {
        s.rows.delete(row.id)
        if (row.status === "downloading") await s.environment.device.loader.forget(loaderId(row)).catch(() => undefined)
        // the server's chapter goes with its folder too (4.3.1): the server is gone (stage 8a-2), nobody else shows or frees them
        const folder = folderOf(s.environment, row)
        if (folder) await s.environment.device.removeFolder(folder)
    }
    await drop(s, rows.map(row => row.id))
}

/** The folder of a saved chapter as a file address: the core's own under its manga folder, the server's under the server's */
function folderOf(environment: MangaDownloadEnvironment, row: Row): string | null {
    if (!row.old) return `${rootOf(environment)}/${row.folder}`
    const root = environment.device.oldMangaRoot
    return root ? `${root.replace(/\/+$/, "")}/${row.folder}` : null
}

// ---- the chapters the server saved (phase 4c-2) ----

/**
 * Takes the server's complete chapters over, read only: once per core.db (`offline_moves`, part `manga`), or again on
 * purpose. A chapter the core has already (same provider, manga and chapter id) stays as it is, so another run adds
 * only what is new. null: it ran before; else how many were taken and how many stay with the server. A folder that
 * cannot be listed leaves no note: the next start tries again.
 */
async function takeOldChapters(s: Service, again: boolean): Promise<{ taken: number, left: number } | null> {
    const { environment } = s
    if (!environment.device.oldManga || !environment.device.oldMangaRoot) return null
    const database = await environment.manga.core.database()
    if (!again && (await inOrder(database, () => database.select().from(offlineMoves).where(inArray(offlineMoves.part, ["manga"])))).length > 0) return null
    const found = oldChapters(await environment.device.oldManga())
    const now = environment.manga.core.now()
    let taken = 0
    for (const chapter of found.chapters) {
        if ([...s.rows.values()].some(row => row.provider === chapter.provider && row.mediaId === chapter.mediaId && row.chapterId === chapter.chapterId)) continue
        const row: Row = {
            id: s.nextId++, provider: chapter.provider, mediaId: chapter.mediaId, chapterId: chapter.chapterId, chapterNumber: chapter.chapterNumber,
            chapter: oldChapterDetails(chapter), status: "ready", folder: chapter.folder, pages: chapter.pages, error: "", createdAt: now, updatedAt: now, old: true,
        }
        s.rows.set(row.id, row)
        await keep(s, row)
        taken++
    }
    const note = { count: taken, movedAt: now }
    await inOrder(database, () => database.insert(offlineMoves).values({ part: "manga", ...note }).onConflictDoUpdate({ target: offlineMoves.part, set: note }))
    return { taken, left: found.left + found.chapters.length - taken }
}

/** Link `core?move=again` (phase 4c-2): takes the server's saved chapters over again; only new ones are added */
export async function repeatOldChapters(): Promise<{ taken: number, left: number } | null> {
    // not begun yet: the start does it (null)
    if (!service) {
        oldAgain = true
        return null
    }
    const s = await service
    const result = await takeOldChapters(s, true)
    if (result && result.taken > 0) {
        tellQueue()
        tellData()
    }
    return result
}

// ---- the answers ----

function providerMap(rows: Row[]): Record<string, { chapterId: string, chapterNumber: string }[]> {
    const map: Record<string, { chapterId: string, chapterNumber: string }[]> = {}
    for (const row of [...rows].sort((a, b) => a.id - b.id)) (map[row.provider] ??= []).push({ chapterId: row.chapterId, chapterNumber: row.chapterNumber })
    return map
}

function mediaIdOf(value: unknown): number {
    const id = Number(value)
    if (!Number.isInteger(id) || id <= 0) throw new CoreError("mediaId must be a positive number", 400)
    return id
}

/** POST /api/v1/manga/download-chapters { mediaId, provider, chapterIds, startNow } */
export async function downloadMangaChapters(environment: MangaDownloadEnvironment, body: unknown): Promise<true> {
    const request = isRecord(body) ? body : {}
    const mediaId = mediaIdOf(request.mediaId)
    const provider = text(request.provider)
    if (provider === "") throw new CoreError("provider is missing", 400)
    const wanted = (Array.isArray(request.chapterIds) ? request.chapterIds : []).map(text).filter(id => id !== "")
    rootOf(environment)
    const s = await serviceOf(environment)
    const chapters = await chapterListOf(environment.manga, provider, mediaId)
    const now = environment.manga.core.now()
    let added = 0
    for (const chapterId of wanted) {
        if ([...s.rows.values()].some(row => row.provider === provider && row.mediaId === mediaId && row.chapterId === chapterId)) continue
        const chapter = chapters.find(item => item.id === chapterId)
        if (!chapter) throw new CoreError(`chapter not found: ${chapterId}`, 404)
        const row: Row = {
            id: s.nextId++, provider, mediaId, chapterId, chapterNumber: text(chapter.chapter), chapter, status: "not_started",
            folder: `${folderName(provider)}/${mediaId}/${folderName(chapterId)}`, pages: [], error: "", createdAt: now, updatedAt: now, old: false,
        }
        s.rows.set(row.id, row)
        await keep(s, row)
        added++
    }
    if (added > 0) tellQueue()
    if (request.startNow === true) s.running = true
    await pump(s)
    return true
}

/** POST /api/v1/manga/download-data { mediaId, cached }: saved and queued chapters of one manga, by provider */
export async function mangaDownloadData(environment: MangaDownloadEnvironment, body: unknown): Promise<Json> {
    const mediaId = mediaIdOf(isRecord(body) ? body.mediaId : undefined)
    const rows = [...(await serviceOf(environment)).rows.values()].filter(row => row.mediaId === mediaId)
    return { downloaded: providerMap(rows.filter(row => row.status === "ready")), queued: providerMap(rows.filter(row => row.status !== "ready")) }
}

/** GET /api/v1/manga/download-queue: the chapters not saved yet, in their order */
export async function mangaDownloadQueue(environment: MangaDownloadEnvironment): Promise<Json[]> {
    const rows = [...(await serviceOf(environment)).rows.values()].filter(row => row.status !== "ready").sort((a, b) => a.id - b.id)
    return rows.map(row => ({
        provider: row.provider, mediaId: row.mediaId, chapterId: row.chapterId, chapterNumber: row.chapterNumber,
        status: row.status, id: row.id, createdAt: dateText(row.createdAt), updatedAt: dateText(row.updatedAt),
    }))
}

/** GET /api/v1/manga/downloads: one item per manga with saved chapters; `media` when the core knows the manga */
export async function mangaDownloadsList(environment: MangaDownloadEnvironment): Promise<Json[]> {
    const ready = [...(await serviceOf(environment)).rows.values()].filter(row => row.status === "ready")
    await environment.manga.core.pause("manga downloads: list")
    environment.manga.core.mark?.("manga downloads: list")
    const ids = [...new Set(ready.map(row => row.mediaId))].sort((a, b) => a - b)
    const database = await environment.manga.core.database()
    const known = ids.length === 0 ? [] : await inOrder(database, () => database.select({ id: anilistMedia.anilistId, content: anilistMedia.content }).from(anilistMedia).where(inArray(anilistMedia.anilistId, ids)))
    const media = new Map(known.map(item => [item.id, item.content]))
    return ids.map(mediaId => {
        const downloadData = providerMap(ready.filter(row => row.mediaId === mediaId))
        const content = media.get(mediaId)
        return isRecord(content) ? { mediaId, media: content, downloadData } : { mediaId, downloadData }
    })
}

/** POST /api/v1/manga/download-queue/start */
export async function startMangaDownloadQueue(environment: MangaDownloadEnvironment): Promise<true> {
    const s = await serviceOf(environment)
    s.running = true
    await pump(s)
    return true
}

/** POST /api/v1/manga/download-queue/stop: the chapter on its way goes back to waiting, what it had is dropped */
export async function stopMangaDownloadQueue(environment: MangaDownloadEnvironment): Promise<true> {
    const s = await serviceOf(environment)
    s.running = false
    for (const row of [...s.rows.values()].filter(row => row.status === "downloading")) {
        await environment.device.loader.forget(loaderId(row)).catch(() => undefined)
        await keep(s, change(s, row, { status: "not_started" }))
    }
    tellQueue()
    return true
}

/** POST /api/v1/manga/download-queue/reset-errored: failed chapters wait again */
export async function resetErroredMangaDownloads(environment: MangaDownloadEnvironment): Promise<true> {
    const s = await serviceOf(environment)
    for (const row of [...s.rows.values()].filter(row => row.status === "errored")) await keep(s, change(s, row, { status: "not_started", error: "" }))
    tellQueue()
    await pump(s)
    return true
}

/** DELETE /api/v1/manga/download-queue: every chapter not saved yet leaves the queue, with what it had on disk */
export async function clearMangaDownloadQueue(environment: MangaDownloadEnvironment): Promise<true> {
    const s = await serviceOf(environment)
    await remove(s, [...s.rows.values()].filter(row => row.status !== "ready"))
    tellQueue()
    tellData()
    return true
}

/** DELETE /api/v1/manga/download-chapter { downloadIds }: the chapters and their folders */
export async function deleteMangaDownloads(environment: MangaDownloadEnvironment, body: unknown): Promise<true> {
    const ids = (isRecord(body) && Array.isArray(body.downloadIds) ? body.downloadIds : []).filter(isRecord)
    const s = await serviceOf(environment)
    const chosen = [...s.rows.values()].filter(row => ids.some(id => text(id.provider) === row.provider && Number(id.mediaId) === row.mediaId && text(id.chapterId) === row.chapterId))
    await remove(s, chosen)
    tellQueue()
    tellData()
    await pump(s)
    return true
}

/**
 * GET /api/v1/manga/downloaded-chapters/{id}: the saved chapters of a manga, one container per provider
 * (Manga_ChapterContainer), the chapters as the provider listed them, by `index`
 */
export async function mangaDownloadedChapters(environment: MangaDownloadEnvironment, request: CoreRequest): Promise<Json[]> {
    const mediaId = mediaIdOf(request.path.id)
    const rows = [...(await serviceOf(environment)).rows.values()]
        .filter(row => row.mediaId === mediaId && row.status === "ready")
        .sort((a, b) => a.provider.localeCompare(b.provider) || Number(a.chapter.index ?? 0) - Number(b.chapter.index ?? 0))
    return [...new Set(rows.map(row => row.provider))].map(provider => ({ mediaId, provider, chapters: rows.filter(row => row.provider === provider).map(row => row.chapter) }))
}

/**
 * POST /api/v1/manga/pages: a chapter saved by the core comes from its files (`file://`, `isDownloaded` true, no
 * headers); everything else as before (manga.ts, which leaves the server's own downloads with the server).
 */
export async function mangaPagesOrSaved(environment: MangaDownloadEnvironment, body: unknown): Promise<unknown> {
    const request = isRecord(body) ? body : {}
    const provider = text(request.provider)
    const chapterId = text(request.chapterId)
    const mediaId = Number(request.mediaId)
    // also for the double-page view: the reader pairs the pages itself (chapter-reader.ts)
    if (environment.device.mangaRoot) {
        const s = await serviceOf(environment)
        const row = [...s.rows.values()].find(item => item.status === "ready" && item.provider === provider && item.mediaId === mediaId && item.chapterId === chapterId)
        const folder = row ? folderOf(environment, row) : null
        if (row && folder) {
            const pages = [...row.pages].sort((a, b) => a.index - b.index).map(page => ({ provider, url: `${folder}/${page.file}`, index: page.index, headers: {} }))
            return { mediaId, provider, chapterId, pages, pageDimensions: null, isDownloaded: true }
        }
    }
    return mangaPages(environment.manga, body)
}
