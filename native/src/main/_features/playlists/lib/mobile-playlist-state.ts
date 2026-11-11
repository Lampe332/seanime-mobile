import type { Anime_LibraryCollection, Anime_LibraryCollectionEntry, Anime_LibraryCollectionList, Anime_PlaylistEpisode, Nullish } from "@/api/generated/types"

/* The playlist editor's rules (web playlists/lib/mobile-playlist-state.ts + playlist-list-modal.tsx), without the screen. */

export const MAX_PLAYLIST_EPISODES = 200

// Match the existing playlist identity, including special episode numbers.
export function samePlaylistEpisode(a: Nullish<Anime_PlaylistEpisode>, b: Nullish<Anime_PlaylistEpisode>) {
    if (!a || !b) return false
    return a.episode?.aniDBEpisode === b.episode?.aniDBEpisode
        && a.episode?.baseAnime?.id === b.episode?.baseAnime?.id
        && a.episode?.episodeNumber === b.episode?.episodeNumber
}

/**
 * Previous/next while a playlist runs (web video-core-playlist.tsx VideoCorePlaylistControl, onlinestream-page.tsx
 * goToNextEpisode/goToPreviousEpisode): the playlist's neighbours decide, not the anime's episodes, and the request
 * goes out as "current completed" like on the web (no progress question).
 */
export function playlistNavigation(
    next: Nullish<Anime_PlaylistEpisode>,
    previous: Nullish<Anime_PlaylistEpisode>,
    playEpisode: (which: "next" | "previous", isCurrentCompleted: boolean) => void,
) {
    return {
        hasNextEpisode: !!next,
        hasPreviousEpisode: !!previous,
        playEpisode: (which: "next" | "previous") => {
            if (which === "next" ? next : previous) playEpisode(which, true)
        },
    }
}

export function playlistEpisodeKey(a: Anime_PlaylistEpisode) {
    return a.episode?.aniDBEpisode + String(a.episode?.baseAnime?.id) + String(a.episode?.episodeNumber) + String(a.episode?.progressNumber) + String(
        a.episode?.localFile?.path)
}

export function togglePlaylistEpisode(current: Anime_PlaylistEpisode[], episode: Anime_PlaylistEpisode) {
    if (current.some(n => samePlaylistEpisode(n, episode))) return current.filter(n => !samePlaylistEpisode(n, episode))
    if (current.length >= MAX_PLAYLIST_EPISODES) return current
    return [...current, episode]
}

export function selectPlaylistEpisodes(current: Anime_PlaylistEpisode[], available: Anime_PlaylistEpisode[]) {
    if (available.length && available.every(ep => current.some(n => samePlaylistEpisode(n, ep)))) {
        return current.filter(n => !available.some(ep => samePlaylistEpisode(n, ep)))
    }
    const result = [...current]
    for (const ep of available) {
        if (result.length >= MAX_PLAYLIST_EPISODES) break
        if (!result.some(n => samePlaylistEpisode(n, ep))) result.push(ep)
    }
    return result
}

export function movePlaylistEpisode(current: Anime_PlaylistEpisode[], index: number, direction: -1 | 1) {
    const to = index + direction
    if (index < 0 || to < 0 || index >= current.length || to >= current.length) return current
    const result = [...current]
    ;[result[index], result[to]] = [result[to], result[index]]
    return result
}

/** Protect the complete asynchronous mutation, including query invalidation, from same-frame taps. */
export function createPlaylistMutationGate() {
    let pending = false
    return async (action: () => Promise<unknown>) => {
        if (pending) return false
        pending = true
        try {
            await action()
            return true
        } finally {
            pending = false
        }
    }
}

/**
 * The library the editor picks from (playlist-list-modal.tsx): streamed anime (no files) join the "Current" list, so
 * playlists can hold torrent, debrid and online episodes too.
 */
export function playlistLibraryCollection(data: Anime_LibraryCollection | undefined): Anime_LibraryCollection | undefined {
    if (!data?.lists) return undefined
    if (!data.stream) return data
    const current = data.lists.find(n => n.type === "CURRENT")
    const entries: Anime_LibraryCollectionEntry[] = [...(current?.entries ?? [])]
    for (const anime of data.stream.anime ?? []) {
        if (!entries.some(e => e.mediaId === anime.id)) {
            entries.push({ media: anime, mediaId: anime.id, listData: data.stream.listData?.[anime.id], libraryData: undefined })
        }
    }
    return {
        ...data,
        lists: [{ type: "CURRENT", status: "CURRENT", entries } as Anime_LibraryCollectionList, ...data.lists.filter(n => n.type !== "CURRENT")],
    }
}

/** The editor's anime list: Current/Paused/Planning (one of them, or all), each anime once, matching the search in any title */
export function playlistAnimeChoices(collection: Anime_LibraryCollection | undefined, category: string, search: string) {
    const needle = search.trim().toLowerCase()
    const seen = new Set<number>()
    return collection?.lists?.filter(n => ["CURRENT", "PLANNING", "PAUSED"].includes(n.type ?? "") && (needle || category === "-" || n.type === category))
        .flatMap(n => n.entries ?? [])
        .filter((n): n is Anime_LibraryCollectionEntry => {
            if (!n || seen.has(n.mediaId)) return false
            if (needle && !Object.values(n.media?.title ?? {}).some(title => typeof title === "string" && title.toLowerCase().includes(needle))) return false
            seen.add(n.mediaId)
            return true
        }) ?? []
}
