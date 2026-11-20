// geschrieben nach: Aufzeichnungen MANGA.* vom 13.11.2026 (GetMangaEntry, GetMangaEntryDetails, GetMangaEntryChapters, GetMangaEntryPages, GetMangaMapping, MangaManualSearch: Felder und Form, manga.recorded.json), dem Vertrag manga-provider.d.ts, den generierten Typen Manga_*/HibikeManga_*, App-Code src/app/main/manga (wie die Seiten geladen werden) und docs/EIGENER-KERN.md §4m/§4n; kein Server-Quelltext

import { askAnilist, clientFor } from "../anilist/client"
import { MANGA_DETAILS, MANGA_WITH_ENTRY } from "../anilist/queries"
import { keepDetails, storedCollection, storedDetails, withoutEmpty } from "../anilist/store"
import { CoreError } from "../errors"
import { readInstalled } from "../extensions/manage/installed"
import { loaderOf, preferencesOf, savedUserConfig } from "../extensions/manage/manage"
import type { CoreRequest } from "../registry"
import { failureOf, type StreamEnvironment } from "../streams/onlinestream"
import { type Found, type StreamMedia, chooseEntry } from "../streams/choose"
import { keepChapterNumber } from "./library"
import { mappingOf, removeMapping, setMapping } from "./mappings"

/*
 * Reading manga in the core (phase 4a-1, area `manga`). The work is the manga extension's, in its own sandbox (3a–3e):
 * search → choose the entry (the choice of the online streams, choose.ts, or the user's mapping) → findChapters →
 * findChapterPages. The manga page and its details come from AniList. Left with the server: its built-in source
 * `local-manga` (folders on the device) and downloaded chapters of the server. The double-page view pairs the pages in
 * the reader (4.3.0). The pictures themselves are not loaded here: the screen loads them (§4n).
 */

/** How long the provider's chapter list of a manga is kept: new chapters show up within this time */
export const CHAPTERS_KEEP_MS = 60 * 60_000
/** How long a chapter's pages are kept: the addresses of providers stop working after a while */
export const PAGES_KEEP_MS = 10 * 60_000
/** The server's own source (folders on the device): its work stays with the server */
export const LOCAL_SOURCE = "local-manga"

export type MangaEnvironment = StreamEnvironment

type Json = Record<string, unknown>

function isRecord(value: unknown): value is Json {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
    return typeof value === "string" ? value : ""
}

function bodyOf(body: unknown): Json {
    return isRecord(body) ? body : {}
}

function textOf(body: Json, name: string): string {
    const value = body[name]
    if (typeof value !== "string" || value === "") throw new CoreError(`${name} is required`, 400)
    return value
}

function mediaIdOf(value: unknown): number {
    const number = typeof value === "string" ? Number(value) : value
    if (typeof number !== "number" || !Number.isInteger(number) || number <= 0) throw new CoreError("mediaId is required", 400)
    return number
}

// ---- what the core keeps ----

type Kept = { value: Promise<unknown>, until: number, mediaId: number }

const kept = new Map<string, Kept>()

/** Forgets what the core kept of one manga, or of all */
export function forgetMangaCache(mediaId?: number): void {
    for (const [key, entry] of kept) if (mediaId === undefined || entry.mediaId === mediaId) kept.delete(key)
}

function keptFor<T>(environment: MangaEnvironment, key: string, mediaId: number, lifetime: number, work: () => Promise<T>): Promise<T> {
    const now = environment.core.now()
    const known = kept.get(key)
    const join = environment.manage.place.join
    if (known && known.until > now) return (join ? join(known.value) : known.value) as Promise<T>
    const value = work()
    kept.set(key, { value, until: now + lifetime, mediaId })
    value.catch(() => {
        if (kept.get(key)?.value === value) kept.delete(key)
    })
    return value
}

// ---- the provider ----

type Provider = { id: string, call: <T>(method: string, ...args: unknown[]) => Promise<T> }

