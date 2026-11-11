import { describe, expect, it } from "vitest"
import { chunkRange, holdRange, rowEstimate } from "./chunk-window"

describe("chunkRange", () => {
    const heights = [100, 100, 100, 100, 100]
    it("draws the chunks reaching into the window", () => {
        expect(chunkRange(heights, 0, 150)).toEqual([0, 1])
        expect(chunkRange(heights, 150, 320)).toEqual([1, 3])
        expect(chunkRange(heights, -500, 10)).toEqual([0, 0])
        expect(chunkRange(heights, 450, 5000)).toEqual([4, 4])
    })
    it("keeps the nearest chunk when the list is off screen", () => {
        expect(chunkRange(heights, -900, -100)).toEqual([0, 0])
        expect(chunkRange(heights, 900, 1900)).toEqual([4, 4])
    })
    it("has nothing to draw without rows", () => {
        expect(chunkRange([], 0, 100)).toEqual([0, -1])
    })
    it("follows uneven chunk heights", () => {
        expect(chunkRange([50, 400, 50], 460, 470)).toEqual([2, 2])
        expect(chunkRange([50, 400, 50], 60, 70)).toEqual([1, 1])
    })
})

describe("holdRange", () => {
    it("grows to what is wanted", () => {
        expect(holdRange([0, 2], [0, 4], [0, 9])).toEqual([0, 4])
        expect(holdRange([5, 8], [3, 6], [0, 12])).toEqual([3, 8])
    })
    it("keeps drawn chunks while they stay within the far window", () => {
        // scrolled down and back up: chunks 0..7 stay, nothing is built again
        expect(holdRange([0, 7], [2, 5], [0, 9])).toEqual([0, 7])
        expect(holdRange([0, 7], [0, 3], [0, 9])).toEqual([0, 7])
    })
    it("drops only the chunks past the far window", () => {
        expect(holdRange([0, 7], [6, 9], [3, 12])).toEqual([3, 9])
        expect(holdRange([10, 20], [4, 7], [1, 10])).toEqual([4, 10])
    })
    it("jumps when the old chunks are far away", () => {
        expect(holdRange([0, 3], [20, 23], [17, 26])).toEqual([17, 23])
    })
    it("follows what is wanted when there was nothing or is nothing", () => {
        expect(holdRange([0, -1], [2, 4], [0, 8])).toEqual([2, 4])
        expect(holdRange([0, 5], [0, -1], [0, -1])).toEqual([0, -1])
    })
})

describe("rowEstimate", () => {
    it("averages the rows drawn so far", () => {
        expect(rowEstimate([{ height: 790, rows: 10 }, { height: 410, rows: 5 }], 80)).toBe(80)
        expect(rowEstimate([{ height: 1000, rows: 10 }], 80)).toBe(100)
    })
    it("uses the fallback before any row was drawn", () => {
        expect(rowEstimate([], 79)).toBe(79)
    })
})
