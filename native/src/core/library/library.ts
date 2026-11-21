// geschrieben nach: Aufzeichnung api vom 13.11.2026 (ANIME_ENTRIES.GetAnimeEntry, ANIME.GetAnimeEpisodeCollection: Felder und Arten der Antworten), den App-Typen Anime_Entry/Anime_Episode/Anime_EpisodeCollection (src/api/generated/types.ts), dem App-Code der Anime-Seite (episode-section.tsx, anime-entry-page.tsx: welche Felder sie liest) und docs/EIGENER-KERN.md §4p; kein Server-Quelltext

import { and, eq } from "drizzle-orm"
import { readThrough } from "../anilist/anilist"
import { listDataOf } from "../anilist/changes"
import { askAnilist, clientFor } from "../anilist/client"
import { ENTRY_MEDIA } from "../anilist/queries"
import { keepAnswer, storedAnswer, storedEntry, withoutEmpty } from "../anilist/store"
import { type CoreDatabase, inOrder } from "../database/database"
import { anilistMedia, offlineItems } from "../database/schema"
import { CoreError } from "../errors"
import type { CoreEnvironment, CoreRequest } from "../registry"
import { isTvmazeId, tvmazeMedia } from "../tvmaze/tvmaze"
import { animeMetadata } from "./metadata"
import { asLocalFile, episodeOfFile, filesOf, libraryDataOf } from "./local-files"

/*
 * The library of the core (area `library`, docs/EIGENER-KERN.md §4p): an anime's page (`Anime_Entry`) and its list of
 * episodes (`Anime_EpisodeCollection`), built from the core's own data – the title as AniList gave it (`anilist_media`),
 * the user's list entry (`anilist_list_entries`, with changes still waiting), the episode metadata of a public service
 * (metadata.ts) and the episodes saved on the device (`offline_items`). Own rules:
 *
 * - Episodes: the main episodes 1 … n, n = the episodes that are out: all of them for a finished anime, the one before
 *   the next to air for a running one; without that, the episodes whose air date has passed; without dates, AniList's
 *   count, else the service's.
 * - An episode's title and picture come from the metadata under its number; without metadata it is "Episode n" alone.
 * - The user's own files (phase 5b-1, local-files.ts): with files the page has `libraryData`, the files, one episode per
 *   file and the next episode (the first main episode after the progress that has a file; any first one when
 *   rewatching); without files it shows the anime as "not in your library". `isDownloaded`: the episode is saved on
 *   the device (offline area) and ready. Episodes with a file of their own are not "to watch" any more.
 * - To watch (`downloadInfo.episodesToDownload`): all episodes after the progress, all of them when the anime is
 *   completed or rewatched (`rewatch`). Batches (`canBatch`) for a finished anime; `batchAll` when none was watched.
 *   `hasInaccurateSchedule` when a running anime has no next episode to air.
 */

type Json = Record<string, unknown>
type Environment = Pick<CoreEnvironment, "fetch" | "secret" | "database" | "now" | "pause">

function isRecord(value: unknown): value is Json {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

const whole = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0)

function mediaIdOf(request: CoreRequest): number {
    const id = Number(request.path.id)
    // negative: a title of TVmaze (tvmaze/tvmaze.ts)
    if (!Number.isInteger(id) || id === 0) throw new CoreError("invalid id", 400)
    return id
}

/** The title as the lists keep it; a title not in the lists is asked of AniList (kept under its own question) */
async function mediaOf(environment: Environment, database: CoreDatabase, id: number): Promise<Json> {
    const rows = await inOrder(database, () => database.select({ content: anilistMedia.content }).from(anilistMedia)
        .where(and(eq(anilistMedia.anilistId, id), eq(anilistMedia.kind, "ANIME"))))
    if (isRecord(rows[0]?.content)) return rows[0].content
    if (isTvmazeId(id)) return tvmazeMedia(environment as CoreEnvironment, id)
    const question = `library-media:${id}`
    return readThrough<Json>(
        environment as CoreEnvironment,
        async () => {
            const media = (await askAnilist(clientFor(environment as CoreEnvironment), ENTRY_MEDIA, { id })).Media
            if (!isRecord(media)) throw new CoreError("anime not found", 404)
            return withoutEmpty(media) as Json
        },
        answer => keepAnswer(database, question, answer, environment.now()),
        async () => (await storedAnswer(database, question)) as Json | null,
    )
}

/** How many main episodes are out (rule above) */
export function episodesOut(media: Json, metadata: Json | null, now: number): number {
    const total = whole(media.episodes)
    if (media.status === "NOT_YET_RELEASED") return 0
    const next = isRecord(media.nextAiringEpisode) ? whole(media.nextAiringEpisode.episode) : 0
    if (next > 0) return next - 1
    if (media.status === "RELEASING" && isRecord(metadata?.episodes)) {
        const today = new Date(now).toISOString().slice(0, 10)
        const aired = Object.entries(metadata.episodes).filter(([key, episode]) => /^\d+$/.test(key) && isRecord(episode)
            && typeof episode.airDate === "string" && episode.airDate !== "" && episode.airDate <= today).length
        if (aired > 0) return total > 0 ? Math.min(total, aired) : aired
    }
    return total || whole(metadata?.episodeCount)
}

