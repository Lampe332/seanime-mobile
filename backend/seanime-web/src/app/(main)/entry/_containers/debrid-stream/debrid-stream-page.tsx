import { Anime_Entry, Anime_Episode } from "@/api/generated/types"
import { useGetAnimeEpisodeCollection } from "@/api/hooks/anime.hooks"
import { useDeleteTorrentstreamBatchHistory, useGetTorrentstreamBatchHistory } from "@/api/hooks/torrentstream.hooks"
import { useDebridstreamAutoplay } from "@/app/(main)/_features/autoplay/autoplay"
import { useSelectedDebridService, useServerStatus } from "@/app/(main)/_hooks/use-server-status"
import { useHandleStartDebridStream } from "@/app/(main)/entry/_containers/debrid-stream/_lib/handle-debrid-stream"
import { ENTRY_VIEW_TRANSITION } from "@/app/(main)/entry/_containers/entry-view-transition"
import { useTorrentSearchSelectedStreamEpisode } from "@/app/(main)/entry/_containers/torrent-search/_lib/handle-torrent-selection"
import {
    __torrentSearch_selectionAtom,
    __torrentSearch_selectionEpisodeAtom,
} from "@/app/(main)/entry/_containers/torrent-search/torrent-search-drawer"
import { TorrentStreamEpisodeSection } from "@/app/(main)/entry/_containers/torrent-stream/_components/torrent-stream-episode-section"
import { StreamControlsPhone } from "@/app/(main)/entry/_containers/torrent-stream/_components/stream-controls-phone"
import { ForcePlaybackMethod, useForcePlaybackMethod } from "@/app/(main)/entry/_lib/handle-play-media"
import { ConfirmationDialog, useConfirmationDialog } from "@/components/shared/confirmation-dialog"
import { useTr } from "@/lib/app-language"
import { PageWrapper } from "@/components/shared/page-wrapper"
import { AppLayoutStack } from "@/components/ui/app-layout"
import { logger } from "@/lib/helpers/debug"
import { DEBRID_SERVICE } from "@/lib/server/settings"
import { atom } from "jotai"
import { useAtom } from "jotai/react"
import { atomWithStorage } from "jotai/utils"
import React from "react"
import { StreamPageSkeleton } from "../../_components/stream-page-skeleton"

type DebridStreamPageProps = {
    children?: React.ReactNode
    entry: Anime_Entry
    bottomSection?: React.ReactNode
}

export const __debridStream_autoSelectFileAtom = atomWithStorage("sea-debridstream-manually-select-file", false)
export const __debridStream_currentSessionAutoSelectAtom = atom(false)

// DEVNOTE: This page uses some utility functions from the TorrentStream feature

