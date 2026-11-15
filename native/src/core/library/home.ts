// geschrieben nach: Aufzeichnung api vom 13.11.2026 (ANIME_COLLECTION.GetLibraryCollection, ANIME_ENTRIES.GetUpcomingEpisodes, ANIME_COLLECTION.GetAnimeCollectionSchedule: Felder und Arten der Antworten), den App-Typen Anime_LibraryCollection/Anime_StreamCollection/Anime_UpcomingEpisodes/Anime_ScheduleItem (src/api/generated/types.ts), der öffentlichen AniList-Doku (Media.airingSchedule, MediaSeason) und docs/EIGENER-KERN.md §4p; kein Server-Quelltext

import { animeCollection, readThrough } from "../anilist/anilist"
import { askAnilist, clientFor } from "../anilist/client"
import { AIRING_SCHEDULES } from "../anilist/queries"
import { type ListCollection, keepAnswer, storedAnswer, storedCollection } from "../anilist/store"
import { inOrder } from "../database/database"
import { watchPositions } from "../database/schema"
import type { CoreEnvironment, CoreRequest } from "../registry"
import { animeWithEpisodes } from "./library"
import { animeMetadata } from "./metadata"
import { type LocalFileRow, allFiles, asLocalFile, episodeOfFile, libraryDataOf } from "./local-files"
import { listDataOf } from "../anilist/changes"

/*
 * The home screen's data from the core's own store (area `library`, phase 5a-3, docs/EIGENER-KERN.md §4p): the user's
 * lists as AniList last gave them (`anilist_list_entries`), the watch history (`watch_positions`), the episodes saved on
 * the device and the episode metadata of the public service (library.ts, metadata.ts). Own rules:
 *
 * - Library collection: the core has no folders of the user's own files yet (stage 5b), so its lists hold no entries
 *   and its counts are 0. What the home screen shows comes from `stream`: the anime being watched or rewatched
 *   (`CURRENT`, `REPEATING`), the last watched first (watch history), then the last changed (list entry); for each the
 *   next episode after the progress, when it is out (library.ts `episodesOut`). After them the anime with a watch
 *   position that are on none of the lists (played online), the last watched first: the episode left unfinished, else
 *   the next one that is out (`resumeEpisodeNumber`); they stay out of `stream.anime`, which are the lists' anime.
 * - Upcoming episodes: every anime of the lists but the dropped ones with a next episode to air that has not aired yet,
 *   the soonest first, with that episode's metadata.
 * - Schedule: the anime of the lists but the dropped ones that air or will air, or that belong to the previous, the
 *   current or the next season (AniList's seasons: winter = December to February), every episode AniList has a time
 *   for (at most 50 per anime), sorted by time. Kept in `anilist_answers`, given from there when AniList fails.
 */

type Json = Record<string, unknown>
type Environment = Pick<CoreEnvironment, "fetch" | "secret" | "database" | "now" | "pause" | "mark">

const LIST_ORDER = ["COMPLETED", "DROPPED", "PLANNING", "PAUSED", "CURRENT"] as const

function isRecord(value: unknown): value is Json {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

const whole = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0)

type ListEntry = { entry: Json, media: Json, status: string }

/** Every entry of the kept anime lists with its title; nothing kept yet: AniList is asked once (anilist.ts) */
export async function listEntries(environment: Environment): Promise<ListEntry[]> {
    environment.mark?.("library: database")
    const database = await environment.database()
    // the first call after switching on held the thread 16.6 ms before its first statement (8-ms round 2, §4r): a pause
    // lets it go here once the piece is long, the reading of the kept lists starts in a piece of its own
    await environment.pause("library: kept lists")
    environment.mark?.("library: kept lists")
    let collection: ListCollection | null = await storedCollection(database, "ANIME")
    environment.mark?.("library: entries")
    if (!collection) {
        collection = await animeCollection({ path: {}, query: null, body: null }, environment as CoreEnvironment)
    }
    const entries: ListEntry[] = []
    const seen = new Set<number>()
    for (const list of collection.MediaListCollection.lists) {
        if (list.isCustomList === true) continue
        for (const entry of list.entries ?? []) {
            const media = entry.media
            if (!isRecord(media) || !whole(media.id) || seen.has(media.id as number)) continue
            seen.add(media.id as number)
            entries.push({ entry, media, status: String(entry.status ?? list.status ?? "") })
        }
    }
    return entries
}

