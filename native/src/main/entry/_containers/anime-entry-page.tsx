import type { AL_AnimeDetailsById_Media, Anime_Entry } from "@/api/generated/types"
import { useGetAnilistAnimeDetails } from "@/api/hooks/anilist.hooks"
import { useAnimeEntryBulkAction, useGetAnimeEntry, useGetAnimeEntrySilenceStatus, useToggleAnimeEntrySilenceStatus } from "@/api/hooks/anime_entries.hooks"
import { useNavBarHeight } from "@/components/navigation/app-navigation"
import { Button } from "@/components/ui/button/button"
import { cn } from "@/components/ui/core/styling"
import { Tabs } from "@/components/ui/tabs/tabs"
import { Muted, Text } from "@/components/ui/text/text"
import { getAppLanguage, useTr } from "@/lib/app-language"
import { openInAppBrowser } from "@/lib/helpers/browser"
import { userScoreColor } from "@/main/_features/media/_lib/media-card"
import { useNakamaStatus } from "@/main/_features/nakama/nakama-manager"
import { useRouter } from "@/lib/navigation"
import { getImageUrl } from "@/lib/server/assets"
import { isCustomSource } from "@/lib/server/utils"
import { entryColumnGaps, WIDE_MIN_WIDTH } from "@/lib/tablet-ui"
import { colors } from "@/lib/theme/tokens"
import { useTabletLayout } from "@/lib/use-tablet-ui"
import { AnilistMediaEntryButton } from "@/main/_features/media/_containers/anilist-media-entry-sheet"
import { MEDIA_STATUS_LABELS, plainDescription } from "@/main/_features/media/_lib/media-labels"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { listStatusLabel } from "@/main/discover/_lib/discover-phone"
import { AnimeEntryPhoneMenu } from "@/main/entry/_containers/entry-actions/anime-entry-phone-menu"
import { PluginPageButtons } from "@/main/_features/plugin/plugin-actions"
import { PluginTrayButton } from "@/main/_features/plugin/plugin-tray"
import { PluginWebviewSlot } from "@/main/_features/plugin/plugin-webview"
import { EpisodeSection } from "@/main/entry/_containers/episode-list/episode-section"
import { EntryScrollProvider, useEntryScrollSignal } from "@/main/entry/_containers/episode-list/windowed-rows"
import { MediaEntryCharactersSection } from "@/main/_features/media/_components/media-entry-characters-section"
import { EntryAboutLinks } from "@/main/_features/media/_components/entry-about-links"
import { RelationsRecommendationsSection } from "@/main/entry/_components/relations-recommendations-section"
import { DebridStreamPage } from "@/main/entry/_containers/debrid-stream/debrid-stream-page"
import { TorrentSearchPhone } from "@/main/entry/_containers/torrent-search/torrent-search-phone"
import { TorrentStreamPage } from "@/main/entry/_containers/torrent-stream/torrent-stream-page"
import {
    __anime_entryPageViewAtom,
    __anime_hiddenEntryViewsAtom,
    type AnimeEntryView,
    getAnimeEntryTabs,
    getAutomaticAnimeEntryView,
    getInitialAnimeEntryView,
    NOT_READY_VIEWS,
    shownAnimeEntryView,
} from "@/main/entry/_lib/anime-entry-view"
import { OnlinestreamPage } from "@/main/onlinestream/_containers/onlinestream-page"
import { player_onlineAtom } from "@/main/onlinestream/_lib/onlinestream-player.atoms"
import { addSeconds } from "date-fns/addSeconds"
import { format } from "date-fns/format"
import { formatDistanceToNow } from "date-fns/formatDistanceToNow"
import { de } from "date-fns/locale/de"
import { useCloseOnBack } from "@/components/ui/core/back-handler"
import { useFocusEffect, useIsFocused, useLocalSearchParams } from "expo-router"
import { useSetRouteParams } from "@/lib/route-params"
import { Image } from "expo-image"
import { useCoverFlightPageBackSteps, useCoverFlightTarget } from "@/components/shared/cover-flight"
import { usePageTop } from "@/components/shared/phone-screen"
import { useImageFade } from "@/components/ui/core/image-fade"
import { useAtom, useAtomValue } from "jotai"
import BadgeCheck from "lucide-react-native/icons/badge-check"
import Bell from "lucide-react-native/icons/bell"
import BellOff from "lucide-react-native/icons/bell-off"
import CalendarDays from "lucide-react-native/icons/calendar-days"
import ChevronDown from "lucide-react-native/icons/chevron-down"
import ChevronRight from "lucide-react-native/icons/chevron-right"
import EllipsisVertical from "lucide-react-native/icons/ellipsis-vertical"
import Info from "lucide-react-native/icons/info"
import LockOpen from "lucide-react-native/icons/lock-open"
import Share2 from "lucide-react-native/icons/share-2"
import Star from "lucide-react-native/icons/star"
import React from "react"
import { ActivityIndicator, Pressable, ScrollView, useWindowDimensions, View } from "react-native"
import Animated, { useReducedMotion } from "react-native-reanimated"
import { BoxHostProvider, PlayerMediaBox, useBoxHost } from "@/main/_features/player/player-box"
import { useSafeAreaInsets } from "react-native-safe-area-context"

