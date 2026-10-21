import { useServerMutation } from "@/api/client/requests"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { AL_AnimeCollection, AL_BaseAnime, AL_BaseManga } from "@/api/generated/types"
import { useGetRawAnimeCollection, useGetRawAnimeCollectionTags } from "@/api/hooks/anilist.hooks"
import { useGetRawAnilistMangaCollection, useGetRawAnilistMangaCollectionTags } from "@/api/hooks/manga.hooks"
import { animeLibraryCollectionAtom } from "@/app/(main)/_atoms/anime-library-collection.atoms"
import { usePlayNext } from "@/app/(main)/_atoms/playback.atoms"
import {
    FORMAT_LABELS,
    offlineAware,
    PhoneCoverCard,
    PhoneEmpty,
    PhoneHeader,
    PhoneIconButton,
    PhoneLoading,
    PhoneNotice,
    PhoneScreen,
    PhoneSearchField,
    PhoneTabs,
    SEASON_LABELS,
    seasonYearLabel,
    usePhoneBack,
} from "@/app/(main)/_features/phone-screen/phone-screen"
import { usePlaylistEditorManager } from "@/app/(main)/_features/playlists/lib/playlist-editor-manager"
import { useHasTorrentOrDebridInclusion, useServerStatus } from "@/app/(main)/_hooks/use-server-status"
import {
    CardInfo,
    CardMeta,
    countActiveFilters,
    DEFAULT_LISTS_SORTING,
    EMPTY_LISTS_FILTERS,
    filterPhoneLists,
    formatIn,
    formatInSpoken,
    formatScore,
    getCardInfo,
    getListFacts,
    getPhoneLists,
    getStatusTabs,
    ListEntry,
    listDataOf,
    ListsFilters,
    ListType,
    pickStatus,
    RELEASE_LABELS,
    searchPhoneLists,
    validSorting,
} from "@/app/(main)/lists/_lib/lists-phone"
import { ListsFilterSheet } from "@/app/(main)/lists/_screens/lists-phone-filters"
import { ListsStats } from "@/app/(main)/lists/_screens/lists-phone-stats"
import { __mangaLibrary_latestChapterNumbersAtom } from "@/app/(main)/manga/_lib/handle-manga-collection"
import { getMangaEntryUnreadState } from "@/app/(main)/manga/_lib/manga-unread"
import { SeaLink } from "@/components/shared/sea-link"
import { ContextMenuItem } from "@/components/ui/context-menu"
import { Translate, useTr } from "@/lib/app-language"
import { useRouter } from "@/lib/navigation"
import { useThemeSettings } from "@/lib/theme/theme-hooks"
import { useQueryClient } from "@tanstack/react-query"
import { atom } from "jotai"
import { useAtom, useAtomValue } from "jotai/react"
import { atomWithStorage } from "jotai/utils"
import React from "react"
import { LuArrowUp, LuChartColumn, LuListPlus, LuPlay, LuRefreshCcw, LuSlidersHorizontal } from "react-icons/lu"
import { toast } from "sonner"
import "./lists-phone.css"

// Phone-owned state: Home's My lists item reads __myLists_* atoms, so the phone tab never writes them.
// The desktop page's data-anilist-* hooks stay on the desktop page: their CSS and plugin selectors expect its layout.
const typeAtom = atomWithStorage<string>("sea-mobile-lists-type", "anime", undefined, { getOnInit: true })
const statusAtoms = {
    anime: atomWithStorage<string>("sea-mobile-lists-status-anime", "CURRENT", undefined, { getOnInit: true }),
    manga: atomWithStorage<string>("sea-mobile-lists-status-manga", "CURRENT", undefined, { getOnInit: true }),
}
const sortAtoms = {
    anime: atomWithStorage<string>("sea-mobile-lists-sort-anime", DEFAULT_LISTS_SORTING, undefined, { getOnInit: true }),
    manga: atomWithStorage<string>("sea-mobile-lists-sort-manga", DEFAULT_LISTS_SORTING, undefined, { getOnInit: true }),
}
// Filters and the search last for the session.
const filterAtoms = { anime: atom<ListsFilters>(EMPTY_LISTS_FILTERS), manga: atom<ListsFilters>(EMPTY_LISTS_FILTERS) }
const searchAtoms = { anime: atom(""), manga: atom("") }

/** Search shows once a list is long enough to need it. */
const SEARCH_FROM = 8
/** Covers rendered at once; more follow while scrolling. */
const PAGE = 60
/** A long grid keeps a card only this close to the screen; the others keep their place empty (the desktop's lazy grid). */
const KEEP_MARGIN = "1600px 0px"
/** Cells of a long grid that start with their card, before the observer reports (more than one screen at any text size). */
const EAGER = 24
/** From this length the grid ends with a way back up to the lists. */
const TOP_FROM = 12

