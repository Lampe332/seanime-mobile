import { getDecimalFromChapter, isChapterAfter, isChapterBefore } from "@/main/manga/_lib/handle-manga-utils"
import { MANGA_PAGE_ZOOM_DEFAULT, MANGA_PAGE_ZOOM_MAX, MANGA_PAGE_ZOOM_MIN, MangaPageFit, MangaPageStretch, MangaReadingDirection, MangaReadingMode } from "@/main/manga/_lib/manga-chapter-reader.atoms"

/*
 * The reader's rules without React (handle-chapter-reader.ts, chapter-reader-drawer.tsx, the two readers of the web app),
 * so they are tested: the previous / next chapter, the pagination map of single and double pages, the tap zones, when
 * the progress may be saved, and the page sizes of both modes.
 */

/** The chapter the reader shows */
export type MangaReader_SelectedChapter = {
    chapterNumber: string
    provider: string
    chapterId: string
    mediaId: number
}

type DownloadedChapter = { chapterId: string, chapterNumber: string, provider: string }
type ContainerChapter = { id: string, chapter: string, provider: string }
type ChapterContainer = { mediaId: number, chapters?: ContainerChapter[] | null }

/**
 * The previous or next chapter (useHandleChapterPagination): a downloaded one first, then the neighbour in the source's
 * list and the closest number in the source; of these the closest to the current chapter wins, a downloaded one on a tie.
 */
export function getAdjacentChapter(
    dir: "previous" | "next",
    current: MangaReader_SelectedChapter | undefined,
    downloaded: DownloadedChapter[],
    container: ChapterContainer | undefined,
    mediaId: number | null | undefined,
): MangaReader_SelectedChapter | undefined {
    if (!mediaId || !current) return undefined
    const next = dir === "next"
    const sorted = (list: DownloadedChapter[]) => list.slice().sort((a, b) => next
        ? getDecimalFromChapter(a.chapterNumber) - getDecimalFromChapter(b.chapterNumber)
        : getDecimalFromChapter(b.chapterNumber) - getDecimalFromChapter(a.chapterNumber))
    const beyond = (number: string) => next ? isChapterAfter(number, current.chapterNumber) : isChapterBefore(number, current.chapterNumber)

    const first = sorted(downloaded.filter(ch => ch.chapterId !== current.chapterId)).find(ch => beyond(ch.chapterNumber))
    const downloadedCh = first ? { chapterId: first.chapterId, chapterNumber: first.chapterNumber, provider: first.provider, mediaId: Number(mediaId) } : undefined
    if (!container?.chapters) return downloadedCh

    const chapters = container.chapters
    const idx = chapters.findIndex(chapter => chapter.id === current.chapterId)
    const neighbour = idx !== -1 ? chapters[next ? idx + 1 : idx - 1] : undefined
    const neighbourCh = neighbour ? { chapterId: neighbour.id, chapterNumber: neighbour.chapter, provider: neighbour.provider, mediaId: container.mediaId } : undefined

    const closest = sorted(chapters.filter(ch => ch.id !== current.chapterId).map(ch => ({ chapterId: ch.id, chapterNumber: ch.chapter, provider: ch.provider })))
        .find(ch => beyond(ch.chapterNumber))
    const closestCh = closest ? { ...closest, mediaId: container.mediaId } : undefined

    const options = [downloadedCh, neighbourCh, closestCh].filter(Boolean) as MangaReader_SelectedChapter[]
    if (options.length === 0) return undefined
    if (options.length === 1) return options[0]
    const distance = (ch: MangaReader_SelectedChapter) => Math.abs(getDecimalFromChapter(ch.chapterNumber) - getDecimalFromChapter(current.chapterNumber))
    const best = options.reduce((prev, curr) => distance(prev) < distance(curr) ? prev : curr, options[0])
    // always the downloaded chapter when it is the same number
    if (downloadedCh && getDecimalFromChapter(downloadedCh.chapterNumber) === getDecimalFromChapter(best.chapterNumber)) return downloadedCh
    return best
}

