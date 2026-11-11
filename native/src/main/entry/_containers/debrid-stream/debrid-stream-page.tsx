import type { Anime_Entry, Anime_Episode } from "@/api/generated/types"
import { useGetAnimeEpisodeCollection } from "@/api/hooks/anime.hooks"
import { useDeleteTorrentstreamBatchHistory, useGetTorrentstreamBatchHistory } from "@/api/hooks/torrentstream.hooks"
import { logger } from "@/lib/helpers/debug"
import { DEBRID_SERVICE } from "@/lib/server/settings"
import { useSetTorrentstreamAutoplayInfo } from "@/main/_features/autoplay/autoplay.atoms"
import { IN_APP_PLAYER_READY } from "@/main/_features/player/player-availability"
import { useSelectedDebridService, useServerStatus } from "@/main/_hooks/use-server-status"
import { useHandleStartDebridStream } from "@/main/entry/_containers/debrid-stream/_lib/handle-debrid-stream"
import { __torrentSearch_selectionAtom, __torrentSearch_selectionEpisodeAtom } from "@/main/entry/_containers/torrent-search/torrent-search.atoms"
import { StreamPageSkeleton } from "@/main/entry/_containers/torrent-stream/_components/stream-page-skeleton"
import { ForgetBatchDialog, StreamControlsPhone } from "@/main/entry/_containers/torrent-stream/_components/stream-controls-phone"
import { TorrentStreamEpisodeSection } from "@/main/entry/_containers/torrent-stream/_components/torrent-stream-episode-section"
import {
    __debridStream_autoSelectFileAtom,
    __debridStream_currentSessionAutoSelectAtom,
    useTorrentSearchSelectedStreamEpisode,
} from "@/main/entry/_containers/torrent-stream/torrent-stream.atoms"
import { type ForcePlaybackMethod, useForcePlaybackMethod } from "@/main/entry/_lib/handle-play-media"
import { useAtomValue, useSetAtom } from "jotai"
import React from "react"
import { View } from "react-native"

/*
 * The debrid streaming source of an anime page (debrid-stream-page.tsx), built like the torrent source and sharing its
 * parts: auto select, the remembered batch (its file guessed from the last one, except on TorBox), the episodes, the
 * torrent sheet for an episode. Starting a stream needs the app's player (IN_APP_PLAYER_READY, E3).
 */
