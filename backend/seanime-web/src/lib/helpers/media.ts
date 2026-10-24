import { AL_BaseAnime, Nullish } from "@/api/generated/types"

export function anilist_getCurrentEpisodes(anime: Nullish<AL_BaseAnime>) {
    if (!anime) return -1
    let maxEp = -1
    if (anime.nextAiringEpisode && anime.nextAiringEpisode.episode) {
        maxEp = anime.nextAiringEpisode.episode - 1
    }
    if (maxEp === -1) {
        maxEp = anime.episodes ?? 0
    }
    return maxEp
}

export function anilist_animeIsMovie(anime: Nullish<AL_BaseAnime>) {
    if (!anime) return false
    return anime?.format === "MOVIE"

}

export function anilist_animeIsSingleEpisode(anime: Nullish<AL_BaseAnime>) {
    if (!anime) return false
    return anime?.format === "MOVIE" || anime?.episodes === 1
}

export function anilist_getUnwatchedCount(anime: Nullish<AL_BaseAnime>, progress: Nullish<number>) {
    if (!anime) return false
    const maxEp = anilist_getCurrentEpisodes(anime)
    return maxEp - (progress ?? 0)
}