/** A date of a list entry as the stream's list data carries it (recorded: "2026-11-01T00:00:00Z") */
function dayText(value: unknown): string | undefined {
    if (!isRecord(value) || !whole(value.year)) return undefined
    const two = (part: unknown) => String(whole(part) || 1).padStart(2, "0")
    return `${String(value.year).padStart(4, "0")}-${two(value.month)}-${two(value.day)}T00:00:00Z`
}

/** The list data of the stream part (recorded fields; no field for 0 or for no date) */
function streamListData(entry: Json): Json {
    return JSON.parse(JSON.stringify({
        progress: entry.progress || undefined,
        score: entry.score || undefined,
        status: entry.status,
        startedAt: dayText(entry.startedAt),
        completedAt: dayText(entry.completedAt),
    })) as Json
}

/** The player counts an episode as watched at 80 % (playback.ts, `video-completed`) */
const WATCHED_SHARE = 0.8

/**
 * The episode to resume of an anime watched outside the lists: the one of the watch position while it is unfinished,
 * else the one after it (no duration known: unfinished).
 */
export function resumeEpisodeNumber(row: { episodeNumber: number, positionSeconds: number, durationSeconds: number }): number {
    const done = row.durationSeconds > 0 && row.positionSeconds >= row.durationSeconds * WATCHED_SHARE
    return done ? row.episodeNumber + 1 : row.episodeNumber
}

/** GET /api/v1/library/collection, built by the core (rules above) */
export async function ownLibraryCollection(environment: Environment): Promise<Json> {
    const entries = await listEntries(environment)
    await environment.pause("library: watched")
    environment.mark?.("library: watched")
    const database = await environment.database()
    const positions = await inOrder(database, () => database.select().from(watchPositions))
    const watched = new Map(positions.map(row => [row.mediaId, row.changedAt]))
    const watching = entries.filter(item => item.status === "CURRENT" || item.status === "REPEATING")
        .sort((a, b) => (watched.get(b.media.id as number) ?? 0) - (watched.get(a.media.id as number) ?? 0)
            || whole(b.entry.updatedAt) - whole(a.entry.updatedAt))
    const own = await ownFilesPart(environment, entries)
    // the app shows both parts in one row: an anime whose next episode is on the device is there once, with that file
    const onDevice = new Set((own.continueWatchingList as Json[]).map(episode => (episode.baseAnime as Json | undefined)?.id))
    const continueWatching: Json[] = []
    for (const item of watching) {
        if (onDevice.has(item.media.id)) continue
        await environment.pause("home next episodes")
        const progress = whole(item.entry.progress)
        const { episodes, out } = await animeWithEpisodes(environment, item.media.id as number)
        if (progress + 1 > out) continue
        const next = episodes[progress]
        if (next) continueWatching.push({ ...next, fileMetadata: null, baseAnime: item.media })
    }
    // anime watched without being on the lists (played online): the episode left unfinished, else the next one that is out
    const listed = new Set(entries.map(item => item.media.id as number))
    const now = environment.now()
    const unlisted = positions.filter(row => !listed.has(row.mediaId) && !onDevice.has(row.mediaId) && (row.expiresAt === null || row.expiresAt > now))
        .sort((a, b) => b.changedAt - a.changedAt)
    for (const row of unlisted) {
        await environment.pause("home watched outside the lists")
        const number = resumeEpisodeNumber(row)
        let built: Awaited<ReturnType<typeof animeWithEpisodes>>
        try {
            built = await animeWithEpisodes(environment, row.mediaId)
        } catch {
            continue // AniList away and the anime never kept: it shows once it can be read
        }
        const next = number <= built.out ? built.episodes[number - 1] : undefined
        if (next) continueWatching.push({ ...next, fileMetadata: null })
    }
    return {
        ...own,
        stream: {
            continueWatchingList: continueWatching,
            anime: watching.map(item => item.media),
            listData: Object.fromEntries(watching.map(item => [String(item.media.id), streamListData(item.entry)])),
        },
    }
}

/**
 * POST /api/v1/anilist/collection ("Refresh AniList"): the lists read again from AniList.
 */
export async function refreshAnimeCollection(request: CoreRequest, environment: CoreEnvironment): Promise<unknown> {
    const lists = await animeCollection(request, environment)
    return lists
}

