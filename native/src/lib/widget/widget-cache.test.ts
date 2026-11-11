import { describe, expect, it } from "vitest"
import { countdown, createWidgetCache, FetchedEntry, KeyValue, stampText } from "./widget-cache"

function memory(): KeyValue {
    const values = new Map<string, string | number | boolean>()
    return {
        getString: key => typeof values.get(key) === "string" ? values.get(key) as string : undefined,
        getNumber: key => typeof values.get(key) === "number" ? values.get(key) as number : undefined,
        getBoolean: key => typeof values.get(key) === "boolean" ? values.get(key) as boolean : undefined,
        set: (key, value) => void values.set(key, value),
        remove: key => void values.delete(key),
        contains: key => values.has(key),
    }
}

const entry = (mediaId: number, timeUntil: number): FetchedEntry => ({ title: `Anime ${mediaId}`, episode: 3, timeUntil, mediaId, coverUrl: "" })

describe("widget cache", () => {
    it("keeps the countdown right from the stored airing time, without a fetch", () => {
        let now = 1_800_000_000_000
        const cache = createWidgetCache(memory(), () => now)
        cache.save([entry(1, 7200), entry(2, 600)])
        expect(cache.entries().map(it => it.mediaId)).toEqual([2, 1])
        now += 300_000
        expect(cache.entries()[0].airingAt - now / 1000).toBe(300)
    })

    it("drops aired episodes and is outdated once the first one aired", () => {
        let now = 1_800_000_000_000
        const cache = createWidgetCache(memory(), () => now)
        cache.save([entry(1, 7200), entry(2, 600)])
        expect(cache.hasValidCache()).toBe(true)
        now += 601_000
        expect(cache.entries().map(it => it.mediaId)).toEqual([1])
        expect(cache.hasValidCache()).toBe(false)
    })

    it("is fresh for three hours at most", () => {
        let now = 1_800_000_000_000
        const cache = createWidgetCache(memory(), () => now)
        cache.save([entry(1, 86_400)])
        now += 3 * 3600_000 - 1
        expect(cache.hasValidCache()).toBe(true)
        now += 2
        expect(cache.hasValidCache()).toBe(false)
        // still shown until a fetch succeeds
        expect(cache.entries()).toHaveLength(1)
    })

    it("pauses fetching for 15 minutes after an error, until the refresh button", () => {
        let now = 1_800_000_000_000
        const cache = createWidgetCache(memory(), () => now)
        cache.setLoading(true)
        cache.setError("No connection")
        expect(cache.isLoading()).toBe(false)
        expect(cache.recentError()).toBe(true)
        now += 15 * 60_000
        expect(cache.recentError()).toBe(false)
        cache.clearError()
        expect(cache.error()).toBeNull()
    })

    it("an empty fetch is a valid empty list", () => {
        const cache = createWidgetCache(memory(), () => 1_800_000_000_000)
        cache.save([])
        expect(cache.hasValidCache()).toBe(true)
        expect(cache.entries()).toEqual([])
        expect(cache.savedAt()).toBe(1_800_000_000_000)
    })
})

describe("widget texts", () => {
    it("counts down in days and hours, then hours and minutes", () => {
        expect(countdown(2 * 86400 + 5 * 3600 + 59)).toBe("2d 5h")
        expect(countdown(5 * 3600 + 12 * 60 + 30)).toBe("5h 12m")
        expect(countdown(59)).toBe("0h 0m")
    })
    it("stamps today with the time only, other days with the date", () => {
        const now = new Date(2026, 10, 5, 18, 0).getTime()
        expect(stampText(new Date(2026, 10, 5, 9, 7).getTime(), now, true)).toBe("09:07")
        expect(stampText(new Date(2026, 10, 4, 9, 7).getTime(), now, true)).toBe("04.11., 09:07")
        expect(stampText(new Date(2026, 10, 4, 9, 7).getTime(), now, false)).toBe("Nov 4, 09:07")
    })
})
