// geschrieben nach: server-report.ts; Folgen, Kennungen und Zeiten sind erfunden

import { describe, expect, it } from "vitest"
import { REPORT_IDLE, type ReportState, SERVER_REPORT_EVERY_MS, type ServerPlayback, type ServerReport, reportStep, serverPlaybackOf } from "./server-report"

const serverInfo = (id = "p1", episodeId = "ep1") => ({
    id,
    episode: { _isMediaServerEpisode: true, mediaServerEpisode: { serverId: "srv", seriesId: "sA", episodeId, mediaSourceId: `${episodeId}-src`, playSessionId: `${id}-play` } },
})
const PLAYING = serverPlaybackOf(serverInfo()) as ServerPlayback

/** Feeds the events one after the other and collects what goes out */
function run(events: { type: string, at: number, currentTime?: number, paused?: boolean, playback?: ServerPlayback | null }[], from: ReportState = REPORT_IDLE) {
    let state = from
    const reports: ServerReport[] = []
    for (const event of events) {
        const step = reportStep(state, { type: event.type, playback: event.playback === undefined ? PLAYING : event.playback, currentTime: event.currentTime, paused: event.paused, now: event.at })
        state = step.state
        reports.push(...step.reports)
    }
    return { state, reports, kinds: reports.map(report => report.kind) }
}

describe("which episode reports", () => {
    it("a server episode carries what the server knows it by", () => {
        expect(PLAYING).toEqual({ id: "p1", episodeId: "ep1", mediaSourceId: "ep1-src", playSessionId: "p1-play" })
    })

    it("anything else is no server episode", () => {
        expect(serverPlaybackOf(null)).toBeNull()
        expect(serverPlaybackOf({ id: "p1", episode: { localFile: { path: "/a.mkv" } } })).toBeNull()
        expect(serverPlaybackOf({ id: "p1", episode: { _isMediaServerEpisode: false, mediaServerEpisode: serverInfo().episode.mediaServerEpisode } })).toBeNull()
        // a server episode of the library list, not one that plays: no play session
        expect(serverPlaybackOf({ id: "p1", episode: { _isMediaServerEpisode: true, mediaServerEpisode: { serverId: "srv", seriesId: "sA", episodeId: "ep1" } } })).toBeNull()
    })

    it("a local or online episode reports nothing, whatever happens", () => {
        const out = run([
            { type: "video-loaded", at: 0, playback: null },
            { type: "video-status", at: 20_000, currentTime: 20, playback: null },
            { type: "video-paused", at: 21_000, playback: null },
            { type: "video-seeked", at: 22_000, currentTime: 90, playback: null },
            { type: "video-completed", at: 23_000, playback: null },
            { type: "video-terminated", at: 24_000, playback: null },
        ])
        expect(out.reports).toEqual([])
        expect(out.state).toEqual(REPORT_IDLE)
    })
})

describe("the reports of a server episode", () => {
    it("starts with the first event", () => {
        const out = run([{ type: "video-loaded", at: 1000, currentTime: 12, paused: false }])
        expect(out.reports).toEqual([{ kind: "start", episodeId: "ep1", mediaSourceId: "ep1-src", playSessionId: "p1-play", positionSeconds: 12, paused: false, watched: false }])
    })

    it("tells the position every ten seconds, not in between", () => {
        const events = [{ type: "video-loaded", at: 0, currentTime: 0, paused: false }]
        for (let second = 1; second <= 25; second++) events.push({ type: "video-status", at: second * 1000, currentTime: second, paused: false })
        const out = run(events)
        expect(SERVER_REPORT_EVERY_MS).toBe(10_000)
        expect(out.kinds).toEqual(["start", "progress", "progress"])
        expect(out.reports.slice(1).map(report => report.positionSeconds)).toEqual([10, 20])
    })

    it("tells pause, resume and seek at once", () => {
        const out = run([
            { type: "video-loaded", at: 0, currentTime: 0, paused: false },
            { type: "video-status", at: 1000, currentTime: 1, paused: false },
            // the payload of a pause may still say "playing": the event counts
            { type: "video-paused", at: 1500, currentTime: 1.5, paused: false },
            { type: "video-resumed", at: 2000, currentTime: 1.5, paused: true },
            { type: "video-seeked", at: 2500, currentTime: 300 },
        ])
        expect(out.kinds).toEqual(["start", "progress", "progress", "progress"])
        expect(out.reports.slice(1).map(report => [report.positionSeconds, report.paused])).toEqual([[1.5, true], [1.5, false], [300, false]])
    })

    it("an immediate report starts the ten seconds anew", () => {
        const out = run([
            { type: "video-loaded", at: 0, currentTime: 0 },
            { type: "video-seeked", at: 8000, currentTime: 100 },
            { type: "video-status", at: 12_000, currentTime: 104 },
            { type: "video-status", at: 18_000, currentTime: 110 },
        ])
        expect(out.kinds).toEqual(["start", "progress", "progress"])
        expect(out.reports[2].positionSeconds).toBe(110)
    })

    it("tells the end with the last position when the player closes", () => {
        const out = run([
            { type: "video-loaded", at: 0, currentTime: 0 },
            { type: "video-status", at: 3000, currentTime: 3, paused: false },
            { type: "video-terminated", at: 3500 },
        ])
        expect(out.kinds).toEqual(["start", "stop"])
        expect(out.reports[1]).toMatchObject({ positionSeconds: 3, watched: false })
        expect(out.state).toEqual(REPORT_IDLE)
        // closing twice (the player's close and its unmount) tells it once
        expect(run([{ type: "video-terminated", at: 4000 }], out.state).reports).toEqual([])
    })

    it("marks the episode watched when the app counts it as watched, once, and again with the end", () => {
        const out = run([
            { type: "video-loaded", at: 0, currentTime: 0 },
            { type: "video-status", at: 1000, currentTime: 1150, paused: false },
            { type: "video-completed", at: 1100, currentTime: 1152 },
            { type: "video-completed", at: 1200, currentTime: 1153 },
            { type: "video-terminated", at: 2000 },
        ])
        expect(out.kinds).toEqual(["start", "watched", "stop"])
        expect(out.reports[2]).toMatchObject({ kind: "stop", watched: true, positionSeconds: 1153 })
    })

    it("an episode closed before that stays unwatched", () => {
        const out = run([{ type: "video-loaded", at: 0 }, { type: "video-status", at: 1000, currentTime: 600 }, { type: "video-terminated", at: 2000 }])
        expect(out.reports.every(report => !report.watched)).toBe(true)
    })

    it("another episode in the same player ends the one before", () => {
        const second = serverPlaybackOf(serverInfo("p2", "ep2")) as ServerPlayback
        const out = run([
            { type: "video-loaded", at: 0, currentTime: 0 },
            { type: "video-status", at: 5000, currentTime: 5 },
            { type: "video-loaded", at: 6000, currentTime: 0, playback: second },
            { type: "video-status", at: 7000, currentTime: 1, playback: null },
        ])
        expect(out.reports.map(report => [report.kind, report.episodeId, report.positionSeconds])).toEqual([["start", "ep1", 0], ["stop", "ep1", 5], ["start", "ep2", 0], ["stop", "ep2", 0]])
    })
})
