import type { AL_AnimeDetailsById_Media, AL_MangaDetailsById_Media } from "@/api/generated/types"
import { Text } from "@/components/ui/text/text"
import { useTr } from "@/lib/app-language"
import { openInAppBrowser } from "@/lib/helpers/browser"
import { getImageUrl } from "@/lib/server/assets"
import { Image } from "expo-image"
import Heart from "lucide-react-native/icons/heart"
import React from "react"
import { Pressable, View } from "react-native"

/*
 * Characters of an anime or manga (media-entry-characters-section.tsx with mobile-anime.css): the main and supporting
 * characters, at most 10, two to a row: a 48dp round picture, the name (opens the character on AniList), age and role.
 */
export function MediaEntryCharactersSection({ details, loading }: {
    details: AL_AnimeDetailsById_Media | AL_MangaDetailsById_Media | undefined
    loading?: boolean
}) {
    const t = useTr()
    const characters = React.useMemo(() => details?.characters?.edges?.filter(n => n.role === "MAIN" || n.role === "SUPPORTING") || [],
        [details?.characters?.edges])

    if (loading && !details) return <DetailsSkeleton />
    if (characters.length === 0) return null

    const role = (value?: string) => value === "MAIN" ? t("Main", "Hauptfigur") : value === "SUPPORTING" ? t("Supporting", "Nebenfigur")
        : value === "BACKGROUND" ? t("Background", "Hintergrund") : value

    return <View className="gap-4">
        <Text accessibilityRole="header" className="mt-5 text-[20px] font-bold leading-[27px] tracking-[-0.3px]">{t("Characters", "Figuren")}</Text>
        <View className="flex-row flex-wrap" style={{ rowGap: 8, columnGap: 8 }}>
            {characters.slice(0, 10).map(edge => {
                const node = edge.node
                return <View key={node?.id} className="min-w-0 flex-row gap-2.5 p-1" style={{ width: "48.5%" }}>
                    <View className="h-12 w-12 overflow-hidden rounded-full bg-sm-surface-raised">
                        {!!node?.image?.large && <Image source={getImageUrl(node.image.large)} contentFit="cover" style={{ position: "absolute", inset: 0 }}
                            accessibilityLabel={node?.name?.full || t("Character", "Figur")} />}
                    </View>
                    <View className="min-w-0 flex-1">
                        <Pressable accessibilityRole="link" disabled={!node?.siteUrl} onPress={() => node?.siteUrl && openInAppBrowser(node.siteUrl)}>
                            <Text numberOfLines={2} className="text-[12.8px] font-semibold leading-[17.6px]">{node?.name?.full}</Text>
                        </Pressable>
                        {!!node?.age && <Text className="text-xs leading-[16.2px]">{node.age} {t("years old", "Jahre alt")}</Text>}
                        <Text className="text-xs leading-[16.2px] text-sm-text-subtle">{role(edge.role)}</Text>
                        {!!node?.isFavourite && <Heart size={16} color="#db2777" fill="#db2777" />}
                    </View>
                </View>
            })}
        </View>
    </View>
}

/** Bones while the details load (MediaEntryDetailsSkeleton): a heading and two rows of characters */
export function DetailsSkeleton() {
    return <View className="mt-5 gap-4">
        <View className="h-6 w-32 rounded-full bg-sm-surface-raised" />
        <View className="flex-row flex-wrap gap-2">
            {[0, 1, 2, 3].map(i => <View key={i} className="flex-row items-center gap-2.5 p-1" style={{ width: "48.5%" }}>
                <View className="h-12 w-12 rounded-full bg-sm-surface-raised" />
                <View className="h-4 flex-1 rounded-full bg-sm-surface-raised" />
            </View>)}
        </View>
    </View>
}
