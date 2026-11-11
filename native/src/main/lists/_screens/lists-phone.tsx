import { PHONE_PAGE_TINT, usePageTop } from "@/components/shared/phone-screen"
import { useServerMutation } from "@/api/client/requests"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import type { AL_AnimeCollection, AL_BaseAnime, AL_BaseManga } from "@/api/generated/types"
import { useGetRawAnimeCollection, useGetRawAnimeCollectionTags } from "@/api/hooks/anilist.hooks"
import { useGetRawAnilistMangaCollection, useGetRawAnilistMangaCollectionTags } from "@/api/hooks/manga.hooks"
import { useNavBarHeight } from "@/components/navigation/app-navigation"
import type { CardMenuItem } from "@/components/shared/card-menu"
import { FORMAT_LABELS, Notice, SearchField, TextAction } from "@/components/shared/phone-kit"
import { ChipRow, GridBones, PhoneCoverCard, PhoneEmpty, SEASON_LABELS, seasonYearLabel, useGridColumns, useOfflineAware } from "@/components/shared/phone-cards"
import { Button } from "@/components/ui/button/button"
import { cn } from "@/components/ui/core/styling"
import { Tabs } from "@/components/ui/tabs/tabs"
import { toast } from "@/components/ui/toast/toast-store"
import { Text } from "@/components/ui/text/text"
import { type Translate, useTr } from "@/lib/app-language"
import { useRouter } from "@/lib/navigation"
import { atomWithStorage } from "@/lib/storage"
import { colors } from "@/lib/theme/tokens"
import { useThemeSettings } from "@/lib/theme/theme-hooks"
import { useTabletLayout } from "@/lib/use-tablet-ui"
import { searchBesideTabs, TABLET_SEARCH_MAX_WIDTH, TABLET_SEGMENT_WIDTH } from "@/lib/tablet-ui"
import { animeLibraryCollectionAtom } from "@/main/_atoms/anime-library-collection.atoms"
import { usePlayNext } from "@/main/_atoms/playback.atoms"
import { IN_APP_PLAYER_READY } from "@/main/_features/player/player-availability"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import {
    type CardInfo,
    type CardMeta,
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
    type ListEntry,
    type ListsFilters,
    type ListType,
    pickStatus,
    RELEASE_LABELS,
    searchPhoneLists,
    validSorting,
} from "@/main/lists/_lib/lists-phone"
import { ListsFilterSheet } from "@/main/lists/_screens/lists-phone-filters"
import { ListsAction, ListsHeader } from "@/main/lists/_screens/lists-phone-header"
import { ListsStats } from "@/main/lists/_screens/lists-phone-stats"
import { __mangaLibrary_latestChapterNumbersAtom } from "@/main/manga/_lib/handle-manga-collection"
import { getMangaEntryUnreadState } from "@/main/manga/_lib/manga-unread"
import { FlashList, type FlashListRef } from "@shopify/flash-list"
import { useQueryClient } from "@tanstack/react-query"
import { useFocusEffect } from "expo-router"
import { atom, useAtom, useAtomValue } from "jotai"
import ArrowUp from "lucide-react-native/icons/arrow-up"
import ChartColumn from "lucide-react-native/icons/chart-column"
import Play from "lucide-react-native/icons/play"
import RefreshCcw from "lucide-react-native/icons/refresh-ccw"
import SlidersHorizontal from "lucide-react-native/icons/sliders-horizontal"
import React from "react"
import { BackHandler, View } from "react-native"
import Animated from "react-native-reanimated"
import { useSwapStyle } from "@/components/ui/core/swap"
import { useSafeAreaInsets } from "react-native-safe-area-context"

/*
 * Android phone "My lists" (lists-phone.tsx + lists-phone.css): the anime and manga list by status as cover grids
 * (progress, new episodes, next airing), live search, filter & sort in a sheet, AniList refresh and, as a view of the
 * chosen type, the AniList stats.
 *
 * Phone-owned state as in 2.0.33: Home's "My lists" section reads the __myLists_* atoms, this tab never writes them.
 * The grid is one FlashList (only covers near the screen are drawn); it replaces 2.0.33's 60-card pages, the windowed
 * cells (GridCell/useKeepNear) and the "page again from the start after a new search" fix, which all worked around the
 * DOM grid. "Add to playlist" as 2.0.32: every card is on the list, so a streaming source or local files suffice (onList).
 */

