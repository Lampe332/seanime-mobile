import type { AL_ListRecentAnime_Page_AiringSchedules, AL_MediaListStatus } from "@/api/generated/types"
import type { Translate } from "@/lib/app-language"
import { addDays, differenceInCalendarDays, format, startOfDay } from "date-fns"
import { de } from "date-fns/locale"

/** Pure helpers of the Android phone Discover tab: tabs, season math, "See all" links, labels, schedule days. */

export type DiscoverTab = "anime" | "schedule" | "manga"

/** The tab to show: unknown types, and Manga while manga is turned off, fall back to Anime. */
export function pickDiscoverTab(type: string | null | undefined, mangaEnabled: boolean): DiscoverTab {
    if (type === "schedule") return "schedule"
    if (type === "manga" && mangaEnabled) return "manga"
    return "anime"
}

export const DISCOVER_SEASONS = ["WINTER", "SPRING", "SUMMER", "FALL"] as const
export type DiscoverSeason = typeof DISCOVER_SEASONS[number]
export type SeasonYear = { season: DiscoverSeason, year: number }

/** This season by month (Jan-Mar Winter … Oct-Dec Fall) and the one before it; Winter's is last year's Fall. */
export function discoverSeasons(date: Date): { current: SeasonYear, previous: SeasonYear } {
    const index = Math.floor(date.getMonth() / 3)
    const year = date.getFullYear()
    return {
        current: { season: DISCOVER_SEASONS[index], year },
        previous: index === 0 ? { season: "FALL", year: year - 1 } : { season: DISCOVER_SEASONS[index - 1], year },
    }
}

/** A Search URL from the row's query, in the parameter order Search links use elsewhere; empty values are left out. */
function searchLink(params: Record<string, string | number | null | undefined>) {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
        if (value != null && value !== "") search.set(key, String(value))
    }
    return `/search?${search.toString()}`
}

/** "See all" targets: Search with the same sorting and filters as the row. */
export const seeAllLinks = {
    trending: (genre?: string | null) => searchLink({ sorting: "TRENDING_DESC", genre }),
    season: ({ season, year }: SeasonYear, genre?: string | null) => searchLink({ sorting: "SCORE_DESC", season, year, genre }),
    upcoming: () => searchLink({ sorting: "TRENDING_DESC", status: "NOT_YET_RELEASED" }),
    movies: () => searchLink({ sorting: "TRENDING_DESC", format: "MOVIE" }),
    manga: (country: string, genre?: string | null) => searchLink({ type: "manga", sorting: "TRENDING_DESC", country, genre }),
}

/**
 * "Aired recently": the last 14 days up to now, rounded down to five minutes and taken once per visit. The desktop row
 * builds the window from Date.now() on every render, which makes a new query key (and a new request) each second.
 */
export function recentWindow(now: number) {
    const lesser = Math.floor(now / 300_000) * 300
    return { airingAt_greater: lesser - 14 * 86_400, airingAt_lesser: lesser }
}

/** Schedule: today 00:00 until 14 days later; the same query key all day. */
export function scheduleWindow(now: number) {
    const start = startOfDay(now)
    return { airingAt_greater: start.getTime() / 1000, airingAt_lesser: addDays(start, 14).getTime() / 1000 }
}

export type Airing = AL_ListRecentAnime_Page_AiringSchedules

/** The desktop rows' filter: Japanese anime for a general audience, no TV shorts. */
function isListedAiring(item: Airing | null | undefined): item is Airing {
    const media = item?.media
    return !!media && media.isAdult === false && media.type === "ANIME" && media.countryOfOrigin === "JP" && media.format !== "TV_SHORT"
}

/** One card per show with its newest aired episode, newest first (desktop shows a card per airing). */
export function latestAiredPerShow(items: Airing[] | null | undefined): Airing[] {
    const seen = new Set<number>()
    return (items ?? []).filter(isListedAiring).sort((a, b) => b.airingAt - a.airingAt).filter(item => {
        if (seen.has(item.media!.id)) return false
        seen.add(item.media!.id)
        return true
    })
}