/**
 * Android phone "My lists": the anime and manga list by status as cover grids (progress, new episodes, next airing),
 * live search, filter & sort in a sheet, AniList refresh and, as a view of the chosen type, the AniList stats.
 */
export function ListsPhone() {
    const t = useTr()
    const serverStatus = useServerStatus()
    const enableManga = !!serverStatus?.settings?.library?.enableManga
    const canStats = !!serverStatus?.user && !serverStatus.user.isSimulated
    const [storedType, setType] = useAtom(typeAtom)
    const type: ListType = storedType === "manga" && enableManga ? "manga" : "anime"
    // The stats show the chosen type; Back or the switch again returns to the list, and every visit starts on the list.
    const [statsOpen, setStatsOpen] = React.useState(false)
    const stats = statsOpen && canStats
    usePhoneBack(stats, () => setStatsOpen(false))
    const { mutate: refresh, isPending: refreshing } = useRefreshLists(t)

    const refreshButton = <PhoneIconButton label={refreshing ? t("Refreshing AniList", "AniList wird aktualisiert") : t("Refresh AniList", "AniList aktualisieren")}
        aria-busy={refreshing} onClick={() => { if (!refreshing) refresh() }} data-lists-refresh>
        <LuRefreshCcw aria-hidden className={refreshing ? "ps-spin" : undefined} />
    </PhoneIconButton>
    const statsButton = canStats ? <PhoneIconButton label={t("Stats", "Statistik")} aria-pressed={stats} onClick={() => setStatsOpen(open => !open)}
        data-lists-stats-button>
        <LuChartColumn aria-hidden />
    </PhoneIconButton> : null
    // With Manga on, the stats switch sits next to Anime | Manga, whose choice it shows; without, it joins the header actions.
    const typeSwitch = enableManga ? <div className="pl-switch">
        <PhoneTabs label={t("Anime or manga", "Anime oder Manga")} variant="segment" value={type} onChange={setType} data-lists-type-tabs
            tabs={[{ value: "anime", label: "Anime", name: "Anime" }, { value: "manga", label: "Manga", name: "Manga" }]} />
        {statsButton}
    </div> : null
    const headerStats = enableManga ? null : statsButton

    return <PhoneScreen screen="lists">
        {stats
            ? <ListsStats t={t} type={type} typeSwitch={typeSwitch} actions={<>{refreshButton}{headerStats}</>} />
            : <ListsCollection key={type} type={type} t={t} typeSwitch={typeSwitch} refreshButton={refreshButton} statsButton={headerStats} />}
    </PhoneScreen>
}

/**
 * "Refresh AniList" as in the sidebar (useRefreshAnimeCollection: the server refreshes the anime list and, in the background,
 * the manga list), with the same invalidations but toasts in the app language; the shared hook toasts in English.
 */
function useRefreshLists(t: Translate) {
    const queryClient = useQueryClient()
    return useServerMutation<AL_AnimeCollection>({
        endpoint: API_ENDPOINTS.ANILIST.GetAnimeCollection.endpoint,
        method: API_ENDPOINTS.ANILIST.GetAnimeCollection.methods[1],
        mutationKey: [API_ENDPOINTS.ANILIST.GetAnimeCollection.key],
        onSuccess: async () => {
            toast.success(t("AniList is up to date", "AniList ist aktuell"))
            for (const key of [
                API_ENDPOINTS.ANIME_COLLECTION.GetLibraryCollection.key,
                API_ENDPOINTS.ANILIST.GetAnimeCollection.key,
                API_ENDPOINTS.ANILIST.GetRawAnimeCollection.key,
                API_ENDPOINTS.ANILIST.GetRawAnimeCollectionTags.key,
                API_ENDPOINTS.ANIME_ENTRIES.GetMissingEpisodes.key,
                API_ENDPOINTS.MANGA.GetRawAnilistMangaCollection.key,
                API_ENDPOINTS.MANGA.GetRawAnilistMangaCollectionTags.key,
                API_ENDPOINTS.MANGA.GetMangaCollection.key,
                API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntry.key,
                API_ENDPOINTS.MANGA.GetMangaEntry.key,
                API_ENDPOINTS.ANIME_COLLECTION.GetAnimeCollectionSchedule.key,
                API_ENDPOINTS.ANILIST.GetAniListStats.key,
            ]) await queryClient.invalidateQueries({ queryKey: [key] })
        },
        // Replaces the shared English error toast; a failed sign-in already leads to the login page (buildSeaQuery).
        onError: error => {
            if (error.response?.status === 401) return
            toast.error(error.response?.data?.error?.includes("Too many requests")
                ? t("AniList is busy right now. Try again in a minute.", "AniList ist gerade ausgelastet. Versuch es in einer Minute noch einmal.")
                : offlineAware(t, ["AniList could not be refreshed.", "AniList konnte nicht aktualisiert werden."],
                    ["No internet connection, so AniList could not be refreshed.", "Keine Internetverbindung, deshalb konnte AniList nicht aktualisiert werden."]))
        },
    })
}

