// geschrieben nach: Seanime_Jellyfin_Plan.md §2, §3, §5 Punkt 2 und §6 und dem Nakama-Muster aus core/nakama/guest.ts (withHostLibrary, withHostFiles); kein Server-Quelltext

import { and, eq } from "drizzle-orm"
import { listDataOf } from "../anilist/changes"
import { storedEntry } from "../anilist/store"
import { inOrder } from "../database/database"
import { anilistListEntries, anilistMedia, mediaserverMappings, mediaserverSeries, settingsSections } from "../database/schema"
import { CoreError } from "../errors"
import { animeWithEpisodes, episodesOut } from "../library/library"
import { type LocalFileRow, episodeOfFile, libraryDataOf } from "../library/local-files"
import { animeMetadata } from "../library/metadata"
import type { CoreEnvironment } from "../registry"
import { type JellyfinSeries, type JellyfinSession, listEpisodes, listSeasons, listSeries } from "./client"
import { type AnilistTitle, type EpisodeMatch, type MatchRule, type ServerShow, matchLibrary } from "./match"

/*
 * The media server as a source of the library. Own rules:
 *
 * - One server at a time. Its address, user id, device id and the switch "progress to the server" are an own section
 *   of the settings table (`mediaserver`, like the app's switches in settings/incognito.ts; not part of the status).
 *   The token lives only in the device's safe store (`MEDIASERVER_TOKEN_SECRET`), the password is never kept.
 * - The server's series with their seasons and episodes are kept in `mediaserver_series` and read again after
 *   `SERIES_FRESH_MS`. A server that cannot be asked leaves library and anime page exactly as they were.
 * - Order of sources: own files, then Nakama, then the media server. A title that already has an entry is not touched.
 * - Only titles of the user's AniList lists are matched for the library; any other title is matched when its page opens.
 * - A row of `mediaserver_mappings` (a series or a season given to a title by hand, media id 0 = to no title) beats
 *   the automatic match: its title is not matched automatically and its episodes are no one else's.
 * - An uncertain match (rule S4) is not shown; `unassignedServerShows` lists it with the title it would have been.
 * - A server episode is a file row with the path `mediaserver://<server>/<episode>`: never an address, never a token.
 */

type Json = Record<string, unknown>
type Environment = Pick<CoreEnvironment, "fetch" | "secret" | "database" | "now" | "pause"> & Partial<Pick<CoreEnvironment, "keepSecret">>

export const MEDIASERVER_TOKEN_SECRET = "seanime-mediaserver-token"
export const MEDIASERVER_SECTION = "mediaserver"
export const SERIES_FRESH_MS = 6 * 60 * 60 * 1000
const PAGE = 200
const FILE_SCHEME = "mediaserver://"

const TEXT_FIELDS = ["serverId", "url", "userId", "username", "device", "deviceId", "version"] as const

/** The media server's settings without its token */
export interface ServerSettings {
    serverId: string
    url: string
    userId: string
    username: string
    device: string
    deviceId: string
    version: string
    /** Whether the progress also goes to the server (the reports themselves are not built yet) */
    sendProgress: boolean
}

export type ServerMatchRule = MatchRule | "manual"

export interface ServerMatch {
    anilistId: number
    serverId: string
    seriesId: string
    rule: ServerMatchRule
    certain: boolean
    episodes: EpisodeMatch[]
}

/** A series of the server that is not in the library, with the uncertain match it has, if any */
export interface UnassignedShow {
    serverId: string
    seriesId: string
    name: string
    year: number
    type: string
    suggestion: { anilistId: number, rule: ServerMatchRule, episodes: number } | null
}

const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value)
const whole = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0)
const text = (value: unknown) => (typeof value === "string" ? value : "")

/* ── Settings and token ───────────────────────────────────────────────── */

export async function serverSettingsOf(environment: Pick<Environment, "database">): Promise<ServerSettings> {
    const database = await environment.database()
    const [row] = await inOrder(database, () => database.select().from(settingsSections).where(eq(settingsSections.section, MEDIASERVER_SECTION)))
    const content: Json = row?.content ?? {}
    return {
        serverId: text(content.serverId), url: text(content.url), userId: text(content.userId), username: text(content.username),
        device: text(content.device), deviceId: text(content.deviceId), version: text(content.version),
        sendProgress: content.sendProgress === true,
    }
}

/**
 * Saves the given fields of the media server's settings. `token` goes to the safe store and nowhere else (an empty one
 * or null signs out); anything unknown, a password too, is dropped. Another server or user empties the kept series.
 */
