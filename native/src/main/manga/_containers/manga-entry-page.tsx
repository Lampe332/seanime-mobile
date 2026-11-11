import type { AL_MangaDetailsById_Media, Manga_Entry } from "@/api/generated/types"
import { useGetMangaEntry, useGetMangaEntryDetails } from "@/api/hooks/manga.hooks"
import { useNavBarHeight } from "@/components/navigation/app-navigation"
import { ActionRow, RowGroup } from "@/components/shared/phone-kit"
import { PluginPageButtons, usePluginActions, useRunPluginAction } from "@/main/_features/plugin/plugin-actions"
import { PluginTrayButton } from "@/main/_features/plugin/plugin-tray"
import { PluginWebviewSlot } from "@/main/_features/plugin/plugin-webview"
import { Button } from "@/components/ui/button/button"
import { cn } from "@/components/ui/core/styling"
import { Sheet, SheetGroup } from "@/components/ui/sheet/sheet"
import { Muted, Text } from "@/components/ui/text/text"
import { toast } from "@/components/ui/toast/toast-store"
import { useTr } from "@/lib/app-language"
import { copyToClipboard, openInAppBrowser } from "@/lib/helpers/browser"
import { useRouter } from "@/lib/navigation"
import { getImageUrl } from "@/lib/server/assets"
import { getCustomSourceMediaSiteUrl, isCustomSource } from "@/lib/server/utils"
import { entryColumnGaps, WIDE_MIN_WIDTH } from "@/lib/tablet-ui"
import { colors } from "@/lib/theme/tokens"
import { useTabletLayout } from "@/lib/use-tablet-ui"
import { MediaEntryCharactersSection } from "@/main/_features/media/_components/media-entry-characters-section"
import { EntryAboutLinks } from "@/main/_features/media/_components/entry-about-links"
import { MediaCardRow, MediaCardRowSkeleton } from "@/main/_features/media/_components/media-card-row"
import { AnilistMediaEntryButton } from "@/main/_features/media/_containers/anilist-media-entry-sheet"
import { userScoreColor } from "@/main/_features/media/_lib/media-card"
import { MEDIA_STATUS_LABELS, plainDescription } from "@/main/_features/media/_lib/media-labels"
import { listStatusLabel } from "@/main/discover/_lib/discover-phone"
import { Heading, RelatedCard, type RelatedCardData, relationLabel } from "@/main/entry/_components/relations-recommendations-section"
import { ExternalRow } from "@/main/entry/_containers/entry-actions/anime-entry-phone-menu"
import { ChapterList, mangaReadActionAtom } from "@/main/manga/_containers/chapter-list/chapter-list"
import { useHandleMangaDownloadData } from "@/main/manga/_lib/handle-manga-downloads"
import { useMangaChapterTotal } from "@/main/manga/_lib/use-manga-chapter-total"
import { useFocusEffect, useLocalSearchParams } from "expo-router"
import { Image } from "expo-image"
import { useCoverFlightTarget } from "@/components/shared/cover-flight"
import { usePageTop } from "@/components/shared/phone-screen"
import { useImageFade } from "@/components/ui/core/image-fade"
import { useAtomValue, useSetAtom } from "jotai"
import BookOpen from "lucide-react-native/icons/book-open"
import ChevronDown from "lucide-react-native/icons/chevron-down"
import ChevronRight from "lucide-react-native/icons/chevron-right"
import Copy from "lucide-react-native/icons/copy"
import EllipsisVertical from "lucide-react-native/icons/ellipsis-vertical"
import FolderDown from "lucide-react-native/icons/folder-down"
import Puzzle from "lucide-react-native/icons/puzzle"
import Star from "lucide-react-native/icons/star"
import React from "react"
import { ActivityIndicator, Pressable, ScrollView, useWindowDimensions, View } from "react-native"
import { useReducedMotion } from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { __manga_selectedChapterAtom } from "@/main/manga/_lib/handle-chapter-reader"

