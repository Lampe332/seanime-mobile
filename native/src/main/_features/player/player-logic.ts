import type { Translate } from "@/lib/app-language"

/*
 * Pure rules of the app's player (E3). No React, no native module: the player screen calls these, the tests in
 * player-logic.test.ts check them. Values come from the old player:
 * - centre buttons −5/+10 s (video-core-control-bar.tsx), double tap the same (E3 brief: −5/+10); both steps can be
 *   changed in the settings (Playback → Player), to one of SEEK_STEP_OPTIONS
 * - DOUBLE_TAP_MS 280, LONG_PRESS_MS 450, HIDE_DELAY_MS 5000, long press = 2x (VideoControlInjector.kt)
 * - the time bar only scrubs after 10 px sideways; a vertical swipe or a cancelled touch never moves the video
 *   (video-core-time-range.tsx TOUCH_SLOP_PX)
 * - swipes change nothing: no swipe-to-seek (Nick's wish) and no brightness/volume swipes (Nick 24.11.)
 * - "video-completed" (the server's AniList update) once at 80 % (video-core.tsx handleTimeUpdate)
 * - auto next counts down 5 s (AUTO_NEXT_SECONDS)
 * - picture in picture never during cast and with the ratio clamped to 2.39:1 (PiPManager.kt)
 */

export const SEEK_BACK_SECONDS = 5
export const SEEK_FORWARD_SECONDS = 10
export const SEEK_STEP_OPTIONS = [5, 10, 15, 30] as const
export const DOUBLE_TAP_MS = 280
export const LONG_PRESS_MS = 450
export const HIDE_DELAY_MS = 5000
export const BOOST_RATE = 2
export const SEEKBAR_SLOP_PX = 10
export const AUTO_NEXT_SECONDS = 5
export const COMPLETION_RATIO = 0.8
export const PIP_MAX_RATIO = 2.39

export type Side = "left" | "right"

export function clampTime(time: number, duration: number) {
    const t = Math.max(0, time)
    return duration > 0 && Number.isFinite(duration) ? Math.min(duration, t) : t
}

export function sideOf(x: number, width: number): Side {
    return x < width / 2 ? "left" : "right"
}

/* ── Double tap ─────────────────────────────────────────────────────────── */

export type TapMemory = { time: number, side: Side } | null

/** A second tap on the same side within DOUBLE_TAP_MS is a double tap; the memory resets after it. */
export function classifyTap(previous: TapMemory, now: number, side: Side): { double: boolean, memory: TapMemory } {
    const double = !!previous && previous.side === side && now - previous.time < DOUBLE_TAP_MS
    return { double, memory: double ? null : { time: now, side } }
}

/** A stored seek step, or the fallback when it is not one of SEEK_STEP_OPTIONS (old or broken value). */
export function seekStep(value: unknown, fallback: number): number {
    return SEEK_STEP_OPTIONS.includes(value as typeof SEEK_STEP_OPTIONS[number]) ? value as number : fallback
}

export function doubleTapSeekSeconds(side: Side, back: number = SEEK_BACK_SECONDS, forward: number = SEEK_FORWARD_SECONDS) {
    return side === "left" ? -seekStep(back, SEEK_BACK_SECONDS) : seekStep(forward, SEEK_FORWARD_SECONDS)
}

/* ── Time bar ───────────────────────────────────────────────────────────── */

export type ScrubState =
    | { phase: "idle" }
    | { phase: "pending", startX: number, startY: number }
    | { phase: "scrubbing", ratio: number }

export const SCRUB_IDLE: ScrubState = { phase: "idle" }

export function scrubDown(x: number, y: number): ScrubState {
    return { phase: "pending", startX: x, startY: y }
}

