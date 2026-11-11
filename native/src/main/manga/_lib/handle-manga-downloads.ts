import type { HibikeManga_ChapterDetails, Manga_MediaDownloadData, Nullish } from "@/api/generated/types"
import { useDownloadMangaChapters, useGetMangaDownloadData } from "@/api/hooks/manga_download.hooks"
import { toast } from "@/components/ui/toast/toast-store"
import { tr } from "@/lib/app-language"
import { useRouter } from "@/lib/navigation"
import { useSelectedMangaProvider } from "@/main/manga/_lib/handle-manga-selected-provider"
import { mangaDownloadChapterItems } from "@/main/manga/_lib/manga-downloads"
import { atom, useAtomValue, useSetAtom } from "jotai"
import React from "react"

/*
 * Chapter downloads of a manga (handle-manga-downloads.ts). The Go server loads the chapters itself
 * (/api/v1/manga/download-chapters, its own queue, files under its data folder); the app only asks and lists. The old
 * Android-only bridge (OfflineBridge.cacheManga for cover and description) is not needed here: the server keeps the
 * media in its download list (§9).
 */

/** The open manga's download data: the reader looks for downloaded neighbours in it */
const __manga_entryDownloadDataAtom = atom<Manga_MediaDownloadData | undefined>(undefined)

const __manga_entryDownloadedChaptersAtom = atom(get => mangaDownloadChapterItems(get(__manga_entryDownloadDataAtom)))

export function useMangaEntryDownloadedChapters() {
    return useAtomValue(__manga_entryDownloadedChaptersAtom)
}

/** Loads a manga's download data and keeps it for the reader's chapter steps. */
export function useHandleMangaDownloadData(mediaId: Nullish<string | number>) {
    const { data, isLoading, isError } = useGetMangaDownloadData({ mediaId: mediaId ? Number(mediaId) : undefined })
    const setDownloadData = useSetAtom(__manga_entryDownloadDataAtom)
    React.useEffect(() => {
        setDownloadData(data)
    }, [data, setDownloadData])
    return { downloadData: data, downloadDataLoading: isLoading, downloadDataError: isError }
}

/** Queues chapters of the selected source on the server and starts its queue. */
export function useHandleDownloadMangaChapter(mediaId: Nullish<string | number>) {
    const router = useRouter()
    const { selectedProvider } = useSelectedMangaProvider(mediaId)
    const { mutate, isPending } = useDownloadMangaChapters(mediaId, selectedProvider)
    return {
        downloadChapters: (chapters: HibikeManga_ChapterDetails[]) => {
            if (!selectedProvider || !chapters.length) return
            mutate({ mediaId: Number(mediaId), provider: selectedProvider, chapterIds: chapters.map(ch => ch.id), startNow: true }, {
                onSuccess: () => toast.success(tr("Downloading chapters", "Kapitel werden heruntergeladen"), {
                    action: { label: "Downloads", onClick: () => router.push("/android-downloads?kind=manga") },
                }),
            })
        },
        isSendingDownloadRequest: isPending,
    }
}
