import {
    AL_AnimeCollection_MediaListCollection_Lists,
    AL_BaseAnime,
    AL_BaseManga,
    AL_MangaCollection_MediaListCollection_Lists,
    Nullish,
} from "@/api/generated/types"

/** Pure helpers of the yearly review ("Wrapped"): what the user finished in one year, counted from their own lists. */

/** An anime of the user's lists; the main studios come with the lists since the collection query asks for them (older saved lists have none) */
export type WrappedAnime = AL_BaseAnime & { studios?: Nullish<{ nodes?: Nullish<Nullish<{ id?: number, name?: string }>[]> }> }
export type WrappedAnimeList = AL_AnimeCollection_MediaListCollection_Lists
export type WrappedMangaList = AL_MangaCollection_MediaListCollection_Lists
export type WrappedOptions = { showAdult: boolean, titleOf?: (media: WrappedAnime) => string }

/** score 0..100, 0 = not rated; completed = ISO date YYYY-MM-DD; private = a private list entry, adult = an adult title (both never named in the shared image) */
export type WrappedTitle = {
    id: number, title: string, cover?: string, color?: string, score: number, episodes: number, completed?: string, format?: string,
    private?: boolean, adult?: boolean,
}
/** share = part of the year's titles, 0..1 */
export type WrappedCount = { name: string, count: number, share: number }
export type WrappedView = {
    year: number, years: number[], empty: boolean,
    titles: number, episodes: number, minutes: number, meanScore: number | null,
    genres: WrappedCount[], studios: WrappedCount[], formats: WrappedCount[],
    topRated: WrappedTitle[], first?: WrappedTitle, last?: WrappedTitle, longest?: WrappedTitle,
    /** The best rated that may be named in the shared image: up to 3, neither private nor adult */
    shareable: WrappedTitle[],
    /** Finished anime without a completion date (any year): not counted in any year */
    undated: number,
    months: number[], busiestMonth: number | null,
    manga: { titles: number, chapters: number } | null,
}

type DateParts = Nullish<{ year?: Nullish<number>, month?: Nullish<number>, day?: Nullish<number> }>
type AnyEntry = {
    status?: Nullish<string>, progress?: Nullish<number>, score?: Nullish<number>, private?: Nullish<boolean>,
    startedAt?: DateParts, completedAt?: DateParts, updatedAt?: Nullish<number>,
    media?: Nullish<AL_BaseAnime | AL_BaseManga>,
}
type AnyList = Nullish<{ entries?: Nullish<Nullish<AnyEntry>[]> }>

const DEFAULT_DURATION = 24
const ONGOING = new Set(["CURRENT", "PAUSED", "DROPPED"])

/**
 * The year a finished entry counts for: the year of its completion date. Null when it is not finished or has no such
 * date (the last edit is no stand-in: any later change, or an imported list, would move it into that year).
 */
function finishedYear(entry: AnyEntry): number | null {
    if (entry.status !== "COMPLETED" && entry.status !== "REPEATING") return null
    return entry.completedAt?.year || null
}

function shown(entry: Nullish<AnyEntry>, showAdult: boolean): entry is AnyEntry & { media: AL_BaseAnime | AL_BaseManga } {
    if (!entry?.media?.id) return false
    return showAdult || !entry.media.isAdult
}

/** Each title once (a title can stand in several custom lists): the first entry of a media id that passes `keep` */
function uniqueEntries<T>(lists: Nullish<AnyList[]>, showAdult: boolean, keep: (entry: AnyEntry) => boolean, seen = new Set<number>()) {
    const out: (AnyEntry & { media: T & { id: number } })[] = []
    for (const list of lists ?? []) {
        for (const entry of list?.entries ?? []) {
            if (!shown(entry, showAdult) || seen.has(entry.media.id) || !keep(entry)) continue
            seen.add(entry.media.id)
            out.push(entry as AnyEntry & { media: T & { id: number } })
        }
    }
    return out
}

