import { AnilistListAnime_Variables, AnilistListManga_Variables } from "@/api/generated/endpoint.types"
import {
    AL_BaseAnime,
    AL_BaseManga,
    AL_MediaFormat,
    AL_MediaListStatus,
    AL_MediaSeason,
    AL_MediaSort,
    AL_MediaStatus,
    Manga_MangaLatestChapterNumberItem,
} from "@/api/generated/types"
import type { MangaEntryFilters } from "@/main/manga/_lib/manga-preferences"
import { getMangaEntryUnreadState } from "@/main/manga/_lib/manga-unread"
import { ADVANCED_SEARCH_MEDIA_TAGS } from "@/main/search/_lib/advanced-search-constants"
import type { Translate } from "@/lib/app-language"
import { seasonWithYear } from "@/main/_features/media/_lib/media-labels"
import { anilist_getCurrentEpisodes } from "@/lib/helpers/media"

/**
 * The phone search (Android phones): URL params → state, state → AniList variables, the results title and the active
 * filter chips. Pure, so the rules can be unit-tested; the screen lives in search/_screens/search-phone.tsx.
 */

export type SearchType = "anime" | "manga"
export type SearchSort = "SCORE_DESC" | "TRENDING_DESC" | "POPULARITY_DESC" | "START_DATE_DESC" | "EPISODES_DESC" | "CHAPTERS_DESC"
/** The order of a title search: AniList's best match, or one of the sorts on its own */
export type TitleSort = SearchSort | "SEARCH_MATCH"

export type SearchPhoneState = {
    type: SearchType
    /** As typed; trimmed when sent */
    title: string
    /** The order without a title */
    sort: SearchSort
    /**
     * The order while a title is typed. Its own value because 2.0.33 sent ["SEARCH_MATCH", sort]: the match decides every
     * place, so a sort chip tapped while typing lit up but left the results as they were, and became the browse sort once
     * the field was cleared.
     */
    titleSort: TitleSort
    genres: string[]
    tags: string[]
    format: AL_MediaFormat | null
    /** Anime only */
    season: AL_MediaSeason | null
    year: number | null
    status: AL_MediaStatus | null
    /** 1-9 on the 10 point scale */
    minScore: number | null
    /** Manga only */
    country: string | null
    /** Adult titles only; counts only while the server allows adult content */
    adult: boolean
}

export const SEARCH_DEFAULTS: SearchPhoneState = {
    type: "anime", title: "", sort: "SCORE_DESC", titleSort: "SEARCH_MATCH", genres: [], tags: [], format: null, season: null, year: null, status: null, minScore: null,
    country: null, adult: false,
}

export const SEARCH_PAGE_SIZE = 48

export type SearchOption<T extends string = string> = { value: T, en: string, de: string }

type SortOption = SearchOption<SearchSort> & {
    for?: SearchType
}

const SEARCH_SORTS: SortOption[] = [
    { value: "SCORE_DESC", en: "Highest score", de: "Beste Wertung" },
    { value: "TRENDING_DESC", en: "Trending", de: "Im Trend" },
    { value: "POPULARITY_DESC", en: "Popular", de: "Beliebt" },
    { value: "START_DATE_DESC", en: "Newest", de: "Neueste" },
    { value: "EPISODES_DESC", en: "Most episodes", de: "Meiste Folgen", for: "anime" },
    { value: "CHAPTERS_DESC", en: "Most chapters", de: "Meiste Kapitel", for: "manga" },
]

export function searchSorts(type: SearchType) {
    return SEARCH_SORTS.filter(sort => !sort.for || sort.for === type)
}

const BEST_MATCH: SearchOption<"SEARCH_MATCH"> = { value: "SEARCH_MATCH", en: "Best match", de: "Beste Treffer" }

/** The sort chips of the page: with a title "Best match" first, then the sorts, each of which then orders the matches alone. */
export function searchSortChips(type: SearchType, hasTitle: boolean): SearchOption<TitleSort>[] {
    return [...(hasTitle ? [BEST_MATCH] : []), ...searchSorts(type)]
}

