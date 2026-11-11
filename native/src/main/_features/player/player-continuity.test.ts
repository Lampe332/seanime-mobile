import { describe, expect, it } from "vitest"
import { continuityStartReady } from "./player-continuity"

describe("continuityStartReady", () => {
    it("starts right away without continuity or without an anime (web shouldWaitForWatchHistory)", () => {
        expect(continuityStartReady({ enabled: false, refreshed: false, fetching: true })).toBe(true)
        expect(continuityStartReady({ enabled: false, refreshed: false, fetching: false })).toBe(true)
    })

    it("does not start from the cached answer of an earlier opening (online episode reopened after ×)", () => {
        expect(continuityStartReady({ enabled: true, refreshed: false, fetching: false })).toBe(false)
        expect(continuityStartReady({ enabled: true, refreshed: false, fetching: true })).toBe(false)
    })

    it("starts once the refetch asked for this playback has settled", () => {
        expect(continuityStartReady({ enabled: true, refreshed: true, fetching: false })).toBe(true)
    })

    it("waits for a newer refetch that replaced this playback's one", () => {
        expect(continuityStartReady({ enabled: true, refreshed: true, fetching: true })).toBe(false)
    })
})