/** GET /api/v1/library/upcoming-episodes (rules above) */
export async function upcomingEpisodes(_request: unknown, environment: Environment): Promise<Json> {
    const nowSeconds = Math.floor(environment.now() / 1000)
    const airing = (await listEntries(environment))
        .filter(item => item.status !== "DROPPED" && isRecord(item.media.nextAiringEpisode)
            && whole((item.media.nextAiringEpisode as Json).airingAt) > nowSeconds)
        .sort((a, b) => whole((a.media.nextAiringEpisode as Json).airingAt) - whole((b.media.nextAiringEpisode as Json).airingAt))
    const episodes = await Promise.all(airing.map(async item => {
        const next = item.media.nextAiringEpisode as Json
        const episodeNumber = whole(next.episode)
        const airingAt = whole(next.airingAt)
        const metadata = await animeMetadata(environment, item.media.id as number)
        const meta = isRecord(metadata?.episodes) ? metadata.episodes[String(episodeNumber)] : undefined
        // an episode not yet aired often has no picture: the anime's banner, else its cover (as the server answered on the device)
        const cover = isRecord(item.media.coverImage) ? item.media.coverImage.extraLarge : undefined
        const episodeMetadata = isRecord(meta) ? JSON.parse(JSON.stringify({
            anidbId: meta.anidbId, image: meta.image || item.media.bannerImage || cover, airDate: meta.airDate, length: meta.length, overview: meta.overview, title: meta.title,
        })) as Json : undefined
        return {
            mediaId: item.media.id,
            episodeNumber,
            airingAt,
            timeUntilAiring: airingAt - nowSeconds,
            baseAnime: { ...item.media, nextAiringEpisode: { ...next, timeUntilAiring: airingAt - nowSeconds } },
            ...(episodeMetadata ? { episodeMetadata } : {}),
        }
    }))
    return { episodes }
}

const SEASONS = ["WINTER", "SPRING", "SUMMER", "FALL"] as const

/** The previous, the current and the next season as "SEASON YEAR" (AniList: winter is December to February) */
export function seasonsAround(now: number): Set<string> {
    const date = new Date(now)
    const month = date.getUTCMonth()
    // December belongs to the winter of the next year
    let index = Math.floor(((month + 1) % 12) / 3)
    let year = date.getUTCFullYear() + (month === 11 ? 1 : 0)
    const names = new Set<string>()
    let previousIndex = index - 1
    let previousYear = year
    if (previousIndex < 0) {
        previousIndex = 3
        previousYear--
    }
    names.add(`${SEASONS[previousIndex]} ${previousYear}`)
    names.add(`${SEASONS[index]} ${year}`)
    index++
    if (index > 3) {
        index = 0
        year++
    }
    names.add(`${SEASONS[index]} ${year}`)
    return names
}

const SCHEDULE_QUESTION = "library-schedule"

/** GET /api/v1/library/schedule (rules above) */
export async function animeSchedule(_request: unknown, environment: Environment): Promise<Json[]> {
    const seasons = seasonsAround(environment.now())
    const chosen = (await listEntries(environment)).filter(item => item.status !== "DROPPED" && (item.media.status === "RELEASING"
        || item.media.status === "NOT_YET_RELEASED" || seasons.has(`${item.media.season} ${item.media.seasonYear}`)))
    const media = new Map(chosen.map(item => [item.media.id as number, item.media]))
    const database = await environment.database()
    const times = await readThrough<Json[]>(
        environment as CoreEnvironment,
        async () => {
            const found: Json[] = []
            const ids = [...media.keys()]
            for (let start = 0; start < ids.length; start += 50) {
                let page = 1
                for (;;) {
                    const data = await askAnilist(clientFor(environment as CoreEnvironment), AIRING_SCHEDULES, { ids: ids.slice(start, start + 50), page })
                    const pageData = isRecord(data.Page) ? data.Page : {}
                    for (const item of (Array.isArray(pageData.media) ? pageData.media : []) as Json[]) {
                        const nodes = isRecord(item.airingSchedule) && Array.isArray(item.airingSchedule.nodes) ? item.airingSchedule.nodes as Json[] : []
                        for (const node of nodes) if (whole(node.airingAt) && whole(node.episode)) found.push({ mediaId: item.id, airingAt: node.airingAt, episode: node.episode })
                    }
                    if (!(isRecord(pageData.pageInfo) && pageData.pageInfo.hasNextPage === true)) break
                    page++
                }
            }
            return found
        },
        answer => keepAnswer(database, SCHEDULE_QUESTION, answer, environment.now()),
        async () => (await storedAnswer(database, SCHEDULE_QUESTION)) as Json[] | null,
    )
    await environment.pause("schedule")
    const items: Json[] = []
    for (const time of [...times].sort((a, b) => whole(a.airingAt) - whole(b.airingAt))) {
        const anime = media.get(whole(time.mediaId))
        if (!anime) continue
        const title = isRecord(anime.title) ? anime.title : {}
        const cover = isRecord(anime.coverImage) ? anime.coverImage : {}
        const dateTime = new Date(whole(time.airingAt) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z")
        items.push({
            mediaId: anime.id,
            title: String(title.userPreferred ?? title.romaji ?? title.english ?? ""),
            time: dateTime.slice(11, 16),
            dateTime,
            image: String(cover.extraLarge ?? cover.large ?? cover.medium ?? ""),
            episodeNumber: whole(time.episode),
            isMovie: anime.format === "MOVIE",
            isSeasonFinale: whole(anime.episodes) > 0 && whole(time.episode) === whole(anime.episodes),
        })
    }
    return items
}

function sizeText(bytes: number): string {
    const units = ["B", "KB", "MB", "GB", "TB"]
    let value = bytes
    let unit = 0
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024
        unit++
    }
    return `${unit === 0 ? value : value.toFixed(2)} ${units[unit]}`
}