/** The order the results are in: the title's own order while a title is typed, else the sort. */
export function activeSearchSort(state: SearchPhoneState): TitleSort {
    return state.title.trim() ? state.titleSort : state.sort
}

/** A sort chip: changes the order that is in use, so the browse sort stays as it was while a title is typed. */
export function selectSearchSort(state: SearchPhoneState, value: TitleSort): SearchPhoneState {
    if (state.title.trim()) return state.titleSort === value ? state : { ...state, titleSort: value }
    if (value === "SEARCH_MATCH" || state.sort === value) return state
    return { ...state, sort: value }
}

/** A new title; a search that starts from an empty field starts with the best matches. */
export function withSearchTitle(state: SearchPhoneState, title: string): SearchPhoneState {
    if (state.title === title) return state
    const starts = !state.title.trim() && !!title.trim()
    return { ...state, title, titleSort: starts ? "SEARCH_MATCH" : state.titleSort }
}

/** The 18 genres of the desktop search, with German names. */
export const SEARCH_GENRES: SearchOption[] = [
    { value: "Action", en: "[genre] Action", de: "Action" }, { value: "Adventure", en: "[genre] Adventure", de: "Abenteuer" },
    { value: "Comedy", en: "[genre] Comedy", de: "Komödie" }, { value: "Drama", en: "[genre] Drama", de: "Drama" }, { value: "Ecchi", en: "[genre] Ecchi", de: "Ecchi" },
    { value: "Fantasy", en: "[genre] Fantasy", de: "Fantasy" }, { value: "Horror", en: "[genre] Horror", de: "Horror" },
    { value: "Mahou Shoujo", en: "[genre] Mahou Shoujo", de: "Mahou Shoujo" }, { value: "Mecha", en: "[genre] Mecha", de: "Mecha" }, { value: "Music", en: "[genre] Music", de: "Musik" },
    { value: "Mystery", en: "[genre] Mystery", de: "Mystery" }, { value: "Psychological", en: "[genre] Psychological", de: "Psychologisch" },
    { value: "Romance", en: "[genre] Romance", de: "Romantik" }, { value: "Sci-Fi", en: "[genre] Sci-Fi", de: "Sci-Fi" },
    { value: "Slice of Life", en: "[genre] Slice of Life", de: "Slice of Life" }, { value: "Sports", en: "[genre] Sports", de: "Sport" },
    { value: "Supernatural", en: "[genre] Supernatural", de: "Übernatürlich" }, { value: "Thriller", en: "[genre] Thriller", de: "Thriller" },
]

export const SEARCH_ANIME_FORMATS: SearchOption<AL_MediaFormat>[] = [
    { value: "TV", en: "TV", de: "TV" }, { value: "MOVIE", en: "Movie", de: "Film" }, { value: "ONA", en: "ONA", de: "ONA" },
    { value: "OVA", en: "OVA", de: "OVA" }, { value: "TV_SHORT", en: "TV short", de: "TV-Kurzserie" }, { value: "SPECIAL", en: "Special", de: "Special" },
]

export const SEARCH_MANGA_FORMATS: SearchOption<AL_MediaFormat>[] = [
    { value: "MANGA", en: "Manga", de: "Manga" }, { value: "ONE_SHOT", en: "One shot", de: "One-Shot" },
]

export const SEARCH_COUNTRIES: SearchOption[] = [
    { value: "JP", en: "Japan", de: "Japan" }, { value: "KR", en: "South Korea", de: "Südkorea" },
    { value: "CN", en: "China", de: "China" }, { value: "TW", en: "Taiwan", de: "Taiwan" },
]

export const SEARCH_SEASONS: SearchOption<AL_MediaSeason>[] = [
    { value: "WINTER", en: "Winter", de: "Winter" }, { value: "SPRING", en: "Spring", de: "Frühling" },
    { value: "SUMMER", en: "Summer", de: "Sommer" }, { value: "FALL", en: "Fall", de: "Herbst" },
]

