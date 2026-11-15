import { castStreamUrl, withQueryValues } from "@/api/hooks/dlna_cast.helpers"
import type { Translate } from "@/lib/app-language"
import type { CastKind } from "@/lib/cast/cast-state"
import { mpvIdToMkvNumber } from "./player-logic"

/*
 * Rules of the player's cast panel (web video-core-cast.tsx), without React: which stream can go to a TV, which tracks it
 * carries, how the panel names devices, and what the phone does when casting ends. The session itself is
 * lib/cast/cast-controller.ts (DLNA in Go, Google Cast through react-native-google-cast).
 */

type MkvTracks = { number: number }[] | null | undefined

/**
 * The file's track numbers for the TV from mpv's track IDs (mpv counts each kind from 1 in file order; added subtitle files
 * come after the file's own). Audio: null leaves the TV its own choice (no metadata, nothing picked, a track not in the
 * file). Subtitles: -1 = none, also for a subtitle file added here (the TV cannot get it); null without metadata.
 */
export function castTrackNumbers(mkvAudio: MkvTracks, mkvSubs: MkvTracks, audioId: number, subId: number) {
    const audio = mkvAudio?.length && audioId > 0 ? mpvIdToMkvNumber(mkvAudio, audioId) : -1
    const subtitleTrack = mkvSubs ? (subId > 0 ? mpvIdToMkvNumber(mkvSubs, subId) : -1) : null
    return { audioTrack: audio >= 0 ? audio : null, subtitleTrack }
}

/** The core's torrent stream for this player (phase 6b-2): `http://127.0.0.1:<port>/<token>/<info hash>/<index>/<name>` */
const CORE_TORRENT_STREAM = /^http:\/\/127\.0\.0\.1:\d{1,5}\/[0-9a-f]{32}\/[0-9a-f]{40}\/\d+\/[^/?#]+$/

/**
 * The stream the player hands to the cast panel (phase 7c-2), null = the cast button stays off. Only what the core's
 * outlet can share into the Wi-Fi (core/cast/cast.ts castSource): a file of the device (offline episode, local library,
 * `file://` or a path) and the core's torrent stream. Not an online stream or a file that needs request headers (a
 * Nakama host's token): the TV cannot send them, that needs a forwarder of its own. The URL goes as it is: the outlet
 * has no track remux (the server's ?audioTrack is gone since phase 7b), the TV plays the file's own default tracks.
 */
export function playerCastUrl(streamUrl: string | null | undefined, { online, headers }: { online: boolean, headers?: Record<string, string> }) {
    if (!streamUrl || online || (headers && Object.keys(headers).length > 0)) return null
    if (/^file:\/\/\//i.test(streamUrl) || streamUrl.startsWith("/")) return streamUrl
    return CORE_TORRENT_STREAM.test(streamUrl) ? streamUrl : null
}

/** The stream for the TV with the tracks playing here (?audioTrack / ?subtitleTrack, backend directstream/audiotrack.go). */
export function castUrlWithTracks(url: string, tracks: { audioTrack: number | null, subtitleTrack: number | null }) {
    return castStreamUrl(url, tracks)
}

function withoutTracks(url: string) {
    return withQueryValues(url, { audioTrack: null, subtitleTrack: null })
}

/**
 * What the TV does when the stream here changes while it plays. "adopt": a cast found running (app restart) keeps its
 * video, the stream here is only remembered. "switch": other tracks of the same video, the TV goes on where it is.
 * "load": another episode here (remote's "Next episode" or the bar's buttons), the TV plays it from the start.
 */
export function castFollowUp(sent: string | null, current: string | null): "none" | "adopt" | "switch" | "load" {
    if (!current || sent === current) return "none"
    if (sent === null) return "adopt"
    return withoutTracks(sent) === withoutTracks(current) ? "switch" : "load"
}

/** "Dr. STONE · Episode 3" for the TV's screen; "Seanime Mobile" without either. */
export function castTitle(animeTitle: string | null | undefined, episodeTitle: string | null | undefined) {
    return [animeTitle, episodeTitle].filter(Boolean).join(" · ") || "Seanime Mobile"
}

/** Which way the video goes; LG webOS TVs only come over DLNA (the controller leaves out their Google Cast entry). */
export function castKindLabel(kind: CastKind | undefined, t: Translate) {
    switch (kind) {
        case "webos":
            return t("LG webOS · direct (DLNA)", "LG webOS · direkt (DLNA)")
        case "googlecast":
            // the Cast receiver plays the file's audio and picture, but not its subtitles
            return t("Google Cast (Google TV, Chromecast) · no subtitles", "Google Cast (Google TV, Chromecast) · ohne Untertitel")
        default:
            return t("Smart TV · direct (DLNA)", "Smart-TV · direkt (DLNA)")
    }
}

/** The TV's place and state: every second with the panel open, else every 5 s to notice the end. */
export function castPollMs(panelOpen: boolean) {
    return panelOpen ? 1000 : 5000
}

/** Volume buttons: steps of 5 within 0…100; unknown volume (-1, webOS) has no buttons. */
export function castVolumeStep(volume: number, delta: number) {
    return Math.min(100, Math.max(0, volume + delta))
}

/** When casting stopped: where the phone goes on (seconds, null = stay) and whether it plays. */
export function phoneAfterCast(stopped: { positionMs: number, resume: boolean } | undefined) {
    if (!stopped) return null
    return { seekTo: stopped.positionMs > 0 ? stopped.positionMs / 1000 : null, play: stopped.resume }
}

/** The seek bar shows the finger while dragging, else the TV; never past the end. */
export function castSeekValue(dragMs: number | null, positionMs: number, durationMs: number) {
    const max = Math.max(durationMs, 1)
    return Math.min(Math.max(dragMs ?? positionMs, 0), max)
}
