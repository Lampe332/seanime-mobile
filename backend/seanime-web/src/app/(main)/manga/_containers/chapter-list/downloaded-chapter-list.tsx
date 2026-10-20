// /* -------------------------------------------------------------------------------------------------
//  * Download List
//  * -----------------------------------------------------------------------------------------------*/


import { Manga_ChapterContainer, Manga_Entry, Manga_MediaDownloadData } from "@/api/generated/types"
import { useDeleteMangaDownloadedChapters } from "@/api/hooks/manga_download.hooks"

import { useSetCurrentChapter } from "@/app/(main)/manga/_lib/handle-chapter-reader"
import { MangaDownloadChapterItem, useMangaEntryDownloadedChapters } from "@/app/(main)/manga/_lib/handle-manga-downloads"
import { useSelectedMangaProvider } from "@/app/(main)/manga/_lib/handle-manga-selected-provider"
import { getChapterNumberFromChapter } from "@/app/(main)/manga/_lib/handle-manga-utils"
import { primaryPillCheckboxClasses } from "@/components/shared/classnames"
import { Button, IconButton } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DataGrid, defineDataGridColumns } from "@/components/ui/datagrid"
import { DataGridRowSelectedEvent } from "@/components/ui/datagrid/use-datagrid-row-selection"
import { RowSelectionState } from "@tanstack/react-table"
import { atom } from "jotai"
import { useAtom } from "jotai/react"
import React from "react"
import { BiTrash } from "react-icons/bi"
import { GiOpenBook } from "react-icons/gi"
import { MdOutlineOfflinePin } from "react-icons/md"
import { ConfirmationDialog, useConfirmationDialog } from "@/components/shared/confirmation-dialog"
import { useTr } from "@/lib/app-language"
import { LuBookOpen, LuTrash2 } from "react-icons/lu"

export const manga_downloadedChapterContainerAtom = atom<Manga_ChapterContainer | null>(null)

type DownloadedChapterListProps = {
    entry: Manga_Entry
    data: Manga_MediaDownloadData | undefined
}