export async function saveServerSettings(input: unknown, environment: Environment): Promise<ServerSettings> {
    if (!isRecord(input)) throw new CoreError("the media server settings must be an object")
    const before = await serverSettingsOf(environment)
    const next = { ...before }
    for (const name of TEXT_FIELDS) {
        if (!(name in input)) continue
        const value = input[name]
        if (typeof value !== "string") throw new CoreError(`mediaserver.${name} must be a text`)
        next[name] = name === "url" ? value.trim().replace(/\/+$/, "") : value
    }
    if ("sendProgress" in input) next.sendProgress = input.sendProgress === true
    const signedOut = "token" in input && !text(input.token)
    if ("token" in input) {
        if (!environment.keepSecret) throw new CoreError("this device cannot keep the media server's token safely")
        await environment.keepSecret(MEDIASERVER_TOKEN_SECRET, text(input.token) || null)
    }
    const database = await environment.database()
    const content: Record<string, string | boolean> = { ...next }
    const changedAt = environment.now()
    const other = signedOut || next.serverId !== before.serverId || next.url !== before.url || next.userId !== before.userId
    await inOrder(database, () => database.transaction(async transaction => {
        await transaction.insert(settingsSections).values({ section: MEDIASERVER_SECTION, content, changedAt })
            .onConflictDoUpdate({ target: settingsSections.section, set: { content, changedAt } })
        if (other) await transaction.delete(mediaserverSeries)
    }))
    forgetServerSource()
    return next
}

/**
 * A save of the settings that carries `mediaserver`: that part is saved here (the token to the safe store) and taken
 * out, so that the token never reaches the settings table.
 */
export async function keepServerToken(body: unknown, environment: Environment): Promise<unknown> {
    if (!isRecord(body) || !isRecord(body.mediaserver)) return body
    await saveServerSettings(body.mediaserver, environment)
    const { mediaserver: _taken, ...rest } = body
    return rest
}

/** The signed-in server, or null when address, user or token is missing */
export async function serverSession(environment: Environment): Promise<JellyfinSession | null> {
    const settings = await serverSettingsOf(environment)
    if (!settings.url || !settings.userId) return null
    const token = await environment.secret(MEDIASERVER_TOKEN_SECRET)
    if (!token) return null
    return {
        serverId: settings.serverId, url: settings.url, userId: settings.userId, token,
        identity: { device: settings.device || "Android", deviceId: settings.deviceId, version: settings.version || "0" },
    }
}

/* ── The server's series ──────────────────────────────────────────────── */

/** A movie as a series of one season with one episode, so that the rules for series fit it */
function movieShow(series: JellyfinSeries): ServerShow {
    return { series, seasons: [], episodes: [{ id: series.id, seriesId: series.id, seasonId: "", season: 1, index: 1, name: series.name, providerIds: {}, mediaSources: [] }] }
}

/** Reads every series of the server with its seasons and episodes and keeps them in place of the ones kept before */
export async function refreshServerShows(environment: Environment, session: JellyfinSession): Promise<ServerShow[]> {
    const all: JellyfinSeries[] = []
    for (let start = 0; ; start += PAGE) {
        const page = await listSeries(environment.fetch, session, start, PAGE)
        all.push(...page.items)
        if (page.items.length === 0 || start + page.items.length >= page.total) break
        await environment.pause("mediaserver series")
    }
    const shows: ServerShow[] = []
    for (const series of all) {
        if (!series.id) continue
        if (series.type === "Movie") {
            shows.push(movieShow(series))
            continue
        }
        await environment.pause("mediaserver series")
        const [seasons, episodes] = await Promise.all([listSeasons(environment.fetch, session, series.id), listEpisodes(environment.fetch, session, series.id)])
        shows.push({ series, seasons, episodes })
    }
    const database = await environment.database()
    const fetchedAt = environment.now()
    await inOrder(database, () => database.transaction(async transaction => {
        await transaction.delete(mediaserverSeries)
        for (const show of shows) await transaction.insert(mediaserverSeries).values({ serverId: session.serverId, seriesId: show.series.id, content: show, fetchedAt })
    }))
    forgetServerSource()
    return shows
}

/** The kept series while they are fresh, else read again from the server (which may fail: `JellyfinFailure`) */
async function serverShows(environment: Environment, session: JellyfinSession): Promise<{ shows: ServerShow[], fetchedAt: number }> {
    const database = await environment.database()
    const rows = await inOrder(database, () => database.select().from(mediaserverSeries).where(eq(mediaserverSeries.serverId, session.serverId)))
    const fetchedAt = rows.length ? Math.min(...rows.map(row => row.fetchedAt)) : 0
    if (rows.length && environment.now() - fetchedAt < SERIES_FRESH_MS) return { shows: rows.map(row => row.content), fetchedAt }
    return { shows: await refreshServerShows(environment, session), fetchedAt: environment.now() }
}

