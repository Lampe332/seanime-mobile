import { buildSeaQuery } from "@/api/client/requests"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { AL_BaseAnime, AL_BaseManga, AL_ListAnime, AL_ListManga, Anime_EntryLibraryData, Anime_EntryListData, Manga_EntryListData } from "@/api/generated/types"
import { useListCustomSourceExtensions } from "@/api/hooks/extensions.hooks"
import { __anilist_userAnimeListDataAtom } from "@/app/(main)/_atoms/anilist.atoms"
import { animeLibraryCollectionAtom } from "@/app/(main)/_atoms/anime-library-collection.atoms"
import { mangaCollectionAtom } from "@/app/(main)/_atoms/manga-collection.atoms"
import { serverAuthTokenAtom } from "@/app/(main)/_atoms/server-status.atoms"
import { useLibraryExplorer } from "@/app/(main)/_features/library-explorer/library-explorer.atoms"
import {
    offlineAware,
    PhoneCoverCard,
    PhoneEmpty,
    PhoneHeader,
    PhoneIconButton,
    PhoneLoading,
    PhoneNotice,
    PhoneScreen,
    PhoneSearchField,
    PhoneSection,
    PhoneTabs,
    useLastData,
    useNearViewport,
} from "@/app/(main)/_features/phone-screen/phone-screen"
import { usePlaylistEditorManager } from "@/app/(main)/_features/playlists/lib/playlist-editor-manager"
import { useHasTorrentOrDebridInclusion, useServerStatus } from "@/app/(main)/_hooks/use-server-status"
import { __mangaLibrary_latestChapterNumbersAtom } from "@/app/(main)/manga/_lib/handle-manga-collection"
import {
    clearSearchFilters,
    nextSearchPage,
    removeSearchFilter,
    resultCardFacts,
    SEARCH_DEFAULTS,
    SEARCH_PAGE_SIZE,
    searchAnnouncement,
    SearchFilterChip,
    searchFilterChips,
    searchParamsKey,
    SearchPhoneState,
    SearchSort,
    searchSorts,
    searchStateFromParams,
    searchTitle,
    SearchType,
    searchVariables,
    switchSearchType,
    uniqueMedia,
    unseenCount,
    withSearchFilters,
} from "@/app/(main)/search/_lib/search-phone"
import { SearchChips, SearchPhoneFilters } from "@/app/(main)/search/_screens/search-phone-filters"
import { SeaLink } from "@/components/shared/sea-link"
import { ContextMenuItem } from "@/components/ui/context-menu"
import { useDebounce } from "@/hooks/use-debounce"
import { Translate, useTr } from "@/lib/app-language"
import { useSearchParams } from "@/lib/navigation"
import { useThemeSettings } from "@/lib/theme/theme-hooks"
import { useInfiniteQuery } from "@tanstack/react-query"
import { ParsedLocation, useLocation, useRouter } from "@tanstack/react-router"
import { atom } from "jotai"
import { useAtom, useAtomValue } from "jotai/react"
import React from "react"
import { LuArrowUp, LuFolderTree, LuLibrary, LuListPlus, LuLoaderCircle, LuSlidersHorizontal, LuStar, LuX } from "react-icons/lu"
import "./search-phone.css"

type StoredSearch = {
    state: SearchPhoneState
    /** The link params the search came from, and the history entry they arrived on */
    applied: { params: string, key: string | null } | null
}

/** The phone's own search: kept across pages for the app session (a reload starts fresh), like the desktop atom. */
const searchPhoneAtom = atom<StoredSearch>({ state: SEARCH_DEFAULTS, applied: null })

