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
type ContainerChapter = { id: string, chapter: string, provider: string, language?: string, scanlator?: string }
type ChapterContainer = { mediaId: number, chapters?: ContainerChapter[] | null }

/**
 * The previous or next chapter (useHandleChapterPagination): a downloaded one first, then the neighbour in the source's
 * list and the closest number in the source; of these the closest to the current chapter wins, a downloaded one on a tie.
 * The source's chapters are those of the open chapter's strand (same language and scanlator), so the reader does not
 * jump into another translation; a provider with one strand is not changed by this.
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

    const open = container.chapters.find(chapter => chapter.id === current.chapterId)
    const chapters = open
        ? container.chapters.filter(chapter => (chapter.language ?? "") === (open.language ?? "") && (chapter.scanlator ?? "") === (open.scanlator ?? ""))
        : container.chapters
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

type PageSize = { width: number, height: number }

/**
 * Which pages show together (useHydrateMangaPaginationMap): one per step in single page and long strip mode; in double
 * page mode two side by side, a spread alone, and the first `offset` pages alone (the cover). A spread: with the sizes of
 * every page (`pageDimensions`, the server's way) a page wider than the usual width; else (4.3.0, the core gives no
 * sizes) a page whose loaded picture (`measured`) is wider than tall. A page not loaded yet counts as a usual one, so the
 * map changes only once a spread has loaded.
 */
export function buildPaginationMap(
    pages: { index: number }[],
    pageDimensions: Record<number, PageSize> | null | undefined,
    mode: string,
    doublePageOffset: number,
    measured: Record<number, PageSize> = {},
): Record<number, number[]> {
    const map: Record<number, number[]> = {}
    if (mode === MangaReadingMode.PAGED || mode === MangaReadingMode.LONG_STRIP) {
        pages.forEach((_, i) => { map[i] = [i] })
        return map
    }
    const known = pageDimensions && Object.keys(pageDimensions).length > 0 ? pageDimensions : null
    let fullSpreadThreshold = 2000
    const recurring = known ? getRecurringNumber(Object.values(known).map(n => n.width)) : undefined
    // padding for small differences
    if (!!recurring && recurring > 0) fullSpreadThreshold = recurring + 50
    const wide = (i: number) => {
        if (known) return (known[i]?.width || 0) > fullSpreadThreshold
        // the picture's own shape: the screen may load it smaller, its width alone says nothing
        const size = measured[i]
        return !!size && size.height > 0 && size.width > size.height
    }
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

/** The pages of a step as they stand from left to right: right to left puts the first page on the right */
export function pagesLeftToRight(pages: number[], direction: string): number[] {
    return direction === MangaReadingDirection.RTL ? [...pages].reverse() : pages
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

/** The first page of a step; undefined while the map has no such step (a chapter whose map is not built yet). */
export function pageOfStep(map: Record<number, number[]>, step: number): number | undefined {
    return map[step]?.[0]
}

/**
 * The reader's state when a chapter opens (4.3.1): at its start page (the saved one or the first), not read, and no
 * pagination map yet. The reader sets it before it lays out the chapter's pages, so neither the step 0 nor the "last
 * page" of the chapter before can reach the new one: the paged reader then finds the step of the start page itself.
 */
export function chapterStartState(startPage: number) {
    return { isLastPage: false, currentPageIndex: startPage, currentMapIndex: 0, paginationMap: {} as Record<number, number[]> }
}

/**
 * Whether "Auto update progress" saves the open chapter now: switched on, not incognito, the chapter after the saved
 * progress, its pages there, on its last page, once per chapter, and only after the chapter's own start state was set
 * (`startedFor`): until then "last page" may still be the previous chapter's.
 */
export function shouldAutoSaveProgress(state: {
    enabled: boolean, incognito: boolean, chapterId: string | undefined, chapterKey: string, startedFor: string,
    shouldUpdate: boolean, pagesReady: boolean, isLastPage: boolean, lastSavedChapterId: string | null,
}) {
    return state.enabled && !state.incognito && !!state.chapterId && state.chapterKey !== "" && state.startedFor === state.chapterKey
        && state.shouldUpdate && state.pagesReady && state.isLastPage && state.lastSavedChapterId !== state.chapterId
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
 * screen (chapter-vertical-reader.tsx); only then the progress may be saved. A strip too short to scroll 1000dp (three
 * pages or fewer on a phone) counts once it is scrolled to its end (4.3.1).
 */
export function isNearStripEnd(offset: number, viewport: number, content: number, hasPages: boolean) {
    const scrollable = content - viewport
    const scrolled = offset > 1000 || (scrollable > 0 && offset >= scrollable - 50)
    return scrolled && hasPages && offset + viewport >= content - 1500
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

/**
 * Long strip: where each page starts, in the list's own layout (`layoutTop`, the FlashList's guess for pages it has not
 * drawn yet) so it fits the scroll offset; our page heights only fill in where the list has no layout.
 */
export function stripPageTops(heights: number[], gap: number, layoutTop: (index: number) => number | undefined) {
    const tops: number[] = []
    let next = 0
    for (let i = 0; i < heights.length; i++) {
        const top = layoutTop(i) ?? next
        tops.push(top)
        next = top + heights[i] + gap
    }
    return tops
}

/**
 * Long strip: the page under the reading line, or null while the saved page is being restored (the jump lands on page
 * heights still guessed, so the index is left alone and nothing wrong is saved until the reader scrolls himself).
 */
export function stripScrollPage({ restoring, tops, offset, line }: { restoring: boolean, tops: number[], offset: number, line: number }) {
    if (restoring || !tops.length) return null
    const y = offset + line
    let page = 0
    for (let i = 0; i < tops.length; i++) if (tops[i] <= y) page = i
    return page
}

export function clampMangaPageZoom(value: number) {
    if (!Number.isFinite(value)) return MANGA_PAGE_ZOOM_DEFAULT
    return Math.min(MANGA_PAGE_ZOOM_MAX, Math.max(MANGA_PAGE_ZOOM_MIN, Number(value.toFixed(2))))
}

/** The page layout "Reset page layout for this mode" goes back to: the mode's fit and stretch at 100 % zoom. */
export function defaultPageLayout(mode: string) {
    const pageFit = mode === MangaReadingMode.LONG_STRIP ? MangaPageFit.COVER : MangaPageFit.CONTAIN
    return { pageFit, pageStretch: MangaPageStretch.NONE, pageZoom: MANGA_PAGE_ZOOM_DEFAULT }
}

export function isDefaultPageLayout(mode: string, layout: { pageFit: string, pageStretch: string, pageZoom: number }) {
    const defaults = defaultPageLayout(mode)
    return layout.pageFit === defaults.pageFit && layout.pageStretch === defaults.pageStretch && layout.pageZoom === defaults.pageZoom
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
