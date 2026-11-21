import { describe, expect, it } from "vitest"
import { calendarDays, monthOf, scheduleEvents, stepWeek, weekdayLabels, weekFirstDay, weekOffsetOf } from "./schedule-phone"

const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min).toISOString()
const item = (mediaId: number, episodeNumber: number, dateTime: string, extra: Record<string, unknown> = {}) =>
    ({ mediaId, episodeNumber, dateTime, title: `T${mediaId}`, image: "", time: "", isMovie: false, isSeasonFinale: false, ...extra }) as any

const schedule = [
    item(1, 5, at(2026, 11, 5, 18)),
    item(2, 12, at(2026, 11, 5, 9), { isSeasonFinale: true }),
    item(3, 1, at(2026, 11, 5, 9), { isMovie: true, isSeasonFinale: true }),
    item(1, 6, at(2026, 11, 12, 18)),
]
const listData = { 1: { status: "CURRENT", progress: 5 }, 2: { status: "PLANNING", progress: 0 } } as any

describe("phone calendar", () => {
    it("keeps the day's episodes of the chosen list statuses, by time then episode, with watched and finale marks", () => {
        const day = new Date(2026, 10, 5)
        const events = scheduleEvents(schedule, day, listData, ["CURRENT", "PLANNING"])
        expect(events.map(e => [e.mediaId, e.time, e.isWatched, e.isSeasonFinale])).toEqual([[2, "09:00", false, true], [1, "18:00", true, false]])
        expect(scheduleEvents(schedule, day, listData, ["PLANNING"]).map(e => e.mediaId)).toEqual([2])
        // All anime / Home's items: no status filter; the same time orders by episode; a movie's finale mark stays off
        const all = scheduleEvents(schedule, day, listData, null)
        expect(all.map(e => e.mediaId)).toEqual([3, 2, 1])
        expect(all[0]).toMatchObject({ isMovie: true, isSeasonFinale: false })
    })

    it("builds whole weeks around the month from the chosen first weekday", () => {
        const month = new Date(2026, 10, 15)
        const monday = calendarDays(month, 1, () => [])
        expect(monday[0].date).toBe("2026-10-26")
        expect(monday.at(-1)!.date).toBe("2026-12-06")
        expect(monday.length % 7).toBe(0)
        expect(monday.filter(d => d.isCurrentMonth)).toHaveLength(30)
        expect(calendarDays(month, 0, () => [])[0].date).toBe("2026-11-01")
        expect(weekdayLabels("de", 0)).toEqual(["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"])
    })
})

describe("one chosen day for week and month", () => {
    // Saturday 21 November 2026, in the afternoon
    const today = new Date(2026, 10, 21, 15, 30)

    it("counts rolling weeks of 7 days from today", () => {
        expect(format(weekFirstDay(today, 0))).toBe("2026-11-21")
        expect(format(weekFirstDay(today, 2))).toBe("2026-12-05")
        expect(format(weekFirstDay(today, -1))).toBe("2026-11-14")
        expect(weekOffsetOf("2026-11-21", today)).toBe(0)
        expect(weekOffsetOf("2026-11-27", today)).toBe(0)
        expect(weekOffsetOf("2026-11-28", today)).toBe(1)
        expect(weekOffsetOf("2026-11-20", today)).toBe(-1)
        expect(weekOffsetOf("2026-11-14", today)).toBe(-1)
        expect(weekOffsetOf("2026-11-13", today)).toBe(-2)
    })

    it("moves the chosen day along with the week arrows, so the new week shows it", () => {
        // the 3rd day of this week stays the 3rd day of the next and the previous week
        expect(stepWeek("2026-11-23", today, 0, 1)).toEqual({ offset: 1, selectedDate: "2026-11-30" })
        expect(stepWeek("2026-11-30", today, 1, -1)).toEqual({ offset: 0, selectedDate: "2026-11-23" })
        expect(stepWeek("2026-11-23", today, 0, -1)).toEqual({ offset: -1, selectedDate: "2026-11-16" })
        // a day that is not in the shown week: the new week's first day
        expect(stepWeek("2026-10-01", today, 0, 1)).toEqual({ offset: 1, selectedDate: "2026-11-28" })
        for (const [date, offset, by] of [["2026-11-27", 0, 1], ["2026-12-01", 1, 1], ["2026-11-21", 0, -1], ["2026-01-01", 3, -2]] as const) {
            const next = stepWeek(date, today, offset, by)
            expect(weekOffsetOf(next.selectedDate, today), `${date} ${by}`).toBe(next.offset)
        }
    })

    it("takes the month to the chosen day, and back to the week that holds it", () => {
        const november = new Date(2026, 10, 1)
        expect(monthOf("2026-11-30", november)).toBe(november)
        expect(format(monthOf("2026-12-02", november))).toBe("2026-12-02")
        // a week across the month's end: the chosen December day opens December, its week opens again from there
        const step = stepWeek("2026-11-26", today, 0, 1)
        const month = monthOf(step.selectedDate, november)
        expect(calendarDays(month, 1, () => []).some(day => day.date === step.selectedDate && day.isCurrentMonth)).toBe(true)
        expect(weekOffsetOf(step.selectedDate, today)).toBe(step.offset)
    })
})

function format(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}
