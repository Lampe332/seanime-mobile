import { buildSeaQuery, useServerQuery } from "@/api/client/requests"
import { AnilistListAnime_Variables, AnilistListManga_Variables, AnilistListRecentAiringAnime_Variables } from "@/api/generated/endpoint.types"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { AL_BaseAnime, AL_ListAnime, AL_ListManga, AL_ListRecentAnime, Anime_EntryLibraryData, Anime_EntryListData, Manga_EntryListData } from "@/api/generated/types"
import { getAnimeLibraryEntryAtom } from "@/main/_atoms/anime-library-collection.atoms"
import { getMangaCollectionEntryAtom } from "@/main/_atoms/manga-collection.atoms"
import { serverAuthTokenAtom } from "@/main/_atoms/server-status.atoms"
import { useAnilistUserAnimeListData } from "@/main/_hooks/anilist-collection-loader"
import { groupScheduleByDay, ScheduleDay, scheduleNeedsMore, scheduleReach, scheduleWindow } from "@/main/discover/_lib/discover-phone"
import { useInfiniteQuery } from "@tanstack/react-query"
import { differenceInCalendarDays } from "date-fns/differenceInCalendarDays"
import { startOfDay } from "date-fns/startOfDay"
import { Atom } from "jotai"
import { useAtomValue } from "jotai/react"
import React from "react"

/*
 * The AniList queries of the shared hooks (useAnilistListAnime, useAnilistListManga, useAnilistListRecentAiringAnime,
 * useAnilistListMissedSequels) with the same keys, so Home and Discover share the cache, but without the error toast:
 * the phone screen says what failed in the row itself.
 */

/**
 * A row shown again within this time (tab switches, a genre picked again, back from an entry page) comes from the cache
 * instead of asking again on every mount; the server keeps these AniList answers for 10 minutes anyway.
 */
const ROW_STALE_TIME = 5 * 60_000

export function usePhoneListAnime(variables: AnilistListAnime_Variables, enabled: boolean) {
    return useServerQuery<AL_ListAnime, AnilistListAnime_Variables>({
        endpoint: API_ENDPOINTS.ANILIST.AnilistListAnime.endpoint,
        method: API_ENDPOINTS.ANILIST.AnilistListAnime.methods[0],
        queryKey: [API_ENDPOINTS.ANILIST.AnilistListAnime.key, variables],
        data: variables,
        enabled,
        muteError: true,
        staleTime: ROW_STALE_TIME,
    })
}

export function usePhoneListManga(variables: AnilistListManga_Variables, enabled: boolean) {
    return useServerQuery<AL_ListManga, AnilistListManga_Variables>({
        endpoint: API_ENDPOINTS.MANGA.AnilistListManga.endpoint,
        method: API_ENDPOINTS.MANGA.AnilistListManga.methods[0],
        queryKey: [API_ENDPOINTS.MANGA.AnilistListManga.key, variables],
        data: variables,
        enabled,
        muteError: true,
        staleTime: ROW_STALE_TIME,
    })
}

export function usePhoneRecentAiring(variables: AnilistListRecentAiringAnime_Variables, enabled: boolean) {
    return useServerQuery<AL_ListRecentAnime, AnilistListRecentAiringAnime_Variables>({
        endpoint: API_ENDPOINTS.ANILIST.AnilistListRecentAiringAnime.endpoint,
        method: API_ENDPOINTS.ANILIST.AnilistListRecentAiringAnime.methods[0],
        queryKey: [API_ENDPOINTS.ANILIST.AnilistListRecentAiringAnime.key, JSON.stringify(variables)],
        data: variables,
        enabled,
        muteError: true,
        staleTime: ROW_STALE_TIME,
    })
}

export function usePhoneMissedSequels(enabled: boolean) {
    return useServerQuery<Array<AL_BaseAnime>>({
        endpoint: API_ENDPOINTS.ANILIST.AnilistListMissedSequels.endpoint,
        method: API_ENDPOINTS.ANILIST.AnilistListMissedSequels.methods[0],
        queryKey: [API_ENDPOINTS.ANILIST.AnilistListMissedSequels.key],
        enabled,
        muteError: true,
        staleTime: ROW_STALE_TIME,
    })
}

export type DiscoverListData = Anime_EntryListData | Manga_EntryListData

/**
 * The user's entry for a card, read like MediaEntryCard reads it: list data from the AniList collection, else the
 * library collections; the anime library data (files, unwatched episodes).
 */