/**
 * Release statuses. The running one reads "Releasing" (AniList's word) for anime and manga, as on the covers of Discover,
 * My lists and the anime page (media-labels.ts). Hiatus and cancelled avoid "Pausiert" / "Abgebrochen": on the covers those
 * words mean the user's own list status.
 */
export const SEARCH_STATUSES: SearchOption<AL_MediaStatus>[] = [
    { value: "FINISHED", en: "Finished", de: "Abgeschlossen" }, { value: "RELEASING", en: "Releasing", de: "Läuft" },
    { value: "NOT_YET_RELEASED", en: "Upcoming", de: "Demnächst" }, { value: "HIATUS", en: "Hiatus", de: "Unterbrochen" },
    { value: "CANCELLED", en: "Cancelled", de: "Eingestellt" },
]

/** The desktop's year list: two years ahead, 70 years back. */
export function searchYears(now = new Date()) {
    return Array.from({ length: 70 }, (_, i) => now.getFullYear() + 2 - i)
}

export const SEARCH_MIN_SCORES = [9, 8, 7, 6, 5, 4, 3, 2, 1]

const TAG_BY_NAME = new Map(ADVANCED_SEARCH_MEDIA_TAGS.map(tag => [tag.name.toLowerCase(), tag]))
const GENRE_BY_NAME = new Map(SEARCH_GENRES.map(genre => [genre.value.toLowerCase(), genre]))

export function isAdultTag(name: string) {
    return !!TAG_BY_NAME.get(name.toLowerCase())?.isAdult
}

function find<T extends string>(options: SearchOption<T>[], value: string | null | undefined) {
    return options.find(option => option.value === value)
}

function label(t: Translate, options: SearchOption[], value: string) {
    const option = find(options, value)
    return option ? t(option.en, option.de) : value
}

const genreLabel = (t: Translate, genre: string) => label(t, SEARCH_GENRES, genre)

/** A list status as a short cover badge, in the words the Manga, My lists and Discover tabs use. */
export function listStatusLabel(t: Translate, type: SearchType, status: AL_MediaListStatus | null | undefined) {
    switch (status) {
        case "CURRENT":
            return type === "anime" ? t("Watching", "Schaue ich") : t("Reading", "Lese ich")
        case "REPEATING":
            return type === "anime" ? t("Rewatching", "Schaue erneut") : t("Rereading", "Lese erneut")
        case "PLANNING":
            return t("Planning", "Geplant")
        case "COMPLETED":
            return t("Completed", "Fertig")
        case "PAUSED":
            return t("Paused", "Pausiert")
        case "DROPPED":
            return t("Dropped", "Abgebrochen")
        default:
            return ""
    }
}

/* ------------------------------------------------- URL params ------------------------------------------------- */

const PARAM_KEYS = ["type", "sorting", "genre", "tags", "status", "format", "season", "year", "country", "q"] as const

type Params = { get(name: string): string | null }

/** The params this screen reads, as one string ("" without any): the same string twice is the same arrival. */
export function searchParamsKey(params: Params) {
    return PARAM_KEYS.map(key => [key, params.get(key)?.trim()] as const).filter(([, value]) => !!value)
        .map(([key, value]) => `${key}=${value}`).join("&")
}

function unique(values: string[]) {
    return [...new Set(values)]
}

function pickSort(value: string, type: SearchType): SearchSort {
    if (value === "EPISODES_DESC" || value === "CHAPTERS_DESC") return type === "anime" ? "EPISODES_DESC" : "CHAPTERS_DESC"
    return SEARCH_SORTS.find(sort => sort.value === value)?.value ?? "SCORE_DESC"
}

/**
 * The search a link asks for, as the desktop page applies it: everything not in the link starts empty. Values arrive as
 * strings or numbers in any case; lists may be comma-separated. `format=MANGA` (or another manga format) means manga.
 * The "Hentai" genre of adult entries turns adult titles on when the server allows them (it has no other results).
 */