function isoDate(date: DateParts): string | undefined {
    if (!date?.year || !date.month || !date.day) return undefined
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${String(date.year).padStart(4, "0")}-${pad(date.month)}-${pad(date.day)}`
}

function defaultTitle(media: WrappedAnime) {
    const title = media.title
    return title?.userPreferred || title?.romaji || title?.english || title?.native || ""
}

function counted(values: Map<string, number>, titles: number, limit?: number): WrappedCount[] {
    const sorted = [...values.entries()]
        .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0))
        .map(([name, count]) => ({ name, count, share: titles ? count / titles : 0 }))
    return limit === undefined ? sorted : sorted.slice(0, limit)
}

function add(values: Map<string, number>, names: Iterable<Nullish<string>>) {
    for (const name of new Set(names)) if (name) values.set(name, (values.get(name) ?? 0) + 1)
}

/** Every year with at least one finished anime, newest first */
export function wrappedYears(animeLists: Nullish<Nullish<WrappedAnimeList>[]>, mangaLists?: Nullish<Nullish<WrappedMangaList>[]>, options: { showAdult: boolean } = { showAdult: false }): number[] {
    void mangaLists
    const years = new Set<number>()
    for (const entry of uniqueEntries<WrappedAnime>(animeLists, options.showAdult, e => finishedYear(e) !== null)) years.add(finishedYear(entry)!)
    return [...years].sort((a, b) => b - a)
}

/** Finished anime without a completion date, each title once: they count in no year */
export function wrappedUndated(animeLists: Nullish<Nullish<WrappedAnimeList>[]>, options: { showAdult: boolean } = { showAdult: false }): number {
    return uniqueEntries<WrappedAnime>(animeLists, options.showAdult, e => e.status === "COMPLETED" && !e.completedAt?.year).length
}

/** The review of one year: what was finished in it (and the episodes of titles started in it) */
export function getWrappedView(
    animeLists: Nullish<Nullish<WrappedAnimeList>[]>,
    mangaLists: Nullish<Nullish<WrappedMangaList>[]>,
    year: number,
    options: WrappedOptions,
): WrappedView {
    const { showAdult } = options
    const titleOf = options.titleOf ?? defaultTitle
    const seen = new Set<number>()
    const finished = uniqueEntries<WrappedAnime>(animeLists, showAdult, e => finishedYear(e) === year, seen)
    const started = uniqueEntries<WrappedAnime>(animeLists, showAdult, e => ONGOING.has(e.status ?? "") && e.startedAt?.year === year, seen)

    const minutesOf = (media: WrappedAnime, episodes: number) => episodes * (media.duration || DEFAULT_DURATION)
    let episodes = 0
    let minutes = 0
    const scores: number[] = []
    const genres = new Map<string, number>()
    const studios = new Map<string, number>()
    const formats = new Map<string, number>()
    const months = Array.from({ length: 12 }, () => 0)
    const items: WrappedTitle[] = []

    for (const entry of finished) {
        const media = entry.media
        // a rewatch's progress is only the running round; the title was finished as a whole
        const count = entry.status === "REPEATING" ? media.episodes || entry.progress || 0 : entry.progress || media.episodes || 0
        const score = entry.score && entry.score > 0 ? entry.score : 0
        episodes += count
        minutes += minutesOf(media, count)
        if (score) scores.push(score)
        add(genres, media.genres ?? [])
        add(studios, (media.studios?.nodes ?? []).map(node => node?.name))
        add(formats, [media.format])
        const month = entry.completedAt?.month
        if (entry.completedAt?.year && month && month >= 1 && month <= 12) months[month - 1]++
        const cover = media.coverImage
        items.push({
            id: media.id,
            title: titleOf(media),
            cover: cover?.large || cover?.extraLarge || cover?.medium || undefined,
            color: cover?.color || undefined,
            score,
            episodes: count,
            completed: entry.completedAt?.year === year ? isoDate(entry.completedAt) : undefined,
            format: media.format || undefined,
            ...(entry.private ? { private: true } : {}),
            ...(media.isAdult ? { adult: true } : {}),
        })
    }
    for (const entry of started) {
        const count = entry.progress || 0
        episodes += count
        minutes += minutesOf(entry.media, count)
    }

    const byDateDesc = (a: WrappedTitle, b: WrappedTitle) => (b.completed ?? "").localeCompare(a.completed ?? "")
    const rated = items.filter(item => item.score > 0).sort((a, b) => b.score - a.score || byDateDesc(a, b))
    const topRated = rated.slice(0, 5)
    const shareable = rated.filter(item => !item.private && !item.adult).slice(0, 3)
    const dated = items.filter(item => item.completed)
    const first = dated.reduce<WrappedTitle | undefined>((best, item) => (!best || item.completed! < best.completed! ? item : best), undefined)
    const last = dated.reduce<WrappedTitle | undefined>((best, item) => (!best || item.completed! > best.completed! ? item : best), undefined)
    const longest = items.reduce<WrappedTitle | undefined>((best, item) => (item.episodes > (best?.episodes ?? 0) ? item : best), undefined)
    const most = Math.max(...months)

    let manga: WrappedView["manga"] = null
    if (mangaLists) {
        const read = uniqueEntries<AL_BaseManga>(mangaLists, showAdult, e => finishedYear(e) === year)
        if (read.length) manga = { titles: read.length, chapters: read.reduce((sum, e) => sum + (e.progress || e.media.chapters || 0), 0) }
    }

    return {
        year,
        years: wrappedYears(animeLists, mangaLists, { showAdult }),
        empty: items.length === 0,
        titles: items.length,
        episodes,
        minutes,
        meanScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
        genres: counted(genres, items.length, 5),
        studios: counted(studios, items.length, 5),
        formats: counted(formats, items.length),
        topRated,
        shareable,
        undated: wrappedUndated(animeLists, { showAdult }),
        first,
        last,
        longest,
        months,
        busiestMonth: most > 0 ? months.indexOf(most) : null,
        manga,
    }
}