const typeAtom = atomWithStorage<string>("sea-mobile-lists-type", "anime")
const statusAtoms = {
    anime: atomWithStorage<string>("sea-mobile-lists-status-anime", "CURRENT"),
    manga: atomWithStorage<string>("sea-mobile-lists-status-manga", "CURRENT"),
}
const sortAtoms = {
    anime: atomWithStorage<string>("sea-mobile-lists-sort-anime", DEFAULT_LISTS_SORTING),
    manga: atomWithStorage<string>("sea-mobile-lists-sort-manga", DEFAULT_LISTS_SORTING),
}
// Filters and the search last for the session.
const filterAtoms = { anime: atom<ListsFilters>(EMPTY_LISTS_FILTERS), manga: atom<ListsFilters>(EMPTY_LISTS_FILTERS) }
const searchAtoms = { anime: atom(""), manga: atom("") }

/** Search shows once a list is long enough to need it. */
const SEARCH_FROM = 8
/** From this length the grid ends with a way back up to the lists. */
const TOP_FROM = 12

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
    useFocusEffect(React.useCallback(() => {
        if (!stats) return
        const sub = BackHandler.addEventListener("hardwareBackPress", () => {
            setStatsOpen(false)
            return true
        })
        return () => sub.remove()
    }, [stats]))
    useFocusEffect(React.useCallback(() => () => setStatsOpen(false), []))
    const { mutate: refresh, isPending: refreshing } = useRefreshLists(t)

    const refreshButton = <ListsAction icon={RefreshCcw} label={t("Refresh", "Aktualisieren")} spinning={refreshing}
        accessibilityLabel={refreshing ? t("Refreshing AniList", "AniList wird aktualisiert") : t("Refresh AniList", "AniList aktualisieren")}
        onPress={() => { if (!refreshing) refresh() }} />
    const statsButton = (square: boolean) => canStats
        ? <ListsAction icon={ChartColumn} label={t("Stats", "Statistik")} pressed={stats} square={square} onPress={() => setStatsOpen(open => !open)} />
        : null
    // With Manga on, the stats switch sits next to Anime | Manga, whose choice it shows; without, it joins the header actions.
    // the list built anew for a type chosen here rises in; the first one comes with the page
    const [typeSwitched, setTypeSwitched] = React.useState(false)
    const typeSwitch = enableManga ? <TypeSwitch type={type} onType={value => {
        setTypeSwitched(true)
        setType(value)
    }}>{statsButton(true)}</TypeSwitch> : null
    const headerStats = enableManga ? null : statsButton(false)

    return stats
        ? <ListsStats type={type} typeSwitch={typeSwitch} actions={<>{refreshButton}{headerStats}</>} />
        : <ListsCollection key={type} type={type} typeSwitch={typeSwitch} refreshButton={refreshButton} statsButton={headerStats} swapOnMount={typeSwitched} />
}

/**
 * Anime | Manga with the stats switch beside it (`.pl-switch`); on a tablet the segment keeps its 26rem. A new type builds
 * the list anew and this switch with it; the new switch takes over the old one's bubble (`glideMemory`), so it still glides.
 */
function TypeSwitch({ type, onType, children }: { type: ListType, onType: (type: string) => void, children: React.ReactNode }) {
    const t = useTr()
    const { rail } = useTabletLayout()
    return (
        <View accessibilityLabel={t("Anime or manga", "Anime oder Manga")} className="flex-row items-center gap-2">
            {/* a set width (not flex-1) so the switch keeps its size when the search field stands beside it */}
            <View className={cn("min-w-0", rail ? "shrink" : "flex-1")} style={rail ? { width: TABLET_SEGMENT_WIDTH } : undefined}>
                <Tabs variant="segment" value={type} onValueChange={onType} glideMemory="lists-type"
                    items={[{ value: "anime", label: "Anime" }, { value: "manga", label: "Manga" }]} />
            </View>
            {children}
        </View>
    )
}