const isSearchPath = (pathname: string) => pathname.replace(/\/+$/, "") === "/search"
/** The router's own key for a history entry (its scroll restoration uses the same). */
const scrollKey = (location: ParsedLocation) => location.state?.__TSR_key || location.href
type ScrollPlace = { y: number, cell?: string, top: number }
/** Where each visit was left, per history entry: Back from an entry page lands on the same results. */
const scrollPositions = new Map<string, ScrollPlace>()
/** The scroll position and the first cover in sight with its place on the screen. */
const scrollPlace = (): ScrollPlace => {
    const cell = [...document.querySelectorAll<HTMLElement>("[data-search-cell]")].find(element => element.getBoundingClientRect().bottom > 0)
    return { y: window.scrollY, cell: cell?.dataset.searchCell, top: cell?.getBoundingClientRect().top ?? 0 }
}
/** About a third of a second: covers are drawn a frame or two after they come near, a long grid's cards a frame later. */
const HOLD_FRAMES = 20
/**
 * Back to a scroll position alone lands on other covers: after Back, covers not drawn yet stand in at an estimated height
 * (content-visibility's 15rem, a long grid's empty cells), a few pixels off per row, screens off deep in the results. The
 * first cover that was in sight is held where it was while the ones around it are drawn; a touch, wheel or key ends it.
 */
function holdPlace(place: ScrollPlace) {
    const cell = place.cell ? document.querySelector(`[data-search-cell="${place.cell}"]`) : null
    if (!cell) return
    const inputs = ["touchstart", "wheel", "keydown", "pointerdown"]
    let frames = 0
    const stop = () => {
        frames = HOLD_FRAMES
        inputs.forEach(type => window.removeEventListener(type, stop, true))
    }
    inputs.forEach(type => window.addEventListener(type, stop, { capture: true, passive: true }))
    const hold = () => {
        if (frames++ >= HOLD_FRAMES || !cell.isConnected) return stop()
        const off = cell.getBoundingClientRect().top - place.top
        if (Math.abs(off) >= 1) window.scrollBy(0, off)
        requestAnimationFrame(hold)
    }
    hold()
}
/** From more than four pages on, the grid keeps only the covers near the screen (as on My lists); shorter results stay whole. */
const WINDOW_FROM = 4 * SEARCH_PAGE_SIZE
/** How far above and below the screen covers stay: a fast fling does not reach an empty cell. */
const KEEP_MARGIN = 1600

/**
 * Android phone Search tab in the Home / Manga language: the search field first, the type, sort chips, the active filters
 * as removable chips and the results as an endlessly loading cover grid; the other filters live in a sheet.
 */
