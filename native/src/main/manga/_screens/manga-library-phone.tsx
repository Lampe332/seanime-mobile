import { PHONE_PAGE_TINT, usePageTop } from "@/components/shared/phone-screen"
import { cn } from "@/components/ui/core/styling"
import type { Manga_CollectionEntry, Manga_CollectionList, Manga_MangaLatestChapterNumberItem } from "@/api/generated/types"
import { useUpdateTheme } from "@/api/hooks/theme.hooks"
import { useGetMangaSourceRefresh } from "@/api/hooks/manga.hooks"
import { useNavBarHeight } from "@/components/navigation/app-navigation"
import { useCoverFlightSource } from "@/components/shared/cover-flight"
import { Choices, Notice, RowGroup, TextAction } from "@/components/shared/phone-kit"
import { ChipRow, GridBones, PhoneCoverCard, PhoneEmpty, useGridColumns, useOfflineAware } from "@/components/shared/phone-cards"
import { Button } from "@/components/ui/button/button"
import { Select } from "@/components/ui/select/select"
import { Sheet, SheetGroup } from "@/components/ui/sheet/sheet"
import { SwitchRow } from "@/components/ui/switch/switch"
import { SectionTitle, Text } from "@/components/ui/text/text"
import { type Translate, useTr } from "@/lib/app-language"
import { useRouter } from "@/lib/navigation"
import { getImageUrl } from "@/lib/server/assets"
import { atomWithStorage } from "@/lib/storage"
import { useThemeSettings } from "@/lib/theme/theme-hooks"
import { useTabletLayout } from "@/lib/use-tablet-ui"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { ListsAction, ListsHeader } from "@/main/lists/_screens/lists-phone-header"
import { MangaSourceRefreshSheet } from "@/main/manga/_components/manga-source-refresh-sheet"
import { __mangaLibrary_paramsAtom } from "@/main/manga/_lib/handle-manga-collection"
import { __manga_resumeLocationsAtom } from "@/main/manga/_lib/manga-chapter-reader.atoms"
import { __manga_continueIntentAtom, getMangaContinueReading, type MangaContinueItem } from "@/main/manga/_lib/manga-continue"
import { getMangaGenreCounts, getMangaStatusTabs, MANGA_PHONE_SORTING_OPTIONS, type MangaPhoneStatus, pickMangaStatus } from "@/main/manga/_lib/manga-library-phone"
import type { MangaEntryFilters } from "@/main/manga/_lib/manga-preferences"
import { getMangaChapterTotal, getMangaEntryUnreadState } from "@/main/manga/_lib/manga-unread"
import { FlashList } from "@shopify/flash-list"
import { Image } from "expo-image"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import BookOpen from "lucide-react-native/icons/book-open"
import EllipsisVertical from "lucide-react-native/icons/ellipsis-vertical"
import Puzzle from "lucide-react-native/icons/puzzle"
import RefreshCcw from "lucide-react-native/icons/refresh-ccw"
import Search from "lucide-react-native/icons/search"
import SlidersHorizontal from "lucide-react-native/icons/sliders-horizontal"
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover/popover"
import { colors } from "@/lib/theme/tokens"
import { usePluginActions, useRunPluginAction } from "@/main/_features/plugin/plugin-actions"
import { PluginWebviewSlot } from "@/main/_features/plugin/plugin-webview"
import React from "react"
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

/*
 * The Manga tab (manga-library-phone.tsx + .css): title with icon actions (search on AniList, source refresh, filter),
 * "Continue reading" cards, then the list statuses as pills over one cover grid (FlashList, only covers near the screen
 * are drawn). Sorting and filters live in a sheet; the sort is the theme's mangaLibraryCollectionDefaultSorting, the
 * filters the library params shared with Home. The chosen status is stored under the web key.
 * Plugins (2.17): their library items in a ⋮ menu (only while there are some), their page under the grid. Not here: the
 * command palette (desktop only).
 */

const statusAtom = atomWithStorage<string>("sea-mobile-manga-library-status", "CURRENT")

