// geschrieben nach: Seanime_Jellyfin_Plan.md §4 ("Start, Stand, Ende", "Gesehen setzen"), §6 und Messungen an Jellyfin 12.4.0 (openapi.json, echte Aufrufe)

import type { CoreEnvironment } from "../registry"
import { type JellyfinSession, tellServer } from "./client"
import { serverSession, serverSettingsOf } from "./source"

/*
 * The reports of a playing server episode to its server. Measured on Jellyfin 12.4.0:
 *
 * - `PositionTicks` counts 100 ns (10,000,000 a second): a 60 s episode has `RunTimeTicks` 600,230,000 and the session
 *   shows the sent value unchanged.
 * - The server demands no field (an empty object is answered 204, a missing body 415); without `ItemId` nothing is kept.
 * - "Stopped" marks the episode played by itself only past the server's own limit (90 %, `MaxResumePct`) and keeps the
 *   position between 5 % and 90 %. The app counts an episode as watched at 80 %, so "watched" is an own call; after
 *   "Stopped" it goes again, because the stop left a position to resume from.
 * - A playing that never stops stays "now playing" on the server (still so after 8 minutes without a report; the
 *   server lets the shown position run on to the end by itself), so the end is always told.
 *
 * Reports go one after the other, in the order they came. Nothing here ever fails for the player: a refused, failed or
 * late report is `false`. While reports wait for a slow server, further "progress" ones are dropped.
 */

type Json = Record<string, unknown>
type Environment = Pick<CoreEnvironment, "fetch" | "secret" | "database" | "now" | "pause">

export const TICKS_PER_SECOND = 10_000_000
/** More reports than this waiting: a "progress" one is dropped (the next one carries the newer position anyway) */
export const REPORTS_WAITING_MAX = 2

export type PlaybackReportKind = "start" | "progress" | "stop" | "watched"

export interface PlaybackReport {
    kind: PlaybackReportKind
    episodeId: string
    mediaSourceId: string
    playSessionId: string
    positionSeconds: number
    paused: boolean
    /** With "stop": the episode counts as watched */
    watched: boolean
}

export interface ServerCall {
    path: string
    query?: Record<string, string>
    body?: Json
}

const KINDS: readonly string[] = ["start", "progress", "stop", "watched"]
const text = (value: unknown) => (typeof value === "string" ? value : "")

/** Seconds as the server's ticks; anything that is not a time is the start */
export function positionTicks(seconds: number): number {
    return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * TICKS_PER_SECOND) : 0
}

/** The report a request carries, or null when it names no kind or no episode */
export function playbackReportOf(body: unknown): PlaybackReport | null {
    if (typeof body !== "object" || body === null) return null
    const input = body as Json
    const kind = text(input.kind)
    const episodeId = text(input.episodeId)
    if (!KINDS.includes(kind) || !episodeId) return null
    return {
        kind: kind as PlaybackReportKind,
        episodeId,
        mediaSourceId: text(input.mediaSourceId) || episodeId,
        playSessionId: text(input.playSessionId),
        positionSeconds: typeof input.positionSeconds === "number" ? input.positionSeconds : 0,
        paused: input.paused === true,
        watched: input.watched === true,
    }
}

/** What a report asks of the server, in order */
export function playbackCalls(report: PlaybackReport, userId: string): ServerCall[] {
    const played: ServerCall = { path: `/UserPlayedItems/${encodeURIComponent(report.episodeId)}`, query: { userId } }
    const state = { ItemId: report.episodeId, MediaSourceId: report.mediaSourceId, PositionTicks: positionTicks(report.positionSeconds), PlaySessionId: report.playSessionId }
    const playing = { ...state, IsPaused: report.paused, PlayMethod: "DirectPlay", CanSeek: true }
    switch (report.kind) {
        case "start":
            return [{ path: "/Sessions/Playing", body: playing }]
        case "progress":
            return [{ path: "/Sessions/Playing/Progress", body: playing }]
        case "stop":
            return report.watched ? [{ path: "/Sessions/Playing/Stopped", body: state }, played] : [{ path: "/Sessions/Playing/Stopped", body: state }]
        case "watched":
            return [played]
    }
}

async function send(report: PlaybackReport, session: JellyfinSession, environment: Environment): Promise<boolean> {
    let all = true
    for (const call of playbackCalls(report, session.userId)) {
        // "watched" still goes when "Stopped" failed
        try {
            await tellServer(environment.fetch, session, call.path, call.body, call.query)
        }
        catch {
            all = false
        }
    }
    return all
}

let turn: Promise<unknown> = Promise.resolve()
let waiting = 0

/**
 * POST /api/v1/mediaserver/playback {kind, episodeId, mediaSourceId, playSessionId, positionSeconds, paused, watched}:
 * true when the server took the report. Nothing goes out while "progress to the server" is off or no one is signed in.
 */
export async function reportServerPlayback(body: unknown, environment: Environment): Promise<boolean> {
    const report = playbackReportOf(body)
    if (!report) return false
    if (report.kind === "progress" && waiting >= REPORTS_WAITING_MAX) return false
    waiting++
    const mine = turn.then(async () => {
        if (!(await serverSettingsOf(environment)).sendProgress) return false
        const session = await serverSession(environment)
        return session ? await send(report, session, environment) : false
    }).catch(() => false)
    turn = mine
    try {
        return await mine
    }
    finally {
        waiting--
    }
}