export function DownloadedChapterList(props: DownloadedChapterListProps) {

    const {
        entry,
        data,
        ...rest
    } = props

    const { selectedProvider } = useSelectedMangaProvider(entry.mediaId)

    const [, setDownloadedChapterContainer] = useAtom(manga_downloadedChapterContainerAtom)

    /**
     * Set selected chapter
     */
    const setCurrentChapter = useSetCurrentChapter()

    const [showQueued, setShowQueued] = React.useState(false)

    const { mutate: deleteChapters, isPending: isDeletingChapter } = useDeleteMangaDownloadedChapters(String(entry.mediaId), selectedProvider)

    const downloadedOrQueuedChapters = useMangaEntryDownloadedChapters()

    /**
     * Transform downloadedOrQueuedChapters into a dynamic list based on the showQueued state
     */
    const tableData = React.useMemo(() => {
        if (!showQueued) return downloadedOrQueuedChapters
        return downloadedOrQueuedChapters.filter(chapter => chapter.queued)
    }, [data, downloadedOrQueuedChapters, showQueued])

    const chapterIdsToNumber = React.useMemo(() => {
        const map = new Map<string, number>()
        for (const chapter of tableData ?? []) {
            map.set(chapter.chapterId, getChapterNumberFromChapter(chapter.chapterNumber))
        }
        return map
    }, [tableData])

    const columns = React.useMemo(() => defineDataGridColumns<MangaDownloadChapterItem>(() => [
        {
            accessorKey: "chapterNumber",
            header: "Chapter",
            size: 90,
            cell: info => <span>Chapter {info.getValue<string>()}</span>,
        },
        {
            id: "number",
            header: "Number",
            size: 10,
            enableSorting: true,
            accessorFn: (row) => {
                return chapterIdsToNumber.get(row.chapterId)
            },
        },
        {
            accessorKey: "provider",
            header: "Provider",
            size: 10,
        },
        {
            accessorKey: "chapterId",
            header: "Chapter ID",
            size: 20,
            cell: info => <span className="text-[--muted] text-sm italic">{info.getValue<string>()}</span>,
        },
        {
            id: "_actions",
            size: 10,
            enableSorting: false,
            enableGlobalFilter: false,
            cell: ({ row }) => {
                return (
                    <div className="flex justify-end gap-2 items-center w-full">
                        {row.original.queued && <p className="text-[--muted]">Queued</p>}
                        {row.original.downloaded && <p className="text-[--muted] px-1"><MdOutlineOfflinePin className="text-2xl" /></p>}

                        {row.original.downloaded && <IconButton
                            intent="gray-subtle"
                            size="md"
                            onClick={() => {
                                /**
                                 * Set the provider to the one of the selected chapter
                                 * This is because the provider is needed to fetch the chapter pages
                                 */
                                // setProvider({
                                //     mId: entry.mediaId,
                                //     provider: row.original.provider as Manga_Provider,
                                // })
                                React.startTransition(() => {
                                    // Set the selected chapter
                                    setDownloadedChapterContainer({
                                        mediaId: Number(entry.mediaId),
                                        provider: row.original.provider,
                                        chapters: [],
                                    })
                                    setCurrentChapter({
                                        chapterId: row.original.chapterId,
                                        chapterNumber: row.original.chapterNumber,
                                        provider: row.original.provider,
                                        mediaId: Number(entry.mediaId),
                                    })
                                })
                            }}
                            icon={<GiOpenBook />}
                        />}
                    </div>
                )
            },
        },
    ]), [tableData, entry?.mediaId, chapterIdsToNumber])

    const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({})

    const [selectedChapters, setSelectedChapters] = React.useState<MangaDownloadChapterItem[]>([])

    const onSelectChange = React.useCallback((event: DataGridRowSelectedEvent<MangaDownloadChapterItem>) => {
        setSelectedChapters(event.data)
    }, [])

    const handleDeleteSelectedChapters = React.useCallback(() => {
        if (!!selectedChapters.length) {
            deleteChapters({
                downloadIds: selectedChapters.map(chapter => ({
                    mediaId: entry.mediaId,
                    provider: chapter.provider,
                    chapterId: chapter.chapterId,
                    chapterNumber: chapter.chapterNumber,
                })),
            }, {
                onSuccess: () => {
                },
            })
            setRowSelection({})
            setSelectedChapters([])
        }
    }, [selectedChapters])

    if (!data || Object.keys(data.downloaded).length === 0 && Object.keys(data.queued).length === 0) return null

    return (
        <>
            <h3 className="pt-8">Downloaded chapters</h3>

            <div data-downloaded-chapter-list-container className="space-y-4 rounded-2xl border bg-[--paper] p-4">

                <div className="flex flex-wrap items-center gap-4">
                    <Checkbox
                        label="Show queued"
                        value={showQueued}
                        onValueChange={v => setShowQueued(v as boolean)}
                        fieldClass="w-fit"
                        {...primaryPillCheckboxClasses}
                    />
                </div>

                {!!selectedChapters.length && <div
                    className=""
                >
                    <Button
                        onClick={handleDeleteSelectedChapters}
                        intent="alert"
                        size="sm"
                        leftIcon={<BiTrash />}
                        className=""
                        loading={isDeletingChapter}
                    >
                        Delete selected chapters ({selectedChapters?.length})
                    </Button>
                </div>}

                <DataGrid<MangaDownloadChapterItem>
                    columns={columns}
                    data={tableData}
                    rowCount={tableData.length}
                    isLoading={false}
                    rowSelectionPrimaryKey="chapterId"
                    enableRowSelection={row => (row.original.downloaded)}
                    initialState={{
                        pagination: {
                            pageIndex: 0,
                            pageSize: 10,
                        },
                        sorting: [
                            {
                                id: "number",
                                desc: false,
                            },
                        ],
                    }}
                    state={{
                        rowSelection,
                    }}
                    hideColumns={[
                        {
                            below: 1000,
                            hide: ["chapterId", "number"],
                        },
                        {
                            below: 600,
                            hide: ["provider"],
                        },
                    ]}
                    onSortingChange={console.log}
                    onRowSelect={onSelectChange}
                    onRowSelectionChange={setRowSelection}
                    className=""
                    tableClass="table-fixed lg:table-fixed"
                    tableBodyClass="border-0"
                    tdClass="border-[rgba(255,255,255,0.05)]"
                />
            </div>
        </>
    )
}

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
