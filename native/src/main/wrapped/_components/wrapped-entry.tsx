import { useGetRawAnimeCollection } from "@/api/hooks/anilist.hooks"
import { useGetRawAnilistMangaCollection } from "@/api/hooks/manga.hooks"
import { Text } from "@/components/ui/text/text"
import { useTr } from "@/lib/app-language"
import { useRouter } from "@/lib/navigation"
import { useThemeColors } from "@/lib/theme/appearance"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { wrappedYears } from "@/main/lists/_lib/wrapped"
import ChevronRight from "lucide-react-native/icons/chevron-right"
import Sparkles from "lucide-react-native/icons/sparkles"
import React from "react"
import { Pressable, View } from "react-native"

/** The way into "Your year" on the stats: the newest year with a finished title; hidden while there is none */
export function WrappedEntry() {
    const t = useTr()
    const router = useRouter()
    const colors = useThemeColors()
    const serverStatus = useServerStatus()
    const enableManga = !!serverStatus?.settings?.library?.enableManga
    const showAdult = !!serverStatus?.settings?.anilist?.enableAdultContent
    const animeLists = useGetRawAnimeCollection().data?.MediaListCollection?.lists
    const mangaLists = useGetRawAnilistMangaCollection().data?.MediaListCollection?.lists
    const year = React.useMemo(() => wrappedYears(animeLists, enableManga ? mangaLists : undefined, { showAdult })[0],
        [animeLists, mangaLists, enableManga, showAdult])
    if (!serverStatus?.user || year === undefined) return null

    const title = t("See your year", "Dein Jahr ansehen")
    const text = t(`What you finished in ${year}`, `Was du ${year} abgeschlossen hast`)
    return (
        <Pressable accessibilityRole="link" accessibilityLabel={`${title}, ${text}`} onPress={() => router.push("/wrapped")}
            className="min-h-[72px] flex-row items-center gap-3 rounded-surface bg-sm-surface-raised px-4 py-3 active:bg-sm-surface-control">
            <View className="size-10 items-center justify-center rounded-surface-sm bg-sm-surface-control">
                <Sparkles size={20} color={colors.smAccent} />
            </View>
            <View className="min-w-0 flex-1 gap-0.5">
                <Text numberOfLines={1} className="text-[15px] font-semibold">{title}</Text>
                <Text numberOfLines={2} className="text-[13px] text-sm-text-muted">{text}</Text>
            </View>
            <ChevronRight size={20} color={colors.smTextMuted} />
        </Pressable>
    )
}
