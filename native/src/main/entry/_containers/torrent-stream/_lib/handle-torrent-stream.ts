import type { HibikeTorrent_AnimeTorrent, HibikeTorrent_BatchEpisodeFiles } from "@/api/generated/types"
import { useTorrentstreamStartStream } from "@/api/hooks/torrentstream.hooks"
import { useTr } from "@/lib/app-language"
import { logger } from "@/lib/helpers/debug"
import { useExternalPlayerLink } from "@/main/_atoms/playback.atoms"
import { toastStreamStartError } from "@/main/_features/native-player/stream-start-error"
import {
    __torrentstream__isLoadedAtom,
    __torrentstream__loadingStateAtom,
    __torrentStream_currentSessionAutoSelectAtom,
} from "@/main/entry/_containers/torrent-stream/torrent-stream.atoms"
import { type ForcePlaybackMethod, useForcePlaybackMethod } from "@/main/entry/_lib/handle-play-media"
import { clientIdAtom } from "@/main/websocket-provider"
import { useAtomValue, useSetAtom, useStore } from "jotai"
import React from "react"

/*
 * handle-torrent-stream.ts: asks the server to start a torrent stream for the app's own player. Called only once the
 * player exists (IN_APP_PLAYER_READY, E3); the stream listener that preloads the next playlist episode comes with the
 * player and the playlists (useTorrentStreamListener, E3/2.14).
 */

type ManualTorrentStreamSelectionProps = {
    torrent: HibikeTorrent_AnimeTorrent
    mediaId: number
    episodeNumber: number
    aniDBEpisode: string
    chosenFileIndex: number | undefined | null
    batchEpisodeFiles: HibikeTorrent_BatchEpisodeFiles | undefined
    preload?: boolean
}
type AutoSelectTorrentStreamProps = {
    mediaId: number
    episodeNumber: number
    aniDBEpisode: string
    preload?: boolean
}

export function useHandleStartTorrentStream() {
    const t = useTr()
    const store = useStore()
    const { mutate, isPending } = useTorrentstreamStartStream(error => toastStreamStartError(error, t, store))

    const setLoadingState = useSetAtom(__torrentstream__loadingStateAtom)
    const setIsLoaded = useSetAtom(__torrentstream__isLoadedAtom)
    const { externalPlayerLink } = useExternalPlayerLink()
    const clientId = useAtomValue(clientIdAtom)
    const setCurrentSessionAutoSelect = useSetAtom(__torrentStream_currentSessionAutoSelectAtom)
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

    const handleStreamSelection = (params: ManualTorrentStreamSelectionProps) => {
        const forcePlaybackMethod = getForcePlaybackMethod()
        resetForcePlaybackMethod()
        logger("TORRENT STREAM SELECTION").info("Starting torrent stream", params, getPlaybackType(forcePlaybackMethod))
        mutate({
            mediaId: params.mediaId,
            episodeNumber: params.episodeNumber,
            torrent: params.torrent,
            aniDBEpisode: params.aniDBEpisode,
            autoSelect: false,
            fileIndex: params.chosenFileIndex ?? undefined,
            playbackType: getPlaybackType(forcePlaybackMethod),
            clientId: clientId || "",
            batchEpisodeFiles: params.batchEpisodeFiles,
            preload: params.preload,
        }, {
            onError: () => {
                setLoadingState(null)
                setIsLoaded(false)
            },
        })
    }

    const handleAutoSelectStream = (params: AutoSelectTorrentStreamProps) => {
        const forcePlaybackMethod = getForcePlaybackMethod()
        resetForcePlaybackMethod()
        logger("TORRENT STREAM SELECTION").info("Starting torrent stream (auto select)", params, getPlaybackType(forcePlaybackMethod))
        mutate({
            mediaId: params.mediaId,
            episodeNumber: params.episodeNumber,
            aniDBEpisode: params.aniDBEpisode,
            autoSelect: true,
            torrent: undefined,
            playbackType: getPlaybackType(forcePlaybackMethod),
            clientId: clientId || "",
            preload: params.preload,
        }, {
            onError: () => {
                setLoadingState(null)
                setIsLoaded(false)
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