async function providerOf(environment: MangaEnvironment, id: string): Promise<Provider> {
    const { extensions } = await readInstalled(environment.manage.place)
    const manifest = extensions.find(extension => extension.id === id && extension.type === "manga-provider")
    if (!manifest) throw new CoreError(`manga provider not found: ${id}`, 404)
    const preferences = preferencesOf(manifest, await savedUserConfig(environment.manage, id))
    return {
        id,
        call: async <T>(method: string, ...args: unknown[]) => {
            await environment.core.pause(`manga: ${id} ${method}`)
            environment.core.mark?.(`${id} ${method}: sandbox`)
            try {
                return await loaderOf(environment.manage).call<T>(manifest, preferences, method, ...args)
            }
            catch (error) {
                throw failureOf(id, method, error)
            }
        },
    }
}

/** The server's own source (local manga): not there, the app runs without its server */
function fromServer(endpoint: string): never {
    throw new CoreError(`POST ${endpoint} needs the server, the app runs without it`, 503)
}

// ---- the manga ----

/** The manga and the user's entry: AniList with the user's token; with the area `anilist` on, the core's own lists first */
async function mangaOf(environment: MangaEnvironment, mediaId: number): Promise<{ media: Json, entry: Json | null }> {
    const fromLists = async () => {
        const collection = await storedCollection(await environment.core.database(), "MANGA")
        for (const list of collection?.MediaListCollection.lists ?? []) {
            for (const entry of (list.entries ?? []) as Json[]) {
                if (isRecord(entry.media) && entry.media.id === mediaId) return { media: entry.media, entry }
            }
        }
        return null
    }
    // the core's lists carry its own changes, also those still waiting to be sent (anilist/changes.ts)
    const listed = await fromLists()
    if (listed) return listed
    let media: Json
    try {
        const answer = await askAnilist(clientFor(environment.core), MANGA_WITH_ENTRY, { id: mediaId })
        if (!isRecord(answer.Media)) throw new CoreError("manga not found", 404)
        media = answer.Media
    }
    catch (error) {
        // AniList cannot be reached: the lists the core kept, if the manga is in them
        const listed = error instanceof CoreError ? null : await fromLists().catch(() => null)
        if (listed) return listed
        throw error
    }
    const { mediaListEntry, ...rest } = media
    return { media: withoutEmpty(rest) as Json, entry: isRecord(mediaListEntry) ? withoutEmpty(mediaListEntry) as Json : null }
}

/** An AniList date as the server writes it in a list entry ("2024-03-09T00:00:00Z"); nothing without a year */
function dateText(value: unknown): string | undefined {
    if (!isRecord(value) || typeof value.year !== "number") return undefined
    const two = (part: unknown) => String(typeof part === "number" && part > 0 ? part : 1).padStart(2, "0")
    return `${String(value.year).padStart(4, "0")}-${two(value.month)}-${two(value.day)}T00:00:00Z`
}

/** The user's entry in the recorded form of `listData`: zero and empty values left out */
export function listDataOf(entry: Json): Json {
    const positive = (value: unknown) => (typeof value === "number" && value > 0 ? value : undefined)
    const fields: Json = {
        progress: positive(entry.progress),
        score: positive(entry.score),
        status: text(entry.status) || undefined,
        repeat: positive(entry.repeat),
        startedAt: dateText(entry.startedAt),
        completedAt: dateText(entry.completedAt),
        createdAt: positive(entry.createdAt),
        updatedAt: positive(entry.updatedAt),
    }
    return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))
}

/** The manga as the online streams' choice reads a title (choose.ts) */
function chooseMediaOf(media: Json, mediaId: number): StreamMedia {
    const title = isRecord(media.title) ? media.title : {}
    const start = isRecord(media.startDate) ? media.startDate : {}
    const year = typeof start.year === "number" ? start.year : undefined
    return {
        id: mediaId,
        romajiTitle: text(title.romaji) || undefined,
        englishTitle: text(title.english) || undefined,
        synonyms: Array.isArray(media.synonyms) ? media.synonyms.filter((value): value is string => typeof value === "string") : [],
        isAdult: media.isAdult === true,
        startDate: year === undefined ? undefined : { year },
    } as StreamMedia
}