export function DebridStreamPage({ entry, bottomSection }: { entry: Anime_Entry, bottomSection?: React.ReactNode }) {
    const serverStatus = useServerStatus()
    const [autoSelect, setAutoSelect] = React.useState(serverStatus?.debridSettings?.streamAutoSelect ?? false)
    const autoSelectFile = useAtomValue(__debridStream_autoSelectFileAtom)
    const setCurrentSessionAutoSelect = useSetAtom(__debridStream_currentSessionAutoSelectAtom)

    React.useEffect(() => {
        setCurrentSessionAutoSelect(autoSelect)
    }, [autoSelect, setCurrentSessionAutoSelect])

    const { data: episodeCollection, isLoading } = useGetAnimeEpisodeCollection(entry.mediaId)

    // The setting decides again when it changes or the episodes turn out to have no AniDB data (then pick yourself).
    // The web keyed this on the torrent streaming setting by mistake; here it is the debrid one.
    const wanted = episodeCollection?.hasMappingError ? false : (serverStatus?.debridSettings?.streamAutoSelect ?? false)
    const [wantedFor, setWantedFor] = React.useState(wanted)
    if (wantedFor !== wanted) {
        setWantedFor(wanted)
        setAutoSelect(wanted)
    }

    const setTorrentSearchSelection = useSetAtom(__torrentSearch_selectionAtom)
    const setTorrentSearchEpisode = useSetAtom(__torrentSearch_selectionEpisodeAtom)
    const { setTorrentSearchStreamEpisode } = useTorrentSearchSelectedStreamEpisode()

    const { handleAutoSelectStream, handleStreamSelection } = useHandleStartDebridStream()
    const { forcePlaybackMethodFn } = useForcePlaybackMethod()
    const setDebridstreamAutoplayInfo = useSetTorrentstreamAutoplayInfo()
    const { mutate: deleteBatchHistory, isPending: isDeletingBatchHistory } = useDeleteTorrentstreamBatchHistory()
    const { data: batchHistory } = useGetTorrentstreamBatchHistory(entry?.mediaId, true)
    const { selectedDebridService } = useSelectedDebridService()

    const [usePreviousBatch, setUsePreviousBatch] = React.useState(false)
    const [historyFor, setHistoryFor] = React.useState(batchHistory)
    if (historyFor !== batchHistory) {
        setHistoryFor(batchHistory)
        setUsePreviousBatch(!!batchHistory?.torrent?.isBatch)
    }
    const [forgetOpen, setForgetOpen] = React.useState(false)

    function handleSetDebridstreamAutoplayInfo(episode: Anime_Episode | undefined) {
        if (!episode || !episode.aniDBEpisode || !episodeCollection?.episodes) return
        const nextEpisode = episodeCollection.episodes.find(e => e.episodeNumber === episode.episodeNumber + 1)
        logger("TORRENTSTREAM").info("Auto select, Next episode", nextEpisode)
        if (nextEpisode && !!nextEpisode.aniDBEpisode) {
            setDebridstreamAutoplayInfo({
                allEpisodes: episodeCollection.episodes,
                entry,
                episodeNumber: nextEpisode.episodeNumber,
                aniDBEpisode: nextEpisode.aniDBEpisode,
                type: "debridstream",
            })
        } else {
            setDebridstreamAutoplayInfo(null)
        }
    }

    function handleAutoSelect(episode: Anime_Episode | undefined) {
        if (!episode || !episode.aniDBEpisode || !episodeCollection?.episodes) return
        handleAutoSelectStream({ mediaId: entry.mediaId, episodeNumber: episode.episodeNumber, aniDBEpisode: episode.aniDBEpisode })
        handleSetDebridstreamAutoplayInfo(episode)
    }

    const handleEpisodeClick = (episode: Anime_Episode, forcePlaybackMethod?: ForcePlaybackMethod) => {
        if (!episode || !episode.aniDBEpisode) return
        setTorrentSearchStreamEpisode(episode)

        if (autoSelect) {
            forcePlaybackMethodFn(forcePlaybackMethod, () => handleAutoSelect(episode))
            return
        }
        let started = false
        if (usePreviousBatch && batchHistory?.torrent && episode.aniDBEpisode) {
            if (autoSelectFile) {
                forcePlaybackMethodFn(forcePlaybackMethod, () => handleStreamSelection({
                    mediaId: entry.mediaId,
                    episodeNumber: episode.episodeNumber,
                    aniDBEpisode: episode.aniDBEpisode!,
                    torrent: batchHistory.torrent!,
                    chosenFileId: "",
                    batchEpisodeFiles: undefined,
                }))
                started = true
            } else if (batchHistory.batchEpisodeFiles && selectedDebridService !== DEBRID_SERVICE.TORBOX) {
                // Only the next episode's file is guessed: the same file for the same episode, else as many files on
                const files = batchHistory.batchEpisodeFiles
                let fileIndex: number | undefined = undefined
                if (files.currentAniDBEpisode === episode.aniDBEpisode) {
                    fileIndex = files.current
                } else {
                    const offset = episode.episodeNumber - files.currentEpisodeNumber
                    const file = files.files?.find(f => f.index === (files.current || 0) + offset)
                    if (file) fileIndex = file.index
                }
                if (fileIndex !== undefined) {
                    const chosen = fileIndex
                    forcePlaybackMethodFn(forcePlaybackMethod, () => handleStreamSelection({
                        mediaId: entry.mediaId,
                        episodeNumber: episode.episodeNumber,
                        aniDBEpisode: episode.aniDBEpisode!,
                        torrent: batchHistory.torrent!,
                        chosenFileId: String(chosen),
                        batchEpisodeFiles: { ...files, files: files.files!, current: chosen, currentAniDBEpisode: episode.aniDBEpisode!, currentEpisodeNumber: episode.episodeNumber },
                    }))
                    started = true
                }
            }
        }
        if (!started) {
            setTorrentSearchEpisode(episode.episodeNumber)
            forcePlaybackMethodFn(forcePlaybackMethod, () => {
                if (autoSelectFile) {
                    setTorrentSearchSelection("debridstream-select")
                    handleSetDebridstreamAutoplayInfo(episode)
                } else {
                    setTorrentSearchSelection("debridstream-select-file")
                }
            })
        }
        if (selectedDebridService !== DEBRID_SERVICE.TORBOX) {
            handleSetDebridstreamAutoplayInfo(episode)
        }
    }

    if (!entry.media) return null
    if (isLoading) return <StreamPageSkeleton />

    // Without the player only the taps that open the torrent sheet are possible
    const canTap = IN_APP_PLAYER_READY || (!autoSelect && !usePreviousBatch)

    return <View className="gap-6">
        <StreamControlsPhone autoSelect={autoSelect} onAutoSelect={setAutoSelect}
            batchName={usePreviousBatch ? batchHistory?.torrent?.name : undefined} onForgetBatch={() => setForgetOpen(true)}
            forgetting={isDeletingBatchHistory} mappingError={!!episodeCollection?.hasMappingError} />
        <TorrentStreamEpisodeSection entry={entry} episodeCollection={episodeCollection} bottomSection={bottomSection} pluginType="debridstream"
            onEpisodeClick={canTap ? episode => handleEpisodeClick(episode) : undefined}
            onPlayNextEpisodeOnMount={episode => autoSelect ? handleAutoSelect(episode) : handleEpisodeClick(episode)} />
        <ForgetBatchDialog open={forgetOpen} onOpenChange={setForgetOpen} onDisable={() => setUsePreviousBatch(false)}
            onDelete={() => {
                setUsePreviousBatch(false)
                deleteBatchHistory({ mediaId: entry.mediaId })
            }} />
    </View>
}
