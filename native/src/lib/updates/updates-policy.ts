import { type AppLanguage, translate, type Translate } from "@/lib/app-language"
import { formatDate } from "@/lib/i18n/format"
// geschrieben nach: Plan „Updates-Seite + Benachrichtigung neue Manga-Kapitel“ (belege 2026-11-15 P-plan, Vorbild Mihon/Kotatsu-Updates), den App-Typen Anime_ScheduleItem/Manga_Collection und core/manga/library.ts (chapterNumberOf); eigene Regel

import { chapterNumberOf } from "@/core/manga/library"

/*
 * What the Updates page lists and what the chapter check notifies about. Pure, so it can be unit tested.
 * Episodes come from the list's airing schedule (GET /library/schedule) for anime on Watching/Planning; chapters from the
 * chapter check, which compares a manga's fresh chapter list with the highest chapter it knew before. "Since your last
 * visit" is a local timestamp only; nothing here touches AniList.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** How far back the page looks; also the baseline of the very first visit */
export const UPDATES_WINDOW_MS = 7 * DAY_MS
/** How long found chapters stay in the feed */
export const CHAPTER_FEED_KEEP_MS = 30 * DAY_MS
/** At most this many chapters of one manga at once (a source that renumbered must not flood the feed) */
export const MAX_CHAPTERS_PER_MANGA = 20

export type UpdateItem = {
    key: string
    kind: "episode" | "chapter"
    mediaId: number
    title: string
    image?: string
    /** episode or chapter number */
    number: number
    /** when it aired or was found, epoch ms */
    at: number
}

export type ScheduleLike = { mediaId: number, title: string, image?: string, episodeNumber: number, dateTime?: string }

const EPISODE_STATUSES = new Set(["CURRENT", "PLANNING", "REPEATING"])
const READING_STATUSES = new Set(["CURRENT", "REPEATING"])

type ListLike = { status?: string | null, entries?: ({ status?: string | null, media?: { id?: number } | null } | null)[] | null }

/** media id → list status of an AniList collection (AL_AnimeCollection) */
export function listStatuses(collection: { MediaListCollection?: { lists?: (ListLike | null)[] | null } | null } | null | undefined): Record<number, string> {
    const out: Record<number, string> = {}
    for (const list of collection?.MediaListCollection?.lists ?? []) {
        for (const entry of list?.entries ?? []) {
            const id = entry?.media?.id
            const status = entry?.status ?? list?.status
            if (typeof id === "number" && status) out[id] = status
        }
    }
    return out
}

/** Episodes of anime on Watching/Planning (and rewatching) that aired in the window up to now */
export function episodeUpdates(schedule: readonly ScheduleLike[], statuses: Record<number, string>, now: number, windowMs: number = UPDATES_WINDOW_MS): UpdateItem[] {
    const out: UpdateItem[] = []
    for (const item of schedule) {
        const at = item.dateTime ? Date.parse(item.dateTime) : NaN
        if (!Number.isFinite(at) || at > now || at <= now - windowMs) continue
        if (!EPISODE_STATUSES.has(statuses[item.mediaId] ?? "")) continue
        out.push({ key: `e-${item.mediaId}-${item.episodeNumber}`, kind: "episode", mediaId: item.mediaId, title: item.title, image: item.image || undefined, number: item.episodeNumber, at })
    }
    return out
}

/** The highest chapter number of a chapter list (0: none readable) */
export function highestChapter(chapters: readonly { chapter?: unknown }[]): number {
    return chapters.reduce<number>((highest, item) => Math.max(highest, chapterNumberOf(item.chapter)), 0)
}

/**
 * Chapter numbers above the one known before, ascending, the newest MAX_CHAPTERS_PER_MANGA. Without a known number the
 * manga is new to the check: its list is the baseline and nothing counts as new.
 */
export function newChapterNumbers(known: number | undefined, chapters: readonly { chapter?: unknown }[], max: number = MAX_CHAPTERS_PER_MANGA): number[] {
    if (known === undefined) return []
    const numbers = new Set<number>()
    for (const item of chapters) {
        const number = chapterNumberOf(item.chapter)
        if (number > known) numbers.add(number)
    }
    return [...numbers].sort((a, b) => a - b).slice(-max)
}

export type MangaCandidate = { mediaId: number, title: string, image?: string, provider: string }

type MangaListLike = {
    status?: string | null
    entries?: ({ mediaId: number, media?: { status?: string | null, title?: { userPreferred?: string | null } | null, coverImage?: { large?: string | null, medium?: string | null } | null } | null } | null)[] | null
}

/** The provider of a manga without its own choice: the default from the settings when installed, else the first by name (as handle-manga-selected-provider.ts) */
export function fallbackProvider(installed: readonly { id: string, name?: string }[], defaultId?: string | null): string | null {
    const usable = installed.filter(item => item.id !== "local-manga")
    if (defaultId && usable.some(item => item.id === defaultId)) return defaultId
    const sorted = [...usable].sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id))
    return sorted[0]?.id ?? null
}

