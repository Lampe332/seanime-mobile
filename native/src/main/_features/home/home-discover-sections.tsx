import type { Anime_UpcomingEpisode } from "@/api/generated/types"
import { useAnilistListAnime } from "@/api/hooks/anilist.hooks"
import { useGetUpcomingEpisodes } from "@/api/hooks/anime_entries.hooks"
import { useCoverFlightSource } from "@/components/shared/cover-flight"
import { SectionTitle, Text } from "@/components/ui/text/text"
import { useTr } from "@/lib/app-language"
import { getImageUrl } from "@/lib/server/assets"
import { getSpoilerFreeAnimeImage, useEpisodeSpoilerState, useMissingEpisodeSpoilers } from "@/lib/theme/anime-spoilers"
import { useThemeSettings } from "@/lib/theme/theme-hooks"
import { colors } from "@/lib/theme/tokens"
import { useThemeColors } from "@/lib/theme/appearance"
import { useTabletLayout } from "@/lib/use-tablet-ui"
import { useMediaPreviewModal } from "@/main/_features/media/_containers/media-preview-phone"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { CAROUSEL_AUTOPLAY_MS, nextCarouselPlace } from "@/lib/motion"
import { FlashList, type FlashListRef } from "@shopify/flash-list"
import { addSeconds } from "date-fns/addSeconds"
import { formatDistanceToNow } from "date-fns/formatDistanceToNow"
import { Image } from "expo-image"
import { useImageFade } from "@/components/ui/core/image-fade"
import { useIsFocused } from "expo-router"
import React from "react"
import { Pressable, useWindowDimensions, View } from "react-native"
import { useReducedMotion } from "react-native-reanimated"

/** The trending title the header shows changes every 12 s, among the first 12 that are out (discover-trending.tsx). */
const FEATURE_ROTATE_MS = 12_000
const FEATURE_COUNT = 12

/**
 * Home's vertical scroll is moving (home-screen.tsx spreads these on its ScrollView): the header's next title and the
 * carousel's next card wait for the next tick, so no new picture is decoded and uploaded in the middle of a swipe.
 */
const homeScroll = { moving: false }
export const homeScrollHandlers = {
    onScrollBeginDrag: () => { homeScroll.moving = true },
    onScrollEndDrag: () => { homeScroll.moving = false },
    onMomentumScrollBegin: () => { homeScroll.moving = true },
    onMomentumScrollEnd: () => { homeScroll.moving = false },
}

/**
 * Home's "Discover header" when it is the first section (discover-page-header.tsx + home-mobile.css `.home-discover-card`):
 * a trending title's own picture as the card, 16:9 up to 16rem (tablet 21:9 up to 22rem), its name on a neutral scrim and
 * one "Preview" action; a tap opens its preview.
 */
