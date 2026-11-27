import { useState } from "react"
import type { MobileOfflineDownload_Variables } from "@/api/generated/endpoint.types"
import type { NativePlayer_PlaybackInfo } from "@/api/generated/types"
import { atom } from "jotai"
import type React from "react"
import type { OnlinestreamSubtitlePreference } from "./onlinestream.atoms"

/** VideoCore's onlinestreamParams (backend videocore OnlinestreamParams): the server keeps continuity as "onlinestream". */
export type OnlinestreamParams = {
    mediaId: number
    episodeNumber: number
    provider: string
    server: string
    quality: string
    dubbed: boolean
}

/** What the player tells the online stream page; null once the page is gone (the stream then simply plays on). */
export type OnlinePlayerEvents = {
    loaded: () => void
    time: (seconds: number) => void
    error: (reason: string) => void
    playEpisode: (which: "previous" | "next") => void
    quality: (quality: string) => void
    subtitle: (choice: { language?: string, label?: string } | null) => void
    /** the player closed or another stream took its place */
    closed: () => void
}

/**
 * The online stream in the app's player (web: the inline VideoCore of onlinestream-page.tsx). Written by the online
 * stream page while it plays, read by NativePlayer. streamUrl "" = the page is still getting the source (spinner with
 * loadingState); reload changes when the same URL must load again (after a source refresh).
 */
export type OnlinePlayback = {
    info: NativePlayer_PlaybackInfo
    params: OnlinestreamParams
    reload: number
    /** Set when the stream plays without the server's proxy: the headers mpv has to send itself (player-logic mpvHeaderOptions). */
    headers?: Record<string, string>
    startSeconds?: number
    loadingState: string | null
    playbackError: string | null
    hasNext: boolean
    hasPrevious: boolean
    qualities: string[]
    quality: string | undefined
    subtitlePreference: OnlinestreamSubtitlePreference | undefined
    download: MobileOfflineDownload_Variables | null
    events: React.RefObject<OnlinePlayerEvents | null>
}

export const player_onlineAtom = atom<OnlinePlayback | null>(null)

/**
 * The stream of a page that is gone or hidden (another anime, the anime page left, its Online tab hidden): it plays on
 * without previous/next and reports to nobody. Another page's stream stays as it is.
 */
export function detachedOnline(current: OnlinePlayback | null, events: OnlinePlayback["events"]): OnlinePlayback | null {
    return current?.events === events ? { ...current, hasNext: false, hasPrevious: false, events: { current: null } } : current
}

/** The episode list the page shows: the fetched one, else the one kept for the same anime, provider and audio (`key`). */
export function shownEpisodeList<T>(fetched: T | undefined, kept: { key: string, response: T | undefined } | null, key: string): T | undefined {
    return fetched ?? (kept?.key === key ? kept.response : undefined)
}

/** Keeps the last fetched value per `key`, for a page that stays mounted while its query lets go of the data. */
export function useKeptEpisodeList<T>(fetched: T | undefined, key: string): T | undefined {
    const [kept, setKept] = useState<{ key: string, response: T | undefined } | null>(null)
    if (fetched !== undefined && (kept?.key !== key || kept.response !== fetched)) setKept({ key, response: fetched })
    return shownEpisodeList(fetched, kept, key)
}
