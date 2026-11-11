import type { Anime_Episode, NativePlayer_PlaybackInfo } from "@/api/generated/types"
import { useGetAnimeEpisodeCollection } from "@/api/hooks/anime.hooks"
import { useGetAnimeEntry } from "@/api/hooks/anime_entries.hooks"
import { toast } from "@/components/ui/toast/toast-store"
import { tr } from "@/lib/app-language"
import { useRouter } from "@/lib/navigation"
import { useAutoPlaySelectedTorrent, useSetTorrentstreamAutoplayInfo } from "@/main/_features/autoplay/autoplay.atoms"
import { getBatchSelectionParams } from "@/main/_features/autoplay/batches"
import { useHandleStartDebridStream } from "@/main/entry/_containers/debrid-stream/_lib/handle-debrid-stream"
import { __torrentSearch_selectionAtom, __torrentSearch_selectionEpisodeAtom } from "@/main/entry/_containers/torrent-search/torrent-search.atoms"
import { useHandleStartTorrentStream } from "@/main/entry/_containers/torrent-stream/_lib/handle-torrent-stream"
import {
    __debridStream_autoSelectFileAtom,
    __debridStream_currentSessionAutoSelectAtom,
    __torrentStream_autoSelectFileAtom,
    __torrentStream_currentSessionAutoSelectAtom,
    useTorrentSearchSelectedStreamEpisode,
} from "@/main/entry/_containers/torrent-stream/torrent-stream.atoms"
import { useHandlePlayMedia } from "@/main/entry/_lib/handle-play-media"
import { useAtomValue, useSetAtom } from "jotai"
import React from "react"
import { player_miniAtom } from "./player.atoms"

/*
 * Previous/next episode of what plays (web video-core-playlist.tsx, useVideoCorePlaylistSetup + useVideoCorePlaylist):
 * library files and Nakama files start through playMediaFile, torrent and debrid streams through their start hooks
 * (session auto select, else the remembered batch torrent, else the torrent sheet on the anime page). While a global
 * playlist (Playlists, 2.14) runs, the player screen asks the playlist instead (playlistNavigation); watch parties
 * (Nakama, 2.13) are not part of this.
 */