export function useDiscoverEntry(type: "anime" | "manga", mediaId: number): { listData?: DiscoverListData, libraryData?: Anime_EntryLibraryData } {
    const entryAtom = React.useMemo(() => (type === "anime" ? getAnimeLibraryEntryAtom(mediaId) : getMangaCollectionEntryAtom(mediaId)) as Atom<{
        listData?: DiscoverListData
        libraryData?: Anime_EntryLibraryData
    } | undefined>, [type, mediaId])
    const entry = useAtomValue(entryAtom)
    const fromAnilist = useAnilistUserAnimeListData(mediaId, type === "anime")
    return { listData: (type === "anime" ? fromAnilist : undefined) ?? entry?.listData, libraryData: type === "anime" ? entry?.libraryData : undefined }
}

/** More pages than this (50 airings each) are not asked for; two weeks usually take five to seven. */
const SCHEDULE_PAGE_LIMIT = 10

export type DiscoverSchedule = {
    /** The days loaded completely; undefined until the first page is in */
    days: ScheduleDay[] | undefined
    count: number
    /** How many days from today the list covers (14 once every page is in) */
    reach: number
    loading: boolean
    /** Later pages are on their way */
    loadingMore: boolean
    error: boolean
    offline: boolean
    /** A later page failed or waits for the connection: the days so far stay */
    moreError: boolean
    moreOffline: boolean
    retry: () => void
}

/**
 * The desktop schedule's data (upcoming episodes, by time) from today 00:00 for 14 days. AniList answers 50 airings of
 * all countries and formats per page, so pages load one after another until the two weeks are in; days show as soon as
 * they are complete. The window only changes at midnight, so the query key stays put while the tab is open.
 */
export function useDiscoverSchedule(enabled: boolean): DiscoverSchedule {
    const password = useAtomValue(serverAuthTokenAtom)
    const range = scheduleWindow(Date.now())
    const query = useInfiniteQuery({
        queryKey: [API_ENDPOINTS.ANILIST.AnilistListRecentAiringAnime.key, "discover-phone-schedule", range],
        initialPageParam: 1,
        queryFn: ({ pageParam }) => buildSeaQuery<AL_ListRecentAnime, AnilistListRecentAiringAnime_Variables>({
            endpoint: API_ENDPOINTS.ANILIST.AnilistListRecentAiringAnime.endpoint,
            method: API_ENDPOINTS.ANILIST.AnilistListRecentAiringAnime.methods[0],
            data: { page: pageParam, perPage: 50, ...range, notYetAired: true, sort: ["TIME"] },
            password,
        }),
        getNextPageParam: (last, pages) => pages.length < SCHEDULE_PAGE_LIMIT && scheduleNeedsMore(last?.Page, range.airingAt_lesser) ? pages.length + 1 : undefined,
        enabled,
        // Back from an entry page shows the loaded days again instead of asking AniList for every page.
        staleTime: 10 * 60_000,
    })

    // The next page as soon as the last one is in; a failed page waits for Try again, a paused one for the connection.
    const pages = query.data?.pages
    React.useEffect(() => {
        if (enabled && query.hasNextPage && !query.isFetching && !query.isFetchNextPageError && !query.isPaused) void query.fetchNextPage()
    }, [enabled, query.hasNextPage, query.isFetching, query.isFetchNextPageError, query.isPaused, pages?.length])

    const lastPage = pages?.[pages.length - 1]?.Page
    const covered = !!pages && !scheduleNeedsMore(lastPage, range.airingAt_lesser)
    const { days, reach } = React.useMemo(() => {
        if (!pages) return { days: undefined, reach: 0 }
        const now = Date.now()
        const items = pages.flatMap(page => page?.Page?.airingSchedules ?? [])
        const last = [...items].reverse().find(item => !!item)?.airingAt
        const until = scheduleReach(last, covered, now)
        return {
            days: until ? groupScheduleByDay(items.filter(Boolean) as NonNullable<typeof items[number]>[], now, until) : [],
            reach: until ? differenceInCalendarDays(until, startOfDay(now)) : 0,
        }
    }, [pages, covered])

    const waiting = !pages
    const error = waiting && query.isError && !query.isFetching
    const offline = waiting && query.isPaused
    const moreError = !waiting && query.isFetchNextPageError && !query.isFetching
    const moreOffline = !waiting && query.isPaused
    return {
        days,
        count: days?.reduce((n, day) => n + day.items.length, 0) ?? 0,
        reach,
        loading: waiting && !error && !offline,
        loadingMore: !waiting && !covered && pages.length < SCHEDULE_PAGE_LIMIT && !moreError && !moreOffline,
        error,
        offline,
        moreError,
        moreOffline,
        retry: () => void (waiting ? query.refetch() : query.fetchNextPage()),
    }
}

