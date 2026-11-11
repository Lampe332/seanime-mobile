import type { AnilistListAnime_Variables } from "@/api/generated/endpoint.types"
import type { AL_BaseAnime, AL_BaseManga, AL_ListAnime, AL_ListManga, AL_ListRecentAnime } from "@/api/generated/types"
import { CardMenu, type CardMenuAnchor } from "@/components/shared/card-menu"
import { useCoverFlightSource } from "@/components/shared/cover-flight"
import { FORMAT_LABELS, Notice, TextAction } from "@/components/shared/phone-kit"
import { PluginWebviewSlot } from "@/main/_features/plugin/plugin-webview"
import {
    ChipRow,
    CoverRowBones,
    FeatureBones,
    MEDIA_STATUS_LABELS,
    PhoneCoverCard,
    PhoneEmpty,
    PhoneSection,
    seasonYearLabel,
    useLastData,
    useOfflineAware,
    useRowCoverWidth,
} from "@/components/shared/phone-cards"
import { PhoneScreen } from "@/components/shared/phone-screen"
import { Button } from "@/components/ui/button/button"
import { swapIn } from "@/components/ui/core/animations"
import { useSwapStyle } from "@/components/ui/core/swap"
import { useImageFade } from "@/components/ui/core/image-fade"
import { cn } from "@/components/ui/core/styling"
import { Tabs } from "@/components/ui/tabs/tabs"
import { Text } from "@/components/ui/text/text"
import { useTr } from "@/lib/app-language"
import { anilist_getCurrentEpisodes } from "@/lib/helpers/media"
import { useRouter } from "@/lib/navigation"
import { getImageUrl } from "@/lib/server/assets"
import { useThemeSettings } from "@/lib/theme/theme-hooks"
import { useTabletLayout } from "@/lib/use-tablet-ui"
import { useMediaPreviewModal } from "@/main/_features/media/_containers/media-preview-phone"
import { mediaEntryHref } from "@/main/_features/media/_lib/media-card"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import {
    airedAgoLabel,
    type Airing,
    byMeanScore,
    discoverSeasons,
    type DiscoverTab,
    episodeTag,
    genreLabel,
    latestAiredPerShow,
    listStatusLabel,
    pickDiscoverTab,
    pickSpotlight,
    recentWindow,
    scoreLabel,
    type SeasonYear,
    seeAllLinks,
    withoutFeatured,
} from "@/main/discover/_lib/discover-phone"
import {
    useDiscoverEntry,
    useDiscoverSchedule,
    usePhoneListAnime,
    usePhoneListManga,
    usePhoneMissedSequels,
    usePhoneRecentAiring,
} from "@/main/discover/_lib/discover-phone-hooks"
import { __discord_pageTypeAtom } from "@/main/discover/_lib/discover.atoms"
import { DiscoverPhoneSchedule, scheduleFactsLine } from "@/main/discover/_screens/discover-phone-schedule"
import { ADVANCED_SEARCH_MEDIA_GENRES } from "@/main/search/_lib/advanced-search-constants"
import { FlashList, type FlashListRef } from "@shopify/flash-list"
import { Image } from "expo-image"
import { useLocalSearchParams } from "expo-router"
import { atom, useAtom } from "jotai"
import Eye from "lucide-react-native/icons/eye"
import React from "react"
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native"
import Animated from "react-native-reanimated"

type Media = AL_BaseAnime | AL_BaseManga
type MediaType = "anime" | "manga"

/** Phone-owned genre filters, one for the anime rows and one for the manga rows; Home's Discover atoms stay untouched. */
const animeGenreAtom = atom<string | null>(null)
const mangaGenreAtom = atom<string | null>(null)

const ALL = "all"