export function usePlayerPlaylist(info: NativePlayer_PlaybackInfo | null) {
    const router = useRouter()
    const mediaId = info?.media?.id
    const type = info?.streamType
    const { data: animeEntry } = useGetAnimeEntry(mediaId)
    const { data: episodeCollection } = useGetAnimeEpisodeCollection(mediaId)

    const episodes = React.useMemo<Anime_Episode[]>(() => {
        if (type === "localfile" || type === "nakama") return animeEntry?.episodes?.filter(ep => ep.type === "main") ?? []
        return episodeCollection?.episodes ?? []
    }, [type, animeEntry?.episodes, episodeCollection?.episodes])

    const current = info?.episode?.progressNumber ?? 0
    const previousEpisode = episodes.find(ep => ep.progressNumber === current - 1) ?? null
    const nextEpisode = episodes.find(ep => ep.progressNumber === current + 1) ?? null

    const { playMediaFile } = useHandlePlayMedia()
    const torrent = useHandleStartTorrentStream()
    const debrid = useHandleStartDebridStream()
    const { autoPlayTorrent, setAutoPlayTorrent } = useAutoPlaySelectedTorrent()
    const setAutoplayInfo = useSetTorrentstreamAutoplayInfo()
    const torrentSessionAuto = useAtomValue(__torrentStream_currentSessionAutoSelectAtom)
    const debridSessionAuto = useAtomValue(__debridStream_currentSessionAutoSelectAtom)
    const torrentAutoFile = useAtomValue(__torrentStream_autoSelectFileAtom)
    const debridAutoFile = useAtomValue(__debridStream_autoSelectFileAtom)
    const setTorrentSearch = useSetAtom(__torrentSearch_selectionAtom)
    const setTorrentSearchEpisode = useSetAtom(__torrentSearch_selectionEpisodeAtom)
    const { setTorrentSearchStreamEpisode } = useTorrentSearchSelectedStreamEpisode()
    const setMini = useSetAtom(player_miniAtom)

    function updateAutoplayInfo(episode: Anime_Episode) {
        if (!animeEntry) return
        const following = episodes.find(e => e.episodeNumber === episode.episodeNumber + 1)
        setAutoplayInfo(following?.aniDBEpisode ? {
            allEpisodes: episodes,
            entry: animeEntry,
            episodeNumber: following.episodeNumber,
            aniDBEpisode: following.aniDBEpisode,
            type: "torrentstream",
        } : null)
    }

    function startStream(episode: Anime_Episode) {
        if (!animeEntry || !episode.aniDBEpisode) return
        const base = { mediaId: animeEntry.mediaId, episodeNumber: episode.episodeNumber, aniDBEpisode: episode.aniDBEpisode }
        if (type === "torrent" && torrentSessionAuto) {
            torrent.handleAutoSelectStream(base)
            updateAutoplayInfo(episode)
            return
        }
        if (type === "debrid" && debridSessionAuto) {
            debrid.handleAutoSelectStream(base)
            return
        }
        if (autoPlayTorrent?.torrent?.isBatch && autoPlayTorrent.entry?.mediaId === animeEntry.mediaId) {
            const batch = getBatchSelectionParams(autoPlayTorrent.batchFiles, episode.episodeNumber, episode.aniDBEpisode)
            if (type === "torrent") {
                torrent.handleStreamSelection({
                    ...base,
                    torrent: autoPlayTorrent.torrent,
                    chosenFileIndex: batch.fileIndex,
                    batchEpisodeFiles: batch.batchEpisodeFiles,
                })
                if (batch.batchEpisodeFiles) setAutoPlayTorrent(autoPlayTorrent.torrent, animeEntry, batch.batchEpisodeFiles)
                updateAutoplayInfo(episode)
            } else {
                const file = autoPlayTorrent.batchFiles?.files?.find(n => n.index === autoPlayTorrent.batchFiles!.current + 1)
                debrid.handleStreamSelection({
                    ...base,
                    torrent: autoPlayTorrent.torrent,
                    chosenFileId: file ? String(file.index) : "",
                    batchEpisodeFiles: (autoPlayTorrent.batchFiles && file) ? {
                        ...autoPlayTorrent.batchFiles,
                        current: file.index,
                        currentEpisodeNumber: episode.episodeNumber,
                        currentAniDBEpisode: episode.aniDBEpisode,
                    } : undefined,
                })
            }
            return
        }
        // No torrent to continue with: the torrent sheet on the anime page picks one (web opened its drawer over the player)
        setTorrentSearchEpisode(episode.episodeNumber)
        setTorrentSearchStreamEpisode(episode)
        if (type === "torrent") setTorrentSearch(torrentAutoFile ? "torrentstream-select" : "torrentstream-select-file")
        else setTorrentSearch(debridAutoFile ? "debridstream-select" : "debridstream-select-file")
        setMini(true)
        router.push(`/entry?id=${animeEntry.mediaId}`)
    }

    function playEpisode(which: "previous" | "next") {
        const episode = which === "next" ? nextEpisode : previousEpisode
        if (!episode || !animeEntry) return
        switch (type) {
            case "localfile":
            case "nakama":
                if (!episode.localFile?.path) {
                    toast.error(tr("Local file not found", "Lokale Datei nicht gefunden"))
                    return
                }
                playMediaFile({ path: episode.localFile.path, episode, mediaId: animeEntry.mediaId })
                return
            case "torrent":
            case "debrid":
                startStream(episode)
                return
        }
    }

    return {
        hasNextEpisode: !!nextEpisode,
        hasPreviousEpisode: !!previousEpisode,
        nextEpisode,
        playEpisode,
    }
}