/* ── Matching ─────────────────────────────────────────────────────────── */

type MappingRow = typeof mediaserverMappings.$inferSelect

/** A title of AniList as matching needs it */
function titleOf(media: Json, metadata: Json | null, now: number): AnilistTitle {
    const names = isRecord(media.title) ? [media.title.romaji, media.title.english, media.title.native, media.title.userPreferred] : []
    const synonyms = Array.isArray(media.synonyms) ? media.synonyms : []
    const titles = [...new Set([...names, ...synonyms].filter((name): name is string => typeof name === "string" && name !== ""))]
    const year = whole(isRecord(media.startDate) ? media.startDate.year : 0) || whole(media.seasonYear)
    return { id: whole(media.id), titles, year, aired: episodesOut(media, metadata, now), metadata }
}

async function metadataFor(environment: Environment, id: number): Promise<Json | null> {
    try {
        return await animeMetadata(environment, id)
    }
    catch {
        return null
    }
}

/** The server episodes a hand-made row gives: a season by its numbers, a series counted through its regular seasons */
function manualPairs(show: ServerShow, row: MappingRow): EpisodeMatch[] {
    const season = show.seasons.find(item => item.id === row.itemId)
    const episodes = show.episodes
        .filter(episode => episode.index !== null && (season ? episode.seasonId === season.id || (season.index !== null && episode.season === season.index) : episode.season !== 0))
        .sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.index ?? 0) - (b.index ?? 0))
    const counted = !season && new Set(episodes.map(episode => episode.season)).size > 1
    return episodes
        .map((episode, at) => ({ episode: (counted ? at + 1 : episode.index ?? 0) - row.episodeOffset, serverEpisodeId: episode.id }))
        .filter(pair => pair.episode >= 1)
}

/** Hand-made rows first, then the automatic rules over what they left (rule above) */
function allMatches(titles: AnilistTitle[], shows: ServerShow[], mappings: MappingRow[]): ServerMatch[] {
    const manual = new Map<number, ServerMatch>()
    const taken = new Set<string>()
    for (const row of mappings) {
        const show = shows.find(item => item.series.id === row.itemId || item.seasons.some(season => season.id === row.itemId))
        if (!show) continue
        const pairs = manualPairs(show, row).filter(pair => !taken.has(pair.serverEpisodeId))
        for (const pair of pairs) taken.add(pair.serverEpisodeId)
        if (row.mediaId <= 0) continue
        const match = manual.get(row.mediaId)
            ?? { anilistId: row.mediaId, serverId: show.series.serverId, seriesId: show.series.id, rule: "manual" as const, certain: true, episodes: [] }
        const known = new Set(match.episodes.map(pair => pair.episode))
        match.episodes.push(...pairs.filter(pair => !known.has(pair.episode)))
        manual.set(row.mediaId, match)
    }
    const free = shows
        .map(show => ({ ...show, episodes: show.episodes.filter(episode => !taken.has(episode.id)) }))
        .filter(show => show.episodes.length > 0)
    const automatic = matchLibrary(titles.filter(title => !manual.has(title.id)), free)
    return [...[...manual.values()].filter(match => match.episodes.length > 0), ...automatic]
}

type Listed = { media: Json, status: string }
type LibraryState = { shows: ServerShow[], mappings: MappingRow[], titles: AnilistTitle[], listed: Map<number, Listed>, matches: ServerMatch[] }

let remembered: { key: string, state: LibraryState } | null = null

/** Forgets what was matched (a test, new settings, a new row made by hand) */
export function forgetServerSource(): void {
    remembered = null
}

/** The series, the user's list titles and what belongs together; remembered until one of them changes */
async function libraryState(environment: Environment, session: JellyfinSession): Promise<LibraryState> {
    const { shows, fetchedAt } = await serverShows(environment, session)
    await environment.pause("mediaserver library")
    const database = await environment.database()
    const mappings = await inOrder(database, () => database.select().from(mediaserverMappings).where(eq(mediaserverMappings.serverId, session.serverId)))
    const rows = await inOrder(database, () => database.select({ entry: anilistListEntries.content, media: anilistMedia.content })
        .from(anilistListEntries).innerJoin(anilistMedia, eq(anilistListEntries.media, anilistMedia.id)).where(eq(anilistListEntries.kind, "ANIME")))
    const listed = new Map<number, Listed>()
    for (const row of rows) if (row.media && whole(row.media.id)) listed.set(whole(row.media.id), { media: row.media, status: text(row.entry.status) })
    const key = [session.serverId, fetchedAt, Math.floor(environment.now() / SERIES_FRESH_MS), mappings.map(row => `${row.itemId}:${row.changedAt}`).join(","), [...listed.keys()].join(",")].join("|")
    if (remembered?.key === key) return remembered.state
    const titles: AnilistTitle[] = []
    for (const [id, item] of listed) {
        await environment.pause("mediaserver library")
        titles.push(titleOf(item.media, await metadataFor(environment, id), environment.now()))
    }
    const state = { shows, mappings, titles, listed, matches: allMatches(titles, shows, mappings) }
    remembered = { key, state }
    return state
}