type Props = {
    /** every status, filtered and sorted */
    lists: Manga_CollectionList[] | undefined
    /** every status as loaded, for the tabs and genre chips */
    rawLists: Manga_CollectionList[] | undefined
    loading: boolean
    error: boolean
    onRetry: () => void
    latestChapterNumbers: Record<number, Manga_MangaLatestChapterNumberItem[]> | undefined
    storedProviders: Record<string, string>
    storedFilters: Record<string, MangaEntryFilters>
}

export function MangaLibraryPhone({ lists, rawLists, loading, error, onRetry, latestChapterNumbers, storedProviders, storedFilters }: Props) {
    const t = useTr()
    const router = useRouter()
    const pluginItems = usePluginActions("mangaLibraryItems")
    const runPlugin = useRunPluginAction()
    const ts = useThemeSettings()
    const serverStatus = useServerStatus()
    const insets = useSafeAreaInsets()
    const top = usePageTop()
    const barHeight = useNavBarHeight()
    const { rail } = useTabletLayout()
    const offlineAware = useOfflineAware()
    const blurAdult = !!serverStatus?.settings?.anilist?.blurAdultContent
    const showUnread = !!ts.showMangaUnreadCount

    const [params, setParams] = useAtom(__mangaLibrary_paramsAtom)
    const resumeLocations = useAtomValue(__manga_resumeLocationsAtom)
    const setContinueIntent = useSetAtom(__manga_continueIntentAtom)
    const [storedStatus, setStoredStatus] = useAtom(statusAtom)
    const [filtersOpen, setFiltersOpen] = React.useState(false)
    const [refreshOpen, setRefreshOpen] = React.useState(false)
    const { data: refreshJob } = useGetMangaSourceRefresh()
    const refreshRunning = refreshJob?.status === "running" || refreshJob?.status === "stopping"

    const tabs = React.useMemo(() => getMangaStatusTabs(rawLists, lists), [rawLists, lists])
    const status = pickMangaStatus(storedStatus, tabs)
    const entries = React.useMemo(() => lists?.find(list => list.type === status)?.entries ?? [], [lists, status])
    const rawReading = React.useMemo(() => rawLists?.find(list => list.type === "CURRENT")?.entries, [rawLists])
    const unreadOf = React.useCallback((entry: Manga_CollectionEntry) => getMangaEntryUnreadState(entry.mediaId, entry.listData?.progress || 0,
        latestChapterNumbers ?? {}, storedProviders, storedFilters), [latestChapterNumbers, storedProviders, storedFilters])
    // the clock of "Continue reading": resume points older than 90 days drop out, so the time the tab opened is enough
    const [now] = React.useState(() => Date.now())
    const continueItems = React.useMemo(() => getMangaContinueReading(rawReading, {
        resumeLocations, latestChapterNumbers: latestChapterNumbers ?? {}, storedProviders, storedFilters, now,
    }), [rawReading, resumeLocations, latestChapterNumbers, storedProviders, storedFilters, now])

    const total = rawLists?.reduce((n, list) => n + (list.entries?.length ?? 0), 0) ?? 0
    const withNew = rawReading?.filter(entry => { const state = unreadOf(entry); return state.known && state.unread > 0 }).length ?? 0
    const activeFilters = (params.genre?.length ?? 0) + (params.unreadOnly ? 1 : 0)
    const facts = loading ? t("Loading your list…", "Deine Liste wird geladen …")
        : error ? t("Not loaded", "Nicht geladen")
            : `${total} Manga${showUnread && withNew > 0 ? ` · ${withNew} ${t("with new chapters", "mit neuen Kapiteln")}` : ""}`

    // `open` lets the card's cover fly into the page (cover-flight.tsx)
    const continueReading = React.useCallback((mediaId: number, open: (href: string) => void) => {
        setContinueIntent({ mediaId, at: Date.now() })
        open(`/manga/entry?id=${mediaId}`)
    }, [setContinueIntent])
    const resetFilters = () => setParams(draft => {
        draft.genre = []
        draft.unreadOnly = false
    })

    const [contentWidth, setContentWidth] = React.useState(0)
    const grid = useGridColumns(contentWidth)
    const gutter = 16
    const selectedTab = tabs.find(tab => tab.value === status)

    let body: React.ReactNode = null
    if (error) {
        body = <Notice text={offlineAware(["Your manga list could not be loaded.", "Deine Manga-Liste konnte nicht geladen werden."],
            ["No internet connection, so your manga list could not be loaded.", "Keine Internetverbindung, deshalb konnte deine Manga-Liste nicht geladen werden."])}>
            <TextAction label={t("Try again", "Erneut versuchen")} onPress={onRetry} />
            <TextAction label={t("Read downloads", "Downloads lesen")} onPress={() => router.push("/android-downloads?kind=manga")} />
        </Notice>
    } else if (loading) {
        body = <View accessibilityRole="progressbar" accessibilityLabel={t("Loading manga", "Manga werden geladen")} className="gap-3">
            <View className="mt-1 h-7 w-36 rounded-surface-sm bg-sm-surface-raised" />
            <View className="h-[168px] rounded-surface bg-sm-surface-raised" />
            <View className="mt-1 h-7 w-36 rounded-surface-sm bg-sm-surface-raised" />
            <View className="h-12 w-4/5 max-w-[320px] rounded-full bg-sm-surface-raised" />
            {!!contentWidth && <GridBones label={t("Loading manga", "Manga werden geladen")} contentWidth={contentWidth} />}
        </View>
    } else if (total === 0) {
        body = <PhoneEmpty title={t("No manga in your list yet", "Noch keine Manga in deiner Liste")}
            text={t("Manga you add on AniList appear here, sorted by status.", "Manga, die du auf AniList hinzufügst, erscheinen hier nach Status sortiert.")}>
            <Button intent="secondary" onPress={() => router.push(`/discover?type=manga&at=${Date.now()}`)}>{t("Browse manga", "Manga entdecken")}</Button>
        </PhoneEmpty>
    }

    const header = (
        <View className="gap-6 pb-3">
            <ListsHeader title="Manga" facts={facts}>
                <ListsAction icon={Search} label={t("Search", "Suche")} accessibilityLabel={t("Search manga on AniList", "Manga auf AniList suchen")}
                    onPress={() => router.push(`/search?type=manga&at=${Date.now()}`)} />
                <ListsAction icon={RefreshCcw} label={t("Sources", "Quellen")} dot={refreshRunning} onPress={() => setRefreshOpen(true)}
                    accessibilityLabel={refreshRunning ? t("Source refresh running", "Quellen werden aktualisiert") : t("Refresh manga sources", "Manga-Quellen aktualisieren")} />
                <ListsAction icon={SlidersHorizontal} label={t("Filter", "Filter")} dot={activeFilters > 0} onPress={() => setFiltersOpen(true)}
                    accessibilityLabel={activeFilters ? `${t("Filter and sort", "Filtern und sortieren")}, ${activeFilters} ${t("active", "aktiv")}` : t("Filter and sort", "Filtern und sortieren")} />
                {pluginItems.length > 0 && <Popover>
                    <PopoverTrigger asChild>
                        <Pressable accessibilityRole="button" accessibilityLabel={t("Plugin actions", "Plugin-Aktionen")}
                            className="h-12 w-12 items-center justify-center rounded-full active:bg-sm-surface-control">
                            <EllipsisVertical size={22} color={colors.smTextMuted} />
                        </Pressable>
                    </PopoverTrigger>
                    <PopoverContent align="end">
                        {pluginItems.map(item => <PopoverClose key={`${item.extensionId}:${item.id}`} asChild>
                            <Pressable accessibilityRole="menuitem" disabled={item.disabled} onPress={() => runPlugin(item, {})}
                                className="min-h-12 flex-row items-center gap-3 rounded-[10px] px-3 active:bg-sm-surface-control">
                                <Puzzle size={18} color={colors.smTextMuted} />
                                <Text className="text-[15px]">{item.label || "???"}</Text>
                            </Pressable>
                        </PopoverClose>)}
                    </PopoverContent>
                </Popover>}
            </ListsHeader>
            {body}
            {!body && continueItems.length > 0 && <View className="gap-3">
                <View className="min-h-9 justify-center"><SectionTitle>{t("Continue reading", "Weiterlesen")}</SectionTitle></View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-4 grow-0" contentContainerClassName="gap-3 px-4"
                    snapToAlignment="start" decelerationRate="fast">
                    {continueItems.map(item => <ContinueCard key={item.entry.mediaId} item={item} blurAdult={blurAdult} only={continueItems.length === 1}
                        t={t} onContinue={continueReading} />)}
                </ScrollView>
            </View>}
            {!body && <View className="gap-3">
                <View className="min-h-9 flex-row flex-wrap items-center justify-between gap-x-3" style={{ alignContent: "center" }}>
                    <SectionTitle>{t("Your list", "Deine Liste")}</SectionTitle>
                    {!!selectedTab && <Text className="text-[13px] text-sm-text-muted" style={{ fontVariant: ["tabular-nums"] }}>{selectedTab.count} Manga</Text>}
                </View>
                <ChipRow label={t("List status", "Listenstatus")} selected={status ? [status] : []} onSelect={setStoredStatus}
                    chips={tabs.map(tab => ({ value: tab.value, label: t(tab.en, tab.de), count: tab.count }))} />
                {entries.length === 0 && <PhoneEmpty title={t("No manga match the filter", "Keine Manga passen zum Filter")}
                    text={t("The filter applies to every status.", "Der Filter gilt für alle Status.")}>
                    <Button intent="secondary" onPress={resetFilters}>{t("Reset filter", "Filter zurücksetzen")}</Button>
                </PhoneEmpty>}
            </View>}
        </View>
    )

    return (
        <View className="flex-1">
            {!rail && <View pointerEvents="none" className="absolute inset-x-0 top-0 h-[568px]"
                style={{ backgroundImage: PHONE_PAGE_TINT }} />}
            <View className={cn("w-full flex-1", !rail && "max-w-[1152px] self-center")} style={{ paddingHorizontal: gutter }}
                onLayout={event => setContentWidth(event.nativeEvent.layout.width - gutter * 2)}>
                <FlashList
                    data={body ? EMPTY : entries}
                    keyExtractor={entry => String(entry.mediaId)}
                    numColumns={grid.columns}
                    renderItem={({ item }) => {
                        const state = unreadOf(item)
                        return <View style={{ paddingHorizontal: grid.gap / 2, paddingBottom: grid.rowGap }}>
                            <MangaCard entry={item} width={grid.width} blurAdult={blurAdult} latest={state.latest} fresh={showUnread && state.known ? state.unread : 0} t={t} />
                        </View>
                    }}
                    ListHeaderComponent={<View style={{ paddingHorizontal: grid.gap / 2 }}>{header}</View>}
                    ListFooterComponent={<View style={{ paddingHorizontal: grid.gap / 2 }}><PluginWebviewSlot slot="manga-screen-bottom" /></View>}
                    // a new status starts where the page is
                    maintainVisibleContentPosition={{ disabled: true }}
                    showsVerticalScrollIndicator={false}
                    style={{ marginHorizontal: -grid.gap / 2 }}
                    contentContainerStyle={{ paddingTop: top, paddingBottom: (rail ? 32 : barHeight + 32) + insets.bottom }}
                />
            </View>
            <FilterSheet open={filtersOpen} onOpenChange={setFiltersOpen} t={t} rawLists={rawLists} status={status} resultCount={entries.length} onReset={resetFilters} />
            <MangaSourceRefreshSheet open={refreshOpen} onOpenChange={setRefreshOpen} job={refreshJob} />
        </View>
    )
}

