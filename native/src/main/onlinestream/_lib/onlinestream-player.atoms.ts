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
