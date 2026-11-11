import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
    getRefreshKey,
    markSourceRefreshed,
    orderProviders,
    PLAYBACK_TIMEOUT_MS,
    playbackTimedOut,
    PROVIDER_TIMEOUT_MS,
    shouldRecoverStartup,
    withProviderTimeout,
} from "./onlinestream-provider-trial"

describe("online stream provider trial", () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it("gives providers 15 s to answer and a stream 20 s to start, one after the other", () => {
        expect(PROVIDER_TIMEOUT_MS).toBe(15_000)
        expect(PLAYBACK_TIMEOUT_MS).toBe(20_000)
        // the playback limit starts once the provider answered and the URL reached the player, so it never cuts the 15 s
        // short; one candidate (list + source + refresh + stream, twice for the refreshed source) has a fixed worst case
        expect(PROVIDER_TIMEOUT_MS * 3 + PLAYBACK_TIMEOUT_MS * 2).toBe(85_000)
    })

    it("lets a stream that loaded but has not started keep its provider, also while trying all providers", () => {
        expect(playbackTimedOut({ startedAt: 0, playbackTime: 0, streamReady: false })).toBe(true)
        // loaded and held paused (or the viewer paused it): not a broken provider
        expect(playbackTimedOut({ startedAt: 0, playbackTime: 0, streamReady: true })).toBe(false)
        // the position moved on
        expect(playbackTimedOut({ startedAt: 0, playbackTime: 0.6, streamReady: false })).toBe(false)
    })

    it("ends a source refresh that never answers after the provider limit", async () => {
        const never = new Promise<string>(() => {})
        const result = withProviderTimeout(never).then(() => "answered", (error: Error) => error.message)
        await vi.advanceTimersByTimeAsync(PROVIDER_TIMEOUT_MS - 1)
        let settled = false
        void result.then(() => (settled = true))
        await Promise.resolve()
        expect(settled).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        await expect(result).resolves.toBe("provider timeout")
    })

    it("passes a refresh that answers in time through, with its value or its error", async () => {
        const answer = new Promise<string>(resolve => setTimeout(() => resolve("source"), 3_000))
        const ok = withProviderTimeout(answer)
        await vi.advanceTimersByTimeAsync(3_000)
        await expect(ok).resolves.toBe("source")

        const failing = withProviderTimeout(Promise.reject(new Error("404")))
        await expect(failing).rejects.toThrow("404")
        // no timer left behind
        expect(vi.getTimerCount()).toBe(0)
    })

    it("refreshes each provider/server/episode once and starts with the current provider", () => {
        const refreshed = new Set<string>()
        const key = getRefreshKey("a", "vidstream", 3)
        expect(key).toBe("a:vidstream:3")
        expect(markSourceRefreshed(refreshed, key)).toBe(true)
        expect(markSourceRefreshed(refreshed, key)).toBe(false)
        expect(orderProviders([{ id: "a" }, { id: "b" }, { id: "c" }], "b")).toEqual(["b", "a", "c"])
        expect(orderProviders([{ id: "a" }], "gone")).toEqual(["a"])
        expect(shouldRecoverStartup(0.9)).toBe(true)
        expect(shouldRecoverStartup(1)).toBe(false)
    })
})
