import type { AL_MediaListStatus, Anime_EntryListData, Anime_ScheduleItem } from "@/api/generated/types"
import { weekdayNames } from "@/lib/i18n/format"
import type { Day } from "date-fns"
import { addDays } from "date-fns/addDays"
import { differenceInCalendarDays } from "date-fns/differenceInCalendarDays"
import { endOfMonth } from "date-fns/endOfMonth"
import { endOfWeek } from "date-fns/endOfWeek"
import { format } from "date-fns/format"
import { isSameMonth } from "date-fns/isSameMonth"
import { isToday } from "date-fns/isToday"
import { parseISO } from "date-fns/parseISO"
import { startOfDay } from "date-fns/startOfDay"
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

/*
 * Week and month share one chosen day ("yyyy-MM-dd"). The week view shows rolling 7 days from today (`offset` weeks
 * away), the month view the month of `month`; these keep the day inside what is shown when either changes.
 */

/** The first day of the week view `offset` weeks away from today. */
export function weekFirstDay(today: Date, offset: number): Date {
    return addDays(startOfDay(today), offset * 7)
}

/** The week view's offset whose 7 days hold `date`. */
export function weekOffsetOf(date: string, today: Date): number {
    return Math.floor(differenceInCalendarDays(parseISO(date), today) / 7)
}

/**
 * The week arrows: the chosen day keeps its place in the next or previous 7 days (the 3rd day stays the 3rd); a day
 * outside the shown week becomes the new week's first day.
 */
export function stepWeek(selectedDate: string, today: Date, offset: number, by: number): { offset: number, selectedDate: string } {
    const next = offset + by
    const day = weekOffsetOf(selectedDate, today) === offset ? addDays(parseISO(selectedDate), by * 7) : weekFirstDay(today, next)
    return { offset: next, selectedDate: format(day, "yyyy-MM-dd") }
}

/** The month that shows the chosen day: `month` itself when it already does, so nothing changes. */
export function monthOf(selectedDate: string, month: Date): Date {
    const day = parseISO(selectedDate)
    return isSameMonth(day, month) ? month : day
}

/** Weekday heads in the grid's order. */
export function weekdayLabels(language: string, weekStartsOn: number) {
    const names = weekdayNames(language)
    return weekStartsOn === 0 ? [names[6], ...names.slice(0, 6)] : names
}
