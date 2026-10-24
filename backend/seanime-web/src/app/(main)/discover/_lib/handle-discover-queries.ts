import { useAnilistListAnime } from "@/api/hooks/anilist.hooks"
import { atom } from "jotai"
import { useAtomValue } from "jotai/react"

export const __discover_trendingGenresAtom = atom<string[]>([])

export function useDiscoverTrendingAnime() {
    const genres = useAtomValue(__discover_trendingGenresAtom)

    return useAnilistListAnime({
        page: 1,
        perPage: 20,
        sort: ["TRENDING_DESC"],
        genres: genres.length > 0 ? genres : undefined,
    }, true)

}
