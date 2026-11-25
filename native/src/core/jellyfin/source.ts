// geschrieben nach: Seanime_Jellyfin_Plan.md §2, §3, §5 Punkt 2 und §6 und dem Nakama-Muster aus core/nakama/guest.ts (withHostLibrary, withHostFiles); kein Server-Quelltext

import { and, eq, inArray } from "drizzle-orm"
import { listDataOf } from "../anilist/changes"
import { storedEntry } from "../anilist/store"
import { inOrder } from "../database/database"
import { anilistListEntries, anilistMedia, episodeMetadata, mediaserverMappings, mediaserverSeries, settingsSections } from "../database/schema"
import { CoreError } from "../errors"
import { emitCoreEvent } from "../events"
import { animeWithEpisodes, episodesOut } from "../library/library"
import { type LocalFileRow, episodeOfFile, libraryDataOf } from "../library/local-files"
import { animeMetadata } from "../library/metadata"
import type { CoreEnvironment, CoreRequest } from "../registry"
import { JellyfinFailure, type JellyfinSeries, type JellyfinSession, authorizationHeader, jellyfinUrl, listEpisodes, listSeasons, listSeries, providerId } from "./client"
import { type AnilistTitle, type EpisodeMatch, type MatchRule, type ServerShow, matchLibrary, matchS1 } from "./match"

/*
 * The media server as a source of the library. Own rules:
 *
 * - One server at a time. Its address, user id, device id and the switch "progress to the server" are an own section
 *   of the settings table (`mediaserver`, like the app's switches in settings/incognito.ts; not part of the status).
 *   The token lives only in the device's safe store (`MEDIASERVER_TOKEN_SECRET`), the password is never kept.
 * - The server's series with their seasons and episodes are kept in `mediaserver_series`. Library and anime page read
 *   only that and never wait for the server: a missing or old state (`SERIES_FRESH_MS`) starts one reading in the
 *   background (pattern of anilist/sequels.ts), whose result the next request shows. A failed reading keeps the old
 *   state and is tried again after `RETRY_PAUSE_MS`; "read again" from the settings (`refreshServerLibrary`) waits for
 *   it and ignores the pause. A reading asks at most `REQUESTS_AT_ONCE` things of the server at once and asks ani.zip
 *   only for titles whose match needs its numbers (rules S2, S3).
 * - Order of sources: own files, then Nakama, then the media server. A title that already has an entry is not touched.
 * - Only titles of the user's AniList lists are matched for the library; any other title is matched when its page opens.
 * - A row of `mediaserver_mappings` (a series or a season given to a title by hand, media id 0 = to no title) beats
 *   the automatic match: its title is not matched automatically and its episodes are no one else's.
 * - An uncertain match (rule S4) is not shown; `unassignedServerShows` lists it with the title it would have been.
 * - A server episode is a file row with the path `mediaserver://<server>/<episode>`: never an address, never a token.
 */

type Json = Record<string, unknown>
type Environment = Pick<CoreEnvironment, "fetch" | "secret" | "database" | "now" | "pause"> & Partial<Pick<CoreEnvironment, "keepSecret" | "unasked">>

export const MEDIASERVER_TOKEN_SECRET = "seanime-mediaserver-token"
export const MEDIASERVER_SECTION = "mediaserver"
export const SERIES_FRESH_MS = 6 * 60 * 60 * 1000
export const RETRY_PAUSE_MS = 5 * 60 * 1000
export const REQUESTS_AT_ONCE = 4
/** The numbers by which rules S2 and S3 find a series (match.ts `showByIds`) */
const ID_KEYS = ["AniDB", "Tvdb", "Tmdb"] as const
const PAGE = 200
const FILE_SCHEME = "mediaserver://"

const TEXT_FIELDS = ["serverId", "serverName", "url", "userId", "username", "device", "deviceId", "version"] as const

