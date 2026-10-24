import { Anime_Entry, Anime_Episode } from "@/api/generated/types"
import { useGetAnimeEpisodeCollection } from "@/api/hooks/anime.hooks"
import { useDeleteTorrentstreamBatchHistory, useGetTorrentstreamBatchHistory } from "@/api/hooks/torrentstream.hooks"
import { useAutoPlaySelectedTorrent, useTorrentstreamAutoplay } from "@/app/(main)/_features/autoplay/autoplay"
import { getBatchSelectionParams } from "@/app/(main)/_features/autoplay/batches.ts"

import { useSeaCommandInject } from "@/app/(main)/_features/sea-command/use-inject"
import { useServerStatus } from "@/app/(main)/_hooks/use-server-status"
import { ENTRY_VIEW_TRANSITION } from "@/app/(main)/entry/_containers/entry-view-transition"
import { useTorrentSearchSelectedStreamEpisode } from "@/app/(main)/entry/_containers/torrent-search/_lib/handle-torrent-selection"
import {
    __torrentSearch_selectionAtom,
    __torrentSearch_selectionEpisodeAtom,
} from "@/app/(main)/entry/_containers/torrent-search/torrent-search-drawer"
import { TorrentStreamEpisodeSection } from "@/app/(main)/entry/_containers/torrent-stream/_components/torrent-stream-episode-section"
import { StreamControlsPhone } from "@/app/(main)/entry/_containers/torrent-stream/_components/stream-controls-phone"
import { useHandleStartTorrentStream } from "@/app/(main)/entry/_containers/torrent-stream/_lib/handle-torrent-stream"
import { ForcePlaybackMethod, useForcePlaybackMethod } from "@/app/(main)/entry/_lib/handle-play-media"
import { ConfirmationDialog, useConfirmationDialog } from "@/components/shared/confirmation-dialog"
import { PageWrapper } from "@/components/shared/page-wrapper"
import { AppLayoutStack } from "@/components/ui/app-layout"
import { logger } from "@/lib/helpers/debug"
import { atom } from "jotai"
import { useAtom, useSetAtom } from "jotai/react"
import { atomWithStorage } from "jotai/utils"
import React from "react"
import { StreamPageSkeleton } from "../../_components/stream-page-skeleton"

type TorrentStreamPageProps = {
    children?: React.ReactNode
    entry: Anime_Entry
    bottomSection?: React.ReactNode
}

export const __torrentStream_autoSelectFileAtom = atomWithStorage("sea-torrentstream-auto-select-file", true)
export const __torrentStream_currentSessionAutoSelectAtom = atom(false)

