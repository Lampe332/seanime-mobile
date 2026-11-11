import type { NativePlayer_PlaybackInfo } from "@/api/generated/types"
import { logger } from "@/lib/helpers/debug"
import { WSEvents } from "@/lib/server/ws-events"
import { useWebsocketMessageListener, useWebsocketSender } from "@/main/_hooks/handle-websockets"
import { clientIdAtom } from "@/main/websocket-provider"
import type { OnlinestreamParams } from "@/main/onlinestream/_lib/onlinestream-player.atoms"
import { useAtomValue } from "jotai"
import React from "react"

const log = logger("PLAYER")

/** What the server may ask of the player (web video-core-events.ts, VIDEOCORE server events). */
export type PlayerCommands = {
    getTime: () => { currentTime: number, duration: number, paused: boolean }
    pause: () => void
    resume: () => void
    seekTo: (time: number) => void
    terminate: () => void
    setAudioTrack: (mkvNumber: number) => void
    setSubtitleTrack: (mkvNumber: number) => void
    getAudioTrack: () => number
    getSubtitleTrack: () => number
    showMessage: (message: string, durationMs: number) => void
    isFullscreen: () => boolean
    isPip: () => boolean
    playEpisode: (which: "previous" | "next") => void
}

/**
 * How the server should file a playback that did not come through its native player channel: an online stream is
 * "onlinestream" with its params (web VideoCore onlinestreamParams; continuity is kept as kind "onlinestream").
 */
export type PlayerServerOrigin = { playbackType: "onlinestream", onlinestreamParams: OnlinestreamParams }

/** The VideoCore playback info the server expects from the native player (web native-player.tsx `ps`). */
export function toVideoCorePlaybackInfo(info: NativePlayer_PlaybackInfo, origin?: PlayerServerOrigin) {
    return {
        id: info.id,
        playbackType: origin?.playbackType ?? info.streamType,
        onlinestreamParams: origin?.onlinestreamParams,
        streamUrl: info.streamUrl,
        streamPath: info.streamPath,
        mkvMetadata: info.mkvMetadata,
        subtitleTracks: info.subtitleTracks,
        media: info.media,
        episode: info.episode,
        localFile: info.localFile,
        streamType: "native",
    }
}

/**
 * The player's side of the VIDEOCORE channel: the events the server tracks progress, continuity, auto play and the
 * AniList update with (sent like the web player: status every second, video-completed once at 80 %), and the commands it
 * sends back (pause, seek, track changes, terminate …).
 * enabled false (an episode from the offline library): the server knows nothing of this playback, so the player tells it
 * nothing and takes no commands; offline playback never updates AniList or continuity (as in the old OfflineActivity).
 */
export function usePlayerServer(info: NativePlayer_PlaybackInfo | null, commands: React.RefObject<PlayerCommands | null>, enabled = true, origin?: PlayerServerOrigin) {
    const { sendMessage } = useWebsocketSender()
    const clientId = useAtomValue(clientIdAtom)
    const infoRef = React.useRef(info)
    const enabledRef = React.useRef(enabled)
    const originRef = React.useRef(origin)
    React.useLayoutEffect(() => {
        infoRef.current = info
        enabledRef.current = enabled
        originRef.current = origin
    }, [info, enabled, origin])

    const send = React.useCallback((type: string, payload?: unknown) => {
        if (!enabledRef.current) return
        sendMessage({ type: WSEvents.VIDEOCORE, payload: { clientId, type, payload } })
    }, [sendMessage, clientId])

    const timePayload = React.useCallback(() => {
        const t = commands.current?.getTime() ?? { currentTime: 0, duration: 0, paused: true }
        return { id: infoRef.current?.id ?? "", clientId, currentTime: t.currentTime, duration: t.duration, paused: t.paused }
    }, [clientId, commands])

    const playbackState = React.useCallback(() => {
        const current = infoRef.current
        if (!current || !clientId) return {}
        return { clientId, playerType: "native", playbackInfo: toVideoCorePlaybackInfo(current, originRef.current) }
    }, [clientId])

    // Status every second while something plays (web: setInterval in useVideoCoreSetupEvents)
    React.useEffect(() => {
        if (!info?.id || !clientId || !enabled) return
        const timer = setInterval(() => send("video-status", timePayload()), 1000)
        return () => clearInterval(timer)
    }, [info?.id, clientId, enabled, send, timePayload])

    const events = React.useMemo(() => ({
        loaded: () => send("video-loaded", { state: playbackState() }),
        loadedMetadata: () => send("video-loaded-metadata", timePayload()),
        canPlay: () => send("video-can-play", timePayload()),
        paused: () => send("video-paused", timePayload()),
        resumed: () => send("video-resumed", timePayload()),
        seeked: () => send("video-seeked", timePayload()),
        completed: () => send("video-completed", timePayload()),
        ended: (autoNext: boolean) => send("video-ended", { autoNext }),
        error: (error: string) => send("video-error", { error }),
        terminated: () => {
            const current = infoRef.current
            send("video-terminated", { id: current?.id ?? "", clientId, playerType: "native", playbackType: originRef.current?.playbackType ?? current?.streamType ?? "" })
        },
        audioTrack: (trackNumber: number) => send("video-audio-track", { trackNumber, isHLS: false }),
        subtitleTrack: (trackNumber: number) => send("video-subtitle-track", { trackNumber, kind: "event" }),
        pip: (pip: boolean) => send("video-pip", { pip }),
        fullscreen: (fullscreen: boolean) => send("video-fullscreen", { fullscreen }),
    }), [send, timePayload, playbackState, clientId])

    useWebsocketMessageListener({
        type: WSEvents.VIDEOCORE,
        deps: [info?.id],
        onMessage: ({ type, payload }: { type: string, payload: unknown }) => {
            const c = commands.current
            if (!c || !infoRef.current || !enabledRef.current) return
            switch (type) {
                case "get-status":
                    send("video-status", timePayload())
                    break
                case "pause":
                    c.pause()
                    break
                case "resume":
                    c.resume()
                    break
                case "seek": {
                    const t = c.getTime()
                    c.seekTo(t.currentTime + (payload as number))
                    break
                }
                case "seek-to":
                    c.seekTo(payload as number)
                    break
                case "set-audio-track":
                    c.setAudioTrack(payload as number)
                    break
                case "set-subtitle-track":
                    c.setSubtitleTrack(payload as number)
                    break
                case "get-audio-track":
                    events.audioTrack(c.getAudioTrack())
                    break
                case "get-subtitle-track":
                    events.subtitleTrack(c.getSubtitleTrack())
                    break
                case "get-fullscreen":
                    events.fullscreen(c.isFullscreen())
                    break
                case "get-pip":
                    events.pip(c.isPip())
                    break
                case "get-playback-state":
                    send("video-playback-state", { state: playbackState() })
                    break
                case "show-message": {
                    const data = payload as { message: string, duration?: number }
                    c.showMessage(data.message, data.duration ?? 2000)
                    break
                }
                case "play-playlist-episode":
                    if (payload === "next" || payload === "previous") c.playEpisode(payload)
                    break
                case "terminate":
                    c.terminate()
                    break
                default:
                    // Desktop-only requests (Anime4K, text tracks for translation, insight data …) have no native counterpart
                    log.info("Ignored VideoCore event", type)
            }
        },
    })

    return events
}
