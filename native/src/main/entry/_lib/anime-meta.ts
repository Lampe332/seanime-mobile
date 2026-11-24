import type { Translate } from "@/lib/app-language"
import { SEASON_LABELS, seasonWithYear } from "@/main/_features/media/_lib/media-labels"

/* The anime page's facts under the title (anime-entry-page.tsx EntryHeader): the airing period and the ranking badges. */

export type Season = "WINTER" | "SPRING" | "SUMMER" | "FALL"

/** AniList's quarters as the app names them: Winter Jan–Mar, Spring Apr–Jun, Summer Jul–Sep, Fall Oct–Dec */
export function seasonOfMonth(month?: number | null): Season | null {
    if (!month || month < 1 || month > 12) return null
    return month <= 3 ? "WINTER" : month <= 6 ? "SPRING" : month <= 9 ? "SUMMER" : "FALL"
}

type FuzzyDate = { year?: number | null, month?: number | null } | null | undefined
type PeriodMedia = {
    status?: string | null
    season?: string | null
    seasonYear?: number | null
    startDate?: FuzzyDate
    endDate?: FuzzyDate
}
/** A point of the period: its season when known, else only its year */
type Point = { year: number, season: Season | null }

function isSeason(value?: string | null): value is Season {
    return !!value && value in SEASON_LABELS
}

function startPoint(media: PeriodMedia): Point | null {
    const year = media.startDate?.year
    const season = seasonOfMonth(media.startDate?.month)
    if (year && season) return { year, season }
    // without a month AniList's own season (with its year) stands in
    if (isSeason(media.season) && (media.seasonYear || year)) return { year: (media.seasonYear || year)!, season: media.season }
    // a title not yet started often has only AniList's year
    const known = year || media.seasonYear
    return known ? { year: known, season: null } : null
}

function endPoint(media: PeriodMedia): Point | null {
    const year = media.endDate?.year
    return year ? { year, season: seasonOfMonth(media.endDate?.month) } : null
}

function pointLabel(t: Translate, point: Point) {
    return point.season ? seasonWithYear(t, point.season, point.year) : String(point.year)
}

const seasonName = (t: Translate, season: Season) => t(...SEASON_LABELS[season])

/**
 * When the anime aired, in seasons: "Winter 2024" within one season, "Spring – Fall 2024" within one year,
 * "Fall 2017 – Spring 2020" over years, "Since Fall 2025" while it runs, the start alone before it starts.
 * Only years where AniList knows no months ("2017–2020"); "Release date TBA" for a title not out yet without any date,
 * else empty when it knows nothing.
 */
export function airingPeriod(t: Translate, media: PeriodMedia): string {
    const start = startPoint(media)
    if (!start) return media.status === "NOT_YET_RELEASED" ? t("Release date TBA", "Termin noch offen") : ""
    const end = media.status === "NOT_YET_RELEASED" ? null : endPoint(media)
    if (!end) {
        const running = media.status === "RELEASING" || media.status === "HIATUS"
        return running ? t(`Since ${pointLabel(t, start)}`, `Seit ${pointLabel(t, start)}`) : pointLabel(t, start)
    }
    if (end.year === start.year) {
        if (!start.season || !end.season || start.season === end.season) return pointLabel(t, start)
        return t(`${seasonName(t, start.season)} – ${seasonName(t, end.season)} ${start.year}`,
            `${seasonName(t, start.season)} – ${seasonName(t, end.season)} ${start.year}`)
    }
    if (!start.season && !end.season) return `${start.year}–${end.year}`
    return `${pointLabel(t, start)} – ${pointLabel(t, end)}`
}

export type Ranking = {
    type: string
    rank: number
    allTime?: boolean | null
    season?: string | null
    year?: number | null
}
export type RankingBadge = { type: "POPULAR" | "RATED", rank: number, allTime: boolean, season: Season | null, year: number | null }

/** All-time places count up to #100, places of a season or year up to #10 */
export const ALL_TIME_MAX = 100
export const PERIOD_MAX = 10

function best(rankings: Ranking[]) {
    return rankings.reduce<Ranking | null>((top, r) => !top || r.rank < top.rank ? r : top, null)
}

/** At most one badge per kind (popular first, then rated): the all-time place within #100, else a season's or year's within #10. */
export function rankingBadges(rankings?: Ranking[] | null): RankingBadge[] {
    const badges: RankingBadge[] = []
    for (const type of ["POPULAR", "RATED"] as const) {
        const ofType = (rankings ?? []).filter(r => r.type === type && r.rank > 0)
        const pick = best(ofType.filter(r => r.allTime && r.rank <= ALL_TIME_MAX))
            ?? best(ofType.filter(r => !r.allTime && !!r.year && r.rank <= PERIOD_MAX))
        if (pick) badges.push({ type, rank: pick.rank, allTime: !!pick.allTime, season: isSeason(pick.season) && !pick.allTime ? pick.season : null, year: pick.allTime ? null : pick.year ?? null })
    }
    return badges
}

/** "#7 Popular Winter 2024", "#45 Popular All Time", "#3 Highest Rated 2024" */
export function rankingLabel(t: Translate, badge: RankingBadge): string {
    const when = badge.allTime ? t("All Time", "aller Zeiten")
        : badge.season && badge.year ? seasonWithYear(t, badge.season, badge.year) : String(badge.year ?? "")
    const kind = badge.type === "POPULAR" ? t("Popular", "Beliebt") : t("Highest Rated", "Bestbewertet")
    return `#${badge.rank} ${kind} ${when}`.trim()
}
