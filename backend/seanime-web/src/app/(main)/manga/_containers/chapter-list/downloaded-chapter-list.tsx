// /* -------------------------------------------------------------------------------------------------
//  * Download List
//  * -----------------------------------------------------------------------------------------------*/

import { Manga_ChapterContainer, Manga_Entry } from "@/api/generated/types"
import { useDeleteMangaDownloadedChapters } from "@/api/hooks/manga_download.hooks"

import { useSetCurrentChapter } from "@/app/(main)/manga/_lib/handle-chapter-reader"
import { MangaDownloadChapterItem, useMangaEntryDownloadedChapters } from "@/app/(main)/manga/_lib/handle-manga-downloads"
import { useSelectedMangaProvider } from "@/app/(main)/manga/_lib/handle-manga-selected-provider"
import { getChapterNumberFromChapter } from "@/app/(main)/manga/_lib/handle-manga-utils"
import { atom } from "jotai"
import { useAtom } from "jotai/react"
import React from "react"
import { ConfirmationDialog, useConfirmationDialog } from "@/components/shared/confirmation-dialog"
import { useTr } from "@/lib/app-language"
import { LuBookOpen, LuTrash2 } from "react-icons/lu"

export const manga_downloadedChapterContainerAtom = atom<Manga_ChapterContainer | null>(null)

/** Android: the manga page's "Downloaded" tab. Read a saved chapter with a tap, delete one with its trash button. */
export function MobileDownloadedChapters({ entry }: { entry: Manga_Entry }) {
    const t = useTr()
    const { selectedProvider } = useSelectedMangaProvider(entry.mediaId)
    const [, setDownloadedChapterContainer] = useAtom(manga_downloadedChapterContainerAtom)
    const setCurrentChapter = useSetCurrentChapter()
    const { mutate: deleteChapters, isPending: isDeleting } = useDeleteMangaDownloadedChapters(String(entry.mediaId), selectedProvider)
    const chapters = useMangaEntryDownloadedChapters()
    const sorted = React.useMemo(() => [...chapters].sort((a, b) =>
        getChapterNumberFromChapter(a.chapterNumber) - getChapterNumberFromChapter(b.chapterNumber)), [chapters])
    const [deleting, setDeleting] = React.useState<MangaDownloadChapterItem | null>(null)
    const confirmDelete = useConfirmationDialog({
        title: t("Delete chapter?", "Kapitel löschen?"),
        description: deleting ? t(`Chapter ${deleting.chapterNumber} will be removed from this device.`, `Kapitel ${deleting.chapterNumber} wird von diesem Gerät entfernt.`) : "",
        actionText: t("Delete", "Löschen"),
        actionIntent: "alert",
        onConfirm: () => {
            if (!deleting) return
            deleteChapters({
                downloadIds: [{ mediaId: entry.mediaId, provider: deleting.provider, chapterId: deleting.chapterId, chapterNumber: deleting.chapterNumber }],
            })
            setDeleting(null)
        },
        onCancel: () => setDeleting(null),
    })
    const read = (chapter: MangaDownloadChapterItem) => React.startTransition(() => {
        setDownloadedChapterContainer({ mediaId: Number(entry.mediaId), provider: chapter.provider, chapters: [] })
        setCurrentChapter({ chapterId: chapter.chapterId, chapterNumber: chapter.chapterNumber, provider: chapter.provider, mediaId: Number(entry.mediaId) })
    })

    if (!sorted.length) return <div className="mobile-chapter-empty-state" data-mobile-downloaded-chapters>
        <p>{t("No chapters on this device yet.", "Noch keine Kapitel auf diesem Gerät.")}</p>
        <p>{t("Use the download button next to a chapter in Online reading.", "Nutze den Download-Knopf neben einem Kapitel unter Online lesen.")}</p>
    </div>

    return (
        <div className="mobile-chapters" data-mobile-downloaded-chapters>
            <ul className="mobile-chapter-list" aria-label={t("Downloaded chapters", "Geladene Kapitel")}>
                {sorted.map(chapter => <li key={chapter.chapterId} data-mobile-downloaded-chapter={chapter.chapterNumber}>
                    <button type="button" className="mobile-chapter-open" disabled={!chapter.downloaded} onClick={() => read(chapter)}>
                        <span className="mobile-chapter-title">{t("Chapter", "Kapitel")} {chapter.chapterNumber}</span>
                        <span className="mobile-chapter-meta">{chapter.downloaded
                            ? [t("Saved on this device", "Auf diesem Gerät gespeichert"), chapter.provider].join(" · ")
                            : t("Queued", "In der Warteschlange")}</span>
                    </button>
                    {chapter.downloaded && <span className="mobile-chapter-state mobile-chapter-state-saved" aria-hidden><LuBookOpen /></span>}
                    {chapter.downloaded && <button type="button" className="mobile-chapter-action" disabled={isDeleting}
                        aria-label={t(`Delete chapter ${chapter.chapterNumber}`, `Kapitel ${chapter.chapterNumber} löschen`)}
                        onClick={() => { setDeleting(chapter); React.startTransition(() => confirmDelete.open()) }}>
                        <LuTrash2 aria-hidden />
                    </button>}
                </li>)}
            </ul>
            <ConfirmationDialog {...confirmDelete} />
        </div>
    )
}