const EMPTY: Manga_CollectionEntry[] = []

/** `.mml-continue-card`: the cover, chapter progress, new chapters and one reading action; full width when alone. */
function ContinueCard({ item, blurAdult, only, t, onContinue }: {
    item: MangaContinueItem, blurAdult: boolean, only: boolean, t: Translate, onContinue: (mediaId: number, open: (href: string) => void) => void
}) {
    const { width } = useWindowDimensions()
    const { entry, progress, total, unread } = item
    const media = entry.media
    const title = media?.title?.userPreferred || ""
    const chapters = progress > 0 ? `${t("Chapter", "Kapitel")} ${progress}${total ? ` / ${total}` : ""}` : t("Reading started", "Lesen begonnen")
    const fresh = unread && unread > 0 ? `${unread} ${unread === 1 ? t("new chapter", "neues Kapitel") : t("new chapters", "neue Kapitel")}` : ""
    const veiled = blurAdult && !!media?.isAdult
    const cardWidth = only ? Math.min(width - 32, 512) : Math.min(width * 0.86, 352)
    // the cover flies into the page (cover-flight.tsx); a blurred one does not fly
    const coverUri = getImageUrl(media?.coverImage?.large || media?.coverImage?.extraLarge || "")
    const { coverRef, onLoad, hidden, open } = useCoverFlightSource(entry.mediaId, veiled ? "" : coverUri, getImageUrl(media?.coverImage?.extraLarge || ""))
    return <Pressable accessibilityRole="button" onPress={() => onContinue(entry.mediaId, open)}
        accessibilityLabel={`${t("Continue reading", "Weiterlesen")}: ${title}, ${chapters}${fresh ? `, ${fresh}` : ""}`}
        style={{ width: cardWidth }} className="flex-row gap-3.5 rounded-surface bg-sm-surface-raised p-3 active:bg-sm-surface-control">
        <View ref={coverRef} collapsable={false} className="aspect-[2/3] w-[88px] overflow-hidden rounded-surface-sm bg-sm-surface-control">
            <Image source={coverUri} recyclingKey={String(entry.mediaId)} contentFit="cover" onLoad={onLoad}
                blurRadius={veiled ? 24 : 0} style={{ position: "absolute", inset: 0, opacity: hidden ? 0 : 1 }} accessibilityIgnoresInvertColors />
            {veiled && <View pointerEvents="none" className="absolute inset-0 bg-black/30" />}
        </View>
        <View className="min-w-0 flex-1 gap-1">
            <Text numberOfLines={2} className="text-[15px] font-semibold leading-[20px]">{title}</Text>
            <Text className="text-[13px] text-sm-text-muted" style={{ fontVariant: ["tabular-nums"] }}>{chapters}</Text>
            {!!total && <View className="mb-0.5 mt-1 h-[3px] overflow-hidden rounded-full bg-sm-line-strong">
                <View style={{ width: `${Math.min(100, (100 * progress) / total)}%` }} className="h-full bg-sm-accent-strong" />
            </View>}
            {!!fresh && <Text className="text-[13px] font-semibold text-sm-accent" style={{ fontVariant: ["tabular-nums"] }}>{fresh}</Text>}
            <View className="mt-auto min-h-11 flex-row items-center gap-2 self-start rounded-full bg-brand-500 py-2 pl-3.5 pr-[18px]">
                <BookOpen size={16} color="#ffffff" />
                <Text className="text-[13px] font-semibold text-white">{t("Continue", "Weiterlesen")}</Text>
            </View>
        </View>
    </Pressable>
}

