// geschrieben nach: Aufzeichnung api (PLAYLIST.GetPlaylists, Anfrage-Formen von CreatePlaylist/UpdatePlaylist/DeletePlaylist/GetPlaylistEpisodes) und api-schreibend (PLAYLIST.CreatePlaylist/UpdatePlaylist/DeletePlaylist, Zustand vorher/nachher) vom 13.11.2026, DB-Kopien (Tabelle `playlists`: id, created_at, updated_at, name, value), App-Code global-playlist-manager.tsx (Nachrichten `playlist` hin und zurück), mobile-playlists.tsx (Folgen zum Auswählen), mobile-playlist-state.ts, player-screen.tsx (nächste Folge), src/api/generated/types.ts (Anime_Playlist, Anime_PlaylistEpisode) und docs/EIGENER-KERN.md §4p; kein Server-Quelltext

import { asc, eq } from "drizzle-orm"
import { storedEntry } from "../anilist/store"
import { inOrder } from "../database/database"
import { playlistMove, playlists } from "../database/schema"
import { CoreError } from "../errors"
import { emitCoreEvent } from "../events"
import { episodeCollection } from "../library/library"
import type { CoreEnvironment, CoreRequest } from "../registry"
import { type PlayerMessage, playingOf, progressTo } from "./playback"

/*
 * Playlists without the server (phase 5a-4, area `playback`, docs/EIGENER-KERN.md §4p).
 *
 * Interfaces: the playlists in `core.db` (form as recorded: `{ dbId, name, episodes }`), the episodes of an anime to
 * pick from, and the server's playlists moved in once (read from its database, never written).
 *
 * The running playlist: the screens talk over the `playlist` channel (start, stop, reopen, play the next or previous
 * episode, "which one plays"); with the area on, the core hears these instead of the server and answers with the same
 * messages (`current-playlist`, `play-episode`, `playing-episode`). The player's own messages (playback.ts) tell the
 * core when the episode of the playlist was loaded and when it counts as watched; the player itself asks for the next
 * episode when it ends (player-screen.tsx, the playlist's "next"), so the core moves on only when asked.
 */

type Json = Record<string, unknown>
type Environment = CoreEnvironment
type Playlist = { dbId: number, name: string, episodes: Json[] }

/** What the screens send over the `playlist` channel (global-playlist-manager.tsx) */
export type PlaylistMessage = { type: string, payload?: unknown }

function record(value: unknown): Json {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : {}
}

const whole = (value: unknown): value is number => Number.isInteger(value)

function wholeNumber(value: unknown, name: string): number {
    const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value
    if (typeof number !== "number" || !Number.isInteger(number) || number <= 0) throw new CoreError(`invalid ${name}`, 400)
    return number
}

function nameOf(body: Json): string {
    if (typeof body.name !== "string") throw new CoreError("invalid name", 400)
    return body.name
}

function episodesOf(body: Json): Json[] {
    if (body.episodes === undefined || body.episodes === null) return []
    if (!Array.isArray(body.episodes)) throw new CoreError("invalid episodes", 400)
    return body.episodes.map(record)
}

const answerOf = (row: typeof playlists.$inferSelect): Playlist => ({ dbId: row.dbId, name: row.name, episodes: row.episodes })

// ---------------------------------------------------------------------------------------------------------------------
// The move of the server's playlists

/** The server's table `playlists`: `value` holds the episodes as JSON (a list, or an object with `episodes`) */
function episodesInValue(value: unknown): Json[] | null {
    const text = typeof value === "string" ? value : value instanceof Uint8Array ? new TextDecoder().decode(value) : null
    if (text === null) return null
    try {
        const parsed: unknown = JSON.parse(text)
        const list = Array.isArray(parsed) ? parsed : record(parsed).episodes
        return Array.isArray(list) ? list.map(record) : null
    }
    catch {
        return null
    }
}

let moving: Promise<void> | null = null

/**
 * Once per database: the server's playlists, read from its database (a copy in memory, §4c), become the core's, in
 * their order. Any row in `playlist_move` means it has run: `moved` (count), `empty`, `missing` (no database of the
 * server here), `failed` (reason). A playlist whose episodes cannot be read comes along without episodes (`reason`).
 */
export function moveServerPlaylists(environment: Environment): Promise<void> {
    moving ??= (async () => {
        const database = await environment.database()
        const [done] = await inOrder(database, () => database.select({ id: playlistMove.id }).from(playlistMove).limit(1))
        if (done) return
        let outcome = "missing"
        let reason: string | null = null
        let rows: Json[] = []
        try {
            const read = environment.serverPlaylists ? await environment.serverPlaylists() : null
            if (read) {
                rows = [...read].sort((a, b) => Number(a.id) - Number(b.id))
                outcome = rows.length ? "moved" : "empty"
            }
        }
        catch (error) {
            outcome = "failed"
            reason = error instanceof Error ? error.message : String(error)
        }
        const now = environment.now()
        const values: (typeof playlists.$inferInsert)[] = []
        let unreadable = 0
        for (const row of rows) {
            const episodes = episodesInValue(row.value)
            if (!episodes) unreadable++
            values.push({ name: typeof row.name === "string" ? row.name : "", episodes: episodes ?? [], createdAt: now, updatedAt: now })
            await environment.pause("playlist move")
        }
        if (unreadable) reason = `${unreadable} without readable episodes`
        await inOrder(database, async () => {
            const [again] = await database.select({ id: playlistMove.id }).from(playlistMove).limit(1)
            if (again) return
            if (values.length) await database.insert(playlists).values(values)
            await database.insert(playlistMove).values({ id: 1, outcome, count: values.length, reason, movedAt: now })
        })
    })().finally(() => {
        moving = null
    })
    return moving
}

