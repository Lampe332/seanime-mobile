import {
    AL_AnimeCollection_MediaListCollection_Lists,
    AL_AnimeCollection_MediaListCollection_Lists_Entries,
    AL_AnimeStats,
    AL_BaseAnime,
    AL_BaseManga,
    AL_MangaCollection_MediaListCollection_Lists,
    AL_MangaCollection_MediaListCollection_Lists_Entries,
    AL_MangaStats,
} from "@/api/generated/types"
import { ADVANCED_SEARCH_MEDIA_TAGS } from "@/app/(main)/search/_lib/advanced-search-constants"
import type { Translate } from "@/lib/app-language"
import { COLLECTION_SORTING_OPTIONS, CollectionParams, filterEntriesByTitle, filterListEntries } from "@/lib/helpers/filtering"

/** Pure helpers of the phone "My lists" tab: lists in display order, filters, card facts, new-episode math, stats. */

export type ListType = "anime" | "manga"
export type ListEntry = AL_AnimeCollection_MediaListCollection_Lists_Entries | AL_MangaCollection_MediaListCollection_Lists_Entries
type RawList = AL_AnimeCollection_MediaListCollection_Lists | AL_MangaCollection_MediaListCollection_Lists
type Media = AL_BaseAnime | AL_BaseManga

/** A status list or a custom list as the phone shows it; `key` is the status or "custom:<name>". */
export type PhoneList = { key: string, status: string | null, name: string, custom: boolean, entries: ListEntry[] }

export const LIST_STATUSES = ["CURRENT", "REPEATING", "PLANNING", "PAUSED", "COMPLETED", "DROPPED"] as const

const STATUS_LABELS: Record<string, Record<ListType, [string, string]>> = {
    CURRENT: { anime: ["Watching", "Schaue ich"], manga: ["Reading", "Lese ich"] },
    REPEATING: { anime: ["Rewatching", "Schaue ich erneut"], manga: ["Rereading", "Lese ich erneut"] },
    PLANNING: { anime: ["Planning", "Geplant"], manga: ["Planning", "Geplant"] },
    PAUSED: { anime: ["Paused", "Pausiert"], manga: ["Paused", "Pausiert"] },
    COMPLETED: { anime: ["Completed", "Fertig"], manga: ["Completed", "Fertig"] },
    DROPPED: { anime: ["Dropped", "Abgebrochen"], manga: ["Dropped", "Abgebrochen"] },
}

export function statusLabel(status: string, type: ListType): [string, string] {
    return STATUS_LABELS[status]?.[type] ?? [status, status]
}

/** AniList's release status; German "Pausiert" and "Abgebrochen" already name list statuses on this screen. */
export const RELEASE_LABELS: Record<string, [string, string]> = {
    FINISHED: ["Finished", "Abgeschlossen"], RELEASING: ["Releasing", "Läuft"], NOT_YET_RELEASED: ["Upcoming", "Demnächst"],
    HIATUS: ["Hiatus", "Unterbrochen"], CANCELLED: ["Cancelled", "Eingestellt"],
}

/** Status lists in a fixed order, then custom lists in AniList's order; entries without media or hidden adult ones are left out. */
export function getPhoneLists(lists: RawList[] | null | undefined, showAdult: boolean): PhoneList[] {
    const keep = (entries: ListEntry[] | undefined) => (entries ?? []).filter(entry => !!entry?.media && (showAdult || !entry.media.isAdult))
    const statusLists = LIST_STATUSES.flatMap(status => {
        const list = lists?.find(item => !!item && !item.isCustomList && item.status === status)
        return list ? [{ key: status, status, name: status, custom: false, entries: keep(list.entries) }] : []
    })
    const customLists = (lists ?? []).filter(list => !!list?.isCustomList).map(list => {
        const name = list.name || "N/A"
        return { key: `custom:${name}`, status: null, name, custom: true, entries: keep(list.entries) }
    })
    return [...statusLists, ...customLists]
}

/** The sheet's filters; they apply to every list of the type. */
export type ListsFilters = {
    genres: string[]
    tags: string[]
    format: string | null
    /** AniList's release status (Finished, Releasing …), not the list status */
    status: string | null
    season: string | null
    year: string | null
    adult: boolean
}