function getRecurringNumber(values: number[]): number | undefined {
    const counts = new Map<number, number>()
    values.forEach(value => counts.set(value, (counts.get(value) || 0) + 1))
    let highestCount = 0
    let highest: number | undefined
    counts.forEach((count, value) => {
        if (count > highestCount) {
            highestCount = count
            highest = value
        }
    })
    return highest
}

/**
 * Which pages show together (useHydrateMangaPaginationMap): one per step in single page and long strip mode or without
 * page sizes; in double page mode two of the usual width side by side, a wider page (a spread) alone, and the first
 * `offset` pages alone.
 */
export function buildPaginationMap(
    pages: { index: number }[],
    pageDimensions: Record<number, { width: number, height: number }> | null | undefined,
    mode: string,
    doublePageOffset: number,
): Record<number, number[]> {
    const map: Record<number, number[]> = {}
    if (mode === MangaReadingMode.PAGED || mode === MangaReadingMode.LONG_STRIP || !pageDimensions || Object.keys(pageDimensions).length === 0) {
        pages.forEach((_, i) => { map[i] = [i] })
        return map
    }
    let fullSpreadThreshold = 2000
    const recurring = getRecurringNumber(Object.values(pageDimensions).map(n => n.width))
    // padding for small differences
    if (!!recurring && recurring > 0) fullSpreadThreshold = recurring + 50
    const wide = (i: number) => (pageDimensions[i]?.width || 0) > fullSpreadThreshold
    let i = 0
    let mapI = 0
    while (i < pages.length) {
        if (doublePageOffset > 0 && i + 1 <= doublePageOffset) {
            map[mapI] = [pages[i].index]
            i++
        } else if (wide(i)) {
            map[mapI] = [pages[i].index]
            i++
        } else if (pages[i + 1] && !wide(i + 1)) {
            map[mapI] = [pages[i].index, pages[i + 1].index]
            i += 2
        } else {
            map[mapI] = [pages[i].index]
            i++
        }
        mapI++
    }
    return map
}

/** The step of the map that holds the page (0 when none does). */
export function mapIndexForPage(map: Record<number, number[]>, pageIndex: number) {
    for (const [index, pages] of Object.entries(map)) {
        if (pages.includes(pageIndex)) return Number(index)
    }
    return 0
}

/** "-4" when the page is shown together with a second one (the bar shows "3-4 / 20"), else "". */
export function secondPageLabel(map: Record<number, number[]>, currentPageIndex: number) {
    let second = 0
    for (const pages of Object.values(map)) {
        if (pages.includes(currentPageIndex)) second = pages[1]
    }
    if (Number.isNaN(second) || !second || second === currentPageIndex) return ""
    return `-${second + 1}`
}

/** The next step of the map for a tap or swipe on one side; the same step at either end. */
export function stepPaginationMap(map: Record<number, number[]>, current: number, side: "left" | "right", direction: string) {
    const back = side === "left" && direction === MangaReadingDirection.LTR || side === "right" && direction === MangaReadingDirection.RTL
    const next = back ? current - 1 : current + 1
    return Object.prototype.hasOwnProperty.call(map, next) ? next : current
}

/** The paged reader's tap zones: the outer 40 % turn the page, the middle shows or hides the controls. */
export function readerTapZone(x: number, width: number): "left" | "right" | "middle" {
    if (!(width > 0)) return "middle"
    const percent = (x / width) * 100
    if (percent <= 40) return "left"
    if (percent >= 60) return "right"
    return "middle"
}

/** Saving goes to AniList only for a chapter after the saved progress (and any chapter without progress). */
export function shouldUpdateMangaProgress(chapterNumber: number | null | undefined, progress: number | null | undefined) {
    if (!chapterNumber) return false
    if (!progress) return true
    return chapterNumber > progress
}

/**
 * Long strip: the chapter counts as read once the strip is scrolled past 1000dp and its end is less than 1500dp below the
 * screen (chapter-vertical-reader.tsx); only then the progress may be saved.
 */
export function isNearStripEnd(offset: number, viewport: number, content: number, hasPages: boolean) {
    return offset > 1000 && hasPages && offset + viewport >= content - 1500
}

