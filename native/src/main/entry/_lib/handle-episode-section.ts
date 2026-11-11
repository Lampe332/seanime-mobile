import type { Anime_Entry, Anime_Episode } from "@/api/generated/types"
import { IN_APP_PLAYER_READY } from "@/main/_features/player/player-availability"
import { useHandlePlayMedia } from "@/main/entry/_lib/handle-play-media"
import { usePlayNextVideoOnMount } from "@/main/entry/_lib/handle-play-on-mount"
import React from "react"

type EntryEpisodes = Pick<Anime_Entry, "episodes" | "nextEpisode" | "listData">

/** Main episodes in the server's order */
export function getMainEpisodes(entry: EntryEpisodes) {
    return entry.episodes?.filter(ep => ep.type === "main") ?? []
}

/** Specials by their title, numbers in number order ("S2" before "S10") */
export function getSpecialEpisodes(entry: EntryEpisodes) {
    return (entry.episodes?.filter(ep => ep.type === "special") ?? [])
        .sort((a, b) => a.displayTitle.localeCompare(b.displayTitle, undefined, { numeric: true }))
}

/** NC/other files that exist, by their path */
export function getNcEpisodes(entry: EntryEpisodes) {
    return (entry.episodes?.filter(ep => ep.type === "nc" && !!ep.localFile?.path) ?? [])
        .sort((a, b) => a.localFile!.path!.localeCompare(b.localFile!.path!, undefined, { numeric: true }))
}

/**
 * The episodes of the "up next" row: everything after the list progress while there is a next episode; with the series
 * watched through (progress, no next episode) all of them, the last one first.
 */
export function getEpisodesToWatch(entry: EntryEpisodes, mainEpisodes: Anime_Episode[]) {
    const ret = mainEpisodes.filter(ep => !entry.nextEpisode || ep.progressNumber > (entry.listData?.progress ?? 0))
    return (!!entry.listData?.progress && !entry.nextEpisode) ? ret.reverse() : ret
}

export function useHandleEpisodeSection(props: { entry: Anime_Entry }) {
    const { entry } = props
    const media = entry.media

    const { playMediaFile } = useHandlePlayMedia()

    // "Continue" opened this page: play the next episode, once the in-app player (E3) exists. Opening the page alone never plays.
    const playNextEpisode = React.useCallback(() => {
        if (entry.nextEpisode) {
            playMediaFile({ path: entry.nextEpisode.localFile?.path ?? "", mediaId: entry.mediaId, episode: entry.nextEpisode })
        }
    }, [entry.nextEpisode, entry.mediaId, playMediaFile])
    usePlayNextVideoOnMount({ mediaId: entry.mediaId, onPlay: playNextEpisode }, IN_APP_PLAYER_READY && !!entry.nextEpisode)

    const mainEpisodes = React.useMemo(() => getMainEpisodes(entry), [entry])
    const specialEpisodes = React.useMemo(() => getSpecialEpisodes(entry), [entry])
    const ncEpisodes = React.useMemo(() => getNcEpisodes(entry), [entry])
    const hasInvalidEpisodes = React.useMemo(() => entry.episodes?.some(ep => ep.isInvalid) ?? false, [entry.episodes])
    const episodesToWatch = React.useMemo(() => getEpisodesToWatch(entry, mainEpisodes), [entry, mainEpisodes])

    return {
        media,
        mainEpisodes,
        specialEpisodes,
        ncEpisodes,
        hasInvalidEpisodes,
        episodesToWatch,
    }
}
