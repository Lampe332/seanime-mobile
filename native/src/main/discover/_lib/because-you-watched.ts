import type { AL_AnimeCollection_MediaListCollection_Lists, AL_AnimeCollection_MediaListCollection_Lists_Entries, AL_BaseAnime } from "@/api/generated/types"

/*
 * "Because you watched {title}" rows on Discover: AniList's recommendations to anime the user finished lately, without
 * titles already on any of their lists. Pure logic; the hook (discover-phone-hooks.ts) asks for the recommendations.
 */

/** At most this many source titles: as many rows and as many extra requests */
export const BECAUSE_MAX_SOURCES = 2
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

/** When the title was finished, in seconds: the completion date, else the entry's last change */
function finishedAt(entry: Entry): number {
    const date = entry.completedAt
    if (date?.year) return Date.UTC(date.year, (date.month || 1) - 1, date.day || 1) / 1000
    return entry.updatedAt ?? 0
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
    const newestFirst = (a: Entry, b: Entry) => finishedAt(b) - finishedAt(a) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
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

/**
 * The rows to show, in the order of the sources: recommendations not on any list, no adult titles unless allowed, each
 * title only in the first row that shows it, at most 20. A row with fewer than 4 titles or a failed request is left out.
 * A row waits while one before it loads, so its titles do not change when the earlier row arrives.
 */
export function becauseRows(sources: BecauseSource[], listed: Set<number>, allowAdult: boolean): BecauseRow[] {
    const shown = new Set<number>()
    const rows: BecauseRow[] = []
    let waiting = false
    for (const { source, recommendations } of sources) {
        if (recommendations === null) continue
        if (waiting || recommendations === undefined) {
            waiting = true
            rows.push({ source, items: undefined })
            continue
        }
        const items: AL_BaseAnime[] = []
        const inRow = new Set<number>()
        for (const media of recommendations) {
            if (!media?.id || listed.has(media.id) || shown.has(media.id) || inRow.has(media.id)) continue
            if (media.isAdult && !allowAdult) continue
            inRow.add(media.id)
            items.push(media)
            if (items.length === BECAUSE_MAX_ITEMS) break
        }
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