/** `.mml-card`: the grid's cover card with progress, new chapters and "Ch. 12 / 120" (the total of getMangaChapterTotal). */
const MangaCard = React.memo(function MangaCard({ entry, width, blurAdult, latest, fresh, t }: {
    entry: Manga_CollectionEntry, width: number, blurAdult: boolean, latest: number | null, fresh: number, t: Translate,
}) {
    const media = entry.media
    if (!media) return null
    const progress = entry.listData?.progress || 0
    const total = getMangaChapterTotal(media.chapters, latest) ?? 0
    const meta = progress > 0 ? `${t("Ch.", "Kap.")} ${progress}${total ? ` / ${total}` : ""}`
        : media.chapters ? `${media.chapters} ${t("chapters", "Kapitel")}` : media.startDate?.year ? String(media.startDate.year) : ""
    return <PhoneCoverCard media={media} type="manga" width={width} blurAdult={blurAdult}
        progress={progress > 0 && total > 0 && entry.listData?.status !== "COMPLETED" ? { value: progress, total } : undefined}
        badge={fresh > 0 ? `${fresh} ${t("new", "neu")}` : undefined} meta={meta} />
})

function FilterSheet({ open, onOpenChange, t, rawLists, status, resultCount, onReset }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    t: Translate
    rawLists: Manga_CollectionList[] | undefined
    status: MangaPhoneStatus | null
    resultCount: number
    onReset: () => void
}) {
    const ts = useThemeSettings()
    const [params, setParams] = useAtom(__mangaLibrary_paramsAtom)
    const { mutate: updateTheme, isPending: savingTheme } = useUpdateTheme()
    const [pendingSort, setPendingSort] = React.useState<string>()
    const sorting = (savingTheme && pendingSort) || ts.mangaLibraryCollectionDefaultSorting || "TITLE"
    const genres = React.useMemo(() => open ? getMangaGenreCounts(rawLists, status) : [], [open, rawLists, status])
    const selectedGenres = params.genre ?? []
    const setTheme = (patch: Record<string, unknown>) => updateTheme({ theme: { id: 0, ...ts, ...patch } as never })
    const toggleGenre = (genre: string) => setParams(draft => {
        draft.genre = draft.genre?.includes(genre) ? draft.genre.filter(g => g !== genre) : [...(draft.genre ?? []), genre]
    })

    return <Sheet title={t("Filter & sort", "Filtern & sortieren")} open={open} onOpenChange={onOpenChange}
        footer={<>
            <Button intent="secondary" size="lg" wrapperClassName="flex-1" disabled={!selectedGenres.length && !params.unreadOnly} onPress={onReset}>{t("Reset", "Zurücksetzen")}</Button>
            <Button size="lg" wrapperClassName="flex-[2]" onPress={() => onOpenChange(false)}>{t(`Show ${resultCount} manga`, `${resultCount} Manga anzeigen`)}</Button>
        </>}>
        <SheetGroup title={t("Sort by", "Sortieren nach")}>
            <Select accessibilityLabel={t("Sort by", "Sortieren nach")} placeholder={t("Sort by", "Sortieren nach")} value={sorting} disabled={savingTheme}
                onValueChange={value => { setPendingSort(value); setTheme({ mangaLibraryCollectionDefaultSorting: value }) }}
                options={MANGA_PHONE_SORTING_OPTIONS.map(option => ({ value: option.value, label: t(option.en, option.de) }))} />
        </SheetGroup>
        <RowGroup>
            <SwitchRow label={t("Only manga with new chapters", "Nur Manga mit neuen Kapiteln")}
                description={t("A list without any keeps showing all its manga.", "Eine Liste ohne neue Kapitel zeigt weiter alle Manga.")}
                checked={!!params.unreadOnly} onCheckedChange={() => setParams(draft => { draft.unreadOnly = !draft.unreadOnly })} />
            <SwitchRow label={t("Show new chapters on covers", "Neue Kapitel auf Covern zeigen")} disabled={savingTheme}
                checked={!!ts.showMangaUnreadCount} onCheckedChange={() => setTheme({ showMangaUnreadCount: !ts.showMangaUnreadCount })} />
        </RowGroup>
        {genres.length > 0 && <SheetGroup title={t("Genres", "Genres")} intro={t("Manga must have every selected genre.", "Manga müssen alle gewählten Genres haben.")}
            action={selectedGenres.length > 0 ? <TextAction label={t("Clear", "Abwählen")} accessibilityLabel={t("Clear genres", "Genres abwählen")}
                onPress={() => setParams(draft => { draft.genre = [] })} /> : undefined}>
            <Choices label={t("Genres", "Genres")} showCheck selected={selectedGenres} onToggle={toggleGenre}
                chips={genres.map(({ genre, count }) => ({ value: genre, label: genre, count }))} />
        </SheetGroup>}
    </Sheet>
}
