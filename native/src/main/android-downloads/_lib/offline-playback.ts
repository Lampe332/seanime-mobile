import type { NativePlayer_PlaybackInfo } from "@/api/generated/types"
import { offlineArtworkUrl, offlineFileUrl } from "@/api/hooks/mobile_offline.helpers"
import type { OfflineItem } from "./offline-library"

/*
 * Playing a saved episode in the app's player (E3, mpv) instead of the old OfflineActivity/ExoPlayer. The files come from
 * GET /api/v1/mobile-offline/file/{id}/{name}; the position is the offline library's own (POST …/position), as in the old
 * app, which never reported offline playback to AniList or the server's continuity.
 */

export type OfflineSubtitle = { url: string, label: string, language: string, default: boolean }

export type OfflinePlayback = {
    itemId: string
    /** where to start, in seconds */
    startSeconds: number
    /** a separate audio file (HLS downloads with their own audio track) */
    audioUrl?: string
    subtitles: OfflineSubtitle[]
}

/** True when the episode has a playable video file. */
export const canPlayOffline = (item: OfflineItem) => item.ready && !!item.files?.video

/**
 * Start position: the stored one, however short (OfflineActivity.kt seeks to any saved position); from the beginning
 * when the episode was finished (stored 0). The 10 s of STARTED_MS only decide which episode the page offers.
 */
export function offlineStartSeconds(item: OfflineItem): number {
    return item.position > 0 ? item.position / 1000 : 0
}

/** Position to store when the player stops: 0 once the episode ended, so it starts over next time (savePosition()). */
export function offlinePositionToSave(currentSeconds: number, ended: boolean): number {
    return ended ? 0 : Math.max(0, Math.round(currentSeconds * 1000))
}

export function offlinePlayback(item: OfflineItem): OfflinePlayback {
    return {
        itemId: item.id,
        startSeconds: offlineStartSeconds(item),
        audioUrl: item.files.audio ? offlineFileUrl(item.id, item.files.audio) : undefined,
        subtitles: (item.files.subtitles ?? []).map(sub => ({
            url: offlineFileUrl(item.id, sub.file),
            label: sub.label,
            language: sub.language,
            default: sub.default,
        })),
    }
}

/**
 * The player's playback info for a saved episode: stream type "url" (a plain file over HTTP), the anime and episode as
 * far as the offline library knows them (title, cover, episode number for the bar and the lock screen).
 */
export function offlinePlaybackInfo(item: OfflineItem): NativePlayer_PlaybackInfo {
    const number = Number(item.episode) || 0
    const cover = offlineArtworkUrl(item.coverAsset, item.coverUrl)
    return {
        id: `offline-${item.id}`,
        streamType: "url",
        streamPath: item.files.video ?? "",
        mimeType: "",
        streamUrl: offlineFileUrl(item.id, item.files.video ?? ""),
        contentLength: item.bytes,
        isNakamaWatchParty: false,
        media: {
            id: item.mediaId,
            title: { userPreferred: item.title ?? "" },
            coverImage: cover ? { large: cover } : undefined,
        },
        episode: {
            type: "main",
            // empty: the player shows "Episode 3" / "Folge 3" in the app language
            displayTitle: "",
            episodeTitle: item.episodeTitle ?? "",
            episodeNumber: number,
            absoluteEpisodeNumber: number,
            progressNumber: number,
            isDownloaded: true,
            isInvalid: false,
            _isNakamaEpisode: false,
        },
    }
}
