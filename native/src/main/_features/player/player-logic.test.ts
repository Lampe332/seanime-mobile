import { describe, expect, it } from "vitest"
import {
    activeSkipSegment,
    pictureFitProperties,
    aniSkipSegments,
    AUTO_NEXT_SECONDS,
    canEnterPip,
    classifyTap,
    countdownTick,
    doubleTapSeekSeconds,
    seekBase,
    SEEK_SETTLE_MS,
    SEEK_STREAK_MS,
    seekStep,
    endAction,
    endedEarly,
    formatTime,
    isPlayingState,
    languageList,
    mkvNumberToMpvId,
    mpvHeaderOptions,
    mpvIdToMkvNumber,
    mpvTrackValue,
    pickTrack,
    pipAspectRatio,
    playedPosition,
    remoteEpisode,
    type PlayerTrack,
    readTrackList,
    rememberTrack,
    sessionQueue,
    SCRUB_IDLE,
    scrubCancel,
    scrubDown,
    scrubMove,
    scrubUp,
    shouldSendCompleted,
    TRACK_LIST_READS,
    playsFromStart,
    stillEnded,
    sleepTimerChoice,
    sleepTimerFrom,
    sleepTimerRemainingMs,
    playerEpisodeTitle,
} from "./player-logic"
import { colourProperties, subtitleLookProperties } from "./player-menu-logic"
import { vc_initialSettings } from "@/main/_features/video-core/video-core.atoms"

describe("time bar", () => {
    it("does not scrub before 10 px sideways", () => {
        let s = scrubDown(100, 20)
        s = scrubMove(s, 109, 21, 400)
        expect(s.phase).toBe("pending")
        s = scrubMove(s, 110, 21, 400)
        expect(s).toEqual({ phase: "scrubbing", ratio: 110 / 400 })
    })

    it("a vertical swipe on the bar releases it and never seeks", () => {
        let s = scrubDown(100, 50)
        s = scrubMove(s, 103, 20, 400)
        expect(s).toEqual(SCRUB_IDLE)
        expect(scrubUp(s, 103, 400, 1440)).toBeNull()
    })

    it("cancel (Android Home/Back gesture) never jumps, even while scrubbing", () => {
        let s = scrubDown(10, 0)
        s = scrubMove(s, 300, 0, 400)
        expect(s.phase).toBe("scrubbing")
        expect(scrubCancel()).toEqual({ state: SCRUB_IDLE, seekTo: null })
    })

    it("lifting after a scrub seeks to the target, a tap jumps to where it landed", () => {
        let s = scrubDown(0, 0)
        s = scrubMove(s, 200, 0, 400)
        expect(scrubUp(s, 200, 400, 1000)).toBe(500)
        expect(scrubUp(scrubDown(100, 0), 100, 400, 1000)).toBe(250)
    })

    it("clamps the target into the video", () => {
        let s = scrubDown(0, 0)
        s = scrubMove(s, 900, 0, 400)
        expect(scrubUp(s, 900, 400, 1000)).toBe(1000)
    })
})

