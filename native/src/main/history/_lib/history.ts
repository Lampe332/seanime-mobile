// geschrieben nach: Mihon/Kotatsu Verlauf (zuletzt gelesen, nach Tag gruppiert), Kern-Route GET /api/v1/continuity/history (playback.ts) und dem Manga-Lesestand der App (manga-chapter-reader.atoms.ts)

import type { Continuity_WatchHistory } from "@/api/generated/types"
import { type AppLanguage, translate } from "@/lib/app-language"
import { formatDate, formatTime } from "@/lib/i18n/format"
import type { MangaReaderResumeLocation } from "@/main/manga/_lib/manga-chapter-reader.atoms"

/*
 * The History screen without the screen: what was watched (the core's watch history, one row per anime) and read (the
 * reader's resume page, one per manga), newest first, in days ("Today", "Yesterday", a date).
 */

export type HistoryEntry = {
    kind: "anime" | "manga"
    mediaId: number
    /** episode or chapter as shown; "" when the player or the reader did not note its number */
    number: string
    /** when, in ms */
    at: number
    /** anime: seconds watched of the episode and its length */
    currentTime?: number
    duration?: number
    /** manga: the page (from 0) */
    pageIndex?: number
}

export function animeHistory(history: Continuity_WatchHistory | null | undefined): HistoryEntry[] {
    return Object.values(history ?? {}).flatMap(item => {
        const at = Date.parse(item?.timeUpdated ?? "")
        if (!item?.mediaId || !Number.isFinite(at)) return []
        return [{ kind: "anime" as const, mediaId: item.mediaId, number: typeof item.episodeNumber === "number" ? String(item.episodeNumber) : "", at, currentTime: item.currentTime, duration: item.duration }]
    })
}

export function mangaHistory(locations: Record<string, MangaReaderResumeLocation> | null | undefined): HistoryEntry[] {
    return Object.entries(locations ?? {}).flatMap(([key, location]) => {
        const mediaId = Number(key)
        if (!Number.isInteger(mediaId) || mediaId <= 0 || !Number.isFinite(location?.updatedAt)) return []
        return [{ kind: "manga" as const, mediaId, number: location.chapterNumber ?? "", at: location.updatedAt, pageIndex: location.pageIndex }]
    })
}

/** Both, newest first */
export function historyEntries(anime: HistoryEntry[], manga: HistoryEntry[]): HistoryEntry[] {
    return [...anime, ...manga].sort((a, b) => b.at - a.at)
}

export type HistoryDay = { key: string, label: string, entries: HistoryEntry[] }

const dayKey = (time: number) => {
    const date = new Date(time)
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

/** The entries (newest first) in days of the device's time zone */
export function groupByDay(entries: HistoryEntry[], now: number, language: AppLanguage): HistoryDay[] {
    const today = dayKey(now)
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    const thisYear = new Date(now).getFullYear()
    const days: HistoryDay[] = []
    for (const entry of entries) {
        const key = dayKey(entry.at)
        let day = days[days.length - 1]
        if (!day || day.key !== key) {
            const date = new Date(entry.at)
            const label = key === today ? translate(language, "Today", "Heute")
                : key === dayKey(yesterday.getTime()) ? translate(language, "Yesterday", "Gestern")
                    : formatDate(date, language, date.getFullYear() !== thisYear ? "shortDayYear" : "shortDay")
            day = { key, label, entries: [] }
            days.push(day)
        }
        day.entries.push(entry)
    }
    return days
}

/** "21:04" */
export function timeOfDay(at: number, language: string): string {
    return formatTime(new Date(at), language)
}

/** "Episode 3 · 12:40 left" / "Chapter 12 · page 5" */
export function entryLine(entry: HistoryEntry, language: string): string {
    const de = language === "de"
    if (entry.kind === "anime") {
        const parts = entry.number ? [`${de ? "Folge" : "Episode"} ${entry.number}`] : []
        if (entry.currentTime && entry.duration && entry.currentTime / entry.duration < 0.9) {
            const left = Math.max(1, Math.round((entry.duration - entry.currentTime) / 60))
            parts.push(de ? `noch ${left} Min.` : `${left} min left`)
        }
        return parts.join(" · ") || (de ? "Geschaut" : "Watched")
    }
    const parts = entry.number ? [`${de ? "Kapitel" : "Chapter"} ${entry.number}`] : []
    if (entry.pageIndex !== undefined) parts.push(`${de ? "Seite" : "page"} ${entry.pageIndex + 1}`)
    return parts.join(" · ") || (de ? "Gelesen" : "Read")
}

/** The resume pages without this manga */
export function withoutManga(locations: Record<string, MangaReaderResumeLocation>, mediaId: number): Record<string, MangaReaderResumeLocation> {
    const { [String(mediaId)]: _gone, ...rest } = locations
    return rest
}