/** "17h ago" (as Home's aired row) / "vor 17 Std." */
export function airedAgoLabel(t: Translate, airingAt: number, now: number) {
    const minutes = Math.max(0, Math.floor((now / 1000 - airingAt) / 60))
    if (minutes < 1) return t("Just now", "Gerade eben")
    if (minutes < 60) return t(`${minutes}m ago`, `vor ${minutes} Min.`)
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return t(`${hours}h ago`, `vor ${hours} Std.`)
    const days = Math.floor(hours / 24)
    return days === 1 ? t("1d ago", "vor 1 Tag") : t(`${days}d ago`, `vor ${days} Tagen`)
}

/** Cover mark of an aired episode: "Ep 2/11" / "Folge 2/11", a movie says so. */
export function episodeTag(t: Translate, item: Airing) {
    if (item.media?.format === "MOVIE") return t("Movie", "Film")
    const total = item.media?.episodes
    return `${t("Ep", "Folge")} ${item.episode}${total ? `/${total}` : ""}`
}

export type ScheduleDay = { key: string, date: Date, items: Airing[] }

/**
 * Upcoming episodes from today 00:00 for 14 days (or until `until`, where the loaded pages stop) by local day, each day
 * by time; days without episodes are left out.
 */
export function groupScheduleByDay(items: Airing[], now: number, until?: Date): ScheduleDay[] {
    const start = startOfDay(now)
    const end = until && until < addDays(start, 14) ? until : addDays(start, 14)
    const seen = new Set<number>()
    const days = new Map<string, ScheduleDay>()
    for (const item of items.filter(isListedAiring).sort((a, b) => a.airingAt - b.airingAt)) {
        const date = new Date(item.airingAt * 1000)
        if (date < start || date >= end || seen.has(item.id)) continue
        seen.add(item.id)
        const key = format(date, "yyyy-MM-dd")
        if (!days.has(key)) days.set(key, { key, date: startOfDay(date), items: [] })
        days.get(key)!.items.push(item)
    }
    return [...days.values()]
}

/** "Later today" (the schedule only has episodes still to come), "Tomorrow", then "Friday, 23 Oct" / "Freitag, 23. Okt." */
export function scheduleDayTitle(t: Translate, day: Date, now: number, german: boolean) {
    const offset = differenceInCalendarDays(day, now)
    if (offset === 0) return t("Later today", "Heute noch")
    if (offset === 1) return t("Tomorrow", "Morgen")
    return german ? format(day, "EEEE, d. MMM", { locale: de }) : format(day, "EEEE, d MMM")
}

/** "6:30 PM" / "18:30" */
export function airingTimeLabel(airingAt: number, german: boolean) {
    return format(new Date(airingAt * 1000), german ? "HH:mm" : "h:mm a")
}

/**
 * How far the loaded schedule pages reach. AniList sends the window by time, so every day before the day of the last
 * loaded episode is complete; that day too once no page is missing. Undefined until the first page is in.
 */
export function scheduleReach(lastAiringAt: number | undefined, complete: boolean, now: number): Date | undefined {
    const end = addDays(startOfDay(now), 14)
    if (complete) return end
    if (lastAiringAt == null) return undefined
    const day = startOfDay(lastAiringAt * 1000)
    return day < end ? day : end
}

/** Whether the schedule needs the next page: AniList has one and the last episode so far is still inside the window. */
export function scheduleNeedsMore(page: { pageInfo?: { hasNextPage?: boolean | null } | null, airingSchedules?: ({ airingAt: number } | null)[] | null } | null | undefined,
    airingAtLesser: number) {
    const items = page?.airingSchedules?.filter(Boolean) ?? []
    const last = items.length ? items[items.length - 1]!.airingAt : undefined
    return !!page?.pageInfo?.hasNextPage && last != null && last < airingAtLesser
}

/** "38 episodes in the next 2 weeks"; while only part of the two weeks is in, "38 episodes in the next 5 days". */
export function scheduleFacts(t: Translate, count: number, days = 14) {
    const one = count === 1
    if (days >= 14) return one ? t("1 episode in the next 2 weeks", "1 Folge in den nächsten 2 Wochen")
        : t(`${count} episodes in the next 2 weeks`, `${count} Folgen in den nächsten 2 Wochen`)
    if (days <= 1) return one ? t("1 episode later today", "1 Folge heute noch") : t(`${count} episodes later today`, `${count} Folgen heute noch`)
    return one ? t(`1 episode in the next ${days} days`, `1 Folge in den nächsten ${days} Tagen`)
        : t(`${count} episodes in the next ${days} days`, `${count} Folgen in den nächsten ${days} Tagen`)
}