/**
 * "Refresh AniList" as in the sidebar (the server refreshes the anime list and, in the background, the manga list), with
 * the same invalidations but toasts in the app language; the shared hook toasts in English.
 */
function useRefreshLists(t: Translate) {
    const queryClient = useQueryClient()
    const offlineAware = useOfflineAware()
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
        // Replaces the shared English error toast; a failed sign-in already leads to the login (buildSeaQuery).
        onError: error => {
            if (error.response?.status === 401) return
            toast.error(error.response?.data?.error?.includes("Too many requests")
                ? t("AniList is busy right now. Try again in a minute.", "AniList ist gerade ausgelastet. Versuch es in einer Minute noch einmal.")
                : offlineAware(["AniList could not be refreshed.", "AniList konnte nicht aktualisiert werden."],
                    ["No internet connection, so AniList could not be refreshed.", "Keine Internetverbindung, deshalb konnte AniList nicht aktualisiert werden."]))
        },
    })
}

/** Minute clock for "Ep 7 in 2 h". */
function useNow() {
    const [now, setNow] = React.useState(() => Date.now())
    React.useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 60_000)
        return () => clearInterval(timer)
    }, [])
    return now
}

/** A title in the local (or Nakama) library: the desktop card's library mark and its unwatched files. */
type LibraryInfo = { local: boolean, unwatched: number | null }

type CollectionProps = { type: ListType, typeSwitch: React.ReactNode, refreshButton: React.ReactNode, statsButton: React.ReactNode, swapOnMount: boolean }