export function searchStateFromParams(params: Params, adultAllowed: boolean): SearchPhoneState {
    const read = (key: string) => params.get(key)?.trim() ?? ""
    const list = (key: string) => read(key).split(",").map(value => value.trim()).filter(Boolean)
    const formatParam = read("format").toUpperCase()
    const type: SearchType = find(SEARCH_MANGA_FORMATS, formatParam) || read("type").toLowerCase() === "manga" ? "manga" : "anime"
    const genres = unique(list("genre").map(genre => GENRE_BY_NAME.get(genre.toLowerCase())?.value ?? genre))
    const adult = adultAllowed && genres.some(genre => genre.toLowerCase() === "hentai")
    const tags = unique(list("tags").map(tag => TAG_BY_NAME.get(tag.toLowerCase())?.name ?? tag)).filter(tag => adult || !isAdultTag(tag))
    const year = Number(read("year"))
    const sort = pickSort(read("sorting").toUpperCase(), type)
    return {
        ...SEARCH_DEFAULTS,
        type,
        title: read("q"),
        sort,
        // a link with a title and a sorting asks for that order; a title alone (shared text) for the best matches
        titleSort: read("q") && read("sorting") ? sort : "SEARCH_MATCH",
        genres,
        tags,
        // format=MANGA only picks the type (desktop rule); a one shot stays a filter
        format: type === "anime" ? find(SEARCH_ANIME_FORMATS, formatParam)?.value ?? null : formatParam === "ONE_SHOT" ? "ONE_SHOT" : null,
        season: type === "anime" ? find(SEARCH_SEASONS, read("season").toUpperCase())?.value ?? null : null,
        year: Number.isInteger(year) && year >= 1900 && year <= 2100 ? year : null,
        status: find(SEARCH_STATUSES, read("status").toUpperCase())?.value ?? null,
        country: type === "manga" ? find(SEARCH_COUNTRIES, read("country").toUpperCase())?.value ?? null : null,
        adult,
    }
}


/* --------------------------------------------------- State ---------------------------------------------------- */

/**
 * The other type starts without filters: anime filters (genres, year, status, …) taken along to manga left an empty
 * "No manga match" the user had not asked for (tablet test T2). The title and the sorts stay; a count sort is reset.
 */
export function switchSearchType(state: SearchPhoneState, type: SearchType): SearchPhoneState {
    if (state.type === type) return state
    const countSort = (sort: TitleSort) => sort === "EPISODES_DESC" || sort === "CHAPTERS_DESC"
    return {
        ...clearSearchFilters(state), type,
        sort: countSort(state.sort) ? "SCORE_DESC" : state.sort,
        titleSort: countSort(state.titleSort) ? "SEARCH_MATCH" : state.titleSort,
    }
}

/** Every filter off; the type, the title and the sorts stay (they have their own controls). */
export function clearSearchFilters(state: SearchPhoneState): SearchPhoneState {
    return { ...SEARCH_DEFAULTS, type: state.type, title: state.title, sort: state.sort, titleSort: state.titleSort }
}

/**
 * `state` with the filters of `from` (the filter sheet's draft), keeping its own title and sort (typing can go on while the
 * sheet is open). A draft of the other type (a link switched it meanwhile) is dropped.
 */
export function withSearchFilters(state: SearchPhoneState, from: SearchPhoneState): SearchPhoneState {
    if (state.type !== from.type) return state
    const next = { ...from, title: state.title, sort: state.sort, titleSort: state.titleSort }
    return searchFiltersEqual(state, next) ? state : next
}

function searchFiltersEqual(a: SearchPhoneState, b: SearchPhoneState) {
    return a.genres.join("\n") === b.genres.join("\n") && a.tags.join("\n") === b.tags.join("\n") && a.format === b.format && a.season === b.season
        && a.year === b.year && a.status === b.status && a.minScore === b.minScore && a.country === b.country && a.adult === b.adult
}

export function toggleValue(values: string[], value: string) {
    return values.includes(value) ? values.filter(v => v !== value) : [...values, value]
}