export function DebridStreamPage(props: DebridStreamPageProps) {

    const {
        children,
        entry,
        bottomSection,
        ...rest
    } = props

    const serverStatus = useServerStatus()

    const [autoSelect, setAutoSelect] = React.useState(serverStatus?.debridSettings?.streamAutoSelect ?? false)
    const [autoSelectFile] = useAtom(__debridStream_autoSelectFileAtom)

    const [, setCurrentSessionAutoSelect] = useAtom(__debridStream_currentSessionAutoSelectAtom)
    React.useEffect(() => {
        setCurrentSessionAutoSelect(autoSelect)
    }, [autoSelect])

    /**
     * Get all episodes to watch
     */
    const { data: episodeCollection, isLoading } = useGetAnimeEpisodeCollection(entry.mediaId)

    React.useLayoutEffect(() => {
        if (!episodeCollection?.hasMappingError) {
            setAutoSelect(serverStatus?.debridSettings?.streamAutoSelect ?? false)
        } else {
            setAutoSelect(false)
        }
    }, [serverStatus?.torrentstreamSettings?.autoSelect, episodeCollection])

    const [, setTorrentSearchDrawerOpen] = useAtom(__torrentSearch_selectionAtom)
    const [, setTorrentSearchEpisode] = useAtom(__torrentSearch_selectionEpisodeAtom)

    const { setTorrentSearchStreamEpisode } = useTorrentSearchSelectedStreamEpisode()

    function handlePlayNextEpisodeOnMount(episode: Anime_Episode) {
        if (autoSelect) {
            handleAutoSelect(entry, episode)
        } else {
            handleEpisodeClick(episode)
        }
    }

    const { handleAutoSelectStream, handleStreamSelection } = useHandleStartDebridStream()

    const { forcePlaybackMethodFn } = useForcePlaybackMethod()

    const { setDebridstreamAutoplayInfo } = useDebridstreamAutoplay()
    const { mutate: deleteBatchHistory, isPending: isDeletingBatchHistory } = useDeleteTorrentstreamBatchHistory()

    const { data: batchHistory } = useGetTorrentstreamBatchHistory(entry?.mediaId, true)

    const [usePreviousBatch, setUsePreviousBatch] = React.useState(false)

    const { selectedDebridService } = useSelectedDebridService()

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

    const tr = useTr()
    const confirmPreviousBatchAction = useConfirmationDialog({
        title: tr("Disable previous torrent", "Vorherigen Torrent nicht nutzen"),
        description: tr("Disable using the saved previous batch for now, or delete the saved history entirely.",
            "Den gespeicherten Batch vorerst nicht nutzen oder den gespeicherten Verlauf ganz löschen."),
        actionText: tr("Delete history", "Verlauf löschen"),
        cancelText: tr("Disable only", "Nur nicht nutzen"),
        onConfirm: handleDeletePreviousBatch,
        onCancel: handleDisablePreviousBatch,
    })

    // It checks if there is a next episode and if it has aniDBEpisode
    // If so, it sets the autoplay info
    // Otherwise, it resets the autoplay info
    function handleSetDebridstreamAutoplayInfo(episode: Anime_Episode | undefined) {
        if (!episode || !episode.aniDBEpisode || !episodeCollection?.episodes) return
        const nextEpisode = episodeCollection?.episodes?.find(e => e.episodeNumber === episode.episodeNumber + 1)
        logger("TORRENTSTREAM").info("Auto select, Next episode", nextEpisode)
        if (nextEpisode && !!nextEpisode.aniDBEpisode) {
            setDebridstreamAutoplayInfo({
                allEpisodes: episodeCollection?.episodes,
                entry: entry,
                episodeNumber: nextEpisode.episodeNumber,
                aniDBEpisode: nextEpisode.aniDBEpisode,
                type: "debridstream",
            })
        } else {
            setDebridstreamAutoplayInfo(null)
        }
    }

    function handleAutoSelect(entry: Anime_Entry, episode: Anime_Episode | undefined) {
        if (!episode || !episode.aniDBEpisode || !episodeCollection?.episodes) return
        handleAutoSelectStream({
            mediaId: entry.mediaId,
            episodeNumber: episode.episodeNumber,
            aniDBEpisode: episode.aniDBEpisode,
        })

        handleSetDebridstreamAutoplayInfo(episode)
    }

    const handleEpisodeClick = (episode: Anime_Episode, forcePlaybackMethod?: ForcePlaybackMethod) => {
        if (!episode || !episode.aniDBEpisode) return

        console.log("handleEpisodeClick", episode, forcePlaybackMethod)

        setTorrentSearchStreamEpisode(episode)

        if (autoSelect) {
            forcePlaybackMethodFn(forcePlaybackMethod, () => {
                handleAutoSelect(entry, episode)
            })
        } else {

            let started = false

            // If we're using the previous batch
            if (usePreviousBatch && batchHistory?.torrent && episode.aniDBEpisode) {
                if (autoSelectFile) {
                    forcePlaybackMethodFn(forcePlaybackMethod, () => {
                        handleStreamSelection({
                            mediaId: entry.mediaId,
                            episodeNumber: episode.episodeNumber,
                            aniDBEpisode: episode.aniDBEpisode!,
                            torrent: batchHistory.torrent!,
                            chosenFileId: "",
                            batchEpisodeFiles: undefined,
                        })
                    })
                    started = true
                } else {
                    // Only auto select the file index if the user is trying to watch the next episode
                    if (batchHistory?.batchEpisodeFiles && selectedDebridService !== DEBRID_SERVICE.TORBOX) {
                        let fileIndex: number | undefined = undefined

                        console.log("handleEpisodeClick (batchHistory)",
                            batchHistory?.batchEpisodeFiles,
                            episode.aniDBEpisode,
                            episode.episodeNumber)

                        if (batchHistory?.batchEpisodeFiles.currentAniDBEpisode === episode.aniDBEpisode) {
                            fileIndex = batchHistory.batchEpisodeFiles.current
                        } else {
                            // guess index based on the last selected file
                            const offset = episode.episodeNumber - batchHistory.batchEpisodeFiles.currentEpisodeNumber
                            const file = batchHistory.batchEpisodeFiles.files?.find(f => f.index === (batchHistory.batchEpisodeFiles?.current || 0) + offset)
                            if (file) {
                                fileIndex = file.index
                                console.log("handleEpisodeClick (batchHistory) found file", file)
                            }
                        }

                        if (fileIndex !== undefined) {
                            forcePlaybackMethodFn(forcePlaybackMethod, () => {
                                handleStreamSelection({
                                    mediaId: entry.mediaId,
                                    episodeNumber: episode.episodeNumber,
                                    aniDBEpisode: episode.aniDBEpisode!,
                                    torrent: batchHistory.torrent!,
                                    chosenFileId: String(fileIndex),
                                    batchEpisodeFiles: (batchHistory.batchEpisodeFiles) ? {
                                        ...batchHistory.batchEpisodeFiles!,
                                        files: batchHistory.batchEpisodeFiles!.files!,
                                        current: fileIndex!,
                                        currentAniDBEpisode: episode.aniDBEpisode!,
                                        currentEpisodeNumber: episode.episodeNumber,
                                    } : undefined,
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
                    // If auto-select file is enabled, open the debrid stream select drawer
                    if (autoSelectFile) {
                        setTorrentSearchDrawerOpen("debridstream-select")
                        handleSetDebridstreamAutoplayInfo(episode)
                    } else {
                        // Otherwise, open the debrid stream select file drawer
                        setTorrentSearchDrawerOpen("debridstream-select-file")

                    }
                })
            }

            if (selectedDebridService !== DEBRID_SERVICE.TORBOX) {
                handleSetDebridstreamAutoplayInfo(episode)
            }
        }
    }

    if (!entry.media) return null
    if (isLoading) return <StreamPageSkeleton />

    return (
        <>
            <PageWrapper
                data-anime-entry-page-debrid-stream-view
                key="debrid-streaming-episodes"
                className="relative 2xl:order-first pb-10 lg:pt-0"
                {...ENTRY_VIEW_TRANSITION}
            >
                <div className="h-10 lg:h-0" />
                <AppLayoutStack data-debrid-stream-page>

                    <StreamControlsPhone kind="debrid" autoSelect={autoSelect} onAutoSelect={setAutoSelect}
                        batchName={usePreviousBatch ? batchHistory?.torrent?.name : undefined} onForgetBatch={() => confirmPreviousBatchAction.open()}
                        forgetting={isDeletingBatchHistory} mappingError={!!episodeCollection?.hasMappingError} />

                    <TorrentStreamEpisodeSection
                        contextType="debridstream"
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
