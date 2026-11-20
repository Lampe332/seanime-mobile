import type { Nullish } from "@/api/generated/types"

/*
 * The option form of a Home section (Customize Home › Options), as data so it can be tested without React Native:
 * which value a field shows, how a field is emptied, the year field and the hints for options that will likely find nothing.
 */

export type HomeOptions = Record<string, unknown>

/** A select's choice for "no value": the section then uses its default (AniList's any). */
export const ANY_CHOICE = "__any__"

/**
 * Selects whose empty value means one of their own choices: they show that choice instead of an "Any" row
 * (home-screen.tsx: a carousel without sorting sorts by score, My lists without a type shows anime, the calendar shows
 * the anime on your lists).
 */
const SELECT_DEFAULTS: Record<string, string> = {
    "anime-carousel.sorting": "SCORE_DESC",
    "manga-carousel.sorting": "SCORE_DESC",
    "my-lists.type": "anime",
    "anime-schedule-calendar.type": "my-lists",
}

/** The value a select shows and whether it offers the "Any" row first. */
export function selectState(sectionType: string, name: string, value: unknown): { value: string, any: boolean } {
    const fallback = SELECT_DEFAULTS[`${sectionType}.${name}`]
    const set = typeof value === "string" && value !== "" ? value : undefined
    return fallback ? { value: set ?? fallback, any: false } : { value: set ?? ANY_CHOICE, any: true }
}

/** A value that means "not set": it is left out of the saved options. */
function isEmptyOption(value: unknown): boolean {
    return value === undefined || value === null || value === "" || value === ANY_CHOICE || (Array.isArray(value) && value.length === 0)
        || (typeof value === "number" && (!Number.isFinite(value) || value <= 0))
}

/** The form with one field changed; emptying a field (Any, no chip, no text, no year) removes it. */
export function withOption(form: HomeOptions, name: string, value: unknown): HomeOptions {
    const next = { ...form }
    if (isEmptyOption(value)) delete next[name]
    else next[name] = value
    return next
}

/**
 * What is saved: no empty fields (also those saved by older versions, such as the year 0), texts without surrounding
 * spaces, nothing at all when every field is empty.
 */
export function cleanHomeOptions(form: Nullish<HomeOptions>): HomeOptions | undefined {
    const clean: HomeOptions = {}
    for (const [name, value] of Object.entries(form ?? {})) {
        const v = typeof value === "string" ? value.trim() : value
        if (!isEmptyOption(v)) clean[name] = v
    }
    return Object.keys(clean).length ? clean : undefined
}

export const YEAR_MIN = 1900

/** The latest year worth asking AniList for: announced titles reach a year or two ahead. */
export function yearMax(now: Date = new Date()) {
    return now.getFullYear() + 2
}

/** The year field as typed: digits only, no leading zero, at most four digits; an empty field is no year. */
export function parseYearInput(text: string): { text: string, year: number | undefined } {
    const digits = text.replace(/\D/g, "").replace(/^0+/, "").slice(0, 4)
    return { text: digits, year: digits ? Number(digits) : undefined }
}

/** The year field's text for a saved value: empty for none (also the 0 older versions saved). */
export function yearText(value: unknown): string {
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? String(value) : ""
}

/** No year, or one AniList can have titles for. */
export function isPlausibleYear(year: number | undefined, now: Date = new Date()): boolean {
    return year === undefined || (Number.isInteger(year) && year >= YEAR_MIN && year <= yearMax(now))
}

export type HomeOptionWarning = { kind: "genres", count: number } | { kind: "custom-list" }

/** Option combinations that will likely show little or nothing, said before saving. */
export function homeOptionWarnings(sectionType: string, form: Nullish<HomeOptions>): HomeOptionWarning[] {
    const warnings: HomeOptionWarning[] = []
    const genres = Array.isArray(form?.genres) ? form.genres.length : 0
    // AniList's genre_in wants every picked genre on one title
    if ((sectionType === "anime-carousel" || sectionType === "manga-carousel") && genres > 1) warnings.push({ kind: "genres", count: genres })
    // My lists shows the custom list instead of the statuses
    if (sectionType === "my-lists" && String(form?.customListName ?? "").trim() && Array.isArray(form?.statuses) && form.statuses.length) {
        warnings.push({ kind: "custom-list" })
    }
    return warnings
}

/** Whether "Reset options" would change anything: a field besides the section's own title is set. */
export function hasCustomOptions(form: Nullish<HomeOptions>): boolean {
    return Object.keys(cleanHomeOptions(form) ?? {}).some(name => name !== "name")
}