export function HomeDiscoverFeature() {
    const t = useTr()
    const { rail } = useTabletLayout()
    const { setPreviewModalMediaId } = useMediaPreviewModal()
    const { data } = useAnilistListAnime({ page: 1, perPage: 20, sort: ["TRENDING_DESC"] }, true)
    const released = React.useMemo(() => (data?.Page?.media ?? []).filter(Boolean).filter(media => media.status !== "NOT_YET_RELEASED").slice(0, FEATURE_COUNT), [data])
    const [index, setIndex] = React.useState(0)
    // only while Home is in front: a visited tab stays mounted, and turning a card nobody sees re-renders and redraws it
    const focused = useIsFocused()
    // "Scroll carousels automatically" off (settings → Appearance) keeps the first title
    const autoScroll = !useThemeSettings().disableCarouselAutoScroll
    React.useEffect(() => {
        if (!focused || !autoScroll || released.length < 2) return
        const timer = setInterval(() => {
            if (!homeScroll.moving) setIndex(i => (i + 1) % released.length)
        }, FEATURE_ROTATE_MS)
        return () => clearInterval(timer)
    }, [focused, autoScroll, released.length])
    const media = released[index % Math.max(1, released.length)]
    // CSS keeps the full width and caps the height (aspect-ratio + max-height); RN's aspectRatio would narrow the card instead
    const [width, setWidth] = React.useState(0)
    const height = Math.min(width / (rail ? 21 / 9 : 16 / 9), rail ? 352 : 256)

    if (!media) return <View accessibilityRole="progressbar" accessibilityLabel={t("Featured", "Im Fokus")} className="my-3 h-48 rounded-xl bg-sm-surface-raised" />
    const image = media.bannerImage || media.coverImage?.extraLarge
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t("Trending now", "Gerade im Trend")}: ${media.title?.userPreferred ?? ""}, ${t("Preview", "Vorschau")}`}
            onPress={() => setPreviewModalMediaId(media.id, "anime")}
            onLayout={event => setWidth(event.nativeEvent.layout.width)}
            style={{ height: height || undefined, minHeight: 192 }}
            className="my-3 w-full justify-end rounded-surface bg-sm-surface-control active:opacity-90"
        >
            {/* no clipping frame: the picture and the scrim round themselves (rounded-surface, 16dp) */}
            {!!image && <Image source={getImageUrl(image)} recyclingKey={String(media.id)} cachePolicy="memory-disk" contentFit="cover"
                transition={{ duration: 320, effect: "cross-dissolve" }}
                style={{ position: "absolute", inset: 0, borderRadius: 16 }} accessibilityIgnoresInvertColors />}
            <View className="items-start gap-1 rounded-b-[16px] px-4 pb-4 pt-12"
                style={{ backgroundImage: "linear-gradient(180deg, rgba(12,12,14,0), rgba(12,12,14,0.82) 45%, rgba(12,12,14,0.94))" }}>
                <Text className="text-[13px] text-sm-text-muted">{t("Trending now", "Gerade im Trend")}</Text>
                <Text numberOfLines={2} className="text-lg font-bold leading-[23px]">{media.title?.userPreferred}</Text>
                <View className="mt-2 min-h-11 justify-center rounded-full bg-brand-500 px-4">
                    <Text className="text-[13px] font-semibold text-white">{t("Preview", "Vorschau")}</Text>
                </View>
            </View>
        </Pressable>
    )
}

/**
 * Upcoming episodes of the user's anime list (upcoming-episodes.tsx), only while the library has entries: one wide card per
 * show (tablet 22rem), its picture dimmed, the anime, the episode and when it airs; a tap opens the anime page. Like the
 * web carousel's autoplay it moves one card on every 5 s while Home is shown, back to the first after the last; a swipe
 * restarts the wait. Off with "Scroll carousels automatically" off and with reduced motion; "Smaller episode cards" narrows them.
 */
export function LibraryUpcomingEpisodes({ hasEntries }: { hasEntries: boolean }) {
    const t = useTr()
    const { data, isError, refetch } = useGetUpcomingEpisodes()
    const { width } = useWindowDimensions()
    const { rail } = useTabletLayout()
    const ts = useThemeSettings()
    const spoilerActive = useMissingEpisodeSpoilers(ts)
    const episodes = data?.episodes ?? []
    // "Smaller episode cards" (settings → Appearance): about three quarters wide, so the next card shows beside it
    const cardWidth = ts.smallerEpisodeCarouselSize ? (rail ? 264 : Math.round((width - 32) * 0.72)) : (rail ? 352 : width - 32)
    const list = React.useRef<FlashListRef<Anime_UpcomingEpisode>>(null)
    const [listWidth, setListWidth] = React.useState(0)
    const step = cardWidth + 16
    // snap places: the last one shows the last card at the row's end
    const visible = listWidth > 0 ? Math.max(1, Math.floor((listWidth - 32 + 16) / step)) : 1
    const autoplay = useCarouselAutoplay(hasEntries && !ts.disableCarouselAutoScroll ? Math.max(0, episodes.length - visible + 1) : 0,
        place => list.current?.scrollToOffset({ offset: place * step, animated: true }))
    if (!hasEntries || !episodes.length) {
        // still loading: nothing yet; loaded and empty: say why instead of leaving the section out without a word
        if (hasEntries && !data && !isError) return null
        return (
            <View className="gap-3">
                <SectionTitle>{t("Upcoming episodes", "Kommende Folgen")}</SectionTitle>
                <View className="rounded-surface bg-sm-surface p-5">
                    <Text accessibilityRole={isError ? "alert" : undefined} className="text-sm-text-muted">{isError
                        ? t("Upcoming episodes could not load.", "Kommende Folgen konnten nicht geladen werden.")
                        : t("No upcoming episodes. They show for anime in your library that are still airing.", "Keine kommenden Folgen. Sie erscheinen für Anime in deiner Bibliothek, die noch laufen.")}</Text>
                    {isError && <Pressable accessibilityRole="button" onPress={() => void refetch()} className="mt-2 min-h-11 justify-center self-start">
                        <Text className="text-sm font-semibold text-sm-accent">{t("Try again", "Erneut versuchen")}</Text>
                    </Pressable>}
                </View>
            </View>
        )
    }
    return (
        <View className="gap-3">
            <View>
                <SectionTitle>{t("Upcoming episodes", "Kommende Folgen")}</SectionTitle>
                <Text className="text-sm-text-muted">{t("Based on your anime list", "Aus deiner Anime-Liste")}</Text>
            </View>
            <FlashList
                ref={list}
                horizontal
                data={episodes}
                keyExtractor={item => String(item.mediaId)}
                renderItem={({ item }) => <UpcomingCard item={item} width={cardWidth} spoilerActive={spoilerActive} />}
                ItemSeparatorComponent={Gap}
                showsHorizontalScrollIndicator={false}
                onLayout={event => setListWidth(event.nativeEvent.layout.width)}
                onScrollBeginDrag={autoplay.onTouch}
                onMomentumScrollEnd={event => autoplay.onSettled(Math.round(event.nativeEvent.contentOffset.x / step))}
                snapToInterval={step}
                snapToAlignment="start"
                decelerationRate="fast"
                style={{ marginHorizontal: -16 }}
                contentContainerStyle={{ paddingHorizontal: 16 }}
            />
        </View>
    )
}

function Gap() {
    return <View style={{ width: 16 }} />
}

/**
 * embla-carousel-autoplay (delay 5000, stopOnInteraction false): every CAROUSEL_AUTOPLAY_MS one place on (nextCarouselPlace)
 * while the screen is focused; a touch restarts the wait, a swipe's end is the new place. The scroll itself is the list's own
 * animated scroll (native, off the JS thread).
 */
function useCarouselAutoplay(places: number, scrollTo: (place: number) => void) {
    const focused = useIsFocused()
    const reduceMotion = useReducedMotion()
    const place = React.useRef(0)
    const [restart, setRestart] = React.useState(0)
    const go = React.useEffectEvent(() => {
        if (homeScroll.moving) return
        place.current = nextCarouselPlace(place.current, places)
        scrollTo(place.current)
    })
    React.useEffect(() => {
        if (!focused || reduceMotion || places < 2) return
        const timer = setInterval(go, CAROUSEL_AUTOPLAY_MS)
        return () => clearInterval(timer)
    }, [focused, reduceMotion, places, restart])
    return {
        onTouch: () => setRestart(n => n + 1),
        onSettled: (at: number) => {
            place.current = Math.max(0, Math.min(places - 1, at))
        },
    }
}

/** The card shows its still dimmed over sm-surface */
const UPCOMING_LOOK = { opacity: 0.5, get ground() { return colors.smSurface } }

const UpcomingCard = React.memo(function UpcomingCard({ item, width, spoilerActive }: { item: Anime_UpcomingEpisode, width: number, spoilerActive: boolean }) {
    useThemeColors()
    const t = useTr()
    const fade = useImageFade()
    const ts = useThemeSettings()
    const serverStatus = useServerStatus()
    const anime = item.baseAnime
    const spoiler = useEpisodeSpoilerState(ts, { mediaId: item.mediaId, episodeNumber: item.episodeNumber, spoilerMode: "replace", spoilerActive })
    const image = item.episodeMetadata?.image || anime?.bannerImage || anime?.coverImage?.large
    const shown = spoiler.replaceImage ? anime?.bannerImage || anime?.coverImage?.extraLarge || getSpoilerFreeAnimeImage(anime) || image : image
    const veiled = !!serverStatus?.settings?.anilist?.blurAdultContent && !!anime?.isAdult
    const title = anime?.title?.userPreferred ?? ""
    const when = formatDistanceToNow(addSeconds(new Date(), item.timeUntilAiring ?? 0), { addSuffix: true })
    // the still narrows into the page's cover and cross-fades into it (cover-flight.tsx); a blurred one does not fly
    const shownUri = shown ? getImageUrl(shown) : ""
    const { coverRef, onLoad, hidden, open } = useCoverFlightSource(item.mediaId, veiled ? "" : shownUri,
        getImageUrl(anime?.coverImage?.extraLarge || anime?.coverImage?.large || ""), UPCOMING_LOOK)
    return (
        <Pressable accessibilityRole="link" accessibilityLabel={`${title}, ${t(`Episode ${item.episodeNumber}`, `Folge ${item.episodeNumber}`)}, ${when}`}
            onPress={() => open(`/entry?id=${item.mediaId}`)} style={{ width }} className="gap-2 active:opacity-85">
            <View ref={coverRef} collapsable={false} className="aspect-[2/1] w-full rounded-xl bg-sm-surface">
                {!!shownUri && <Image source={shownUri} contentFit="cover" blurRadius={veiled ? 24 : 0} recyclingKey={String(item.mediaId)}
                    cachePolicy="memory-disk" transition={fade} onLoad={onLoad}
                    style={{ position: "absolute", inset: 0, borderRadius: 12, opacity: hidden ? 0 : UPCOMING_LOOK.opacity }} accessibilityIgnoresInvertColors />}
            </View>
            <View>
                <Text numberOfLines={1} className="w-[80%] text-base font-semibold">{title}</Text>
                <View className="flex-row items-center justify-between gap-2">
                    <Text numberOfLines={1} className="shrink text-base font-medium">{`Episode ${item.episodeNumber}`}</Text>
                    <Text numberOfLines={2} className="text-right text-sm text-sm-text-muted">{when}</Text>
                </View>
            </View>
        </Pressable>
    )
})
