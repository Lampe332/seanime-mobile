import type { AL_MediaListStatus, Anime_EntryListData, Anime_ScheduleItem } from "@/api/generated/types"
import type { Day } from "date-fns"
import { addDays } from "date-fns/addDays"
import { endOfMonth } from "date-fns/endOfMonth"
import { endOfWeek } from "date-fns/endOfWeek"
import { format } from "date-fns/format"
import { isSameMonth } from "date-fns/isSameMonth"
import { isToday } from "date-fns/isToday"
import { startOfMonth } from "date-fns/startOfMonth"
import { startOfWeek } from "date-fns/startOfWeek"

/** Pure parts of the phone calendar (schedule-calendar.tsx + schedule-phone.tsx): events per day, the month grid. */

export type StatusFilter = { value: AL_MediaListStatus, en: string, de: string }

export const STATUS_FILTERS: StatusFilter[] = [
    { value: "CURRENT", en: "Watching", de: "Schaue ich" }, { value: "PLANNING", en: "Planning", de: "Geplant" },
    { value: "PAUSED", en: "Paused", de: "Pausiert" }, { value: "COMPLETED", en: "Completed", de: "Abgeschlossen" },
    { value: "DROPPED", en: "Dropped", de: "Abgebrochen" }, { value: "REPEATING", en: "Rewatching", de: "Schaue erneut" },
]

export type CalendarParams = { indicateWatchedEpisodes: boolean, listStatuses: AL_MediaListStatus[] }

export const DEFAULT_CALENDAR_PARAMS: CalendarParams = { indicateWatchedEpisodes: true, listStatuses: ["PLANNING", "CURRENT", "COMPLETED", "PAUSED"] }

export type CalendarEvent = {
    id: string
    mediaId: number
    name: string
    time: string
    datetime: string
    image: string
    episode: number
    isSeasonFinale: boolean
    isMovie: boolean
    isWatched: boolean
}

export type CalendarDayItem = { date: string, isCurrentMonth: boolean, isToday: boolean, events: CalendarEvent[] }

const sameLocalDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/**
 * The episodes airing on a local day. The user's schedule keeps only titles whose list status is chosen (`statuses`;
 * null = every title, as for All anime and Home's items); an episode counts as watched once the list progress reached it.
 * Ordered by time, then episode.
 */
export function scheduleEvents(schedule: Anime_ScheduleItem[] | null | undefined, day: Date, listData: Record<string, Anime_EntryListData>,
    statuses: AL_MediaListStatus[] | null): CalendarEvent[] {
    const events: CalendarEvent[] = []
    for (const item of schedule ?? []) {
        if (!item.dateTime) continue
        const at = new Date(item.dateTime)
        if (!sameLocalDay(at, day)) continue
        const entry = listData[String(item.mediaId)]
        if (statuses && (!entry?.status || !statuses.includes(entry.status))) continue
        events.push({
            id: `${item.mediaId}-${item.episodeNumber}-${item.dateTime}`,
            mediaId: item.mediaId,
            name: item.title,
            time: format(at, "HH:mm"),
            datetime: item.dateTime,
            image: item.image,
            episode: item.episodeNumber || 1,
            isSeasonFinale: !!item.isSeasonFinale && !item.isMovie,
            isMovie: !!item.isMovie,
            isWatched: !!entry?.progress && entry.progress >= item.episodeNumber,
        })
    }
    return events.sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime() || a.episode - b.episode)
}

/** The month grid: whole weeks from the first to the last day of the month, starting on `weekStartsOn` (0 Sunday, 1 Monday). */
export function calendarDays(month: Date, weekStartsOn: number, eventsOn: (day: Date) => CalendarEvent[]): CalendarDayItem[] {
    const start = startOfWeek(startOfMonth(month), { weekStartsOn: weekStartsOn as Day })
    const end = endOfWeek(endOfMonth(month), { weekStartsOn: weekStartsOn as Day })
    const days: CalendarDayItem[] = []
    for (let day = start; day <= end; day = addDays(day, 1)) {
        days.push({ date: format(day, "yyyy-MM-dd"), isCurrentMonth: isSameMonth(day, month), isToday: isToday(day), events: eventsOn(day) })
    }
    return days
}

/** Weekday heads in the grid's order. */
export function weekdayLabels(german: boolean, weekStartsOn: number) {
    const names = (german ? "Mo Di Mi Do Fr Sa So" : "Mo Tu We Th Fr Sa Su").split(" ")
    return weekStartsOn === 0 ? [names[6], ...names.slice(0, 6)] : names
}
