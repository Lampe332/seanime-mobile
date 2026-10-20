import type { Anime_Episode } from "@/api/generated/types"

export function resumeHomeEpisode(episode: Anime_Episode, offline: boolean, setPlayNext: (id: number, ready: () => void) => void, push: (url: string) => void, linkTemplate?: string) {
    const id = episode.baseAnime?.id
    if (!id || episode.isInvalid) return
    // The card's episode wins over any episode selected earlier in this session.
    const episodeParam = episode.episodeNumber ? `&episode=${episode.episodeNumber}` : ""
    const target = linkTemplate ? linkTemplate.replace("{id}", String(id)) : offline ? `/offline/entry/anime?id=${id}` : `/entry?id=${id}${episodeParam}`
    // The play-next request makes the entry page start playback at the continuity position.
    setPlayNext(id, () => push(target))
}