/*
 * The anime page (anime-entry-page.tsx, meta-section.tsx, mobile-anime-header.tsx, mobile-anime.css + tablet.css):
 * cover and title, the progress with Edit, "Episodes & playback", About, the actions (More, notifications, file lock),
 * the source tabs, the next episode's airing, then the chosen source's episodes. Phones stack everything; tablets show a
 * bigger cover, and from 1000dp the header is the left column with the tabs and episodes on the right.
 *
 * Opening the page never starts playback (handle-play-on-mount only plays for "Continue", and only with the player, E3).
 * Sources whose native screen does not exist yet are not offered (NATIVE_VIEW_READY); since 2.15 all three have one, and
 * an anime outside the library opens on online streaming when it is on (getAutomaticAnimeEntryView), as in 2.0.33.
 * More › Tabs lists all three. Torrent and debrid streaming list their episodes and open the torrent sheet; online
 * streaming has its own source view (onlinestream-page.tsx). Characters, relations and recommendations follow the episodes on phones and run
 * across the page under everything on tablets (tablet.css `.tablet-entry-more`).
 * No dark top bar strip over the page as in 2.0.32/2.0.33 (Nick 10.11.): the page starts at the shared page top
 * (page-top.ts); the plugin tray (puzzle) and the plugins' round buttons sit beside More, their pages in the page's
 * slots (2.17). Plugin episode tabs are not here yet (docs §9). An anime of the
 * Nakama host's library shows "Shared by <host>" beside More (2.13). The tapped cover flies into the header's (E5, cover-flight.tsx).
 */

/** `.mobile-shared-chip`: the anime comes from the Nakama host's library */
function SharedByChip() {
    const t = useTr()
    const host = useNakamaStatus()?.hostConnectionStatus?.username
    return (
        <View accessibilityLabel={`${t("Shared by", "Geteilt von")} ${host ?? ""}`.trim()}
            className="min-h-12 flex-row items-center gap-2 rounded-full bg-sm-accent-softer pl-3.5 pr-4">
            <Share2 size={20} color={colors.smAccent} />
            <Text numberOfLines={1} className="text-sm font-semibold">{t("Shared by", "Geteilt von")} {host}</Text>
        </View>
    )
}


/** The page tint (mobile-anime.css) from `top` dp down */
function pageTint(top: number) {
    const stops: [number, number][] = [[0.16, 0], [0.11, 56], [0.085, 172], [0.055, 312], [0.028, 453], [0.01, 581]]
    return `linear-gradient(180deg, ${stops.map(([alpha, at]) => `rgba(97,82,223,${alpha}) ${at + top}px`).join(", ")}, rgba(0,0,0,0) ${696 + top}px)`
}

/** How often the scrolling page tells the long online list where it is (windowed-rows.tsx) */
const SCROLL_SIGNAL_MS = 50