/** x/width in the bar's own coordinates. A vertical move releases the touch, under 10 px sideways nothing happens. */
export function scrubMove(state: ScrubState, x: number, y: number, width: number): ScrubState {
    if (state.phase === "idle") return state
    if (state.phase === "pending") {
        const dx = x - state.startX
        const dy = y - state.startY
        if (Math.abs(dy) > SEEKBAR_SLOP_PX && Math.abs(dy) > Math.abs(dx)) return SCRUB_IDLE
        if (Math.abs(dx) < SEEKBAR_SLOP_PX) return state
    }
    return { phase: "scrubbing", ratio: ratioAt(x, width) }
}

/**
 * Where the video goes when the finger lifts: a touch that never moved sideways is a tap and jumps to where it landed; a
 * scrub goes to its target. Null = leave the video where it is.
 */
export function scrubUp(state: ScrubState, x: number, width: number, duration: number): number | null {
    if (duration <= 0) return null
    if (state.phase === "pending") return clampTime(ratioAt(x, width) * duration, duration)
    if (state.phase === "scrubbing") return clampTime(state.ratio * duration, duration)
    return null
}

/** Android took the touch over (Home or Back gesture): never a jump. */
export function scrubCancel(): { state: ScrubState, seekTo: null } {
    return { state: SCRUB_IDLE, seekTo: null }
}

function ratioAt(x: number, width: number) {
    if (width <= 0) return 0
    return Math.max(0, Math.min(1, x / width))
}

/* ── Progress ───────────────────────────────────────────────────────────── */

/** True exactly once per episode: the first time playback reaches 80 %. The server then updates AniList. */
export function shouldSendCompleted(alreadySent: boolean, position: number, duration: number) {
    return !alreadySent && duration > 0 && position / duration >= COMPLETION_RATIO
}

/** Progress ticks every 500 ms; even at 4× speed a played step stays below this. */
export const MAX_PLAYED_STEP_S = 5
/** An end more than this before the duration that playback never got near is a broken stream, not a finished episode. */
export const EARLY_END_S = 30

/**
 * The position playback really reached. mpv keeps a stream open at its end (keep-open) when the demuxer gives up on it
 * (e.g. HLS segments it refuses), and the position then jumps to the duration: that jump is no playback, so neither the
 * 80 % mark nor the end may count it. A step forward of at most MAX_PLAYED_STEP_S counts; a seek of the player itself
 * sets the position directly.
 */
export function playedPosition(played: number, previous: number, position: number) {
    const step = position - previous
    return step > 0 && step <= MAX_PLAYED_STEP_S ? position : played
}

/** The stream ended although playback never got near its end (see playedPosition): a playback error. */
export function endedEarly(played: number, duration: number) {
    return duration > EARLY_END_S && duration - played > EARLY_END_S
}

/* ── Auto next and sleep timer ──────────────────────────────────────────── */

export type SleepTimer = number | "episode" | null

export type EndAction = "stop-sleep" | "countdown" | "play-next" | "none"

/**
 * What happens when an episode ends. The sleep timer "end of episode" wins and stops; with auto next the next episode
 * waits for a 5 s countdown when there is one, otherwise the playlist decides (web handleEnded).
 */
export function endAction(sleepTimer: SleepTimer, autoNext: boolean, hasNextEpisode: boolean): EndAction {
    if (sleepTimer === "episode") return "stop-sleep"
    if (!autoNext) return "none"
    return hasNextEpisode ? "countdown" : "play-next"
}

/**
 * Whether the episode still counts as ended after this mpv state. Playing again (after seeking back from the end) makes
 * the next end count again: auto next and the "end of episode" sleep timer fire each time, like the web video's ended event.
 */
export function stillEnded(ended: boolean, state: string): boolean {
    return state === "playing" ? false : ended
}

/** One second of the countdown. "play" when it ran out, null = cancelled/none. */
export function countdownTick(seconds: number | null): { seconds: number | null, play: boolean } {
    if (seconds === null) return { seconds: null, play: false }
    if (seconds <= 1) return { seconds: null, play: true }
    return { seconds: seconds - 1, play: false }
}

