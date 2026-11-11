import type { Anime_Entry, Anime_Episode, HibikeTorrent_AnimeTorrent, HibikeTorrent_BatchEpisodeFiles } from "@/api/generated/types"
import { atomWithStorage } from "@/lib/storage"
import { useAtom, useSetAtom } from "jotai"

/*
 * The stored state of autoplay.ts (same MMKV keys as the web's localStorage keys). Starting a local file clears it
 * (handle-play-media); the torrent and debrid pages set it when an episode is chosen. The autoplay manager that reads it
 * (countdown, next torrent/debrid episode) comes with the player (E3).
 */
export type AutoplayInfo = {
    allEpisodes: Anime_Episode[]
    entry: Anime_Entry
    episodeNumber: number
    aniDBEpisode: string
    type: "torrentstream" | "debridstream"
}

// Stores info about the entry that's being streamed
export const __autoPlay_stateAtom = atomWithStorage<AutoplayInfo | null>("sea-autoplay-info", null)

// Stores the torrent that was selected for the current stream; the autoplay manager takes the next episode from it
const __autoPlay_selectedTorrentAtom = atomWithStorage<{
    entry: Anime_Entry,
    torrent: HibikeTorrent_AnimeTorrent,
    batchFiles?: HibikeTorrent_BatchEpisodeFiles // Used when user manually selects a file from a batch
} | null>("sea-autoplay-selected-torrent", null)

export function useSetTorrentstreamAutoplayInfo() {
    return useSetAtom(__autoPlay_stateAtom)
}

export function useAutoPlaySelectedTorrent() {
    const [selectedTorrent, setSelectedTorrent] = useAtom(__autoPlay_selectedTorrentAtom)

    return {
        autoPlayTorrent: selectedTorrent,
        setAutoPlayTorrent: (torrent: HibikeTorrent_AnimeTorrent, entry: Anime_Entry, batchFiles?: HibikeTorrent_BatchEpisodeFiles) => setSelectedTorrent({
            entry,
            torrent,
            batchFiles,
        }),
    }
}