/*
 * Android phone Discover tab (discover-phone.tsx + discover-phone.css): "What should I watch or read next?" A swipeable
 * spotlight of what is trending, then rows of covers that each lead to Search; the airing schedule as a day list;
 * trending manga by country.
 *
 * The plugin slot sits under the tabs (2.17). Not here: the dub badge (a DOM plugin, docs §9). "Open calendar" (2.7) and "Watch downloads" (2.9)
 * lead to their screens. Rows load at once (a ScrollView has no
 * IntersectionObserver, as Home's carousels); the tab stays mounted, so Back from an entry page lands where it was left.
 */
export function DiscoverPhone() {
    const t = useTr()
    const serverStatus = useServerStatus()
    const mangaEnabled = !!serverStatus?.settings?.library?.enableManga
    const { isTablet, rail } = useTabletLayout()
    const [pageType, setPageType] = useAtom(__discord_pageTypeAtom)
    const { type: urlType } = useLocalSearchParams<{ type?: string }>()
    // A link with ?type= (My lists, Manga: "/discover?type=manga") picks the tab when it arrives, in its first frame, so the
    // other tab is neither shown nor loaded; tapping a tab changes it afterwards.
    const [seenType, setSeenType] = React.useState<string | undefined>(undefined)
    const [linkTab, setLinkTab] = React.useState<string | undefined>(undefined)
    if (urlType !== seenType) {
        setSeenType(urlType)
        if (urlType) setLinkTab(urlType)
    }
    const tab = pickDiscoverTab(linkTab ?? pageType, mangaEnabled)
    const selectTab = (value: string) => {
        setLinkTab(undefined)
        setPageType(value as DiscoverTab)
    }
    const schedule = useDiscoverSchedule(tab === "schedule")
    const { current } = React.useMemo(() => discoverSeasons(new Date()), [])
    const [seasonEn, seasonDe] = SEASON_NAMES[current.season]
    const facts = tab === "anime" ? t(`${seasonEn} ${current.year} season`, `${seasonDe}-Saison ${current.year}`)
        : tab === "manga" ? t("Trending manga, manhwa and manhua", "Angesagte Manga, Manhwa und Manhua")
            : scheduleFactsLine(t, schedule)

    const tabs = [
        { value: "anime", label: "Anime" },
        { value: "schedule", label: t("Schedule", "Sendeplan") },
        ...(mangaEnabled ? [{ value: "manga", label: "Manga" }] : []),
    ]

    return (
        // No search or calendar buttons: Search sits in the navigation and the calendar is the Schedule tab right below
        <PhoneScreen title={t("Discover", "Entdecken")} subtitle={facts}>
            <View className={cn(rail && "w-full max-w-[416px]")}>
                <Tabs variant="segment" value={tab} onValueChange={selectTab} items={tabs} />
            </View>
            <PluginWebviewSlot slot="after-discover-screen-header" />
            {/* A new tab rises in instead of swapping in one frame (useSwap) */}
            <Animated.View key={tab} entering={swapIn(isTablet)} className="gap-6">
                {tab === "anime" ? <AnimeTab /> : tab === "schedule" ? <DiscoverPhoneSchedule schedule={schedule} /> : <MangaTab />}
            </Animated.View>
        </PhoneScreen>
    )
}

const SEASON_NAMES: Record<string, [string, string]> = { WINTER: ["Winter", "Winter"], SPRING: ["Spring", "Frühling"], SUMMER: ["Summer", "Sommer"], FALL: ["Fall", "Herbst"] }

/**
 * The anime rows. The genre-aware ones come first, right under the chips (spotlight, trending, both season rows); the
 * rest (aired, missed, coming soon, movies) shows every genre.
 */
