import type { AL_AnimeCollection_MediaListCollection_Lists, AL_AnimeCollection_MediaListCollection_Lists_Entries, AL_BaseAnime } from "@/api/generated/types"

/*
 * "Because you watched {title}" rows on Discover: AniList's recommendations to anime the user finished lately, without
 * titles already on any of their lists. Pure logic; the hook (discover-phone-hooks.ts) asks for the recommendations.
 */

/**
 * At most this many candidate titles, asked for in turn: a long-time watcher has most recommendations of the last titles
 * on a list already, so a thin or failed row passes on to the next candidate (becauseFetchCount)
 */
export const BECAUSE_MAX_SOURCES = 6
/** At most this many rows, and so at most this many requests open at once */
export const BECAUSE_MAX_ROWS = 2
/** At most this many covers a row */
export const BECAUSE_MAX_ITEMS = 20
/** A row with fewer titles is not shown */
export const BECAUSE_MIN_ITEMS = 4

type Lists = (AL_AnimeCollection_MediaListCollection_Lists | null | undefined)[] | null | undefined
type Entry = AL_AnimeCollection_MediaListCollection_Lists_Entries

/** Scores of at least this (0..100) or none make a title a preferred source */
const LIKED_SCORE = 70
/** Titles scored below this are never a source */
const DISLIKED_SCORE = 50

function entriesOf(lists: Lists): Entry[] {
    return (lists ?? []).flatMap(list => list?.entries ?? []).filter((entry): entry is Entry => !!entry?.media?.id)
}

/** Every anime on the user's lists, whatever the status */
export function listedIds(lists: Lists): Set<number> {
    return new Set(entriesOf(lists).map(entry => entry.media!.id))
}

/** A calendar day of the device as one number, so that a completion date and a last change compare on one line */
function dayNumber(year: number, month: number, day: number): number {
    return Date.UTC(year, month - 1, day) / 86_400_000
}

/**
 * When the title was finished, as a day: the completion date, else the day of the entry's last change. A completion date
 * has no time, so a day is the common measure (a change later that day is no later watching).
 */
function finishedDay(entry: Entry): number {
    const date = entry.completedAt
    if (date?.year) return dayNumber(date.year, date.month || 1, date.day || 1)
    if (!entry.updatedAt) return 0
    const changed = new Date(entry.updatedAt * 1000)
    return dayNumber(changed.getFullYear(), changed.getMonth() + 1, changed.getDate())
}

/**
 * The titles the rows start from: completed anime, newest first; liked or unscored ones before those scored 50 to 69,
 * never one scored below 50; adult titles only when the user turned them on.
 */
export function pickSources(lists: Lists, allowAdult: boolean): AL_BaseAnime[] {
    const seen = new Set<number>()
    const completed = entriesOf(lists).filter(entry => {
        if (entry.status !== "COMPLETED" || seen.has(entry.media!.id)) return false
        seen.add(entry.media!.id)
        const score = entry.score ?? 0
        return (score === 0 || score >= DISLIKED_SCORE) && (allowAdult || !entry.media!.isAdult)
    })
    // the same day: a title with its completion date first, then the later change
    const dated = (entry: Entry) => (entry.completedAt?.year ? 1 : 0)
    const newestFirst = (a: Entry, b: Entry) => finishedDay(b) - finishedDay(a) || dated(b) - dated(a) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
    const liked = (entry: Entry) => !entry.score || entry.score >= LIKED_SCORE
    return [...completed.filter(liked).sort(newestFirst), ...completed.filter(entry => !liked(entry)).sort(newestFirst)]
        .slice(0, BECAUSE_MAX_SOURCES)
        .map(entry => entry.media!)
}

export type BecauseSource = {
    source: AL_BaseAnime
    /** AniList's recommendations in its order; undefined while they load, null when they failed */
    recommendations: (AL_BaseAnime | null | undefined)[] | null | undefined
}

export type BecauseRow = {
    source: AL_BaseAnime
    /** The covers; undefined while this row (or one before it) still loads */
    items: AL_BaseAnime[] | undefined
}

/** One row's titles: not on any list, not in an earlier row (`shown`), no adult ones unless allowed, at most 20 */
function rowItems(recommendations: (AL_BaseAnime | null | undefined)[], listed: Set<number>, shown: Set<number>, allowAdult: boolean) {
    const items: AL_BaseAnime[] = []
    const inRow = new Set<number>()
    for (const media of recommendations) {
        if (!media?.id || listed.has(media.id) || shown.has(media.id) || inRow.has(media.id)) continue
        if (media.isAdult && !allowAdult) continue
        inRow.add(media.id)
        items.push(media)
        if (items.length === BECAUSE_MAX_ITEMS) break
    }
    return items
}

/**
 * How many candidates from the front to ask for, given what came back so far (`results[i]` the recommendations of
 * candidate i; undefined while it loads or before it is asked for): the next one only while the rows done plus those
 * loading are fewer than two, so normally two requests, never more than two open, at worst all six.
 */
export function becauseFetchCount(results: BecauseSource["recommendations"][], listed: Set<number>, allowAdult: boolean): number {
    const shown = new Set<number>()
    let rows = 0
    for (let index = 0; index < results.length; index++) {
        if (rows >= BECAUSE_MAX_ROWS) return index
        const recommendations = results[index]
        if (recommendations === null) continue
        if (recommendations === undefined) {
            rows++
            continue
        }
        const items = rowItems(recommendations, listed, shown, allowAdult)
        if (items.length < BECAUSE_MIN_ITEMS) continue
        items.forEach(media => shown.add(media.id))
        rows++
    }
    return results.length
}

/**
 * The rows to show, at most two, in the order of the candidates asked for: recommendations not on any list, no adult
 * titles unless allowed, each title only in the first row that shows it, at most 20. A row with fewer than 4 titles or a
 * failed request is left out. A row waits while one before it loads, so its titles do not change when the earlier row
 * arrives; once every candidate is through, only real rows are left.
 */
export function becauseRows(sources: BecauseSource[], listed: Set<number>, allowAdult: boolean): BecauseRow[] {
    const shown = new Set<number>()
    const rows: BecauseRow[] = []
    let waiting = false
    for (const { source, recommendations } of sources) {
        if (rows.length >= BECAUSE_MAX_ROWS) break
        if (recommendations === null) continue
        if (waiting || recommendations === undefined) {
            waiting = true
            rows.push({ source, items: undefined })
            continue
        }
        const items = rowItems(recommendations, listed, shown, allowAdult)
        if (items.length < BECAUSE_MIN_ITEMS) continue
        items.forEach(media => shown.add(media.id))
        rows.push({ source, items })
    }
    return rows
}

/** The title as the cards show it: the user's preferred language first */
export function sourceTitle(media: AL_BaseAnime): string {
    return media.title?.userPreferred || media.title?.romaji || media.title?.english || ""
}
