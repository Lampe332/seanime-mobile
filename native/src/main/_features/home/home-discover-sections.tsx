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
    React.useEffect(() => {
        if (!focused || released.length < 2) return
        const timer = setInterval(() => setIndex(i => (i + 1) % released.length), FEATURE_ROTATE_MS)
        return () => clearInterval(timer)
    }, [focused, released.length])
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
            className="my-3 w-full justify-end overflow-hidden rounded-surface bg-sm-surface-control active:opacity-90"
        >
            {!!image && <Image source={getImageUrl(image)} contentFit="cover" transition={{ duration: 320, effect: "cross-dissolve" }}
                style={{ position: "absolute", inset: 0 }} accessibilityIgnoresInvertColors />}
            <View className="items-start gap-1 px-4 pb-4 pt-12"
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
 * restarts the wait. Off with the theme's "disable carousel auto scroll" and with reduced motion.
 */
export function LibraryUpcomingEpisodes({ hasEntries }: { hasEntries: boolean }) {
    const { data } = useGetUpcomingEpisodes()
    const { width } = useWindowDimensions()
    const { rail } = useTabletLayout()
    const ts = useThemeSettings()
    const spoilerActive = useMissingEpisodeSpoilers(ts)
    const episodes = data?.episodes ?? []
    const cardWidth = rail ? 352 : width - 32
    const list = React.useRef<FlashListRef<Anime_UpcomingEpisode>>(null)
    const [listWidth, setListWidth] = React.useState(0)
    const step = cardWidth + 16
    // snap places: the last one shows the last card at the row's end
    const visible = listWidth > 0 ? Math.max(1, Math.floor((listWidth - 32 + 16) / step)) : 1
    const autoplay = useCarouselAutoplay(hasEntries && !ts.disableCarouselAutoScroll ? Math.max(0, episodes.length - visible + 1) : 0,
        place => list.current?.scrollToOffset({ offset: place * step, animated: true }))
    if (!hasEntries || !episodes.length) return null
    return (
        <View className="gap-3">
            {/* The section's words are English in 2.0.33 as well */}
            <View>
                <SectionTitle>Upcoming episodes</SectionTitle>
                <Text className="text-sm-text-muted">Based on your anime list</Text>
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
                snapToInterval={cardWidth + 16}
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
const UPCOMING_LOOK = { opacity: 0.5, ground: colors.smSurface }

const UpcomingCard = React.memo(function UpcomingCard({ item, width, spoilerActive }: { item: Anime_UpcomingEpisode, width: number, spoilerActive: boolean }) {
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
        <Pressable accessibilityRole="link" accessibilityLabel={`${title}, ${t("Episode", "Folge")} ${item.episodeNumber}, ${when}`}
            onPress={() => open(`/entry?id=${item.mediaId}`)} style={{ width }} className="gap-2 active:opacity-85">
            <View ref={coverRef} collapsable={false} className="aspect-[2/1] w-full overflow-hidden rounded-xl bg-sm-surface">
                {!!shownUri && <Image source={shownUri} contentFit="cover" blurRadius={veiled ? 24 : 0} recyclingKey={String(item.mediaId)}
                    transition={fade} onLoad={onLoad}
                    style={{ position: "absolute", inset: 0, opacity: hidden ? 0 : UPCOMING_LOOK.opacity }} accessibilityIgnoresInvertColors />}
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
