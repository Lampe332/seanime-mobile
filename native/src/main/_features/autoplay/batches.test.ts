import { describe, expect, it } from "vitest"
import { getBatchSelectionParams } from "./batches"

const files = {
    current: 2,
    currentEpisodeNumber: 3,
    currentAniDBEpisode: "3",
    files: [
        { index: 1, name: "a", path: "a", episodeNumber: 2 },
        { index: 2, name: "b", path: "b", episodeNumber: 3 },
        { index: 3, name: "c", path: "c", episodeNumber: 4 },
    ],
} as never

describe("getBatchSelectionParams", () => {
    it("keeps the same file for the same episode", () => {
        expect(getBatchSelectionParams(files, 3, "3").fileIndex).toBe(2)
    })
    it("moves as many episodes on as the episode number does", () => {
        const next = getBatchSelectionParams(files, 4, "4")
        expect(next.fileIndex).toBe(3)
        expect(next.batchEpisodeFiles).toMatchObject({ current: 3, currentEpisodeNumber: 4, currentAniDBEpisode: "4" })
    })
    it("gives no file when the batch does not hold the episode", () => {
        expect(getBatchSelectionParams(files, 9, "9").fileIndex).toBeUndefined()
        expect(getBatchSelectionParams(undefined, 1, "1")).toEqual({ fileIndex: undefined, batchEpisodeFiles: undefined })
    })
})
