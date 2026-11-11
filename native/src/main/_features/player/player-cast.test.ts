import type { Translate } from "@/lib/app-language"
import { describe, expect, it } from "vitest"
import {
    castableStreamUrl,
    castFollowUp,
    castKindLabel,
    castPollMs,
    castSeekValue,
    castTitle,
    castTrackNumbers,
    castUrlWithTracks,
    castVolumeStep,
    phoneAfterCast,
} from "./player-cast"

const BASE = "http://127.0.0.1:43212"
const STREAM = `${BASE}/api/v1/directstream/stream?id=abc`

describe("castable streams", () => {
    it("the server's own streams", () => {
        expect(castableStreamUrl(STREAM, BASE)).toBe(STREAM)
        expect(castableStreamUrl(`${BASE}/api/v1/mobile-offline/file/1/ep.mkv`, `${BASE}/`)).toBe(`${BASE}/api/v1/mobile-offline/file/1/ep.mkv`)
    })

    it("online streams, the proxy, other hosts and split audio stay on the phone", () => {
        expect(castableStreamUrl(STREAM, BASE, { online: true })).toBeNull()
        expect(castableStreamUrl(`${BASE}/api/v1/proxy?url=x`, BASE)).toBeNull()
        expect(castableStreamUrl("https://cdn.example.com/ep.m3u8", BASE)).toBeNull()
        expect(castableStreamUrl(`${BASE}/api/v1/mobile-offline/file/1/ep.mp4`, BASE, { separateAudio: true })).toBeNull()
        expect(castableStreamUrl(undefined, BASE)).toBeNull()
        expect(castableStreamUrl(STREAM, "")).toBeNull()
    })
})

describe("cast tracks from mpv IDs", () => {
    // MKV track numbers: video 1, audio 2 + 3, subtitles 4 + 5
    const audio = [{ number: 3 }, { number: 2 }]
    const subs = [{ number: 5 }, { number: 4 }]

    it("mpv counts each kind from 1 in file order", () => {
        expect(castTrackNumbers(audio, subs, 1, 1)).toEqual({ audioTrack: 2, subtitleTrack: 4 })
        expect(castTrackNumbers(audio, subs, 2, 2)).toEqual({ audioTrack: 3, subtitleTrack: 5 })
    })

    it("no subtitles here = none on the TV, also for a subtitle file added here", () => {
        expect(castTrackNumbers(audio, subs, 1, 0)).toEqual({ audioTrack: 2, subtitleTrack: -1 })
        expect(castTrackNumbers(audio, subs, 1, 3)).toEqual({ audioTrack: 2, subtitleTrack: -1 })
    })

    it("without metadata or a picked audio track the TV keeps its own choice", () => {
        expect(castTrackNumbers(null, null, 1, 1)).toEqual({ audioTrack: null, subtitleTrack: null })
        expect(castTrackNumbers(audio, subs, 0, 1)).toEqual({ audioTrack: null, subtitleTrack: 4 })
        expect(castTrackNumbers(audio, subs, 3, 1)).toEqual({ audioTrack: null, subtitleTrack: 4 })
        expect(castTrackNumbers([], [], 1, 0)).toEqual({ audioTrack: null, subtitleTrack: -1 })
    })

    it("goes into the stream URL", () => {
        const url = castUrlWithTracks(STREAM, castTrackNumbers(audio, subs, 2, 0))
        expect(new URL(url).searchParams.get("audioTrack")).toBe("3")
        expect(new URL(url).searchParams.get("subtitleTrack")).toBe("-1")
        expect(new URL(url).searchParams.get("id")).toBe("abc")
        expect(new URL(castUrlWithTracks(url, { audioTrack: null, subtitleTrack: null })).searchParams.has("audioTrack")).toBe(false)
    })
})

describe("what the TV does when the stream here changes", () => {
    const next = `${BASE}/api/v1/directstream/stream?id=def`
    it("same video, other tracks: switch where it is", () => {
        expect(castFollowUp(`${STREAM}&audioTrack=2`, `${STREAM}&audioTrack=3&subtitleTrack=-1`)).toBe("switch")
    })
    it("another episode: load from the start", () => {
        expect(castFollowUp(`${STREAM}&audioTrack=2`, `${next}&audioTrack=2`)).toBe("load")
    })
    it("a cast found running is adopted, nothing else changes", () => {
        expect(castFollowUp(null, STREAM)).toBe("adopt")
        expect(castFollowUp(STREAM, STREAM)).toBe("none")
        expect(castFollowUp(STREAM, null)).toBe("none")
    })
})

describe("cast panel", () => {
    const en: Translate = english => english
    const de: Translate = (_, german) => german

    it("titles and device kinds", () => {
        expect(castTitle("Dr. STONE", "Episode 3")).toBe("Dr. STONE · Episode 3")
        expect(castTitle("", "")).toBe("Seanime")
        expect(castKindLabel("webos", de)).toBe("LG webOS · direkt (DLNA)")
        expect(castKindLabel("googlecast", en)).toContain("no subtitles")
        expect(castKindLabel("dlna", en)).toBe("Smart TV · direct (DLNA)")
    })

    it("polls every second while open, else every 5 s", () => {
        expect(castPollMs(true)).toBe(1000)
        expect(castPollMs(false)).toBe(5000)
    })

    it("volume steps stay within 0…100", () => {
        expect(castVolumeStep(98, 5)).toBe(100)
        expect(castVolumeStep(3, -5)).toBe(0)
        expect(castVolumeStep(40, 5)).toBe(45)
    })

    it("the seek bar follows the finger, then the TV", () => {
        expect(castSeekValue(null, 30_000, 60_000)).toBe(30_000)
        expect(castSeekValue(45_000, 30_000, 60_000)).toBe(45_000)
        expect(castSeekValue(null, 90_000, 60_000)).toBe(60_000)
        expect(castSeekValue(null, 0, 0)).toBe(0)
    })

    it("after casting the phone goes on where the TV was", () => {
        expect(phoneAfterCast({ positionMs: 754_000, resume: true })).toEqual({ seekTo: 754, play: true })
        expect(phoneAfterCast({ positionMs: 0, resume: false })).toEqual({ seekTo: null, play: false })
        expect(phoneAfterCast(undefined)).toBeNull()
    })
})
