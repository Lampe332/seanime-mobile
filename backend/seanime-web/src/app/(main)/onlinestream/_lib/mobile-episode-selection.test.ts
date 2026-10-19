import { describe, it, expect } from "vitest"
import { getMobileInitialEpisode, rememberMobileEpisode } from "./mobile-episode-selection"

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