// ---------------------------------------------------------------------------------------------------------------------
// Interfaces

async function stored(environment: Environment): Promise<Playlist[]> {
    await moveServerPlaylists(environment)
    const database = await environment.database()
    const rows = await inOrder(database, () => database.select().from(playlists).orderBy(asc(playlists.dbId)))
    return rows.map(answerOf)
}

/** GET /api/v1/playlists: every playlist, oldest first */
export async function allPlaylists(_request: CoreRequest, environment: Environment): Promise<Playlist[]> {
    return stored(environment)
}

/** POST /api/v1/playlist: `{ name, episodes }` → the new playlist */
export async function createPlaylist(request: CoreRequest, environment: Environment): Promise<Playlist> {
    const body = record(request.body)
    const name = nameOf(body)
    const episodes = episodesOf(body)
    await moveServerPlaylists(environment)
    const database = await environment.database()
    const now = environment.now()
    const [row] = await inOrder(database, () => database.insert(playlists).values({ name, episodes, createdAt: now, updatedAt: now }).returning())
    return answerOf(row)
}

/** PATCH /api/v1/playlist: `{ dbId, name, episodes }` → the playlist as it is now */
export async function updatePlaylist(request: CoreRequest, environment: Environment): Promise<Playlist> {
    const body = record(request.body)
    const dbId = wholeNumber(body.dbId, "dbId")
    const name = nameOf(body)
    const episodes = episodesOf(body)
    await moveServerPlaylists(environment)
    const database = await environment.database()
    const [row] = await inOrder(database, () => database.update(playlists).set({ name, episodes, updatedAt: environment.now() }).where(eq(playlists.dbId, dbId)).returning())
    if (!row) throw new CoreError("playlist not found", 404)
    const playlist = answerOf(row)
    if (running?.playlist.dbId === dbId) {
        // the running one changed: it keeps playing the same episode when that is still in it, else it stops
        const index = playlist.episodes.findIndex(episode => sameEpisode(episode, running!.playlist.episodes[running!.index]))
        running = index >= 0 ? { playlist, index } : null
        tellCurrent()
    }
    return playlist
}

/** DELETE /api/v1/playlist: `{ dbId }` → true */
export async function deletePlaylist(request: CoreRequest, environment: Environment): Promise<boolean> {
    const dbId = wholeNumber(record(request.body).dbId, "dbId")
    await moveServerPlaylists(environment)
    const database = await environment.database()
    await inOrder(database, () => database.delete(playlists).where(eq(playlists.dbId, dbId)))
    if (running?.playlist.dbId === dbId) {
        running = null
        tellCurrent()
    }
    return true
}

/**
 * GET /api/v1/playlist/episodes/{id} (not recorded: the recording had no playlist): the anime's episodes to pick from,
 * as `Anime_PlaylistEpisode[]`. The episodes are the anime's episode collection (library.ts); `isCompleted` = up to
 * the progress (query `progress`, else the core's own list entry); `watchType` is left empty, the screen puts its
 * default in (mobile-playlists.tsx `n.watchType || defaultWatchType`); the core has no Nakama.
 */
export async function playlistEpisodes(request: CoreRequest, environment: Environment): Promise<Json[]> {
    const id = wholeNumber(request.path.id, "id")
    const asked = Number(record(request.query).progress)
    let progress = Number.isFinite(asked) ? asked : 0
    if (!Number.isFinite(asked)) {
        const entry = await storedEntry(await environment.database(), "ANIME", id)
        progress = typeof entry?.progress === "number" ? entry.progress : 0
    }
    const collection = await episodeCollection({ path: { id: String(id) }, query: undefined, body: undefined }, environment)
    const episodes = Array.isArray(collection.episodes) ? collection.episodes.map(record) : []
    return episodes.map(episode => ({
        episode,
        isCompleted: whole(episode.progressNumber) && episode.progressNumber > 0 && episode.progressNumber <= progress,
        watchType: "",
        isNakama: false,
    }))
}

// ---------------------------------------------------------------------------------------------------------------------
// The running playlist

type Running = { playlist: Playlist, index: number }

/** The playlist that plays, and which of its episodes; gone when it stops */
let running: Running | null = null