export function SearchPhone() {
    const t = useTr()
    const serverStatus = useServerStatus()
    const adultAllowed = !!serverStatus?.settings?.anilist?.enableAdultContent
    const { data: customSources } = useListCustomSourceExtensions()

    const [stored, setStored] = useAtom(searchPhoneAtom)
    const searchParams = useSearchParams()
    const paramsKey = searchParamsKey(searchParams)
    const here = useLocation({ select: location => isSearchPath(location.pathname) })
    const historyKey = useLocation({ select: location => location.state?.__TSR_key ?? location.state?.key ?? null })

    // A link with search params replaces the search when it arrives, also while the page is open (/search?a → /search?b).
    // Back to the history entry it arrived on keeps what was changed since; without params the last search stays.
    // The arriving search is used right away, so the first frame neither shows nor fetches the old one. While the router
    // leaves for another page the location already is that page's ("/discover?type=manga"): its params are no arrival.
    const arriving = React.useMemo(() => {
        if (!here || !paramsKey || (stored.applied?.params === paramsKey && stored.applied.key === historyKey)) return null
        return searchStateFromParams(searchParams, adultAllowed)
    }, [here, paramsKey, historyKey, stored.applied, adultAllowed])
    React.useEffect(() => {
        if (arriving) setStored({ state: arriving, applied: { params: paramsKey, key: historyKey } })
    }, [arriving])
    const state = arriving ?? stored.state
    const update = React.useCallback((change: (state: SearchPhoneState) => SearchPhoneState) => setStored(prev => {
        const next = change(prev.state)
        return next === prev.state ? prev : { ...prev, state: next }
    }), [setStored])

    // Typing reaches the search after a pause (Enter and clearing at once); a title from a link replaces the field.
    const inputRef = React.useRef<HTMLInputElement>(null)
    const [input, setInput] = React.useState(state.title)
    const debouncedInput = useDebounce(input, 400)
    const sentTitle = React.useRef(state.title)
    const commitTitle = React.useCallback((title: string) => {
        sentTitle.current = title
        update(current => current.title === title ? current : { ...current, title })
    }, [update])
    React.useEffect(() => {
        if (debouncedInput !== sentTitle.current) commitTitle(debouncedInput)
    }, [debouncedInput])
    React.useEffect(() => {
        if (state.title === sentTitle.current) return
        sentTitle.current = state.title
        setInput(state.title)
    }, [state.title])
    const onInput = (value: string) => {
        setInput(value)
        if (value) return
        commitTitle("")
        // The ✕ goes away with the words; the field keeps the focus (and the keyboard) for new ones.
        inputRef.current?.focus()
    }

    const variables = React.useMemo(() => searchVariables(state, adultAllowed), [state, adultAllowed])
    const searchKey = JSON.stringify([state.type, variables])
    const results = useSearchResults(state.type, variables)
    const current = React.useMemo(() => results.data ? { type: state.type, key: searchKey, pages: results.data.pages } : undefined, [results.data, searchKey])
    const last = useLastData(current)
    // While a new search of the same type loads, the previous results stay (dimmed) instead of bones.
    const shown = current ?? (last?.type === state.type && !results.isError ? last : undefined)
    const stale = !current && !!shown
    const items = React.useMemo(() => uniqueMedia<AL_BaseAnime | AL_BaseManga>(shown?.pages), [shown?.pages])

    // Endless results: the next page loads before the end comes into view; "Load more" stays for keyboards and screen readers.
    const canLoadMore = !stale && !!results.hasNextPage && !results.isFetchNextPageError
    const [sentinelRef, nearEnd] = useNearViewport<HTMLDivElement>("600px", false)
    React.useEffect(() => {
        if (!nearEnd || !canLoadMore || results.isFetchingNextPage) return
        // "Near" can be left over from before the new results pushed the end down.
        const top = sentinelRef.current?.getBoundingClientRect().top ?? Infinity
        if (top <= window.innerHeight + 600) void results.fetchNextPage()
    }, [nearEnd, canLoadMore, results.isFetchingNextPage, items.length])
    const loadMore = () => {
        if (!results.isFetchingNextPage) void results.fetchNextPage({ cancelRefetch: false })
    }

    useScrollReturn(items.length > 0)

    // Screen readers hear how each new search turned out (a failure is an alert of its own), not every further page.
    // A search already loaded on arrival (Back) is not announced again.
    const [announcement, setAnnouncement] = React.useState("")
    const announced = React.useRef(current?.key)
    React.useEffect(() => {
        if (!current || announced.current === current.key) return
        announced.current = current.key
        const text = searchAnnouncement(t, current.type, items.length, !!results.hasNextPage)
        setAnnouncement(previous => previous === text ? `${text} ` : text)
    }, [current, items.length])

    // The filter sheet edits a draft that applies when it closes (Show results, Back, ✕): one new search, not one per tap.
    const [sheetOpen, setSheetOpen] = React.useState(false)
    const [draft, setDraft] = React.useState(state)
    const filterButtonRef = React.useRef<HTMLButtonElement>(null)
    const onSheetChange = (open: boolean) => {
        if (open) setDraft(state)
        else update(current => withSearchFilters(current, draft))
        setSheetOpen(open)
    }

    // The chosen sort stays in sight in its scrolling row, also when a type switch or a link changes it.
    const controlsRef = React.useRef<HTMLDivElement>(null)
    React.useLayoutEffect(() => {
        const row = controlsRef.current?.querySelector<HTMLElement>("[data-search-sort]")
        const chip = row?.querySelector<HTMLElement>("[aria-checked=\"true\"]")
        if (!row || !chip) return
        const box = row.getBoundingClientRect(), target = chip.getBoundingClientRect()
        const inset = parseFloat(getComputedStyle(row).paddingLeft) || 0
        if (target.left < box.left + inset) row.scrollLeft -= box.left + inset - target.left
        else if (target.right > box.right - inset) row.scrollLeft += target.right - box.right + inset
    }, [state.sort, state.type])

    const chips = searchFilterChips(t, state, adultAllowed)
    // Removing a filter chip hands the focus to the chip that takes its place, or to the filter button when none is left
    // (removing "Adult" can take adult tags with it). Decided from the state after the removal, applied after it renders.
    const focusAfter = React.useRef<string | null>(null)
    const removeFilter = (id: string) => {
        const index = chips.findIndex(chip => chip.id === id)
        const remaining = searchFilterChips(t, removeSearchFilter(state, id), adultAllowed)
        focusAfter.current = (remaining[index] ?? remaining[index - 1])?.id ?? ""
        update(current => removeSearchFilter(current, id))
    }
    const clearFilters = () => {
        focusAfter.current = ""
        update(clearSearchFilters)
    }
    React.useLayoutEffect(() => {
        const id = focusAfter.current
        if (id === null) return
        focusAfter.current = null
        const chip = [...controlsRef.current?.querySelectorAll<HTMLElement>("[data-filter]") ?? []].find(element => element.dataset.filter === id)
        ;(chip ?? filterButtonRef.current)?.focus()
    })

    const title = state.title.trim()
    const retype = () => {
        inputRef.current?.focus()
        inputRef.current?.select()
    }

    let body: React.ReactNode
    if (!shown && results.isError) {
        body = <PhoneNotice data-search-error text={offlineAware(t, ["The search failed.", "Die Suche ist fehlgeschlagen."],
            ["No internet connection, so the search failed.", "Keine Internetverbindung, deshalb ist die Suche fehlgeschlagen."])}>
            <button type="button" className="ps-text-action" onClick={() => void results.refetch()}>{t("Try again", "Erneut versuchen")}</button>
        </PhoneNotice>
    } else if (!shown || (stale && !items.length)) {
        body = <PhoneLoading label={t("Searching…", "Suche läuft …")} layout={["grid"]} />
    } else if (!items.length) {
        body = <PhoneEmpty data-search-empty title={searchAnnouncement(t, state.type, 0, false)}
            text={chips.length && title ? t(`Nothing matches “${title}” with these filters.`, `Mit diesen Filtern passt nichts zu „${title}“.`)
                : chips.length ? t("Try fewer filters.", "Versuch es mit weniger Filtern.")
                    : title ? t(`Nothing on AniList matches “${title}”.`, `Auf AniList passt nichts zu „${title}“.`) : undefined}>
            {chips.length > 0 && <button type="button" className="ps-secondary" onClick={clearFilters}>{t("Clear filters", "Filter zurücksetzen")}</button>}
            {!!title && <button type="button" className="ps-secondary" onClick={retype}>{t("Try other words", "Anderen Suchbegriff versuchen")}</button>}
        </PhoneEmpty>
    } else {
        // One button for loading more, loading and trying a failed page again, so a keyboard or screen reader keeps its place;
        // while it loads it neither shows the failure nor starts the request twice.
        const loading = results.isFetchingNextPage
        const failed = results.isFetchNextPageError && !loading
        body = <>
            <Results items={items} type={shown.type} stale={stale} />
            {canLoadMore || loading || failed ? <div className="pq-foot" data-search-more-error={failed || undefined}>
                {failed && <p role="alert">{offlineAware(t, ["More results could not be loaded.", "Weitere Ergebnisse konnten nicht geladen werden."],
                    ["No internet connection, so no more results could be loaded.", "Keine Internetverbindung, deshalb konnten keine weiteren Ergebnisse geladen werden."])}</p>}
                <button type="button" className="ps-secondary" aria-disabled={loading || undefined} data-search-load-more data-search-loading-more={loading || undefined}
                    onClick={loadMore}>
                    {loading ? <><LuLoaderCircle className="ps-spin" aria-hidden />{t("Loading more…", "Weitere Ergebnisse werden geladen …")}</>
                        : failed ? t("Try again", "Erneut versuchen") : t("Load more", "Mehr laden")}
                </button>
            </div> : !stale && <p className="ps-more" data-search-end>{t("That's all", "Das war alles")}</p>}
        </>
    }

    return <PhoneScreen screen="search">
        <PhoneHeader title={t("Search", "Suche")} facts={searchTitle(t, state)}>
            <PhoneIconButton ref={filterButtonRef} onClick={() => onSheetChange(true)} dot={chips.length > 0} data-search-filter-button
                label={chips.length ? `${t("Filters", "Filter")}, ${chips.length} ${t("active", "aktiv")}` : t("Filters", "Filter")}>
                <LuSlidersHorizontal aria-hidden />
            </PhoneIconButton>
        </PhoneHeader>

        <div ref={controlsRef} className="pq-controls">
            <PhoneSearchField t={t} value={input} onChange={onInput} onSubmit={() => commitTitle(input)} inputRef={inputRef} data-search-field
                placeholder={state.type === "anime" ? t("Search anime", "Anime suchen") : t("Search manga", "Manga suchen")} />
            <PhoneTabs variant="segment" label={t("Search in", "Suchen in")} value={state.type} data-search-type-tabs
                tabs={[{ value: "anime", label: "Anime" }, { value: "manga", label: "Manga" }]}
                onChange={type => update(current => switchSearchType(current, type as SearchType))} />
            <SearchChips variant="row" label={t("Sort by", "Sortieren nach")} selected={[state.sort]} data-search-sort
                chips={searchSorts(state.type).map(sort => ({ value: sort.value, label: t(sort.en, sort.de) }))}
                onSelect={sort => update(current => ({ ...current, sort: sort as SearchSort }))} />
            {chips.length > 0 && <ActiveFilters t={t} chips={chips} onRemove={removeFilter} onClear={clearFilters} />}
        </div>

        <PhoneSection id="pq-results-title" title={t("Results", "Ergebnisse")} data-search-results
            count={!stale && items.length ? `${items.length}${canLoadMore || results.isFetchingNextPage ? "+" : ""}` : undefined}
            action={!!customSources?.length && <SeaLink href="/custom-sources" className="ps-text-action" data-search-custom-sources>
                {t("Custom sources", "Eigene Quellen")}
            </SeaLink>}
            note={title && !!items.length ? t("Best matches first", "Beste Treffer zuerst") : undefined}>
            {body}
            <div ref={sentinelRef} className="pq-sentinel" aria-hidden />
        </PhoneSection>

        <p className="pq-status" role="status" data-search-status>{announcement}</p>
        <BackToTop t={t} />

        <SearchPhoneFilters open={sheetOpen} onOpenChange={onSheetChange} draft={draft} onDraft={setDraft} adultAllowed={adultAllowed}
            returnFocusRef={filterButtonRef} />
    </PhoneScreen>
}