/** A sleep timer in minutes, as the time it ends; "episode" stops at the end of the episode. */
export function sleepTimerFrom(choice: number | "episode" | null, now: number): SleepTimer {
    if (choice === null || choice === "episode") return choice
    return now + choice * 60_000
}

export function sleepTimerRemainingMs(timer: SleepTimer, now: number) {
    return typeof timer === "number" ? Math.max(0, timer - now) : null
}

/** The minutes picked for the running timer (the sleep page marks that option); null once it ran out, was changed or is off. */
export type SleepPick = { until: number, minutes: number }

export function sleepTimerChoice(timer: SleepTimer, pick: SleepPick | null): number | null {
    return pick && typeof timer === "number" && pick.until === timer ? pick.minutes : null
}

/* ── Skip segments (AniSkip or the file's chapters) ─────────────────────── */

export type SkipSegment = { start: number, end: number, label: string }

export type AniSkipLike = {
    op?: { interval?: { startTime: number, endTime: number } | null } | null
    ed?: { interval?: { startTime: number, endTime: number } | null } | null
} | undefined | null

/** Opening and ending from AniSkip, clamped to the duration (an opening that starts within 5 s starts at 0). */
export function aniSkipSegments(data: AniSkipLike, duration: number): SkipSegment[] {
    if (duration <= 0 || !data) return []
    const clamp = (t: number) => Math.min(duration, Math.max(0, t))
    const out: SkipSegment[] = []
    const op = data.op?.interval
    if (op) {
        const start = op.startTime > 5 ? clamp(op.startTime) : 0
        const end = clamp(op.endTime)
        if (end > start) out.push({ start, end, label: "Opening" })
    }
    const ed = data.ed?.interval
    if (ed) {
        const start = clamp(ed.startTime)
        const end = clamp(ed.endTime)
        if (end > start) out.push({ start, end, label: "Ending" })
    }
    return out
}

export function activeSkipSegment(segments: SkipSegment[], position: number) {
    return segments.find(s => position >= s.start && position < s.end) ?? null
}

/* ── Tracks ─────────────────────────────────────────────────────────────── */

/**
 * mpv adds subtitle files one after another on its own thread, each fetched over the network (an online stream brings
 * a dozen), and expo-mpv gives up on a track list read after 3 s with an empty list. A file always has a track, so an
 * empty list is read again (S22 06.11.: KickAssAnime, menu showed audio and subtitles "Off" while both played).
 */
export const TRACK_LIST_READS = 6

export async function readTrackList<T>(read: () => Promise<T[]>, alive: () => boolean, wait = (ms: number) => new Promise(r => setTimeout(r, ms))) {
    let list: T[] = []
    for (let i = 0; i < TRACK_LIST_READS && alive(); i++) {
        if (i > 0) await wait(1000)
        list = await read().catch(() => [])
        if (list.length > 0) break
    }
    return list
}

export type PlayerTrack = { id: number, type: string, lang: string, title: string, isDefault?: boolean, codec?: string, external?: boolean }

/** An entry of mpv's track list as the player keeps it (external = a file added with sub-add/audio-add) */
export function toPlayerTrack(tr: { id: number, type: string, lang?: string | null, title?: string | null, isDefault?: boolean, codec?: string, isExternal?: boolean }): PlayerTrack {
    return { id: tr.id, type: tr.type, lang: tr.lang ?? "", title: tr.title ?? "", isDefault: tr.isDefault, codec: tr.codec, external: tr.isExternal }
}

/** Language lists like "jpn,jp,jap,japanese" (video-core settings), lower case, in order. */
export function languageList(value: string | null | undefined) {
    return (value ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean)
}

function matchesLanguage(track: PlayerTrack, language: string) {
    const lang = track.lang.toLowerCase()
    const title = track.title.toLowerCase()
    return lang === language || (language.length > 3 && title.includes(language))
}