// ---- the steps ----

type SearchResult = Json & { id: string, title: string }

async function search(provider: Provider, query: string, year?: number): Promise<SearchResult[]> {
    const results = await provider.call<unknown>("search", year === undefined ? { query } : { query, year })
    return (Array.isArray(results) ? results : []).filter(isRecord)
        .map(result => ({ ...result, id: String(result.id ?? ""), title: text(result.title) }))
        .filter(result => result.id !== "")
}

/** The provider's entry for the manga: the user's mapping, else the best search result */
async function entryOf(environment: MangaEnvironment, provider: Provider, mediaId: number): Promise<string> {
    const mapped = await mappingOf(environment.manage, provider.id, mediaId)
    if (mapped) return mapped
    const media = chooseMediaOf((await mangaOf(environment, mediaId)).media, mediaId)
    const queries = [...new Set([media.romajiTitle, media.englishTitle].filter((title): title is string => !!title))]
    for (const query of queries) {
        const found: Found[] = (await search(provider, query, media.startDate?.year)).map(result => ({ id: result.id, title: result.title, url: "", subOrDub: "sub" }))
        const chosen = chooseEntry(media, found, false)
        if (chosen) return chosen.id
    }
    throw new CoreError(`${provider.id}: no matching entry found, choose one by hand`, 404)
}

const CHAPTER_FIELDS = ["id", "url", "title", "chapter", "index", "scanlator", "language", "rating", "updatedAt"] as const

/** A chapter in the recorded form: the provider's name first, the contract's fields, empty ones left out */
function chapterOf(provider: string, item: Json): Json | null {
    const id = String(item.id ?? "")
    if (id === "") return null
    const chapter: Json = { provider }
    for (const field of CHAPTER_FIELDS) {
        const value = field === "id" ? id : item[field]
        if (value === undefined || value === null || value === "") continue
        chapter[field] = field === "chapter" ? String(value) : value
    }
    chapter.index = typeof item.index === "number" ? item.index : 0
    return chapter
}

/** In the provider's order, as the server keeps it: a provider with several languages counts `index` anew in each one */
export function chaptersOf(provider: string, value: unknown): Json[] {
    return (Array.isArray(value) ? value : []).filter(isRecord).map(item => chapterOf(provider, item)).filter((item): item is Json => item !== null)
}

function providerChapters(environment: MangaEnvironment, provider: Provider, mediaId: number): Promise<Json[]> {
    return keptFor(environment, `${provider.id}|${mediaId}|chapters`, mediaId, CHAPTERS_KEEP_MS, async () => {
        const entry = await entryOf(environment, provider, mediaId)
        const chapters = chaptersOf(provider.id, await provider.call<unknown>("findChapters", entry))
        // the latest chapter number, kept over restarts for the library (library.ts); a failure there is not the list's
        await keepChapterNumber(environment, mediaId, provider.id, chapters).catch(() => undefined)
        return chapters
    })
}

/**
 * How well a result fits the words of a manual search, from 0 to 1: the share of letter pairs the words share with the
 * result's title or one of its synonyms, the best of them (own rule; it gives the recorded value for the recorded search).
 */
export function searchRating(query: string, titles: string[]): number {
    const pairsOf = (value: string) => {
        const pairs = new Map<string, number>()
        const lower = value.toLowerCase()
        for (let index = 0; index < lower.length - 1; index++) pairs.set(lower.slice(index, index + 2), (pairs.get(lower.slice(index, index + 2)) ?? 0) + 1)
        return pairs
    }
    const wanted = pairsOf(query)
    let wantedCount = 0
    for (const count of wanted.values()) wantedCount += count
    let best = 0
    for (const title of titles) {
        const pairs = pairsOf(title)
        let shared = 0
        let total = wantedCount
        for (const count of pairs.values()) total += count
        for (const [pair, count] of pairs) shared += Math.min(count, wanted.get(pair) ?? 0)
        if (total > 0) best = Math.max(best, (2 * shared) / total)
    }
    return best
}

// ---- the answers ----