/** The numbers of the episodes saved on the device and ready to watch */
async function savedEpisodes(database: CoreDatabase, id: number): Promise<Set<number>> {
    const rows = await inOrder(database, () => database.select({ item: offlineItems.item }).from(offlineItems)
        .where(and(eq(offlineItems.mediaId, id), eq(offlineItems.status, "ready"))))
    return new Set(rows.map(row => Number(row.item.episode)).filter(Number.isInteger))
}

type Built = { media: Json, metadata: Json | null, episodes: Json[], out: number }

/** The anime and its main episodes as the core builds them (also for the online streams, streams/onlinestream.ts) */
export async function animeWithEpisodes(environment: Environment, id: number): Promise<Built> {
    const database = await environment.database()
    const [media, metadata] = await Promise.all([mediaOf(environment, database, id), animeMetadata(environment, id)])
    const out = episodesOut(media, metadata, environment.now())
    const saved = await savedEpisodes(database, id)
    const metaEpisodes = isRecord(metadata?.episodes) ? metadata.episodes : {}
    const first = metaEpisodes["1"]
    const offset = isRecord(first) ? Math.max(0, whole(first.absoluteEpisodeNumber) - 1) : 0
    const episodes: Json[] = []
    for (let number = 1; number <= out; number++) {
        // a long-running anime has a thousand episodes and more: the thread of the screens gets its turn between them
        if (number % 250 === 0) await environment.pause("library episodes")
        const meta = metaEpisodes[String(number)]
        const episodeMetadata = isRecord(meta) ? {
            anidbId: meta.anidbId, image: meta.image, airDate: meta.airDate, length: meta.length,
            summary: meta.summary, overview: meta.overview, hasImage: meta.hasImage, title: meta.title,
        } : { hasImage: false }
        episodes.push({
            type: "main",
            displayTitle: `Episode ${number}`,
            episodeTitle: isRecord(meta) && typeof meta.title === "string" ? meta.title : "",
            episodeNumber: number,
            aniDBEpisode: String(number),
            absoluteEpisodeNumber: number + offset,
            progressNumber: number,
            localFile: null,
            isDownloaded: saved.has(number),
            episodeMetadata,
            fileMetadata: { episode: number, aniDBEpisode: String(number), type: "main" },
            isInvalid: false,
            baseAnime: media,
            _isNakamaEpisode: false,
        })
    }
    return { media, metadata, episodes, out }
}

/** GET /api/v1/anime/episode-collection/{id} */
export async function episodeCollection(request: CoreRequest, environment: Environment): Promise<Json> {
    const { metadata, episodes } = await animeWithEpisodes(environment, mediaIdOf(request))
    return metadata ? { hasMappingError: false, episodes, metadata } : { hasMappingError: true, episodes }
}

/** GET /api/v1/library/anime-entry/{id} */
export async function libraryEntry(request: CoreRequest, environment: Environment): Promise<Json> {
    const id = mediaIdOf(request)
    const { media, metadata, episodes, out } = await animeWithEpisodes(environment, id)
    const entry = await storedEntry(await environment.database(), "ANIME", id)
    const listData = entry ? listDataOf(entry) : undefined
    const progress = whole(listData?.progress)
    const rewatch = listData?.status === "COMPLETED" || listData?.status === "REPEATING"
    const files = await filesOf(await environment.database(), id)
    const owned = new Set(files.filter(file => file.type === "main").map(file => file.episode))
    const toWatch = episodes.filter(episode => (rewatch || (episode.episodeNumber as number) > progress) && !owned.has(episode.episodeNumber as number))
    const ownEpisodes = files.map(file => episodeOfFile(file, media, episodes))
    const next = ownEpisodes.find(episode => episode.type === "main" && (rewatch || (episode.episodeNumber as number) > progress)) ?? null
    const canBatch = media.status === "FINISHED"
    const mappings = isRecord(metadata?.mappings) ? metadata.mappings : {}
    return {
        mediaId: id,
        media,
        ...(listData ? { listData } : {}),
        downloadInfo: {
            ...(toWatch.length > 0 ? { episodesToDownload: toWatch.map(episode => ({ episodeNumber: episode.episodeNumber, aniDBEpisode: episode.aniDBEpisode, episode })) } : {}),
            canBatch,
            batchAll: canBatch && progress === 0,
            hasInaccurateSchedule: media.status === "RELEASING" && !isRecord(media.nextAiringEpisode),
            rewatch,
            absoluteOffset: isRecord(metadata?.episodes) && isRecord(metadata.episodes["1"]) ? Math.max(0, whole(metadata.episodes["1"].absoluteEpisodeNumber) - 1) : 0,
        },
        ...(files.length ? { libraryData: libraryDataOf(files, progress) } : {}),
        episodes: ownEpisodes,
        nextEpisode: next,
        localFiles: files.map(asLocalFile),
        anidbId: whole(mappings.anidbId),
        currentEpisodeCount: out,
        _isNakamaEntry: false,
    }
}