/** Adult titles only while the server allows adult content (it ignores the flag otherwise). */
function adultOn(state: SearchPhoneState, adultAllowed: boolean) {
    return adultAllowed && state.adult
}

/** Tags that are sent: adult tags only with adult titles on. */
function sentTags(state: SearchPhoneState, adultAllowed: boolean) {
    return adultOn(state, adultAllowed) ? state.tags : state.tags.filter(tag => !isAdultTag(tag))
}

/* ------------------------------------------------- AniList ---------------------------------------------------- */

/**
 * The variables of one results page (without page and perPage).
 * - A title is ordered by its own sort: the best matches, or the chosen sort alone (["SEARCH_MATCH", sort] would let the
 *   match decide and the sort chip do nothing).
 * - "Newest" without a status leaves out upcoming titles (desktop rule); a chosen status is always sent as chosen.
 * - AniList's averageScore is 0-100. The server multiplies the score for manga only, so anime get it ×10 here.
 */
export function searchVariables(state: SearchPhoneState, adultAllowed: boolean): AnilistListAnime_Variables | AnilistListManga_Variables {
    const title = state.title.trim()
    const sort = activeSearchSort(state)
    const tags = sentTags(state, adultAllowed)
    const variables: AnilistListAnime_Variables & AnilistListManga_Variables = {
        sort: [sort] as AL_MediaSort[],
        isAdult: adultOn(state, adultAllowed),
    }
    if (title) variables.search = title
    if (state.status) variables.status = [state.status]
    else if (sort === "START_DATE_DESC") variables.status = ["FINISHED", "RELEASING"]
    if (state.genres.length) variables.genres = state.genres
    if (tags.length) variables.tags = tags
    if (state.format) variables.format = state.format
    if (state.type === "anime") {
        if (state.season) variables.season = state.season
        if (state.year) variables.seasonYear = state.year
        if (state.minScore) variables.averageScore_greater = state.minScore * 10
    } else {
        if (state.year) variables.year = state.year
        if (state.country) variables.countryOfOrigin = state.country
        if (state.minScore) variables.averageScore_greater = state.minScore
    }
    return variables
}

type SearchPage<T> = { Page?: { media?: (T | null | undefined)[], pageInfo?: { currentPage?: number, hasNextPage?: boolean } } } | null | undefined

export function nextSearchPage(lastPage: SearchPage<unknown>, pages: unknown[]) {
    return lastPage?.Page?.pageInfo?.currentPage && lastPage.Page.pageInfo.hasNextPage ? pages.length + 1 : undefined
}

/** Every loaded result once: AniList repeats titles across pages when the order shifts between requests. */
export function uniqueMedia<T extends { id: number }>(pages: SearchPage<T>[] | undefined): T[] {
    const seen = new Set<number>()
    const media: T[] = []
    for (const page of pages ?? []) {
        for (const item of page?.Page?.media ?? []) {
            if (!item || seen.has(item.id)) continue
            seen.add(item.id)
            media.push(item)
        }
    }
    return media
}

/* --------------------------------------------------- Texts ---------------------------------------------------- */

/**
 * The desktop's results title, translated: "Trending Action manga", "Highest rated anime from Winter 2024";
 * a title search reads "Results for “frieren”". German puts the genres last ("Angesagte Manga: Action, Drama").
 */
export function searchTitle(t: Translate, state: SearchPhoneState) {
    const title = state.title.trim()
    if (title) return t(`Results for “${title}”`, `Treffer für „${title}“`)
    const sort = (SEARCH_SORTS.find(option => option.value === state.sort) ?? SEARCH_SORTS[0]).value
    const genres = state.genres.map(genre => genreLabel(t, genre)).join(", ")
    const subject = sortTitle(t, sort, state.type, genres)
    if (!state.season && !state.year) return subject
    // German names the genres last: "Bestbewertete Anime aus dem Herbst 2024: Action"
    const plain = sortTitle(t, sort, state.type, "")
    const genresAfter = genres ? `: ${genres}` : ""
    if (state.season) {
        const when = state.year ? seasonWithYear(t, state.season, state.year) : label(t, SEARCH_SEASONS, state.season)
        return t(`${subject} from ${when}`, `${plain} aus dem ${when}${genresAfter}`)
    }
    return t(`${subject} from ${state.year}`, `${plain} aus dem Jahr ${state.year}${genresAfter}`)
}

