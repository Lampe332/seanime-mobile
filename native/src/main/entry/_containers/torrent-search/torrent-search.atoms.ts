import { HibikeTorrent_AnimeTorrent } from "@/api/generated/types"
import { atom } from "jotai"

// The web app defined these next to its drawer/container components (torrent-search-drawer.tsx,
// torrent-search-container.tsx); the native sheet (E2) and the search hook share them from here.
export const __torrentSearch_selectionAtom = atom<TorrentSelectionType | undefined>(undefined)
export const __torrentSearch_selectionEpisodeAtom = atom<number | undefined>(undefined)

export type TorrentSelectionType =
    "torrentstream-select"
    | "torrentstream-select-file"
    | "debridstream-select"
    | "debridstream-select-file"
    | "download"

export const __torrentSearch_selectedTorrentsAtom = atom<HibikeTorrent_AnimeTorrent[]>([])
