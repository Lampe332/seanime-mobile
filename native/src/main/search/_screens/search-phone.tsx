import { PHONE_PAGE_TINT, PhoneHeadTray, usePageTop } from "@/components/shared/phone-screen"
import { HEAD_ACTIONS_STYLE } from "@/components/shared/page-head"
import { buildSeaQuery } from "@/api/client/requests"
import { useListCustomSourceExtensions } from "@/api/hooks/extensions.hooks"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import type { AL_BaseAnime, AL_BaseManga, AL_ListAnime, AL_ListManga, Anime_EntryLibraryData, Anime_EntryListData, Manga_EntryListData } from "@/api/generated/types"
import { useNavBarHeight } from "@/components/navigation/app-navigation"
import { Notice, SearchField, TextAction } from "@/components/shared/phone-kit"
import { ChipRow, GridBones, PhoneCoverCard, PhoneEmpty, PhoneSection, useGridColumns, useLastData, useOfflineAware } from "@/components/shared/phone-cards"
import { Button } from "@/components/ui/button/button"
import { swapIn } from "@/components/ui/core/animations"
import { cn } from "@/components/ui/core/styling"
import { Tabs } from "@/components/ui/tabs/tabs"
import { Heading, Muted, Text } from "@/components/ui/text/text"
import { useDebounce } from "@/hooks/use-debounce"
import { type Translate, useTr } from "@/lib/app-language"
import { colors } from "@/lib/theme/tokens"
import { useThemeSettings } from "@/lib/theme/theme-hooks"
import { useTabletLayout } from "@/lib/use-tablet-ui"
import { searchBesideTabs, TABLET_SEARCH_MAX_WIDTH, TABLET_SEGMENT_WIDTH } from "@/lib/tablet-ui"
import { __anilist_userAnimeListDataAtom } from "@/main/_atoms/anilist.atoms"
import { animeLibraryCollectionAtom } from "@/main/_atoms/anime-library-collection.atoms"
import { mangaCollectionAtom } from "@/main/_atoms/manga-collection.atoms"
import { serverAuthTokenAtom } from "@/main/_atoms/server-status.atoms"
import { HomeHeaderAction } from "@/main/_features/home/home-mobile-header"
import { useLibraryExplorer } from "@/main/_features/library-explorer/library-explorer.atoms"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { __mangaLibrary_latestChapterNumbersAtom } from "@/main/manga/_lib/handle-manga-collection"
import {
    activeSearchSort,
    clearSearchFilters,
    nextSearchPage,
    removeSearchFilter,
    resultCardFacts,
    SEARCH_DEFAULTS,
    SEARCH_PAGE_SIZE,
    searchAnnouncement,
    type SearchFilterChip,
    searchFilterChips,
    searchParamsKey,
    type SearchPhoneState,
    searchSortChips,
    searchStateFromParams,
    searchTitle,
    type SearchType,
    searchVariables,
    selectSearchSort,
    switchSearchType,
    type TitleSort,
    uniqueMedia,
    unseenCount,
    withSearchFilters,
    withSearchTitle,
} from "@/main/search/_lib/search-phone"
import { SearchPhoneFilters } from "@/main/search/_screens/search-phone-filters"
import { FlashList, type FlashListRef } from "@shopify/flash-list"
import { useInfiniteQuery } from "@tanstack/react-query"
import { router } from "expo-router"
import { atom, useAtom, useAtomValue } from "jotai"
import ArrowUp from "lucide-react-native/icons/arrow-up"
import FolderOpen from "lucide-react-native/icons/folder-open"
import Library from "lucide-react-native/icons/library"
import SlidersHorizontal from "lucide-react-native/icons/sliders-horizontal"
import Star from "lucide-react-native/icons/star"
import X from "lucide-react-native/icons/x"
import React from "react"
import { AccessibilityInfo, ActivityIndicator, Pressable, ScrollView, type TextInputInstance, useWindowDimensions, View } from "react-native"
import Animated from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"

