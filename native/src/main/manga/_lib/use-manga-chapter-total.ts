import { useListMangaProviderExtensions } from "@/api/hooks/extensions.hooks"
import { useGetMangaLatestChapterNumbersMap } from "@/api/hooks/manga.hooks"
import { useStoredMangaFilters, useStoredMangaProviders } from "@/main/manga/_lib/handle-manga-selected-provider"
import { getMangaChapterTotal, getMangaEntryLatestChapterNumber } from "@/main/manga/_lib/manga-unread"

/**
 * A manga's chapter total as the library shows it (getMangaChapterTotal): AniList's count or the newest chapter of the
 * saved source with its filters, whichever is larger. The manga page and the reader use it, so all three agree.
 */
export function useMangaChapterTotal(mediaId: number, anilistChapters: number | null | undefined, progress: number | null | undefined) {
    const { data: latestChapterNumbers } = useGetMangaLatestChapterNumbersMap()
    const { data: extensions } = useListMangaProviderExtensions()
    const { storedProviders } = useStoredMangaProviders(extensions)
    const { storedFilters } = useStoredMangaFilters(extensions, storedProviders)
    const latest = getMangaEntryLatestChapterNumber(mediaId, latestChapterNumbers ?? {}, storedProviders, storedFilters)
    return getMangaChapterTotal(anilistChapters, latest, progress)
}