/**
 * The track to start with: the language remembered for this anime first, then the preferred languages in their order.
 * A remembered "off" or "none" in the preferred list (subtitles) returns -1. Without a match, subtitles fall back like the
 * web player (getDefaultSubtitleTrackNumber): the track flagged default, else the first one – mpv alone would show none for
 * a file without default flags (Tablet: no subtitles on a German-only file). Null = keep mpv's own choice (audio).
 * `blacklist` (the settings' "Subtitle blacklist", lower case): subtitle tracks whose name contains an entry are never
 * picked automatically while another track is left (getDefaultSubtitleTrackNumber).
 */
export function pickTrack(tracks: PlayerTrack[], type: "audio" | "sub", remembered: string | null | undefined, preferred: string[], blacklist: string[] = []) {
    let ofType = tracks.filter(t => t.type === type)
    if (type === "sub" && blacklist.length && ofType.length > 1) {
        ofType = ofType.filter(t => !t.title || !blacklist.some(entry => t.title.toLowerCase().includes(entry)))
    }
    if (remembered === "off" && type === "sub") return -1
    if (remembered) {
        const hit = ofType.find(t => t.lang.toLowerCase() === remembered.toLowerCase())
        if (hit) return hit.id
    }
    for (const language of preferred) {
        if (type === "sub" && language === "none") return -1
        const hit = ofType.find(t => matchesLanguage(t, language))
        if (hit) return hit.id
    }
    if (type === "sub" && ofType.length) return (ofType.find(t => t.isDefault) ?? ofType[0]).id
    return null
}

/**
 * The server names tracks by their MKV track number (set-audio-track / set-subtitle-track); mpv counts each type from 1
 * in file order. -1 stays "no track". Null = unknown number.
 */
export function mkvNumberToMpvId(tracksOfType: { number: number }[] | null | undefined, number: number) {
    if (number === -1) return -1
    const sorted = (tracksOfType ?? []).map(t => t.number).sort((a, b) => a - b)
    const index = sorted.indexOf(number)
    return index === -1 ? null : index + 1
}

export function mpvIdToMkvNumber(tracksOfType: { number: number }[] | null | undefined, id: number) {
    if (id <= 0) return -1
    const sorted = (tracksOfType ?? []).map(t => t.number).sort((a, b) => a - b)
    return sorted[id - 1] ?? -1
}

export type TrackMemory = Record<string, { audio?: string, sub?: string }>

/** Remembers the language of a picked track for this anime ("off" for no subtitles). */
export function rememberTrack(memory: TrackMemory, mediaId: number, type: "audio" | "sub", track: PlayerTrack | null): TrackMemory {
    const key = String(mediaId)
    const value = track ? track.lang.toLowerCase() : "off"
    if (track && !value) return memory
    return { ...memory, [key]: { ...memory[key], [type]: value } }
}

/**
 * mpv options that must be set before a file opens. A long ASS line that starts well before the start/seek position
 * (Formattest "lange Zeile vor Sprungziel": 0:00–1:50, resumed at 0:33) stayed invisible: mpv prerolls subtitles only
 * 10 s back (preroll-secs-index). With the index info ffmpeg/mkvmerge write, it reads just the needed clusters, so
 * 90 s costs extra reading only when such a line exists.
 */
export const MPV_OPEN_OPTIONS: [string, string][] = [
    ["demuxer-mkv-subtitle-preroll-secs-index", "90"],
    // the volume boost of the player settings goes up to 300 % (media-core-volume-boost VOLUME_BOOST_MAX)
    ["volume-max", "300"],
]

/**
 * The mpv option for a stream whose provider wants its own headers (Referer, Origin, User-Agent), used when the stream
 * is played without the server's proxy (core area "streams", docs/EIGENER-KERN.md). mpv sends these fields with every
 * request of the stream: playlist, keys, segments and subtitle files. `http-header-fields` is a list separated by
 * commas, so a comma inside a value ("(KHTML, like Gecko)") is escaped. undefined = the stream comes through the proxy:
 * nothing is set. {} clears the fields of the stream before.
 */