type Media = AL_BaseAnime | AL_BaseManga
type StoredSearch = {
    state: SearchPhoneState
    /** The link params the search came from (with the stamp of the tap that sent them) */
    applied: string | null
}

/** The phone's own search: kept across pages for the app session (a restart starts fresh), like the desktop atom. */
const searchPhoneAtom = atom<StoredSearch>({ state: SEARCH_DEFAULTS, applied: null })

export type SearchLinkParams = Record<string, string | string[] | undefined>

/*
 * Android phone Search tab (search-phone.tsx + search-phone.css) in the Home / Manga language: the type, the search field,
 * sort chips, the active filters as removable chips and the results as an endlessly loading cover grid (one FlashList,
 * so only the covers near the screen are drawn); the other filters live in a sheet.
 *
 * Sort while typing (known 2.0.33 bug, see search-phone.ts `titleSort`): a title search has its own order with "Best
 * match" first; any other chip then orders the matches by itself and the browse sort is left alone.
 *
 * "Custom sources" sits on the results head once such an extension is installed. The tab stays mounted, so Back from an entry page lands on the same results without a scroll memory.
 */
export function SearchPhone({ params }: { params: SearchLinkParams }) {
    const t = useTr()
    const serverStatus = useServerStatus()
    const adultAllowed = !!serverStatus?.settings?.anilist?.enableAdultContent
    // with a custom-source extension the results head links its screen (search-phone.tsx `data-search-custom-sources`)
    const { data: customSources } = useListCustomSourceExtensions()
    const insets = useSafeAreaInsets()
    const top = usePageTop()
    const barHeight = useNavBarHeight()
    const { rail, isTablet } = useTabletLayout()
    const { height } = useWindowDimensions()
    const offlineAware = useOfflineAware()

    const [stored, setStored] = useAtom(searchPhoneAtom)
    // A link with search params replaces the search when it arrives (Discover's "See all" stamps each tap with `at`);
    // without params the last search stays. The arriving search is used right away, so the first frame neither shows nor
    // fetches the old one.
    const linkParams = React.useMemo(() => ({ get: (key: string) => {
        const value = params[key]
        return value == null ? null : Array.isArray(value) ? value.join(",") : value
    } }), [params])
    const paramsKey = searchParamsKey(linkParams)
    const arrivalKey = paramsKey ? `${paramsKey}#${linkParams.get("at") ?? ""}` : ""
    const arriving = React.useMemo(() => !arrivalKey || stored.applied === arrivalKey ? null : searchStateFromParams(linkParams, adultAllowed),
        [arrivalKey, stored.applied, linkParams, adultAllowed])
    React.useEffect(() => {
        if (arriving) setStored({ state: arriving, applied: arrivalKey })
    }, [arriving, arrivalKey, setStored])
    const state = arriving ?? stored.state
    const update = React.useCallback((change: (state: SearchPhoneState) => SearchPhoneState) => setStored(prev => {
        const next = change(prev.state)
        return next === prev.state ? prev : { ...prev, state: next }
    }), [setStored])

    // Typing reaches the search after a pause (Enter and clearing at once); a title from a link replaces the field.
    const inputRef = React.useRef<TextInputInstance>(null)
    const [input, setInput] = React.useState(state.title)
    const [shownTitle, setShownTitle] = React.useState(state.title)
    if (state.title !== shownTitle) {
        setShownTitle(state.title)
        if (state.title.trim() !== input.trim()) setInput(state.title)
    }
    const debouncedInput = useDebounce(input, 400)
    const commitTitle = React.useCallback((title: string) => update(current => withSearchTitle(current, title)), [update])
    React.useEffect(() => {
        commitTitle(debouncedInput)
    }, [debouncedInput, commitTitle])
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
    const current = React.useMemo(() => results.data ? { type: state.type, key: searchKey, pages: results.data.pages } : undefined,
        [results.data, searchKey, state.type])
    const last = useLastData(current)
    // While a new search of the same type loads, the previous results stay (dimmed) instead of bones.
    const shown = current ?? (last?.type === state.type && !results.isError ? last : undefined)
    const stale = !current && !!shown
    const items = React.useMemo(() => uniqueMedia<Media>(shown?.pages as never), [shown?.pages])
    const canLoadMore = !stale && !!results.hasNextPage && !results.isFetchNextPageError
    const loadMore = () => {
        if (!results.isFetchingNextPage) void results.fetchNextPage({ cancelRefetch: false })
    }

    // Screen readers hear how each new search turned out (a failure is an alert of its own), not every further page.
    const announce = React.useEffectEvent(() => {
        if (current) AccessibilityInfo.announceForAccessibility(searchAnnouncement(t, current.type, items.length, !!results.hasNextPage))
    })
    const currentKey = current?.key
    React.useEffect(() => {
        if (currentKey) announce()
    }, [currentKey])

    // The filter sheet edits a draft that applies when it closes (Show results, Back, ✕): one new search, not one per tap.
    const [sheetOpen, setSheetOpen] = React.useState(false)
    const [draft, setDraft] = React.useState(state)
    const onSheetChange = (open: boolean) => {
        if (open) setDraft(state)
        else update(current => withSearchFilters(current, draft))
        setSheetOpen(open)
    }

    const chips = searchFilterChips(t, state, adultAllowed)
    const removeFilter = (id: string) => update(current => removeSearchFilter(current, id))
    const clearFilters = () => update(clearSearchFilters)
    const title = state.title.trim()
    const sort = activeSearchSort(state)

    // The grid: columns from the content width (onLayout), the cards are the cells' width
    const [contentWidth, setContentWidth] = React.useState(0)
    const grid = useGridColumns(contentWidth)
    const gutter = 16
    const beside = searchBesideTabs(rail, contentWidth)

    const list = React.useRef<FlashListRef<Media>>(null)
    const [farDown, setFarDown] = React.useState(false)

    let body: React.ReactNode = null
    if (!shown && results.isError) {
        body = <Notice text={offlineAware(["The search failed.", "Die Suche ist fehlgeschlagen."],
            ["No internet connection, so the search failed.", "Keine Internetverbindung, deshalb ist die Suche fehlgeschlagen."])}>
            <TextAction label={t("Try again", "Erneut versuchen")} onPress={() => void results.refetch()} />
        </Notice>
    } else if (!shown || (stale && !items.length)) {
        body = contentWidth ? <GridBones label={t("Searching…", "Suche läuft …")} contentWidth={contentWidth} /> : null
    } else if (!items.length) {
        body = <PhoneEmpty title={searchAnnouncement(t, state.type, 0, false)}
            text={chips.length && title ? t(`Nothing matches “${title}” with these filters.`, `Mit diesen Filtern passt nichts zu „${title}“.`)
                : chips.length ? t("Try fewer filters.", "Versuch es mit weniger Filtern.")
                    : title ? t(`Nothing on AniList matches “${title}”.`, `Auf AniList passt nichts zu „${title}“.`) : undefined}>
            {chips.length > 0 && <Button intent="secondary" onPress={clearFilters}>{t("Clear filters", "Filter zurücksetzen")}</Button>}
            {!!title && <Button intent="secondary" onPress={() => inputRef.current?.focus()}>{t("Try other words", "Anderen Suchbegriff versuchen")}</Button>}
        </PhoneEmpty>
    }
    const gridItems = body ? EMPTY : items

    const header = (
        <View className="gap-6 pb-3">
            <View className="flex-row flex-wrap items-center justify-between gap-x-2 pt-1">
                <Heading className="min-w-0 flex-1">{t("Search", "Suche")}</Heading>
                {/* the buttons overhang the title's line, so this head is as tall as Discover's (page-head.ts) */}
                <View className="-mr-2 flex-row items-center" style={HEAD_ACTIONS_STYLE}>
                    <PhoneHeadTray />
                    <HomeHeaderAction icon={SlidersHorizontal} label={t("Filter", "Filter")} dot={chips.length > 0} onPress={() => onSheetChange(true)}
                        accessibilityLabel={chips.length ? `${t("Filters", "Filter")}, ${chips.length} ${t("active", "aktiv")}` : t("Filters", "Filter")} />
                </View>
                <Muted className="mt-[3px] w-full" style={{ fontVariant: ["tabular-nums"] }}>{searchTitle(t, state)}</Muted>
            </View>

            {/* Anime / manga first, then the field, as on My lists; on a wide tablet side by side (r16, Nick 10.11., not in 2.0.33) */}
            <View className="gap-3">
                <View className={cn(beside && "flex-row items-center gap-3")}>
                    <View className={cn(rail && !beside && "w-full max-w-[416px]", beside && "shrink")} style={beside ? { width: TABLET_SEGMENT_WIDTH } : undefined}>
                        <Tabs variant="segment" value={state.type} onValueChange={type => update(current => switchSearchType(current, type as SearchType))}
                            items={[{ value: "anime", label: "Anime" }, { value: "manga", label: "Manga" }]} />
                    </View>
                    <View className={cn(!beside && "mt-3")} style={beside ? { flex: 1, maxWidth: TABLET_SEARCH_MAX_WIDTH } : undefined}>
                        <SearchField value={input} onChangeText={onInput} onSubmit={() => commitTitle(input)} inputRef={inputRef}
                            placeholder={state.type === "anime" ? t("Search anime", "Anime suchen") : t("Search manga", "Manga suchen")} />
                    </View>
                </View>
                <ChipRow label={t("Sort by", "Sortieren nach")} selected={[sort]}
                    chips={searchSortChips(state.type, !!title).map(option => ({ value: option.value, label: t(option.en, option.de) }))}
                    onSelect={value => update(current => selectSearchSort(current, value as TitleSort))} />
                {chips.length > 0 && <ActiveFilters t={t} chips={chips} onRemove={removeFilter} onClear={clearFilters} />}
            </View>

            <PhoneSection title={t("Results", "Ergebnisse")}
                count={!stale && items.length ? `${items.length}${canLoadMore || results.isFetchingNextPage ? "+" : ""}` : undefined}
                action={!!customSources?.length && <TextAction label={t("Custom sources", "Eigene Quellen")} onPress={() => router.push("/custom-sources")} />}
                note={title && !!items.length && sort === "SEARCH_MATCH" ? t("Best matches first", "Beste Treffer zuerst") : undefined}>
                {body}
            </PhoneSection>
        </View>
    )

    // One button for loading more, loading and trying a failed page again; at the end "That's all".
    const loading = results.isFetchingNextPage
    const failed = results.isFetchNextPageError && !loading
    const footer = body ? null : canLoadMore || loading || failed ? (
        <View className="items-center gap-2 pt-1">
            {failed && <Text accessibilityRole="alert" className="text-center text-sm leading-[21px] text-sm-text-muted">
                {offlineAware(["More results could not be loaded.", "Weitere Ergebnisse konnten nicht geladen werden."],
                    ["No internet connection, so no more results could be loaded.", "Keine Internetverbindung, deshalb konnten keine weiteren Ergebnisse geladen werden."])}
            </Text>}
            {loading ? (
                <View accessibilityRole="progressbar" className="min-h-12 min-w-48 flex-row items-center justify-center gap-2 px-5">
                    <ActivityIndicator size="small" color={colors.smTextMuted} />
                    <Text className="text-[15px] font-medium text-sm-text-muted">{t("Loading more…", "Weitere Ergebnisse werden geladen …")}</Text>
                </View>
            ) : <Button intent="secondary" wrapperClassName="min-w-48" onPress={loadMore}>{failed ? t("Try again", "Erneut versuchen") : t("Load more", "Mehr laden")}</Button>}
        </View>
    ) : !stale ? <Text className="min-h-12 py-3 text-center text-sm text-sm-text-muted">{t("That's all", "Das war alles")}</Text> : null

    return (
        <View className="flex-1">
            {/* the page tint of the phone tabs (the tablet's ground carries its own) */}
            {!rail && <View pointerEvents="none" className="absolute inset-x-0 top-0 h-[568px]"
                style={{ backgroundImage: PHONE_PAGE_TINT }} />}
            <View className={cn("w-full flex-1", !rail && "max-w-[1152px] self-center")} style={{ paddingHorizontal: gutter }}
                onLayout={event => setContentWidth(event.nativeEvent.layout.width - gutter * 2)}>
                <FlashList
                    ref={list}
                    data={gridItems}
                    keyExtractor={media => String(media.id)}
                    numColumns={grid.columns}
                    extraData={stale}
                    renderItem={({ item }) => (
                        <View style={{ paddingHorizontal: grid.gap / 2, paddingBottom: grid.rowGap, opacity: stale ? 0.45 : 1 }}>
                            <ResultCell media={item} type={shown?.type ?? state.type} width={grid.width} />
                        </View>
                    )}
                    ListHeaderComponent={<View style={{ paddingHorizontal: grid.gap / 2 }}>{header}</View>}
                    ListFooterComponent={<View style={{ paddingHorizontal: grid.gap / 2 }}>{footer}</View>}
                    // The next page loads before the end comes into view; "Load more" stays for screen readers.
                    onEndReached={() => {
                        if (canLoadMore && !loading) void results.fetchNextPage()
                    }}
                    onEndReachedThreshold={1}
                    onScroll={event => setFarDown(event.nativeEvent.contentOffset.y > height * 2)}
                    scrollEventThrottle={100}
                    // New results start where the page is; FlashList's default would scroll to keep an old cover in place
                    maintainVisibleContentPosition={{ disabled: true }}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode="on-drag"
                    showsVerticalScrollIndicator={false}
                    style={{ marginHorizontal: -grid.gap / 2 }}
                    contentContainerStyle={{ paddingTop: top, paddingBottom: (rail ? 32 : barHeight + 32) + insets.bottom }}
                />
            </View>
            {/* After two screens of results, a button above the bottom bar goes back to the field, sort and filters */}
            {farDown && (
                <Animated.View entering={swapIn(isTablet)} style={{ bottom: (rail ? 16 : barHeight + 16) + insets.bottom }} className="absolute right-4">
                    <Pressable accessibilityRole="button" accessibilityLabel={t("Back to top", "Nach oben")}
                        onPress={() => list.current?.scrollToOffset({ offset: 0, animated: true })}
                        className="h-12 w-12 items-center justify-center rounded-full bg-sm-surface-control active:bg-sm-line-strong">
                        <ArrowUp size={22} color={colors.smText} />
                    </Pressable>
                </Animated.View>
            )}
            <SearchPhoneFilters open={sheetOpen} onOpenChange={onSheetChange} draft={draft} onDraft={setDraft} adultAllowed={adultAllowed} />
        </View>
    )
}