/** A sort's results title as one text per type, with the genres ("Action, Drama") in it when there are any. */
function sortTitle(t: Translate, sort: string, type: SearchType, genres: string): string {
    const anime = type === "anime"
    switch (sort) {
        case "TRENDING_DESC": return genres
            ? anime ? t(`Trending ${genres} anime`, `Angesagte Anime: ${genres}`) : t(`Trending ${genres} manga`, `Angesagte Manga: ${genres}`)
            : anime ? t("Trending anime", "Angesagte Anime") : t("Trending manga", "Angesagte Manga")
        case "POPULARITY_DESC": return genres
            ? anime ? t(`Popular ${genres} anime`, `Beliebte Anime: ${genres}`) : t(`Popular ${genres} manga`, `Beliebte Manga: ${genres}`)
            : anime ? t("Popular anime", "Beliebte Anime") : t("Popular manga", "Beliebte Manga")
        case "START_DATE_DESC": return genres
            ? anime ? t(`Newest ${genres} anime`, `Neueste Anime: ${genres}`) : t(`Newest ${genres} manga`, `Neueste Manga: ${genres}`)
            : anime ? t("Newest anime", "Neueste Anime") : t("Newest manga", "Neueste Manga")
        case "EPISODES_DESC": return genres
            ? t(`${genres} anime with the most episodes`, `Anime mit den meisten Folgen: ${genres}`)
            : t("Anime with the most episodes", "Anime mit den meisten Folgen")
        case "CHAPTERS_DESC": return genres
            ? t(`${genres} manga with the most chapters`, `Manga mit den meisten Kapiteln: ${genres}`)
            : t("Manga with the most chapters", "Manga mit den meisten Kapiteln")
        default: return genres
            ? anime ? t(`Highest rated ${genres} anime`, `Bestbewertete Anime: ${genres}`) : t(`Highest rated ${genres} manga`, `Bestbewertete Manga: ${genres}`)
            : anime ? t("Highest rated anime", "Bestbewertete Anime") : t("Highest rated manga", "Bestbewertete Manga")
    }
}

export type SearchFilterChip = {
    /** For removeSearchFilter: "genre:Action", "tag:Isekai", "format", "season", … */
    id: string
    label: string
    /** Read out after "Remove" when the label alone is unclear ("score 7+", "tag Isekai") */
    name: string
    kind: "genre" | "format" | "season" | "year" | "status" | "minScore" | "tag" | "country" | "adult"
}

/** One removable chip per active filter, in the order the sheet lists them. */
export function searchFilterChips(t: Translate, state: SearchPhoneState, adultAllowed: boolean): SearchFilterChip[] {
    const chips: SearchFilterChip[] = []
    const add = (kind: SearchFilterChip["kind"], id: string, text: string, name = text) => chips.push({ kind, id, label: text, name })
    for (const genre of state.genres) add("genre", `genre:${genre}`, genreLabel(t, genre))
    if (state.format) add("format", "format", label(t, [...SEARCH_ANIME_FORMATS, ...SEARCH_MANGA_FORMATS], state.format))
    if (state.season && state.type === "anime") add("season", "season", label(t, SEARCH_SEASONS, state.season))
    if (state.year) add("year", "year", String(state.year))
    if (state.status) add("status", "status", label(t, SEARCH_STATUSES, state.status))
    if (state.minScore) add("minScore", "minScore", `${state.minScore}+`, t(`score ${state.minScore}+`, `Wertung ${state.minScore}+`))
    for (const tag of sentTags(state, adultAllowed)) add("tag", `tag:${tag}`, `#${tag}`, t(`tag ${tag}`, `Tag ${tag}`))
    if (state.country && state.type === "manga") add("country", "country", label(t, SEARCH_COUNTRIES, state.country))
    if (adultOn(state, adultAllowed)) add("adult", "adult", t("Adult", "Ab 18"), t("adult filter", "Filter ab 18"))
    return chips
}