export const EMPTY_LISTS_FILTERS: ListsFilters = { genres: [], tags: [], format: null, status: null, season: null, year: null, adult: false }

export const DEFAULT_LISTS_SORTING = "SCORE_DESC"

// Sorting by completion or release date drops entries without that date (desktop behaviour); the phone lists them last instead.
const DATED_SORTS = ["END_DATE", "END_DATE_DESC", "RELEASE_DATE", "RELEASE_DATE_DESC"]

/** Desktop filter and sort semantics (filterListEntries), per list. */
export function filterPhoneLists(type: ListType, lists: PhoneList[], filters: ListsFilters, sorting: string, showAdult: boolean,
    tagMap: Record<number, string[]> | null | undefined): PhoneList[] {
    const params = {
        sorting,
        genre: filters.genres.length ? filters.genres : null,
        tags: filters.tags.length ? filters.tags : null,
        status: filters.status,
        format: type === "anime" ? filters.format : null,
        season: type === "anime" ? filters.season : null,
        year: filters.year,
        // "Only adult titles" counts only while adult content is on, so it can never hide every title unseen.
        isAdult: filters.adult && showAdult,
        continueWatchingOnly: false,
    } as CollectionParams<"anime">
    const run = (entries: ListEntry[], sort: string) =>
        filterListEntries(type, entries as AL_AnimeCollection_MediaListCollection_Lists_Entries[], { ...params, sorting: sort } as CollectionParams<typeof type>,
            showAdult, tagMap) as ListEntry[]
    return lists.map(list => {
        let entries = run(list.entries, sorting)
        if (DATED_SORTS.includes(sorting)) {
            const dated = new Set(entries)
            entries = [...entries, ...run(list.entries, "TITLE").filter(entry => !dated.has(entry))]
        }
        return { ...list, entries }
    })
}

/** The live title search (English, romaji, preferred title and synonyms), after the filters. */
export function searchPhoneLists(lists: PhoneList[], search: string): PhoneList[] {
    if (!search.trim()) return lists
    return lists.map(list => ({ ...list, entries: filterEntriesByTitle(list.entries, search) }))
}

export type StatusTab = { value: string, label: [string, string], count: number, custom: boolean }

/** One tab per list that holds entries; `count` comes from the filtered lists, so a filter can empty a tab without hiding it. */
export function getStatusTabs(type: ListType, lists: PhoneList[], filtered: PhoneList[]): StatusTab[] {
    return lists.filter(list => list.entries.length > 0).map(list => ({
        value: list.key,
        label: list.custom ? [list.name, list.name] : statusLabel(list.key, type),
        count: filtered.find(item => item.key === list.key)?.entries.length ?? 0,
        custom: list.custom,
    }))
}

/** The chosen list while it has a tab, otherwise the first tab that shows entries. */
export function pickStatus(selected: string | null | undefined, tabs: StatusTab[]): string | null {
    if (selected && tabs.some(tab => tab.value === selected)) return selected
    return (tabs.find(tab => tab.count > 0) ?? tabs[0])?.value ?? null
}

/** Episodes out so far: the one before the next airing, or all of them once finished; null when AniList does not say. */
export function airedEpisodes(media: AL_BaseAnime | null | undefined, now: number): number | null {
    const next = media?.nextAiringEpisode
    if (next?.episode) return next.airingAt && next.airingAt * 1000 <= now ? next.episode : next.episode - 1
    if (media?.status === "FINISHED") return media.episodes ?? null
    return null
}

/** Aired episodes not watched yet: the desktop card's unwatched count (without local files). */
export function unwatchedEpisodes(media: AL_BaseAnime | null | undefined, progress: number | null | undefined, now: number) {
    const aired = airedEpisodes(media, now)
    return aired == null ? 0 : Math.max(0, aired - (progress ?? 0))
}

/** New episodes: aired and not watched yet while the show still airs; a finished show has episodes left, not new ones. */
export function newEpisodes(media: AL_BaseAnime | null | undefined, progress: number | null | undefined, now: number) {
    return media?.status === "RELEASING" ? unwatchedEpisodes(media, progress, now) : 0
}