/*
 * The manga page (manga/entry/page.tsx, manga meta-section.tsx on the shared mobile-anime-header, mobile-anime.css +
 * tablet.css): the same header as an anime page (cover, title, progress with Edit), the read action the chapter list
 * publishes (start / continue / resume with the chapter and page), About this manga, More; then the chapters, the
 * characters and the manga's anime adaptations and recommendations. Tablets from 1000dp: header left, chapters right.
 * The progress counts against getMangaChapterTotal, the same total as the library's cards (AniList's count or the newest
 * chapter of the saved source), so both show "50 / 120" (§9). Plugins (2.17): the puzzle and their buttons beside More,
 * their items in More, their pages in the page's slots.
 * Nick 10.11.: no 3.5rem top bar over the page any more (on purpose unlike 2.0.32): the page starts at the same top as every
 * page (page-top.ts) and "Manga downloads" (chapter-downloads-button.tsx, `.mobile-topbar-downloads`) joins More.
 */

function pageTint(top: number) {
    const stops: [number, number][] = [[0.16, 0], [0.11, 56], [0.085, 172], [0.055, 312], [0.028, 453], [0.01, 581]]
    return `linear-gradient(180deg, ${stops.map(([alpha, at]) => `rgba(97,82,223,${alpha}) ${at + top}px`).join(", ")}, rgba(0,0,0,0) ${696 + top}px)`
}

