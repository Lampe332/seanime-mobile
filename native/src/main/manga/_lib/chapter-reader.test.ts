import { describe, expect, it } from "vitest"
import {
    buildPaginationMap,
    chapterStartState,
    defaultPageLayout,
    getAdjacentChapter,
    isDefaultPageLayout,
    isNearStripEnd,
    mapIndexForPage,
    pageAtLine,
    pageOfStep,
    pagedPageSize,
    pagesLeftToRight,
    readerTapZone,
    secondPageLabel,
    shouldAutoSaveProgress,
    stripPageTops,
    stripScrollPage,
    shouldUpdateMangaProgress,
    stepPaginationMap,
    stripPageSize,
} from "./chapter-reader"

const current = { chapterId: "c10", chapterNumber: "10", provider: "src", mediaId: 7 }
const container = {
    mediaId: 7,
    chapters: [
        { id: "c9", chapter: "9", provider: "src" },
        { id: "c10", chapter: "10", provider: "src" },
        { id: "c10.5", chapter: "10.5", provider: "src" },
        { id: "c11", chapter: "11", provider: "src" },
    ],
}

describe("previous / next chapter", () => {
    it("takes the neighbour of the source list", () => {
        expect(getAdjacentChapter("next", current, [], container, 7)?.chapterId).toBe("c10.5")
        expect(getAdjacentChapter("previous", current, [], container, 7)?.chapterId).toBe("c9")
    })
    it("prefers a downloaded chapter of the same number", () => {
        const downloaded = [{ chapterId: "d10.5", chapterNumber: "10.5", provider: "other" }]
        expect(getAdjacentChapter("next", current, downloaded, container, 7)).toEqual({ chapterId: "d10.5", chapterNumber: "10.5", provider: "other", mediaId: 7 })
    })
    it("uses downloads alone without a source list, and nothing at the ends", () => {
        const downloaded = [{ chapterId: "d12", chapterNumber: "12", provider: "other" }]
        expect(getAdjacentChapter("next", current, downloaded, undefined, 7)?.chapterId).toBe("d12")
        expect(getAdjacentChapter("previous", { ...current, chapterId: "c9", chapterNumber: "9" }, [], container, 7)).toBeUndefined()
        expect(getAdjacentChapter("next", undefined, [], container, 7)).toBeUndefined()
    })
    it("stays in the open chapter's language and scanlator (MangaFire lists every translation in one list)", () => {
        // as MangaFire gives Dr. STONE: the official English numbers 0, 0.001, … next to other translations
        const mixed = {
            mediaId: 7,
            chapters: [
                { id: "en-off-1", chapter: "0", provider: "mf", language: "en", scanlator: "official" },
                { id: "en-off-2", chapter: "0.001", provider: "mf", language: "en", scanlator: "official" },
                { id: "en-fan-1", chapter: "1", provider: "mf", language: "en", scanlator: "fan" },
                { id: "en-fan-2", chapter: "2", provider: "mf", language: "en", scanlator: "fan" },
                { id: "fr-1", chapter: "1", provider: "mf", language: "fr", scanlator: "official" },
                { id: "fr-2", chapter: "2", provider: "mf", language: "fr", scanlator: "official" },
            ],
        }
        const at = (id: string, chapterNumber: string) => ({ chapterId: id, chapterNumber, provider: "mf", mediaId: 7 })
        expect(getAdjacentChapter("next", at("en-off-1", "0"), [], mixed, 7)?.chapterId).toBe("en-off-2")
        expect(getAdjacentChapter("previous", at("en-off-2", "0.001"), [], mixed, 7)?.chapterId).toBe("en-off-1")
        expect(getAdjacentChapter("next", at("en-fan-1", "1"), [], mixed, 7)?.chapterId).toBe("en-fan-2")
        expect(getAdjacentChapter("previous", at("fr-2", "2"), [], mixed, 7)?.chapterId).toBe("fr-1")
        expect(getAdjacentChapter("previous", at("fr-1", "1"), [], mixed, 7)).toBeUndefined()
    })
})

