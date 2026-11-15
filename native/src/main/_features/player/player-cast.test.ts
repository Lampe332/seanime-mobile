import type { Translate } from "@/lib/app-language"
import { describe, expect, it } from "vitest"
import {
    castFollowUp,
    castKindLabel,
    castPollMs,
    castSeekValue,
    castTitle,
    castTrackNumbers,
    castUrlWithTracks,
    castVolumeStep,
    phoneAfterCast,
    playerCastUrl,
} from "./player-cast"

describe("the player's stream for the TV (phase 7c-2)", () => {
    const torrent = `http://127.0.0.1:41234/${"a".repeat(32)}/${"0123456789abcdef".repeat(2)}01234567/3/Dr.%20STONE%20-%2003.mkv`
    it("hands the core's torrent stream over as it is", () => {
        expect(playerCastUrl(torrent, { online: false, headers: {} })).toBe(torrent)
    })
    it("hands a file of the device over (offline episode, local library, path)", () => {
        const file = "file:///data/user/0/com.seanime.app.native/files/episodes/abc/ep%201.mkv"
        expect(playerCastUrl(file, { online: false })).toBe(file)
        expect(playerCastUrl("/storage/emulated/0/Anime/ep.mkv", { online: false, headers: {} })).toBe("/storage/emulated/0/Anime/ep.mkv")
    })
    it("leaves online streams and files with request headers out", () => {
        expect(playerCastUrl("https://cdn.example.org/ep.m3u8", { online: true })).toBeNull()
        expect(playerCastUrl(torrent, { online: true })).toBeNull()
        expect(playerCastUrl("http://192.168.1.20:43211/api/v1/nakama/stream?type=file&path=YQ==", { online: false, headers: { "X-Seanime-Nakama-Token": "t" } })).toBeNull()
        expect(playerCastUrl("file:///x.mkv", { online: false, headers: { Referer: "r" } })).toBeNull()
    })
    it("leaves other streams of the device and network addresses out", () => {
        expect(playerCastUrl("http://127.0.0.1:43211/api/v1/directstream/stream?id=1", { online: false })).toBeNull()
        expect(playerCastUrl(`${torrent}?audioTrack=2`, { online: false })).toBeNull()
        expect(playerCastUrl("https://debrid.example.org/file.mkv", { online: false })).toBeNull()
        expect(playerCastUrl("", { online: false })).toBeNull()
        expect(playerCastUrl(undefined, { online: false })).toBeNull()
    })
})

const BASE = "http://192.168.1.20:8080"
const STREAM = `${BASE}/api/v1/directstream/stream?id=abc`

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
        expect(castTitle("", "")).toBe("Seanime Mobile")
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