/**
 * The spotlight: the first trending titles. The anime one skips titles that are not out yet, as the desktop hero does
 * (the manga hero does not). With adult covers blurred, adult titles stay in the rows (veiled) but are not featured.
 */
export function pickSpotlight<T extends { status?: string | null, isAdult?: boolean | null }>(media: T[] | null | undefined,
    { hideAdult = false, skipUnreleased = false }: { hideAdult?: boolean, skipUnreleased?: boolean } = {}, count = 5): T[] {
    return (media ?? []).filter(item => !!item && !(skipUnreleased && item.status === "NOT_YET_RELEASED") && !(hideAdult && item.isAdult)).slice(0, count)
}

/** The trending row after the spotlight: the featured titles are not shown twice, unless nothing else would be left. */
export function withoutFeatured<T extends { id: number }>(media: T[] | undefined, featured: T[]): T[] | undefined {
    if (!media || !featured.length) return media
    const ids = new Set(featured.map(item => item.id))
    const rest = media.filter(item => !ids.has(item.id))
    return rest.length ? rest : media
}

/** Top rows sort by mean score on the client as well, as the desktop rows do; unscored titles go last. */
export function byMeanScore<T extends { meanScore?: number | null }>(media: T[] | null | undefined): T[] {
    return [...(media ?? [])].filter(Boolean).sort((a, b) => (b.meanScore ?? 0) - (a.meanScore ?? 0))
}

/** AniList's mean score as a percentage: "82%" / "82 %". */
export function scoreLabel(t: Translate, score: number | null | undefined) {
    return score ? t(`${score}%`, `${score} %`) : ""
}

const LIST_STATUS_LABELS: Record<AL_MediaListStatus, { anime: [string, string], manga: [string, string] }> = {
    CURRENT: { anime: ["Watching", "Schaue ich"], manga: ["Reading", "Lese ich"] },
    PLANNING: { anime: ["Planning", "Geplant"], manga: ["Planning", "Geplant"] },
    COMPLETED: { anime: ["Completed", "Fertig"], manga: ["Completed", "Fertig"] },
    PAUSED: { anime: ["Paused", "Pausiert"], manga: ["Paused", "Pausiert"] },
    DROPPED: { anime: ["Dropped", "Abgebrochen"], manga: ["Dropped", "Abgebrochen"] },
    REPEATING: { anime: ["Rewatching", "Schaue erneut"], manga: ["Rereading", "Lese erneut"] },
}

/** The user's list status in the words of the list editor ("Watching" / "Schaue ich"); empty when not on a list. */
export function listStatusLabel(t: Translate, type: "anime" | "manga", status: AL_MediaListStatus | null | undefined) {
    const labels = status ? LIST_STATUS_LABELS[status]?.[type] : undefined
    return labels ? t(...labels) : ""
}

/** The 18 genres of the genre chips (Search's list) with German names; AniList still gets the English value. */
const GENRE_LABELS: Record<string, [string, string]> = {
    "Action": ["Action", "Action"], "Adventure": ["Adventure", "Abenteuer"], "Comedy": ["Comedy", "Komödie"], "Drama": ["Drama", "Drama"],
    "Ecchi": ["Ecchi", "Ecchi"], "Fantasy": ["Fantasy", "Fantasy"], "Horror": ["Horror", "Horror"], "Mahou Shoujo": ["Mahou Shoujo", "Mahou Shoujo"],
    "Mecha": ["Mecha", "Mecha"], "Music": ["Music", "Musik"], "Mystery": ["Mystery", "Mystery"], "Psychological": ["Psychological", "Psychologisch"],
    "Romance": ["Romance", "Romantik"], "Sci-Fi": ["Sci-Fi", "Sci-Fi"], "Slice of Life": ["Slice of Life", "Slice of Life"], "Sports": ["Sports", "Sport"],
    "Supernatural": ["Supernatural", "Übernatürlich"], "Thriller": ["Thriller", "Thriller"],
}

export function genreLabel(t: Translate, genre: string) {
    return GENRE_LABELS[genre] ? t(...GENRE_LABELS[genre]) : genre
}