export function nextAiring(media: AL_BaseAnime | null | undefined, now: number): { episode: number, inMs: number } | null {
    const next = media?.nextAiringEpisode
    if (!next?.episode || !next.airingAt) return null
    const inMs = next.airingAt * 1000 - now
    return inMs > 0 ? { episode: next.episode, inMs } : null
}

/**
 * Header facts: titles on the list (custom lists included, each title once), the watching / reading list, and the watched
 * titles with something new: aired episodes of running shows, or (manga) unread chapters as `unread` reports them.
 */
export function getListFacts(type: ListType, lists: PhoneList[], now: number, unread?: (entry: ListEntry) => number) {
    const ids = new Set(lists.flatMap(list => list.entries.map(entry => entry.media!.id)))
    const watching = lists.find(list => list.key === "CURRENT")?.entries ?? []
    const fresh = new Set(watching.filter(entry => type === "anime" ? newEpisodes(entry.media as AL_BaseAnime, entry.progress, now) > 0
        : (unread?.(entry) ?? 0) > 0).map(entry => entry.media!.id)).size
    return { total: ids.size, current: watching.length, fresh }
}

export type CardMeta =
    | { kind: "airing", episode: number, inMs: number }
    | { kind: "chapters", progress: number, total: number }
    | { kind: "count", total: number }
    | { kind: "upcoming" }
    | { kind: "releasing" }
    | { kind: "season" }

/** What a cover shows for its entry; the status is the entry's own, so custom lists look like the status lists. */
export type CardInfo = {
    progress?: { value: number, total: number }
    /** "6/12", "6/–"; reading manga show their chapter in the line under the title instead */
    tag?: string
    /** New episodes: a running show being watched */
    fresh: number
    /** Aired episodes not watched yet (watched or rewatched anime), for the theme's "unwatched count" */
    unwatched: number
    /** The user's score on the 10-point scale, 0 when unscored */
    score: number
    meta: CardMeta
    /** Long press offers "Continue" (anime with progress that is watched, paused or rewatched) */
    canContinue: boolean
}

export function getCardInfo(type: ListType, entry: ListEntry, now: number): CardInfo {
    const media = entry.media!
    const status = entry.status ?? ""
    const progress = entry.progress ?? 0
    const watching = status === "CURRENT" || status === "REPEATING"
    const info: CardInfo = { fresh: 0, unwatched: 0, score: 0, meta: { kind: "season" }, canContinue: false }
    const known = type === "anime" ? (media as AL_BaseAnime).episodes ?? 0 : (media as AL_BaseManga).chapters ?? 0
    if (type === "anime") {
        const anime = media as AL_BaseAnime
        if (watching) {
            const aired = airedEpisodes(anime, now)
            const total = known || aired || 0
            if (total > 0) info.progress = { value: progress, total }
            info.unwatched = unwatchedEpisodes(anime, progress, now)
            if (status === "CURRENT") info.fresh = newEpisodes(anime, progress, now)
        }
        // A running show says when its next episode comes, in every list (the desktop's releasing badge).
        const next = nextAiring(anime, now)
        if (next) info.meta = { kind: "airing", ...next }
        if (progress > 0 && (watching || status === "PAUSED" || status === "DROPPED")) info.tag = `${progress}/${known || "–"}`
        info.canContinue = progress > 0 && (watching || status === "PAUSED")
    } else {
        if (watching) {
            if (known > 0) info.progress = { value: progress, total: known }
            if (progress > 0) info.meta = { kind: "chapters", progress, total: known }
            else if (known > 0) info.meta = { kind: "count", total: known }
        }
        if (progress > 0 && (status === "PAUSED" || status === "DROPPED")) info.tag = `${progress}/${known || "–"}`
    }
    if (info.meta.kind === "season" && media.status === "NOT_YET_RELEASED") info.meta = { kind: "upcoming" }
    else if (info.meta.kind === "season" && media.status === "RELEASING") info.meta = { kind: "releasing" }
    if ((entry.score ?? 0) > 0) info.score = Math.round(entry.score!) / 10
    return info
}

