import { describe, expect, it } from "vitest"
import { getEpisodeMinutesRemaining, getEpisodePercentageComplete } from "./continuity.hooks"

const history = (currentTime: number, episodeNumber = 3) => ({ 7: { mediaId: 7, episodeNumber, currentTime, duration: 1200 } }) as any

describe("continuity progress", () => {
    it("shows the progress of a started, unfinished episode", () => {
        expect(getEpisodePercentageComplete(history(600), 7, 3)).toBe(50)
        expect(getEpisodeMinutesRemaining(history(600), 7, 3)).toBe(10)
    })

    it("ignores barely started, finished and other episodes", () => {
        expect(getEpisodePercentageComplete(history(30), 7, 3)).toBe(0)
        expect(getEpisodePercentageComplete(history(1100), 7, 3)).toBe(0)
        expect(getEpisodeMinutesRemaining(history(600, 4), 7, 3)).toBe(0)
        expect(getEpisodePercentageComplete(undefined, 7, 3)).toBe(0)
    })
})
