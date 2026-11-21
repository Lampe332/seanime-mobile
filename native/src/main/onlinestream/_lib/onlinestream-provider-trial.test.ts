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
    cyclerFailureText,
    noProvidersText,
    noWorkingProviderText,
    trialServerStep,
} from "./onlinestream-provider-trial"

describe("the trial's server step", () => {
    it("keeps the stream of the server already chosen: the page builds a URL only when its key changes", () => {
        // Dreamland 2026 / Anikoto (S22, 21.11.): the URL was built and cleared in the same commit, so both tries
        // of a working provider ended in "playback timeout"
        expect(trialServerStep(["Auto", "Backup"], 0, "Auto")).toEqual({ kind: "keep" })
    })
    it("selects another server and runs out after the last one", () => {
        expect(trialServerStep(["Auto", "Backup"], 1, "Auto")).toEqual({ kind: "select", server: "Backup" })
        expect(trialServerStep(["Auto"], 0, undefined)).toEqual({ kind: "select", server: "Auto" })
        expect(trialServerStep(["Auto"], 1, "Auto")).toEqual({ kind: "exhausted" })
    })
})

describe("the cycler's texts", () => {
    const de = (_en: string, german: string) => german
    const en = (english: string) => english
    it("never shows an internal reason: each becomes plain words with what to do", () => {
        for (const reason of ["playback timeout", "episode source timeout", "episode source error", "no video sources", "loading failed", "The stream stopped early."]) {
            const shown = cyclerFailureText(reason, en)
            expect(shown).not.toBe(reason)
            expect(shown).toMatch(/Try another server or provider\.$/)
        }
        expect(cyclerFailureText("playback timeout", en)).toBe("The stream did not start in time. Try another server or provider.")
        expect(cyclerFailureText("no video sources", en)).toBe("The provider has no video for this episode. Try another server or provider.")
        expect(cyclerFailureText("episode source error", de)).toBe("Der Provider konnte diese Folge nicht laden. Probiere einen anderen Server oder Provider.")
    })
    it("translates the trial's end and the empty provider list", () => {
        expect(noWorkingProviderText(de)).toBe("Kein funktionierender Anbieter gefunden")
        expect(noProvidersText(true, en)).toBe("No dubbed providers available")
        expect(noProvidersText(false, de)).toBe("Keine Provider verfügbar")
    })
})

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