export function AnimeEntryPage() {
    const t = useTr()
    const router = useRouter()
    const setRouteParams = useSetRouteParams()
    const serverStatus = useServerStatus()
    const params = useLocalSearchParams<{ id?: string, tab?: string }>()
    const mediaId = params.id ? params.id : null
    const { data: entry, isLoading, isError, refetch, isFetching } = useGetAnimeEntry(mediaId)
    const { data: details, isLoading: detailsLoading } = useGetAnilistAnimeDetails(mediaId)
    const [storedView, setView] = useAtom(__anime_entryPageViewAtom)
    const storedHidden = useAtomValue(__anime_hiddenEntryViewsAtom)
    const hidden = React.useMemo(() => [...storedHidden, ...NOT_READY_VIEWS], [storedHidden])
    const switchedFor = React.useRef<string | null>(null)
    // the wide tablet's left column, which scrolls on its own (r16)
    const columnRef = React.useRef<React.ComponentRef<typeof ScrollView>>(null)
    const scrollSignal = useEntryScrollSignal()
    const episodesY = React.useRef(0)
    const insets = useSafeAreaInsets()
    const top = usePageTop()
    const barHeight = useNavBarHeight()
    const { rail, isTablet, window } = useTabletLayout()
    const wide = isTablet && window.width >= WIDE_MIN_WIDTH
    const [moreOpen, setMoreOpen] = React.useState(false)
    // The jump glides down the page instead of cutting (mobile-anime-header.tsx glideToEpisodes), except with reduced motion
    const reduceMotion = useReducedMotion()

    // The page's first view, once per anime: the link's tab, the default source, the automatic view.
    // The page is a tab of the main navigator and stays mounted while another one shows: coming back after leaving it
    // – also through a link with the same anime and tab, like a playlist's next online episode – picks the first view
    // again (web: a new page mount per visit). The hidden page keeps its view until then (shownAnimeEntryView).
    const focused = useIsFocused()
    // r22: an Animated.ScrollView, its offset drives the player's box on the UI thread (player-box.tsx)
    const { scrollRef, host: boxHost, onScroll: onBoxScroll, onScrollViewLayout, onContentSizeChange, setContent, onContentLayout } =
        useBoxHost({ focused, topInset: insets.top, onScrollSignal: scrollSignal.emit, signalMs: SCROLL_SIGNAL_MS })
    const [left, setLeft] = React.useState(false)
    const ready = !isLoading && !!mediaId && !!serverStatus?.settings
    // r22: this anime's online stream still plays (box or mini player): coming back opens the online view, so its box
    // takes the player again (player-box.tsx)
    const onlineMediaId = useAtomValue(player_onlineAtom)?.params.mediaId
    const backToOnline = !params.tab && !!mediaId && String(onlineMediaId ?? "") === mediaId && !hidden.includes("onlinestream")
    const firstView = (): AnimeEntryView => backToOnline ? "onlinestream" : getInitialAnimeEntryView({ entry, serverStatus, hidden, tab: params.tab })
    const startView = focused && left && ready ? firstView() : null
    const view = shownAnimeEntryView(storedView, focused, left, startView)
    React.useEffect(() => {
        if (!focused || !ready) return
        if (switchedFor.current === mediaId) return
        switchedFor.current = mediaId
        setView(backToOnline ? "onlinestream" : getInitialAnimeEntryView({ entry, serverStatus, hidden, tab: params.tab }))
        setLeft(false)
    }, [focused, entry, ready, mediaId, serverStatus, hidden, params.tab, setView, backToOnline])
    const pickView = (next: AnimeEntryView) => {
        setView(next)
        setLeft(false)
    }

    // A tab hidden while it is open gives way to the page's usual one
    React.useEffect(() => {
        if (hidden.includes(storedView)) setView(getAutomaticAnimeEntryView(entry, serverStatus, hidden))
    }, [storedView, hidden, entry, serverStatus, setView])

    // An anime opened from this page (relations, recommendations) takes over the same page with its id; Back goes back
    // through them like the WebView's history did, then leaves the page as usual
    const [trail, setTrail] = React.useState<string[]>([])
    const [shownId, setShownId] = React.useState(mediaId)
    const [backTo, setBackTo] = React.useState<string | null>(null)
    // only while the page is shown: an anime opened from elsewhere later starts a new trail (the blur cleared shownId)
    if (focused && shownId !== mediaId) {
        setShownId(mediaId)
        if (mediaId === backTo) setBackTo(null)
        else if (shownId && mediaId) setTrail(list => [...list, shownId])
    }
    React.useEffect(() => {
        scrollRef.current?.scrollTo({ y: 0, animated: false })
        columnRef.current?.scrollTo({ y: 0, animated: false })
    }, [mediaId, scrollRef])
    // the cover flight's way back (registered later) lets these steps go first
    useCoverFlightPageBackSteps(trail.length > 0)
    useCloseOnBack(trail.length > 0, () => {
        const previous = trail[trail.length - 1]
        setTrail(list => list.slice(0, -1))
        setBackTo(previous)
        setRouteParams({ id: previous, tab: undefined })
    })

    // Leaving the page resets the view (the web's useUnmount): the next anime starts from its own first view. Only marked
    // here (`left`); the switch waits until the page shows again: done here it rebuilt the hidden page while Back's cover
    // flew into its card
    useFocusEffect(React.useCallback(() => () => {
        switchedFor.current = null
        setLeft(true)
        // the next anime opened from elsewhere starts a new trail
        setTrail([])
        setBackTo(null)
        setShownId(null)
    }, []))

    // A failed load (offline, server busy) shows an error with retry instead of leaving the page
    React.useEffect(() => {
        if (!mediaId || (!isLoading && !entry && !isError)) router.push("/")
    }, [entry, isLoading, isError, mediaId, router])

    if (isLoading) return <View className="flex-1 items-center justify-center"><ActivityIndicator color={colors.smAccent} size="large" /></View>
    if (!entry && isError) return <View className="flex-1 items-center justify-center gap-4 px-6">
        <Text className="text-center text-lg font-semibold">{t("This anime could not be loaded.", "Dieser Anime konnte nicht geladen werden.")}</Text>
        <Button intent="secondary" loading={isFetching} onPress={() => refetch()}>{t("Try again", "Erneut versuchen")}</Button>
    </View>
    if (!entry?.media) return null

    const tabs = getAnimeEntryTabs(t, entry, serverStatus, hidden)
    const tabsRow = tabs.length > 0 && <Tabs value={view} onValueChange={value => pickView(value as AnimeEntryView)} items={tabs} />
    const moreSection = <>
        <MediaEntryCharactersSection details={details} loading={detailsLoading} />
        <RelationsRecommendationsSection entry={entry} details={details} loading={detailsLoading} />
    </>
    // The tablet edition shows characters and relations across the whole page, under the anime and its episodes
    const bottomSection = rail ? undefined : moreSection
    const episodes = <View className="min-w-0">
        {/* r22: a library file, torrent, debrid or saved episode of this anime plays on in a box here when made small */}
        <PlayerMediaBox mediaId={entry.mediaId} />
        <PluginWebviewSlot slot="before-anime-entry-episode-list" />
        {view === "library" && <EpisodeSection entry={entry} bottomSection={bottomSection} />}
        {view === "torrentstream" && <TorrentStreamPage entry={entry} bottomSection={bottomSection} />}
        {view === "debridstream" && <DebridStreamPage entry={entry} bottomSection={bottomSection} />}
        {view === "onlinestream" && <OnlinestreamPage entry={entry} bottomSection={bottomSection} />}
        <PluginWebviewSlot slot="after-anime-entry-episode-list" />
    </View>

    const header = <EntryHeader entry={entry} details={details} detailsLoading={detailsLoading} wide={wide} tablet={rail}
        onEpisodes={wide ? undefined : () => scrollRef.current?.scrollTo({ y: Math.max(0, boxHost.contentOffset().y + episodesY.current - 16), animated: !reduceMotion })}
        actions={<View className="flex-row flex-wrap items-center gap-2">
            <MoreButton tablet={rail} onPress={() => setMoreOpen(true)} />
            <PluginPageButtons kind="anime" media={entry.media} />
            {view === "library" && !entry._isNakamaEntry && !!entry.libraryData && <>
                <SilenceToggle mediaId={entry.mediaId} />
                <LockFilesToggle mediaId={entry.mediaId} allFilesLocked={entry.libraryData.allFilesLocked} />
            </>}
            {view === "library" && entry._isNakamaEntry && <SharedByChip />}
            {/* no top bar strip: the puzzle joins the actions */}
            <PluginTrayButton variant="bar" />
        </View>}
        after={<>
            <PluginWebviewSlot slot="after-media-entry-details" />
            {!wide && tabsRow}
            {!wide && <NextAiringEpisode entry={entry} />}
            <EntryNotes entry={entry} />
        </>} />

    // the same top as every page (page-top.ts; Nick 10.11.: no dark 80dp strip as in 2.0.32) + `[data-mobile-anime]`'s 1rem
    // (on the phone the head's `pt-4`)
    const scrollPadding = {
        paddingTop: top + (rail ? 16 : 0),
        paddingBottom: (rail ? 32 : barHeight + 32) + insets.bottom,
    }

    // the long online list draws only the rows near the screen and follows the scrolling (windowed-rows.tsx, r18)
    // r22: the scroll content sits in one wrapper, so the player's box is measured in it (player-box.tsx)
    const scrollProps = {
        ref: scrollRef,
        onScroll: onBoxScroll,
        scrollEventThrottle: 16,
        onLayout: onScrollViewLayout,
        onContentSizeChange,
    }
    // r22: one tree for both layouts, so a window change (picture in picture, turning the tablet) does not remount the
    // episodes with the online stream page and the player's box; only the left column comes and goes
    return <EntryScrollProvider value={scrollSignal}><BoxHostProvider value={boxHost}>
        <View className={wide ? "flex-1 flex-row px-6" : "flex-1"} style={wide ? { columnGap: window.width >= 1400 ? 48 : 40 } : undefined}>
            {/* r16 (Nick 10.11., not in 2.0.33): wide, the left column stays while only the right one scrolls; a column taller
                than the screen scrolls on its own. Characters and relations follow the episodes in the right column. */}
            {wide ? <ScrollView ref={columnRef} style={{ width: window.width >= 1400 ? 352 : 320, flexGrow: 0 }} contentContainerStyle={scrollPadding}
                showsVerticalScrollIndicator={false}>
                {header}
            </ScrollView> : null}
            <Animated.ScrollView {...scrollProps} style={wide ? { minWidth: 0, flex: 1 } : { flex: 1 }}
                // style objects, not classes: uniwind's className reaches react-native's own components only
                contentContainerStyle={wide ? scrollPadding
                    : { ...scrollPadding, width: "100%", alignSelf: "center", paddingHorizontal: rail ? 24 : 0, ...(!rail ? { backgroundImage: pageTint(0) } : null) }}>
                <View ref={setContent} collapsable={false} onLayout={e => onContentLayout(e.nativeEvent.layout.x, e.nativeEvent.layout.y)}>
                    {!wide && <View className={rail ? "pb-2" : "px-4 pb-2 pt-4"}>{header}</View>}
                    {/* "Episodes & playback" glides to it (its place in the wrapper + the wrapper's in the scroll content) */}
                    {/* phone: the content container's 1rem, below it the page's and the view's `pb-10` (anime-entry-page.tsx 2.0.32) */}
                    <View className={wide ? "gap-4" : rail ? "pt-4" : "p-4 pb-24"} onLayout={event => { episodesY.current = event.nativeEvent.layout.y }}>
                        {wide && tabsRow}
                        {wide && <NextAiringEpisode entry={entry} />}
                        {episodes}
                    </View>
                    {(wide || rail) && <View className="gap-6 pt-6">{moreSection}</View>}
                    <View className={wide || rail ? "" : "px-4"}><PluginWebviewSlot slot="anime-screen-bottom" /></View>
                </View>
            </Animated.ScrollView>
        </View>
        <AnimeEntryPhoneMenu entry={entry} details={details} open={moreOpen} onOpenChange={setMoreOpen} isLibraryView={view === "library"} />
        <TorrentSearchPhone entry={entry} />
    </BoxHostProvider></EntryScrollProvider>
}