export function MangaEntryPage() {
    const t = useTr()
    const router = useRouter()
    const params = useLocalSearchParams<{ id?: string }>()
    const mediaId = params.id ? params.id : null
    const { data: entry, isLoading, isError, refetch, isFetching } = useGetMangaEntry(mediaId)
    const { data: details, isLoading: detailsLoading } = useGetMangaEntryDetails(mediaId)
    const { downloadData, downloadDataLoading } = useHandleMangaDownloadData(mediaId)
    const scrollRef = React.useRef<React.ComponentRef<typeof ScrollView>>(null)
    // the wide tablet's left column, which scrolls on its own (r16)
    const columnRef = React.useRef<React.ComponentRef<typeof ScrollView>>(null)
    const chaptersY = React.useRef(0)
    const insets = useSafeAreaInsets()
    const top = usePageTop()
    const barHeight = useNavBarHeight()
    const { rail, isTablet, window } = useTabletLayout()
    const wide = isTablet && window.width >= WIDE_MIN_WIDTH
    const [moreOpen, setMoreOpen] = React.useState(false)
    const reduceMotion = useReducedMotion()
    const setSelectedChapter = useSetAtom(__manga_selectedChapterAtom)

    React.useEffect(() => {
        scrollRef.current?.scrollTo({ y: 0, animated: false })
        columnRef.current?.scrollTo({ y: 0, animated: false })
    }, [mediaId])
    // Leaving the page closes its reader (the reader reads from this page's chapter list)
    useFocusEffect(React.useCallback(() => () => setSelectedChapter(undefined), [setSelectedChapter]))
    // A failed load (offline, server busy) shows an error with retry instead of leaving the page
    React.useEffect(() => {
        if (!mediaId || (!isLoading && !entry && !isError)) router.push("/")
    }, [entry, isLoading, isError, mediaId, router])

    const jumpTo = React.useCallback((y: number) => {
        scrollRef.current?.scrollTo({ y: Math.max(0, chaptersY.current + y - 160), animated: !reduceMotion })
    }, [reduceMotion])

    if (isLoading) return <View className="flex-1 items-center justify-center"><ActivityIndicator color={colors.smAccent} size="large" /></View>
    if (!entry && isError) return <View className="flex-1 items-center justify-center gap-4 px-6">
        <Text className="text-center text-lg font-semibold">{t("This manga could not be loaded.", "Dieser Manga konnte nicht geladen werden.")}</Text>
        <Button intent="secondary" loading={isFetching} onPress={() => void refetch()}>{t("Try again", "Erneut versuchen")}</Button>
    </View>
    if (!entry?.media || !mediaId) return null

    const header = <MangaHeader entry={entry} details={details} detailsLoading={detailsLoading} wide={wide} tablet={rail} onMore={() => setMoreOpen(true)} />
    const chapters = <View onLayout={event => { chaptersY.current = event.nativeEvent.layout.y }} className={wide ? "min-w-0" : rail ? "pt-4" : "p-4"}>
        <ChapterList key={mediaId} mediaId={mediaId} entry={entry} downloadData={downloadData} downloadDataLoading={downloadDataLoading} onJumpTo={jumpTo} />
        <PluginWebviewSlot slot="after-manga-entry-chapter-list" />
    </View>
    const more = <View className={cn("gap-6", rail ? "pt-6" : "px-4")}>
        <MediaEntryCharactersSection details={details} loading={detailsLoading} />
        <MangaRecommendations entry={entry} details={details} loading={detailsLoading} />
    </View>

    // the same top as every page (page-top.ts) + `[data-mobile-anime]`'s 1rem (on the phone the head's `pt-4`)
    const scrollPadding = {
        paddingTop: top + (rail ? 16 : 0),
        paddingBottom: (rail ? 32 : barHeight + 32) + insets.bottom,
    }

    return <>
        {wide
            // tablet.css kept the header in view while the chapters scroll (`position: sticky`); r16 (Nick 10.11.): only the right
            // column scrolls, a header taller than the screen scrolls on its own; characters and recommendations follow the chapters
            ? <View className="flex-1 flex-row px-6" style={{ columnGap: window.width >= 1400 ? 48 : 40 }}>
                <ScrollView ref={columnRef} style={{ width: window.width >= 1400 ? 352 : 320, flexGrow: 0 }} contentContainerStyle={scrollPadding}
                    showsVerticalScrollIndicator={false}>
                    {header}
                </ScrollView>
                <ScrollView ref={scrollRef} className="min-w-0 flex-1" contentContainerStyle={scrollPadding}>
                    {chapters}
                    {more}
                    <PluginWebviewSlot slot="manga-entry-screen-bottom" />
                </ScrollView>
            </View>
            : <ScrollView ref={scrollRef} className="flex-1"
                contentContainerStyle={{ ...scrollPadding, ...(!rail ? { backgroundImage: pageTint(0) } : null) }}
                contentContainerClassName={cn("w-full self-center", rail ? "px-6" : "")}>
                <View className={rail ? "pb-2" : "px-4 pb-2 pt-4"}>{header}</View>
                {chapters}
                {more}
                <View className={rail ? "" : "px-4"}><PluginWebviewSlot slot="manga-entry-screen-bottom" /></View>
            </ScrollView>}
        <MangaEntryPhoneMenu entry={entry} open={moreOpen} onOpenChange={setMoreOpen} />
    </>
}

