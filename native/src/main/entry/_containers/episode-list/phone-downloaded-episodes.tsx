import { SectionTitle, Text } from "@/components/ui/text/text"
import { cn } from "@/components/ui/core/styling"
import { useTr } from "@/lib/app-language"
import { useRouter } from "@/lib/navigation"
import { colors } from "@/lib/theme/tokens"
import { showsProgress, stateLabel } from "@/main/android-downloads/_lib/offline-library"
import { useOfflineEpisodes, usePlayOffline } from "@/main/android-downloads/_lib/use-offline"
import { Artwork, PlayMark } from "@/main/android-downloads/_screens/downloads-parts"
import ChevronRight from "lucide-react-native/icons/chevron-right"
import Pause from "lucide-react-native/icons/pause"
import React from "react"
import { Pressable, View } from "react-native"

/*
 * "On this device" (web phone-downloaded-episodes.tsx + .css): the episodes of this anime the Go server saved on the
 * phone (not part of the library scan), above the library episodes. A saved one plays offline in the app's player,
 * "Manage" opens the anime in Downloads. Hidden while nothing is saved or queued.
 */
export function PhoneDownloadedEpisodes({ mediaId }: { mediaId: number }) {
    const t = useTr()
    const router = useRouter()
    const episodes = useOfflineEpisodes(mediaId)
    const play = usePlayOffline()
    if (!episodes.length) return null
    return <View className="gap-3">
        <View className="flex-row items-center justify-between gap-3">
            <SectionTitle>{t("On this device", "Auf diesem Gerät")}</SectionTitle>
            <Pressable accessibilityRole="button" onPress={() => router.push(`/android-downloads?anime=${encodeURIComponent(`media-${mediaId}`)}`)}
                className="-mr-1 min-h-12 flex-row items-center gap-1 px-1 active:opacity-70">
                <Text className="text-[15px] text-sm-accent">{t("Manage", "Verwalten")}</Text>
                <ChevronRight size={18} color={colors.smAccent} />
            </Pressable>
        </View>
        <View className="gap-0.5 overflow-hidden rounded-surface bg-sm-surface">
            {episodes.map(episode => {
                const label = `${t("Episode", "Folge")} ${episode.episode}`
                return <Pressable key={episode.id} accessibilityRole="button" disabled={!episode.ready} onPress={() => play(episode)}
                    accessibilityLabel={episode.ready ? t(`Play episode ${episode.episode} offline`, `Folge ${episode.episode} offline abspielen`) : label}
                    className="min-h-[72px] flex-row items-center gap-3.5 bg-sm-surface-raised px-3 py-2.5 active:bg-sm-surface-control">
                    <View className="aspect-video w-28 overflow-hidden rounded-surface-sm">
                        <Artwork asset={episode.episodeImageAsset || episode.bannerAsset} url={episode.episodeImageUrl || episode.bannerUrl} className="absolute inset-0" iconSize={20} />
                        {episode.ready && <PlayMark size={36} />}
                    </View>
                    <View className="min-w-0 flex-1 gap-0.5">
                        <Text className="text-[13px] text-sm-text-subtle">{label}</Text>
                        <Text className="text-[15px] font-semibold leading-5">{episode.episodeTitle || label}</Text>
                        <View className="flex-row items-center gap-1">
                            {episode.status === "paused" && <Pause size={13} color={colors.smTextMuted} />}
                            <Text className={cn("text-[13px]", episode.ready ? "text-sm-accent" : episode.status === "failed" ? "text-sm-danger" : "text-sm-text-muted")}>
                                {episode.ready ? t("Saved offline", "Offline gespeichert")
                                    : `${stateLabel(episode, t)}${showsProgress(episode) ? ` · ${Math.round(episode.progress)} %` : ""}`}
                            </Text>
                        </View>
                    </View>
                </Pressable>
            })}
        </View>
    </View>
}