describe("double tap", () => {
    it("two taps on the same side within 280 ms seek −5 / +10", () => {
        const first = classifyTap(null, 1000, "left")
        expect(first.double).toBe(false)
        const second = classifyTap(first.memory, 1200, "left")
        expect(second.double).toBe(true)
        expect(second.memory).toEqual({ time: 1200, side: "left", streak: true })
        expect(doubleTapSeekSeconds("left")).toBe(-5)
        expect(doubleTapSeekSeconds("right")).toBe(10)
    })

    it("double taps and centre buttons use the chosen seek steps, unknown values fall back to −5 / +10", () => {
        expect(doubleTapSeekSeconds("left", 15, 30)).toBe(-15)
        expect(doubleTapSeekSeconds("right", 15, 30)).toBe(30)
        expect(doubleTapSeekSeconds("left", 7, 0)).toBe(-5)
        expect(doubleTapSeekSeconds("right", 7, 0)).toBe(10)
        expect(seekStep(30, 10)).toBe(30)
        expect(seekStep("15", 10)).toBe(10)
    })

    it("too slow or the other side is not a double tap", () => {
        const first = classifyTap(null, 0, "right")
        expect(classifyTap(first.memory, 280, "right").double).toBe(false)
        expect(classifyTap(first.memory, 100, "left").double).toBe(false)
    })

    it("fast further taps on the same side keep seeking, a pause or the other side ends the streak", () => {
        let tap = classifyTap(null, 0, "right")
        tap = classifyTap(tap.memory, 200, "right")
        expect(tap.double).toBe(true)
        // 3rd and 4th tap: each seeks again, measured from the tap before
        tap = classifyTap(tap.memory, 600, "right")
        expect(tap.double).toBe(true)
        tap = classifyTap(tap.memory, 1050, "right")
        expect(tap.double).toBe(true)
        // the other side starts fresh: a single tap there
        const other = classifyTap(tap.memory, 1200, "left")
        expect(other.double).toBe(false)
        expect(other.memory?.streak).toBe(false)
        // a pause of SEEK_STREAK_MS ends the streak: the next tap is a single tap again
        const late = classifyTap(tap.memory, 1050 + SEEK_STREAK_MS, "right")
        expect(late.double).toBe(false)
        expect(late.memory?.streak).toBe(false)
    })

    it("counts the gap between the touches themselves, not when JS handled them", () => {
        // touch timestamps 150 ms apart are a double tap, even when JS saw both at the same moment after a stall
        const first = classifyTap(null, 50_000, "left")
        expect(classifyTap(first.memory, 50_150, "left").double).toBe(true)
        // a clock going back (other time base) is never a double tap
        expect(classifyTap(first.memory, 49_900, "left").double).toBe(false)
    })

    it("a second relative seek starts at the first one's target until mpv reports the new position", () => {
        expect(seekBase(100, null, 5000)).toBe(100)
        expect(seekBase(100, { time: 110, at: 5000 }, 5200)).toBe(110)
        expect(seekBase(100, { time: 110, at: 5000 }, 5000 + SEEK_SETTLE_MS)).toBe(100)
        expect(seekBase(100, { time: 110, at: 5000 }, 4000)).toBe(100)
    })
})


describe("AniList progress only at the end", () => {
    it("sends video-completed once at 80 %, never below", () => {
        expect(shouldSendCompleted(false, 79.9, 100)).toBe(false)
        expect(shouldSendCompleted(false, 80, 100)).toBe(true)
        expect(shouldSendCompleted(true, 95, 100)).toBe(false)
        expect(shouldSendCompleted(false, 10, 0)).toBe(false)
    })

    // S22 06.11.: a KickAssAnime HLS stream whose segments mpv refused jumped from 0:03 to 24:01 and "ended"; the
    // player counted it as watched and auto next ran through episodes 1–8
    it("does not count a jump of a broken stream to its end as played", () => {
        let played = 0
        let previous = 0
        for (const p of [0.5, 1, 1.5, 2, 2.5, 3, 1441]) {
            played = playedPosition(played, previous, p)
            previous = p
        }
        expect(played).toBe(3)
        // ticks at the end after the jump do not move it either
        expect(playedPosition(played, 1441, 1441)).toBe(3)
        expect(shouldSendCompleted(false, played, 1441)).toBe(false)
        expect(endedEarly(played, 1441)).toBe(true)
    })

    it("counts normal playback, fast playback and a start further in", () => {
        expect(playedPosition(100, 100, 100.5)).toBe(100.5)
        expect(playedPosition(100, 100, 102)).toBe(102)
        // continuity start at 600 s: the first tick is a jump, the next one counts
        expect(playedPosition(0, 0, 600)).toBe(0)
        expect(playedPosition(0, 600, 600.5)).toBe(600.5)
        // backwards (rewind outside seekTo) keeps the last played position
        expect(playedPosition(300, 300, 250)).toBe(300)
    })

    it("an end near the duration or of a short clip is a real end", () => {
        expect(endedEarly(1420, 1441)).toBe(false)
        expect(endedEarly(39.5, 40)).toBe(false)
        expect(endedEarly(3, 25)).toBe(false)
        expect(endedEarly(0, 0)).toBe(false)
    })
})

