import { describe, expect, it } from "vitest"
import {
    buildPaginationMap,
    getAdjacentChapter,
    isNearStripEnd,
    mapIndexForPage,
    pageAtLine,
    pagedPageSize,
    readerTapZone,
    secondPageLabel,
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
})

describe("pagination map", () => {
    const pages = [0, 1, 2, 3, 4].map(index => ({ index }))
    it("shows one page per step in single page and long strip mode", () => {
        expect(buildPaginationMap(pages, { 0: { width: 800, height: 1200 } }, "paged", 0)).toEqual({ 0: [0], 1: [1], 2: [2], 3: [3], 4: [4] })
        expect(buildPaginationMap(pages, undefined, "double-page", 0)).toEqual({ 0: [0], 1: [1], 2: [2], 3: [3], 4: [4] })
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
})

describe("long strip", () => {
    it("finds the page under the reading line", () => {
        expect(pageAtLine([1000, 1000, 1000], 16, 0, 120)).toBe(0)
        expect(pageAtLine([1000, 1000, 1000], 16, 950, 120)).toBe(1)
        expect(pageAtLine([1000, 1000, 1000], 16, 99999, 120)).toBe(2)
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
