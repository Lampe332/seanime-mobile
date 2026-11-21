// geschrieben nach: Aufzeichnungen ONLINESTREAM.* vom 13.11.2026 (GetOnlineStreamEpisodeList, GetOnlineStreamEpisodeSource, GetOnlinestreamMapping, OnlinestreamManualSearch, OnlinestreamManualMapping, RemoveOnlinestreamMapping, OnlineStreamEmptyCache: Felder und Form), dem Vertrag onlinestream-provider.d.ts, den generierten Typen Onlinestream_* und docs/EIGENER-KERN.md §4m; kein Server-Quelltext

import { CoreError } from "../errors"
import { readInstalled } from "../extensions/manage/installed"
import { type ManageEnvironment, loaderOf, onlinestreamProviders, preferencesOf, savedUserConfig } from "../extensions/manage/manage"
import { SandboxError } from "../extensions/sandbox/sandbox"
import type { CoreEnvironment } from "../registry"
import { animeWithEpisodes } from "../library/library"
import { isTvmazeId } from "../tvmaze/tvmaze"
import { type Found, type StreamMedia, chooseEntry } from "./choose"
import { mappingOf, removeMapping, setMapping } from "./mappings"

/*
 * Online streams in the core (phase 3f-1, area `streams`). The work is the extension's, in its own sandbox (3a–3e):
 * search → choose the entry (choose.ts, or the user's mapping) → findEpisodes → findEpisodeServer. The core keeps the
 * provider's episodes and sources for a while (below) and answers in the form the hooks know from the server.
 *
 * The episodes' titles, pictures and summaries are not the provider's: they are the anime's metadata, which still
 * belongs to the server (stage 5). The core takes them from the server's answer for the anime's page, or its last
 * kept one (start/start.ts); without either, the episodes come with the provider's titles only, and the anime from
 * AniList.
 */

/** How long the provider's episode list of an anime is kept: new episodes show up within this time */
export const EPISODES_KEEP_MS = 60 * 60_000
/** How long an episode's sources are kept: the addresses of providers stop working after a while */
export const SOURCES_KEEP_MS = 10 * 60_000

export type StreamEnvironment = {
    manage: ManageEnvironment
    core: Pick<CoreEnvironment, "fetch" | "secret" | "now" | "pause" | "mark" | "database">
}

type Json = Record<string, unknown>

/** An episode as the provider gave it; handed back to it unchanged for findEpisodeServer */
type ProviderEpisode = Json & { id: string, number: number, url: string, title?: string }

function isRecord(value: unknown): value is Json {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
    return typeof value === "string" ? value : ""
}

function withoutUndefined<T extends Json>(value: T): T {
    return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T
}

// ---- the request's fields ----

function bodyOf(body: unknown): Json {
    return isRecord(body) ? body : {}
}

function textOf(body: Json, name: string): string {
    const value = body[name]
    if (typeof value !== "string" || value === "") throw new CoreError(`${name} is required`, 400)
    return value
}

/** An AniList number (positive) or a title of TVmaze (negative, tvmaze/tvmaze.ts) */
function mediaIdOf(body: Json): number {
    const value = body.mediaId
    if (typeof value !== "number" || !Number.isInteger(value) || (value <= 0 && !isTvmazeId(value))) throw new CoreError("mediaId is required", 400)
    return value
}

// ---- what the core keeps ----

type Kept = { value: Promise<unknown>, until: number, mediaId: number }

const kept = new Map<string, Kept>()

/** Forgets what the core kept of one anime, or of all (the tests, "empty cache" without an anime) */
export function forgetStreamCache(mediaId?: number): void {
    for (const [key, entry] of kept) if (mediaId === undefined || entry.mediaId === mediaId) kept.delete(key)
}

/** How many answers the core keeps now (tests) */
export function keptStreamAnswers(): number {
    return kept.size
}

