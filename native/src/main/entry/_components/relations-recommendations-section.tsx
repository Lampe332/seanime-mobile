import type { AL_AnimeDetailsById_Media, AL_BaseAnime, AL_BaseManga, Anime_Entry, Nullish } from "@/api/generated/types"
import { Text } from "@/components/ui/text/text"
import { type Translate, useTr } from "@/lib/app-language"
import { MediaCardRow, MediaCardRowSkeleton } from "@/main/_features/media/_components/media-card-row"
import { MediaEntryCard } from "@/main/_features/media/_components/media-entry-card"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { useDiscoverEntry } from "@/main/discover/_lib/discover-phone-hooks"
import capitalize from "lodash/capitalize"
import React from "react"
import { View } from "react-native"

/*
 * Relations and recommendations of an anime (relations-recommendations-section.tsx with mobile-anime.css): the source
 * manga (with manga on), up to four related anime with their relation as a dark label top right, then the
 * recommendations, each a swipeable row of cover cards with the user's progress like on Home. A tap opens the anime's
 * page, the source manga's card the manga page.
 */

const RELATION_LABELS: Record<string, [string, string]> = {
    ADAPTATION: ["Adaptation", "Adaption"],
    PREQUEL: ["Prequel", "Vorgänger"],
    SEQUEL: ["Sequel", "Fortsetzung"],
    PARENT: ["Parent story", "Hauptgeschichte"],
    SIDE_STORY: ["Side story", "Nebengeschichte"],
    CHARACTER: ["Same characters", "Gleiche Figuren"],
    SUMMARY: ["Summary", "Zusammenfassung"],
    ALTERNATIVE: ["Alternative", "Alternative"],
    SPIN_OFF: ["Spin-off", "Spin-off"],
    OTHER: ["Other", "Sonstiges"],
    SOURCE: ["Source", "Vorlage"],
    COMPILATION: ["Compilation", "Zusammenschnitt"],
    CONTAINS: ["Contains", "Enthält"],
}

/** The relation as a label; a type this list does not know keeps its English form. */
export function relationLabel(t: Translate, type: string | null | undefined) {
    const known = RELATION_LABELS[type ?? ""]
    return known ? t(known[0], known[1]) : capitalize(type || "").replace("_", " ")
}

export type RelatedCardData = { key: string, media: AL_BaseAnime | AL_BaseManga, type: "anime" | "manga", label?: string }
type Card = RelatedCardData

export function RelationsRecommendationsSection({ entry, details, loading }: {
    entry: Nullish<Anime_Entry>
    details: Nullish<AL_AnimeDetailsById_Media>
    loading?: boolean
}) {
    const t = useTr()
    const serverStatus = useServerStatus()
    const edges = details?.relations?.edges

    const relations = React.useMemo(() => {
        const sourceManga = serverStatus?.settings?.library?.enableManga
            ? edges?.find(edge => (edge?.relationType === "SOURCE" || edge?.relationType === "ADAPTATION") && edge?.node?.format === "MANGA")?.node
            : undefined
        const anime = (edges ?? []).filter(Boolean)
            .filter(n => n.node?.format !== "MANGA" && n.node?.format !== "ONE_SHOT" && n.node?.format !== "NOVEL" && n.node?.format !== "MUSIC" && n.relationType !== "CHARACTER")
            .slice(0, 4)
        return [
            ...(sourceManga ? [{ key: `manga-${sourceManga.id}`, media: sourceManga as AL_BaseManga, type: "manga", label: t("Manga", "Manga") } satisfies Card] : []),
            ...anime.filter(edge => !!edge.node).map(edge => ({
                key: `anime-${edge.node!.id}`,
                media: edge.node as AL_BaseAnime,
                type: "anime",
                label: edge.node?.format === "MOVIE" ? `${relationLabel(t, edge.relationType)} (${t("Movie", "Film")})` : relationLabel(t, edge.relationType),
            } satisfies Card)),
        ]
    }, [edges, serverStatus?.settings?.library?.enableManga, t])

    const recommendations = React.useMemo(() => (details?.recommendations?.edges?.map(edge => edge?.node?.mediaRecommendation)?.filter(Boolean) || [])
        .map(media => ({ key: `rec-${media.id}`, media: media as AL_BaseAnime, type: "anime" } satisfies Card)), [details?.recommendations?.edges])

    if (loading && !details) return <View className="gap-4"><View className="h-8 w-40 rounded-full bg-sm-surface-raised" /><MediaCardRowSkeleton /></View>
    if (!entry || !details) return null

    return <View className="gap-4">
        {relations.length > 0 && <>
            <Heading>{t("Relations", "Verwandte Titel")}</Heading>
            <MediaCardRow data={relations} keyOf={card => card.key} renderCard={(card, width) => <RelatedCard card={card} width={width} />} />
        </>}
        {recommendations.length > 0 && <>
            <Heading>{t("Recommendations", "Empfehlungen")}</Heading>
            <MediaCardRow data={recommendations} keyOf={card => card.key} renderCard={(card, width) => <RelatedCard card={card} width={width} />} />
        </>}
    </View>
}

/**
 * The page's h2 (globals.css: text-3xl, bold, tight); the manga page uses it too. No margin of its own: in 2.0.32 the
 * first one is `first:mt-0` and the next sits `space-y-4` below the row, so the parent's gap is the whole distance.
 */
export function Heading({ children }: { children: string }) {
    return <Text accessibilityRole="header" className="text-[30px] font-bold leading-[36px] tracking-[-0.75px]">{children}</Text>
}

/** A cover card with the user's list entry and library data, and the relation as a label top right */
export function RelatedCard({ card, width }: { card: RelatedCardData, width: number }) {
    const { listData, libraryData } = useDiscoverEntry(card.type, card.media.id)
    return <MediaEntryCard media={card.media} type={card.type} width={width} listData={listData} libraryData={libraryData} showLibraryBadge={card.type === "anime"}
        // the relation label takes the corner of the airing mark (2.0.33 shows only the label there)
        hideReleasingBadge={!!card.label} seasonTop={5}
        overlay={card.label ? <View className="absolute right-1.5 top-1.5 max-w-[85%] rounded-full bg-[rgba(12,12,14,0.82)] px-2.5 py-1">
            <Text numberOfLines={1} className="text-[13px] font-semibold text-white">{card.label}</Text>
        </View> : undefined} />
}