/** mobile-anime-header.tsx for manga: identity, progress with Edit, the read action, About, More */
function MangaHeader({ entry, details, detailsLoading, wide, tablet, onMore }: {
    entry: Manga_Entry
    details?: AL_MangaDetailsById_Media
    detailsLoading: boolean
    wide: boolean
    tablet: boolean
    onMore: () => void
}) {
    const t = useTr()
    const router = useRouter()
    const { width } = useWindowDimensions()
    const media = entry.media!
    const listData = entry.listData
    const title = media.title?.userPreferred || media.title?.romaji || media.title?.english || "Manga"
    const cover = media.coverImage?.extraLarge || media.coverImage?.large
    const coverWidth = wide ? (width >= 1400 ? 208 : 176) : tablet ? 136 : 88
    const status = media.status && MEDIA_STATUS_LABELS[media.status] ? t(...MEDIA_STATUS_LABELS[media.status]) : media.status
    const total = useMangaChapterTotal(entry.mediaId, media.chapters, listData?.progress)
    const [aboutOpen, setAboutOpen] = React.useState(false)
    const readAction = useAtomValue(mangaReadActionAtom)
    // the tapped cover flies into this one (cover-flight.tsx); hidden until it lands
    const { coverRef, onLoad: onCoverLoad, hidden: coverHidden } = useCoverFlightTarget(media.id, cover ? getImageUrl(cover) : undefined)
    const fade = useImageFade()

    // wide: tablet.css's header column (identity margin + the header's 1rem gap); the phone keeps the plain 1rem gap
    const gaps = wide ? entryColumnGaps("manga") : null
    return <View className={gaps ? undefined : "gap-4"}>
        <View className={cn(wide ? "items-start gap-4" : "flex-row flex-wrap items-end gap-4")}>
            <View ref={coverRef} collapsable={false} style={{ width: coverWidth, aspectRatio: tablet ? 23 / 33 : 88 / 124, elevation: 10, shadowColor: "#000", shadowOpacity: 0.8, shadowRadius: 14, shadowOffset: { width: 0, height: 12 } }}
                className="items-center justify-center overflow-hidden rounded-surface-sm border border-white/5 bg-sm-surface-control">
                {cover ? <Image source={getImageUrl(cover)} priority="high" contentFit={tablet ? "cover" : "contain"} style={{ position: "absolute", inset: 0, opacity: coverHidden ? 0 : 1 }}
                    onLoad={onCoverLoad} transition={coverHidden ? null : fade} accessibilityLabel={t("Manga cover", "Manga-Cover")} accessibilityIgnoresInvertColors />
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
                        <Text className={cn("text-xl font-bold text-white", (!listData?.progress || listData.progress !== total) && "opacity-60")}>/{total || "-"}</Text>
                    </Text>
                </View>
            </View>
            <AnilistMediaEntryButton media={media} listData={listData} type="manga" />
            {!!listData?.status && <Muted className="w-full capitalize">{listStatusLabel(t, "manga", listData.status)}{listData.repeat ? ` · ${listData.repeat} ${listData.repeat === 1
                ? t("reread", "Wiederholung") : t("rereads", "Wiederholungen")}` : ""}</Muted>}
        </View>

        {/* tablet.css: 18rem at the start; in the wide column it runs the column's width */}
        {!!readAction && <Pressable accessibilityRole="button" onPress={readAction.onPress} style={gaps ? { marginTop: gaps.link } : undefined}
            className={cn("min-h-12 flex-row items-center justify-center gap-2.5 rounded-full bg-brand-500 px-5 py-2.5 active:bg-brand-600", tablet && !wide && "min-w-[288px] self-start")}>
            <BookOpen size={20} color="#fff" />
            <View>
                <Text className="text-[15px] font-semibold text-white">{readAction.label}</Text>
                {!!readAction.detail && <Text className="text-xs text-white/80">{readAction.detail}</Text>}
            </View>
        </Pressable>}

        <View className="border-b border-sm-line" style={gaps ? { marginTop: gaps.about } : undefined}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: aboutOpen }} onPress={() => setAboutOpen(v => !v)} className="min-h-12 flex-row items-center gap-1.5 py-3">
                {aboutOpen ? <ChevronDown size={16} color={colors.smTextSubtle} /> : <ChevronRight size={16} color={colors.smTextSubtle} />}
                <Text className="text-[15px] font-semibold">{t("About this manga", "Über diesen Manga")}</Text>
            </Pressable>
            {aboutOpen && <AboutManga entry={entry} title={title} />}
        </View>

        <View className="flex-row flex-wrap items-center gap-2" style={gaps ? { marginTop: gaps.actions } : undefined}>
            <Pressable accessibilityRole="button" accessibilityLabel={t("More for this manga", "Mehr zu diesem Manga")} onPress={onMore}
                className={cn("h-12 flex-row items-center justify-center gap-2 rounded-full bg-sm-surface-raised active:bg-sm-accent-soft", tablet ? "pl-3.5 pr-[18px]" : "w-12")}>
                <EllipsisVertical size={tablet ? 18 : 22} color={tablet ? colors.smText : colors.smTextMuted} />
                {tablet && <Text className="text-sm font-semibold">{t("More", "Mehr")}</Text>}
            </Pressable>
            {/* once in the top bar; the tablet keeps its word (TabletLabel) */}
            <Pressable accessibilityRole="button" accessibilityLabel={t("Manga downloads", "Manga-Downloads")} onPress={() => router.push("/android-downloads?kind=manga")}
                className={cn("h-12 flex-row items-center justify-center gap-2 rounded-full bg-sm-surface-raised active:bg-sm-accent-soft", tablet ? "pl-3.5 pr-[18px]" : "w-12")}>
                <FolderDown size={tablet ? 18 : 22} color={tablet ? colors.smText : colors.smTextMuted} />
                {tablet && <Text className="text-sm font-semibold">{t("Downloads", "Downloads")}</Text>}
            </Pressable>
            <PluginPageButtons kind="manga" media={media} />
            <PluginTrayButton variant="bar" />
        </View>
        {gaps ? <View className="pt-4"><PluginWebviewSlot slot="after-media-entry-details" /></View> : <PluginWebviewSlot slot="after-media-entry-details" />}
    </View>
}

