import type { AL_BaseManga, Manga_DownloadListItem, Manga_MediaDownloadData, Manga_ProviderDownloadMap } from "@/api/generated/types"

/*
 * Chapter downloads without React (handle-manga-downloads.ts, android-downloads/manga-downloads.tsx + offline-library.ts):
 * the server downloads the chapters itself (/api/v1/manga/download-chapters, its own queue); the app lists them.
 */

export type MangaDownloadChapterItem = { provider: string, chapterId: string, chapterNumber: string, queued: boolean, downloaded: boolean }

/** A manga's saved and queued chapters as one list (the web's __manga_entryDownloadedChaptersAtom). */
export function mangaDownloadChapterItems(data: Manga_MediaDownloadData | null | undefined): MangaDownloadChapterItem[] {
    if (!data) return []
    const items: MangaDownloadChapterItem[] = []
    for (const provider in data.downloaded ?? {}) {
        for (const ch of data.downloaded[provider] ?? []) items.push({ provider, chapterId: ch.chapterId, chapterNumber: ch.chapterNumber, queued: false, downloaded: true })
    }
    for (const provider in data.queued ?? {}) {
        for (const ch of data.queued[provider] ?? []) items.push({ provider, chapterId: ch.chapterId, chapterNumber: ch.chapterNumber, queued: true, downloaded: false })
    }
    return items
}

export type MangaQueueItem = { mediaId: number, provider: string, chapterId: string, chapterNumber: string, status: string }

export type MangaDownloadGroup = { mediaId: number, media?: AL_BaseManga, downloads: Manga_ProviderDownloadMap, queued: MangaQueueItem[] }

export const mangaTitle = (media?: AL_BaseManga | null) => media?.title?.userPreferred || media?.title?.english || media?.title?.romaji || ""

/** One group per manga with saved or queued chapters, by title; `known` fills in a manga the list has no media for. */
export function groupMangaDownloads(downloads: Manga_DownloadListItem[] | null | undefined, queue: MangaQueueItem[] | null | undefined,
    known: Record<number, AL_BaseManga | undefined> = {}): MangaDownloadGroup[] {
    const map = new Map<number, MangaDownloadGroup>()
    for (const item of downloads ?? []) map.set(item.mediaId, { mediaId: item.mediaId, media: item.media, downloads: item.downloadData ?? {}, queued: [] })
    for (const item of queue ?? []) {
        const group = map.get(item.mediaId) ?? { mediaId: item.mediaId, downloads: {}, queued: [] }
        group.queued.push(item)
        map.set(item.mediaId, group)
    }
    const groups = [...map.values()].map(group => ({ ...group, media: group.media ?? known[group.mediaId] }))
    return groups.sort((a, b) => mangaTitle(a.media).localeCompare(mangaTitle(b.media)))
}

/** Saved chapters that are not (again) in the queue: the server lists a chapter as saved while it still loads. */
export function readyChapters(group: MangaDownloadGroup) {
    return Object.entries(group.downloads).flatMap(([provider, chapters]) => (chapters ?? [])
        .filter(ch => !group.queued.some(q => q.provider === provider && q.chapterId === ch.chapterId))
        .map(ch => ({ ...ch, provider })))
}

/** The rows of one manga: saved chapters ready to read and queued ones, by chapter number. */
export function mangaDownloadRows(group: MangaDownloadGroup) {
    return [...readyChapters(group).map(ch => ({ ...ch, status: "ready" })), ...group.queued.map(ch => ({ ...ch }))]
        .sort((a, b) => Number(a.chapterNumber) - Number(b.chapterNumber))
}

/** Quick while a chapter loads, slow while others wait, idle otherwise (offline-library.ts mangaPollDelay). */
export function mangaPollDelay(queue: { status: string }[]) {
    return queue.some(item => item.status === "downloading") ? 2000 : queue.some(item => item.status !== "errored") ? 5000 : null
}

/**
 * The server drops a chapter from the queue before its folder is read back into the download list, so when the queue
 * empties look once more shortly after; otherwise the last chapter could stay missing until the page regains focus.
 */
export function mangaNextDelay(queue: { status: string }[], hadQueue: boolean) {
    return mangaPollDelay(queue) ?? (hadQueue ? 2000 : null)
}