/** AniList pages of the search, 48 at a time; the server caches each page for ten minutes. */
function useSearchResults(type: SearchType, variables: ReturnType<typeof searchVariables>) {
    const password = useAtomValue(serverAuthTokenAtom)
    return useInfiniteQuery({
        queryKey: ["search-phone", type, variables],
        initialPageParam: 1,
        queryFn: ({ pageParam }) => buildSeaQuery<AL_ListAnime | AL_ListManga>({
            endpoint: type === "anime" ? API_ENDPOINTS.ANILIST.AnilistListAnime.endpoint : API_ENDPOINTS.MANGA.AnilistListManga.endpoint,
            method: "POST",
            data: { ...variables, page: pageParam, perPage: SEARCH_PAGE_SIZE },
            password,
        }),
        getNextPageParam: nextSearchPage,
        // Back from an entry page shows the loaded pages again instead of asking AniList for each of them.
        staleTime: 5 * 60 * 1000,
    })
}

/**
 * Back from an entry page lands where the results were left. The router scrolls each page it has rendered to the top,
 * Back included, so the position comes back after that (and when the results arrive later than the page). It is noted
 * whenever the page is left, by a card, the bottom bar or Back.
 */
function useScrollReturn(ready: boolean) {
    const router = useRouter()
    const locationKey = useLocation({ select: scrollKey })
    const [key] = React.useState(locationKey)
    const target = React.useRef(scrollPositions.get(key))
    const rendered = React.useRef(false)
    const readyRef = React.useRef(ready)
    readyRef.current = ready
    const restore = React.useCallback(() => {
        const place = target.current
        if (place === undefined || !rendered.current || !readyRef.current) return
        window.scrollTo(0, place.y)
        holdPlace(place)
        target.current = undefined
    }, [])
    React.useLayoutEffect(() => {
        const unsubscribeLeave = router.subscribe("onBeforeLoad", ({ fromLocation }) => {
            if (fromLocation && isSearchPath(fromLocation.pathname)) scrollPositions.set(scrollKey(fromLocation), scrollPlace())
        })
        const unsubscribeRendered = router.subscribe("onRendered", ({ toLocation }) => {
            if (scrollKey(toLocation) !== key) return
            rendered.current = true
            restore()
        })
        // The router can resolve the location a render before this page mounts and report it rendered before the page listens
        // (then only the browser's own restoration ran): the place comes back a frame later, after the router's scroll.
        const resolved = router.state.resolvedLocation
        const frame = resolved && scrollKey(resolved) === key ? requestAnimationFrame(() => {
            rendered.current = true
            restore()
        }) : 0
        return () => {
            cancelAnimationFrame(frame)
            unsubscribeLeave()
            unsubscribeRendered()
        }
    }, [router, key])
    React.useLayoutEffect(restore, [ready])
}

