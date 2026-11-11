import type { Anime_Entry, Anime_Episode } from "@/api/generated/types"
import { useGetAnimeEpisodeCollection } from "@/api/hooks/anime.hooks"
import { useDeleteTorrentstreamBatchHistory, useGetTorrentstreamBatchHistory } from "@/api/hooks/torrentstream.hooks"
import { logger } from "@/lib/helpers/debug"
import { useAutoPlaySelectedTorrent, useSetTorrentstreamAutoplayInfo } from "@/main/_features/autoplay/autoplay.atoms"
import { getBatchSelectionParams } from "@/main/_features/autoplay/batches"
import { IN_APP_PLAYER_READY } from "@/main/_features/player/player-availability"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { __torrentSearch_selectionAtom, __torrentSearch_selectionEpisodeAtom } from "@/main/entry/_containers/torrent-search/torrent-search.atoms"
import { ForgetBatchDialog, StreamControlsPhone } from "@/main/entry/_containers/torrent-stream/_components/stream-controls-phone"
import { TorrentStreamEpisodeSection } from "@/main/entry/_containers/torrent-stream/_components/torrent-stream-episode-section"
import { useHandleStartTorrentStream } from "@/main/entry/_containers/torrent-stream/_lib/handle-torrent-stream"
import {
    __torrentStream_autoSelectFileAtom,
    __torrentStream_currentSessionAutoSelectAtom,
    useTorrentSearchSelectedStreamEpisode,
} from "@/main/entry/_containers/torrent-stream/torrent-stream.atoms"
import { type ForcePlaybackMethod, useForcePlaybackMethod } from "@/main/entry/_lib/handle-play-media"
import { StreamPageSkeleton } from "@/main/entry/_containers/torrent-stream/_components/stream-page-skeleton"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import React from "react"
import { View } from "react-native"

/*
 * The torrent streaming source of an anime page (torrent-stream-page.tsx): "Pick the best torrent" (the server's auto
 * select for this session), the remembered batch, then the episodes. A tap either starts the stream at once (auto select,
 * the remembered batch) or opens the torrent sheet for the episode. Starting needs the app's player: until it exists
 * (IN_APP_PLAYER_READY, E3) only the taps that open the sheet are possible.
 */
