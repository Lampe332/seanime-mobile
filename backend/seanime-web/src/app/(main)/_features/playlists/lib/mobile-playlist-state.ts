import type { Anime_PlaylistEpisode } from "@/api/generated/types"

export const MAX_PLAYLIST_EPISODES = 200

// Match the existing playlist identity, including special episode numbers.
export function samePlaylistEpisode(a: Anime_PlaylistEpisode, b: Anime_PlaylistEpisode) {
    return a.episode?.aniDBEpisode === b.episode?.aniDBEpisode
        && a.episode?.baseAnime?.id === b.episode?.baseAnime?.id
        && a.episode?.episodeNumber === b.episode?.episodeNumber
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
        try { await action(); return true } finally { pending = false }
    }
}