/** After two screens of results, a button above the bottom bar goes back to the search field, sort and filters. */
function BackToTop({ t }: { t: Translate }) {
    const [shown, setShown] = React.useState(false)
    React.useEffect(() => {
        const onScroll = () => setShown(window.scrollY > window.innerHeight * 2)
        onScroll()
        window.addEventListener("scroll", onScroll, { passive: true })
        return () => window.removeEventListener("scroll", onScroll)
    }, [])
    if (!shown) return null
    return <button type="button" className="pq-top" aria-label={t("Back to top", "Nach oben")} data-search-top onClick={() => {
        window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })
        // Keyboards and screen readers go on from the page title, above the controls (the button leaves with the scroll).
        const heading = document.querySelector<HTMLElement>("[data-phone-screen=\"search\"] h1")
        heading?.setAttribute("tabindex", "-1")
        heading?.focus({ preventScroll: true })
    }}>
        <LuArrowUp aria-hidden />
    </button>
}

/**
 * The active filters as removable chips ("Remove Action" for screen readers) in one sideways row, and one way to clear
 * them all at its end; the screen moves the focus on.
 */
function ActiveFilters({ t, chips, onRemove, onClear }: {
    t: Translate
    chips: SearchFilterChip[]
    onRemove: (id: string) => void
    onClear: () => void
}) {
    return <div className="pq-active" role="group" aria-label={t("Active filters", "Aktive Filter")} data-search-active-filters>
        {chips.map(chip => <button key={chip.id} type="button" className="pq-chip" data-filter={chip.id} aria-label={t(`Remove ${chip.name}`, `${chip.name} entfernen`)}
            onClick={() => onRemove(chip.id)}>
            {chip.kind === "minScore" && <LuStar aria-hidden />}
            <span>{chip.label}</span>
            <LuX aria-hidden />
        </button>)}
        <button type="button" className="ps-text-action" data-search-clear-filters onClick={onClear}>{t("Clear filters", "Filter zurücksetzen")}</button>
    </div>
}