/** List data for DOM plugins, shaped like MediaEntryCard's data-list-data. */
export function listDataOf(entry: ListEntry) {
    const date = (value?: { year?: number, month?: number, day?: number }) =>
        value?.year ? new Date(value.year, (value.month || 1) - 1, value.day || 1).toISOString() : undefined
    return { progress: entry.progress, score: entry.score, status: entry.status, startedAt: date(entry.startedAt), completedAt: date(entry.completedAt) }
}

/** Time until an airing under a cover: "45 min", "5 h", "2 d" (German "45 Min.", "5 Std.", "2 Tagen"). */
export function formatIn(t: Translate, ms: number) {
    const minutes = Math.max(1, Math.round(ms / 60_000))
    if (minutes < 60) return t(`${minutes} min`, `${minutes} Min.`)
    const hours = Math.round(ms / 3_600_000)
    if (hours < 24) return t(`${hours} h`, `${hours} Std.`)
    const days = Math.round(ms / 86_400_000)
    return t(`${days} d`, days === 1 ? "1 Tag" : `${days} Tagen`)
}

/** The same time spelled out for screen readers: "2 days", "1 hour" ("2 Tagen", "1 Stunde" after German "in"). */
export function formatInSpoken(t: Translate, ms: number) {
    const minutes = Math.max(1, Math.round(ms / 60_000))
    if (minutes < 60) return minutes === 1 ? t("1 minute", "1 Minute") : t(`${minutes} minutes`, `${minutes} Minuten`)
    const hours = Math.round(ms / 3_600_000)
    if (hours < 24) return hours === 1 ? t("1 hour", "1 Stunde") : t(`${hours} hours`, `${hours} Stunden`)
    const days = Math.round(ms / 86_400_000)
    return days === 1 ? t("1 day", "1 Tag") : t(`${days} days`, `${days} Tagen`)
}

/** A score on the 10-point scale without a trailing ".0" ("8.5", German "8,5"). */
export function formatScore(t: Translate, score: number) {
    const text = Number.isInteger(score) ? String(score) : score.toFixed(1)
    return t(text, text.replace(".", ","))
}

export type FacetCount = { value: string, count: number }

/** Values found anywhere in the type's lists, each with how many entries of the shown list carry it. */
export function countValues(lists: PhoneList[], shownKey: string | null, valuesOf: (media: Media) => Array<string | number | null | undefined>) {
    const counts = new Map<string, number>()
    for (const list of lists) {
        for (const entry of list.entries) {
            for (const value of new Set(valuesOf(entry.media!))) {
                if (value == null || value === "") continue
                const key = String(value)
                counts.set(key, (counts.get(key) ?? 0) + (list.key === shownKey ? 1 : 0))
            }
        }
    }
    return counts
}

/** Values the shown list has come first; the others (count 0, they still filter the other lists) follow in the same order. */
const hitsFirst = (chips: FacetCount[]) => [...chips.filter(chip => chip.count > 0), ...chips.filter(chip => !chip.count)]

/** Chips in a fixed order, only for values on the list; a chosen value stays so it can be undone. */
export function orderedFacet(counts: Map<string, number>, order: readonly string[], selected: string | null): FacetCount[] {
    return hitsFirst(order.filter(value => counts.has(value) || value === selected).map(value => ({ value, count: counts.get(value) ?? 0 })))
}

/** Every genre of the list, A–Z, chosen ones included. */
export function genreFacet(counts: Map<string, number>, selected: string[]): FacetCount[] {
    const values = new Set([...counts.keys(), ...selected])
    return hitsFirst([...values].sort((a, b) => a.localeCompare(b)).map(value => ({ value, count: counts.get(value) ?? 0 })))
}

export const ANIME_FORMATS = ["TV", "MOVIE", "ONA", "OVA", "TV_SHORT", "SPECIAL"] as const
export const RELEASE_STATUSES = ["FINISHED", "RELEASING", "NOT_YET_RELEASED", "HIATUS", "CANCELLED"] as const
export const SEASONS = ["WINTER", "SPRING", "SUMMER", "FALL"] as const

