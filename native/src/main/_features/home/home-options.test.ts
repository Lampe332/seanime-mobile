import { describe, expect, it } from "vitest"
import {
    ANY_CHOICE,
    cleanHomeOptions,
    hasCustomOptions,
    homeOptionWarnings,
    isPlausibleYear,
    parseYearInput,
    selectState,
    withOption,
    yearMax,
    yearText,
} from "./home-options"
import { HOME_ITEMS } from "./home-items.utils"

const now = new Date(2026, 10, 20)

describe("selects", () => {
    it("offer Any first where an empty value means no filter, and show it while nothing is picked", () => {
        expect(selectState("anime-carousel", "format", undefined)).toEqual({ value: ANY_CHOICE, any: true })
        expect(selectState("anime-carousel", "season", "")).toEqual({ value: ANY_CHOICE, any: true })
        expect(selectState("manga-carousel", "countryOfOrigin", "KR")).toEqual({ value: "KR", any: true })
    })
    it("show the default choice where an empty value means one of their own choices", () => {
        expect(selectState("anime-carousel", "sorting", undefined)).toEqual({ value: "SCORE_DESC", any: false })
        expect(selectState("manga-carousel", "sorting", "TRENDING_DESC")).toEqual({ value: "TRENDING_DESC", any: false })
        expect(selectState("my-lists", "type", undefined)).toEqual({ value: "anime", any: false })
        expect(selectState("anime-schedule-calendar", "type", undefined)).toEqual({ value: "my-lists", any: false })
    })
    it("show a default that is one of the field's choices", () => {
        for (const [type, name] of [["anime-carousel", "sorting"], ["manga-carousel", "sorting"], ["my-lists", "type"], ["anime-schedule-calendar", "type"]]) {
            const choices = HOME_ITEMS[type].options!.find(option => option.name === name)!.options!.map(choice => choice.value)
            expect(choices, `${type}.${name}`).toContain(selectState(type, name, undefined).value)
        }
    })
    it("are emptied by Any: the field is left out of the options", () => {
        const form = { format: "TV", season: "FALL" }
        expect(withOption(form, "format", ANY_CHOICE)).toEqual({ season: "FALL" })
        expect(withOption(form, "format", undefined)).toEqual({ season: "FALL" })
        expect(withOption(form, "format", "MOVIE")).toEqual({ format: "MOVIE", season: "FALL" })
        // the form it came from stays as it was
        expect(form).toEqual({ format: "TV", season: "FALL" })
    })
})

describe("saved options", () => {
    it("leave out empty fields, also the year 0 older versions saved", () => {
        expect(cleanHomeOptions({ name: "  Mine ", format: "", genres: [], year: 0, season: ANY_CHOICE, status: ["RELEASING"] }))
            .toEqual({ name: "Mine", status: ["RELEASING"] })
        expect(cleanHomeOptions({ name: "   ", statuses: [] })).toBeUndefined()
        expect(cleanHomeOptions(undefined)).toBeUndefined()
        expect(cleanHomeOptions({ year: 2024, type: "manga" })).toEqual({ year: 2024, type: "manga" })
    })
    it("keep a typed text with its spaces until it is saved", () => {
        expect(withOption({}, "name", "My ")).toEqual({ name: "My " })
        expect(withOption({ name: "M" }, "name", "")).toEqual({})
    })
    it("offer a reset only when a field besides the title is set", () => {
        expect(hasCustomOptions({ name: "Mine" })).toBe(false)
        expect(hasCustomOptions({ name: "Mine", genres: [] })).toBe(false)
        expect(hasCustomOptions({ format: "TV" })).toBe(true)
        expect(hasCustomOptions(undefined)).toBe(false)
    })
})

describe("year field", () => {
    it("is empty for no year and saves none", () => {
        expect(parseYearInput("")).toEqual({ text: "", year: undefined })
        expect(yearText(undefined)).toBe("")
        expect(yearText(0)).toBe("")
        expect(yearText(2024)).toBe("2024")
    })
    it("drops a leading zero, other signs and a fifth digit", () => {
        expect(parseYearInput("0")).toEqual({ text: "", year: undefined })
        expect(parseYearInput("02024")).toEqual({ text: "2024", year: 2024 })
        expect(parseYearInput("20-2,4")).toEqual({ text: "2024", year: 2024 })
        expect(parseYearInput("202456")).toEqual({ text: "2024", year: 2024 })
    })
    it("accepts no year or one AniList can have titles for", () => {
        expect(isPlausibleYear(undefined, now)).toBe(true)
        expect(isPlausibleYear(1900, now)).toBe(true)
        expect(isPlausibleYear(2026, now)).toBe(true)
        expect(isPlausibleYear(yearMax(now), now)).toBe(true)
        expect(yearMax(now)).toBe(2028)
        expect(isPlausibleYear(2029, now)).toBe(false)
        expect(isPlausibleYear(20, now)).toBe(false)
        expect(isPlausibleYear(1899, now)).toBe(false)
    })
})

describe("warnings", () => {
    it("say that several genres must all be on one title", () => {
        expect(homeOptionWarnings("anime-carousel", { genres: ["Action"] })).toEqual([])
        expect(homeOptionWarnings("anime-carousel", { genres: ["Action", "Sports"] })).toEqual([{ kind: "genres", count: 2 }])
        expect(homeOptionWarnings("manga-carousel", { genres: ["Action", "Sports", "Mecha"] })).toEqual([{ kind: "genres", count: 3 }])
    })
    it("say that a custom list replaces the statuses", () => {
        expect(homeOptionWarnings("my-lists", { customListName: "Favs", statuses: ["CURRENT"] })).toEqual([{ kind: "custom-list" }])
        expect(homeOptionWarnings("my-lists", { customListName: "  ", statuses: ["CURRENT"] })).toEqual([])
        expect(homeOptionWarnings("my-lists", { customListName: "Favs" })).toEqual([])
    })
    it("stay quiet for other sections and for no options", () => {
        expect(homeOptionWarnings("anime-library", { statuses: [] })).toEqual([])
        expect(homeOptionWarnings("anime-carousel", undefined)).toEqual([])
    })
})
