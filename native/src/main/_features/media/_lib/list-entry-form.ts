import type { AL_BaseAnime, AL_BaseManga, AL_FuzzyDateInput, AL_MediaListStatus, Anime_EntryListData, Manga_EntryListData } from "@/api/generated/types"
import type { Translate } from "@/lib/app-language"
import { normalizeDate } from "@/lib/helpers/date"

/*
 * The AniList list entry editor (anilist-media-entry-modal.tsx, Android sheet): the same defaults, limits and submit
 * payload as the web form, without react-hook-form/zod.
 */

export type ListEntryForm = {
    status: AL_MediaListStatus | undefined
    /** 0–10 (AniList stores 0–100) */
    score: number | null
    progress: number | null
    startedAt: Date | null
    completedAt: Date | null
}

type ListData = Anime_EntryListData | Manga_EntryListData

export function listEntryDefaults(listData: ListData | undefined): ListEntryForm {
    return {
        status: listData?.status,
        score: listData?.score ? listData.score / 10 : null, // Returned score is 0-100
        // an entry without progress shows 0 as the detail page does; "–" only when there is no entry
        progress: listData ? listData.progress ?? 0 : null,
        startedAt: listData?.startedAt ? normalizeDate(listData.startedAt) ?? null : null,
        completedAt: listData?.completedAt ? normalizeDate(listData.completedAt) ?? null : null,
    }
}

const sameDay = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null)

/**
 * The form differs from the entry it opened with (closing then asks before throwing it away). Only values count: the
 * sheet's light first frames (stage) show the same values. A score or progress typed back to its start is unchanged.
 */
export function listEntryDirty(form: ListEntryForm, repeat: number | null, listData: ListData | undefined): boolean {
    const start = listEntryDefaults(listData)
    return form.status !== start.status
        || form.score !== start.score
        || form.progress !== start.progress
        || !sameDay(form.startedAt, start.startedAt)
        || !sameDay(form.completedAt, start.completedAt)
        || (repeat ?? 0) !== (listData?.repeat || 0)
}

/** Highest progress without a known total: no anime runs past 9999 episodes, no manga past 99999 chapters */
export const PROGRESS_CEILING = { anime: 9999, manga: 99999 } as const

/** Highest progress: the last aired episode of a running anime, else its episode count; a manga's chapters; else the ceiling */
export function progressMaxFor(media: AL_BaseAnime | AL_BaseManga | undefined, type: "anime" | "manga"): number {
    if (type === "manga") return (media as AL_BaseManga | undefined)?.chapters || PROGRESS_CEILING.manga
    const anime = media as AL_BaseAnime | undefined
    if (anime?.nextAiringEpisode?.episode) return anime.nextAiringEpisode.episode - 1
    return anime?.episodes || PROGRESS_CEILING.anime
}

export function listStatusOptions(t: Translate, type: "anime" | "manga", released: boolean) {
    const options: { value: AL_MediaListStatus, label: string }[] = [
        { value: "CURRENT", label: type === "anime" ? t("Watching", "Schaue ich") : t("Reading", "Lese ich") },
        { value: "COMPLETED", label: t("Completed", "Fertig") },
        { value: "PLANNING", label: t("Planning", "Geplant") },
        { value: "PAUSED", label: t("Paused", "Pausiert") },
        { value: "DROPPED", label: t("Dropped", "Abgebrochen") },
        { value: "REPEATING", label: type === "anime" ? t("Rewatching", "Schaue erneut") : t("Rereading", "Lese erneut") },
    ]
    return options.filter(option => released || option.value === "PLANNING")
}

/**
 * Choosing a status; completing an anime fills its progress (the desktop status select does the same). With `today`
 * the dates follow as on AniList's own editor: completing fills an empty completion date, starting to watch an empty
 * start date. The sheet sends both dates as they stand, so an empty one would leave the entry without a date (and the
 * title out of "Your year"). A date that is set is never replaced, and the user can still clear it. Today is not filled
 * in where it would put the start after the completion (datesOutOfOrder): a status tap never makes the form unsavable.
 */
export function chooseListStatus(form: ListEntryForm, status: AL_MediaListStatus, media: AL_BaseAnime | AL_BaseManga | undefined, type: "anime" | "manga", today?: Date): ListEntryForm {
    const episodes = (media as AL_BaseAnime | undefined)?.episodes
    const next: ListEntryForm = { ...form, status }
    if (type === "anime" && status === "COMPLETED" && episodes) next.progress = episodes
    if (today && status !== form.status) {
        const day = new Date(today.getFullYear(), today.getMonth(), today.getDate())
        if (status === "COMPLETED" && !form.completedAt && !datesOutOfOrder({ startedAt: form.startedAt, completedAt: day })) next.completedAt = day
        if (status === "CURRENT" && !form.startedAt && !datesOutOfOrder({ startedAt: day, completedAt: form.completedAt })) next.startedAt = day
    }
    return next
}

/** The calendar day of a date as one number (20261125), so the time a picker hands back does not count */
function dayNumber(date: Date) {
    return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate()
}

/**
 * The start date lies on a later day than the completion date. The sheet marks the start date and keeps Save off
 * until it is fixed; the same day, or only one date set, is fine.
 */
