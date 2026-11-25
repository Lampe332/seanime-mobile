// geschrieben nach: Seanime_Jellyfin_Plan.md §4 ("Start, Stand, Ende"), §6 ("Abstand der Meldungen") und use-player-server.ts (die Ereignisse des Players)

import type { MediaServerPlayback_Variables } from "@/api/hooks/mediaserver.hooks"

/*
 * Which reports a playing server episode sends to its media server, decided from the player's own events (the ones
 * use-player-server.ts sends to the core): start with the first event of a playing, the position every
 * `SERVER_REPORT_EVERY_MS` and at once on pause, resume and seek, "watched" when the app counts the episode as watched
 * (`video-completed`, the rule of the AniList update), the end when the player closes or another episode takes it.
 * Anything that is not a server episode reports nothing. Whether reports are wanted at all ("Send progress to the
 * server") is the core's to know: it drops them while the switch is off (core/jellyfin/playback.ts).
 */

export const SERVER_REPORT_EVERY_MS = 10_000

export type ServerReport = MediaServerPlayback_Variables

/** One playing of a server episode: the player's playback id and what the server knows it by */
export type ServerPlayback = { id: string, episodeId: string, mediaSourceId: string, playSessionId: string }

export type ReportState = {
    playback: ServerPlayback | null
    /** Seconds, as last heard from the player */
    position: number
    paused: boolean
    watched: boolean
    /** When the last start or position went out */
    sentAt: number
}

export const REPORT_IDLE: ReportState = { playback: null, position: 0, paused: false, watched: false, sentAt: 0 }

export type ReportEvent = {
    /** The player's event ("video-status", "video-paused", …) */
    type: string
    /** What plays now: null for anything but a server episode */
    playback: ServerPlayback | null
    currentTime?: number
    paused?: boolean
    now: number
}

const text = (value: unknown) => (typeof value === "string" ? value : "")

/** The server episode a playback info carries (core/jellyfin/source.ts `playServerFile`), or null */
export function serverPlaybackOf(info: { id?: string, episode?: unknown } | null | undefined): ServerPlayback | null {
    const episode = info?.episode as { _isMediaServerEpisode?: unknown, mediaServerEpisode?: Record<string, unknown> | null } | null | undefined
    if (!info?.id || episode?._isMediaServerEpisode !== true || !episode.mediaServerEpisode) return null
    const episodeId = text(episode.mediaServerEpisode.episodeId)
    const playSessionId = text(episode.mediaServerEpisode.playSessionId)
    if (!episodeId || !playSessionId) return null
    return { id: info.id, episodeId, mediaSourceId: text(episode.mediaServerEpisode.mediaSourceId) || episodeId, playSessionId }
}

function reportOf(kind: ServerReport["kind"], state: ReportState, playback: ServerPlayback): ServerReport {
    return {
        kind, episodeId: playback.episodeId, mediaSourceId: playback.mediaSourceId, playSessionId: playback.playSessionId,
        positionSeconds: state.position, paused: state.paused, watched: state.watched,
    }
}

const IMMEDIATE = new Set(["video-paused", "video-resumed", "video-seeked"])

/** The next state and the reports that go out for one event of the player, in order */
export function reportStep(state: ReportState, event: ReportEvent): { state: ReportState, reports: ServerReport[] } {
    const reports: ServerReport[] = []
    let next = state
    const closing = event.type === "video-terminated"
    // the playing is over, or another one took the player without a goodbye
    if (next.playback && (closing || next.playback.id !== event.playback?.id)) {
        reports.push(reportOf("stop", next, next.playback))
        next = REPORT_IDLE
    }
    if (closing || !event.playback) return { state: next, reports }
    const heard = {
        position: typeof event.currentTime === "number" && Number.isFinite(event.currentTime) ? Math.max(0, event.currentTime) : next.position,
        // the event itself says it best: its payload may still carry the state from before
        paused: event.type === "video-paused" ? true : event.type === "video-resumed" ? false : event.paused ?? next.paused,
    }
    if (!next.playback) {
        next = { ...REPORT_IDLE, ...heard, playback: event.playback, sentAt: event.now }
        reports.push(reportOf("start", next, event.playback))
        return { state: next, reports }
    }
    next = { ...next, ...heard }
    const playback = event.playback
    if (event.type === "video-completed" && !next.watched) {
        next = { ...next, watched: true }
        reports.push(reportOf("watched", next, playback))
    }
    else if (IMMEDIATE.has(event.type) || (event.type === "video-status" && event.now - next.sentAt >= SERVER_REPORT_EVERY_MS)) {
        next = { ...next, sentAt: event.now }
        reports.push(reportOf("progress", next, playback))
    }
    return { state: next, reports }
}