function ListsCollection({ type, typeSwitch, refreshButton, statsButton, swapOnMount }: CollectionProps) {
    const t = useTr()
    const router = useRouter()
    const serverStatus = useServerStatus()
    const ts = useThemeSettings()
    const insets = useSafeAreaInsets()
    const barHeight = useNavBarHeight()
    const { rail } = useTabletLayout()
    const offlineAware = useOfflineAware()
    const showAdult = !!serverStatus?.settings?.anilist?.enableAdultContent
    const blurAdult = !!serverStatus?.settings?.anilist?.blurAdultContent
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
    // a new status (or a new type, which builds this list anew) lets the covers rise in (useSwap / usePhoneViewSwap)
    const swapStyle = useSwapStyle(status ?? "", { onMount: swapOnMount })
    const selectStatus = (value: string) => {
        setStoredStatus(value)
        setFollow({ key: searchKey, status: null })
    }

    const entries = React.useMemo(() => shown.find(list => list.key === status)?.entries ?? [], [shown, status])
    const facts = React.useMemo(() => getListFacts(type, lists, now, unreadOf), [type, lists, now, unreadOf])
    const activeFilters = countActiveFilters(type, filters, showAdult)
    const selectedTab = tabs.find(tab => tab.value === status)
    const hitTab = tabs.find(tab => tab.count > 0)

    // "Continue" as on the desktop card, once the app has its player (it starts the next episode on the anime page).
    const { setPlayNext } = usePlayNext()
    const latest = React.useRef({ router, setPlayNext })
    React.useEffect(() => { latest.current = { router, setPlayNext } })
    const onContinue = React.useCallback((mediaId: number) => {
        const { router, setPlayNext } = latest.current
        setPlayNext(mediaId, () => router.push(`/entry?id=${mediaId}`))
    }, [])

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
    const ready = !loading && !failed
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

    const list = React.useRef<FlashListRef<ListEntry>>(null)
    // the same top as every page (page-top.ts)
    const topPadding = usePageTop()
    // Where the switch, search and pills start: "Back to top" and a focused search scroll there, not to the title.
    const controlsY = React.useRef(0)
    const searchY = React.useRef(0)
    const toControls = React.useCallback(() => list.current?.scrollToOffset({ offset: Math.max(0, topPadding + controlsY.current - 12), animated: true }), [topPadding])

    const resetFilters = () => {
        setFilters(EMPTY_LISTS_FILTERS)
        setSearch("")
    }
    const retry = () => {
        void query.refetch()
        void tagQuery.refetch()
    }
    const filterLabel = activeFilters > 0 ? t(`Filter and sort, ${activeFilters} active`, `Filtern und sortieren, ${activeFilters} aktiv`)
        : t("Filter and sort", "Filtern und sortieren")

    const [contentWidth, setContentWidth] = React.useState(0)
    const grid = useGridColumns(contentWidth)
    const gutter = 16

    let body: React.ReactNode = null
    if (failed) {
        body = <Notice text={offlineAware(
            type === "anime" ? ["Your anime list could not be loaded.", "Deine Anime-Liste konnte nicht geladen werden."]
                : ["Your manga list could not be loaded.", "Deine Manga-Liste konnte nicht geladen werden."],
            type === "anime" ? ["No internet connection, so your anime list could not be loaded.", "Keine Internetverbindung, deshalb konnte deine Anime-Liste nicht geladen werden."]
                : ["No internet connection, so your manga list could not be loaded.", "Keine Internetverbindung, deshalb konnte deine Manga-Liste nicht geladen werden."])}>
            <TextAction label={t("Try again", "Erneut versuchen")} onPress={retry} />
        </Notice>
    } else if (loading) {
        // Search and list bones: the grid starts where it will once the list is there.
        body = <View className="gap-3">
            <View className="h-12 rounded-full bg-sm-surface-raised" />
            <View className="h-12 w-3/4 rounded-full bg-sm-surface-raised" />
            {!!contentWidth && <GridBones label={t("Loading your list", "Deine Liste wird geladen")} contentWidth={contentWidth} />}
        </View>
    } else if (facts.total === 0) {
        body = <PhoneEmpty title={type === "anime" ? t("Your anime list is empty", "Deine Anime-Liste ist leer") : t("Your manga list is empty", "Deine Manga-Liste ist leer")}
            text={type === "anime" ? t("Anime you add on AniList show up here, sorted by status.", "Anime, die du auf AniList hinzufügst, erscheinen hier nach Status sortiert.")
                : t("Manga you add on AniList show up here, sorted by status.", "Manga, die du auf AniList hinzufügst, erscheinen hier nach Status sortiert.")}>
            <Button onPress={() => router.push(type === "anime" ? "/discover" : `/discover?type=manga&at=${Date.now()}`)}>
                {type === "anime" ? t("Discover anime", "Anime entdecken") : t("Discover manga", "Manga entdecken")}
            </Button>
            <Button intent="secondary" onPress={() => router.push(type === "anime" ? "/search" : `/search?type=manga&at=${Date.now()}`)}>{t("Search", "Suchen")}</Button>
        </PhoneEmpty>
    } else if (!entries.length) {
        // Hits in another list: say where they are and go there; none at all: say so and reset.
        body = hitTab && selectedTab
            ? <PhoneEmpty title={t(`No hits in ${t(...selectedTab.label)}`, `Keine Treffer in „${t(...selectedTab.label)}“`)}
                text={t("Filter and search apply to every list; the numbers on the lists show where the hits are.",
                    "Filter und Suche gelten für alle Listen; die Zahlen an den Listen zeigen, wo Treffer sind.")}>
                <Button onPress={() => selectStatus(hitTab.value)}>
                    {t(`Show ${t(...hitTab.label)} (${hitTab.count})`, `„${t(...hitTab.label)}“ zeigen (${hitTab.count})`)}
                </Button>
                <Button intent="secondary" onPress={resetFilters}>{t("Reset", "Zurücksetzen")}</Button>
            </PhoneEmpty>
            : <PhoneEmpty title={!activeFilters ? t(`No ${type} match the search`, `Keine ${noun} passen zur Suche`) : t(`No ${type} match the filter`, `Keine ${noun} passen zum Filter`)}
                text={t("Filter and search apply to every list.", "Filter und Suche gelten für alle Listen.")}>
                <Button intent="secondary" onPress={resetFilters}>{t("Reset", "Zurücksetzen")}</Button>
            </PhoneEmpty>
    }

    const showSearch = ready && (facts.total >= SEARCH_FROM || !!search)
    const beside = !!typeSwitch && showSearch && searchBesideTabs(rail, contentWidth)

    // the grid is the next block of `[data-phone-screen]` (gap 1.5rem), not part of `.pl-controls`: 24dp under the chips
    const header = (
        <View className="gap-6 pb-6">
            <ListsHeader title={t("My lists", "Meine Listen")} facts={factsText}>
                {refreshButton}
                <ListsAction icon={SlidersHorizontal} label={t("Filter", "Filter")} accessibilityLabel={filterLabel} dot={activeFilters > 0}
                    disabled={!ready || facts.total === 0} onPress={() => setSheetOpen(true)} />
                {statsButton}
            </ListsHeader>
            {(!!typeSwitch || (ready && tabs.length > 0)) && (
                <View className="gap-3" onLayout={event => { controlsY.current = event.nativeEvent.layout.y }}>
                    {/* r16 (Nick 10.11., not in 2.0.33): on a wide tablet the field stands beside Anime | Manga (searchBesideTabs);
                        the row is the first of the controls, so the field's own y (0) still adds up for the scroll below */}
                    {(!!typeSwitch || showSearch) && <View className={cn(beside && "flex-row items-center gap-3")}>
                        {typeSwitch}
                        {showSearch && (
                            <View className={cn(!beside && !!typeSwitch && "mt-3")} style={beside ? { flex: 1, maxWidth: TABLET_SEARCH_MAX_WIDTH } : undefined}
                                onLayout={event => { searchY.current = beside ? 0 : event.nativeEvent.layout.y }}>
                                {/* Focusing the search scrolls it to the top, so the hits show above the keyboard. */}
                                <SearchField value={search} onChangeText={setSearch}
                                    onFocus={() => list.current?.scrollToOffset({ offset: Math.max(0, topPadding + controlsY.current + searchY.current - 12), animated: true })}
                                    placeholder={type === "anime" ? t("Search your anime", "Deine Anime durchsuchen") : t("Search your manga", "Deine Manga durchsuchen")} />
                            </View>
                        )}
                    </View>}
                    {tabs.length > 0 && <ChipRow label={t("List status", "Listenstatus")} selected={status ? [status] : []} onSelect={selectStatus}
                        chips={tabs.map(tab => ({ value: tab.value, label: t(...tab.label), count: tab.count }))} />}
                    {ready && activeFilters > 0 && (
                        <View className="-my-1.5 flex-row items-center gap-2">
                            <Text numberOfLines={1} className="min-w-0 flex-1 text-[13px] text-sm-text-muted">
                                {t("Filtered:", "Gefiltert:")} {activeFilterNames(t, type, filters, showAdult).join(", ")}
                            </Text>
                            <View className="-mr-2"><TextAction label={t("Reset", "Zurücksetzen")} onPress={resetFilters} /></View>
                        </View>
                    )}
                </View>
            )}
            {body}
        </View>
    )

    const footer = !body && entries.length > TOP_FROM ? (
        <View className="items-center pt-2">
            <Button intent="text" leftIcon={<ArrowUp size={18} color={colors.smAccent} />} onPress={toControls}>{t("Back to top", "Nach oben")}</Button>
        </View>
    ) : null

    return (
        <View className="flex-1">
            {/* the page tint of the phone tabs (the tablet's ground carries its own) */}
            {!rail && <View pointerEvents="none" className="absolute inset-x-0 top-0 h-[568px]"
                style={{ backgroundImage: PHONE_PAGE_TINT }} />}
            <View className={cn("w-full flex-1", !rail && "max-w-[1152px] self-center")} style={{ paddingHorizontal: gutter }}
                onLayout={event => setContentWidth(event.nativeEvent.layout.width - gutter * 2)}>
                <FlashList
                    ref={list}
                    data={body ? EMPTY : entries}
                    keyExtractor={entry => String(entry.media!.id)}
                    numColumns={grid.columns}
                    extraData={now}
                    renderItem={({ item }) => (
                        <Animated.View style={[{ paddingHorizontal: grid.gap / 2, paddingBottom: grid.rowGap }, swapStyle]}>
                            <ListCard type={type} entry={item} width={grid.width} blurAdult={blurAdult}
                                // Only covers of running shows need the clock ("Ep 7 in 2 h").
                                now={type === "anime" && (item.media as AL_BaseAnime).nextAiringEpisode ? now : 0}
                                library={type === "anime" ? libraryOf.get(item.media!.id) : undefined} showUnwatched={type === "anime" && !!ts.showAnimeUnwatchedCount}
                                unread={type === "manga" && (item.status === "CURRENT" || item.status === "REPEATING") ? unreadOf(item) : 0} onContinue={onContinue} />
                        </Animated.View>
                    )}
                    ListHeaderComponent={<View style={{ paddingHorizontal: grid.gap / 2 }}>{header}</View>}
                    ListFooterComponent={<View style={{ paddingHorizontal: grid.gap / 2 }}>{footer}</View>}
                    // A new status starts where the page is; FlashList's default would scroll to keep an old cover in place
                    maintainVisibleContentPosition={{ disabled: true }}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode="on-drag"
                    showsVerticalScrollIndicator={false}
                    style={{ marginHorizontal: -grid.gap / 2 }}
                    contentContainerStyle={{ paddingTop: topPadding, paddingBottom: (rail ? 32 : barHeight + 32) + insets.bottom }}
                />
            </View>
            <ListsFilterSheet open={sheetOpen} onOpenChange={setSheetOpen} type={type} lists={lists} status={status}
                statusName={selectedTab ? t(...selectedTab.label) : null} filters={filters} setFilters={setFilters} sort={sort} onSort={setSort} tagMap={tagMap}
                showAdult={showAdult} resultCount={entries.length} canReset={activeFilters > 0 || !!search} onReset={resetFilters} />
        </View>
    )
}

