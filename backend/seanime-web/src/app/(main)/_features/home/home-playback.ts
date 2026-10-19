import type { Anime_Episode } from "@/api/generated/types"

export function resumeHomeEpisode(episode: Anime_Episode, offline: boolean, setPlayNext: (id: number, ready: () => void) => void, push: (url: string) => void, linkTemplate?: string) {
    const id = episode.baseAnime?.id
    if (!id || episode.isInvalid) return
    const target = linkTemplate ? linkTemplate.replace("{id}", String(id)) : `${offline ? "/offline/entry/anime" : "/entry"}?id=${id}`
    // The existing playback manager selects the next episode and continuity position.
    setPlayNext(id, () => push(target))
}