describe("pagination map", () => {
    const pages = [0, 1, 2, 3, 4].map(index => ({ index }))
    it("shows one page per step in single page and long strip mode", () => {
        expect(buildPaginationMap(pages, { 0: { width: 800, height: 1200 } }, "paged", 0)).toEqual({ 0: [0], 1: [1], 2: [2], 3: [3], 4: [4] })
        expect(buildPaginationMap(pages, undefined, "long-strip", 0, { 2: { width: 1600, height: 1200 } })).toEqual({ 0: [0], 1: [1], 2: [2], 3: [3], 4: [4] })
    })
    it("pairs pages without sizes from the core (4.3.0), the cover alone with an offset", () => {
        expect(buildPaginationMap(pages, undefined, "double-page", 0)).toEqual({ 0: [0, 1], 1: [2, 3], 2: [4] })
        expect(buildPaginationMap(pages, null, "double-page", 1)).toEqual({ 0: [0], 1: [1, 2], 2: [3, 4] })
        expect(buildPaginationMap(pages, {}, "double-page", 2)).toEqual({ 0: [0], 1: [1], 2: [2, 3], 3: [4] })
        // a negative offset (the stepper goes to -10) changes nothing
        expect(buildPaginationMap(pages, undefined, "double-page", -3)).toEqual({ 0: [0, 1], 1: [2, 3], 2: [4] })
        expect(buildPaginationMap([], undefined, "double-page", 0)).toEqual({})
    })
    it("keeps a loaded spread alone by its shape, a page not loaded yet counts as a usual one", () => {
        // an 8-page chapter, pages 0-3 loaded, page 5 is a two-page spread not loaded yet
        const chapter = Array.from({ length: 8 }, (_, index) => ({ index }))
        const portrait = { width: 960, height: 1378 }
        const loaded = { 0: portrait, 1: portrait, 2: portrait, 3: portrait }
        expect(buildPaginationMap(chapter, null, "double-page", 0, loaded)).toEqual({ 0: [0, 1], 1: [2, 3], 2: [4, 5], 3: [6, 7] })
        // once the spread has loaded it stands alone and the pairs after it move on by one
        const spread = { ...loaded, 4: portrait, 5: { width: 1920, height: 1378 } }
        expect(buildPaginationMap(chapter, null, "double-page", 0, spread)).toEqual({ 0: [0, 1], 1: [2, 3], 2: [4], 3: [5], 4: [6, 7] })
        // the screen may load a page smaller: a narrower portrait page is no spread
        expect(buildPaginationMap(chapter, null, "double-page", 0, { ...loaded, 2: { width: 480, height: 689 } })).toEqual({ 0: [0, 1], 1: [2, 3], 2: [4, 5], 3: [6, 7] })
        // a landscape cover stands alone without an offset
        expect(buildPaginationMap(chapter, null, "double-page", 0, { 0: { width: 1500, height: 1000 } })).toEqual({ 0: [0], 1: [1, 2], 2: [3, 4], 3: [5, 6], 4: [7] })
        // the server's sizes of every page decide when there are any (Seanime's rule)
        expect(buildPaginationMap(chapter, { 0: portrait, 1: portrait, 2: portrait }, "double-page", 0, { 1: { width: 1920, height: 1378 } }))
            .toEqual({ 0: [0, 1], 1: [2, 3], 2: [4, 5], 3: [6, 7] })
    })
    it("lays a pair out in the reading direction", () => {
        expect(pagesLeftToRight([4, 5], "ltr")).toEqual([4, 5])
        expect(pagesLeftToRight([4, 5], "rtl")).toEqual([5, 4])
        expect(pagesLeftToRight([4], "rtl")).toEqual([4])
        const step = [2, 3]
        pagesLeftToRight(step, "rtl")
        expect(step).toEqual([2, 3])
    })
    it("pairs pages of the usual width and keeps a spread alone", () => {
        const dims = { 0: { width: 800, height: 1200 }, 1: { width: 800, height: 1200 }, 2: { width: 1600, height: 1200 }, 3: { width: 800, height: 1200 }, 4: { width: 800, height: 1200 } }
        expect(buildPaginationMap(pages, dims, "double-page", 0)).toEqual({ 0: [0, 1], 1: [2], 2: [3, 4] })
        expect(buildPaginationMap(pages, dims, "double-page", 1)).toEqual({ 0: [0], 1: [1], 2: [2], 3: [3, 4] })
    })
    it("finds the step of a page and the second page of a pair", () => {
        const map = { 0: [0, 1], 1: [2], 2: [3, 4] }
        expect(mapIndexForPage(map, 4)).toBe(2)
        expect(mapIndexForPage(map, 9)).toBe(0)
        expect(secondPageLabel(map, 3)).toBe("-5")
        expect(secondPageLabel(map, 2)).toBe("")
    })
    it("turns the right way for the reading direction and stops at the ends", () => {
        const map = { 0: [0], 1: [1], 2: [2] }
        expect(stepPaginationMap(map, 1, "right", "ltr")).toBe(2)
        expect(stepPaginationMap(map, 1, "right", "rtl")).toBe(0)
        expect(stepPaginationMap(map, 2, "right", "ltr")).toBe(2)
        expect(stepPaginationMap(map, 0, "left", "ltr")).toBe(0)
    })
})