/** GET /api/v1/manga/entry/{id}: the manga and the user's entry (`listData` only when the manga is in the lists) */
export async function mangaEntry(environment: MangaEnvironment, request: CoreRequest): Promise<Json> {
    const mediaId = mediaIdOf(request.path.id)
    const { media, entry } = await mangaOf(environment, mediaId)
    return entry ? { mediaId, media, listData: listDataOf(entry) } : { mediaId, media }
}

/** GET /api/v1/manga/entry/{id}/details: from AniList, the last answer kept for when AniList cannot be reached */
export async function mangaEntryDetails(environment: MangaEnvironment, request: CoreRequest): Promise<Json> {
    const mediaId = mediaIdOf(request.path.id)
    const database = await environment.core.database()
    try {
        const media = (await askAnilist(clientFor(environment.core), MANGA_DETAILS, { id: mediaId })).Media
        if (!isRecord(media)) throw new CoreError("manga not found", 404)
        const details = withoutEmpty(media) as Json
        await keepDetails(database, "MANGA", mediaId, details, environment.core.now()).catch(() => undefined)
        return details
    }
    catch (error) {
        if (error instanceof CoreError) throw error
        const stored = await storedDetails(database, "MANGA", mediaId)
        if (stored) return stored
        throw error
    }
}

/** POST /api/v1/manga/chapters */
export async function mangaChapters(environment: MangaEnvironment, body: unknown): Promise<unknown> {
    const request = bodyOf(body)
    const mediaId = mediaIdOf(request.mediaId)
    const id = textOf(request, "provider")
    if (id === LOCAL_SOURCE) return fromServer("/api/v1/manga/chapters")
    const provider = await providerOf(environment, id)
    return { mediaId, provider: id, chapters: await providerChapters(environment, provider, mediaId) }
}

/** The chapters of a manga from a provider, kept like the list of POST /manga/chapters (for the downloads, downloads.ts) */
export async function chapterListOf(environment: MangaEnvironment, id: string, mediaId: number): Promise<Json[]> {
    return providerChapters(environment, await providerOf(environment, id), mediaId)
}

/** The pages of a chapter from its provider, by `index`, `headers` always an object; none is an error */
export async function pageListOf(environment: MangaEnvironment, id: string, mediaId: number, chapterId: string): Promise<{ provider: string, url: string, index: number, headers: Record<string, string> }[]> {
    const provider = await providerOf(environment, id)
    const pages = await keptFor(environment, `${id}|${mediaId}|pages|${chapterId}`, mediaId, PAGES_KEEP_MS, async () => {
        const answer = await provider.call<unknown>("findChapterPages", chapterId)
        return (Array.isArray(answer) ? answer : []).filter(isRecord).filter(page => text(page.url) !== "").map((page, place) => ({
            provider: id,
            url: text(page.url),
            index: typeof page.index === "number" ? page.index : place,
            headers: isRecord(page.headers) ? Object.fromEntries(Object.entries(page.headers).map(([key, value]) => [key, String(value)])) : {},
        })).sort((a, b) => a.index - b.index)
    })
    if (pages.length === 0) throw new CoreError(`${id}: no pages found for this chapter`, 404)
    return pages
}

/**
 * POST /api/v1/manga/pages. The server's own source stays with the server. The double-page view (4.3.0) gets the same
 * pages without their sizes (`pageDimensions` null): the reader pairs them itself and keeps a spread alone once its
 * picture has loaded (chapter-reader.ts `buildPaginationMap`), so `doublePage` changes nothing here.
 */
export async function mangaPages(environment: MangaEnvironment, body: unknown): Promise<unknown> {
    const request = bodyOf(body)
    const mediaId = mediaIdOf(request.mediaId)
    const id = textOf(request, "provider")
    const chapterId = textOf(request, "chapterId")
    if (id === LOCAL_SOURCE) return fromServer("/api/v1/manga/pages")
    const pages = await pageListOf(environment, id, mediaId, chapterId)
    return { mediaId, provider: id, chapterId, pages, pageDimensions: null, isDownloaded: false }
}