function animeOf(episode: Json | undefined): { mediaId: number, episodeNumber: number, totalEpisodes: number } | null {
    const inner = record(episode?.episode)
    const anime = record(inner.baseAnime)
    const episodeNumber = whole(inner.progressNumber) ? inner.progressNumber : inner.episodeNumber
    if (!whole(anime.id) || !whole(episodeNumber)) return null
    return { mediaId: anime.id, episodeNumber, totalEpisodes: whole(anime.episodes) ? anime.episodes : 0 }
}

/** The same episode as mobile-playlist-state.ts `samePlaylistEpisode` compares it */
function sameEpisode(a: Json | undefined, b: Json | undefined): boolean {
    if (!a || !b) return false
    const x = record(a.episode)
    const y = record(b.episode)
    return x.aniDBEpisode === y.aniDBEpisode && record(x.baseAnime).id === record(y.baseAnime).id && x.episodeNumber === y.episodeNumber
}

const say = (type: string, payload?: unknown) => emitCoreEvent("playlist", { type, payload })

function tellCurrent() {
    say("current-playlist", { playlist: running?.playlist ?? null, playlistEpisode: running ? running.playlist.episodes[running.index] : null })
}

function playCurrent() {
    if (running) say("play-episode", { playlistEpisode: running.playlist.episodes[running.index] })
}

/** The current episode counts as watched: marked in the playlist (memory and `core.db`), the screens told */
async function markWatched(environment: Environment, tell = true): Promise<void> {
    if (!running) return
    const episodes = running.playlist.episodes.map((episode, index) => (index === running!.index ? { ...episode, isCompleted: true } : episode))
    running = { playlist: { ...running.playlist, episodes }, index: running.index }
    const database = await environment.database()
    const { dbId } = running.playlist
    await inOrder(database, () => database.update(playlists).set({ episodes, updatedAt: environment.now() }).where(eq(playlists.dbId, dbId)))
    if (tell) tellCurrent()
}

/** Hears one message of the screens on the `playlist` channel. Returns a short line of what was done ("" for nothing). */
export async function hearPlaylist(message: PlaylistMessage, environment: Environment): Promise<string> {
    const payload = record(message.payload)
    switch (message.type) {
        case "current-playlist":
            tellCurrent()
            return ""
        case "start-playlist": {
            const dbId = Number(payload.dbId)
            const playlist = (await stored(environment)).find(one => one.dbId === dbId)
            if (!playlist || playlist.episodes.length === 0) return `no playlist ${dbId} to start`
            // from the first episode not watched yet, else from the start
            const first = playlist.episodes.findIndex(episode => episode.isCompleted !== true)
            running = { playlist, index: first >= 0 ? first : 0 }
            tellCurrent()
            playCurrent()
            return `started playlist ${dbId} at ${running.index + 1} of ${playlist.episodes.length}`
        }
        case "stop-playlist":
            running = null
            tellCurrent()
            return "stopped the playlist"
        case "reopen-episode":
            playCurrent()
            return running ? `reopened ${running.index + 1}` : ""
        case "play-episode": {
            if (!running) return ""
            const which = payload.which === "previous" ? "previous" : "next"
            let line = ""
            // "isCurrentCompleted" is the screens' "the progress of this episode counts" (global-playlist-manager.tsx)
            if (payload.isCurrentCompleted === true) {
                const anime = animeOf(running.playlist.episodes[running.index])
                if (anime) line = `${await progressTo(environment, anime)}, `
                // the screens hear of it with the move to the other episode
                await markWatched(environment, false)
            }
            const index = running.index + (which === "next" ? 1 : -1)
            if (index < 0) return `${line}no episode before`
            if (index >= running.playlist.episodes.length) {
                running = null
                tellCurrent()
                return `${line}playlist ended`
            }
            running = { playlist: running.playlist, index }
            tellCurrent()
            playCurrent()
            return `${line}playing ${index + 1} of ${running.playlist.episodes.length}`
        }
        default:
            return ""
    }
}

/**
 * Hears the player's message after playback.ts did: the playlist's episode was loaded (the screens close the torrent
 * sheet, `playing-episode`) or counts as watched (marked; AniList's progress is playback.ts's part).
 */
export async function playlistHearsPlayer(message: PlayerMessage, environment: Environment): Promise<string> {
    if (!running) return ""
    const current = animeOf(running.playlist.episodes[running.index])
    if (!current) return ""
    const payload = record(message.payload)
    if (message.type === "video-loaded") {
        const info = record(record(payload.state).playbackInfo)
        const episode = record(info.episode)
        const episodeNumber = whole(episode.progressNumber) ? episode.progressNumber : episode.episodeNumber
        if (record(info.media).id !== current.mediaId || episodeNumber !== current.episodeNumber) return ""
        say("playing-episode")
        return `playlist episode ${running.index + 1} plays`
    }
    if (message.type === "video-completed") {
        const now = playingOf(typeof payload.id === "string" ? payload.id : "")
        if (!now || now.mediaId !== current.mediaId || now.episodeNumber !== current.episodeNumber) return ""
        await markWatched(environment)
        return `playlist episode ${running.index + 1} watched`
    }
    return ""
}

/** For the tests: forgets the running playlist */
export function forgetRunningPlaylist() {
    running = null
    moving = null
}