export function removeSearchFilter(state: SearchPhoneState, id: string): SearchPhoneState {
    if (id.startsWith("genre:")) return { ...state, genres: state.genres.filter(genre => genre !== id.slice(6)) }
    if (id.startsWith("tag:")) return { ...state, tags: state.tags.filter(tag => tag !== id.slice(4)) }
    switch (id) {
        case "format":
            return { ...state, format: null }
        case "season":
            return { ...state, season: null }
        case "year":
            return { ...state, year: null }
        case "status":
            return { ...state, status: null }
        case "minScore":
            return { ...state, minScore: null }
        case "country":
            return { ...state, country: null }
        case "adult":
            return { ...state, adult: false, tags: state.tags.filter(tag => !isAdultTag(tag)) }
        default:
            return state
    }
}

/* ------------------------------------------------ Result cards ------------------------------------------------ */

export type CardListData = { status?: AL_MediaListStatus, progress?: number, score?: number }

export type MangaChapterData = {
    latestChapterNumbers: Record<number, Manga_MangaLatestChapterNumberItem[]>
    storedProviders: Record<string, string>
    storedFilters: Record<string, MangaEntryFilters>
}

export type ResultCardFacts = {
    /** Under the title: list status and year in the accent when the title is on a list (as on Discover), else when and in what form */
    meta: string
    onList: boolean
    /** Plain mark on the cover: the progress, else airing / upcoming */
    tag?: string
    /** Accent mark on the cover: new episodes or chapters, else the user's score */
    badge?: string
    /** Accessible name: the title, then what the cover and the line show, in words */
    label: string
}

const count = (n: number, one: string, many: string) => n === 1 ? one : many

/**
 * What a result card shows. Series by season ("Fall 2024"), any other form by name and year ("Movie · 2022", "One shot · 2017"),
 * manga by start year; `unseen` counts new episodes or chapters, `local` marks local files.
 */
export function resultCardFacts(t: Translate, type: SearchType, media: AL_BaseAnime | AL_BaseManga, list: CardListData | undefined,
    { unseen = 0, local = false }: { unseen?: number, local?: boolean } = {}): ResultCardFacts {
    const anime = media as AL_BaseAnime
    const year = (type === "anime" ? anime.seasonYear : undefined) || media.startDate?.year || undefined
    const season = type === "anime" ? find(SEARCH_SEASONS, anime.season) : undefined
    const seasonYear = season && year ? seasonWithYear(t, season.value, year) : [season && t(season.en, season.de), year].filter(Boolean).join(" ")
    const format = media.format ? label(t, [...SEARCH_ANIME_FORMATS, ...SEARCH_MANGA_FORMATS], media.format) : ""
    const series = !media.format || media.format === (type === "anime" ? "TV" : "MANGA")
    const when = series ? seasonYear : [format, year].filter(Boolean).join(" · ")

    const status = listStatusLabel(t, type, list?.status)
    const progress = list?.progress ?? 0
    const total = (type === "anime" ? anime.episodes : (media as AL_BaseManga).chapters) ?? 0
    const release = media.status === "RELEASING" || media.status === "NOT_YET_RELEASED" ? label(t, SEARCH_STATUSES, media.status) : ""
    const score = Math.round(list?.score ?? 0) / 10
    const scoreText = t(String(score), String(score).replace(".", ","))

    const done = !progress ? "" : type === "anime"
        ? total ? t(`${progress} of ${total} episodes watched`, `${progress} von ${total} Folgen gesehen`)
            : t(count(progress, "1 episode watched", `${progress} episodes watched`), count(progress, "1 Folge gesehen", `${progress} Folgen gesehen`))
        : total ? t(`${progress} of ${total} chapters read`, `${progress} von ${total} Kapiteln gelesen`)
            : t(count(progress, "1 chapter read", `${progress} chapters read`), `${progress} Kapitel gelesen`)
    const fresh = !unseen ? "" : type === "anime"
        ? t(count(unseen, "1 new episode", `${unseen} new episodes`), count(unseen, "1 neue Folge", `${unseen} neue Folgen`))
        : t(count(unseen, "1 new chapter", `${unseen} new chapters`), count(unseen, "1 neues Kapitel", `${unseen} neue Kapitel`))

    return {
        meta: status ? [status, year].filter(Boolean).join(" · ") : when,
        onList: !!status,
        tag: progress > 0 ? `${progress}/${total || "–"}` : release || undefined,
        badge: unseen > 0 ? t(`${unseen} new`, `${unseen} neu`) : score > 0 ? `★ ${scoreText}` : undefined,
        label: [media.title?.userPreferred || media.title?.romaji || media.title?.english, status, done, fresh,
            score > 0 && t(`your score ${scoreText}`, `deine Wertung ${scoreText}`), local && t("in your library", "in deiner Bibliothek"),
            [seasonYear, format].filter(Boolean).join(", "), release].filter(Boolean).join(", "),
    }
}