function AnimeTab() {
    const t = useTr()
    const [genre, setGenre] = useAtom(animeGenreAtom)
    const seasons = React.useMemo(() => discoverSeasons(new Date()), [])
    const blurAdult = !!useServerStatus()?.settings?.anilist?.blurAdultContent
    const trending = useRowItems(usePhoneListAnime({ page: 1, perPage: 20, sort: ["TRENDING_DESC"], genres: genre ? [genre] : undefined }, true), mediaOf)
    const [recentRange] = React.useState(() => recentWindow(Date.now()))
    const recent = useRowItems(usePhoneRecentAiring({ page: 1, perPage: 50, ...recentRange }, true), recentOf)
    const spotlight = React.useMemo(() => pickSpotlight(trending.items, { hideAdult: blurAdult, skipUnreleased: true }), [trending.items, blurAdult])
    const rest = React.useMemo(() => withoutFeatured(trending.items, spotlight), [trending.items, spotlight])
    const qualifier = genre ? genreLabel(t, genre) : undefined
    const clearGenre = () => setGenre(null)

    // AniList, the server or the connection is down when both rows of the first screen fail: one notice, not a wall of them.
    // With a genre chosen the chips stay, so "All" (often still cached) is one tap away.
    if (unavailable(trending) && unavailable(recent)) return <>
        {!!genre && <GenreChips genre={genre} onChange={setGenre} />}
        <TabNotice offline={trending.offline || recent.offline} retry={() => {
            trending.retry()
            recent.retry()
        }} />
    </>

    const [seasonEn, seasonDe] = SEASON_NAMES[seasons.current.season]
    const [lastEn, lastDe] = SEASON_NAMES[seasons.previous.season]
    return <>
        <GenreChips genre={genre} onChange={setGenre} />
        <Spotlight key={genre ?? ALL} items={spotlight} type="anime" loading={spotlightLoading(trending, spotlight)} stale={trending.stale} />
        <DiscoverRow title={t("Trending now", "Gerade angesagt")} qualifier={qualifier} seeAll={seeAllLinks.trending(genre)} row={{ ...trending, items: rest }}
            genre={genre} onClearGenre={clearGenre} empty={t("Nothing is trending right now.", "Gerade ist nichts angesagt.")}
            renderCard={(media, width) => <DiscoverCover media={media} type="anime" width={width} />} />
        <SeasonBlock season={seasons.current} genre={genre} onClearGenre={clearGenre}
            title={t(`Top of ${seasonEn} ${seasons.current.year}`, `Bestbewertet im ${seasonDe} ${seasons.current.year}`)} />
        <SeasonBlock season={seasons.previous} genre={genre} onClearGenre={clearGenre}
            title={t(`Best of ${lastEn} ${seasons.previous.year}`, `Bestbewertet im ${lastDe} ${seasons.previous.year}`)} />
        <RecentBlock row={recent} />
        <MissedBlock />
        <AnimeBlock title={t("Coming soon", "Demnächst")} seeAll={seeAllLinks.upcoming()} variables={UPCOMING} releaseMark={false}
            empty={t("No announced anime right now.", "Gerade sind keine Anime angekündigt.")} />
        <AnimeBlock title={t("Trending movies", "Angesagte Filme")} seeAll={seeAllLinks.movies()} variables={MOVIES}
            empty={t("No movies are trending right now.", "Gerade sind keine Filme angesagt.")} />
    </>
}

const UPCOMING: AnilistListAnime_Variables = { page: 1, perPage: 20, sort: ["TRENDING_DESC"], status: ["NOT_YET_RELEASED"] }
const MOVIES: AnilistListAnime_Variables = { page: 1, perPage: 20, format: "MOVIE", sort: ["TRENDING_DESC"], status: ["RELEASING", "FINISHED"] }

// A plugin can turn the server's answer into null: no titles, not a crash.
const mediaOf = (data: AL_ListAnime | AL_ListManga | null) => (data?.Page?.media?.filter(Boolean) ?? []) as Media[]
const recentOf = (data: AL_ListRecentAnime | null) => latestAiredPerShow(data?.Page?.airingSchedules)
const missedOf = (data: AL_BaseAnime[] | null) => (data ?? []).filter(Boolean) as Media[]
const sortedByScore = (data: AL_ListAnime | null) => byMeanScore(mediaOf(data))

