import { Manga_MangaLatestChapterNumberItem } from "@/api/generated/types"
import { MangaEntryFilters } from "./manga-preferences"

export type MangaUnreadState = {
    known: boolean
    latest: number | null
    unread: number
}

export function getMangaEntryLatestChapterNumber(
    mangaId: string | number,
    latestChapterNumbers: Record<number, Manga_MangaLatestChapterNumberItem[]>,
    storedProviders: Record<string, string>,
    storedFilters: Record<string, MangaEntryFilters>,
) {
    const provider = storedProviders[String(mangaId)]
    if (!provider) return null

    const filters = storedFilters[String(mangaId)]
    const scanlators = filters?.scanlators?.filter(Boolean) ?? []
    const language = filters?.language
    const entries = latestChapterNumbers[Number(mangaId)]?.filter(item => {
        if (item.provider !== provider) return false
        if (language && item.language !== language) return false
        if (scanlators.length && !scanlators.includes(item.scanlator)) return false
        return true
    }) ?? []

    if (!entries.length) return null

    return entries.reduce((latest, item) => Math.max(latest, item.number), 0)
}

/**
 * The chapter count a manga's progress is shown against, everywhere (library card, "Continue reading", the manga page,
 * the reader's save button): the larger of AniList's count and the newest chapter of the saved source. AniList has no
 * count for running manga, so the library showed "Ch. 50 / 120" while the page said "50/-"; null when neither is known.
 * A source that ends below the progress does not know the manga's chapters (Local with 2 of them while AniList says 7
 * read): it is no total then, and the page shows "7/-" like 2.0.33 instead of "7/2" (r18).
 */
export function getMangaChapterTotal(anilistChapters: number | null | undefined, latest: number | null | undefined, progress?: number | null): number | null {
    const source = latest && (!progress || latest >= progress) ? latest : 0
    return Math.max(anilistChapters || 0, source) || null
}

export function getMangaEntryUnreadState(
    mangaId: string | number,
    progress: number,
    latestChapterNumbers: Record<number, Manga_MangaLatestChapterNumberItem[]>,
    storedProviders: Record<string, string>,
    storedFilters: Record<string, MangaEntryFilters>,
): MangaUnreadState {
    const latest = getMangaEntryLatestChapterNumber(mangaId, latestChapterNumbers, storedProviders, storedFilters)
    if (latest === null || !Number.isFinite(latest)) {
        return { known: false, latest: null, unread: 0 }
    }

    return {
        known: true,
        latest,
        unread: Math.max(0, latest - progress),
    }
}