/** The header (mobile-anime-header.tsx): identity, progress with Edit, the jump to the episodes, About, the actions */
function EntryHeader({ entry, details, detailsLoading, wide, tablet, onEpisodes, actions, after }: {
    entry: Anime_Entry
    details?: AL_AnimeDetailsById_Media
    detailsLoading: boolean
    wide: boolean
    tablet: boolean
    onEpisodes?: () => void
    actions: React.ReactNode
    after: React.ReactNode
}) {
    const t = useTr()
    const { width } = useWindowDimensions()
    const media = entry.media!
    const listData = entry.listData
    const title = media.title?.userPreferred || media.title?.romaji || media.title?.english || "Anime"
    const cover = media.coverImage?.extraLarge || media.coverImage?.large
    const coverWidth = wide ? (width >= 1400 ? 208 : 176) : tablet ? 136 : 88
    const progressTotal = media.episodes
    const status = media.status && MEDIA_STATUS_LABELS[media.status] ? t(...MEDIA_STATUS_LABELS[media.status]) : media.status
    const [aboutOpen, setAboutOpen] = React.useState(false)
    // the tapped cover flies into this one (cover-flight.tsx); hidden until it lands
    const { coverRef, onLoad: onCoverLoad, hidden: coverHidden } = useCoverFlightTarget(media.id, cover ? getImageUrl(cover) : undefined)
    const fade = useImageFade()

    // wide: the parts sit in tablet.css's page grid (no gap); the phone and a narrow tablet keep the header's 1rem gap
    const gaps = wide ? entryColumnGaps("anime") : null
    return <View className={gaps ? undefined : "gap-4"}>
        <View className={cn(wide ? "items-start gap-4" : "flex-row flex-wrap items-end gap-4")}>
            {/* The cover loads at once and first, not lazily (entry-cover-transition.ts: the flight waited for a lazy one) */}
            <View ref={coverRef} collapsable={false} style={{ width: coverWidth, aspectRatio: tablet ? 23 / 33 : 88 / 124, elevation: 10, shadowColor: "#000", shadowOpacity: 0.8, shadowRadius: 14, shadowOffset: { width: 0, height: 12 } }}
                className="items-center justify-center overflow-hidden rounded-surface-sm border border-white/5 bg-sm-surface-control">
                {cover ? <Image source={getImageUrl(cover)} priority="high" contentFit={tablet ? "cover" : "contain"} style={{ position: "absolute", inset: 0, opacity: coverHidden ? 0 : 1 }}
                    onLoad={onCoverLoad} transition={coverHidden ? null : fade} accessibilityLabel={title} accessibilityIgnoresInvertColors />
                    : <Text accessibilityLabel={t("No cover", "Kein Cover")} className="text-sm-text-subtle">◇</Text>}
            </View>
            <View className={cn("min-w-0", !wide && "min-w-[160px] flex-1")}>
                <Text accessibilityRole="header" numberOfLines={4} className={cn("font-bold text-sm-text", tablet ? "text-[28px] leading-[35px] tracking-[-0.56px]" : "text-[22px] leading-[28px] tracking-[-0.44px]")}>{title}</Text>
                <Muted className="mt-1.5 capitalize">{[media.startDate?.year, status].filter(Boolean).join(" · ")}</Muted>
            </View>
        </View>

        <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1 border-y border-sm-line py-3" style={gaps ? { marginTop: gaps.progress } : undefined}>
            <View className="min-w-0 flex-1">
                <Text className="text-[11px] leading-6 font-semibold uppercase tracking-[0.88px] text-sm-text-subtle">{t("Your progress", "Dein Fortschritt")}</Text>
                <View className="h-8 flex-row items-center gap-2">
                    {!!listData?.score && <View className="flex-row items-center gap-1 rounded-full px-2 py-0.5" style={{ backgroundColor: userScoreColor(listData.score) }}>
                        <Star size={14} color="#fff" fill={listData.score >= 90 ? "#fff" : "transparent"} />
                        <Text className="text-base font-bold text-white">{listData.score / 10}</Text>
                    </View>}
                    <Text className="text-xl font-bold text-white">
                        {listData?.progress ?? 0}
                        <Text className={cn("text-xl font-bold text-white", (!listData?.progress || listData.progress !== progressTotal) && "text-white/60")}>/{progressTotal || "-"}</Text>
                    </Text>
                </View>
            </View>
            <AnilistMediaEntryButton media={media} listData={listData} type="anime" />
            {!!listData?.status && <Muted className="w-full capitalize">{listStatusLabel(t, "anime", listData.status)}{listData.repeat ? ` · ${listData.repeat} ${listData.repeat === 1
                ? t("rewatch", "Wiederholung") : t("rewatches", "Wiederholungen")}` : ""}</Muted>}
        </View>

        {!!onEpisodes && <Pressable accessibilityRole="button" onPress={onEpisodes}
            className={cn("min-h-12 flex-row items-center justify-center gap-2 rounded-full bg-brand-500 px-5 py-3 active:bg-brand-600", tablet && "min-w-[288px] self-start")}>
            <Text className="text-[15px] font-semibold text-white">{t("Episodes & playback", "Folgen & Wiedergabe")}</Text>
            <Text className="text-[15px] font-semibold text-white">↓</Text>
        </Pressable>}

        <View className="border-b border-sm-line" style={gaps ? { marginTop: gaps.about } : undefined}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: aboutOpen }} onPress={() => setAboutOpen(v => !v)}
                className="min-h-12 flex-row items-center gap-1.5 py-3">
                {aboutOpen ? <ChevronDown size={16} color={colors.smTextSubtle} /> : <ChevronRight size={16} color={colors.smTextSubtle} />}
                <Text className="text-[15px] font-semibold">{t("About this anime", "Über diesen Anime")}</Text>
            </Pressable>
            {aboutOpen && <AboutAnime entry={entry} title={title} />}
        </View>

        {gaps ? <View style={{ marginTop: gaps.actions }}>{actions}</View> : actions}
        {gaps ? <View className="gap-4 pt-4">{after}</View> : after}
    </View>
}

