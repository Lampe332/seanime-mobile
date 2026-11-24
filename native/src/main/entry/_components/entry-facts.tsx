import { Text } from "@/components/ui/text/text"
import { cn } from "@/components/ui/core/styling"
import { useTr } from "@/lib/app-language"
import { useRouter } from "@/lib/navigation"
import { colors } from "@/lib/theme/tokens"
import { genreLabel } from "@/main/discover/_lib/discover-phone"
import { type Ranking, rankingBadges, rankingLabel } from "@/main/entry/_lib/anime-meta"
import ChevronRight from "lucide-react-native/icons/chevron-right"
import Clapperboard from "lucide-react-native/icons/clapperboard"
import Heart from "lucide-react-native/icons/heart"
import Star from "lucide-react-native/icons/star"
import React from "react"
import { Pressable, View } from "react-native"

export type FactsStudio = { id: number, name: string }

/**
 * Under the title of an anime or manga page: the studios (anime; open their page), AniList ranking badges, the genres
 * (open a search for one in the page's kind). Studios and badges come with the details; until then a placeholder keeps
 * the row's height.
 */
export const EntryFacts = React.memo(function EntryFacts({ kind, studios, rankings, genres, loading, wide }: {
    kind: "anime" | "manga"
    studios?: FactsStudio[]
    rankings?: Ranking[] | null
    genres: readonly string[]
    /** the details are still on their way */
    loading: boolean
    wide: boolean
}) {
    const t = useTr()
    const router = useRouter()
    const badges = React.useMemo(() => rankingBadges(rankings), [rankings])
    const shownStudios = studios ?? []
    const top = loading || shownStudios.length > 0 || badges.length > 0
    if (!top && !genres.length) return null
    const searchType = kind === "manga" ? "type=manga&" : ""
    // wide: the header has no gap (tablet.css page grid), so the block keeps its own 1rem
    return <View className="gap-2.5" style={wide ? { marginTop: 16 } : undefined}>
        {top && <View className="min-h-10 flex-row flex-wrap items-center gap-2">
            {loading ? <View className="h-10 w-36 rounded-full bg-sm-surface-raised"
                accessibilityLabel={kind === "anime" ? t("Loading studio", "Studio lädt") : t("Loading rankings", "Platzierungen laden")} />
                : <>
                    {shownStudios.map(s => <Pressable key={s.id} hitSlop={4} accessibilityRole="button" accessibilityLabel={t(`Studio ${s.name}, show its anime`, `Studio ${s.name}, Anime anzeigen`)}
                        onPress={() => router.push(`/studio?id=${s.id}&name=${encodeURIComponent(s.name)}`)}
                        className="min-h-10 max-w-full flex-row items-center gap-1.5 rounded-full bg-sm-accent-softer pl-3 pr-2 active:opacity-70">
                        <Clapperboard size={15} color={colors.smAccent} />
                        <Text numberOfLines={1} className="shrink text-[13px] font-semibold text-sm-text">{s.name}</Text>
                        <ChevronRight size={15} color={colors.smTextMuted} />
                    </Pressable>)}
                    {/* wide: a little tighter, so two badges share a row of the left column */}
                    {badges.map(b => <View key={b.type} className={cn("min-h-8 flex-row items-center gap-1.5 rounded-full border border-sm-line", wide ? "px-2.5" : "px-3")}>
                        {b.type === "POPULAR" ? <Heart size={13} color={colors.smAccent} fill={colors.smAccent} /> : <Star size={13} color={colors.smWarning} fill={colors.smWarning} />}
                        <Text className={cn("font-semibold text-sm-text-muted", wide ? "text-[12px]" : "text-[13px]")}>{rankingLabel(t, b)}</Text>
                    </View>)}
                </>}
        </View>}
        {genres.length > 0 && <View className="flex-row flex-wrap gap-2">
            {genres.map(g => {
                const label = genreLabel(t, g)
                return <Pressable key={g} hitSlop={4} accessibilityRole="button" accessibilityLabel={t(`Search genre ${label}`, `Genre ${label} suchen`)}
                    onPress={() => router.push(`/search?${searchType}genre=${encodeURIComponent(g)}&at=${Date.now()}`)}
                    className="min-h-9 justify-center rounded-full bg-sm-surface-raised px-3.5 active:bg-sm-surface-control">
                    <Text className="text-[13px] font-semibold text-sm-text-muted">{label}</Text>
                </Pressable>
            })}
        </View>}
    </View>
})