export function TorrentStreamPage(props: TorrentStreamPageProps) {

    const {
        children,
        entry,
        bottomSection,
        ...rest
    } = props

    const serverStatus = useServerStatus()

    const [autoSelect, setAutoSelect] = useAtom(__torrentStream_currentSessionAutoSelectAtom)

    const [autoSelectFile] = useAtom(__torrentStream_autoSelectFileAtom)

    /**
     * Get all episodes to watch
     */
    const { data: episodeCollection, isLoading } = useGetAnimeEpisodeCollection(entry.mediaId)

    React.useLayoutEffect(() => {
        // Set auto-select to the server status value
        if (!episodeCollection?.hasMappingError) {
            setAutoSelect(serverStatus?.torrentstreamSettings?.autoSelect ?? false)
        } else {
            // Fall back to manual select if no download info (no Animap data)
            setAutoSelect(false)
        }
    }, [serverStatus?.torrentstreamSettings?.autoSelect, episodeCollection])

    const setTorrentSearchSelection = useSetAtom(__torrentSearch_selectionAtom)
    const setTorrentSearchEpisode = useSetAtom(__torrentSearch_selectionEpisodeAtom)

    // Stores the episode that was clicked
    const { setTorrentSearchStreamEpisode } = useTorrentSearchSelectedStreamEpisode()


    /**
     * Handle auto-select
     */
    const { handleAutoSelectStream, handleStreamSelection, isPending } = useHandleStartTorrentStream()
    const { setTorrentstreamAutoplayInfo } = useTorrentstreamAutoplay()
    const { mutate: deleteBatchHistory, isPending: isDeletingBatchHistory } = useDeleteTorrentstreamBatchHistory()

    const { setAutoPlayTorrent } = useAutoPlaySelectedTorrent()

    const { forcePlaybackMethodFn } = useForcePlaybackMethod()

    const { data: batchHistory } = useGetTorrentstreamBatchHistory(entry?.mediaId, true)

    const [usePreviousBatch, setUsePreviousBatch] = React.useState(false)

    React.useEffect(() => {
        setUsePreviousBatch(!!batchHistory?.torrent?.isBatch)
    }, [batchHistory])

    function handleDisablePreviousBatch() {
        setUsePreviousBatch(false)
    }

    function handleDeletePreviousBatch() {
        handleDisablePreviousBatch()
        deleteBatchHistory({ mediaId: entry.mediaId })
    }

    const confirmPreviousBatchAction = useConfirmationDialog({
        title: "Disable previous torrent",
        description: "Disable using the saved previous batch for now, or delete the saved history entirely.",
        actionText: "Delete history",
        cancelText: "Disable only",
        onConfirm: handleDeletePreviousBatch,
        onCancel: handleDisablePreviousBatch,
    })

    // Function to set the torrent stream autoplay info
    // It checks if there is a next episode and if it has aniDBEpisode
    // If so, it sets the autoplay info
    // Otherwise, it resets the autoplay info
    function handleSetTorrentstreamAutoplayInfo(episode: Anime_Episode | undefined) {
        if (!episode || !episode.aniDBEpisode || !episodeCollection?.episodes) return
        const nextEpisode = episodeCollection?.episodes?.find(e => e.episodeNumber === episode.episodeNumber + 1)
        logger("TORRENTSTREAM").info("Auto select, Next episode", nextEpisode)
        if (nextEpisode && !!nextEpisode.aniDBEpisode) {
            setTorrentstreamAutoplayInfo({
                allEpisodes: episodeCollection?.episodes,
                entry: entry,
                episodeNumber: nextEpisode.episodeNumber,
                aniDBEpisode: nextEpisode.aniDBEpisode,
                type: "torrentstream",
            })
        } else {
            setTorrentstreamAutoplayInfo(null)
        }
    }

    function handleAutoSelect(entry: Anime_Entry, episode: Anime_Episode | undefined) {
        if (isPending || !episode || !episode.aniDBEpisode || !episodeCollection?.episodes) return
        // Start the torrent stream
        handleAutoSelectStream({
            mediaId: entry.mediaId,
            episodeNumber: episode.episodeNumber,
            aniDBEpisode: episode.aniDBEpisode,
        })

        // Set the torrent stream autoplay info
        handleSetTorrentstreamAutoplayInfo(episode)
    }

    function handlePlayNextEpisodeOnMount(episode: Anime_Episode) {
        if (autoSelect) {
            handleAutoSelect(entry, episode)
        } else {
            handleEpisodeClick(episode)
        }
    }

    /**
     * Handle episode click
     * - If auto-select is enabled, send the streaming request
     * - If auto-select is disabled, open the torrent drawer
     */
        // const setTorrentStreamLoader = useSetTorrentStreamLoader()
    const handleEpisodeClick = (episode: Anime_Episode, forcePlaybackMethod?: ForcePlaybackMethod) => {
            if (isPending) return

            console.log("handleEpisodeClick", episode, forcePlaybackMethod)

            setTorrentSearchStreamEpisode(episode)

            React.startTransition(() => {
                // If auto-select is enabled, send the streaming request
                if (autoSelect) {
                    forcePlaybackMethodFn(forcePlaybackMethod, () => {
                        handleAutoSelect(entry, episode)
                    })
                } else {

                    let started = false

                    // If we're using the previous batch
                    if (usePreviousBatch && batchHistory?.torrent && episode.aniDBEpisode) {

                        // Store the batch for auto play
                        setAutoPlayTorrent(batchHistory?.torrent, entry, batchHistory.batchEpisodeFiles)

                        if (autoSelectFile) {
                            forcePlaybackMethodFn(forcePlaybackMethod, () => {
                                handleStreamSelection({
                                    mediaId: entry.mediaId,
                                    episodeNumber: episode.episodeNumber,
                                    aniDBEpisode: episode.aniDBEpisode!,
                                    torrent: batchHistory.torrent!,
                                    chosenFileIndex: undefined,
                                    batchEpisodeFiles: undefined,
                                })
                            })
                            started = true
                        } else {
                            // Reuse the previous batch when the requested episode can be matched safely.
                            if (batchHistory?.batchEpisodeFiles) {
                                console.log("handleEpisodeClick (batchHistory)",
                                    batchHistory?.batchEpisodeFiles,
                                    episode.aniDBEpisode,
                                    episode.episodeNumber)

                                const batchParams = getBatchSelectionParams(batchHistory.batchEpisodeFiles,
                                    episode.episodeNumber,
                                    episode.aniDBEpisode)

                                if (batchParams.fileIndex !== undefined) {
                                    forcePlaybackMethodFn(forcePlaybackMethod, () => {
                                        handleStreamSelection({
                                            mediaId: entry.mediaId,
                                            episodeNumber: episode.episodeNumber,
                                            aniDBEpisode: episode.aniDBEpisode!,
                                            torrent: batchHistory.torrent!,
                                            chosenFileIndex: batchParams.fileIndex,
                                            batchEpisodeFiles: batchParams.batchEpisodeFiles,
                                        })
                                    })
                                    started = true
                                }
                            }
                        }
                    }

                    if (!started) {
                        setTorrentSearchEpisode(episode.episodeNumber)
                        forcePlaybackMethodFn(forcePlaybackMethod, () => {
                            // If auto-select file is enabled, open the torrent drawer
                            if (autoSelectFile) {
                                setTorrentSearchSelection("torrentstream-select")
                            } else { // Otherwise, open the torrent drawer
                                setTorrentSearchSelection("torrentstream-select-file")
                            }
                        })
                    }
                    // Set the torrent stream autoplay info
                    handleSetTorrentstreamAutoplayInfo(episode)

                }
            })
            // toast.info("Starting torrent stream...")
        }

    const { inject, remove } = useSeaCommandInject()

    // Inject episodes into command palette when they're loaded
    React.useEffect(() => {
        if (!episodeCollection?.episodes?.length) return

        inject("torrent-stream-episodes", {
            items: episodeCollection.episodes.map(episode => ({
                id: `episode-${episode.episodeNumber}`,
                value: `${episode.episodeNumber}`,
                heading: "Episodes",
                render: () => (
                    <div className="flex gap-1 items-center w-full">
                        <p className="max-w-[70%] truncate">{episode.displayTitle}</p>
                        {!!episode.episodeTitle && (
                            <p className="text-[--muted] flex-1 truncate">- {episode.episodeTitle}</p>
                        )}
                    </div>
                ),
                onSelect: () => handleEpisodeClick(episode),
            })),
            // Optional custom filter
            filter: ({ item, input }) => {
                if (!input) return true
                return item.value.toLowerCase().includes(input.toLowerCase())
            },
        })

        return () => remove("torrent-stream-episodes")
    }, [episodeCollection?.episodes])

    if (!entry.media) return null
    if (isLoading) return <StreamPageSkeleton />

    return (
        <>


            <PageWrapper
                data-anime-entry-page-torrent-stream-view
                key="torrent-streaming-episodes"
                className="relative 2xl:order-first pb-10 lg:pt-0"
                {...ENTRY_VIEW_TRANSITION}
            >
                <div className="h-10 lg:h-0" />
                <AppLayoutStack data-torrent-stream-page>
                    {/*<div className="absolute right-0 top-[-3rem]" data-torrent-stream-page-title-container>*/}
                    {/*    <h2 className="text-xl lg:text-3xl flex items-center gap-3">Torrent streaming</h2>*/}
                    {/*</div>*/}

                    <StreamControlsPhone kind="torrent" autoSelect={autoSelect} onAutoSelect={setAutoSelect}
                        batchName={usePreviousBatch ? batchHistory?.torrent?.name : undefined} onForgetBatch={() => confirmPreviousBatchAction.open()}
                        forgetting={isDeletingBatchHistory} mappingError={!!episodeCollection?.hasMappingError} />

                    <TorrentStreamEpisodeSection
                        contextType="torrentstream"
                        episodeCollection={episodeCollection}
                        entry={entry}
                        onEpisodeClick={handleEpisodeClick}
                        onPlayNextEpisodeOnMount={handlePlayNextEpisodeOnMount}
                        bottomSection={bottomSection}
                    />
                </AppLayoutStack>
            </PageWrapper>
            <ConfirmationDialog {...confirmPreviousBatchAction} />
        </>
    )
}
