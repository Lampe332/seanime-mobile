import { getServerBaseUrl } from "@/api/client/server-url"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import type { MobileOffline_Item, NativePlayer_PlaybackInfo, NativePlayer_ServerEvent } from "@/api/generated/types"
import { toast } from "@/components/ui/toast/toast-store"
import { useTr } from "@/lib/app-language"
import { logger } from "@/lib/helpers/debug"
import { playbackInfoSummary, withoutTokens } from "@/lib/helpers/log-safe"
import { WSEvents } from "@/lib/server/ws-events"
import { useWebsocketMessageListener } from "@/main/_hooks/handle-websockets"
import { nativePlayer_initialState, nativePlayer_stateAtom } from "@/main/_features/native-player/native-player.atoms"
import { streamStartError } from "@/main/_features/native-player/stream-start-error"
import { useQueryClient } from "@tanstack/react-query"
import { useAtom, useSetAtom } from "jotai"
import React from "react"
import { player_miniAtom, player_offlineItemAtom } from "./player.atoms"
import { resolveStreamUrl } from "./player-logic"
import { PlayerScreen } from "./player-screen"
import { useGetMobileOfflineSnapshot, useMobileOfflinePosition } from "@/api/hooks/mobile_offline.hooks"
import { followingEpisode } from "@/main/android-downloads/_lib/offline-library"
import { offlinePlayback, offlinePlaybackInfo } from "@/main/android-downloads/_lib/offline-playback"
import { player_onlineAtom } from "@/main/onlinestream/_lib/onlinestream-player.atoms"

const log = logger("NATIVE PLAYER")

/*
 * The server's native player channel (web native-player.tsx): "open-and-await" opens the player while the server
 * prepares the stream (library file via directstream, torrent, debrid, Nakama), "watch" brings the stream URL,
 * "abort-open"/"error" end it. mpv reads embedded subtitles itself, so the server's MKV subtitle events
 * ("subtitle-event") and "set-tracks" are not needed (they fed the browser's subtitle renderer).
 */
export function NativePlayer() {
    const t = useTr()
    const qc = useQueryClient()
    const [state, setState] = useAtom(nativePlayer_stateAtom)
    const setMini = useSetAtom(player_miniAtom)
    // r22: a new server stream (library file, torrent, debrid, Nakama) opens fullscreen; the next episode of one that is
    // already playing keeps its size (box, mini or full)
    const activeRef = React.useRef(state.active)
    React.useLayoutEffect(() => {
        activeRef.current = state.active
    })
    const [offlineItem, setOfflineItem] = useAtom(player_offlineItemAtom)
    const [online, setOnline] = useAtom(player_onlineAtom)
    const abortTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

    // One player over all pages: a server stream or a saved episode takes the online stream's place; the online
    // stream page hears it (closed) so it does not write its stream back
    const onlineRef = React.useRef(online)
    React.useLayoutEffect(() => {
        onlineRef.current = online
    })
    const endOnline = React.useCallback(() => {
        const current = onlineRef.current
        if (!current) return
        onlineRef.current = null
        current.events.current?.closed()
        setOnline(null)
    }, [setOnline])
    React.useEffect(() => {
        if (offlineItem) endOnline()
    }, [offlineItem, endOnline])

    React.useEffect(() => {
        qc.invalidateQueries({ queryKey: [API_ENDPOINTS.CONTINUITY.GetContinuityWatchHistoryItem.key] })
    }, [state, qc])

    const reset = React.useCallback(() => {
        if (abortTimer.current) clearTimeout(abortTimer.current)
        setState(nativePlayer_initialState)
        setMini(false)
    }, [setState, setMini])

    useWebsocketMessageListener({
        type: WSEvents.NATIVE_PLAYER,
        onMessage: ({ type, payload }: { type: NativePlayer_ServerEvent, payload: unknown }) => {
            switch (type) {
                case "open-and-await":
                    log.info("Open and await", payload)
                    if (abortTimer.current) clearTimeout(abortTimer.current)
                    if (!activeRef.current) setMini(false)
                    // a server stream replaces an offline episode or an online stream
                    setOfflineItem(null)
                    endOnline()
                    setState(draft => {
                        draft.active = true
                        draft.loadingState = payload as string
                        draft.playbackInfo = null
                        draft.playbackError = null
                    })
                    break
                case "abort-open":
                    log.info("Abort open", withoutTokens(String(payload ?? "")))
                    if (!(payload as string)) {
                        reset()
                        break
                    }
                    setState(draft => {
                        draft.loadingState = streamStartError(payload as string, t)
                        draft.playbackError = payload as string
                        draft.playbackInfo = null
                    })
                    // the error stays readable for a moment, then the player closes (web: 3 s)
                    abortTimer.current = setTimeout(reset, 3000)
                    break
                case "watch": {
                    // never the stream link: it carries the server's token (library) or a debrid/provider address
                    log.info("Watch", playbackInfoSummary(payload))
                    setOfflineItem(null)
                    endOnline()
                    const info = payload as NativePlayer_PlaybackInfo
                    // library streams come as "{{SERVER_URL}}/api/v1/directstream/…" (web video-core.tsx filled in the server)
                    const playbackInfo = info.streamUrl ? { ...info, streamUrl: resolveStreamUrl(info.streamUrl, getServerBaseUrl()) } : info
                    setState(draft => {
                        draft.active = true
                        draft.playbackInfo = playbackInfo
                        draft.loadingState = null
                        draft.playbackError = null
                    })
                    break
                }
                case "error": {
                    const error = (payload as { error: string }).error
                    log.error("Error", withoutTokens(String(error ?? "")))
                    toast.error(t("Playback error: ", "Wiedergabefehler: ") + error)
                    setState(draft => {
                        draft.playbackError = error
                    })
                    break
                }
            }
        },
    })

    if (offlineItem) return <OfflinePlayer item={offlineItem} onClose={() => { setOfflineItem(null); setMini(false) }} />
    if (online) return (
        <PlayerScreen
            info={online.info}
            loadingState={online.loadingState}
            playbackError={online.playbackError}
            onClose={() => {
                endOnline()
                setMini(false)
            }}
            online={online}
        />
    )
    if (!state.active) return null
    return (
        <PlayerScreen
            info={state.playbackInfo}
            loadingState={state.loadingState}
            playbackError={state.playbackError}
            onClose={reset}
        />
    )
}

/**
 * A saved episode (OfflineActivity.kt): the file from the Go server, the stored position, auto next to the next saved
 * episode of the anime. The position goes to POST /mobile-offline/position only.
 */
function OfflinePlayer({ item, onClose }: { item: MobileOffline_Item, onClose: () => void }) {
    const setOfflineItem = useSetAtom(player_offlineItemAtom)
    const { data: snapshot } = useGetMobileOfflineSnapshot()
    const { mutate: savePosition } = useMobileOfflinePosition()
    const info = React.useMemo(() => offlinePlaybackInfo(item), [item])
    const playback = React.useMemo(() => offlinePlayback(item), [item])
    const next = followingEpisode(snapshot?.items ?? [], item)
    const offline = React.useMemo(() => ({
        playback,
        hasNext: !!next,
        playNext: () => { if (next) setOfflineItem(next) },
        savePosition: (positionMs: number) => savePosition({ id: item.id, positionMs }),
    }), [playback, next, item.id, setOfflineItem, savePosition])
    return <PlayerScreen info={info} loadingState={null} playbackError={null} onClose={onClose} offline={offline} />
}
