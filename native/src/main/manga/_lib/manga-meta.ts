import type { Translate } from "@/lib/app-language"

/* The manga page's facts under the title and the order of its related manga (manga-entry-page.tsx). */

type FuzzyDate = { year?: number | null } | null | undefined

/**
 * When the manga was published, in years (manga have no seasons): "2017–2020", "2019" within one year, "Since 2019"
 * while it runs or pauses, the start year alone before it starts or when the end is unknown; empty without a start.
 */
export function publishingPeriod(t: Translate, media: { status?: string | null, startDate?: FuzzyDate, endDate?: FuzzyDate }): string {
    const start = media.startDate?.year
    if (!start) return ""
    const running = media.status === "RELEASING" || media.status === "HIATUS"
    const end = running || media.status === "NOT_YET_RELEASED" ? null : media.endDate?.year
    if (running) return t(`Since ${start}`, `Seit ${start}`)
    if (!end || end <= start) return String(start)
    return `${start}–${end}`
}

/** The story's own line first, then what branches off it */
const RELATION_ORDER = ["PREQUEL", "SEQUEL", "PARENT", "SIDE_STORY", "SPIN_OFF", "ALTERNATIVE", "SUMMARY", "COMPILATION", "CONTAINS", "SOURCE", "OTHER"]

type RelationEdge<N> = { relationType?: string | null, node?: N | null } | null | undefined

/**
 * The related manga (and novels, one-shots) of a manga, at most `max`: same characters left out, ordered by
 * RELATION_ORDER (unknown relations last), AniList's order within one relation.
 */
export function mangaRelations<N extends { id: number, type?: string | null }>(edges: readonly RelationEdge<N>[] | null | undefined, max = 8) {
    const rank = (type?: string | null) => {
        const at = RELATION_ORDER.indexOf(type ?? "")
        return at < 0 ? RELATION_ORDER.length : at
    }
    return (edges ?? []).flatMap(edge => edge?.node && edge.node.type !== "ANIME" && edge.relationType !== "CHARACTER"
        ? [{ relationType: edge.relationType ?? null, node: edge.node }] : [])
        .map((edge, index) => ({ edge, index }))
        .sort((a, b) => rank(a.edge.relationType) - rank(b.edge.relationType) || a.index - b.index)
        .slice(0, max)
        .map(({ edge }) => edge)
}