export function TorrentStreamPage({ entry, bottomSection }: { entry: Anime_Entry, bottomSection?: React.ReactNode }) {
    const serverStatus = useServerStatus()
    const [autoSelect, setAutoSelect] = useAtom(__torrentStream_currentSessionAutoSelectAtom)
    const autoSelectFile = useAtomValue(__torrentStream_autoSelectFileAtom)

    const { data: episodeCollection, isLoading } = useGetAnimeEpisodeCollection(entry.mediaId)

    React.useLayoutEffect(() => {
        if (!episodeCollection?.hasMappingError) {
            setAutoSelect(serverStatus?.torrentstreamSettings?.autoSelect ?? false)
        } else {
            setAutoSelect(false)
        }
    }, [serverStatus?.torrentstreamSettings?.autoSelect, episodeCollection, setAutoSelect])

    const setTorrentSearchSelection = useSetAtom(__torrentSearch_selectionAtom)
    const setTorrentSearchEpisode = useSetAtom(__torrentSearch_selectionEpisodeAtom)
    const { setTorrentSearchStreamEpisode } = useTorrentSearchSelectedStreamEpisode()

    const { handleAutoSelectStream, handleStreamSelection, isPending } = useHandleStartTorrentStream()
    const setTorrentstreamAutoplayInfo = useSetTorrentstreamAutoplayInfo()
    const { mutate: deleteBatchHistory, isPending: isDeletingBatchHistory } = useDeleteTorrentstreamBatchHistory()
    const { setAutoPlayTorrent } = useAutoPlaySelectedTorrent()
    const { forcePlaybackMethodFn } = useForcePlaybackMethod()
    const { data: batchHistory } = useGetTorrentstreamBatchHistory(entry?.mediaId, true)

    // A remembered batch is used again until "Stop"; a new history (another anime, a new batch) turns it on again
    const [usePreviousBatch, setUsePreviousBatch] = React.useState(false)
    const [historyFor, setHistoryFor] = React.useState(batchHistory)
    if (historyFor !== batchHistory) {
        setHistoryFor(batchHistory)
        setUsePreviousBatch(!!batchHistory?.torrent?.isBatch)
    }
    const [forgetOpen, setForgetOpen] = React.useState(false)

    // Autoplay info for the next episode when it has AniDB data, else none
    function handleSetTorrentstreamAutoplayInfo(episode: Anime_Episode | undefined) {
        if (!episode || !episode.aniDBEpisode || !episodeCollection?.episodes) return
        const nextEpisode = episodeCollection.episodes.find(e => e.episodeNumber === episode.episodeNumber + 1)
        logger("TORRENTSTREAM").info("Auto select, Next episode", nextEpisode)
        if (nextEpisode && !!nextEpisode.aniDBEpisode) {
            setTorrentstreamAutoplayInfo({
                allEpisodes: episodeCollection.episodes,
                entry,
                episodeNumber: nextEpisode.episodeNumber,
                aniDBEpisode: nextEpisode.aniDBEpisode,
                type: "torrentstream",
            })
        } else {
            setTorrentstreamAutoplayInfo(null)
        }
    }

    function handleAutoSelect(episode: Anime_Episode | undefined) {
        if (isPending || !episode || !episode.aniDBEpisode || !episodeCollection?.episodes) return
        handleAutoSelectStream({ mediaId: entry.mediaId, episodeNumber: episode.episodeNumber, aniDBEpisode: episode.aniDBEpisode })
        handleSetTorrentstreamAutoplayInfo(episode)
    }

    // Auto select starts the stream; otherwise the remembered batch starts it, or the torrent sheet opens for the episode
    const handleEpisodeClick = (episode: Anime_Episode, forcePlaybackMethod?: ForcePlaybackMethod) => {
        if (isPending) return
        setTorrentSearchStreamEpisode(episode)

        React.startTransition(() => {
            if (autoSelect) {
                forcePlaybackMethodFn(forcePlaybackMethod, () => handleAutoSelect(episode))
                return
            }
            let started = false
            if (usePreviousBatch && batchHistory?.torrent && episode.aniDBEpisode) {
                setAutoPlayTorrent(batchHistory.torrent, entry, batchHistory.batchEpisodeFiles)
                if (autoSelectFile) {
                    forcePlaybackMethodFn(forcePlaybackMethod, () => handleStreamSelection({
                        mediaId: entry.mediaId,
                        episodeNumber: episode.episodeNumber,
                        aniDBEpisode: episode.aniDBEpisode!,
                        torrent: batchHistory.torrent!,
                        chosenFileIndex: undefined,
                        batchEpisodeFiles: undefined,
                    }))
                    started = true
                } else if (batchHistory.batchEpisodeFiles) {
                    // Reuse the previous batch when the requested episode can be matched safely
                    const batchParams = getBatchSelectionParams(batchHistory.batchEpisodeFiles, episode.episodeNumber, episode.aniDBEpisode)
                    if (batchParams.fileIndex !== undefined) {
                        forcePlaybackMethodFn(forcePlaybackMethod, () => handleStreamSelection({
                            mediaId: entry.mediaId,
                            episodeNumber: episode.episodeNumber,
                            aniDBEpisode: episode.aniDBEpisode!,
                            torrent: batchHistory.torrent!,
                            chosenFileIndex: batchParams.fileIndex,
                            batchEpisodeFiles: batchParams.batchEpisodeFiles,
                        }))
                        started = true
                    }
                }
            }
            if (!started) {
                setTorrentSearchEpisode(episode.episodeNumber)
                forcePlaybackMethodFn(forcePlaybackMethod, () => setTorrentSearchSelection(autoSelectFile ? "torrentstream-select" : "torrentstream-select-file"))
            }
            handleSetTorrentstreamAutoplayInfo(episode)
        })
    }

    if (!entry.media) return null
    if (isLoading) return <StreamPageSkeleton />

    // Without the player only the taps that open the torrent sheet are possible
    const canTap = IN_APP_PLAYER_READY || (!autoSelect && !usePreviousBatch)

    return <View className="gap-6">
        <StreamControlsPhone autoSelect={autoSelect} onAutoSelect={setAutoSelect}
            batchName={usePreviousBatch ? batchHistory?.torrent?.name : undefined} onForgetBatch={() => setForgetOpen(true)}
            forgetting={isDeletingBatchHistory} mappingError={!!episodeCollection?.hasMappingError} />
        <TorrentStreamEpisodeSection entry={entry} episodeCollection={episodeCollection} bottomSection={bottomSection} pluginType="torrentstream"
            onEpisodeClick={canTap ? episode => handleEpisodeClick(episode) : undefined}
            onPlayNextEpisodeOnMount={episode => autoSelect ? handleAutoSelect(episode) : handleEpisodeClick(episode)} />
        <ForgetBatchDialog open={forgetOpen} onOpenChange={setForgetOpen} onDisable={() => setUsePreviousBatch(false)}
            onDelete={() => {
                setUsePreviousBatch(false)
                deleteBatchHistory({ mediaId: entry.mediaId })
            }} />
    </View>
}