describe("tap zones", () => {
    it("turns with the outer 40 % and toggles the controls in the middle", () => {
        expect(readerTapZone(100, 400)).toBe("left")
        expect(readerTapZone(160, 400)).toBe("left")
        expect(readerTapZone(200, 400)).toBe("middle")
        expect(readerTapZone(240, 400)).toBe("right")
        expect(readerTapZone(10, 0)).toBe("middle")
    })
})

describe("progress to AniList only when read", () => {
    it("saves a chapter after the saved progress, never an earlier one", () => {
        expect(shouldUpdateMangaProgress(12, 11)).toBe(true)
        expect(shouldUpdateMangaProgress(12, 0)).toBe(true)
        expect(shouldUpdateMangaProgress(11, 11)).toBe(false)
        expect(shouldUpdateMangaProgress(0, 3)).toBe(false)
    })
    it("counts the strip as read only near its end and past the first 1000dp", () => {
        expect(isNearStripEnd(800, 900, 2000, true)).toBe(false)
        expect(isNearStripEnd(4000, 900, 6000, true)).toBe(true)
        expect(isNearStripEnd(2000, 900, 6000, true)).toBe(false)
        expect(isNearStripEnd(4000, 900, 6000, false)).toBe(false)
    })
    it("counts a short strip (three phone pages) once it is scrolled to its end, never at the top (4.3.1)", () => {
        // 3 pages of 554dp: 1662dp of strip, 750dp of screen, 912dp to scroll
        expect(isNearStripEnd(0, 750, 1662, true)).toBe(false)
        expect(isNearStripEnd(500, 750, 1662, true)).toBe(false)
        expect(isNearStripEnd(912, 750, 1662, true)).toBe(true)
        // a strip that fits the screen cannot be scrolled, so it is not counted by scrolling
        expect(isNearStripEnd(0, 900, 600, true)).toBe(false)
    })
    it("lets auto update save only the chapter whose own start was set, once (4.3.1)", () => {
        const read = { enabled: true, incognito: false, chapterId: "c6", chapterKey: "7:src:c6", startedFor: "7:src:c6", shouldUpdate: true, pagesReady: true, isLastPage: true, lastSavedChapterId: "c5" }
        expect(shouldAutoSaveProgress(read)).toBe(true)
        // the next chapter came from the cache while "last page" still is chapter 5's: not before its start state is set
        expect(shouldAutoSaveProgress({ ...read, startedFor: "7:src:c5" })).toBe(false)
        expect(shouldAutoSaveProgress({ ...read, lastSavedChapterId: "c6" })).toBe(false)
        expect(shouldAutoSaveProgress({ ...read, incognito: true })).toBe(false)
        expect(shouldAutoSaveProgress({ ...read, isLastPage: false })).toBe(false)
        expect(shouldAutoSaveProgress({ ...read, enabled: false })).toBe(false)
    })
})

describe("opening a chapter (4.3.1)", () => {
    it("starts at the saved page, not read, without the map of the chapter before", () => {
        expect(chapterStartState(9)).toEqual({ isLastPage: false, currentPageIndex: 9, currentMapIndex: 0, paginationMap: {} })
        // the reset map has no step 0, so the paged reader cannot move the page to 0 before its own map is built
        expect(pageOfStep(chapterStartState(9).paginationMap, 0)).toBeUndefined()
    })
    it("then finds the step that holds the saved page in single and double page mode", () => {
        const pages = Array.from({ length: 20 }, (_, index) => ({ index }))
        const single = buildPaginationMap(pages, null, "paged", 0)
        expect(pageOfStep(single, mapIndexForPage(single, 9))).toBe(9)
        const double = buildPaginationMap(pages, null, "double-page", 1)
        const step = mapIndexForPage(double, 9)
        expect(double[step]).toContain(9)
        expect(step).toBeGreaterThan(0)
    })
})