function AboutAnime({ entry, title }: { entry: Anime_Entry, title: string }) {
    const t = useTr()
    const media = entry.media!
    const english = media.title?.english
    const romaji = media.title?.romaji
    // `.mobile-anime-details > p`: margin .25rem 0 .9rem – between two paragraphs the margins collapse to .9rem
    const p = "mb-[14.4px] text-sm leading-[22.4px] text-sm-text-muted"
    return <View>
        <Text className={cn(p, "mt-1")}>{title}</Text>
        {!!english && english !== title && <Text className={p}>{english}</Text>}
        {!!romaji && romaji !== title && romaji !== english && <Text className={p}>{romaji}</Text>}
        <Text className={p}>{plainDescription(media.description) || t("No description available.", "Keine Beschreibung verfügbar.")}</Text>
        {/* 2.0.32 shows no score, studio, genre or ranking badges on media pages (globals.css: display none) */}
        <EntryAboutLinks onOpen={openInAppBrowser}
            anilistUrl={isCustomSource(entry.mediaId) ? undefined : `https://anilist.co/anime/${entry.mediaId}`}
            trailerUrl={media.trailer?.id && media.trailer.site === "youtube" ? `https://www.youtube.com/watch?v=${media.trailer.id}` : undefined} />
    </View>
}

