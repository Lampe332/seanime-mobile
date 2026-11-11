import type { HibikeTorrent_AnimeTorrent, HibikeTorrent_BatchEpisodeFiles } from "@/api/generated/types"
import { useDebridStartStream } from "@/api/hooks/debrid.hooks"
import { useTr } from "@/lib/app-language"
import { logger } from "@/lib/helpers/debug"
import { useExternalPlayerLink } from "@/main/_atoms/playback.atoms"
import { toastStreamStartError } from "@/main/_features/native-player/stream-start-error"
import { __debridstream_stateAtom, __debridStream_currentSessionAutoSelectAtom } from "@/main/entry/_containers/torrent-stream/torrent-stream.atoms"
import { type ForcePlaybackMethod, useForcePlaybackMethod } from "@/main/entry/_lib/handle-play-media"
import { clientIdAtom } from "@/main/websocket-provider"
import { useAtomValue, useSetAtom, useStore } from "jotai"
import React from "react"

/*
 * handle-debrid-stream.ts: asks the server to stream a torrent through the debrid service to the app's own player.
 * Called only once the player exists (IN_APP_PLAYER_READY, E3).
 */

type DebridStreamSelectionProps = {
    torrent: HibikeTorrent_AnimeTorrent
    mediaId: number
    episodeNumber: number
    aniDBEpisode: string
    chosenFileId: string
    batchEpisodeFiles: HibikeTorrent_BatchEpisodeFiles | undefined
    forcePlaybackMethod?: ForcePlaybackMethod
}
type DebridStreamAutoSelectProps = {
    mediaId: number
    episodeNumber: number
    aniDBEpisode: string
    forcePlaybackMethod?: ForcePlaybackMethod
}

export function useHandleStartDebridStream() {
    const t = useTr()
    const store = useStore()
    const { mutate, isPending } = useDebridStartStream(error => toastStreamStartError(error, t, store))

    const { externalPlayerLink } = useExternalPlayerLink()
    const clientId = useAtomValue(clientIdAtom)
    const setCurrentSessionAutoSelect = useSetAtom(__debridStream_currentSessionAutoSelectAtom)
    const setState = useSetAtom(__debridstream_stateAtom)
    const { resetForcePlaybackMethod, getForcePlaybackMethod } = useForcePlaybackMethod()

    const getPlaybackType = React.useCallback((forcePlaybackMethod?: ForcePlaybackMethod) => {
        // no desktop player to hand the stream to: the app's own player plays it
        if (!forcePlaybackMethod || forcePlaybackMethod === "nativeplayer") {
            return "nativeplayer"
        }
        if (!!externalPlayerLink?.length && forcePlaybackMethod === "externalPlayerLink") {
            return "externalPlayerLink"
        }
        return "default"
    }, [externalPlayerLink])

    const handleStreamSelection = (params: DebridStreamSelectionProps) => {
        const forcePlaybackMethod = getForcePlaybackMethod()
        resetForcePlaybackMethod()
        logger("DEBRID STREAM SELECTION").info("Starting debrid stream", params, getPlaybackType(forcePlaybackMethod))
        mutate({
            mediaId: params.mediaId,
            episodeNumber: params.episodeNumber,
            torrent: params.torrent,
            aniDBEpisode: params.aniDBEpisode,
            fileId: params.chosenFileId,
            playbackType: getPlaybackType(forcePlaybackMethod),
            clientId: clientId || "",
            autoSelect: false,
            batchEpisodeFiles: params.batchEpisodeFiles,
        }, {
            onError: () => {
                setState(null)
            },
        })
    }

    const handleAutoSelectStream = (params: DebridStreamAutoSelectProps) => {
        const forcePlaybackMethod = getForcePlaybackMethod()
        resetForcePlaybackMethod()
        logger("DEBRID STREAM SELECTION").info("Starting debrid stream (auto select)", params, getPlaybackType(forcePlaybackMethod))
        mutate({
            mediaId: params.mediaId,
            episodeNumber: params.episodeNumber,
            torrent: undefined,
            aniDBEpisode: params.aniDBEpisode,
            fileId: "",
            playbackType: getPlaybackType(forcePlaybackMethod),
            clientId: clientId || "",
            autoSelect: true,
        }, {
            onError: () => {
                setState(null)
                React.startTransition(() => {
                    setCurrentSessionAutoSelect(false)
                })
            },
        })
    }

    return {
        handleStreamSelection,
        handleAutoSelectStream,
        isPending,
    }
}
