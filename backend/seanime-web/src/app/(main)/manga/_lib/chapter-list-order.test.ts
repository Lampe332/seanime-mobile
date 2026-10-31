import { describe, expect, it } from "vitest"
import { chapterLabelNumber, findChapterIndex, orderChapters, parseChapterQuery, visibleCountFor } from "./chapter-list-order"

const chapters = ["1", "2", "2.5", "3", "10"].map(chapter => ({ chapter }))

describe("orderChapters", () => {
    it("newest first reverses, oldest first keeps the provider order", () => {
        expect(orderChapters(chapters, "newest").map(c => c.chapter)).toEqual(["10", "3", "2.5", "2", "1"])
        expect(orderChapters(chapters, "oldest").map(c => c.chapter)).toEqual(["1", "2", "2.5", "3", "10"])
    })
    it("does not change the input", () => {
        const input = [1, 2, 3]
        orderChapters(input, "newest")
        orderChapters(input, "oldest").push(4)
        expect(input).toEqual([1, 2, 3])
    })
})

describe("parseChapterQuery", () => {
    it("reads plain, decimal and prefixed numbers", () => {
        expect(parseChapterQuery("12")).toBe(12)
        expect(parseChapterQuery(" 12,5 ")).toBe(12.5)
        expect(parseChapterQuery("Ch. 7")).toBe(7)
    })
    it("returns null without a number", () => {
        expect(parseChapterQuery("")).toBeNull()
        expect(parseChapterQuery("abc")).toBeNull()
    })
    it("labels of chapters parse the same way", () => {
        expect(chapterLabelNumber("2.5")).toBe(2.5)
        expect(chapterLabelNumber("Extra")).toBeNull()
    })
})

describe("findChapterIndex", () => {
    it("finds the exact number in either order", () => {
        expect(findChapterIndex(orderChapters(chapters, "oldest"), 3)).toBe(3)
        expect(findChapterIndex(orderChapters(chapters, "newest"), 3)).toBe(1)
        expect(findChapterIndex(chapters, 2.5)).toBe(2)
    })
    it("returns -1 for a missing chapter", () => {
        expect(findChapterIndex(chapters, 4)).toBe(-1)
    })
})

describe("visibleCountFor", () => {
    it("grows to the page that holds the row", () => {
        expect(visibleCountFor(5, 30, 30)).toBe(30)
        expect(visibleCountFor(30, 30, 30)).toBe(60)
        expect(visibleCountFor(95, 30, 30)).toBe(120)
    })
    it("never shrinks and ignores a missing row", () => {
        expect(visibleCountFor(2, 30, 90)).toBe(90)
        expect(visibleCountFor(-1, 30, 60)).toBe(60)
    })
})