function keptFor<T>(environment: StreamEnvironment, key: string, mediaId: number, lifetime: number, work: () => Promise<T>): Promise<T> {
    const now = environment.core.now()
    const known = kept.get(key)
    // another request asking the same: waiting for it is a wait for the watch of the app's thread (§4l)
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

/**
 * A fetch of the extension met a Cloudflare check that wants a person (`CloudflareCheckError`, `needsUser`, §4k). The
 * app never solves it, so the screen gets one plain sentence instead of the extension's own text. Matched by the
 * sandbox fetch's message, because the extension may pass the error on wrapped in its own.
 */
export const NEEDS_USER_TEXT = "the site asks for a human check (Cloudflare) that the app cannot pass by itself. Try again later or choose another provider."
const NEEDS_USER_SIGN = /CloudflareCheckError|Cloudflare's check needs the user/

/** What went wrong in the extension, said as the core's error (the kinds of 3a) */
export function failureOf(id: string, method: string, error: unknown): CoreError {
    if (error instanceof CoreError) return error
    const message = error instanceof Error ? error.message : String(error)
    if (NEEDS_USER_SIGN.test(message) || (error instanceof Error && error.name === "CloudflareCheckError")) {
        return new CoreError(`${id}: ${NEEDS_USER_TEXT}`, 503)
    }
    if (error instanceof SandboxError) {
        switch (error.kind) {
            case "time": return new CoreError(`${id}: ${method} took too long`)
            case "memory": return new CoreError(`${id}: ${method} ran out of memory`)
            case "stack": return new CoreError(`${id}: ${method} went too deep`)
            case "closed": return new CoreError(`${id}: the extension was closed during ${method}`)
            default: return new CoreError(`${id}: ${method} failed: ${error.message.replace(/^Error: /, "")}`)
        }
    }
    return new CoreError(`${id}: ${method} failed: ${error instanceof Error ? error.message : String(error)}`)
}

type Provider = {
    id: string
    call: <T>(method: string, ...args: unknown[]) => Promise<T>
}

async function providerOf(environment: StreamEnvironment, id: string): Promise<Provider> {
    const { extensions } = await readInstalled(environment.manage.place)
    const manifest = extensions.find(extension => extension.id === id && extension.type === "onlinestream-provider")
    if (!manifest) throw new CoreError(`online stream provider not found: ${id}`, 404)
    const saved = await savedUserConfig(environment.manage, id)
    // measuring point (3g): the time from the database's answer until here is the way back through the query builder
    environment.core.mark?.("provider config")
    const preferences = preferencesOf(manifest, saved)
    return {
        id,
        call: async <T>(method: string, ...args: unknown[]) => {
            await environment.core.pause(`streams: ${id} ${method}`)
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

// ---- the anime ----

type Anime = { media: Json, episodes: Json[] }

/**
 * The anime and its episodes' metadata, the core's own (library/library.ts)
 */
async function animeOf(environment: StreamEnvironment, mediaId: number): Promise<Anime> {
    const { media, episodes } = await animeWithEpisodes(environment.core, mediaId)
    return { media, episodes }
}

/** The anime as the contract's `Media` declares it */
export function streamMediaOf(media: Json): StreamMedia {
    const title = isRecord(media.title) ? media.title : {}
    const start = isRecord(media.startDate) ? media.startDate : {}
    const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined)
    const year = number(start.year)
    return withoutUndefined({
        id: number(media.id) ?? 0,
        idMal: number(media.idMal),
        status: text(media.status) || undefined,
        format: text(media.format) || undefined,
        englishTitle: text(title.english) || undefined,
        romajiTitle: text(title.romaji) || undefined,
        episodeCount: number(media.episodes),
        synonyms: Array.isArray(media.synonyms) ? media.synonyms.filter((value): value is string => typeof value === "string") : [],
        isAdult: media.isAdult === true,
        startDate: year === undefined ? undefined : withoutUndefined({ year, month: number(start.month), day: number(start.day) }),
    }) as StreamMedia
}

// ---- the steps ----

function foundOf(value: unknown): Found | null {
    if (!isRecord(value)) return null
    const subOrDub = value.subOrDub === "dub" || value.subOrDub === "both" ? value.subOrDub : "sub"
    return { id: String(value.id ?? ""), title: text(value.title), url: text(value.url), subOrDub }
}

async function search(provider: Provider, media: StreamMedia, query: string, dub: boolean): Promise<Found[]> {
    const options = withoutUndefined({ media, query, dub, year: media.startDate?.year })
    const results = await provider.call<unknown>("search", options)
    return (Array.isArray(results) ? results : []).map(foundOf).filter((found): found is Found => found !== null && found.id !== "")
}

/** The provider's entry for the anime: the user's mapping, else the best search result (choose.ts) */
async function entryOf(environment: StreamEnvironment, provider: Provider, mediaId: number, media: StreamMedia, dub: boolean): Promise<string> {
    const mapped = await mappingOf(environment.manage, provider.id, mediaId)
    if (mapped) return mapped
    const queries = [...new Set([media.romajiTitle, media.englishTitle].filter((title): title is string => !!title))]
    for (const query of queries) {
        const chosen = chooseEntry(media, await search(provider, media, query, dub), dub)
        if (chosen) return chosen.id
    }
    throw new CoreError(`${provider.id}: no matching entry found, choose one by hand`, 404)
}

function episodesOf(value: unknown): ProviderEpisode[] {
    const seen = new Set<number>()
    const episodes: ProviderEpisode[] = []
    for (const item of Array.isArray(value) ? value : []) {
        if (!isRecord(item) || typeof item.number !== "number" || !Number.isFinite(item.number) || seen.has(item.number)) continue
        seen.add(item.number)
        episodes.push({ ...item, id: String(item.id ?? ""), number: item.number, url: text(item.url) })
    }
    return episodes.sort((a, b) => a.number - b.number)
}

/** The provider's episodes of the anime, kept for EPISODES_KEEP_MS */
function providerEpisodes(environment: StreamEnvironment, provider: Provider, mediaId: number, dub: boolean, anime: () => Promise<Anime>): Promise<ProviderEpisode[]> {
    return keptFor(environment, `${provider.id}|${mediaId}|${dub}|episodes`, mediaId, EPISODES_KEEP_MS, async () => {
        const media = streamMediaOf((await anime()).media)
        const entry = await entryOf(environment, provider, mediaId, media, dub)
        return episodesOf(await provider.call<unknown>("findEpisodes", entry))
    })
}

/** An episode of the list: the provider's number, the anime's metadata for it when there is any */
function listedEpisode(episode: ProviderEpisode, metadata: Json | undefined, media: Json): Json {
    const details = isRecord(metadata?.episodeMetadata) ? metadata.episodeMetadata : {}
    const cover = isRecord(media.coverImage) ? text(media.coverImage.large) : ""
    return withoutUndefined({
        number: episode.number,
        title: text(metadata?.episodeTitle) || text(episode.title) || `Episode ${episode.number}`,
        image: text(details.image) || cover || undefined,
        description: text(details.summary) || text(details.overview) || undefined,
        isFiller: details.isFiller === true ? true : undefined,
        metadata,
    })
}

// ---- the answers ----

/** POST /api/v1/onlinestream/episode-list */
export async function episodeList(environment: StreamEnvironment, body: unknown) {
    const request = bodyOf(body)
    const mediaId = mediaIdOf(request)
    const provider = await providerOf(environment, textOf(request, "provider"))
    const dub = request.dubbed === true
    let anime: Promise<Anime> | null = null
    const animeOnce = () => anime ??= animeOf(environment, mediaId)
    const episodes = await providerEpisodes(environment, provider, mediaId, dub, animeOnce)
    const { media, episodes: metadata } = await animeOnce()
    const byNumber = new Map<number, Json>()
    for (const episode of metadata) {
        if (episode.type === "main" && typeof episode.progressNumber === "number" && !byNumber.has(episode.progressNumber)) byNumber.set(episode.progressNumber, episode)
    }
    return { episodes: episodes.map(episode => listedEpisode(episode, byNumber.get(episode.number), media)), media }
}

function sourcesOf(answer: Json, server: string) {
    const name = text(answer.server) || server
    const headers = isRecord(answer.headers) ? Object.fromEntries(Object.entries(answer.headers).map(([key, value]) => [key, String(value)])) : {}
    return (Array.isArray(answer.videoSources) ? answer.videoSources : []).filter(isRecord).filter(source => text(source.url) !== "").map(source => withoutUndefined({
        server: name,
        headers,
        url: text(source.url),
        label: text(source.label) || undefined,
        quality: text(source.quality),
        type: text(source.type) || "unknown",
        subtitles: (Array.isArray(source.subtitles) ? source.subtitles : []).filter(isRecord).map(subtitle => ({
            url: text(subtitle.url),
            language: text(subtitle.language),
            isDefault: subtitle.isDefault === true,
        })),
    }))
}

/**
 * POST /api/v1/onlinestream/episode-source. All of the provider's servers are asked at once; the sources of every server
 * that has some come back in the order its settings name them, and only those servers are listed (a server without
 * sources or with an error is left out, as the server does). Kept for SOURCES_KEEP_MS; `refresh` asks anew.
 */
export async function episodeSource(environment: StreamEnvironment, body: unknown) {
    const request = bodyOf(body)
    const mediaId = mediaIdOf(request)
    const number = request.episodeNumber
    if (typeof number !== "number" || !Number.isFinite(number)) throw new CoreError("episodeNumber is required", 400)
    const provider = await providerOf(environment, textOf(request, "provider"))
    const dub = request.dubbed === true
    const key = `${provider.id}|${mediaId}|${dub}|source|${number}`
    if (request.refresh === true) kept.delete(key)
    return keptFor(environment, key, mediaId, SOURCES_KEEP_MS, async () => {
        const episodes = await providerEpisodes(environment, provider, mediaId, dub, () => animeOf(environment, mediaId))
        const episode = episodes.find(item => item.number === number)
        if (!episode) throw new CoreError(`${provider.id}: episode ${number} not found`, 404)
        const settings = (await onlinestreamProviders(environment.manage)).find(item => item.id === provider.id)
        const servers = settings && settings.episodeServers.length > 0 ? settings.episodeServers : [""]
        const answers = await Promise.allSettled(servers.map(server => provider.call<unknown>("findEpisodeServer", episode, server)))
        const videoSources: ReturnType<typeof sourcesOf> = []
        const listed: { server: string, status: string }[] = []
        let failure: unknown = null
        answers.forEach((settled, index) => {
            if (settled.status === "rejected") {
                failure ??= settled.reason
                return
            }
            const answer = settled.value
            if (!isRecord(answer) || answer.status === "unavailable") return
            const sources = sourcesOf(answer, servers[index]!)
            if (sources.length === 0) return
            videoSources.push(...sources)
            listed.push({ server: sources[0]!.server, status: "available" })
        })
        if (videoSources.length > 0) return { number, videoSources, servers: listed }
        if (failure) throw failure
        throw new CoreError(`${provider.id}: no video sources found for episode ${number}`, 404)
    })
}

/** POST /api/v1/onlinestream/search: the provider's results for the user's words, unchosen */
export async function manualSearch(environment: StreamEnvironment, body: unknown): Promise<Found[]> {
    const request = bodyOf(body)
    const provider = await providerOf(environment, textOf(request, "provider"))
    const query = typeof request.query === "string" ? request.query : ""
    // the request names no anime: the provider gets the words only
    return search(provider, { id: 0, synonyms: [], isAdult: false }, query, request.dubbed === true)
}

/** POST /api/v1/onlinestream/get-mapping */
export async function getMapping(environment: StreamEnvironment, body: unknown) {
    const request = bodyOf(body)
    return { animeId: await mappingOf(environment.manage, textOf(request, "provider"), mediaIdOf(request)) }
}

/** POST /api/v1/onlinestream/manual-mapping */
export async function manualMapping(environment: StreamEnvironment, body: unknown): Promise<true> {
    const request = bodyOf(body)
    const mediaId = mediaIdOf(request)
    await setMapping(environment.manage, textOf(request, "provider"), mediaId, textOf(request, "animeId"))
    forgetStreamCache(mediaId)
    return true
}

/** POST /api/v1/onlinestream/remove-mapping */
export async function deleteMapping(environment: StreamEnvironment, body: unknown): Promise<true> {
    const request = bodyOf(body)
    const mediaId = mediaIdOf(request)
    await removeMapping(environment.manage, textOf(request, "provider"), mediaId)
    forgetStreamCache(mediaId)
    return true
}

/** DELETE /api/v1/onlinestream/cache */
export async function emptyCache(_environment: StreamEnvironment, body: unknown): Promise<true> {
    forgetStreamCache(mediaIdOf(bodyOf(body)))
    return true
}
