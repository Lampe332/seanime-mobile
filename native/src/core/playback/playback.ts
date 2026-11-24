// geschrieben nach: Aufzeichnung api (CONTINUITY.GetContinuityWatchHistory, CONTINUITY.GetContinuityWatchHistoryItem) und api-schreibend (CONTINUITY.UpdateContinuityWatchHistoryItem, Zustand vorher/nachher) vom 13.11.2026, App-Code src/main/_features/player/use-player-server.ts (was der Player über videocore sagt), player-logic.ts (video-completed bei 80 %), src/api/hooks/continuity.hooks.ts, settings-app.tsx (library.autoUpdateProgress, library.enableWatchContinuity); kein Server-Quelltext

import { eq, inArray } from "drizzle-orm"
import { readThrough } from "../anilist/anilist"
import { updateProgressOf } from "../anilist/changes"
import { askAnilist, clientFor } from "../anilist/client"
import { HISTORY_TITLES } from "../anilist/queries"
import { keepAnswer, storedEntry, withoutEmpty } from "../anilist/store"
import { inOrder } from "../database/database"
import { anilistAnswers, anilistMedia, watchPositions } from "../database/schema"
import { CoreError } from "../errors"
import type { CoreEnvironment, CoreRequest } from "../registry"
import { incognitoOn } from "../settings/incognito"
import { ownSettingsAndLook } from "../settings/settings"
import { isTvmazeId, tvmazeMedia } from "../tvmaze/tvmaze"

/*
 * Watch history and progress without the server (phase 5a-2, area `playback`, docs/EIGENER-KERN.md §4p).
 *
 * The player tells over the `videocore` channel what it plays: video-loaded (what), video-status every second and on
 * pause/seek (where), video-completed once at 80 % played (player-logic.ts), video-terminated (closed). With the area
 * on, the core hears these instead of the server (tellPlayer): it keeps where each anime was left in `watch_positions`
 * (the table the move filled from the server's watch history, §4c; a title of TVmaze under its negative id, §4t), and once an episode counts as watched it sets the
 * AniList progress the way the app's own "mark as watched" does. Offline episodes tell nothing (use-player-server.ts
 * `enabled`), their position stays the offline area's (`mobile-offline/position`).
 */

type Json = Record<string, unknown>
type Environment = CoreEnvironment

export const CONTINUITY_KINDS = ["onlinestream", "mediastream", "external_player"] as const
type Kind = (typeof CONTINUITY_KINDS)[number]

/** A position is written at most this often while playing; a pause, seek, the 80 % mark and closing write at once. */
export const SAVE_EVERY_MS = 5_000

/** What the player says over videocore, as use-player-server.ts sends it. */
export type PlayerMessage = { clientId?: string | null, type: string, payload?: unknown }

type Playing = {
    mediaId: number
    episodeNumber: number
    totalEpisodes: number
    kind: Kind
    filepath: string
    currentTime: number
    duration: number
    savedAt: number
    keepHistory: boolean
    autoProgress: boolean
    /** the player said 80 % (video-completed): the progress is due */
    completed: boolean
    /** the progress went out and was taken; until then a later message of this playback tries again */
    progressSent: boolean
    /** a progress request is on its way (no second one meanwhile) */
    progressSending: boolean
    /** when the last progress request went out (a status retries at most every SAVE_EVERY_MS) */
    progressTriedAt: number
    /** the player that announced it (one playback per player: a new episode replaces the one before) */
    clientId: string
}

/** The playbacks the player announced, by their id; gone when it closes. */
const playing = new Map<string, Playing>()

function record(value: unknown): Json {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Json : {}
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)
const whole = (value: unknown): value is number => Number.isInteger(value)

function itemOf(row: typeof watchPositions.$inferSelect) {
    return {
        kind: row.kind,
        filepath: row.filepath,
        mediaId: row.mediaId,
        episodeNumber: row.episodeNumber,
        currentTime: row.positionSeconds,
        duration: row.durationSeconds,
        timeAdded: new Date(row.addedAt).toISOString(),
        timeUpdated: new Date(row.changedAt).toISOString(),
    }
}

type Position = { mediaId: number, episodeNumber: number, kind: Kind, filepath: string, currentTime: number, duration: number }

