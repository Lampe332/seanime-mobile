import { isValidElement } from "react"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { dateFnsLocale, fillParts, formatDate, formatNumber, formatTime, localeTag, weekdayNames } from "./format"

describe("formatDate", () => {
    const day = new Date(2026, 9, 23, 18, 30) // Friday

    // Hermes on Android formats zh-CN with the phone's language: the forms must not touch Intl at all
    beforeAll(() => {
        const broken = () => { throw new Error("Intl used") }
        vi.stubGlobal("Intl", undefined)
        vi.spyOn(Date.prototype, "toLocaleString").mockImplementation(broken)
        vi.spyOn(Date.prototype, "toLocaleDateString").mockImplementation(broken)
        vi.spyOn(Number.prototype, "toLocaleString").mockImplementation(broken)
    })
    afterAll(() => {
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    const rows: [string, Record<string, string>][] = [
        ["en", { weekdayDayMonth: "Friday, October 23", monthYear: "October 2026", month: "October", dayShortMonth: "Oct 23", shortDay: "Fri, Oct 23", numeric: "10/23/2026", time: "6:30 PM", dateTime: "10/23/2026, 6:30 PM" }],
        ["de", { weekdayDayMonth: "Freitag, 23. Oktober", monthYear: "Oktober 2026", month: "Oktober", dayShortMonth: "23. Okt.", shortDay: "Fr., 23. Okt.", numeric: "23.10.2026", time: "18:30", dateTime: "23.10.2026, 18:30" }],
        ["es", { weekdayDayMonth: "viernes, 23 de octubre", monthYear: "octubre de 2026", month: "octubre", dayShortMonth: "23 oct", shortDay: "vie, 23 oct", numeric: "23/10/2026", time: "18:30", dateTime: "23/10/2026, 18:30" }],
        ["ru", { weekdayDayMonth: "пятница, 23 октября", monthYear: "октябрь 2026 г.", month: "октябрь", dayShortMonth: "23 окт.", shortDay: "пт, 23 окт.", numeric: "23.10.2026", time: "18:30", dateTime: "23.10.2026, 18:30" }],
        ["zh-Hans", { weekdayDayMonth: "10月23日星期五", monthYear: "2026年10月", month: "十月", dayShortMonth: "10月23日", shortDay: "10月23日周五", numeric: "2026/10/23", time: "18:30", dateTime: "2026/10/23 18:30" }],
        ["pt-BR", { weekdayDayMonth: "sexta-feira, 23 de outubro", monthYear: "outubro de 2026", month: "outubro", dayShortMonth: "23 de out", shortDay: "sex, 23 de out", numeric: "23/10/2026", time: "18:30", dateTime: "23/10/2026, 18:30" }],
        ["fr", { weekdayDayMonth: "vendredi 23 octobre", monthYear: "octobre 2026", month: "octobre", dayShortMonth: "23 oct.", shortDay: "ven. 23 oct.", numeric: "23/10/2026", time: "18:30", dateTime: "23/10/2026 18:30" }],
        ["ja", { weekdayDayMonth: "10月23日金曜日", monthYear: "2026年10月", month: "10月", dayShortMonth: "10月23日", shortDay: "10月23日(金)", numeric: "2026/10/23", time: "18:30", dateTime: "2026/10/23 18:30" }],
    ]

    it.each(rows)("writes every date form in %s without Intl", (language, expected) => {
        for (const [style, text] of Object.entries(expected)) expect(formatDate(day, language, style as never), style).toBe(text)
        expect(formatTime(day, language)).toBe(expected.time)
    })

    it("falls back to English for an unknown language", () => {
        expect(formatDate(day, "xx", "monthYear")).toBe("October 2026")
    })

    it("names the weekdays from Monday", () => {
        expect(weekdayNames("en")).toEqual(["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"])
        expect(weekdayNames("de")[6]).toBe("So")
        expect(weekdayNames("es")[0]).toBe("lun")
        expect(weekdayNames("ru")[0]).toBe("пн")
        expect(weekdayNames("zh-Hans")).toEqual(["周一", "周二", "周三", "周四", "周五", "周六", "周日"])
        expect(weekdayNames("fr")[4]).toBe("ven")
        expect(weekdayNames("ja")[0]).toBe("月")
    })

    it("writes numbers with each language's separators", () => {
        expect(formatNumber(1234567.5, "en", 1)).toBe("1,234,567.5")
        expect(formatNumber(1234567.5, "de", 1)).toBe("1.234.567,5")
        expect(formatNumber(1234, "es")).toBe("1234")
        expect(formatNumber(12345, "es")).toBe("12.345")
        expect(formatNumber(1234.56, "ru", 1)).toBe("1 234,6")
        expect(formatNumber(2000, "fr", 1)).toBe("2 000")
        expect(formatNumber(1234, "zh-Hans")).toBe("1,234")
        expect(formatNumber(-0.25, "pt-BR", 1)).toBe("-0,3")
    })
})

describe("locales", () => {
    it("has a locale tag and date-fns locale per language", () => {
        expect(localeTag("zh-Hans")).toBe("zh-CN")
        expect(localeTag("xx")).toBe("en-US")
        expect(dateFnsLocale("en")).toEqual({})
        expect(dateFnsLocale("fr").locale?.code).toBe("fr")
    })
})

describe("fillParts", () => {
    it("puts each part where the sentence has its placeholder", () => {
        const parts = fillParts("Appuie sur {0}, puis sur {1}.", "A", "B")
        expect(parts.filter(part => typeof part === "string")).toEqual(["Appuie sur ", ", puis sur ", "."])
        expect(parts.filter(isValidElement)).toHaveLength(2)
        expect(fillParts("{0}をタップ", "X")).toHaveLength(2)
    })
})
