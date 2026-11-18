import { isValidElement } from "react"
import { describe, expect, it } from "vitest"
import { dateFnsLocale, fillParts, formatDate, formatTime, localeTag, weekdayNames } from "./format"

describe("formatDate", () => {
    const day = new Date(2026, 9, 23, 18, 30) // Friday
    const long = ["EEEE, MMMM d", "EEEE, d. MMMM"] as [string, string]
    const options: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric" }

    it("keeps the English and German patterns", () => {
        expect(formatDate(day, "en", long, options)).toBe("Friday, October 23")
        expect(formatDate(day, "de", long, options)).toBe("Freitag, 23. Oktober")
        expect(formatTime(day, "en")).toBe("6:30 PM")
        expect(formatTime(day, "de")).toBe("18:30")
    })

    it("words and orders the date in the other languages", () => {
        expect(formatDate(day, "pt-BR", long, options)).toBe("sexta-feira, 23 de outubro")
        expect(formatDate(day, "ja", long, options)).toBe("10月23日金曜日")
        expect(formatDate(day, "ru", long, options)).toBe("пятница, 23 октября")
        expect(formatTime(day, "fr")).toBe("18:30")
    })

    it("names the weekdays from Monday", () => {
        expect(weekdayNames("en")).toEqual(["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"])
        expect(weekdayNames("de")[6]).toBe("So")
        expect(weekdayNames("es")[0]).toBe("lun")
        expect(weekdayNames("ja")[0]).toBe("月")
    })

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
