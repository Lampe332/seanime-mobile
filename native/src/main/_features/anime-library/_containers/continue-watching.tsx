import type { Anime_Episode, Continuity_WatchHistory } from "@/api/generated/types"
import { getEpisodeMinutesRemaining, getEpisodePercentageComplete, useGetContinuityWatchHistory } from "@/api/hooks/continuity.hooks"
import { SectionTitle, Text } from "@/components/ui/text/text"
import { useTr } from "@/lib/app-language"
import { getSpoilerFreeAnimeImage, useContinueWatchingSpoilers, useEpisodeSpoilerState } from "@/lib/theme/anime-spoilers"
import { colors } from "@/lib/theme/tokens"
import { useThemeSettings } from "@/lib/theme/theme-hooks"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { FlashList } from "@shopify/flash-list"
import { Image } from "expo-image"
import { useImageFade } from "@/components/ui/core/image-fade"
import { CirclePlayFilledIcon } from "@/components/shared/legacy-icons"
import React from "react"
import { Pressable, useWindowDimensions, View } from "react-native"
import { useRouter } from "@/lib/navigation"
import { usePlayNext } from "@/main/_atoms/playback.atoms"
import { resumeHomeEpisode } from "@/main/_features/home/home-playback"
import { IN_APP_PLAYER_READY } from "@/main/_features/player/player-availability"

/*
 * Android Home's resume row (continue-watching.tsx + the home variant of episode-card.tsx, home-mobile.css): the scene
 * image itself is the card, min(86vw, 22rem) wide and at least 13.5rem tall, the anime's title and the episode on a dark
 * scrim, one "Continue" pill; the watch progress as a thin line at the foot.
 *
 * A tap resumes (home-playback.ts): it opens the anime page; with the player (E3, IN_APP_PLAYER_READY) it also sends the
 * play-next request that makes the page start the episode. Until then the page only opens, nothing plays.
 */
export function ContinueWatching({ episodes }: { episodes: Anime_Episode[] }) {
    const t = useTr()
    const ts = useThemeSettings()
    const spoilerActive = useContinueWatchingSpoilers(ts)
    const { data: watchHistory } = useGetContinuityWatchHistory()
    const { width } = useWindowDimensions()
    const tileWidth = Math.round(Math.min(width * 0.86, 352))

    return (
        // 2.0.32 left 24dp more under the tiles (pb-6) than between the other rows; r16 (Nick 10.11., on purpose unlike 2.0.32/2.0.33):
        // the same rhythm as every Home row
        <View accessibilityLabel={t("Continue watching", "Weiterschauen")} className="gap-3 pt-3">
            <SectionTitle>{t("Continue watching", "Weiterschauen")}</SectionTitle>
            {episodes.length ? (
                <FlashList
                    horizontal
                    data={episodes}
                    keyExtractor={episode => `${episode.baseAnime?.id}-${episode.episodeNumber}-${episode.localFile?.path || ""}`}
                    renderItem={({ item }) => <ResumeTile episode={item} width={tileWidth} spoilerActive={spoilerActive} watchHistory={watchHistory} />}
                    ItemSeparatorComponent={() => <View style={{ width: 12 }} />}
                    showsHorizontalScrollIndicator={false}
                    snapToInterval={tileWidth + 12}
                    snapToAlignment="start"
                    decelerationRate="fast"
                    style={{ marginHorizontal: -16 }}
                    contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 4 }}
                />
            ) : (
                <View className="rounded-surface bg-sm-surface p-5">
                    <Text className="text-sm-text-muted">{t("No episodes to continue. Choose a series from your library.", "Keine Folge zum Fortsetzen. Wähle eine Serie aus deiner Bibliothek.")}</Text>
                </View>
            )}
        </View>
    )
}