const EMPTY: Media[] = []

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
 * The active filters as removable chips ("Remove Action" for screen readers) in one sideways row, and one way to clear
 * them all at its end. Unlike the chosen sort they sit on the raised surface with the accent only on their ✕.
 */
function ActiveFilters({ t, chips, onRemove, onClear }: { t: Translate, chips: SearchFilterChip[], onRemove: (id: string) => void, onClear: () => void }) {
    return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityLabel={t("Active filters", "Aktive Filter")}
            className="-mx-4 grow-0" contentContainerClassName="items-center gap-2 px-4">
            {chips.map(chip => (
                <Pressable key={chip.id} accessibilityRole="button" accessibilityLabel={t(`Remove ${chip.name}`, `${chip.name} entfernen`)} onPress={() => onRemove(chip.id)}
                    className="min-h-12 max-w-[80vw] flex-row items-center gap-1.5 rounded-full bg-sm-surface-raised py-1 pl-4 pr-3 active:bg-sm-surface-control">
                    {chip.kind === "minScore" && <Star size={16} color={colors.smTextMuted} />}
                    <Text numberOfLines={1} className="shrink text-sm font-semibold leading-[18px]">{chip.label}</Text>
                    <X size={16} color={colors.smAccent} />
                </Pressable>
            ))}
            <View className="-ml-1"><TextAction label={t("Clear filters", "Filter zurücksetzen")} onPress={onClear} /></View>
        </ScrollView>
    )
}