/** One row per anime: a new episode or position replaces the old one, the time it was first added stays. */
async function keep(environment: Environment, position: Position): Promise<void> {
    // incognito mode: no trace in the history, so no "Continue watching" either (settings/incognito.ts)
    if (await incognitoOn(environment)) return
    const database = await environment.database()
    // measuring point: building the row and the statement, up to the database's line (5a-2b)
    environment.mark?.("watch position row")
    const now = environment.now()
    const values = {
        kind: position.kind,
        episodeNumber: position.episodeNumber,
        positionSeconds: position.currentTime,
        durationSeconds: position.duration,
        filepath: position.filepath,
        changedAt: now,
        expiresAt: null,
    }
    await inOrder(database, () => database.insert(watchPositions)
        .values({ mediaId: position.mediaId, addedAt: now, ...values })
        .onConflictDoUpdate({ target: watchPositions.mediaId, set: values }))
}

const live = (row: typeof watchPositions.$inferSelect, now: number) => row.expiresAt === null || row.expiresAt > now

/** GET /api/v1/continuity/history: every anime's last position, by its AniList number (recorded form) */
export async function continuityHistory(_request: CoreRequest, environment: Environment): Promise<Record<string, unknown>> {
    const database = await environment.database()
    const now = environment.now()
    const rows = await inOrder(database, () => database.select().from(watchPositions))
    return Object.fromEntries(rows.filter(row => live(row, now)).map(row => [String(row.mediaId), itemOf(row)]))
}

/** GET /api/v1/continuity/item/{id}: one anime's; not there: `{ item: null, found: false }` (recorded) */
export async function continuityItem(request: CoreRequest, environment: Environment): Promise<unknown> {
    const mediaId = Number(request.path.id)
    if (!whole(mediaId) || mediaId === 0) throw new CoreError("invalid id", 400)
    const database = await environment.database()
    const [row] = await inOrder(database, () => database.select().from(watchPositions).where(eq(watchPositions.mediaId, mediaId)))
    return row && live(row, environment.now()) ? { item: itemOf(row), found: true } : { item: null, found: false }
}

/** PATCH /api/v1/continuity/item: `{ options }` as Continuity_UpdateWatchHistoryItemOptions; answers true (recorded) */
export async function updateContinuityItem(request: CoreRequest, environment: Environment): Promise<boolean> {
    const options = record(record(request.body).options)
    const { mediaId, episodeNumber, currentTime, duration, kind } = options
    if (!whole(mediaId) || mediaId === 0 || !whole(episodeNumber) || !finite(currentTime) || !finite(duration)) throw new CoreError("invalid options", 400)
    if (!(CONTINUITY_KINDS as readonly unknown[]).includes(kind)) throw new CoreError("invalid kind", 400)
    await keep(environment, { mediaId, episodeNumber, kind: kind as Kind, filepath: typeof options.filepath === "string" ? options.filepath : "", currentTime, duration })
    return true
}

/** DELETE /api/v1/continuity/item `{ mediaId }`: the History screen takes one anime out of the history (never AniList) */
export async function removeContinuityItem(request: CoreRequest, environment: Environment): Promise<boolean> {
    const mediaId = record(request.body).mediaId
    if (!whole(mediaId) || mediaId === 0) throw new CoreError("invalid id", 400)
    const database = await environment.database()
    await inOrder(database, () => database.delete(watchPositions).where(eq(watchPositions.mediaId, mediaId)))
    return true
}

/** DELETE /api/v1/continuity/history: "Clear history" (never AniList) */
export async function clearContinuityHistory(_request: CoreRequest, environment: Environment): Promise<boolean> {
    const database = await environment.database()
    await inOrder(database, () => database.delete(watchPositions))
    return true
}

/**
 * POST /api/v1/history/media `{ ids }`: the titles the History screen shows, as the core keeps them (anilist_media, the
 * lists' form before the details page's one, which lacks the title), by AniList number; a title the core never saw is read from AniList (title
 * and cover only) and kept; while AniList cannot be reached such a title is missing.
 */