/* ── Library and anime page ───────────────────────────────────────────── */

/** The path a server episode has as a file of the library */
export function serverFilePath(serverId: string, episodeId: string): string {
    return `${FILE_SCHEME}${encodeURIComponent(serverId)}/${encodeURIComponent(episodeId)}`
}

/** Server and episode of such a path, or null for any other path */
export function serverFileOfPath(path: string): { serverId: string, episodeId: string } | null {
    if (!path.startsWith(FILE_SCHEME)) return null
    const [serverId, episodeId, ...more] = path.slice(FILE_SCHEME.length).split("/")
    if (!episodeId || more.length > 0) return null
    return { serverId: decodeURIComponent(serverId), episodeId: decodeURIComponent(episodeId) }
}

function serverRows(match: ServerMatch, shows: ServerShow[], now: number): LocalFileRow[] {
    const show = shows.find(item => item.series.id === match.seriesId)
    const names = new Map((show?.episodes ?? []).map(episode => [episode.id, episode.name]))
    return match.episodes.map(pair => ({
        path: serverFilePath(match.serverId, pair.serverEpisodeId),
        name: names.get(pair.serverEpisodeId) || `Episode ${pair.episode}`,
        mediaId: match.anilistId, episode: pair.episode, anidbEpisode: String(pair.episode), type: "main",
        locked: true, ignored: false, size: 0, parsed: {}, folders: [], changedAt: now,
    } as LocalFileRow))
}

function serverData(match: ServerMatch, rows: LocalFileRow[], progress: number): Json {
    return { serverId: match.serverId, seriesId: match.seriesId, unwatchedCount: rows.filter(row => row.episode > progress).length, mainFileCount: rows.length }
}

/**
 * GET /api/v1/library/collection with the media server's titles: the titles of the user's lists that the server has
 * for certain and that neither the device nor a Nakama host has join their list (`libraryData` and
 * `mediaServerLibraryData`). A server that is not set up or does not answer leaves the collection as it is.
 */
export async function withServerLibrary(collection: unknown, environment: Environment): Promise<unknown> {
    if (!isRecord(collection) || !Array.isArray(collection.lists)) return collection
    let state: LibraryState
    try {
        await environment.pause("mediaserver library")
        const session = await serverSession(environment)
        if (!session) return collection
        state = await libraryState(environment, session)
    }
    catch {
        return collection
    }
    const lists = (collection.lists as unknown[]).filter(isRecord).map((list): Json & { entries: unknown[] } => ({ ...list, entries: Array.isArray(list.entries) ? [...list.entries] : [] }))
    const own = new Set(lists.flatMap(list => list.entries.filter(isRecord).map(entry => entry.mediaId)))
    const database = await environment.database()
    let added = false
    for (const match of state.matches) {
        const item = state.listed.get(match.anilistId)
        if (!match.certain || !item || own.has(match.anilistId)) continue
        own.add(match.anilistId)
        await environment.pause("mediaserver library")
        const entry = await storedEntry(database, "ANIME", match.anilistId)
        const listData = entry ? listDataOf(entry) : undefined
        const status = text(listData?.status) || item.status || "CURRENT"
        const place = status === "REPEATING" ? "CURRENT" : status
        let target = lists.find(candidate => candidate.status === place)
        if (!target) {
            target = { type: place, status: place, entries: [] }
            lists.push(target)
        }
        const rows = serverRows(match, state.shows, environment.now())
        const progress = whole(listData?.progress)
        target.entries.push({
            media: item.media, mediaId: match.anilistId, libraryData: libraryDataOf(rows, progress),
            mediaServerLibraryData: serverData(match, rows, progress), ...(listData ? { listData } : {}),
        })
        added = true
    }
    return added ? { ...collection, lists } : collection
}

/**
 * GET /api/v1/library/anime-entry/{id}: an anime that neither the device nor a Nakama host has files of and that the
 * server has for certain becomes the server's (`_isMediaServerEntry`, its episodes with `_isMediaServerEpisode`).
 */