describe("auto next and sleep timer", () => {
    it("the episode sleep timer stops instead of playing on", () => {
        expect(endAction("episode", true, true)).toBe("stop-sleep")
        expect(endAction(null, true, true)).toBe("countdown")
        expect(endAction(null, true, false)).toBe("play-next")
        expect(endAction(Date.now() + 1000, false, true)).toBe("none")
    })
    it("a closed player starts nothing: no countdown, no next episode", () => {
        expect(endAction(null, true, true, true)).toBe("none")
        expect(endAction(null, true, false, true)).toBe("none")
        expect(endAction("episode", true, true, true)).toBe("none")
    })

    it("an end counts again once the episode plays on from earlier (device run 06.11.: seek back, second end did nothing)", () => {
        expect(stillEnded(true, "playing")).toBe(false)
        expect(stillEnded(true, "paused")).toBe(true)
        expect(stillEnded(true, "buffering")).toBe(true)
        expect(stillEnded(false, "ended")).toBe(false)
    })

    it("Play on the last frame of a finished file starts it again (device run 26.11.: Play at 0:09/0:10 did nothing)", () => {
        expect(playsFromStart(true, 10, 10)).toBe(true)
        expect(playsFromStart(true, 9.6, 10)).toBe(true)
        expect(playsFromStart(true, 9, 10)).toBe(false)
        expect(playsFromStart(false, 10, 10)).toBe(false)
        expect(playsFromStart(true, 0, 0)).toBe(false)
    })

    it("counts down 5 seconds, then plays; cancelled stays cancelled", () => {
        let s: number | null = AUTO_NEXT_SECONDS
        let ticks = 0
        let played = false
        while (s !== null) {
            const r = countdownTick(s)
            s = r.seconds
            played = r.play
            ticks++
        }
        expect(ticks).toBe(5)
        expect(played).toBe(true)
        expect(countdownTick(null)).toEqual({ seconds: null, play: false })
    })

    it("minutes become an end time, episode stays episode", () => {
        expect(sleepTimerFrom(30, 1000)).toBe(1000 + 30 * 60_000)
        expect(sleepTimerFrom("episode", 1000)).toBe("episode")
        expect(sleepTimerRemainingMs(5000, 2000)).toBe(3000)
        expect(sleepTimerRemainingMs("episode", 2000)).toBeNull()
    })
})

describe("track memory per anime", () => {
    const tracks: PlayerTrack[] = [
        { id: 1, type: "audio", lang: "jpn", title: "Japanese" },
        { id: 2, type: "audio", lang: "eng", title: "English" },
        { id: 1, type: "sub", lang: "eng", title: "Full" },
        { id: 2, type: "sub", lang: "ger", title: "Deutsch" },
    ]

    it("the remembered language wins over the preferred order", () => {
        expect(pickTrack(tracks, "audio", "eng", languageList("jpn,jp"))).toBe(2)
        expect(pickTrack(tracks, "sub", "ger", languageList("en,eng"))).toBe(2)
    })

    it("falls back to the preferred languages in their order", () => {
        expect(pickTrack(tracks, "audio", null, languageList("jpn,jp,jap,japanese"))).toBe(1)
        expect(pickTrack(tracks, "sub", "fre", languageList("ger, eng"))).toBe(2)
        expect(pickTrack(tracks, "audio", null, languageList("spa"))).toBeNull()
    })

    it("shows subtitles without a preferred match like the web player: default track, else the first, unless none", () => {
        expect(pickTrack(tracks, "sub", null, languageList("spa"))).toBe(1)
        const flagged = tracks.map(t => t.type === "sub" && t.id === 2 ? { ...t, isDefault: true } : t)
        expect(pickTrack(flagged, "sub", null, languageList("spa"))).toBe(2)
        expect(pickTrack(tracks, "sub", null, languageList("none"))).toBe(-1)
        expect(pickTrack(tracks.filter(t => t.type === "audio"), "sub", null, ["eng"])).toBeNull()
    })

    it("skips blacklisted subtitle tracks while another is left (Subtitle blacklist)", () => {
        const signs: PlayerTrack[] = [
            { id: 1, type: "sub", lang: "eng", title: "Signs & Songs", isDefault: true },
            { id: 2, type: "sub", lang: "eng", title: "Full Subtitles" },
        ]
        expect(pickTrack(signs, "sub", null, ["eng"])).toBe(1)
        expect(pickTrack(signs, "sub", null, ["eng"], ["signs & songs"])).toBe(2)
        expect(pickTrack(signs, "sub", null, ["spa"], ["signs"])).toBe(2)
        // a single track stays, whatever its name
        expect(pickTrack(signs.slice(0, 1), "sub", null, ["eng"], ["signs"])).toBe(1)
    })

    it("remembers off for subtitles and the language per anime", () => {
        let memory = rememberTrack({}, 21, "sub", null)
        expect(pickTrack(tracks, "sub", memory["21"].sub, ["eng"])).toBe(-1)
        memory = rememberTrack(memory, 21, "audio", tracks[1])
        memory = rememberTrack(memory, 99, "audio", tracks[0])
        expect(memory).toEqual({ "21": { sub: "off", audio: "eng" }, "99": { audio: "jpn" } })
    })

    it("turns subtitles off with sid=no, never mpv's -1 (= auto, which shows the default subtitle again)", () => {
        expect(mpvTrackValue(-1)).toBe("no")
        expect(mpvTrackValue(0)).toBe("no")
        expect(mpvTrackValue(3)).toBe("3")
        // a remembered "off" on the next load sends the same "no"
        const off = rememberTrack({}, 21, "sub", null)["21"].sub
        expect(mpvTrackValue(pickTrack(tracks, "sub", off, ["eng"]) ?? 0)).toBe("no")
    })

    it("the look applied on load and on every track change never selects or hides a track", () => {
        const sent = [
            ...(["ass", "text", null] as const).flatMap(kind => subtitleLookProperties(vc_initialSettings, kind, 1)),
            ...(["contain", "cover", "fill"] as const).flatMap(pictureFitProperties),
            ...colourProperties(true, vc_initialSettings.videoEnhancement),
        ].map(([name]) => name)
        expect(sent.filter(name => ["sid", "sub", "secondary-sid", "sub-visibility", "sub-auto"].includes(name))).toEqual([])
    })
})

