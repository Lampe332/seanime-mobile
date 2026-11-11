import { Manga_CollectionList } from "@/api/generated/types"
import { MANGA_COLLECTION_SORTING_OPTIONS } from "@/lib/helpers/filtering"

/** The phone library's list tabs. Rereading arrives inside Reading: the server merges it into that list. */
export const MANGA_PHONE_STATUSES = [
    { value: "CURRENT", en: "Reading", de: "Lese ich" },
    { value: "PLANNING", en: "Planning", de: "Geplant" },
    { value: "PAUSED", en: "Paused", de: "Pausiert" },
    { value: "COMPLETED", en: "Completed", de: "Fertig" },
    { value: "DROPPED", en: "Dropped", de: "Abgebrochen" },
] as const

export type MangaPhoneStatus = typeof MANGA_PHONE_STATUSES[number]["value"]

export type MangaStatusTab = typeof MANGA_PHONE_STATUSES[number] & { count: number }

/**
 * One tab per status that holds manga. `count` comes from the filtered lists, so it matches the grid;
 * a tab stays while a filter empties it, so the filter can be seen and undone.
 */
export function getMangaStatusTabs(rawLists: Manga_CollectionList[] | undefined, lists: Manga_CollectionList[] | undefined): MangaStatusTab[] {
    return MANGA_PHONE_STATUSES
        .filter(status => !!rawLists?.find(list => list.type === status.value)?.entries?.length)
        .map(status => ({ ...status, count: lists?.find(list => list.type === status.value)?.entries?.length ?? 0 }))
}

/** The chosen status while it has a tab, otherwise the first tab that shows manga (Reading first). */
export function pickMangaStatus(selected: string | null | undefined, tabs: MangaStatusTab[]): MangaPhoneStatus | null {
    if (selected && tabs.some(tab => tab.value === selected)) return selected as MangaPhoneStatus
    return (tabs.find(tab => tab.count > 0) ?? tabs[0])?.value ?? null
}

/**
 * Genre chips for the filter sheet: every genre in the library (a selected genre never disappears),
 * with how many manga of the shown list carry it.
 */
export function getMangaGenreCounts(rawLists: Manga_CollectionList[] | undefined, status: MangaPhoneStatus | null) {
    const counts = new Map<string, number>()
    for (const list of rawLists ?? []) {
        for (const entry of list.entries ?? []) {
            for (const genre of entry.media?.genres ?? []) {
                if (!genre) continue
                counts.set(genre, (counts.get(genre) ?? 0) + (list.type === status ? 1 : 0))
            }
        }
    }
    return [...counts].map(([genre, count]) => ({ genre, count })).sort((a, b) => a.genre.localeCompare(b.genre))
}

const SORTING_DE: Record<string, string> = {
    UNREAD_CHAPTERS_DESC: "Meiste neue Kapitel",
    UNREAD_CHAPTERS: "Wenigste neue Kapitel",
    SCORE_DESC: "Höchste eigene Bewertung",
    SCORE: "Niedrigste eigene Bewertung",
    TITLE: "Titel (A–Z)",
    TITLE_DESC: "Titel (Z–A)",
    AUDIENCE_SCORE_DESC: "Höchste AniList-Bewertung",
    AUDIENCE_SCORE: "Niedrigste AniList-Bewertung",
    PROGRESS_DESC: "Meiste gelesene Kapitel",
    PROGRESS: "Wenigste gelesene Kapitel",
    START_DATE_DESC: "Zuletzt begonnen",
    START_DATE: "Zuerst begonnen",
    END_DATE_DESC: "Zuletzt beendet",
    END_DATE: "Zuerst beendet",
    RELEASE_DATE_DESC: "Neueste Veröffentlichung",
    RELEASE_DATE: "Älteste Veröffentlichung",
    CREATED_AT_DESC: "Zuletzt hinzugefügt",
    UPDATED_AT_DESC: "Zuletzt aktualisiert",
}

/** The manga library's sorting options (the same list as in the settings), with German labels. */
export const MANGA_PHONE_SORTING_OPTIONS = MANGA_COLLECTION_SORTING_OPTIONS.map(option => ({
    value: option.value,
    en: option.label,
    de: SORTING_DE[option.value] ?? option.label,
}))