/** The cover grid with what the collections know about each result (list status, progress, score, local files); typing does not redraw it. */
const Results = React.memo(function Results({ items, type, stale }: { items: (AL_BaseAnime | AL_BaseManga)[], type: SearchType, stale: boolean }) {
    const serverStatus = useServerStatus()
    const offline = !!serverStatus?.isOffline
    const blurAdult = !!serverStatus?.settings?.anilist?.blurAdultContent
    const { hasStreamingEnabled } = useHasTorrentOrDebridInclusion()
    const { showAnimeUnwatchedCount, showMangaUnreadCount } = useThemeSettings()
    const chapters = useAtomValue(__mangaLibrary_latestChapterNumbersAtom)

    // List data as MediaEntryCard finds it: the AniList collection first, then the local library; manga from the manga collection.
    const animeListData = useAtomValue(__anilist_userAnimeListDataAtom)
    const library = useAtomValue(animeLibraryCollectionAtom)
    const mangaCollection = useAtomValue(mangaCollectionAtom)
    const libraryEntries = React.useMemo(() => new Map(library?.lists?.flatMap(list => list.entries ?? []).map(entry => [entry.mediaId, entry])), [library])
    const mangaEntries = React.useMemo(() => new Map(mangaCollection?.lists?.flatMap(list => list.entries ?? []).map(entry => [entry.mediaId, entry])), [mangaCollection])

    const playlistEditor = usePlaylistEditorManager()
    const { openDirInLibraryExplorer } = useLibraryExplorer()
    const actions = React.useRef({ playlist: playlistEditor.selectMediaAndOpenEditor, explorer: openDirInLibraryExplorer })
    actions.current = { playlist: playlistEditor.selectMediaAndOpenEditor, explorer: openDirInLibraryExplorer }
    const onPlaylist = React.useCallback((mediaId: number) => actions.current.playlist(mediaId), [])
    const onExplorer = React.useCallback((path: string) => actions.current.explorer(path), [])

    // Every cover sits in a cell, so a grid that grows long does not remount its cards when it starts windowing.
    const keep = useKeepNear()
    const windowed = !!keep && items.length > WINDOW_FROM

    return <div className="ps-grid pq-grid" aria-busy={stale || undefined}>
        {items.map(media => {
            const libraryData = type === "anime" ? libraryEntries.get(media.id)?.libraryData : undefined
            const listData = type === "anime" ? animeListData[String(media.id)] ?? libraryEntries.get(media.id)?.listData : mangaEntries.get(media.id)?.listData
            const unseen = unseenCount(type, media, listData, { anime: showAnimeUnwatchedCount, manga: showMangaUnreadCount, library: libraryData, chapters })
            return <GridCell key={media.id} id={media.id} keep={keep} windowed={windowed}>
                <ResultCard media={media} type={type} offline={offline} blurAdult={blurAdult} listData={listData} libraryData={libraryData}
                    unseen={unseen} onPlaylist={onPlaylist} onExplorer={onExplorer} playlist={type === "anime" && (!!libraryData || (!!listData && hasStreamingEnabled))} />
            </GridCell>
        })}
    </div>
})

