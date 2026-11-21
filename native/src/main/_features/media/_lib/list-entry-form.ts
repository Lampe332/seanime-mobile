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
        progress: listData?.progress ?? null,
        startedAt: listData?.startedAt ? normalizeDate(listData.startedAt) ?? null : null,
        completedAt: listData?.completedAt ? normalizeDate(listData.completedAt) ?? null : null,
    }
}

/** Highest progress: the last aired episode of a running anime, else its episode count; a manga's chapters */
export function progressMaxFor(media: AL_BaseAnime | AL_BaseManga | undefined, type: "anime" | "manga") {
    if (type === "manga") return (media as AL_BaseManga | undefined)?.chapters ?? undefined
    const anime = media as AL_BaseAnime | undefined
    if (anime?.nextAiringEpisode?.episode) return anime.nextAiringEpisode.episode - 1
    return anime?.episodes ? anime.episodes : undefined
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

/** Choosing a status; completing an anime fills its progress (the desktop status select does the same) */
export function chooseListStatus(form: ListEntryForm, status: AL_MediaListStatus, media: AL_BaseAnime | AL_BaseManga | undefined, type: "anime" | "manga"): ListEntryForm {
    const episodes = (media as AL_BaseAnime | undefined)?.episodes
    if (type === "anime" && status === "COMPLETED" && episodes) return { ...form, status, progress: episodes }
    return { ...form, status }
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
        score: form.score ? form.score * 10 : 0, // should be 0-100
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

/** "2026-10-05" in the date fields */
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

export function formatFieldDate(date: Date | null) {
    if (!date) return ""
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