/** Years the year filter can match (anime: season year or start year), newest first. */
export function getListYears(type: ListType, lists: PhoneList[]): string[] {
    const years = new Set<number>()
    for (const list of lists) {
        for (const entry of list.entries) {
            const media = entry.media!
            if (type === "anime" && (media as AL_BaseAnime).seasonYear) years.add((media as AL_BaseAnime).seasonYear!)
            if (media.startDate?.year) years.add(media.startDate.year)
        }
    }
    return [...years].sort((a, b) => b - a).map(String)
}

const ADULT_TAGS = new Set(ADVANCED_SEARCH_MEDIA_TAGS.filter(tag => tag.isAdult).map(tag => tag.name))

export const TAG_CHIP_LIMIT = 24

/**
 * Tag chips: chosen tags first (always, so none stays active unseen), then the list's tags by count; adult tags only with
 * "Only adult titles" on. Without `expanded` the first 24 are shown.
 */
export function getTagChips(counts: Map<string, number>, selected: string[], options: { adult: boolean, query: string, expanded: boolean }) {
    const query = options.query.trim().toLowerCase()
    const allowed = [...counts].filter(([name]) => options.adult || !ADULT_TAGS.has(name))
    const rest = allowed
        .filter(([name]) => !selected.includes(name) && (!query || name.toLowerCase().includes(query)))
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([value, count]) => ({ value, count }))
    const all = [...selected.map(value => ({ value, count: counts.get(value) ?? 0 })), ...rest]
    const chips = options.expanded ? all : all.slice(0, Math.max(TAG_CHIP_LIMIT, selected.length))
    return { chips, total: all.length, available: allowed.length }
}

/** Active sheet filters for the button's dot and label: each genre and tag counts once. */
export function countActiveFilters(type: ListType, filters: ListsFilters, showAdult: boolean) {
    return filters.genres.length + filters.tags.length + (filters.status ? 1 : 0) + (filters.year ? 1 : 0)
        + (type === "anime" && filters.format ? 1 : 0) + (type === "anime" && filters.season ? 1 : 0) + (filters.adult && showAdult ? 1 : 0)
}

const SORTING_DE: Record<string, string> = {
    SCORE_DESC: "Höchste eigene Bewertung",
    SCORE: "Niedrigste eigene Bewertung",
    TITLE: "Titel (A–Z)",
    TITLE_DESC: "Titel (Z–A)",
    AUDIENCE_SCORE_DESC: "Höchste AniList-Bewertung",
    AUDIENCE_SCORE: "Niedrigste AniList-Bewertung",
    PROGRESS_DESC: "Größter Fortschritt",
    PROGRESS: "Geringster Fortschritt",
    START_DATE_DESC: "Zuletzt begonnen",
    START_DATE: "Zuerst begonnen",
    END_DATE_DESC: "Zuletzt beendet",
    END_DATE: "Zuerst beendet",
    RELEASE_DATE_DESC: "Neueste Veröffentlichung",
    RELEASE_DATE: "Älteste Veröffentlichung",
    CREATED_AT_DESC: "Zuletzt hinzugefügt",
    UPDATED_AT_DESC: "Zuletzt aktualisiert",
}

/** The desktop list's 16 sorting options with German labels. */
export const LISTS_SORTING_OPTIONS = COLLECTION_SORTING_OPTIONS.map(option => ({
    value: option.value,
    en: option.value === "TITLE" ? "Title (A-Z)" : option.label,
    de: SORTING_DE[option.value] ?? option.label,
}))