export async function historyMedia(request: CoreRequest, environment: Environment): Promise<Record<string, unknown>> {
    const ids = record(request.body).ids
    if (!Array.isArray(ids) || ids.some(id => !whole(id) || id === 0)) throw new CoreError("invalid ids", 400)
    if (ids.length === 0) return {}
    const database = await environment.database()
    const rows = await inOrder(database, () => database.select().from(anilistMedia).where(inArray(anilistMedia.anilistId, ids as number[])))
    // the details page's form (ANIME_DETAILS) has no title or cover of the anime itself: only a form with a title counts
    const found: Record<string, unknown> = Object.fromEntries(rows.flatMap(row => {
        const media = [row.content, row.details].find(titled)
        return media ? [[String(row.anilistId), media]] : []
    }))
    // a title the user never opened nor has in a list (watched from search, the server's moved history, a manga only
    // read): its title and cover as kept for the History screen, else read from AniList once and kept (offline: left out)
    // a title of TVmaze (negative id): from TVmaze, never asked of AniList
    // all at once; a show kept within its time comes from the store (tvmaze.ts SHOW_FRESH_MS)
    const shows = (ids as number[]).filter(id => isTvmazeId(id) && !(String(id) in found))
    const shown = await Promise.all(shows.map(id => tvmazeMedia(environment, id).catch(() => null)))
    shows.forEach((id, index) => {
        if (shown[index]) found[String(id)] = shown[index]
    })
    const missing = (ids as number[]).filter(id => !isTvmazeId(id) && !(String(id) in found))
    if (missing.length === 0) return found
    const questions = missing.map(historyQuestion)
    const kept = await inOrder(database, () => database.select().from(anilistAnswers).where(inArray(anilistAnswers.question, questions)))
    for (const row of kept) found[row.question.slice(HISTORY_QUESTION.length)] = row.answer
    const unknown = missing.filter(id => !(String(id) in found))
    if (unknown.length === 0) return found
    const read = await readThrough<Json[]>(
        environment,
        async () => {
            const titles: Json[] = []
            for (let page = 1; ; page++) {
                const data = record((await askAnilist(clientFor(environment), HISTORY_TITLES, { ids: unknown, page })).Page)
                titles.push(...((Array.isArray(data.media) ? data.media : []) as unknown[]).map(record).filter(media => whole(media.id)))
                if (record(data.pageInfo).hasNextPage !== true) return titles
            }
        },
        async titles => {
            for (const media of titles) await keepAnswer(database, historyQuestion(media.id as number), withoutEmpty(media), environment.now())
        },
        async () => null,
    ).catch(error => {
        if (error instanceof CoreError) return []
        throw error
    })
    for (const media of read) found[String(media.id)] = withoutEmpty(media)
    return found
}

const titled = (media: unknown): boolean => {
    const title = record(record(media).title)
    return [title.userPreferred, title.romaji, title.english].some(name => typeof name === "string" && name !== "")
}

const HISTORY_QUESTION = "history-title/"
const historyQuestion = (id: number) => `${HISTORY_QUESTION}${id}`

/** The library part of the settings, the core's own. */
async function librarySettings(environment: Environment): Promise<Json> {
    const settings = (await ownSettingsAndLook(await environment.database())).settings
    return record(record(settings).library)
}

async function announced(environment: Environment, payload: Json, clientId: string): Promise<string> {
    const info = record(record(payload.state).playbackInfo)
    const media = record(info.media)
    const episode = record(info.episode)
    const id = typeof info.id === "string" ? info.id : ""
    const mediaId = media.id
    const episodeNumber = whole(episode.progressNumber) ? episode.progressNumber : episode.episodeNumber
    if (!id || !whole(mediaId) || !whole(episodeNumber)) return ""
    const library = await librarySettings(environment)
    const localFile = record(info.localFile)
    // the player's next episode comes without "video-terminated" for the one before: that one is over, it is forgotten
    // (before, every episode of a session stayed in memory)
    for (const [other, was] of playing) {
        if (other !== id && was.clientId === clientId) playing.delete(other)
    }
    playing.set(id, {
        mediaId,
        episodeNumber,
        totalEpisodes: whole(media.episodes) ? media.episodes : 0,
        kind: info.playbackType === "onlinestream" ? "onlinestream" : "mediastream",
        filepath: typeof localFile.path === "string" ? localFile.path : "",
        currentTime: 0,
        duration: 0,
        savedAt: 0,
        keepHistory: library.enableWatchContinuity === true,
        autoProgress: library.autoUpdateProgress === true,
        completed: false,
        progressSent: false,
        progressSending: false,
        progressTriedAt: 0,
        clientId,
    })
    return `playing ${mediaId} episode ${episodeNumber}`
}