const ResumeTile = React.memo(function ResumeTile({ episode, width, spoilerActive, watchHistory }: {
    episode: Anime_Episode
    width: number
    spoilerActive: boolean
    watchHistory: Continuity_WatchHistory | undefined
}) {
    const t = useTr()
    const fade = useImageFade()
    const ts = useThemeSettings()
    const serverStatus = useServerStatus()
    const anime = episode.baseAnime
    const spoiler = useEpisodeSpoilerState(ts, { mediaId: anime?.id, episodeNumber: episode.episodeNumber, spoilerMode: "replace", spoilerActive })
    const image = episode.episodeMetadata?.image || anime?.bannerImage || anime?.coverImage?.extraLarge
    const shown = spoiler.replaceImage ? getSpoilerFreeAnimeImage(anime) || anime?.coverImage?.medium || image : image
    const total = anime?.episodes
    const offset = episode.episodeNumber !== episode.progressNumber ? 1 : 0
    const showTotal = !!total && total > 1
    const length = episode.episodeMetadata?.length
    const percent = getEpisodePercentageComplete(watchHistory, anime?.id || 0, episode.episodeNumber)
    const minutesLeft = getEpisodeMinutesRemaining(watchHistory, anime?.id || 0, episode.episodeNumber)
    const veiled = !!serverStatus?.settings?.anilist?.blurAdultContent && !!anime?.isAdult
    const title = anime?.title?.userPreferred || episode.episodeTitle || ""
    const router = useRouter()
    const { setPlayNext } = usePlayNext()

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !!episode.isInvalid }}
            disabled={!!episode.isInvalid}
            onPress={() => resumeHomeEpisode(episode, IN_APP_PLAYER_READY ? setPlayNext : (_id, ready) => ready(), url => router.push(url))}
            accessibilityLabel={`${t("Continue", "Fortsetzen")}: ${title}, ${t("episode", "Folge")} ${episode.episodeNumber}`}
            // .home-resume-tile: 0 12px 28px -12px black/.7 (an Android elevation shadow drew a light rim the old tile does not have)
            style={{ width, minHeight: 216, boxShadow: "0 12px 28px -12px rgba(0,0,0,0.7)" }}
            className="justify-end overflow-hidden rounded-surface border border-white/5 bg-sm-surface-control"
        >
            {!!shown && (
                <Image
                    source={shown}
                    recyclingKey={`${anime?.id}-${episode.episodeNumber}`}
                    contentFit="cover"
                    blurRadius={veiled ? 24 : 0}
                    transition={fade}
                    style={{ position: "absolute", inset: 0 }}
                    accessibilityIgnoresInvertColors
                />
            )}
            <View
                className="px-4 pb-4 pt-14"
                style={{ backgroundImage: "linear-gradient(180deg, rgba(12,12,14,0) 0%, rgba(12,12,14,0.8) 40%, rgba(12,12,14,0.96) 100%)" }}
            >
                <Text numberOfLines={2} className="text-[15px] font-semibold leading-[21px]">{title}</Text>
                <View className="mt-[3px] flex-row flex-wrap gap-x-2.5 gap-y-1">
                    <Text className="text-[13px] text-sm-text-muted">{t("Episode", "Folge")} {episode.episodeNumber}{showTotal ? ` / ${total! - offset}` : ""}</Text>
                    {!!length && <Text className="text-[13px] text-sm-text-muted">{length} min</Text>}
                    {!!minutesLeft && <Text className="text-[13px] text-sm-text-muted">{minutesLeft} {t("min left", "Min. übrig")}</Text>}
                </View>
                <View className={`mt-3 min-h-11 flex-row items-center gap-[7px] self-start rounded-full py-2 pl-[14px] pr-[18px] ${episode.isInvalid ? "bg-sm-surface-control" : "bg-brand-500"}`}>
                    <CirclePlayFilledIcon size={16} color={episode.isInvalid ? colors.smTextMuted : "#ffffff"} />
                    <Text className={`text-[13px] font-bold ${episode.isInvalid ? "text-sm-text-muted" : "text-white"}`}>
                        {episode.isInvalid ? t("Unavailable", "Nicht verfügbar") : t("Continue", "Fortsetzen")}
                    </Text>
                </View>
            </View>
            {!!serverStatus?.settings?.library?.enableWatchContinuity && !!percent && (
                <View className="absolute bottom-0 left-0 h-1 w-full bg-white/10">
                    <View style={{ width: `${Math.min(100, percent)}%` }} className="h-full bg-brand-500" />
                </View>
            )}
        </Pressable>
    )
})
