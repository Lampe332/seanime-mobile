import { buildSeaQuery, useServerQuery } from "@/api/client/requests"
import { AnilistListAnime_Variables, AnilistListManga_Variables, AnilistListRecentAiringAnime_Variables } from "@/api/generated/endpoint.types"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { AL_BaseAnime, AL_ListAnime, AL_ListManga, AL_ListRecentAnime, Anime_EntryLibraryData, Anime_EntryListData, Manga_EntryListData } from "@/api/generated/types"
import { getAnimeLibraryEntryAtom } from "@/app/(main)/_atoms/anime-library-collection.atoms"
import { getMangaCollectionEntryAtom } from "@/app/(main)/_atoms/manga-collection.atoms"
import { serverAuthTokenAtom } from "@/app/(main)/_atoms/server-status.atoms"
import { useAnilistUserAnimeListData } from "@/app/(main)/_hooks/anilist-collection-loader"
import { groupScheduleByDay, ScheduleDay, scheduleNeedsMore, scheduleReach, scheduleWindow } from "@/app/(main)/discover/_lib/discover-phone"
import { useInfiniteQuery } from "@tanstack/react-query"
import { differenceInCalendarDays, startOfDay } from "date-fns"
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

type ScrollMemory = { y: number, rows: Record<string, number>, anchor: string | null, anchorTop: number }

/** Where Discover was left, per history entry, for the app session. */
const scrollMemory = new Map<string, ScrollMemory>()

/** The sideways scrollers (genre chips, spotlight, cover rows) by names that find them again after a remount. */
function scrollers(root: Element): [string, HTMLElement][] {
    const found: [string, HTMLElement][] = []
    const genres = root.querySelector<HTMLElement>("[data-discover-genres]")
    if (genres) found.push(["genres", genres])
    const features = root.querySelector<HTMLElement>("[data-discover-spotlight] .ps-features")
    if (features) found.push(["spotlight", features])
    root.querySelectorAll<HTMLElement>("[data-discover-block] > .ps-row").forEach(row => {
        found.push([`block:${row.parentElement?.getAttribute("data-discover-block")}`, row])
    })
    return found
}

/** A selector that finds the opened card or link again after a remount. */
function anchorOf(link: Element) {
    const card = link.getAttribute("data-phone-card")
    const block = link.closest("[data-discover-block]")?.getAttribute("data-discover-block")
    if (card && block) return `[data-discover-block="${block}"] [data-phone-card="${card}"]`
    for (const name of ["data-discover-feature", "data-discover-schedule-row", "data-discover-see-all"]) {
        const value = link.getAttribute(name)
        if (value) return `[${name}="${value}"]`
    }
    return null
}

const SHOWN = "[data-phone-card], [data-discover-feature], [data-discover-schedule-row], .ps-empty, .ps-notice"
const USER_INPUT = ["pointerdown", "wheel", "keydown"] as const

/**
 * Back to Discover lands where the user left it: the page and every row at their old scroll position, the opened card
 * in its old place on screen and focused. The router restores nothing on Android and scrolls each new page to the top
 * after it rendered, so this runs on the following frames: once the rows have their covers (from the cache, or loaded
 * near the old position), until it is in place or the user takes over.
 */
export function useDiscoverScrollMemory(historyKey: string | null | undefined) {
    const key = React.useRef(historyKey)
    if (historyKey) key.current = historyKey
    const [saved] = React.useState(() => historyKey ? scrollMemory.get(historyKey) : undefined)
    const opened = React.useRef<{ anchor: string, top: number } | null>(null)

    React.useEffect(() => {
        const onClick = (event: MouseEvent) => {
            const link = event.target instanceof Element ? event.target.closest("[data-discover-phone] a[href]") : null
            const anchor = link && anchorOf(link)
            opened.current = link && anchor ? { anchor, top: link.getBoundingClientRect().top } : null
        }
        document.addEventListener("click", onClick, true)
        return () => document.removeEventListener("click", onClick, true)
    }, [])

    // Leaving: the layout cleanup still sees the page at its scroll positions (the next page scrolls to the top later).
    React.useLayoutEffect(() => () => {
        const root = document.querySelector("[data-discover-phone]")
        if (!key.current || !root) return
        scrollMemory.set(key.current, {
            y: window.scrollY,
            rows: Object.fromEntries(scrollers(root).map(([name, el]) => [name, el.scrollLeft])),
            anchor: opened.current?.anchor ?? null,
            anchorTop: opened.current?.top ?? 0,
        })
    }, [])

    React.useEffect(() => {
        if (!saved) return
        const restored = new Set<string>()
        const deadline = performance.now() + 4000
        let frame = 0
        let steady = 0
        let focused = false
        const stop = () => {
            cancelAnimationFrame(frame)
            for (const type of USER_INPUT) window.removeEventListener(type, stop)
        }
        for (const type of USER_INPUT) window.addEventListener(type, stop, { passive: true })
        const tick = () => {
            const root = document.querySelector("[data-discover-phone]")
            if (root?.querySelector(SHOWN)) {
                for (const [name, el] of scrollers(root)) {
                    if (restored.has(name) || saved.rows[name] == null) continue
                    el.scrollLeft = saved.rows[name]
                    restored.add(name)
                }
                const anchor = saved.anchor ? root.querySelector<HTMLElement>(saved.anchor) : null
                // Covers that come into view take their real size a frame later: hold the place until it stays put.
                const off = anchor ? anchor.getBoundingClientRect().top - saved.anchorTop : saved.y - window.scrollY
                if (Math.abs(off) >= 1) {
                    if (anchor) window.scrollBy(0, off)
                    else window.scrollTo(0, saved.y)
                }
                if (anchor && !focused) {
                    anchor.focus({ preventScroll: true })
                    focused = true
                }
                steady = Math.abs(off) < 1 ? steady + 1 : 0
                if (steady >= 2 && (anchor || !saved.anchor)) return stop()
            }
            if (performance.now() < deadline) frame = requestAnimationFrame(tick)
            else stop()
        }
        frame = requestAnimationFrame(tick)
        return stop
    }, [saved])
}