async function save(environment: Environment, now: Playing): Promise<void> {
    if (!now.keepHistory || now.duration <= 0) return
    now.savedAt = environment.now()
    await keep(environment, now)
}

/**
 * The episode counts as watched (the player's 80 %): with "update progress automatically" on, AniList's progress
 * becomes this episode, never smaller than it is. Through the core's own changes with the area `anilist` on (queue,
 * events, §4f), otherwise through the server's interface, as the app's "mark as watched" goes.
 */
async function watched(environment: Environment, now: Playing): Promise<string> {
    if (!now.autoProgress || !now.completed || now.progressSent || now.progressSending) return ""
    // counted as sent only once it was taken: a failed request (thrown on, the caller logs it) is tried again with the
    // playback's next message (status, pause, seek, close)
    now.progressSending = true
    now.progressTriedAt = environment.now()
    try {
        const done = await progressTo(environment, { mediaId: now.mediaId, episodeNumber: now.episodeNumber, totalEpisodes: now.totalEpisodes })
        now.progressSent = true
        return done
    }
    finally {
        now.progressSending = false
    }
}

/**
 * Sets AniList's progress of an anime to this episode, never smaller than it is, through the core's own changes. Also for a playlist's "progress of the episode
 * counts" (playlists.ts).
 */
export async function progressTo(environment: Environment, body: { mediaId: number, episodeNumber: number, totalEpisodes: number }): Promise<string> {
    if (await incognitoOn(environment)) return "incognito: progress not sent"
    const entry = await storedEntry(await environment.database(), "ANIME", body.mediaId)
    if (entry && finite(entry.progress) && entry.progress >= body.episodeNumber) return `progress already ${entry.progress}`
    await updateProgressOf("ANIME")({ path: {}, query: undefined, body: { ...body, auto: true } }, environment)
    return `progress ${body.episodeNumber} by the core`
}

/** What the player announced under this id (anime and episode), while it plays; for the playlist (playlists.ts) */
export function playingOf(id: string): { mediaId: number, episodeNumber: number } | undefined {
    const now = playing.get(id)
    return now && { mediaId: now.mediaId, episodeNumber: now.episodeNumber }
}

/**
 * Hears one message of the player. Returns a short line of what was done ("" for nothing worth a log line). The
 * status every second only updates memory and writes at most every SAVE_EVERY_MS, so it stays cheap.
 */
export async function hearPlayer(message: PlayerMessage, environment: Environment): Promise<string> {
    const payload = record(message.payload)
    if (message.type === "video-loaded") return announced(environment, payload, message.clientId ?? "")
    const id = typeof payload.id === "string" ? payload.id : ""
    const now = playing.get(id)
    if (!now) return ""
    if (finite(payload.currentTime) && finite(payload.duration) && payload.duration > 0) {
        now.currentTime = payload.currentTime
        now.duration = payload.duration
    }
    switch (message.type) {
        case "video-status":
            if (environment.now() - now.savedAt >= SAVE_EVERY_MS) await save(environment, now)
            // a progress that failed is tried again every SAVE_EVERY_MS, not with every status
            if (environment.now() - now.progressTriedAt >= SAVE_EVERY_MS) return watched(environment, now)
            return ""
        case "video-paused":
        case "video-seeked":
            await save(environment, now)
            return watched(environment, now)
        case "video-completed":
            now.completed = true
            await save(environment, now)
            return watched(environment, now)
        case "video-terminated": {
            playing.delete(id)
            await save(environment, now)
            const closed = `closed ${now.mediaId} episode ${now.episodeNumber} at ${Math.round(now.currentTime)} s`
            // the last chance of a progress that failed before
            const progress = await watched(environment, now)
            return progress ? `${closed}, ${progress}` : closed
        }
        default:
            return ""
    }
}

/** For the tests: forgets the announced playbacks. */
export function forgetPlaying() {
    playing.clear()
}