/** Top of this season / best of last season: score-sorted with the score under each cover, by the shared genre. */
function SeasonBlock({ season, genre, onClearGenre, title }: { season: SeasonYear, genre: string | null, onClearGenre: () => void, title: string }) {
    const t = useTr()
    const row = useRowItems(usePhoneListAnime({
        page: 1, perPage: 20, sort: ["SCORE_DESC"], season: season.season, seasonYear: season.year, genres: genre ? [genre] : undefined,
    }, true), sortedByScore)
    return <DiscoverRow title={title} qualifier={genre ? genreLabel(t, genre) : undefined} seeAll={seeAllLinks.season(season, genre)} row={row}
        genre={genre} onClearGenre={onClearGenre} empty={t("No rated anime for this season yet.", "Für diese Saison gibt es noch keine bewerteten Anime.")}
        renderCard={(media, width) => <DiscoverCover media={media} type="anime" width={width} line="score" />} />
}

/** Coming soon and trending movies: no genre. */
function AnimeBlock({ title, seeAll, variables, empty, releaseMark = true }: {
    title: string
    seeAll: string
    variables: AnilistListAnime_Variables
    empty: string
    releaseMark?: boolean
}) {
    const row = useRowItems(usePhoneListAnime(variables, true), mediaOf)
    return <DiscoverRow title={title} seeAll={seeAll} row={row} empty={empty}
        renderCard={(media, width) => <DiscoverCover media={media} type="anime" width={width} releaseMark={releaseMark} />} />
}

/**
 * Episodes of the last 14 days, one card per show; hidden when nothing aired. No "See all": the calendar shows the
 * user's list by default, not this row.
 */
function RecentBlock({ row }: { row: RowItems<Airing> }) {
    const t = useTr()
    const [now] = React.useState(() => Date.now())
    if (row.items && !row.items.length) return null
    return <DiscoverRow title={t("Aired recently", "Kürzlich ausgestrahlt")} row={row} empty=""
        renderCard={(item, width) => <DiscoverCover media={item.media!} type="anime" width={width} tag={episodeTag(t, item)} after={airedAgoLabel(t, item.airingAt, now)} />} />
}

/**
 * Sequels to finished or paused anime that are not on the list yet; shown only with titles, as on the desktop: no
 * heading that disappears again while the user scrolls to it.
 */
function MissedBlock() {
    const t = useTr()
    const row = useRowItems(usePhoneMissedSequels(true), missedOf)
    if (!row.failed && !row.offline && !row.items?.length) return null
    return <DiscoverRow title={t("You might have missed", "Vielleicht verpasst")} row={row} empty=""
        note={t("Sequels to anime on your list that you have not added yet.", "Fortsetzungen von Anime auf deiner Liste, die dort noch fehlen.")}
        renderCard={(media, width) => <DiscoverCover media={media} type="anime" width={width} />} />
}

function MangaTab() {
    const [genre, setGenre] = useAtom(mangaGenreAtom)
    const blurAdult = !!useServerStatus()?.settings?.anilist?.blurAdultContent
    const jp = useMangaRow("JP", genre)
    const spotlight = React.useMemo(() => pickSpotlight(jp.items, { hideAdult: blurAdult }), [jp.items, blurAdult])
    const rest = React.useMemo(() => withoutFeatured(jp.items, spotlight), [jp.items, spotlight])
    const clearGenre = () => setGenre(null)
    return <>
        <GenreChips genre={genre} onChange={setGenre} />
        <Spotlight key={genre ?? ALL} items={spotlight} type="manga" loading={spotlightLoading(jp, spotlight)} stale={jp.stale} />
        <MangaRow country="JP" genre={genre} row={{ ...jp, items: rest }} onClearGenre={clearGenre} />
        <CountryRow country="KR" genre={genre} onClearGenre={clearGenre} />
        <CountryRow country="CN" genre={genre} onClearGenre={clearGenre} />
    </>
}

function useMangaRow(country: string, genre: string | null) {
    return useRowItems(usePhoneListManga({ page: 1, perPage: 20, sort: ["TRENDING_DESC"], countryOfOrigin: country, genres: genre ? [genre] : undefined }, true), mediaOf)
}