type KeepNear = (element: Element, onChange: (near: boolean) => void) => () => void

/** One observer for all cells of a long grid; each cell hears whether it is near the screen (as on My lists). */
function useKeepNear(): KeepNear | null {
    const [keep] = React.useState(() => {
        if (typeof IntersectionObserver === "undefined") return null
        const listeners = new Map<Element, (near: boolean) => void>()
        const observer = new IntersectionObserver(items => {
            for (const item of items) listeners.get(item.target)?.(item.isIntersecting)
        }, { rootMargin: `${KEEP_MARGIN}px 0px` })
        const observe: KeepNear = (element, onChange) => {
            listeners.set(element, onChange)
            observer.observe(element)
            return () => {
                listeners.delete(element)
                observer.unobserve(element)
            }
        }
        return { observe, observer }
    })
    React.useEffect(() => () => keep?.observer.disconnect(), [keep])
    return keep?.observe ?? null
}

/**
 * A cover's place in the grid. In a long grid it holds its card only near the screen, else an empty box of the card's last
 * height. A cell that arrives near the screen (the next page, the grid after Back) shows its card before the first paint.
 */
function GridCell({ id, keep, windowed, children }: { id: number, keep: KeepNear | null, windowed: boolean, children: React.ReactNode }) {
    const ref = React.useRef<HTMLDivElement>(null)
    const [near, setNear] = React.useState(!windowed)
    const height = React.useRef(0)
    React.useLayoutEffect(() => {
        if (near) return
        const box = ref.current!.getBoundingClientRect()
        if (box.bottom > -KEEP_MARGIN && box.top < window.innerHeight + KEEP_MARGIN) setNear(true)
    }, [])
    React.useEffect(() => {
        if (!windowed || !keep) return
        return keep(ref.current!, next => {
            const cell = ref.current
            if (!next && cell?.firstElementChild) height.current = cell.offsetHeight
            setNear(next)
        })
    }, [keep, windowed])
    const shown = !windowed || near
    return <div ref={ref} className="pq-cell" data-search-cell={id} style={!shown && height.current ? { height: height.current } : undefined}>
        {shown ? children : null}
    </div>
}

