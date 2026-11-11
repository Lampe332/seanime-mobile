import type { AL_BaseManga, Manga_ChapterContainer, Manga_EntryListData, Manga_PageContainer } from "@/api/generated/types"
import {
    buildPaginationMap,
    clampMangaPageZoom,
    getAdjacentChapter,
    mapIndexForPage,
    type MangaReader_SelectedChapter,
} from "@/main/manga/_lib/chapter-reader"
import { useMangaEntryDownloadedChapters } from "@/main/manga/_lib/handle-manga-downloads"
import {
    __manga_currentPageIndexAtom,
    __manga_currentPaginationMapIndexAtom,
    __manga_doublePageOffsetAtom,
    __manga_pageZoomAtom,
    __manga_paginationMapAtom,
    __manga_readingModeAtom,
    MANGA_PAGE_ZOOM_DEFAULT,
    MANGA_PAGE_ZOOM_STEP,
} from "@/main/manga/_lib/manga-chapter-reader.atoms"
import { resolveReadingMode } from "@/main/manga/_lib/reader-mode"
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai"
import React from "react"
import { useWindowDimensions } from "react-native"

/*
 * The reader's state and hooks (handle-chapter-reader.ts). The keyboard parts (mousetrap: m/d/f/s/u/b, [ ], arrows),
 * the ctrl+wheel zoom and the mouse drag of the web reader have no counterpart on a touch phone and are left out; the
 * gestures live in use-reader-gestures.ts.
 */

export type { MangaReader_SelectedChapter } from "@/main/manga/_lib/chapter-reader"

/**
 * The chapter being read; set opens the reader, undefined closes it. Not stored like the web's "sea-manga-chapter": a
 * stored chapter would open the reader again on the next start, over whatever manga page comes first (§9).
 */
export const __manga_selectedChapterAtom = atom<MangaReader_SelectedChapter | undefined>(undefined)

export function useSetCurrentChapter() {
    return useSetAtom(__manga_selectedChapterAtom)
}

export function useCurrentChapter() {
    return useAtomValue(__manga_selectedChapterAtom)
}

/** What the reader reads from: the manga and the chapter list of its page (or of the Downloads tab). */
export type MangaReaderSource = {
    entry: { mediaId: number, media?: AL_BaseManga, listData?: Manga_EntryListData }
    chapterContainer: Manga_ChapterContainer
}

/** Set by the screen that opens the reader; the reader itself is mounted once in the main layout, over the bar. */
export const __manga_readerSourceAtom = atom<MangaReaderSource | null>(null)

/** Hands the reader its manga and chapter list while the screen is shown. */
export function useMangaReaderSource(source: MangaReaderSource | null) {
    const setSource = useSetAtom(__manga_readerSourceAtom)
    React.useEffect(() => {
        if (source) setSource(source)
    }, [source, setSource])
}

const __manga_readerLoadedPagesAtom = atom<number[]>([])

export function useHandleChapterPageStatus(pageContainer: Manga_PageContainer | undefined) {
    const currentChapter = useCurrentChapter()
    const [loadedPages, setLoadedPages] = useAtom(__manga_readerLoadedPagesAtom)

    React.useEffect(() => {
        setLoadedPages([])
    }, [currentChapter, setLoadedPages])

    const handlePageLoad = React.useCallback((pageIndex: number) => {
        setLoadedPages(prev => prev.includes(pageIndex) ? prev : [...prev, pageIndex])
    }, [setLoadedPages])

    return {
        allPagesLoaded: loadedPages.length > 0 && loadedPages.length === pageContainer?.pages?.length,
        loadedPages,
        handlePageLoad,
    }
}

export function useHandleChapterPagination(mId: number | null | undefined, chapterContainer: Manga_ChapterContainer | undefined) {
    const currentChapter = useCurrentChapter()
    const setCurrentChapter = useSetCurrentChapter()
    const downloaded = useMangaEntryDownloadedChapters()

    const previousChapter = React.useMemo(() => getAdjacentChapter("previous", currentChapter, downloaded, chapterContainer, mId),
        [mId, currentChapter, downloaded, chapterContainer])
    const nextChapter = React.useMemo(() => getAdjacentChapter("next", currentChapter, downloaded, chapterContainer, mId),
        [mId, currentChapter, downloaded, chapterContainer])

    const goToChapter = React.useCallback((dir: "previous" | "next") => {
        if (dir === "previous" && previousChapter) setCurrentChapter(previousChapter)
        else if (dir === "next" && nextChapter) setCurrentChapter(nextChapter)
    }, [setCurrentChapter, previousChapter, nextChapter])

    return { goToChapter, previousChapter, nextChapter }
}

/**
 * The reading mode the reader lays out: the chosen one, or for "auto" (tablet option) double page in wide landscape and
 * single page otherwise. Follows rotation and split screen.
 */
export function useEffectiveReadingMode() {
    const readingMode = useAtomValue(__manga_readingModeAtom)
    const { width, height } = useWindowDimensions()
    return resolveReadingMode(readingMode, { width, height })
}

/** Which pages show together, and the step that holds the current page after a mode or chapter change. */
export function useHydrateMangaPaginationMap(pageContainer?: Manga_PageContainer) {
    const selectedChapter = useAtomValue(__manga_selectedChapterAtom)
    const readingMode = useEffectiveReadingMode()
    const currentPageIndex = useAtomValue(__manga_currentPageIndexAtom)
    const doublePageOffset = useAtomValue(__manga_doublePageOffsetAtom)
    const setPaginationMap = useSetAtom(__manga_paginationMapAtom)
    const setCurrentMapIndex = useSetAtom(__manga_currentPaginationMapIndexAtom)
    // read when the map is rebuilt, not a reason to rebuild it
    const pageIndex = React.useRef(currentPageIndex)
    React.useEffect(() => {
        pageIndex.current = currentPageIndex
    }, [currentPageIndex])

    React.useEffect(() => {
        if (!pageContainer?.pages?.length) return
        const map = buildPaginationMap(pageContainer.pages, pageContainer.pageDimensions, readingMode, doublePageOffset)
        setPaginationMap(map)
        setCurrentMapIndex(mapIndexForPage(map, pageIndex.current))
    }, [pageContainer?.pages, pageContainer?.pageDimensions, readingMode, selectedChapter, doublePageOffset, setPaginationMap, setCurrentMapIndex])
}

export function useMangaPageZoomControls() {
    const [pageZoom, setPageZoom] = useAtom(__manga_pageZoomAtom)
    const setZoom = React.useCallback((value: number | ((previous: number) => number)) => {
        setPageZoom(previous => clampMangaPageZoom(typeof value === "function" ? value(previous) : value))
    }, [setPageZoom])
    return {
        pageZoom,
        setZoom,
        zoomIn: () => setZoom(previous => previous + MANGA_PAGE_ZOOM_STEP),
        zoomOut: () => setZoom(previous => previous - MANGA_PAGE_ZOOM_STEP),
        resetZoom: () => setZoom(MANGA_PAGE_ZOOM_DEFAULT),
    }
}