const MANGA_ROWS: Record<string, [string, string]> = {
    JP: ["Trending manga", "Angesagte Manga"],
    KR: ["Trending manhwa", "Angesagte Manhwa"],
    CN: ["Trending manhua", "Angesagte Manhua"],
}

function MangaRow({ country, genre, row, onClearGenre }: { country: string, genre: string | null, row: RowItems, onClearGenre: () => void }) {
    const t = useTr()
    return <DiscoverRow title={t(...MANGA_ROWS[country])} qualifier={genre ? genreLabel(t, genre) : undefined} seeAll={seeAllLinks.manga(country, genre)}
        row={row} genre={genre} onClearGenre={onClearGenre} empty={t("Nothing is trending here right now.", "Hier ist gerade nichts angesagt.")}
        renderCard={(media, width) => <DiscoverCover media={media} type="manga" width={width} />} />
}

function CountryRow({ country, genre, onClearGenre }: { country: string, genre: string | null, onClearGenre: () => void }) {
    return <MangaRow country={country} genre={genre} row={useMangaRow(country, genre)} onClearGenre={onClearGenre} />
}

type RowItems<T = Media> = {
    /** The items to show; undefined while there is nothing yet, or the row failed */
    items: T[] | undefined
    /** The items are the last genre's, dimmed until the new genre arrives */
    stale: boolean
    failed: boolean
    /** React Query holds the request until the connection is back */
    offline: boolean
    retry: () => void
}

type RowQuery<D> = { data: D | undefined, isError: boolean, isFetching: boolean, isPaused: boolean, refetch: () => unknown }

/**
 * A row's state: bones until the first answer, the last genre's items (dimmed) while the next genre loads, the notice
 * when the request failed (bones again while it is retried) or waits for the connection.
 */
function useRowItems<D, T>(query: RowQuery<D>, select: (data: D | null) => T[]): RowItems<T> {
    const last = useLastData(query.data)
    // `select` is a module-level function per row; the items only change with the data.
    const items = React.useMemo(() => last === undefined ? undefined : select(last ?? null), [last, select])
    const waiting = query.data === undefined
    const failed = waiting && query.isError && !query.isFetching
    const offline = waiting && query.isPaused
    return {
        items: failed || offline ? undefined : items,
        stale: waiting && !failed && !offline && items !== undefined,
        failed,
        offline,
        retry: () => void query.refetch(),
    }
}

const unavailable = (row: RowItems<unknown>) => row.failed || row.offline

/** Bones while the trending titles load, also while a new genre loads after one without titles. */
const spotlightLoading = (row: RowItems, spotlight: Media[]) => !unavailable(row) && (!row.items || (row.stale && !spotlight.length))

/** "See all" opens Search with the row's query; the stamp makes the same link arrive again after the search was changed. */
function useSeeAll() {
    const router = useRouter()
    return (link: string) => router.push(`${link}&at=${Date.now()}`)
}