/**
 * New episodes or chapters as the desktop card counts them, where the theme settings show them: episodes of an anime being
 * watched (from the local files when there are any, else the aired ones), chapters of a manga on a list whose latest
 * chapter is known.
 */
export function unseenCount(type: SearchType, media: AL_BaseAnime | AL_BaseManga, list: CardListData | undefined, options: {
    anime: boolean
    manga: boolean
    library?: { mainFileCount?: number, unwatchedCount?: number }
    chapters?: MangaChapterData
}) {
    const progress = list?.progress ?? 0
    if (type === "anime") {
        if (!options.anime || (list?.status !== "CURRENT" && list?.status !== "REPEATING")) return 0
        return Math.max(0, options.library?.mainFileCount ? options.library.unwatchedCount ?? 0 : anilist_getCurrentEpisodes(media as AL_BaseAnime) - progress)
    }
    if (!options.manga || !list?.status || !options.chapters) return 0
    const { latestChapterNumbers, storedProviders, storedFilters } = options.chapters
    const unread = getMangaEntryUnreadState(media.id, progress, latestChapterNumbers, storedProviders, storedFilters)
    return unread.known ? unread.unread : 0
}

/** What a screen reader hears once a new search has loaded (not each further page). */
export function searchAnnouncement(t: Translate, type: SearchType, loaded: number, more: boolean) {
    if (!loaded) return type === "anime" ? t("No anime match", "Keine passenden Anime") : t("No manga match", "Keine passenden Manga")
    if (more) return t(`More than ${loaded} results`, `Mehr als ${loaded} Ergebnisse`)
    return t(count(loaded, "1 result", `${loaded} results`), count(loaded, "1 Ergebnis", `${loaded} Ergebnisse`))
}

/* ---------------------------------------------------- Tags ---------------------------------------------------- */

const SEARCH_TAGS_SHOWN = 30

/**
 * Tag chips of the filter sheet: the selected ones first (always, so they can be undone), then the matches of the
 * query (names starting with it first), the first 30 unless all are asked for. `total` counts every match.
 */
export function searchTagChoices({ query, adult, selected, all }: { query: string, adult: boolean, selected: string[], all: boolean }) {
    const q = query.trim().toLowerCase()
    const matches = ADVANCED_SEARCH_MEDIA_TAGS.filter(tag => (adult || !tag.isAdult) && (!q || tag.name.toLowerCase().includes(q)))
    if (q) matches.sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)))
    const rest = matches.map(tag => tag.name).filter(name => !selected.includes(name))
    return { tags: [...selected, ...(all ? rest : rest.slice(0, SEARCH_TAGS_SHOWN))], total: matches.length, more: !all && rest.length > SEARCH_TAGS_SHOWN }
}