function MoreButton({ tablet, onPress }: { tablet: boolean, onPress: () => void }) {
    const t = useTr()
    return <Pressable accessibilityRole="button" accessibilityLabel={t("More for this anime", "Mehr zu diesem Anime")} onPress={onPress}
        className={cn("h-12 flex-row items-center justify-center gap-2 rounded-full bg-sm-surface-raised active:bg-sm-accent-soft", tablet ? "pl-3.5 pr-[18px]" : "w-12")}>
        <EllipsisVertical size={tablet ? 18 : 22} color={tablet ? colors.smText : colors.smTextMuted} />
        {tablet && <Text className="text-sm font-semibold">{t("More", "Mehr")}</Text>}
    </Pressable>
}

/** Notifications for new episodes of this anime on or off (anime-entry-silence-toggle.tsx) */
function SilenceToggle({ mediaId }: { mediaId: number }) {
    const t = useTr()
    const { isSilenced, isLoading } = useGetAnimeEntrySilenceStatus(mediaId)
    const { mutate, isPending } = useToggleAnimeEntrySilenceStatus()
    return <Pressable accessibilityRole="button" accessibilityLabel={isSilenced ? t("Un-silence notifications", "Benachrichtigungen einschalten") : t("Silence notifications", "Benachrichtigungen stummschalten")}
        disabled={isLoading || isPending} onPress={() => mutate({ mediaId })}
        className="h-12 w-12 items-center justify-center rounded-full bg-sm-surface-raised active:bg-sm-surface-control">
        {isLoading || isPending ? <ActivityIndicator size="small" color={colors.smTextMuted} /> : isSilenced ? <BellOff size={20} color={colors.smWarning} /> : <Bell size={20} color={colors.smTextMuted} />}
    </Pressable>
}