/** Minute clock for "Ep 7 in 2 h". */
function useNow() {
    const [now, setNow] = React.useState(() => Date.now())
    React.useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 60_000)
        return () => window.clearInterval(timer)
    }, [])
    return now
}

/** A title in the local (or Nakama) library: the desktop card's library mark, "Add to playlist" and its unwatched files. */
type LibraryInfo = { local: boolean, unwatched: number | null }

type CollectionProps = { type: ListType, t: Translate, typeSwitch: React.ReactNode, refreshButton: React.ReactNode, statsButton: React.ReactNode }

function ListsCollection({ type, t, typeSwitch, refreshButton, statsButton }: CollectionProps) {
    const serverStatus = useServerStatus()
    const ts = useThemeSettings()
    const showAdult = !!serverStatus?.settings?.anilist?.enableAdultContent
    const blurAdult = !!serverStatus?.settings?.anilist?.blurAdultContent
    const offline = !!serverStatus?.isOffline
    const animeQuery = useGetRawAnimeCollection()
    const mangaQuery = useGetRawAnilistMangaCollection()
    const animeTags = useGetRawAnimeCollectionTags()
    const mangaTags = useGetRawAnilistMangaCollectionTags()
    const query = type === "anime" ? animeQuery : mangaQuery
    const tagQuery = type === "anime" ? animeTags : mangaTags
    const tagMap = tagQuery.data

    const [filters, setFilters] = useAtom(filterAtoms[type])
    const [search, setSearch] = useAtom(searchAtoms[type])
    const [storedSort, setSort] = useAtom(sortAtoms[type])
    const [storedStatus, setStoredStatus] = useAtom(statusAtoms[type])
    const [sheetOpen, setSheetOpen] = React.useState(false)
    const filterButtonRef = React.useRef<HTMLButtonElement>(null)
    const controlsRef = React.useRef<HTMLDivElement>(null)
    const searchRef = React.useRef<HTMLInputElement>(null)
    const sort = validSorting(storedSort)
    const typedSearch = React.useDeferredValue(search)
    const now = useNow()

    // Unread chapters as on the Manga tab and the desktop card: known once Home or Manga loaded the sources' chapter numbers.
    const mangaChapters = useAtomValue(__mangaLibrary_latestChapterNumbersAtom)
    const showUnread = type === "manga" && !!ts.showMangaUnreadCount
    const unreadOf = React.useCallback((entry: ListEntry) => {
        if (!showUnread) return 0
        const state = getMangaEntryUnreadState(entry.media!.id, entry.progress ?? 0, mangaChapters.latestChapterNumbers,
            mangaChapters.storedProviders, mangaChapters.storedFilters)
        return state.known ? state.unread : 0
    }, [showUnread, mangaChapters])

    const lists = React.useMemo(() => getPhoneLists(query.data?.MediaListCollection?.lists, showAdult), [query.data, showAdult])
    const filtered = React.useMemo(() => filterPhoneLists(type, lists, filters, sort, showAdult, tagMap), [type, lists, filters, sort, showAdult, tagMap])
    const shown = React.useMemo(() => searchPhoneLists(filtered, typedSearch), [filtered, typedSearch])
    const tabs = React.useMemo(() => getStatusTabs(type, lists, shown), [type, lists, shown])

    // No "All lists" grid as on the desktop: one grid of every list repeats the titles of custom lists and hides their status.
    // Instead a new search follows its hits: when the shown list has none, the first list that has some shows instead, and the
    // remembered list returns once the search is cleared. A tap on a tab always shows that tab.
    const searchKey = typedSearch.trim().toLowerCase()
    const [follow, setFollow] = React.useState<{ key: string, status: string | null }>({ key: "", status: null })
    const remembered = pickStatus(storedStatus, tabs)
    let followed = follow
    if (follow.key !== searchKey && tabs.length > 0) {
        const current = follow.status && tabs.some(tab => tab.value === follow.status) ? follow.status : remembered
        const hits = (value: string | null) => tabs.find(tab => tab.value === value)?.count ?? 0
        const target = !searchKey || hits(current) > 0 ? current : tabs.find(tab => tab.count > 0)?.value ?? current
        followed = { key: searchKey, status: searchKey && target !== remembered ? target : null }
        setFollow(followed)
    }
    const status = followed.status && tabs.some(tab => tab.value === followed.status) ? followed.status : remembered
    const selectStatus = (value: string) => {
        setStoredStatus(value)
        setFollow({ key: searchKey, status: null })
    }

    const entries = React.useMemo(() => shown.find(list => list.key === status)?.entries ?? [], [shown, status])
    const gridQuery = React.useMemo(() => JSON.stringify([searchKey, filters]), [searchKey, filters])
    const facts = React.useMemo(() => getListFacts(type, lists, now, unreadOf), [type, lists, now, unreadOf])
    const activeFilters = countActiveFilters(type, filters, showAdult)
    const selectedTab = tabs.find(tab => tab.value === status)
    const hitTab = tabs.find(tab => tab.count > 0)

    // The chosen list stays in sight in its scrolling row (a remembered "Completed" sits beyond the first pills); again once the
    // app font has loaded, which widens the pills on a cold start into this tab.
    React.useLayoutEffect(() => {
        const align = () => {
            const row = controlsRef.current?.querySelector<HTMLElement>("[data-lists-status-tabs]")
            const tab = row?.querySelector<HTMLElement>("[aria-selected=\"true\"]")
            if (!row || !tab) return
            const box = row.getBoundingClientRect(), target = tab.getBoundingClientRect()
            const inset = parseFloat(getComputedStyle(row).paddingLeft) || 0
            if (target.left < box.left + inset) row.scrollLeft -= box.left + inset - target.left
            else if (target.right > box.right - inset) row.scrollLeft += target.right - box.right + inset
        }
        align()
        let live = true
        void document.fonts?.ready.then(() => { if (live) align() })
        return () => { live = false }
    }, [status, tabs.length])

    // Buttons that leave with their state (Reset, a list switch) hand the focus to the chosen tab instead of the page.
    const focusTabs = () => requestAnimationFrame(() => chosenTab(controlsRef.current)?.focus())
    // From the end of a long grid back to the lists: the bottom bar's tab does not scroll up and the pills are not sticky.
    // Stable, so typing in the search does not render the memoized grid again.
    const toTop = React.useCallback(() => {
        controlsRef.current?.scrollIntoView({ block: "start" })
        chosenTab(controlsRef.current)?.focus({ preventScroll: true })
    }, [])

    // Long-press actions stay stable for the memoized cards.
    const router = useRouter()
    const { setPlayNext } = usePlayNext()
    const { selectMediaAndOpenEditor } = usePlaylistEditorManager()
    const latest = React.useRef({ router, setPlayNext, selectMediaAndOpenEditor, offline })
    latest.current = { router, setPlayNext, selectMediaAndOpenEditor, offline }
    const onContinue = React.useCallback((mediaId: number) => {
        const { router, setPlayNext, offline } = latest.current
        setPlayNext(mediaId, () => router.push(offline ? `/offline/entry/anime?id=${mediaId}` : `/entry?id=${mediaId}`))
    }, [])
    const onPlaylist = React.useCallback((mediaId: number) => latest.current.selectMediaAndOpenEditor(mediaId), [])

    // "Add to playlist" as on MediaEntryCard: anime that can be streamed or sits in the local library.
    const { hasStreamingEnabled } = useHasTorrentOrDebridInclusion()
    const library = useAtomValue(animeLibraryCollectionAtom)
    const libraryOf = React.useMemo(() => {
        const map = new Map<number, LibraryInfo>()
        for (const entry of (library?.lists ?? []).flatMap(list => list.entries ?? [])) {
            if (!entry?.libraryData && !entry?.nakamaLibraryData) continue
            const files = !!entry.nakamaLibraryData?.mainFileCount || !!entry.libraryData?.mainFileCount
            map.set(entry.mediaId, {
                local: !!entry.libraryData,
                unwatched: files ? entry.nakamaLibraryData?.unwatchedCount ?? entry.libraryData?.unwatchedCount ?? 0 : null,
            })
        }
        return map
    }, [library])

    // A finished request without a list (no AniList user on the server, a plugin hook) is an empty list, not an endless load.
    const loading = query.isPending
    const failed = query.isError && !query.data
    const noun = type === "anime" ? "Anime" : "Manga"
    const locale = t("en-US", "de-DE")
    const count = (value: number) => value.toLocaleString(locale)
    const factsText = loading ? t("Loading your list…", "Deine Liste wird geladen …")
        : failed ? t("Not loaded", "Nicht geladen")
            : [
                t(`${count(facts.total)} ${type}`, `${count(facts.total)} ${noun}`),
                facts.total > 0 && (type === "anime" ? t(`${count(facts.current)} watching`, `${count(facts.current)} am Schauen`)
                    : t(`${count(facts.current)} reading`, `${count(facts.current)} am Lesen`)),
                facts.fresh > 0 && (type === "anime" ? t(`${count(facts.fresh)} with new episodes`, `${count(facts.fresh)} mit neuen Folgen`)
                    : t(`${count(facts.fresh)} with new chapters`, `${count(facts.fresh)} mit neuen Kapiteln`)),
            ].filter(Boolean).join(" · ")

    const resetFilters = () => {
        setFilters(EMPTY_LISTS_FILTERS)
        setSearch("")
    }
    const resetAndFocus = () => {
        resetFilters()
        focusTabs()
    }
    const retry = () => {
        void query.refetch()
        void tagQuery.refetch()
    }

    const filterLabel = activeFilters > 0 ? t(`Filter and sort, ${activeFilters} active`, `Filtern und sortieren, ${activeFilters} aktiv`)
        : t("Filter and sort", "Filtern und sortieren")
    const ready = !loading && !failed

    return <>
        <PhoneHeader title={t("My lists", "Meine Listen")} facts={factsText}>
            {refreshButton}
            <PhoneIconButton ref={filterButtonRef} label={filterLabel} dot={activeFilters > 0} onClick={() => setSheetOpen(true)} data-lists-filter-button
                disabled={!ready || facts.total === 0}>
                <LuSlidersHorizontal aria-hidden />
            </PhoneIconButton>
            {statsButton}
        </PhoneHeader>

        <div ref={controlsRef} className="pl-controls">
            {typeSwitch}
            {ready && (facts.total >= SEARCH_FROM || !!search) && <div className="pl-search"
                // Typing scrolls the field to the top, so the hits show above the keyboard; clearing keeps the focus in the field.
                onFocus={event => { if (event.target === searchRef.current) event.currentTarget.scrollIntoView({ block: "start" }) }}
                onClick={event => { if ((event.target as Element).closest(".ps-search-clear")) searchRef.current?.focus() }}>
                <PhoneSearchField t={t} value={search} onChange={setSearch} inputRef={searchRef} data-lists-search
                    placeholder={type === "anime" ? t("Search your anime", "Deine Anime durchsuchen") : t("Search your manga", "Deine Manga durchsuchen")} />
            </div>}
            {tabs.length > 0 && <PhoneTabs label={t("List status", "Listenstatus")} value={status} onChange={selectStatus} controls="pl-grid" data-lists-status-tabs
                tabs={tabs.map(tab => ({ value: tab.value, label: t(...tab.label), count: tab.count, name: tab.label[0] }))} />}
            {ready && activeFilters > 0 && <div className="pl-active" data-lists-active-filters>
                <p>{t("Filtered:", "Gefiltert:")} {activeFilterNames(t, type, filters, showAdult).join(", ")}</p>
                <button type="button" className="ps-text-action" onClick={resetAndFocus}>{t("Reset", "Zurücksetzen")}</button>
            </div>}
        </div>

        {failed ? <PhoneNotice data-lists-error text={offlineAware(t,
                type === "anime" ? ["Your anime list could not be loaded.", "Deine Anime-Liste konnte nicht geladen werden."]
                    : ["Your manga list could not be loaded.", "Deine Manga-Liste konnte nicht geladen werden."],
                type === "anime" ? ["No internet connection, so your anime list could not be loaded.", "Keine Internetverbindung, deshalb konnte deine Anime-Liste nicht geladen werden."]
                    : ["No internet connection, so your manga list could not be loaded.", "Keine Internetverbindung, deshalb konnte deine Manga-Liste nicht geladen werden."])}>
                <button type="button" className="ps-text-action" onClick={retry}>{t("Try again", "Erneut versuchen")}</button>
            </PhoneNotice>
            // Search and list bones: the grid starts where it will once the list is there.
            : loading ? <PhoneLoading label={t("Loading your list", "Deine Liste wird geladen")} layout={["tabs", "tabs", "grid"]} />
                : facts.total === 0 ? <PhoneEmpty data-lists-empty="list"
                        title={type === "anime" ? t("Your anime list is empty", "Deine Anime-Liste ist leer") : t("Your manga list is empty", "Deine Manga-Liste ist leer")}
                        text={type === "anime" ? t("Anime you add on AniList show up here, sorted by status.", "Anime, die du auf AniList hinzufügst, erscheinen hier nach Status sortiert.")
                            : t("Manga you add on AniList show up here, sorted by status.", "Manga, die du auf AniList hinzufügst, erscheinen hier nach Status sortiert.")}>
                        <SeaLink href={type === "anime" ? "/discover" : "/discover?type=manga"} className="ps-primary">
                            {type === "anime" ? t("Discover anime", "Anime entdecken") : t("Discover manga", "Manga entdecken")}
                        </SeaLink>
                        <SeaLink href={type === "anime" ? "/search" : "/search?type=manga"} className="ps-secondary">{t("Search", "Suchen")}</SeaLink>
                    </PhoneEmpty>
                    : <div id="pl-grid" role="tabpanel" aria-label={selectedTab ? t(...selectedTab.label) : undefined}>
                        {entries.length > 0
                            ? <CoverGrid key={`${status}|${sort}`} type={type} status={status} query={gridQuery} entries={entries} now={now} offline={offline} blurAdult={blurAdult}
                                canStream={type === "anime" && hasStreamingEnabled} libraryOf={libraryOf} showUnwatched={type === "anime" && !!ts.showAnimeUnwatchedCount}
                                unreadOf={unreadOf} onContinue={onContinue} onPlaylist={onPlaylist} onTop={toTop} />
                            // Hits in another list: say where they are and go there; none at all: say so and reset.
                            : hitTab && selectedTab ? <PhoneEmpty data-lists-empty="elsewhere"
                                    title={t(`No hits in ${t(...selectedTab.label)}`, `Keine Treffer in „${t(...selectedTab.label)}“`)}
                                    text={t("Filter and search apply to every list; the numbers on the lists show where the hits are.",
                                        "Filter und Suche gelten für alle Listen; die Zahlen an den Listen zeigen, wo Treffer sind.")}>
                                    <button type="button" className="ps-primary" data-lists-show-hits={hitTab.value} onClick={() => {
                                        selectStatus(hitTab.value)
                                        focusTabs()
                                    }}>
                                        {t(`Show ${t(...hitTab.label)} (${hitTab.count})`, `„${t(...hitTab.label)}“ zeigen (${hitTab.count})`)}
                                    </button>
                                    <button type="button" className="ps-secondary" onClick={resetAndFocus}>{t("Reset", "Zurücksetzen")}</button>
                                </PhoneEmpty>
                                : <PhoneEmpty data-lists-empty="filter"
                                    title={!activeFilters ? t(`No ${type} match the search`, `Keine ${noun} passen zur Suche`) : t(`No ${type} match the filter`, `Keine ${noun} passen zum Filter`)}
                                    text={t("Filter and search apply to every list.", "Filter und Suche gelten für alle Listen.")}>
                                    <button type="button" className="ps-secondary" onClick={resetAndFocus}>{t("Reset", "Zurücksetzen")}</button>
                                </PhoneEmpty>}
                    </div>}

        <ListsFilterSheet open={sheetOpen} onOpenChange={setSheetOpen} returnFocusRef={filterButtonRef} t={t} type={type} lists={lists} status={status}
            statusName={selectedTab ? t(...selectedTab.label) : null} filters={filters} setFilters={setFilters} sort={sort} onSort={setSort} tagMap={tagMap}
            showAdult={showAdult} resultCount={entries.length} canReset={activeFilters > 0 || !!search} onReset={resetFilters} />
    </>
}