export async function withServerFiles(entry: unknown, environment: Environment): Promise<unknown> {
    if (!isRecord(entry) || entry.libraryData || entry._isNakamaEntry || !whole(entry.mediaId)) return entry
    const id = whole(entry.mediaId)
    let match: ServerMatch | undefined
    let shows: ServerShow[]
    try {
        await environment.pause("mediaserver library")
        const session = await serverSession(environment)
        if (!session) return entry
        const state = await libraryState(environment, session)
        shows = state.shows
        match = state.matches.find(candidate => candidate.anilistId === id)
        if (!match && !state.listed.has(id) && isRecord(entry.media)) {
            // a title outside the lists is matched now, with the lists' titles, so that no episode gets two titles
            const title = titleOf({ ...entry.media, id }, await metadataFor(environment, id), environment.now())
            match = allMatches([...state.titles, title], shows, state.mappings).find(candidate => candidate.anilistId === id)
        }
    }
    catch {
        return entry
    }
    if (!match?.certain || match.episodes.length === 0) return entry
    const rows = serverRows(match, shows, environment.now())
    const { media, episodes } = await animeWithEpisodes(environment, id)
    const progress = whole(isRecord(entry.listData) ? entry.listData.progress : 0)
    const rewatch = isRecord(entry.listData) && (entry.listData.status === "COMPLETED" || entry.listData.status === "REPEATING")
    const serverEpisodes = rows.map((row, at): Json => ({
        ...episodeOfFile(row, media, episodes),
        _isMediaServerEpisode: true,
        mediaServerEpisode: { serverId: match.serverId, seriesId: match.seriesId, episodeId: match.episodes[at].serverEpisodeId },
    }))
    return {
        ...entry,
        libraryData: libraryDataOf(rows, progress),
        mediaServerLibraryData: serverData(match, rows, progress),
        episodes: serverEpisodes,
        nextEpisode: serverEpisodes.find(episode => episode.type === "main" && (rewatch || (episode.episodeNumber as number) > progress)) ?? null,
        localFiles: serverEpisodes.map(episode => episode.localFile),
        _isMediaServerEntry: true,
    }
}

/* ── Not assigned, and assigning by hand ──────────────────────────────── */

/** The server's series that are not in the library: without a match, or with an uncertain one (named as suggestion) */
export async function unassignedServerShows(environment: Environment): Promise<UnassignedShow[]> {
    const session = await serverSession(environment)
    if (!session) return []
    const state = await libraryState(environment, session)
    const assigned = new Set(state.matches.filter(match => match.certain).map(match => match.seriesId))
    return state.shows.filter(show => !assigned.has(show.series.id)).map(show => {
        const guess = state.matches.find(match => !match.certain && match.seriesId === show.series.id)
        return {
            serverId: show.series.serverId, seriesId: show.series.id, name: show.series.name, year: show.series.year, type: show.series.type,
            suggestion: guess ? { anilistId: guess.anilistId, rule: guess.rule, episodes: guess.episodes.length } : null,
        }
    })
}

/** Gives a series or a season of the server to a title by hand (`mediaId` 0: to no title) */
export async function saveServerMapping(input: unknown, environment: Environment): Promise<void> {
    const body = isRecord(input) ? input : {}
    const itemId = text(body.itemId)
    const mediaId = typeof body.mediaId === "number" && Number.isInteger(body.mediaId) && body.mediaId >= 0 ? body.mediaId : -1
    const episodeOffset = typeof body.episodeOffset === "number" && Number.isInteger(body.episodeOffset) ? body.episodeOffset : 0
    if (!itemId || mediaId < 0) throw new CoreError("itemId and mediaId are needed", 400)
    const { serverId } = await serverSettingsOf(environment)
    const database = await environment.database()
    const changedAt = environment.now()
    await inOrder(database, () => database.insert(mediaserverMappings).values({ serverId, itemId, mediaId, episodeOffset, origin: "manual", changedAt })
        .onConflictDoUpdate({ target: [mediaserverMappings.serverId, mediaserverMappings.itemId], set: { mediaId, episodeOffset, origin: "manual", changedAt } }))
    forgetServerSource()
}

/** Takes a hand-made row back: the automatic match counts again */
export async function removeServerMapping(itemId: string, environment: Environment): Promise<void> {
    const { serverId } = await serverSettingsOf(environment)
    const database = await environment.database()
    await inOrder(database, () => database.delete(mediaserverMappings).where(and(eq(mediaserverMappings.serverId, serverId), eq(mediaserverMappings.itemId, itemId))))
    forgetServerSource()
}