describe("long strip", () => {
    it("finds the page under the reading line", () => {
        expect(pageAtLine([1000, 1000, 1000], 16, 0, 120)).toBe(0)
        expect(pageAtLine([1000, 1000, 1000], 16, 950, 120)).toBe(1)
        expect(pageAtLine([1000, 1000, 1000], 16, 99999, 120)).toBe(2)
    })
    it("reopens on the saved page and does not save a guessed one (resume drift)", () => {
        // saved page 9: the pages are guessed 1000dp tall, the list lays them out at their real 800dp
        const guessed = Array.from({ length: 12 }, () => 1000)
        const layoutTop = (index: number) => index * 816
        const offset = layoutTop(9)
        // the old way read the list's offset against the guessed heights: page 7, and that was saved again
        expect(pageAtLine(guessed, 16, offset, 120)).toBe(7)
        const tops = stripPageTops(guessed, 16, layoutTop)
        // while the saved page is restored (no drag yet) the index is left alone
        expect(stripScrollPage({ restoring: true, tops, offset, line: 120 })).toBeNull()
        // from the reader's first drag on it follows the list's layout
        expect(stripScrollPage({ restoring: false, tops, offset, line: 120 })).toBe(9)
        expect(stripScrollPage({ restoring: false, tops, offset: layoutTop(11) - 121, line: 120 })).toBe(10)
    })
    it("fills in page tops the list has no layout for", () => {
        expect(stripPageTops([100, 200, 300], 10, index => index === 1 ? 500 : undefined)).toEqual([0, 500, 710])
        expect(stripScrollPage({ restoring: false, tops: [], offset: 0, line: 120 })).toBeNull()
    })
    it("sizes pages by fit", () => {
        const base = { stretch: "none", zoom: 1, overflowWidth: 50, width: 400, height: 800, ratio: 1.5, naturalWidth: 300 }
        expect(stripPageSize({ ...base, fit: "cover" })).toEqual({ width: 400, height: 600 })
        expect(stripPageSize({ ...base, fit: "contain" })).toEqual({ width: 400, height: 600 })
        expect(stripPageSize({ ...base, fit: "contain", height: 600 })).toEqual({ width: 360, height: 540 })
        expect(stripPageSize({ ...base, fit: "larger" })).toEqual({ width: 200, height: 300 })
        expect(stripPageSize({ ...base, fit: "true-size" })).toEqual({ width: 300, height: 450 })
        expect(stripPageSize({ ...base, fit: "cover", zoom: 1.5 })).toEqual({ width: 600, height: 900 })
    })
    it("reads Whole page in the tablet's 48rem column instead of fitting the height (tablet.css)", () => {
        // Pixel Tablet landscape: 1280 − 32 wide, 800 high; the phone rule would give (800 − 60) / 1.42 = 521
        const tablet = { stretch: "none", zoom: 1, overflowWidth: 50, width: 1248, height: 800, ratio: 1.42, naturalWidth: 0 }
        expect(stripPageSize({ ...tablet, fit: "contain" })).toEqual({ width: 521, height: 740 })
        expect(stripPageSize({ ...tablet, fit: "contain", tabletColumn: true })).toEqual({ width: 768, height: 1091 })
        expect(stripPageSize({ ...tablet, fit: "contain", stretch: "stretch", tabletColumn: true })).toEqual({ width: 768, height: 1091 })
        // portrait (800 − 32 wide): the column is the reader
        expect(stripPageSize({ ...tablet, width: 768, height: 1280, fit: "contain", tabletColumn: true })).toEqual({ width: 768, height: 1091 })
        // other fits are not touched
        expect(stripPageSize({ ...tablet, fit: "cover", tabletColumn: true })).toEqual({ width: 1248, height: 1772 })
    })
})

describe("single / double page", () => {
    it("fits a page into the reader, a pair into half each", () => {
        const base = { zoom: 1, overflowWidth: 50, width: 400, height: 600, ratio: 1.5, naturalWidth: 0 }
        expect(pagedPageSize({ ...base, fit: "contain", double: false })).toEqual({ width: 400, height: 600 })
        expect(pagedPageSize({ ...base, fit: "contain", double: true })).toEqual({ width: 200, height: 300 })
        expect(pagedPageSize({ ...base, fit: "cover", double: false })).toEqual({ width: 400, height: 600 })
        expect(pagedPageSize({ ...base, fit: "larger", double: false })).toEqual({ width: 200, height: 300 })
    })
})

describe("reset page layout", () => {
    it("goes back to the mode's fit and stretch at 100 % zoom", () => {
        expect(defaultPageLayout("long-strip")).toEqual({ pageFit: "cover", pageStretch: "none", pageZoom: 1 })
        expect(defaultPageLayout("paged")).toEqual({ pageFit: "contain", pageStretch: "none", pageZoom: 1 })
        expect(defaultPageLayout("double-page")).toEqual({ pageFit: "contain", pageStretch: "none", pageZoom: 1 })
    })

    it("offers the reset while only the zoom differs", () => {
        expect(isDefaultPageLayout("paged", { pageFit: "contain", pageStretch: "none", pageZoom: 1 })).toBe(true)
        expect(isDefaultPageLayout("paged", { pageFit: "contain", pageStretch: "none", pageZoom: 1.1 })).toBe(false)
        expect(isDefaultPageLayout("long-strip", { pageFit: "contain", pageStretch: "none", pageZoom: 1 })).toBe(false)
    })
})