describe("track list read", () => {
    const noWait = () => Promise.resolve()

    it("reads again while mpv is still adding subtitle files (empty list)", async () => {
        const answers: number[][] = [[], [], [1, 2]]
        let reads = 0
        const list = await readTrackList(() => Promise.resolve(answers[reads++]), () => true, noWait)
        expect(list).toEqual([1, 2])
        expect(reads).toBe(3)
    })

    it("stops after TRACK_LIST_READS, on errors and when the view is gone", async () => {
        let reads = 0
        expect(await readTrackList(() => {
            reads++
            return Promise.reject(new Error("timeout"))
        }, () => true, noWait)).toEqual([])
        expect(reads).toBe(TRACK_LIST_READS)
        reads = 0
        expect(await readTrackList(() => Promise.resolve([] as number[]), () => reads++ < 1, noWait)).toEqual([])
    })
})

describe("server track numbers", () => {
    it("maps MKV track numbers to mpv ids and back", () => {
        const subs = [{ number: 5 }, { number: 3 }, { number: 4 }]
        expect(mkvNumberToMpvId(subs, 3)).toBe(1)
        expect(mkvNumberToMpvId(subs, 5)).toBe(3)
        expect(mkvNumberToMpvId(subs, -1)).toBe(-1)
        expect(mkvNumberToMpvId(subs, 9)).toBeNull()
        expect(mpvIdToMkvNumber(subs, 2)).toBe(4)
        expect(mpvIdToMkvNumber(subs, 0)).toBe(-1)
    })
})

describe("lock screen next/previous episode", () => {
    it("offers only what the player has", () => {
        expect(sessionQueue(true, false)).toEqual({ hasNext: "true", hasPrevious: "false" })
        expect(sessionQueue(false, true)).toEqual({ hasNext: "false", hasPrevious: "true" })
        expect(sessionQueue(false, false)).toEqual({ hasNext: "false", hasPrevious: "false" })
    })

    it("a press plays that episode, a stale or unknown press nothing", () => {
        expect(remoteEpisode("next", true, false)).toBe("next")
        expect(remoteEpisode("previous", true, true)).toBe("previous")
        expect(remoteEpisode("next", false, true)).toBeNull()
        expect(remoteEpisode("previous", true, false)).toBeNull()
        expect(remoteEpisode("stop", true, true)).toBeNull()
    })
})

describe("picture in picture", () => {
    it("never during cast", () => {
        expect(canEnterPip(true, true)).toBe(false)
        expect(canEnterPip(false, true)).toBe(true)
        expect(canEnterPip(false, false)).toBe(false)
    })

    it("clamps the ratio to 2.39:1", () => {
        expect(pipAspectRatio(1920, 1080)).toBeCloseTo(16 / 9)
        expect(pipAspectRatio(3840, 1080)).toBe(2.39)
        expect(pipAspectRatio(100, 1000)).toBeCloseTo(1 / 2.39)
        expect(pipAspectRatio(0, 0)).toBeCloseTo(16 / 9)
    })
})

describe("skip segments", () => {
    it("builds opening and ending from AniSkip", () => {
        const segments = aniSkipSegments({ op: { interval: { startTime: 3, endTime: 92 } }, ed: { interval: { startTime: 1300, endTime: 1390 } } }, 1420)
        expect(segments).toEqual([{ start: 0, end: 92, label: "Opening" }, { start: 1300, end: 1390, label: "Ending" }])
        expect(activeSkipSegment(segments, 50)?.label).toBe("Opening")
        expect(activeSkipSegment(segments, 92)).toBeNull()
        expect(aniSkipSegments(undefined, 100)).toEqual([])
    })
})