/** The page under the reading line (`line` dp below the top of the screen) in a strip of pages with `gap` between them. */
export function pageAtLine(heights: number[], gap: number, offset: number, line: number) {
    const y = offset + line
    let top = 0
    for (let i = 0; i < heights.length; i++) {
        const bottom = top + heights[i]
        if (y >= top && y < bottom + gap) return i
        top = bottom + gap
    }
    return Math.max(0, heights.length - 1)
}

export function clampMangaPageZoom(value: number) {
    if (!Number.isFinite(value)) return MANGA_PAGE_ZOOM_DEFAULT
    return Math.min(MANGA_PAGE_ZOOM_MAX, Math.max(MANGA_PAGE_ZOOM_MIN, Number(value.toFixed(2))))
}

/** A page's height over its width; a usual manga page until the picture has loaded. */
export const DEFAULT_PAGE_RATIO = 1.42

type PageSizeInput = {
    fit: string
    stretch: string
    zoom: number
    /** "Page width" of the overflow fit, in % */
    overflowWidth: number
    /** the reader's width without its 16dp sides */
    width: number
    /** the reader's height */
    height: number
    ratio: number
    /** the picture's own width in px (= dp, as the web's CSS px); 0 while unknown */
    naturalWidth: number
    /** tablet.css: a long strip's Whole page is a readable 48rem column on a tablet, not squeezed to the screen's height */
    tabletColumn?: boolean
}

/** The column a tablet reads a long strip's Whole page in (tablet.css, `width: min(100%, 48rem); height: auto`) */
export const TABLET_STRIP_COLUMN = 768

/**
 * A page's size in the long strip (chapter-vertical-reader.tsx): Whole page fits the screen height (less 60dp), Fit width
 * fills the width, Overflow takes the "Page width", Original its own width (never wider than the reader); "Same width for
 * all pages" stretches Whole page and Overflow to the full / chosen width. The Zoom setting scales the page. On a tablet
 * Whole page takes the 48rem column (or the reader's width when narrower), stretched or not.
 */
export function stripPageSize({ fit, stretch, zoom, overflowWidth, width, height, ratio, naturalWidth, tabletColumn }: PageSizeInput) {
    let pageWidth: number
    if (fit === MangaPageFit.COVER) pageWidth = width
    else if (fit === MangaPageFit.LARGER) pageWidth = width * Math.min(100, Math.max(10, overflowWidth)) / 100
    else if (fit === MangaPageFit.TRUE_SIZE) pageWidth = Math.min(width, naturalWidth || width)
    else if (tabletColumn) pageWidth = Math.min(width, TABLET_STRIP_COLUMN)
    else pageWidth = stretch === MangaPageStretch.STRETCH ? width : Math.min(width, Math.max(1, height - 60) / ratio)
    pageWidth *= zoom
    return { width: Math.round(pageWidth), height: Math.round(pageWidth * ratio) }
}

/**
 * A page's size in single / double page mode (chapter-horizontal-reader.tsx): Whole page fits into the reader (half of it
 * per page of a pair), Fit width fills the width and scrolls down, Overflow takes the "Page width" (double page: the full
 * width), Original its own width. The Zoom setting scales the page; the reader then scrolls both ways.
 */
export function pagedPageSize({ fit, zoom, overflowWidth, width, height, ratio, naturalWidth, double }: Omit<PageSizeInput, "stretch"> & { double: boolean }) {
    const slot = double ? width / 2 : width
    let pageWidth: number
    if (fit === MangaPageFit.CONTAIN) pageWidth = Math.min(slot, height / ratio)
    else if (fit === MangaPageFit.LARGER) pageWidth = double ? slot : slot * Math.min(100, Math.max(10, overflowWidth)) / 100
    else if (fit === MangaPageFit.TRUE_SIZE) pageWidth = naturalWidth || slot
    else pageWidth = slot
    pageWidth *= zoom
    return { width: Math.round(pageWidth), height: Math.round(pageWidth * ratio) }
}