function AboutManga({ entry, title }: { entry: Manga_Entry, title: string }) {
    const t = useTr()
    const media = entry.media!
    const english = media.title?.english
    const romaji = media.title?.romaji
    const custom = isCustomSource(entry.mediaId)
    const siteUrl = custom ? getCustomSourceMediaSiteUrl(media) : null
    // `.mobile-anime-details > p`: margin .25rem 0 .9rem – between two paragraphs the margins collapse to .9rem
    const p = "mb-[14.4px] text-sm leading-[22.4px] text-sm-text-muted"
    return <View>
        <Text className={cn(p, "mt-1")}>{title}</Text>
        {!!english && english !== title && <Text className={p}>{english}</Text>}
        {!!romaji && romaji !== title && romaji !== english && <Text className={p}>{romaji}</Text>}
        <Text className={p}>{plainDescription(media.description) || t("No description available.", "Keine Beschreibung verfügbar.")}</Text>
        {/* 2.0.32 shows no score, studio, genre or ranking badges on media pages (globals.css: display none) */}
        <EntryAboutLinks onOpen={openInAppBrowser} anilistUrl={custom ? undefined : `https://anilist.co/manga/${entry.mediaId}`}>
            {!!siteUrl && <Button intent="text" onPress={() => openInAppBrowser(siteUrl)}>{t("Open in website", "Auf der Website öffnen")}</Button>}
        </EntryAboutLinks>
    </View>
}

/** The manga page's "More" (manga-entry-phone-menu.tsx): the manga elsewhere, the plugins' items (2.17) */
function MangaEntryPhoneMenu({ entry, open, onOpenChange }: { entry: Manga_Entry, open: boolean, onOpenChange: (open: boolean) => void }) {
    const t = useTr()
    const media = entry.media
    const custom = isCustomSource(entry.mediaId)
    const siteUrl = custom && media ? getCustomSourceMediaSiteUrl(media) : null
    const pluginItems = usePluginActions("mangaPageItems")
    const runPlugin = useRunPluginAction()
    return <Sheet title={t("More", "Mehr")} open={open} onOpenChange={onOpenChange}>
        <SheetGroup title={t("Elsewhere", "Anderswo")}>
            <RowGroup>
                {!custom && <ExternalRow href={`https://anilist.co/manga/${entry.mediaId}`} label="AniList" note={t("Lists, reviews, staff", "Listen, Rezensionen, Mitwirkende")} />}
                {!!media?.idMal && <ExternalRow href={`https://myanimelist.net/manga/${media.idMal}`} label="MyAnimeList" note={t("Scores and forums", "Wertungen und Foren")} />}
                {!!siteUrl && <ExternalRow href={siteUrl} label={t("Website", "Website")} note={t("The source's own page", "Die Seite der Quelle")} />}
                {custom && <CopyIdRow mediaId={entry.mediaId} />}
            </RowGroup>
        </SheetGroup>
        {pluginItems.length > 0 && <SheetGroup title="Plugins">
            <RowGroup>
                {pluginItems.map(item => <ActionRow key={`${item.extensionId}:${item.id}`} icon={Puzzle} label={item.label || "???"} disabled={item.disabled}
                    onPress={() => {
                        onOpenChange(false)
                        runPlugin(item, { media })
                    }} />)}
            </RowGroup>
        </SheetGroup>}
    </Sheet>
}

