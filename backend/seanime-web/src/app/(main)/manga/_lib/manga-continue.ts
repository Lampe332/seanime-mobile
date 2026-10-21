import { Manga_CollectionEntry, Manga_MangaLatestChapterNumberItem } from "@/api/generated/types"
import { atom } from "jotai"
import { MANGA_READER_RESUME_MAX_AGE_MS, MangaReaderResumeLocation } from "./manga-chapter-reader.atoms"
import { MangaEntryFilters } from "./manga-preferences"
import { getMangaEntryUnreadState } from "./manga-unread"

/**
 * The chapter a saved resume location points to, while it is still unread on the selected source.
 * The manga page reads this chapter first, otherwise the first unread one.
 */
export function getMangaResumeChapter<T extends { id: string, provider: string }>(
    unreadChapters: T[],
    resumeLocation: MangaReaderResumeLocation | undefined,
    selectedProvider: string | null | undefined,
    now: number,
): T | undefined {
    if (!resumeLocation || resumeLocation.provider !== selectedProvider
        || !Number.isInteger(resumeLocation.pageIndex) || resumeLocation.pageIndex < 0
        || !Number.isFinite(resumeLocation.updatedAt)
        || now - resumeLocation.updatedAt > MANGA_READER_RESUME_MAX_AGE_MS) return undefined
    return unreadChapters.find(ch => ch.id === resumeLocation.chapterId && ch.provider === resumeLocation.provider)
}

export type MangaContinueItem = {
    entry: Manga_CollectionEntry
    progress: number
    /** The larger of AniList's chapter count and the newest chapter of the saved source */
    total: number | null
    /** New chapters on the saved source; null while unknown */
    unread: number | null
    lastReadAt: number
}

type MangaContinueOptions = {
    resumeLocations: Record<string, MangaReaderResumeLocation>
    latestChapterNumbers: Record<number, Manga_MangaLatestChapterNumberItem[]>
    storedProviders: Record<string, string>
    storedFilters: Record<string, MangaEntryFilters>
    now: number
    limit?: number
}

/**
 * "Continue reading" on the phone library: started Reading / Rereading manga, latest activity first
 * (AniList's last list update or the last page the reader saved). Manga whose saved source has no newer
 * chapter, or that are read to AniList's last chapter, have nothing to continue and stay in the grid only.
 */
export function getMangaContinueReading(entries: Manga_CollectionEntry[] | undefined, options: MangaContinueOptions): MangaContinueItem[] {
    const items: MangaContinueItem[] = []
    for (const entry of entries ?? []) {
        const status = entry.listData?.status
        if (status !== "CURRENT" && status !== "REPEATING") continue

        const progress = entry.listData?.progress || 0
        const resume = options.resumeLocations[String(entry.mediaId)]
        const resumeAt = resume && Number.isInteger(resume.pageIndex) && resume.pageIndex >= 0 && Number.isFinite(resume.updatedAt)
        && options.now - resume.updatedAt <= MANGA_READER_RESUME_MAX_AGE_MS ? resume.updatedAt : 0
        if (!progress && !resumeAt) continue

        const state = getMangaEntryUnreadState(entry.mediaId, progress, options.latestChapterNumbers, options.storedProviders, options.storedFilters)
        const chapters = entry.media?.chapters || null
        if (state.known ? state.unread <= 0 : !!chapters && progress >= chapters) continue

        items.push({
            entry,
            progress,
            total: Math.max(chapters ?? 0, state.latest ?? 0) || null,
            unread: state.known ? state.unread : null,
            lastReadAt: Math.max((entry.listData?.updatedAt ?? 0) * 1000, resumeAt),
        })
    }

    return items
        .sort((a, b) => b.lastReadAt - a.lastReadAt
            || (a.entry.media?.title?.userPreferred ?? "").localeCompare(b.entry.media?.title?.userPreferred ?? ""))
        .slice(0, options.limit ?? 12)
}

export type MangaContinueIntent = { mediaId: number, at: number }

/** An intent older than this is dropped, so a slow source never opens the reader by surprise later. */
export const MANGA_CONTINUE_INTENT_MAX_AGE_MS = 30_000

/** Set by "Continue reading" on the phone library; the manga page opens its reading chapter once, then clears it. */
export const __manga_continueIntentAtom = atom<MangaContinueIntent | null>(null)

export function isMangaContinueIntentFor(intent: MangaContinueIntent | null, mediaId: string | number | null | undefined, now: number) {
    if (!intent || mediaId === null || mediaId === undefined || intent.mediaId !== Number(mediaId)) return false
    const age = now - intent.at
    return age >= 0 && age <= MANGA_CONTINUE_INTENT_MAX_AGE_MS
}