export function datesOutOfOrder({ startedAt, completedAt }: Pick<ListEntryForm, "startedAt" | "completedAt">): boolean {
    return !!startedAt && !!completedAt && dayNumber(startedAt) > dayNumber(completedAt)
}

/** A stepper's value kept inside its limits; scores keep one decimal */
export function clampStep(n: number, { min = 0, max, decimals }: { min?: number, max?: number, decimals?: boolean }) {
    const rounded = decimals ? Math.round(n * 10) / 10 : Math.round(n)
    return Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min, rounded))
}

/** Typed text → value: empty clears it, "7,5" counts as 7.5, anything else leaves the value as it was (undefined) */
export function parseStepInput(text: string, limits: { min?: number, max?: number, decimals?: boolean }): number | null | undefined {
    if (text.trim() === "") return null
    const parsed = Number(text.replace(",", "."))
    return Number.isFinite(parsed) ? clampStep(parsed, limits) : undefined
}

/**
 * Typing in a stepper: the field never shows a number that would not be saved. Only digits are taken (a score also one
 * "," or "." with one decimal, after a digit); anything else keeps the text as it was. Above the highest, the text
 * becomes the highest. `value` undefined = the typed text was not taken.
 */
export function stepInputText(text: string, previous: string, limits: { min?: number, max?: number, decimals?: boolean }): { text: string, value: number | null | undefined } {
    const allowed = limits.decimals ? /^(\d+([.,]\d?)?)?$/ : /^\d*$/
    if (!allowed.test(text)) return { text: previous, value: undefined }
    const trimmed = text.replace(/^0+(?=\d)/, "")
    const value = parseStepInput(trimmed, limits)
    if (value === null || value === undefined) return { text: trimmed, value }
    return { text: value === Number(trimmed.replace(",", ".")) ? trimmed : String(value), value }
}

/** What a stepper shows: the typed text while it stands for the value, else the value itself */
export function stepShownText(draft: string | null, value: number | null, limits: { min?: number, max?: number, decimals?: boolean }) {
    if (draft !== null && parseStepInput(draft, limits) === value) return draft
    return value === null ? "" : String(value)
}

/**
 * An emptied date goes as {} (sent, unlike undefined): the core reads it as no date and asks AniList to take it away
 * (FuzzyDateInput with year, month and day null, core/anilist/changes.ts sendRow).
 */
function fuzzy(date: Date | null): AL_FuzzyDateInput {
    return date ? { day: date.getDate(), month: date.getMonth() + 1, year: date.getFullYear() } : {}
}

/** The edit mutation's body, as handleSubmit builds it */
export function listEntryPayload(form: ListEntryForm, mediaId: number, type: "anime" | "manga") {
    return {
        mediaId,
        status: form.status || "PLANNING",
        score: form.score ? Math.round(form.score * 10) : 0, // should be 0-100 and whole (0.7 * 10 is 7.000000000000001)
        progress: form.progress || 0,
        startedAt: fuzzy(form.startedAt),
        completedAt: fuzzy(form.completedAt),
        type,
    }
}

/** Only a changed rewatch count goes to the server ("" counts as 0) */
export function changedRepeat(repeat: number | null, stored: number | undefined) {
    const normalized = repeat ?? 0
    return normalized !== (stored ?? 0) ? normalized : null
}

/**
 * Save in the edit sheet: a changed rewatch count goes along, then the entry. The sheet closes only once every part is
 * saved; when one fails it stays open with the changes, and the error shows. Dates out of order send nothing (false).
 */
export function submitListEntry(form: ListEntryForm, repeat: number | null, storedRepeat: number | undefined, mediaId: number, type: "anime" | "manga", actions: {
    saveEntry: (body: ReturnType<typeof listEntryPayload>, options: { onSuccess: () => void }) => void
    saveRepeat: (body: { mediaId: number, repeat: number }, options: { onSuccess: () => void }) => void
    close: () => void
}): boolean {
    if (datesOutOfOrder(form)) return false
    const nextRepeat = changedRepeat(repeat, storedRepeat)
    let waiting = nextRepeat !== null ? 2 : 1
    const saved = () => {
        if (--waiting === 0) actions.close()
    }
    if (nextRepeat !== null) actions.saveRepeat({ mediaId, repeat: nextRepeat }, { onSuccess: saved })
    actions.saveEntry(listEntryPayload(form, mediaId, type), { onSuccess: saved })
    return true
}

/**
 * The button next to the progress (AnilistMediaEntryButton): nothing without a user, "add" without an entry, "edit"
 * with one. Right after adding it hides until the entry comes (`adding` = the add succeeded on this page).
 */
export function entryButton(user: unknown, listData: unknown, adding: boolean): "none" | "add" | "edit" {
    if (!user) return "none"
    if (listData) return "edit"
    return adding ? "none" : "add"
}

/**
 * The added entry arrived: the add is done and is forgotten. Without that the page counted the old success for as long
 * as it stayed open and hid the add button once the entry was removed elsewhere (correction 5a-K).
 */
export function addingDone(adding: boolean, listData: unknown): boolean {
    return adding && !!listData
}

/** "2026-10-05" in the date fields */
export function formatFieldDate(date: Date | null) {
    if (!date) return ""
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