/** POST /api/v1/manga/get-mapping */
export async function mangaMapping(environment: MangaEnvironment, body: unknown): Promise<{ mangaId: string | null }> {
    const request = bodyOf(body)
    return { mangaId: await mappingOf(environment.manage, textOf(request, "provider"), mediaIdOf(request.mediaId)) }
}

/** POST /api/v1/manga/manual-mapping: the user's choice, kept in core.db; what the core kept of the manga is forgotten */
export async function mangaManualMapping(environment: MangaEnvironment, body: unknown): Promise<true> {
    const request = bodyOf(body)
    const mediaId = mediaIdOf(request.mediaId)
    await setMapping(environment.manage, textOf(request, "provider"), mediaId, textOf(request, "mangaId"))
    forgetMangaCache(mediaId)
    return true
}

/**
 * POST /api/v1/manga/manual-mapping/preview: what a chosen entry of a provider holds before it is kept, as the app's
 * type Manga_MappingPreview (not recorded; phase 5a-2b): the number of chapters, the newest chapter's number (the one
 * with the highest `index`), and its languages and scanlators once each, left out when there are none. Nothing is kept.
 */
export async function mangaMappingPreview(environment: MangaEnvironment, body: unknown): Promise<unknown> {
    const request = bodyOf(body)
    const id = textOf(request, "provider")
    const mangaId = textOf(request, "mangaId")
    if (id === LOCAL_SOURCE) return fromServer("/api/v1/manga/manual-mapping/preview")
    const chapters = chaptersOf(id, await (await providerOf(environment, id)).call<unknown>("findChapters", mangaId))
    const distinct = (field: "language" | "scanlator") => [...new Set(chapters.map(chapter => chapter[field]).filter((value): value is string => typeof value === "string" && value !== ""))]
    // as before the list kept the provider's order: the highest `index`, the provider's last of those
    const newest = chapters.reduce<Json | undefined>((last, chapter) => !last || (chapter.index as number) >= (last.index as number) ? chapter : last, undefined)
    const preview: Json = { chapterCount: chapters.length, latest: String(newest?.chapter ?? "") }
    const languages = distinct("language")
    const scanlators = distinct("scanlator")
    if (languages.length > 0) preview.languages = languages
    if (scanlators.length > 0) preview.scanlators = scanlators
    return preview
}

/** POST /api/v1/manga/remove-mapping */
export async function removeMangaMapping(environment: MangaEnvironment, body: unknown): Promise<true> {
    const request = bodyOf(body)
    const mediaId = mediaIdOf(request.mediaId)
    await removeMapping(environment.manage, textOf(request, "provider"), mediaId)
    forgetMangaCache(mediaId)
    return true
}

/**
 * DELETE /api/v1/manga/entry/cache: forgets the core's chapters and pages of the manga.
 */
export async function emptyMangaEntryCache(environment: MangaEnvironment, body: unknown): Promise<true> {
    const mediaId = mediaIdOf(bodyOf(body).mediaId)
    forgetMangaCache(mediaId)
    return true
}

/** POST /api/v1/manga/search: the provider's results for the user's words, unchosen, each with its rating */
export async function mangaManualSearch(environment: MangaEnvironment, body: unknown): Promise<unknown> {
    const request = bodyOf(body)
    const id = textOf(request, "provider")
    if (id === LOCAL_SOURCE) return fromServer("/api/v1/manga/search")
    const query = typeof request.query === "string" ? request.query : ""
    const results = await search(await providerOf(environment, id), query)
    return results.map(result => {
        const synonyms = Array.isArray(result.synonyms) ? result.synonyms.filter((value): value is string => typeof value === "string") : []
        const shaped: Json = { provider: id, id: result.id, title: result.title }
        if (synonyms.length > 0) shaped.synonyms = synonyms
        if (typeof result.year === "number" && result.year > 0) shaped.year = result.year
        if (text(result.image)) shaped.image = text(result.image)
        if (isRecord(result.imageHeaders) && Object.keys(result.imageHeaders).length > 0) shaped.imageHeaders = result.imageHeaders
        shaped.searchRating = searchRating(query, [result.title, ...synonyms])
        return shaped
    })
}
