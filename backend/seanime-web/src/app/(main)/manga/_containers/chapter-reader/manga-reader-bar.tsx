import { AL_BaseManga, Manga_PageContainer } from "@/api/generated/types"
import { ___manga_scrollSignalAtom } from "@/app/(main)/manga/_containers/chapter-reader/_components/chapter-vertical-reader"
import {
    ChapterReaderSettings,
} from "@/app/(main)/manga/_containers/chapter-reader/chapter-reader-settings"
import { __manga_selectedChapterAtom, MangaReader_SelectedChapter, useEffectiveReadingMode, useHandleChapterPageStatus } from "@/app/(main)/manga/_lib/handle-chapter-reader"
import {
    __manga_currentPageIndexAtom,
    __manga_currentPaginationMapIndexAtom,
    __manga_hiddenBarAtom,
    __manga_pageFitAtom,
    __manga_pageStretchAtom,
    __manga_pageZoomAtom,
    __manga_paginationMapAtom,
    __manga_readerProgressBarAtom,
    __manga_readingDirectionAtom,
    MangaReadingDirection,
    MangaReadingMode,
} from "@/app/(main)/manga/_lib/manga-chapter-reader.atoms"
import { cn } from "@/components/ui/core/styling"
import { useSetAtom } from "jotai"
import { useAtom, useAtomValue } from "jotai/react"
import React from "react"
import { BiX } from "react-icons/bi"
import { LuChevronLeft, LuChevronRight } from "react-icons/lu"
import { useTr } from "@/lib/app-language"
import "@/components/shared/mobile-surface.css"
import "./chapter-reader-settings-mobile.css"

type MangaReaderBarProps = {
    children?: React.ReactNode
    previousChapter: MangaReader_SelectedChapter | undefined
    nextChapter: MangaReader_SelectedChapter | undefined
    goToChapter: (dir: "previous" | "next") => void
    pageContainer: Manga_PageContainer | undefined
    entry: { mediaId: number, media?: AL_BaseManga } | undefined
}

export function MangaReaderBar(props: MangaReaderBarProps) {

    const {
        children,
        previousChapter,
        nextChapter,
        pageContainer,
        entry,
        goToChapter,
        ...rest
    } = props

    const [selectedChapter, setSelectedChapter] = useAtom(__manga_selectedChapterAtom)

    const [currentPageIndex, setCurrentPageIndex] = useAtom(__manga_currentPageIndexAtom)
    const paginationMap = useAtomValue(__manga_paginationMapAtom)
    const readingMode = useEffectiveReadingMode()
    const readingDirection = useAtomValue(__manga_readingDirectionAtom)

    const hiddenBar = useAtomValue(__manga_hiddenBarAtom)

    /**
     * Format the second part of pagination text
     * e.g. 1-2 / 10
     */
    const secondPageText = React.useMemo(() => {
        let secondPageIndex = 0
        for (const [key, values] of Object.entries(paginationMap)) {
            if (paginationMap[Number(key)].includes(currentPageIndex)) {
                secondPageIndex = values[1]
            }
        }
        if (isNaN(secondPageIndex) || secondPageIndex === 0 || secondPageIndex === currentPageIndex) return ""
        return "-" + (secondPageIndex + 1)
    }, [currentPageIndex, paginationMap])

    /**
     * Pagination
     */
    const [currentMapIndex, setCurrentMapIndex] = useAtom(__manga_currentPaginationMapIndexAtom)
    const setScrollSignal = useSetAtom(___manga_scrollSignalAtom)
    const handlePageChange = React.useCallback((pageIdx: number) => {
        if (readingMode === MangaReadingMode.PAGED) {
            setCurrentPageIndex(pageIdx)
            setCurrentMapIndex(pageIdx)
        } else if (readingMode === MangaReadingMode.DOUBLE_PAGE) {
            setCurrentMapIndex(prevMapIdx => {
                // Find the new map index based on the page index
                // e.g., { 0: [0, 1], 1: [2, 3], 2: [4, 5] }
                //   if pageIdx is 3, then the new map index is 1
                const newMapIdx = Object.keys(paginationMap).find(key => paginationMap[Number(key)].includes(pageIdx))
                if (newMapIdx === undefined) return prevMapIdx
                return Number(newMapIdx)
            })
            setCurrentPageIndex(pageIdx)
        } else {
            setCurrentPageIndex(pageIdx)
            setScrollSignal(p => p + 1)
        }
    }, [readingMode, paginationMap])

    useHandleChapterPageStatus(pageContainer)
    const t = useTr()

    if (!entry) return null

    // Android: one calm bar with equal round buttons and a page slider above it.
    const reversed = readingDirection === MangaReadingDirection.RTL && readingMode !== MangaReadingMode.LONG_STRIP
    const pageCount = pageContainer?.pages?.length ?? 0
    const previous = <button type="button" className="reader-bar-btn" disabled={!previousChapter} aria-label={t("Previous chapter", "Vorheriges Kapitel")}
        onClick={() => previousChapter && goToChapter("previous")}>{reversed ? <LuChevronRight aria-hidden /> : <LuChevronLeft aria-hidden />}</button>
    const next = <button type="button" className="reader-bar-btn" disabled={!nextChapter} aria-label={t("Next chapter", "Nächstes Kapitel")}
        onClick={() => nextChapter && goToChapter("next")}>{reversed ? <LuChevronLeft aria-hidden /> : <LuChevronRight aria-hidden />}</button>
    return (
        <>
            {/* Stays mounted while hidden so it slides away with the bar (visibility takes it out of reach once down) */}
            {pageCount > 1 && <div className={cn("reader-page-slider", hiddenBar && "is-hidden")} data-reader-page-slider aria-hidden={hiddenBar || undefined}>
                <input
                    type="range"
                    min={0}
                    max={pageCount - 1}
                    step={1}
                    value={Math.min(currentPageIndex, pageCount - 1)}
                    dir={reversed ? "rtl" : "ltr"}
                    aria-label={t("Page", "Seite")}
                    aria-valuetext={`${currentPageIndex + 1} / ${pageCount}`}
                    onChange={e => handlePageChange(Number(e.target.value))}
                />
            </div>}
            <div data-manga-reader-bar id="manga-reader-bar" className={cn("reader-phone-bar", hiddenBar && "is-hidden")}>
                <button type="button" className="reader-bar-btn" aria-label={t("Close reader", "Leser schließen")} onClick={() => setSelectedChapter(undefined)}>
                    <BiX aria-hidden />
                </button>
                {!!selectedChapter && <div className="reader-bar-chapter" role="group" aria-label={t("Chapter", "Kapitel")}>
                    {reversed ? next : previous}
                    <span>{t("Ch.", "Kap.")} {selectedChapter.chapterNumber}</span>
                    {reversed ? previous : next}
                </div>}
                <div className="flex-1" />
                {pageCount > 0 && <span className="reader-bar-pages" aria-live="polite">
                    {currentPageIndex + 1}{secondPageText}<span> / {pageCount}</span>
                </span>}
                <ChapterReaderSettings mediaId={entry.mediaId} />
            </div>
        </>
    )
}