export function mpvHeaderOptions(headers: Record<string, string> | undefined): [string, string][] {
    if (!headers) return []
    const fields = Object.entries(headers)
        .filter(([name, value]) => !!name.trim() && !/[\r\n]/.test(name + value))
        .map(([name, value]) => `${name.trim()}: ${value}`.replace(/,/g, "\\,"))
    return [["http-header-fields", fields.join(",")]]
}

/**
 * The headers a played file brings (`requestHeaders`, a file of a Nakama host: its token, phase 7e), else {} so that the
 * fields of a stream before are cleared; undefined while nothing plays.
 */
export function streamHeadersOf(info: unknown): Record<string, string> | undefined {
    if (!info || typeof info !== "object") return undefined
    const headers = (info as { requestHeaders?: unknown }).requestHeaders
    if (!headers || typeof headers !== "object") return {}
    return Object.fromEntries(Object.entries(headers).filter((pair): pair is [string, string] => typeof pair[1] === "string"))
}

/* ── Lock screen, notification, headset: next/previous episode ──────────── */

/**
 * The queue for the system media controls (MediaSessionBridge.setQueue): next/previous are offered only while the
 * player has that episode. expo-mpv (patched, native/patches) reads these metadata strings.
 */
export function sessionQueue(hasNext: boolean, hasPrevious: boolean) {
    return { hasNext: hasNext ? "true" : "false", hasPrevious: hasPrevious ? "true" : "false" }
}

/** A press from the media session runs like the bar buttons; a stale press for an episode that is gone does nothing. */
export function remoteEpisode(command: string, hasNext: boolean, hasPrevious: boolean): "next" | "previous" | null {
    if (command === "next") return hasNext ? "next" : null
    if (command === "previous") return hasPrevious ? "previous" : null
    return null
}

/* ── Picture in picture ─────────────────────────────────────────────────── */

export function canEnterPip(isCasting: boolean, hasVideo: boolean) {
    return !isCasting && hasVideo
}

/** Width/height of the PiP window: the video's ratio, kept within 1/2.39 … 2.39 (Android rejects wider ratios). */
export function pipAspectRatio(width: number, height: number) {
    const ratio = width > 0 && height > 0 ? width / height : 16 / 9
    return Math.max(1 / PIP_MAX_RATIO, Math.min(PIP_MAX_RATIO, ratio))
}

/* ── Playback state ─────────────────────────────────────────────────────── */

/**
 * Whether mpv plays, from expo-mpv's onPlaybackStateChange. Its isPlaying can stay false for a playing file: the first
 * "pause" property event arrives before the source is set (isPlaying = hasSource && !pause) and the later file-loaded
 * event does not send the state again (S22, expo-mpv 0.1.27). So "playing"/"paused"/"ended"/"idle" decide; only while
 * loading or buffering the flag counts.
 */
export function isPlayingState(state: string, isPlaying: boolean) {
    if (state === "playing") return true
    if (state === "paused" || state === "ended" || state === "idle") return false
    return isPlaying
}

/* ── Time ───────────────────────────────────────────────────────────────── */

export function formatTime(seconds: number) {
    const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = String(s % 60).padStart(2, "0")
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`
}

/** mpv properties for the settings' picture fit: whole picture, zoomed to fill (crops the edges) or stretched */
export function pictureFitProperties(fit: "contain" | "cover" | "fill"): [string, string][] {
    return [["keepaspect", fit === "fill" ? "no" : "yes"], ["panscan", fit === "cover" ? "1.0" : "0.0"]]
}

/**
 * The player's title: the episode's own title, but the core's plain "Episode N" (library, torrent, debrid) in the app's
 * language; without a title "Episode N" of the progress number.
 */
export function playerEpisodeTitle(displayTitle: string | undefined, progressNumber: number | undefined, t: Translate): string {
    const plain = displayTitle?.match(/^Episode (\d+)$/)
    const number = plain ? Number(plain[1]) : !displayTitle ? progressNumber : undefined
    if (number) return t(`Episode ${number}`, `Folge ${number}`)
    return displayTitle ?? ""
}