export function validSorting(value: string | null | undefined) {
    return LISTS_SORTING_OPTIONS.some(option => option.value === value) ? value! : DEFAULT_LISTS_SORTING
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Stats: the math of the desktop stats tab (anilist-stats.tsx), as ranked rows for bars.

type UserStats = AL_AnimeStats | AL_MangaStats

/** `label` only where the key is not the text (studios); `score` is a score row's value on the 10-point scale. */
export type StatRow = { key: string, label?: string, count: number, ratio: number, minutes?: number, chapters?: number, meanScore?: number, score?: number }

/**
 * AniList sends scores in the user's format: 1–10, or 1–100 when any score is above 10. Decided once per list, so a 100-point
 * "10" (1/10) never merges with "100" (10/10).
 */
export function scoreScale(scores: Array<{ score?: number | null }>) {
    return scores.some(item => (item.score ?? 0) > 10) ? 10 : 1
}

const STATS_STATUS_ORDER = ["CURRENT", "COMPLETED", "PLANNING", "PAUSED", "DROPPED", "REPEATING"]

function toRows<T extends { count: number }>(items: T[], key: (item: T) => string, extra?: (item: T) => Partial<StatRow>): StatRow[] {
    const max = Math.max(1, ...items.map(item => item.count))
    return items.map(item => ({ key: key(item), count: item.count, ratio: item.count / max, ...extra?.(item) }))
}

const byCount = <T extends { count: number }>(a: T, b: T) => b.count - a.count

export function getStatsView(type: ListType, stats: UserStats, thisYear: number) {
    const anime = type === "anime" ? stats as AL_AnimeStats : null
    const scores = (stats.scores ?? []).filter(item => (item.score ?? 0) > 0 && item.count > 0)
    const scale = scoreScale(scores)
    const statuses = (stats.statuses ?? []).filter(item => !!item.status && item.count > 0)
    const genres = (stats.genres ?? []).filter(item => !!item.genre && item.count > 0).sort(byCount)
    const startYears = (stats.startYears ?? []).filter(item => !!item.startYear && item.count > 0)
    const releaseYears = (stats.releaseYears ?? []).filter(item => !!item.releaseYear && item.count > 0)

    const mode = [...scores].sort(byCount)[0]
    const completed = statuses.find(item => item.status === "COMPLETED")?.count ?? 0
    const planning = statuses.find(item => item.status === "PLANNING")?.count ?? 0
    const started = statuses.reduce((sum, item) => sum + item.count, 0) - planning
    const peak = [...startYears].sort(byCount)[0]

    return {
        count: stats.count ?? 0,
        minutes: anime?.minutesWatched ?? 0,
        episodes: anime?.episodesWatched ?? 0,
        chapters: (stats as AL_MangaStats).chaptersRead ?? 0,
        meanScore: stats.meanScore ?? 0,
        thisYear: startYears.find(item => item.startYear === thisYear)?.count ?? null,
        lastYear: startYears.find(item => item.startYear === thisYear - 1)?.count ?? null,
        modeScore: mode ? { score: mode.score! / scale, count: mode.count } : null,
        completion: started > 0 ? { rate: Math.round(completed / started * 100), completed, started } : null,
        topGenre: genres[0] ? { genre: genres[0].genre!, count: genres[0].count, meanScore: genres[0].meanScore } : null,
        peakYear: peak ? { year: peak.startYear!, count: peak.count } : null,
        scores: toRows([...scores].sort((a, b) => b.score! - a.score!), item => String(item.score), item => ({ score: item.score! / scale })),
        statuses: toRows([...statuses].sort((a, b) => STATS_STATUS_ORDER.indexOf(a.status!) - STATS_STATUS_ORDER.indexOf(b.status!)), item => item.status!),
        formats: anime ? toRows((anime.formats ?? []).filter(item => !!item.format && item.count > 0).sort(byCount), item => item.format!,
            item => ({ minutes: item.minutesWatched, meanScore: item.meanScore })) : [],
        genres: toRows(genres.slice(0, 10), item => item.genre!,
            item => ({ minutes: item.minutesWatched, chapters: item.chaptersRead, meanScore: item.meanScore })),
        startYears: toRows([...startYears].sort((a, b) => b.startYear! - a.startYear!), item => String(item.startYear)),
        releaseYears: toRows([...releaseYears].sort(byCount).slice(0, 12).sort((a, b) => b.releaseYear! - a.releaseYear!), item => String(item.releaseYear)),
        studios: anime ? toRows((anime.studios ?? []).filter(item => !!item.studio && item.count > 0).sort(byCount).slice(0, 10),
            item => String(item.studio!.id), item => ({ label: item.studio!.name, meanScore: item.meanScore })) : [],
    }
}

export type StatsView = ReturnType<typeof getStatsView>