/** One section of covers with its "See all" link, row bones, failure notice or empty state. */
function DiscoverRow<T>({ title, qualifier, note, seeAll, row, empty, genre, onClearGenre, renderCard }: {
    title: string
    /** The active genre, quiet next to the title */
    qualifier?: string
    note?: string
    seeAll?: string
    row: RowItems<T>
    empty: string
    /** With a genre, an empty row offers to show all genres */
    genre?: string | null
    onClearGenre?: () => void
    renderCard: (item: T, width: number) => React.ReactElement
}) {
    const t = useTr()
    const offlineAware = useOfflineAware()
    const openSeeAll = useSeeAll()
    const width = useRowCoverWidth()
    const list = React.useRef<FlashListRef<T>>(null)
    // A new genre starts the row at its first cover again; the covers stay mounted (no new mount of every card per tap).
    React.useEffect(() => {
        list.current?.scrollToOffset({ offset: 0, animated: false })
    }, [qualifier])
    // the last genre's covers dim while the next ones load, then the new ones rise in (usePhoneSwap)
    const swapStyle = useSwapStyle(qualifier ?? "", { dimmed: row.stale })
    return (
        <PhoneSection title={title} count={qualifier} note={note}
            action={!!seeAll && <TextAction label={t("See all", "Alle anzeigen")} onPress={() => openSeeAll(seeAll)} />}>
            {row.failed ? (
                <Notice text={offlineAware(["Couldn't load this row.", "Diese Reihe konnte nicht geladen werden."],
                    ["No internet connection, so this row couldn't load.", "Keine Internetverbindung, deshalb konnte diese Reihe nicht geladen werden."])}>
                    <TextAction label={t("Try again", "Erneut versuchen")} onPress={row.retry} />
                </Notice>
            ) : row.offline ? (
                <Notice text={t("No internet connection. This row loads when you're back online.", "Keine Internetverbindung. Die Reihe lädt, sobald du wieder online bist.")} />
            ) : !row.items || (row.stale && !row.items.length) ? (
                <CoverRowBones label={`${title}: ${t("loading", "wird geladen")}`} />
            ) : !row.items.length ? (
                genre && onClearGenre ? <GenreEmpty onClear={onClearGenre} /> : <Text className="text-sm leading-[21px] text-sm-text-muted">{empty}</Text>
            ) : (
                <Animated.View accessibilityState={{ busy: row.stale }} style={swapStyle}>
                    <FlashList
                        ref={list}
                        horizontal
                        data={row.items}
                        renderItem={({ item }) => renderCard(item, width)}
                        ItemSeparatorComponent={RowGap}
                        showsHorizontalScrollIndicator={false}
                        snapToInterval={width + 12}
                        snapToAlignment="start"
                        decelerationRate="fast"
                        // a new genre's covers start at the first one (see above), not where an old cover was
                        maintainVisibleContentPosition={{ disabled: true }}
                        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 4 }}
                        style={{ marginHorizontal: -16 }}
                    />
                </Animated.View>
            )}
        </PhoneSection>
    )
}

function RowGap() {
    return <View style={{ width: 12 }} />
}

/** A genre hides every title of a row: say so and offer all genres again, right where the user looks. */
function GenreEmpty({ onClear }: { onClear: () => void }) {
    const t = useTr()
    return <PhoneEmpty title={t("Nothing in this genre here", "In diesem Genre gibt es hier nichts")}
        text={t("Pick another genre above, or show all genres.", "Wähle oben ein anderes Genre oder zeige alle Genres.")}>
        <Button intent="secondary" onPress={onClear}>{t("All genres", "Alle Genres")}</Button>
    </PhoneEmpty>
}

/** Discover as a whole did not load: one notice with one Try again. */
function TabNotice({ offline, retry }: { offline: boolean, retry: () => void }) {
    const t = useTr()
    const router = useRouter()
    const offlineAware = useOfflineAware()
    return <Notice text={offline
        ? t("No internet connection. Discover loads when you're back online.", "Keine Internetverbindung. Entdecken lädt, sobald du wieder online bist.")
        : offlineAware(["Discover couldn't be loaded.", "Entdecken konnte nicht geladen werden."],
            ["No internet connection, so Discover couldn't be loaded.", "Keine Internetverbindung, deshalb konnte Entdecken nicht geladen werden."])}>
        {!offline && <TextAction label={t("Try again", "Erneut versuchen")} onPress={retry} />}
        <TextAction label={t("Watch downloads", "Downloads ansehen")} onPress={() => router.push("/android-downloads")} />
    </Notice>
}

/** One genre for every genre-aware row; tapping the chosen genre again goes back to All. */
function GenreChips({ genre, onChange }: { genre: string | null, onChange: (genre: string | null) => void }) {
    const t = useTr()
    const chips = React.useMemo(() => [{ value: ALL, label: t("All", "Alle") }, ...ADVANCED_SEARCH_MEDIA_GENRES.map(value => ({ value, label: genreLabel(t, value) }))], [t])
    return <ChipRow label={t("Genre", "Genre")} chips={chips} selected={[genre ?? ALL]}
        onSelect={value => onChange(value === ALL || value === genre ? null : value)} />
}

