import { Nullish } from "@/api/generated/types"
import { atom } from "jotai"
import { useAtom } from "jotai/react"
import { atomWithStorage } from "@/lib/storage"

export const enum PlaybackDownloadedMedia {
    Default = "default", // Desktop media player or Integrated player (media streaming)
    ExternalPlayerLink = "externalPlayerLink", // External player link
}


// The web version rendered these labels as JSX with icons; the native settings screen draws its own row
export const playbackDownloadedMediaOptions = [
    { label: "Desktop media player or Transcoding / Direct Play", value: PlaybackDownloadedMedia.Default },
    { label: "External player link", value: PlaybackDownloadedMedia.ExternalPlayerLink },
]

export const __playback_downloadedMediaAtom = atomWithStorage<string>("sea-playback-downloaded-media", PlaybackDownloadedMedia.Default)

/**
 * Android plays downloaded media in the built-in player unless the external player link is chosen: directstream reads MKV
 * metadata in Go, while the desktop player and transcoding need programs (mpv, ffmpeg, ffprobe) the app does not ship.
 */
export function usesAndroidBuiltInPlayer(downloadedMediaPlayback: string) {
    return downloadedMediaPlayback !== PlaybackDownloadedMedia.ExternalPlayerLink
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const enum PlaybackTorrentStreaming {
    Default = "default", // Desktop media player
    ExternalPlayerLink = "externalPlayerLink",
}

export const playbackTorrentStreamingOptions = [
    { label: "Desktop media player", value: PlaybackTorrentStreaming.Default },
    { label: "External player link", value: PlaybackTorrentStreaming.ExternalPlayerLink },
]


export const __playback_torrentStreamingAtom = atomWithStorage<string>("sea-playback-torrentstream", PlaybackTorrentStreaming.Default)

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export function useCurrentDevicePlaybackSettings() {

    const [downloadedMediaPlayback, setDownloadedMediaPlayback] = useAtom(__playback_downloadedMediaAtom)
    const [torrentStreamingPlayback, setTorrentStreamingPlayback] = useAtom(__playback_torrentStreamingAtom)
    return {
        downloadedMediaPlayback,
        setDownloadedMediaPlayback,
        torrentStreamingPlayback,
        setTorrentStreamingPlayback,
    }
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const __playback_externalPlayerLink = atomWithStorage<string>("sea-playback-external-player-link", "")
export const __playback_externalPlayerLink_encodePath = atomWithStorage<boolean>("sea-playback-external-player-link-encode-path", false)

export function useExternalPlayerLink() {
    const [externalPlayerLink, setExternalPlayerLink] = useAtom(__playback_externalPlayerLink)
    const [encodePath, setEncodePath] = useAtom(__playback_externalPlayerLink_encodePath)
    return {
        externalPlayerLink,
        setExternalPlayerLink,
        encodePath,
        setEncodePath,
    }
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const __playback_playNext = atom<number | null>(null)

export function usePlayNext() {
    const [playNext, _setPlayNext] = useAtom(__playback_playNext)

    function setPlayNext(ep: Nullish<number>, callback: () => void) {
        if (!ep) return
        _setPlayNext(ep)
        callback()
    }

    return {
        playNext,
        setPlayNext,
        resetPlayNext: () => _setPlayNext(null),
    }
}