/**
 * The parts of the home collection that come from the user's own files (phase 5b-1, library/local-files.ts): the lists
 * with the anime that have files, the files that belong to no anime (by folder), to an anime outside the lists, or are
 * ignored, the numbers, and the next episode on the device of the anime being watched
 */
async function ownFilesPart(environment: Environment, entries: ListEntry[]): Promise<Json> {
    await environment.pause("library: own files")
    environment.mark?.("library: own files")
    const database = await environment.database()
    const files = await allFiles(database)
    const byMedia = new Map<number, LocalFileRow[]>()
    for (const file of files) if (file.mediaId > 0 && !file.ignored) byMedia.set(file.mediaId, [...(byMedia.get(file.mediaId) ?? []), file])
    const listed = new Set<number>()
    const lists = new Map<string, Json[]>(LIST_ORDER.map(status => [status, []]))
    const continueWatching: Json[] = []
    for (const item of entries) {
        const id = item.media.id as number
        const own = (byMedia.get(id) ?? []).sort((a, b) => a.episode - b.episode)
        if (own.length === 0) continue
        listed.add(id)
        const status = item.status === "REPEATING" ? "CURRENT" : item.status
        const progress = whole(item.entry.progress)
        lists.get(status)?.push({ media: item.media, mediaId: id, libraryData: libraryDataOf(own, progress), listData: listDataOf(item.entry) })
        if (status === "CURRENT") {
            const next = own.find(file => file.type === "main" && file.episode === progress + 1)
            if (next) {
                await environment.pause("home local files")
                const { episodes } = await animeWithEpisodes(environment, id)
                continueWatching.push(episodeOfFile(next, item.media, episodes))
            }
        }
    }
    const unmatched = files.filter(file => file.mediaId === 0 && !file.ignored)
    const folders = new Map<string, LocalFileRow[]>()
    for (const file of unmatched) {
        const dir = file.path.slice(0, Math.max(0, file.path.lastIndexOf("/")))
        folders.set(dir, [...(folders.get(dir) ?? []), file])
    }
    const unknown = [...byMedia].filter(([id]) => !listed.has(id))
    const formats = entries.filter(item => listed.has(item.media.id as number)).map(item => String(item.media.format ?? ""))
    return {
        continueWatchingList: continueWatching,
        lists: LIST_ORDER.map(status => ({ type: status, status, entries: lists.get(status) ?? [] })),
        unmatchedLocalFiles: unmatched.map(asLocalFile),
        unmatchedGroups: [...folders].map(([dir, group]) => ({ dir, localFiles: group.map(asLocalFile), suggestions: [] })),
        ignoredLocalFiles: files.filter(file => file.ignored).map(asLocalFile),
        unknownGroups: unknown.map(([mediaId, group]) => ({ mediaId, localFiles: group.map(asLocalFile) })),
        stats: {
            totalEntries: listed.size,
            totalFiles: files.filter(file => file.mediaId > 0 && !file.ignored).length,
            totalShows: formats.filter(format => format !== "MOVIE").length,
            totalMovies: formats.filter(format => format === "MOVIE").length,
            totalSpecials: files.filter(file => file.mediaId > 0 && !file.ignored && file.type !== "main").length,
            totalSize: sizeText(files.reduce((sum, file) => sum + file.size, 0)),
        },
    }
}