/** The first trending titles as wide picture cards; swipe for the next. */
function Spotlight({ items, type, loading, stale }: { items: Media[], type: MediaType, loading: boolean, stale: boolean }) {
    const t = useTr()
    const { width } = useWindowDimensions()
    if (loading) return <FeatureBones label={t("Loading the spotlight", "„Im Fokus“ wird geladen")} />
    if (!items.length) return null
    const gutter = 16
    // .ps-feature: min(86vw, 22rem); a single card takes the whole row
    const cardWidth = items.length === 1 ? Math.min(width - gutter * 2, 1152) : Math.min(Math.round(width * 0.86), 352)
    return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityLabel={t("Spotlight", "Im Fokus")} accessibilityState={{ busy: stale }}
            snapToInterval={cardWidth + 12} snapToAlignment="start" decelerationRate="fast"
            style={{ marginHorizontal: -gutter, opacity: stale ? 0.5 : 1 }} contentContainerStyle={{ paddingHorizontal: gutter, gap: 12 }}>
            {items.map(media => <FeatureCard key={media.id} media={media} type={type} width={cardWidth} />)}
        </ScrollView>
    )
}

/**
 * A spotlight card: banner (or the cover's upper part), title, "Fall 2026 · TV · 82%" (manga: the format only when it is
 * not plain manga); long press opens the card menu like a cover's.
 */
const FEATURE_COVER_LOOK = { position: { top: "20%" } } as const

const FeatureCard = React.memo(function FeatureCard({ media, type, width }: { media: Media, type: MediaType, width: number }) {
    const t = useTr()
    const fade = useImageFade()
    const { setPreviewModalMediaId } = useMediaPreviewModal()
    const [menuAt, setMenuAt] = React.useState<CardMenuAnchor | null>(null)
    const closeMenu = React.useCallback(() => setMenuAt(null), [])
    const title = media.title?.userPreferred || media.title?.romaji || media.title?.english || ""
    const format =media.format && !(type === "manga" && media.format === "MANGA") ? FORMAT_LABELS[media.format] : undefined
    const meta = [seasonYearLabel(t, media), format ? t(...format) : "", scoreLabel(t, media.meanScore)].filter(Boolean).join(" · ")
    const coverFallback = !media.bannerImage
    const pictureUri = getImageUrl(media.bannerImage || media.coverImage?.extraLarge || media.coverImage?.large || "")
    // the banner narrows into the page's cover and cross-fades into it (cover-flight.tsx)
    const { coverRef, onLoad, hidden, open } = useCoverFlightSource(media.id, pictureUri, getImageUrl(media.coverImage?.extraLarge || media.coverImage?.large || ""),
        coverFallback ? FEATURE_COVER_LOOK : undefined)
    return (
        <Pressable
            ref={coverRef}
            collapsable={false}
            style={{ width }}
            accessibilityRole="link"
            accessibilityLabel={[title, meta].filter(Boolean).join(", ")}
            accessibilityHint={t("Long press for more", "Lange drücken für mehr")}
            onPress={() => open(mediaEntryHref(type, media.id))}
            onLongPress={event => setMenuAt({ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY })}
            delayLongPress={500}
            className="min-h-[216px] justify-end gap-1.5 overflow-hidden rounded-surface bg-sm-surface-control p-4 active:opacity-90"
        >
            <CardMenu anchor={menuAt} title={title} onClose={closeMenu}
                items={[{ id: "preview", label: t("Preview", "Vorschau"), icon: Eye, onPress: () => setPreviewModalMediaId(media.id, type) }]} />
            <Image
                source={pictureUri}
                recyclingKey={String(media.id)}
                contentFit="cover"
                // A cover in place of a banner shows its upper part (faces, logo) rather than the middle band.
                contentPosition={coverFallback ? FEATURE_COVER_LOOK.position : "center"}
                transition={fade}
                onLoad={onLoad}
                style={{ position: "absolute", inset: 0, opacity: hidden ? 0 : 1 }}
                accessibilityIgnoresInvertColors
            />
            {/* the neutral scrim under the text (.ps-feature::before: black 0 → .78 from 25 %); r16 (Nick 10.11., on purpose unlike
                2.0.32/2.0.33): dark sooner, in the resume tile's near-black, so the title also reads on bright, busy pictures */}
            <View pointerEvents="none" className="absolute inset-0"
                style={{ backgroundImage: "linear-gradient(180deg, rgba(12,12,14,0) 20%, rgba(12,12,14,0.65) 55%, rgba(12,12,14,0.9) 100%)" }} />
            <Text numberOfLines={4} className="text-[17px] font-bold leading-[22px] text-white">{title}</Text>
            {!!meta && <Text className="text-[13px] text-white/80" style={{ fontVariant: ["tabular-nums"] }}>{meta}</Text>}
        </Pressable>
    )
})

