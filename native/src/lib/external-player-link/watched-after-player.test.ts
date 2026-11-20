import { beforeEach, describe, expect, it } from "vitest"
import { SHORTEST_WATCH_MS, forgetTrip, openWithWatchedAsk, shouldAskWatched, tripOnAppState } from "./watched-after-player"

const base = { episodeNumber: 5, progress: 4, awayMs: 20 * 60_000, autoProgress: true, incognito: false }

describe("shouldAskWatched", () => {
    it("asks for the next episode after a real stay in the other app", () => {
        expect(shouldAskWatched(base)).toBe(true)
        expect(shouldAskWatched({ ...base, progress: 0, episodeNumber: 1 })).toBe(true)
        // a later episode than the next one is still the user's to mark
        expect(shouldAskWatched({ ...base, episodeNumber: 9 })).toBe(true)
    })

    it("does not ask for an episode that is already watched", () => {
        expect(shouldAskWatched({ ...base, progress: 5 })).toBe(false)
        expect(shouldAskWatched({ ...base, progress: 12 })).toBe(false)
    })

    it("follows \"Update progress automatically\" and incognito mode", () => {
        expect(shouldAskWatched({ ...base, autoProgress: false })).toBe(false)
        expect(shouldAskWatched({ ...base, incognito: true })).toBe(false)
    })

    it("does not ask after a short trip or without an episode number", () => {
        expect(shouldAskWatched({ ...base, awayMs: SHORTEST_WATCH_MS - 1 })).toBe(false)
        expect(shouldAskWatched({ ...base, awayMs: SHORTEST_WATCH_MS })).toBe(true)
        expect(shouldAskWatched({ ...base, episodeNumber: 0, progress: 0 })).toBe(false)
        expect(shouldAskWatched({ ...base, episodeNumber: 5.5 })).toBe(false)
    })
})

describe("the trip to the other player", () => {
    beforeEach(() => forgetTrip())

    it("starts in the background and ends at the front, once", async () => {
        expect(await openWithWatchedAsk({ mediaId: 21, episodeNumber: 5 }, async () => true)).toBe(true)
        expect(tripOnAppState("active", 1_000)).toBeNull()
        expect(tripOnAppState("background", 2_000)).toBeNull()
        expect(tripOnAppState("inactive", 3_000)).toBeNull()
        expect(tripOnAppState("background", 4_000)).toBeNull()
        expect(tripOnAppState("active", 602_000)).toEqual({ mediaId: 21, episodeNumber: 5, awayMs: 600_000 })
        expect(tripOnAppState("background", 700_000)).toBeNull()
        expect(tripOnAppState("active", 800_000)).toBeNull()
    })

    it("is noted before the player opens: an intent only resolves when the user is back", async () => {
        let finished: unknown = null
        await openWithWatchedAsk({ mediaId: 21, episodeNumber: 5 }, async () => {
            tripOnAppState("background", 0)
            finished = tripOnAppState("active", 300_000)
            return true
        })
        expect(finished).toEqual({ mediaId: 21, episodeNumber: 5, awayMs: 300_000 })
    })

    it("leaves nothing to ask when the player did not open, or for an episode without a number", async () => {
        expect(await openWithWatchedAsk({ mediaId: 21, episodeNumber: 5 }, async () => false)).toBe(false)
        tripOnAppState("background", 0)
        expect(tripOnAppState("active", 900_000)).toBeNull()

        await openWithWatchedAsk({ mediaId: 21, episodeNumber: 0 }, async () => true)
        tripOnAppState("background", 0)
        expect(tripOnAppState("active", 900_000)).toBeNull()

        await openWithWatchedAsk(null, async () => true)
        tripOnAppState("background", 0)
        expect(tripOnAppState("active", 900_000)).toBeNull()
    })

    it("asks for the episode opened last", async () => {
        await openWithWatchedAsk({ mediaId: 21, episodeNumber: 5 }, async () => true)
        await openWithWatchedAsk({ mediaId: 21, episodeNumber: 6 }, async () => true)
        tripOnAppState("background", 0)
        expect(tripOnAppState("active", 900_000)).toMatchObject({ episodeNumber: 6 })
    })
})
