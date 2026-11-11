import type { Anime_Episode, DebridClient_StreamState } from "@/api/generated/types"
import { atomWithStorage } from "@/lib/storage"
import { atom, useAtom } from "jotai"

/*
 * Atoms the web app kept next to its screens (playback-play-pill.tsx, torrent-stream-page.tsx, debrid-stream-page.tsx,
 * handle-torrent-selection.ts); the native pages, the torrent sheet and the start hooks share them from here.
 * The play pill that shows the loading state comes with the player (E3).
 */

// playback-play-pill.tsx
export const __torrentstream__loadingStateAtom = atom<string | null>(null)
export const __torrentstream__isLoadedAtom = atom<boolean>(false)
export const __debridstream_stateAtom = atom<DebridClient_StreamState | null>(null)

// torrent-stream-page.tsx
export const __torrentStream_autoSelectFileAtom = atomWithStorage("sea-torrentstream-auto-select-file", true)
export const __torrentStream_currentSessionAutoSelectAtom = atom(false)

// debrid-stream-page.tsx
export const __debridStream_autoSelectFileAtom = atomWithStorage("sea-debridstream-manually-select-file", false)
export const __debridStream_currentSessionAutoSelectAtom = atom(false)

// handle-torrent-selection.ts: the episode a stream sheet was opened for
const __torrentSearch_streamingSelectedEpisodeAtom = atom<Anime_Episode | null>(null)

export function useTorrentSearchSelectedStreamEpisode() {
    const [value, setter] = useAtom(__torrentSearch_streamingSelectedEpisodeAtom)
    return {
        torrentSearchStreamEpisode: value,
        setTorrentSearchStreamEpisode: setter,
    }
}