function CopyIdRow({ mediaId }: { mediaId: number }) {
    const t = useTr()
    return <Pressable accessibilityRole="button" onPress={() => void copyToClipboard(String(mediaId)).then(() => toast.success(t("ID copied", "ID kopiert")))}
        className="min-h-14 w-full flex-row items-center gap-3.5 bg-sm-surface-raised px-4 py-2.5 active:bg-sm-surface-control">
        <Copy size={20} color={colors.smTextMuted} />
        <Text className="min-w-0 flex-1 text-[15px]">{t("Copy ID", "ID kopieren")}</Text>
        <Text className="text-sm font-semibold text-sm-text-muted">{mediaId}</Text>
    </Pressable>
}

/** manga-recommendations.tsx: up to three anime adaptations (TV first) with their relation, then up to six recommendations */
function MangaRecommendations({ entry, details, loading }: { entry: Manga_Entry, details?: AL_MangaDetailsById_Media, loading: boolean }) {
    const t = useTr()
    const anime = React.useMemo(() => (details?.relations?.edges ?? []).filter(Boolean)
        .filter(edge => edge?.node?.type === "ANIME" && (edge?.node?.format === "TV" || edge?.node?.format === "MOVIE" || edge?.node?.format === "TV_SHORT"))
        .slice(0, 3)
        .sort((a, b) => (a.node?.format === "TV" && b.node?.format !== "TV") ? -1 : (a.node?.format !== "TV" && b.node?.format === "TV") ? 1 : 0)
        .filter(edge => !!edge.node)
        .map(edge => ({
            key: `anime-${edge.node!.id}`,
            media: edge.node!,
            type: "anime",
            label: `${relationLabel(t, edge.relationType)}${edge.node?.format === "MOVIE" ? t(" (Movie)", " (Film)") : ""}`,
        }) as RelatedCardData), [details?.relations?.edges, t])
    const recommendations = React.useMemo(() => (details?.recommendations?.edges?.map(edge => edge?.node?.mediaRecommendation)?.filter(Boolean) ?? [])
        .slice(0, 6).map(media => ({ key: `rec-${media!.id}`, media: media!, type: "manga" }) as RelatedCardData), [details?.recommendations?.edges])

    if (loading && !details) return <View className="mt-5 gap-4"><View className="h-8 w-40 rounded-full bg-sm-surface-raised" /><MediaCardRowSkeleton /></View>
    if (!details) return null
    return <View className="gap-4">
        {anime.length > 0 && <>
            <Heading>{t("Relations", "Als Anime")}</Heading>
            <MediaCardRow data={anime} keyOf={card => card.key} renderCard={(card, width) => <RelatedCard card={card} width={width} />} />
        </>}
        {recommendations.length > 0 && <>
            <Heading>{t("Recommendations", "Empfehlungen")}</Heading>
            <MediaCardRow data={recommendations} keyOf={card => card.key} renderCard={(card, width) => <RelatedCard card={card} width={width} />} />
        </>}
    </View>
}
