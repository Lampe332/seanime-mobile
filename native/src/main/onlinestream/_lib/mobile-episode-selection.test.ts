import { describe, it, expect } from "vitest"
import { getMobileInitialEpisode, neighbourEpisode, rememberMobileEpisode } from "./mobile-episode-selection"

describe("previous/next with gaps in the numbering", () => {
    it("steps to the nearest episode the provider has", () => {
        const numbers = [1, 2, 4, 5, 7]
        expect(neighbourEpisode(numbers, 2, "next")).toBe(4)
        expect(neighbourEpisode(numbers, 4, "previous")).toBe(2)
        expect(neighbourEpisode(numbers, 5, "next")).toBe(7)
        // unsorted lists and a current number the list lacks
        expect(neighbourEpisode([7, 1, 4], 3, "next")).toBe(4)
        expect(neighbourEpisode([7, 1, 4], 3, "previous")).toBe(1)
    })
    it("is null at the ends and without a current episode", () => {
        expect(neighbourEpisode([1, 2, 4], 4, "next")).toBeNull()
        expect(neighbourEpisode([1, 2, 4], 1, "previous")).toBeNull()
        expect(neighbourEpisode([1, 2, 4], null, "next")).toBeNull()
        expect(neighbourEpisode([], 1, "next")).toBeNull()
    })
})

describe("Mobile series continuation", () => {
    it("uses list progress and available episodes", () => {
        expect(getMobileInitialEpisode(1, [1, 2, 3], 1)).toBe(2)
        expect(getMobileInitialEpisode(1, [4, 7], 10)).toBe(4)
        expect(getMobileInitialEpisode(1, [], 0)).toBeUndefined()
    })
    it("restores selection per series and prioritizes an explicit Home episode", () => {
        rememberMobileEpisode(2, 7)
        expect(getMobileInitialEpisode(2, [1, 7, 11], 0)).toBe(7)
        expect(getMobileInitialEpisode(2, [1, 7, 11], 0, 11)).toBe(11)
        expect(getMobileInitialEpisode(3, [1, 7, 11], 0)).toBe(1)
    })
    it("discards stale selection when availability changes", () => {
        rememberMobileEpisode(4, 99)
        expect(getMobileInitialEpisode(4, [1, 2], 1, 88)).toBe(2)
    })
})