/** What the collections know about a result (list status, progress, score, local files), read per cell from the atoms. */
const ResultCell = React.memo(function ResultCell({ media, type, width }: { media: Media, type: SearchType, width: number }) {
    const serverStatus = useServerStatus()
    const { showAnimeUnwatchedCount, showMangaUnreadCount } = useThemeSettings()
    const chapters = useAtomValue(__mangaLibrary_latestChapterNumbersAtom)
    // List data as MediaEntryCard finds it: the AniList collection first, then the local library; manga from the manga collection.
    const animeListData = useAtomValue(__anilist_userAnimeListDataAtom)
    const library = useAtomValue(animeLibraryCollectionAtom)
    const mangaCollection = useAtomValue(mangaCollectionAtom)
    const libraryEntry = React.useMemo(() => type === "anime" ? library?.lists?.flatMap(list => list.entries ?? []).find(entry => entry.mediaId === media.id) : undefined,
        [library, media.id, type])
    const mangaEntry = React.useMemo(() => type === "manga" ? mangaCollection?.lists?.flatMap(list => list.entries ?? []).find(entry => entry.mediaId === media.id) : undefined,
        [mangaCollection, media.id, type])
    const libraryData: Anime_EntryLibraryData | undefined = libraryEntry?.libraryData
    const listData: Anime_EntryListData | Manga_EntryListData | undefined = type === "anime" ? animeListData[String(media.id)] ?? libraryEntry?.listData : mangaEntry?.listData
    const unseen = unseenCount(type, media, listData, { anime: showAnimeUnwatchedCount, manga: showMangaUnreadCount, library: libraryData, chapters })
    return <ResultCard media={media} type={type} width={width} blurAdult={!!serverStatus?.settings?.anilist?.blurAdultContent}
        listData={listData} local={!!libraryData?.mainFileCount} sharedPath={libraryData?.sharedPath} unseen={unseen} />
})