/**
 * A cover of the rows, with what MediaEntryCard shows on the phone in the kit's two marks: top right new episodes (with
 * the theme's unwatched count) or that the title is in the library, bottom left the episode (aired rows) or whether it
 * is airing or upcoming. Under the title the list status in the accent, else season and year (manga: start year; season
 * rows: the score they are sorted by).
 */
const DiscoverCover = React.memo(function DiscoverCover({ media, type, width, tag, after, line = "season", releaseMark = true }: {
    media: Media
    type: MediaType
    width: number
    /** Bottom-left mark instead of the release status (aired rows: the episode) */
    tag?: string
    /** After the list status (aired rows: how long ago); the card's name then lists every part */
    after?: string
    line?: "season" | "score"
    /** Off where the row says it already (Coming soon) */
    releaseMark?: boolean
}) {
    const t = useTr()
    const serverStatus = useServerStatus()
    const { showAnimeUnwatchedCount } = useThemeSettings()
    const { listData, libraryData } = useDiscoverEntry(type, media.id)
    const status = listStatusLabel(t, type, listData?.status)
    const title = media.title?.userPreferred || media.title?.romaji || media.title?.english || ""
    const fallback = line === "score" ? scoreLabel(t, media.meanScore) : type === "manga" ? String(media.startDate?.year ?? "") : seasonYearLabel(t, media)
    const total = type === "anime" ? (media as AL_BaseAnime).episodes : (media as AL_BaseManga).chapters
    const watching = listData?.status === "CURRENT" || listData?.status === "REPEATING"
    // As MediaEntryCard's unwatched badge: the library's count when the files are there, else the aired episodes not seen.
    const fresh = type === "anime" && watching && showAnimeUnwatchedCount ? (libraryData?.mainFileCount ? libraryData.unwatchedCount
        : Math.max(0, anilist_getCurrentEpisodes(media as AL_BaseAnime) - (listData?.progress ?? 0))) : 0
    const badge = fresh > 0 ? t(`${fresh} new`, `${fresh} neu`) : libraryData?.mainFileCount ? t("In library", "In Bibliothek") : undefined
    const release = releaseMark && (media.status === "RELEASING" || media.status === "NOT_YET_RELEASED") ? t(...MEDIA_STATUS_LABELS[media.status]) : undefined
    const meta = after
        ? <>{!!status && <><Text className="text-xs font-semibold text-sm-accent">{status}</Text>{" · "}</>}{after}</>
        : status || fallback
    return <PhoneCoverCard media={media} type={type} width={width} blurAdult={!!serverStatus?.settings?.anilist?.blurAdultContent}
        badge={badge} tag={tag ?? release} meta={meta} metaTone={!after && status ? "accent" : undefined}
        label={after ? [title, tag, status, after].filter(Boolean).join(", ") : undefined}
        progress={listData?.progress && listData.status !== "COMPLETED" ? { value: listData.progress, total: total ?? 0 } : undefined} />
})