const chosenTab = (controls: HTMLElement | null) => controls?.querySelector<HTMLElement>("[data-lists-status-tabs] [aria-selected=\"true\"]")

/** The active sheet filters by name, for the line above the grid. */
function activeFilterNames(t: Translate, type: ListType, filters: ListsFilters, showAdult: boolean) {
    const named = (labels: Record<string, [string, string]>, value: string) => t(...(labels[value] ?? [value, value]))
    return [
        ...filters.genres,
        ...(type === "anime" && filters.format ? [named(FORMAT_LABELS, filters.format)] : []),
        ...(filters.status ? [named(RELEASE_LABELS, filters.status)] : []),
        ...(type === "anime" && filters.season ? [named(SEASON_LABELS, filters.season)] : []),
        ...(filters.year ? [filters.year] : []),
        ...filters.tags,
        ...(filters.adult && showAdult ? [t("adult titles only", "nur Titel für Erwachsene")] : []),
    ]
}

type GridProps = {
    type: ListType
    status: string | null
    /** The search and filters the entries answer; a new one starts again at the first page */
    query: string
    entries: ListEntry[]
    now: number
    offline: boolean
    blurAdult: boolean
    canStream: boolean
    libraryOf: Map<number, LibraryInfo>
    /** The theme's "unwatched count" (desktop cards) */
    showUnwatched: boolean
    unreadOf: (entry: ListEntry) => number
    onContinue: (mediaId: number) => void
    onPlaylist: (mediaId: number) => void
    onTop: () => void
}