type ResultCardProps = {
    media: AL_BaseAnime | AL_BaseManga
    type: SearchType
    offline: boolean
    blurAdult: boolean
    listData: Anime_EntryListData | Manga_EntryListData | undefined
    libraryData: Anime_EntryLibraryData | undefined
    unseen: number
    /** "Add to playlist", on the same terms as the desktop card */
    playlist: boolean
    onPlaylist: (mediaId: number) => void
    onExplorer: (path: string) => void
}

/**
 * A result: progress (else airing / upcoming) and new episodes (else the user's score) on the cover; under the title the
 * list status and year in the accent, else season or form and year, with a mark for local files; the desktop card's menu
 * entries on long press.
 */
const ResultCard = React.memo(function ResultCard({ media, type, offline, blurAdult, listData, libraryData, unseen, playlist, onPlaylist, onExplorer }: ResultCardProps) {
    const t = useTr()
    const local = !!libraryData?.mainFileCount
    const facts = resultCardFacts(t, type, media, listData, { unseen, local })
    const total = type === "anime" ? (media as AL_BaseAnime).episodes : (media as AL_BaseManga).chapters
    const progress = listData?.status !== "COMPLETED" && listData?.progress && total ? { value: listData.progress, total } : undefined
    const libraryPath = libraryData?.sharedPath
    const menuItems = type === "anime" && (playlist || !!libraryPath) ? <>
        {playlist && <ContextMenuItem onClick={() => onPlaylist(media.id)}><LuListPlus /> {t("Add to playlist", "Zur Playlist hinzufügen")}</ContextMenuItem>}
        {!!libraryPath && <ContextMenuItem onClick={() => onExplorer(libraryPath)}><LuFolderTree /> {t("Open in library explorer", "Im Bibliotheks-Explorer öffnen")}</ContextMenuItem>}
    </> : undefined
    // data-media-mal-id as on MediaEntryCard, for DOM plugins (MAL sync and the like).
    return <PhoneCoverCard media={media} type={type} offline={offline} blurAdult={blurAdult} progress={progress} badge={facts.badge} tag={facts.tag}
        meta={local ? <><LuLibrary className="pq-local" aria-hidden data-search-local />{facts.meta}</> : facts.meta} metaTone={facts.onList ? "accent" : undefined}
        label={facts.label} menuItems={menuItems} listData={listData} data-media-mal-id={media.idMal} />
})