/** Lock or unlock all of this anime's files (toggle-lock-files-button.tsx) */
function LockFilesToggle({ mediaId, allFilesLocked }: { mediaId: number, allFilesLocked: boolean }) {
    const t = useTr()
    const { mutate, isPending } = useAnimeEntryBulkAction(mediaId)
    const [locked, setLocked] = React.useState(allFilesLocked)
    const [stored, setStored] = React.useState(allFilesLocked)
    if (stored !== allFilesLocked) {
        setStored(allFilesLocked)
        setLocked(allFilesLocked)
    }
    return <Pressable accessibilityRole="button" accessibilityLabel={locked ? t("Unlock all files", "Alle Dateien entsperren") : t("Lock all files", "Alle Dateien sperren")}
        disabled={isPending} onPress={() => {
            mutate({ mediaId, action: "toggle-lock" })
            setLocked(v => !v)
        }}
        className="h-12 w-12 items-center justify-center rounded-full bg-sm-surface-raised active:bg-sm-surface-control">
        {isPending ? <ActivityIndicator size="small" color={colors.smTextMuted} /> : locked ? <BadgeCheck size={20} color={colors.smSuccess} /> : <LockOpen size={20} color={colors.smWarning} />}
    </Pressable>
}

/** "Episode 9 in 3 days · Friday" (next-airing-episode.tsx) */
function NextAiringEpisode({ entry }: { entry: Anime_Entry }) {
    const t = useTr()
    const next = entry.media?.nextAiringEpisode
    if (!next) return null
    const locale = getAppLanguage() === "de" ? { locale: de } : undefined
    const at = addSeconds(new Date(), next.timeUntilAiring || 0)
    return <View className="flex-row flex-wrap items-center gap-2">
        <Text className="text-lg font-semibold">{t("Episode", "Folge")} {next.episode}</Text>
        <Text className="text-lg">{formatDistanceToNow(at, { addSuffix: true, ...locale })}</Text>
        <CalendarDays size={18} color={colors.smTextMuted} />
        <Text className="text-lg text-sm-text-muted">{format(at, "EEEE", locale)}</Text>
    </View>
}

function EntryNotes({ entry }: { entry: Anime_Entry }) {
    const t = useTr()
    return <>
        {entry.downloadInfo?.hasInaccurateSchedule && <View>
            <Muted>{t("Could not retrieve accurate scheduling information for this show.", "Für diese Serie gibt es keinen genauen Sendeplan.")}</Muted>
            <Muted>{t("Please check the schedule online for more information.", "Genaueres findest du im Sendeplan im Internet.")}</Muted>
        </View>}
        {(!entry.anidbId || entry.anidbId === 0) && !isCustomSource(entry.mediaId) && entry.media?.status !== "NOT_YET_RELEASED" &&
            <View className="flex-row items-center gap-1 opacity-50">
                <Info size={14} color="#e5e7eb" />
                <Text className="text-sm text-[#e5e7eb]">{t("Episode metadata retrieval not available for this entry.", "Für diesen Eintrag gibt es keine Episoden-Metadaten.")}</Text>
            </View>}
    </>
}