/**
 * The chosen list as covers, 60 at a time: the next ones render while the end of the grid comes near. A long list keeps only
 * the cards near the screen, as the desktop's lazy grid does. Memoized, so a keystroke in the search leaves it alone until its
 * result is there.
 */
const CoverGrid = React.memo(function CoverGrid({ type, status, query, entries, now, offline, blurAdult, canStream, libraryOf, showUnwatched, unreadOf, onContinue, onPlaylist, onTop }: GridProps) {
    const t = useTr()
    // A new search or filter shows its hits from the first page again: after a long scroll, each result of a typed search
    // rendered every page scrolled so far (950 cells), which held the keyboard up to 300 ms at phone speed.
    const [paging, setPaging] = React.useState({ query, limit: PAGE })
    if (paging.query !== query) setPaging({ query, limit: PAGE })
    const limit = paging.query === query ? paging.limit : PAGE
    const endRef = React.useRef<HTMLDivElement>(null)
    const more = limit < entries.length
    // A new observer per page: its first report is where the end is after this page's layout, so a render never chains into the
    // next page (one observer for all pages kept reporting "near" until every card was mounted).
    React.useEffect(() => {
        const end = endRef.current
        if (!end || !more) return
        const grow = (to: number) => setPaging(current => current.query === query ? { query, limit: Math.max(current.limit, to) } : current)
        if (typeof IntersectionObserver === "undefined") return void grow(entries.length)
        const observer = new IntersectionObserver(items => {
            if (items.some(item => item.isIntersecting)) grow(limit + PAGE)
        }, { rootMargin: "1200px 0px" })
        observer.observe(end)
        return () => observer.disconnect()
    }, [limit, more, entries.length, query])
    const keep = useKeepNear()
    const windowed = !!keep && entries.length > PAGE

    return <>
        <div className="ps-grid" data-lists-grid={status ?? ""}>
            {entries.slice(0, limit).map((entry, index) => {
                const media = entry.media!
                const library = type === "anime" ? libraryOf.get(media.id) : undefined
                const reading = entry.status === "CURRENT" || entry.status === "REPEATING"
                const card = <ListCard key={media.id} type={type} entry={entry} offline={offline} blurAdult={blurAdult}
                    // Only covers of running shows need the clock ("Ep 7 in 2 h").
                    now={type === "anime" && (media as AL_BaseAnime).nextAiringEpisode ? now : 0}
                    playlist={type === "anime" && (canStream || !!library)} library={library} showUnwatched={showUnwatched}
                    unread={type === "manga" && reading ? unreadOf(entry) : 0} onContinue={onContinue} onPlaylist={onPlaylist} />
                return windowed ? <GridCell key={media.id} keep={keep} eager={index < EAGER}>{card}</GridCell> : card
            })}
        </div>
        <div ref={endRef} className="pl-grid-end" aria-hidden />
        {!more && entries.length > TOP_FROM && <button type="button" className="ps-text-action pl-to-top" onClick={onTop} data-lists-top>
            <LuArrowUp aria-hidden />{t("Back to top", "Nach oben")}
        </button>}
    </>
})

