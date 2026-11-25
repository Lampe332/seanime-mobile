import { describe, expect, it } from "vitest"
import { intoColumns, monthRatios, parseDay, pickYear, shareRatios, watchTime } from "./wrapped-phone"

describe("pickYear", () => {
    it("keeps the chosen year while it has data", () => {
        expect(pickYear([2025, 2024], 2024)).toBe(2024)
    })
    it("falls back to the newest year", () => {
        expect(pickYear([2025, 2024], null)).toBe(2025)
        expect(pickYear([2025, 2024], 2019)).toBe(2025)
    })
    it("is null without years", () => {
        expect(pickYear([], 2024)).toBeNull()
    })
})

describe("watchTime", () => {
    it("rounds to hours and leaves days out below 48 hours", () => {
        expect(watchTime(24 * 12)).toEqual({ hours: 5, days: null })
        expect(watchTime(47 * 60)).toEqual({ hours: 47, days: null })
    })
    it("adds days with one decimal from 48 hours on", () => {
        expect(watchTime(48 * 60)).toEqual({ hours: 48, days: 2 })
        expect(watchTime(100 * 60)).toEqual({ hours: 100, days: 4.2 })
    })
    it("never goes below zero", () => {
        expect(watchTime(-5)).toEqual({ hours: 0, days: null })
    })
})

describe("monthRatios", () => {
    it("measures every month against the busiest", () => {
        expect(monthRatios([0, 2, 4, 0, 0, 0, 0, 0, 0, 0, 0, 1])).toEqual([0, 0.5, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0.25])
    })
    it("is all zero in a year without dated months", () => {
        expect(monthRatios(Array(12).fill(0))).toEqual(Array(12).fill(0))
    })
})

describe("shareRatios", () => {
    it("lets the largest share fill the bar", () => {
        expect(shareRatios([0.5, 0.25])).toEqual([1, 0.5])
        expect(shareRatios([])).toEqual([])
    })
})

describe("intoColumns", () => {
    it("deals items left to right", () => {
        expect(intoColumns(["a", "b", "c"], 2)).toEqual([["a", "c"], ["b"]])
        expect(intoColumns(["a", "b"], 1)).toEqual([["a", "b"]])
    })
})

describe("parseDay", () => {
    it("reads a calendar day without a time zone shift", () => {
        const day = parseDay("2025-03-04")!
        expect([day.getFullYear(), day.getMonth(), day.getDate()]).toEqual([2025, 2, 4])
    })
    it("is null for a missing or broken date", () => {
        expect(parseDay(undefined)).toBeNull()
        expect(parseDay("2025-3-4")).toBeNull()
    })
})