describe("time format", () => {
    it("formats like the old player", () => {
        expect(formatTime(65)).toBe("1:05")
        expect(formatTime(3725)).toBe("1:02:05")
        expect(formatTime(Number.NaN)).toBe("0:00")
    })
})

describe("playback state", () => {
    it("trusts mpv's state over its isPlaying flag", () => {
        // expo-mpv can report "playing" with isPlaying false (pause event before the source was set)
        expect(isPlayingState("playing", false)).toBe(true)
        expect(isPlayingState("paused", true)).toBe(false)
        expect(isPlayingState("ended", true)).toBe(false)
        expect(isPlayingState("idle", true)).toBe(false)
        expect(isPlayingState("buffering", true)).toBe(true)
        expect(isPlayingState("loading", false)).toBe(false)
    })
})

describe("pictureFitProperties", () => {
    it("keeps, crops or stretches the picture like the settings' Picture page", () => {
        expect(pictureFitProperties("contain")).toEqual([["keepaspect", "yes"], ["panscan", "0.0"], ["sub-ass-force-margins", "no"]])
        expect(pictureFitProperties("cover")).toEqual([["keepaspect", "yes"], ["panscan", "1.0"], ["sub-use-margins", "yes"], ["sub-ass-force-margins", "yes"]])
        expect(pictureFitProperties("fill")).toEqual([["keepaspect", "no"], ["panscan", "0.0"], ["sub-ass-force-margins", "no"]])
    })

    it("zoomed to fill, subtitles are placed on the screen, not on the cropped video's off-screen bottom", () => {
        const look = new Map<string, string>([["sub-use-margins", "no"], ...pictureFitProperties("cover")])
        expect(look.get("sub-use-margins")).toBe("yes")
        const contain = new Map<string, string>([["sub-use-margins", "no"], ...pictureFitProperties("contain")])
        expect(contain.get("sub-use-margins")).toBe("no")
    })
})

describe("stream headers for mpv", () => {
    it("sets nothing for a stream that comes through the proxy", () => {
        expect(mpvHeaderOptions(undefined)).toEqual([])
    })

    it("writes the headers as mpv's list, with commas inside a value escaped", () => {
        expect(mpvHeaderOptions({
            Origin: "https://site.example",
            Referer: "https://site.example/player?id=1&ln=ja-JP",
            "User-Agent": "Mozilla/5.0 (KHTML, like Gecko) Chrome/139.0.0.0",
        })).toEqual([["http-header-fields",
            "Origin: https://site.example,Referer: https://site.example/player?id=1&ln=ja-JP,User-Agent: Mozilla/5.0 (KHTML\\, like Gecko) Chrome/139.0.0.0"]])
    })

    it("clears the list for a source without headers and drops what could split a header", () => {
        expect(mpvHeaderOptions({})).toEqual([["http-header-fields", ""]])
        expect(mpvHeaderOptions({ " ": "x", Referer: "a\r\nX-Injected: 1", Origin: "https://ok.example" }))
            .toEqual([["http-header-fields", "Origin: https://ok.example"]])
    })
})

describe("the player's episode title", () => {
    const de = (_en: string, german: string) => german
    const en = (english: string) => english
    it("translates the core's plain \"Episode N\", keeps a real title", () => {
        expect(playerEpisodeTitle("Episode 4", 4, de)).toBe("Folge 4")
        expect(playerEpisodeTitle("Episode 4", 4, en)).toBe("Episode 4")
        expect(playerEpisodeTitle("The Stone World", 1, de)).toBe("The Stone World")
        expect(playerEpisodeTitle("Special 2", 2, de)).toBe("Special 2")
    })
    it("falls back to the progress number, else nothing", () => {
        expect(playerEpisodeTitle("", 3, de)).toBe("Folge 3")
        expect(playerEpisodeTitle(undefined, undefined, de)).toBe("")
    })
})

describe("the sleep timer's marked option", () => {
    it("is the minutes picked while their timer runs", () => {
        const until = sleepTimerFrom(30, 1_000) as number
        expect(sleepTimerChoice(until, { until, minutes: 30 })).toBe(30)
    })
    it("is none once the timer is off, at the end of the episode or set anew", () => {
        const until = sleepTimerFrom(30, 1_000) as number
        expect(sleepTimerChoice(null, { until, minutes: 30 })).toBeNull()
        expect(sleepTimerChoice("episode", { until, minutes: 30 })).toBeNull()
        expect(sleepTimerChoice(until + 1, { until, minutes: 30 })).toBeNull()
        expect(sleepTimerChoice(until, null)).toBeNull()
    })
})