/**
 * A result: progress (else airing / upcoming) and new episodes (else the user's score) on the cover; under the title the
 * list status and year in the accent, else season or form and year, with a mark for local files.
 */
function ResultCard({ media, type, width, blurAdult, listData, local, sharedPath, unseen }: {
    media: Media
    type: SearchType
    width: number
    blurAdult: boolean
    listData: Anime_EntryListData | Manga_EntryListData | undefined
    local: boolean
    /** the title's folder in the local library */
    sharedPath?: string
    unseen: number
}) {
    const t = useTr()
    const facts = resultCardFacts(t, type, media, listData, { unseen, local })
    const total = type === "anime" ? (media as AL_BaseAnime).episodes : (media as AL_BaseManga).chapters
    const progress = listData?.status !== "COMPLETED" && listData?.progress && total ? { value: listData.progress, total } : undefined
    const { openDirInLibraryExplorer } = useLibraryExplorer()
    // "Open in library explorer" for a title with local files, at its folder (search-phone.tsx onExplorer)
    const menuItems = React.useMemo(() => sharedPath ? [{ id: "explorer", label: t("Open in library explorer", "Im Bibliotheks-Explorer öffnen"), icon: FolderOpen,
        onPress: () => openDirInLibraryExplorer(sharedPath) }] : undefined, [sharedPath, openDirInLibraryExplorer, t])
    return <PhoneCoverCard media={media} type={type} width={width} blurAdult={blurAdult} progress={progress} badge={facts.badge} tag={facts.tag}
        meta={facts.meta} metaTone={facts.onList ? "accent" : undefined} label={facts.label} menuItems={menuItems}
        metaIcon={local ? <View className="mr-1"><Library size={12} color={facts.onList ? colors.smAccent : colors.smTextSubtle} /></View> : undefined} />
}