type KeepNear = (element: Element, onChange: (near: boolean) => void) => () => void

/** One observer for all cells of a long grid; each cell hears whether it is near the screen. */
function useKeepNear(): KeepNear | null {
    const [keep] = React.useState(() => {
        if (typeof IntersectionObserver === "undefined") return null
        const listeners = new Map<Element, (near: boolean) => void>()
        const observer = new IntersectionObserver(items => {
            for (const item of items) listeners.get(item.target)?.(item.isIntersecting)
        }, { rootMargin: KEEP_MARGIN })
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

/** A cell of a long grid: its card while near the screen, else an empty box of the card's last height. */
function GridCell({ keep, eager, children }: { keep: KeepNear, eager: boolean, children: React.ReactNode }) {
    const ref = React.useRef<HTMLDivElement>(null)
    const [near, setNear] = React.useState(eager)
    const height = React.useRef(0)
    React.useEffect(() => keep(ref.current!, next => {
        const cell = ref.current
        if (!next && cell?.firstElementChild) height.current = cell.offsetHeight
        setNear(next)
    }), [keep])
    return <div ref={ref} className="pl-cell" style={!near && height.current ? { height: height.current } : undefined}>
        {near ? children : null}
    </div>
}

type CardProps = {
    type: ListType
    entry: ListEntry
    now: number
    offline: boolean
    blurAdult: boolean
    playlist: boolean
    library: LibraryInfo | undefined
    showUnwatched: boolean
    /** Unread chapters (manga being read), 0 when unknown */
    unread: number
    onContinue: (mediaId: number) => void
    onPlaylist: (mediaId: number) => void
}

/**
 * One cover: progress bar and tag; as badge the new episodes of a running show, unread chapters, the theme's unwatched count or
 * the user's score; the next airing, release status or season under the title.
 */
const ListCard = React.memo(function ListCard({ type, entry, now, offline, blurAdult, playlist, library, showUnwatched, unread, onContinue, onPlaylist }: CardProps) {
    const t = useTr()
    const media = entry.media!
    const info = getCardInfo(type, entry, now)
    const listData = React.useMemo(() => listDataOf(entry), [entry])
    // New episodes of a running show always show (the header facts count them too); the theme's switch governs only the desktop's
    // unwatched count, which uses the local files when the title has some.
    const unwatched = showUnwatched && (entry.status === "CURRENT" || entry.status === "REPEATING") ? library?.unwatched ?? info.unwatched : 0
    const badge = info.fresh > 0 ? t(`${info.fresh} new`, `${info.fresh} neu`)
        : unread > 0 ? t(`${unread} new`, `${unread} neu`)
            : unwatched > 0 ? t(`${unwatched} left`, `${unwatched} offen`)
                : info.score > 0 ? `★ ${formatScore(t, info.score)}` : undefined

    const menuItems = info.canContinue || playlist ? <>
        {info.canContinue && <ContextMenuItem onClick={() => onContinue(media.id)} data-lists-continue>
            <LuPlay /> {t("Continue", "Weiterschauen")}
        </ContextMenuItem>}
        {playlist && <ContextMenuItem onClick={() => onPlaylist(media.id)} data-lists-playlist>
            <LuListPlus /> {t("Add to playlist", "Zur Playlist hinzufügen")}
        </ContextMenuItem>}
    </> : undefined

    // data-media-mal-id as on MediaEntryCard, for DOM plugins (MAL sync and the like).
    return <PhoneCoverCard media={media} type={type} offline={offline} blurAdult={blurAdult} warm progress={info.progress} badge={badge} tag={info.tag}
        meta={cardMeta(t, info.meta, media)} menuItems={menuItems} listData={listData} data-media-mal-id={media.idMal} data-in-library={library?.local || undefined}
        label={cardLabel(t, type, entry, info, { unread, unwatched: info.fresh > 0 ? 0 : unwatched, local: !!library?.local })} />
})

function cardMeta(t: Translate, meta: CardMeta, media: AL_BaseAnime | AL_BaseManga) {
    switch (meta.kind) {
        case "airing":
            return t(`Ep ${meta.episode} in ${formatIn(t, meta.inMs)}`, `Folge ${meta.episode} in ${formatIn(t, meta.inMs)}`)
        case "chapters":
            return meta.total ? t(`Ch. ${meta.progress} / ${meta.total}`, `Kap. ${meta.progress} / ${meta.total}`) : t(`Ch. ${meta.progress}`, `Kap. ${meta.progress}`)
        case "count":
            return meta.total === 1 ? t("1 chapter", "1 Kapitel") : t(`${meta.total} chapters`, `${meta.total} Kapitel`)
        case "upcoming":
            return t(...RELEASE_LABELS.NOT_YET_RELEASED)
        case "releasing":
            return t(...RELEASE_LABELS.RELEASING)
        default:
            return seasonYearLabel(t, media)
    }
}

/** The card's spoken name: what the cover shows, written out ("episode 7 in 2 days", not "Ep 7 in 2 d"), each part once. */
function cardLabel(t: Translate, type: ListType, entry: ListEntry, info: CardInfo, extra: { unread: number, unwatched: number, local: boolean }) {
    const media = entry.media!
    const progress = entry.progress ?? 0
    const known = type === "anime" ? (media as AL_BaseAnime).episodes : (media as AL_BaseManga).chapters
    const amount = (value: number, one: [string, string], many: [string, string]) => value === 1 ? t(...one) : t(`${value} ${many[0]}`, `${value} ${many[1]}`)
    const done = !info.tag && info.meta.kind !== "chapters" ? ""
        : type === "anime" ? known ? t(`${progress} of ${known} episodes watched`, `${progress} von ${known} Folgen gesehen`)
                : amount(progress, ["1 episode watched", "1 Folge gesehen"], ["episodes watched", "Folgen gesehen"])
            : known ? t(`${progress} of ${known} chapters read`, `${progress} von ${known} Kapiteln gelesen`)
                : amount(progress, ["1 chapter read", "1 Kapitel gelesen"], ["chapters read", "Kapitel gelesen"])
    const meta = info.meta
    return [
        media.title?.userPreferred || media.title?.romaji || media.title?.english,
        done,
        info.fresh > 0 && amount(info.fresh, ["1 new episode", "1 neue Folge"], ["new episodes", "neue Folgen"]),
        extra.unread > 0 && amount(extra.unread, ["1 new chapter", "1 neues Kapitel"], ["new chapters", "neue Kapitel"]),
        extra.unwatched > 0 && amount(extra.unwatched, ["1 episode left", "1 Folge offen"], ["episodes left", "Folgen offen"]),
        info.score > 0 && t(`your score ${formatScore(t, info.score)}`, `deine Bewertung ${formatScore(t, info.score)}`),
        extra.local && t("in your library", "in deiner Bibliothek"),
        meta.kind === "airing" ? t(`episode ${meta.episode} in ${formatInSpoken(t, meta.inMs)}`, `Folge ${meta.episode} in ${formatInSpoken(t, meta.inMs)}`)
            : meta.kind === "chapters" ? "" : cardMeta(t, meta, media),
    ].filter(Boolean).join(", ")
}
