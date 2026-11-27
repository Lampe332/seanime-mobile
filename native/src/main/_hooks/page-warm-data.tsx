import { useGetAnimeCollection, useGetRawAnimeCollection } from "@/api/hooks/anilist.hooks"
import { useGetAnimeCollectionSchedule } from "@/api/hooks/anime_collection.hooks"
import { useGetContinuityWatchHistory } from "@/api/hooks/continuity.hooks"
import { useGetRawAnilistMangaCollection } from "@/api/hooks/manga.hooks"
import { usePageDataWarm } from "@/components/ui/core/page-transition"

/**
 * The main pages' data, loaded ahead while the app is idle (page-warmup.ts WARM_DATA): the queries of My lists and Your
 * year (the raw collections), Updates (schedule and collection), Schedule and History, with the pages' own hooks (same
 * keys, reads only, no views). Their first visit then builds from the cache instead of waiting on the server.
 */
export function PageWarmData() {
    return usePageDataWarm() ? <WarmQueries /> : null
}

function WarmQueries() {
    useGetRawAnimeCollection()
    useGetRawAnilistMangaCollection()
    useGetAnimeCollection()
    useGetAnimeCollectionSchedule()
    useGetContinuityWatchHistory()
    return null
}