const EMPTY: ListEntry[] = []

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

type CardProps = {
    type: ListType
    entry: ListEntry
    width: number
    now: number
    blurAdult: boolean
    library: LibraryInfo | undefined
    showUnwatched: boolean
    /** Unread chapters (manga being read), 0 when unknown */
    unread: number
    onContinue: (mediaId: number) => void
}

/**
 * One cover: progress bar and tag; as badge the new episodes of a running show, unread chapters, the theme's unwatched count or
 * the user's score; the next airing, release status or season under the title; the library mark for titles with local files.
 */
const ListCard = React.memo(function ListCard({ type, entry, width, now, blurAdult, library, showUnwatched, unread, onContinue }: CardProps) {
    const t = useTr()
    const media = entry.media!
    const info = getCardInfo(type, entry, now)
    // New episodes of a running show always show (the header facts count them too); the theme's switch governs only the desktop's
    // unwatched count, which uses the local files when the title has some.
    const unwatched = showUnwatched && (entry.status === "CURRENT" || entry.status === "REPEATING") ? library?.unwatched ?? info.unwatched : 0
    const badge = info.fresh > 0 ? t(`${info.fresh} new`, `${info.fresh} neu`)
        : unread > 0 ? t(`${unread} new`, `${unread} neu`)
            : unwatched > 0 ? t(`${unwatched} left`, `${unwatched} offen`)
                : info.score > 0 ? `★ ${formatScore(t, info.score)}` : undefined
    const menuItems = React.useMemo<CardMenuItem[] | undefined>(() => IN_APP_PLAYER_READY && info.canContinue
        ? [{ id: "continue", label: t("Continue", "Weiterschauen"), icon: Play, onPress: () => onContinue(media.id) }] : undefined,
    [info.canContinue, media.id, onContinue, t])

    return <PhoneCoverCard media={media as AL_BaseAnime | AL_BaseManga} type={type} width={width} blurAdult={blurAdult} progress={info.progress} badge={badge}
        tag={info.tag} meta={cardMeta(t, info.meta, media)} inLibrary={!!library?.local} menuItems={menuItems} onList
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