/**
 * Manga worth checking: on Reading (or rereading), still publishing (not finished or cancelled), with an installed
 * online source (the manga's own choice, else the fallback). Local manga are not checked.
 */
export function mangaCandidates(lists: readonly (MangaListLike | null)[], chosen: Record<number, string>, installed: readonly string[], fallback: string | null): MangaCandidate[] {
    const out: MangaCandidate[] = []
    const seen = new Set<number>()
    for (const list of lists) {
        if (!READING_STATUSES.has(list?.status ?? "")) continue
        for (const entry of list?.entries ?? []) {
            if (!entry || seen.has(entry.mediaId)) continue
            const status = entry.media?.status
            if (status === "FINISHED" || status === "CANCELLED") continue
            const own = chosen[entry.mediaId]
            const provider = own && installed.includes(own) ? own : fallback
            if (!provider || provider === "local-manga") continue
            seen.add(entry.mediaId)
            out.push({
                mediaId: entry.mediaId,
                title: entry.media?.title?.userPreferred || String(entry.mediaId),
                image: entry.media?.coverImage?.large || entry.media?.coverImage?.medium || undefined,
                provider,
            })
        }
    }
    return out
}

/** The candidates not checked for minAgeMs, longest unchecked first, at most max (rate limits: a few sources per run) */
export function dueCandidates<T extends { mediaId: number }>(candidates: readonly T[], checkedAt: Record<number, number>, now: number, minAgeMs: number, max: number): T[] {
    return candidates
        .filter(item => now - (checkedAt[item.mediaId] ?? 0) >= minAgeMs || (checkedAt[item.mediaId] ?? 0) > now)
        .sort((a, b) => (checkedAt[a.mediaId] ?? 0) - (checkedAt[b.mediaId] ?? 0))
        .slice(0, max)
}

/** Feed items of new chapters, found at `at` */
export function chapterItems(manga: { mediaId: number, title: string, image?: string }, numbers: readonly number[], at: number): UpdateItem[] {
    return numbers.map(number => ({ key: `c-${manga.mediaId}-${number}`, kind: "chapter" as const, mediaId: manga.mediaId, title: manga.title, image: manga.image, number, at }))
}

/** The kept feed with the found items: one item per key (the first find stays), newest first, old ones dropped */
export function mergeFeed(feed: readonly UpdateItem[], added: readonly UpdateItem[], now: number, keepMs: number = CHAPTER_FEED_KEEP_MS): UpdateItem[] {
    const byKey = new Map<string, UpdateItem>()
    for (const item of [...feed, ...added]) if (!byKey.has(item.key)) byKey.set(item.key, item)
    return newestFirst([...byKey.values()].filter(item => item.at > now - keepMs))
}

export function newestFirst(items: readonly UpdateItem[]): UpdateItem[] {
    return [...items].sort((a, b) => b.at - a.at || a.title.localeCompare(b.title) || b.number - a.number)
}

/** The baseline "since": the last visit, or the window on the very first one */
export function sinceOf(lastVisit: number, now: number): number {
    return lastVisit > 0 ? lastVisit : now - UPDATES_WINDOW_MS
}

/** How many items are newer than `since` (the Menu's count) */
export function newCount(items: readonly UpdateItem[], since: number): number {
    return items.filter(item => item.at > since).length
}

/** Local calendar day "yyyy-MM-dd" of a time */
export function dayKey(at: number): string {
    const date = new Date(at)
    const pad = (value: number) => String(value).padStart(2, "0")
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** The items by local day, newest day first, each day newest first */
export function groupByDay(items: readonly UpdateItem[]): { day: string, items: UpdateItem[] }[] {
    const groups: { day: string, items: UpdateItem[] }[] = []
    for (const item of newestFirst(items)) {
        const day = dayKey(item.at)
        const last = groups[groups.length - 1]
        if (last?.day === day) last.items.push(item)
        else groups.push({ day, items: [item] })
    }
    return groups
}

/** The notification's title in the app language: "New chapter: <title> Ch. N", "New chapters: <title> Ch. 11–13" */
export function chapterNotice(title: string, numbers: readonly number[], t: Translate): string {
    if (numbers.length === 0) return title
    const low = Math.min(...numbers)
    const high = Math.max(...numbers)
    return low === high
        ? t(`New chapter: ${title} Ch. ${high}`, `Neues Kapitel: ${title} Kap. ${high}`)
        : t(`New chapters: ${title} Ch. ${low}–${high}`, `Neue Kapitel: ${title} Kap. ${low}–${high}`)
}

/** A day's heading: "Today", "Yesterday" or the date in the app's language (not the device's), "Friday, November 13" / "Freitag, 13. November" */
export function dayLabel(day: string, now: number, language: AppLanguage): string {
    if (day === dayKey(now)) return translate(language, "Today", "Heute")
    if (day === dayKey(now - DAY_MS)) return translate(language, "Yesterday", "Gestern")
    const [year, month, date] = day.split("-").map(Number)
    return formatDate(new Date(year, month - 1, date), language, "weekdayDayMonth")
}