/** The media server's settings without its token */
export interface ServerSettings {
    serverId: string
    serverName: string
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
        serverId: text(content.serverId), serverName: text(content.serverName), url: text(content.url), userId: text(content.userId), username: text(content.username),
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
    lastTry = null
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

/** Runs `work` over the items with at most `limit` of them at once; the first failure fails all */
async function atMost<T>(limit: number, items: T[], work: (item: T) => Promise<void>): Promise<void> {
    let next = 0
    let failed = false
    const worker = async () => {
        while (!failed && next < items.length) {
            const item = items[next++]
            try {
                await work(item)
            }
            catch (error) {
                failed = true
                throw error
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

/** The anime of the user's AniList lists with their status */
async function listedTitles(environment: Environment): Promise<Map<number, Listed>> {
    const database = await environment.database()
    const rows = await inOrder(database, () => database.select({ entry: anilistListEntries.content, media: anilistMedia.content })
        .from(anilistListEntries).innerJoin(anilistMedia, eq(anilistListEntries.media, anilistMedia.id)).where(eq(anilistListEntries.kind, "ANIME")))
    const listed = new Map<number, Listed>()
    for (const row of rows) if (row.media && whole(row.media.id)) listed.set(whole(row.media.id), { media: row.media, status: text(row.entry.status) })
    return listed
}

/** The kept ani.zip answers of these titles (core/library/metadata.ts keeps them); asks nobody */
async function keptMetadata(environment: Environment, ids: number[]): Promise<Map<number, Json>> {
    const kept = new Map<number, Json>()
    const database = await environment.database()
    for (let at = 0; at < ids.length; at += 500) {
        const part = ids.slice(at, at + 500)
        const rows = await inOrder(database, () => database.select().from(episodeMetadata).where(inArray(episodeMetadata.anilistId, part)))
        for (const row of rows) kept.set(row.anilistId, row.content)
    }
    return kept
}

/**
 * Asks ani.zip (through its kept answers) for the listed titles whose match needs its numbers: only when the server
 * has a series with an AniDB, Tvdb or Tmdb number (rules S2, S3) and rule S1 does not already find every aired episode.
 */
async function metadataNeeded(environment: Environment, shows: ServerShow[]): Promise<void> {
    if (!shows.some(show => ID_KEYS.some(key => providerId(show.series.providerIds, key)))) return
    const listed = await listedTitles(environment)
    const now = environment.now()
    const needed = [...listed.entries()].filter(([, item]) => {
        const title = titleOf(item.media, null, now)
        const found = matchS1(title, shows)
        return !found || found.episodes.length < title.aired
    }).map(([id]) => id)
    await atMost(REQUESTS_AT_ONCE, needed, async id => {
        await environment.pause("mediaserver metadata")
        await metadataFor(environment, id)
    })
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
    const series = all.filter(item => item.id)
    const read = new Map<string, ServerShow>()
    await atMost(REQUESTS_AT_ONCE, series.filter(item => item.type !== "Movie"), async item => {
        await environment.pause("mediaserver series")
        const seasons = await listSeasons(environment.fetch, session, item.id)
        const episodes = await listEpisodes(environment.fetch, session, item.id)
        read.set(item.id, { series: item, seasons, episodes })
    })
    const shows = series.map(item => (item.type === "Movie" ? movieShow(item) : read.get(item.id) as ServerShow))
    await metadataNeeded(environment, shows)
    const database = await environment.database()
    const fetchedAt = environment.now()
    await inOrder(database, () => database.transaction(async transaction => {
        await transaction.delete(mediaserverSeries)
        for (const show of shows) await transaction.insert(mediaserverSeries).values({ serverId: session.serverId, seriesId: show.series.id, content: show, fetchedAt })
    }))
    forgetServerSource()
    return shows
}

let reading: Promise<ServerShow[]> | null = null
/** `problem`: why the last reading failed, as a word without any text of the server ("unreachable", "rejected", "failed") */
let lastTry: { serverId: string, at: number, failed: boolean, problem?: string } | null = null

const problemOf = (error: unknown) => (error instanceof JellyfinFailure
    ? error.status === 0 ? "unreachable" : error.status === 401 || error.status === 403 ? "rejected" : "failed"
    : "failed")

/** One reading of the server at a time; `asked`: the user wants it (not through `unasked`) */
function readServer(environment: Environment, session: JellyfinSession, asked: boolean): Promise<ServerShow[]> {
    const work = () => refreshServerShows(environment, session)
    const run = (async () => {
        try {
            await environment.pause("mediaserver read")
            const shows = asked || !environment.unasked ? await work() : await environment.unasked("mediaserver read again", work) as ServerShow[]
            lastTry = { serverId: session.serverId, at: environment.now(), failed: false }
            return shows
        }
        catch (error) {
            // the kept series stay as they were
            lastTry = { serverId: session.serverId, at: environment.now(), failed: true, problem: problemOf(error) }
            throw error
        }
        finally {
            reading = null
        }
    })()
    reading = run
    return run
}

/** Starts a reading in the background when the kept series are missing or old, none runs and no failure is too recent */
function readWhenDue(environment: Environment, session: JellyfinSession, kept: boolean, fetchedAt: number): void {
    if (reading) return
    const now = environment.now()
    const tried = lastTry?.serverId === session.serverId ? lastTry : null
    if (tried?.failed && now - tried.at < RETRY_PAUSE_MS) return
    if (kept && now - fetchedAt < SERIES_FRESH_MS) return
    if (tried && !tried.failed && now - tried.at < SERIES_FRESH_MS) return
    void readServer(environment, session, false).catch(() => undefined)
}

/**
 * "Read again" from the settings: reads the server now, after a reading that runs, without the pause after a failure.
 * Fails with `JellyfinFailure` when the server cannot be asked (the kept series stay) and with 400 when none is set up.
 */
export async function refreshServerLibrary(environment: Environment): Promise<ServerShow[]> {
    const session = await serverSession(environment)
    if (!session) throw new CoreError("no media server is signed in", 400)
    while (reading) await reading.catch(() => undefined)
    return readServer(environment, session, true)
}

/** The kept series, however old; starts a reading in the background when one is due. Never waits for the server. */
async function serverShows(environment: Environment, session: JellyfinSession): Promise<{ shows: ServerShow[], fetchedAt: number }> {
    const database = await environment.database()
    const rows = await inOrder(database, () => database.select().from(mediaserverSeries).where(eq(mediaserverSeries.serverId, session.serverId)))
    const fetchedAt = rows.length ? Math.min(...rows.map(row => row.fetchedAt)) : 0
    readWhenDue(environment, session, rows.length > 0, fetchedAt)
    return { shows: rows.map(row => row.content), fetchedAt }
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
    const listed = await listedTitles(environment)
    const key = [session.serverId, fetchedAt, Math.floor(environment.now() / SERIES_FRESH_MS), mappings.map(row => `${row.itemId}:${row.changedAt}`).join(","), [...listed.keys()].join(",")].join("|")
    if (remembered?.key === key) return remembered.state
    const metadata = shows.length ? await keptMetadata(environment, [...listed.keys()]) : new Map<number, Json>()
    const titles: AnilistTitle[] = []
    for (const [id, item] of listed) titles.push(titleOf(item.media, metadata.get(id) ?? null, environment.now()))
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

/** The certain match of a title with episodes; a title outside the lists is matched now, with the lists' titles, so that no episode gets two titles */
async function certainMatch(environment: Environment, session: JellyfinSession, id: number, media: unknown): Promise<{ match: ServerMatch, shows: ServerShow[] } | null> {
    const state = await libraryState(environment, session)
    let match = state.matches.find(candidate => candidate.anilistId === id)
    if (!match && !state.listed.has(id) && isRecord(media)) {
        const title = titleOf({ ...media, id }, (await keptMetadata(environment, [id])).get(id) ?? null, environment.now())
        match = allMatches([...state.titles, title], state.shows, state.mappings).find(candidate => candidate.anilistId === id)
    }
    return match?.certain && match.episodes.length > 0 ? { match, shows: state.shows } : null
}

/**
 * GET /api/v1/library/anime-entry/{id}: an anime that neither the device nor a Nakama host has files of and that the
 * server has for certain becomes the server's (`_isMediaServerEntry`, its episodes with `_isMediaServerEpisode`).
 */
export async function withServerFiles(entry: unknown, environment: Environment): Promise<unknown> {
    if (!isRecord(entry) || entry.libraryData || entry._isNakamaEntry || !whole(entry.mediaId)) return entry
    const id = whole(entry.mediaId)
    let found: { match: ServerMatch, shows: ServerShow[] } | null
    try {
        await environment.pause("mediaserver library")
        const session = await serverSession(environment)
        if (!session) return entry
        found = await certainMatch(environment, session, id, entry.media)
    }
    catch {
        return entry
    }
    if (!found) return entry
    const { match, shows } = found
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

/* ── Playing ──────────────────────────────────────────────────────────── */

const MIME: Record<string, string> = { mkv: "video/x-matroska", mp4: "video/mp4", webm: "video/webm", avi: "video/x-msvideo", mov: "video/quicktime", m4v: "video/mp4", ts: "video/mp2t" }

/** A new id for one playing (Jellyfin's `PlaySessionId`): 32 hex digits */
function newPlaySessionId(now: number): string {
    let id = now.toString(16)
    while (id.length < 32) id += Math.floor(Math.random() * 16).toString(16)
    return id.slice(0, 32)
}

/**
 * The address of a server episode's original file, played as it is (`static=true`, no conversion). The token is never
 * part of it: it goes in the Authorization line (`requestHeaders`).
 */
export function serverStreamAddress(session: JellyfinSession, episodeId: string, mediaSourceId: string, playSessionId: string): string {
    return jellyfinUrl(session.url, `/Videos/${encodeURIComponent(episodeId)}/stream`, { static: true, mediaSourceId, deviceId: session.identity.deviceId, playSessionId })
}

/**
 * POST /api/v1/mediaserver/play {path, mediaId}: the player opens the server's file straight from the server, with
 * the Authorization line as a header (`requestHeaders`, mpv `http-header-fields`); the progress goes as for any
 * episode. Fails in plain words when no server is set up or signed in or the episode is not among the kept series.
 */
export async function playServerFile(request: CoreRequest, environment: Environment): Promise<boolean> {
    const body = isRecord(request.body) ? request.body : {}
    const path = text(body.path)
    const mediaId = whole(body.mediaId)
    const file = serverFileOfPath(path)
    if (!file || !mediaId) throw new CoreError("path and mediaId are needed", 400)
    if (!(await serverSettingsOf(environment)).url) throw new CoreError("The media server's address is missing", 400)
    const session = await serverSession(environment)
    if (!session) throw new CoreError("Not signed in to a media server", 400)
    const { media, episodes } = await animeWithEpisodes(environment, mediaId)
    const found = await certainMatch(environment, session, mediaId, media)
    const row = found ? serverRows(found.match, found.shows, environment.now()).find(candidate => candidate.path === path) : undefined
    const episode = found?.shows.flatMap(show => show.episodes).find(candidate => candidate.id === file.episodeId)
    if (!found || !row || !episode) throw new CoreError("The episode is not in the media server's library", 404)
    // one version: Jellyfin names its source after the item (a movie read as one episode carries none)
    const source = episode.mediaSources[0]
    const mediaSourceId = source?.id || episode.id
    const container = (source?.container ?? "").split(",")[0].toLowerCase()
    const entry = await storedEntry(await environment.database(), "ANIME", mediaId)
    emitCoreEvent("native-player", {
        type: "watch",
        payload: {
            id: `core-mediaserver-${environment.now()}`,
            // a file of the library: the player's playlist goes on through playMediaFile, which knows server episodes
            streamType: "localfile",
            streamPath: row.path,
            mimeType: MIME[container] ?? "video/*",
            streamUrl: serverStreamAddress(session, episode.id, mediaSourceId, newPlaySessionId(environment.now())),
            requestHeaders: { Authorization: authorizationHeader(session.identity, session.token) },
            contentLength: 0,
            ...(entry ? { entryListData: listDataOf(entry) } : {}),
            episode: {
                ...episodeOfFile(row, media, episodes),
                _isMediaServerEpisode: true,
                mediaServerEpisode: { serverId: found.match.serverId, seriesId: found.match.seriesId, episodeId: episode.id },
            },
            media,
            isNakamaWatchParty: false,
        },
    })
    return true
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

/* ── Settings page ────────────────────────────────────────────────────── */

export interface ServerOverview {
    signedIn: boolean
    serverName: string
    username: string
    url: string
    sendProgress: boolean
    /** A reading of the server runs right now */
    reading: boolean
    series: number
    /** Series of the server with a certain match */
    matched: number
    /** Series without a certain match, with the uncertain suggestion if there is one */
    unmatched: { seriesId: string, name: string, year: number, suggestion: { anilistId: number, title: string } | null }[]
    /** When the kept series were read last, null when none are kept */
    lastReadAt: number | null
    /** Why the last reading failed ("unreachable", "rejected", "failed"), empty when it did not */
    problem: string
}

/** What the settings page shows of the media server; carries neither token nor password */
export async function serverOverview(environment: Environment): Promise<ServerOverview> {
    const settings = await serverSettingsOf(environment)
    const session = await serverSession(environment)
    const shown = { signedIn: session !== null, serverName: settings.serverName, username: settings.username, url: settings.url, sendProgress: settings.sendProgress }
    if (!session) return { ...shown, reading: false, series: 0, matched: 0, unmatched: [], lastReadAt: null, problem: "" }
    const state = await libraryState(environment, session)
    const unassigned = await unassignedServerShows(environment)
    const database = await environment.database()
    const rows = await inOrder(database, () => database.select({ fetchedAt: mediaserverSeries.fetchedAt }).from(mediaserverSeries).where(eq(mediaserverSeries.serverId, session.serverId)))
    const titleOfId = (id: number) => {
        const media = state.listed.get(id)?.media
        const title = media && isRecord(media.title) ? media.title : {}
        return text(title.userPreferred) || text(title.english) || text(title.romaji) || `AniList ${id}`
    }
    const tried = lastTry?.serverId === session.serverId ? lastTry : null
    return {
        ...shown,
        reading: reading !== null,
        series: state.shows.length,
        matched: new Set(state.matches.filter(match => match.certain).map(match => match.seriesId)).size,
        unmatched: unassigned.map(show => ({
            seriesId: show.seriesId, name: show.name, year: show.year,
            suggestion: show.suggestion ? { anilistId: show.suggestion.anilistId, title: titleOfId(show.suggestion.anilistId) } : null,
        })),
        lastReadAt: rows.length ? Math.max(...rows.map(row => row.fetchedAt)) : null,
        problem: tried?.failed ? tried.problem ?? "failed" : "",
    }
}
