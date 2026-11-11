import { describe, expect, it } from "vitest"
import { calendarDays, scheduleEvents, weekdayLabels } from "./schedule-phone"

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
        expect(weekdayLabels(true, 0)).toEqual(["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"])
    })
})
