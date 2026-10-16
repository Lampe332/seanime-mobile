import { describe, expect, it, vi } from "vitest"
import type { AL_ListRecentAnime } from "@/api/generated/types"
import { fetchGlobalScheduleDay } from "./global-schedule"

const row = (id: number, mediaId = id, airingAt = new Date("2026-10-15T12:00:00Z").getTime() / 1000) => ({ id, airingAt, episode: 3, media: { id: mediaId, type: "ANIME", format: "TV", episodes: 12, title: { userPreferred: `Anime ${mediaId}` }, coverImage: { large: "cover.jpg" } } })
const page = (rows: ReturnType<typeof row>[], hasNextPage = false) => ({ Page: { airingSchedules: rows, pageInfo: { hasNextPage } } }) as unknown as AL_ListRecentAnime

describe("global calendar day", () => {
    it("loads every page, deduplicates rows, and uses each airing's episode and media ID", async () => {
        const fetch = vi.fn().mockResolvedValueOnce(page([row(1, 901)], true)).mockResolvedValueOnce(page([row(1, 901), row(2, 902)]))
        const result = await fetchGlobalScheduleDay("2026-10-15", fetch)
        expect(fetch).toHaveBeenCalledTimes(2)
        expect(fetch.mock.calls.map(call => call[0].page)).toEqual([1, 2])
        expect(fetch.mock.calls[0][0].notYetAired).toBe(false)
        expect(result.map(item => item.mediaId)).toEqual([901, 902])
        expect(result.every(item => item.episodeNumber === 3)).toBe(true)
    })
    it("drops adult media from the calendar", async () => {
        const adult = row(2, 902)
        ;(adult.media as { isAdult?: boolean }).isAdult = true
        const result = await fetchGlobalScheduleDay("2026-10-15", async () => page([row(1, 901), adult]))
        expect(result.map(item => item.mediaId)).toEqual([901])
    })
    it("requests the whole local day and keeps midnight but excludes the next day", async () => {
        const start = new Date(2026, 9, 15).getTime() / 1000
        const end = new Date(2026, 9, 16).getTime() / 1000
        const fetch = vi.fn().mockResolvedValue(page([row(1, 1, start), row(2, 2, end - 1), row(3, 3, end)]))
        expect(await fetchGlobalScheduleDay("2026-10-15", fetch)).toHaveLength(2)
        expect(fetch.mock.calls[0][0]).toMatchObject({ airingAt_greater: start - 1, airingAt_lesser: end })
    })
    it("does not return a partial list when a later page fails", async () => {
        const fetch = vi.fn().mockResolvedValueOnce(page([row(1)], true)).mockRejectedValueOnce(new Error("offline"))
        await expect(fetchGlobalScheduleDay("2026-10-15", fetch)).rejects.toThrow("offline")
    })
    it("rejects invalid responses and stalled pagination", async () => {
        await expect(fetchGlobalScheduleDay("2026-10-15", async () => undefined)).rejects.toThrow("gültigen")
        const fetch = vi.fn().mockResolvedValue(page([row(1)], true))
        await expect(fetchGlobalScheduleDay("2026-10-15", fetch)).rejects.toThrow("vollständig")
        expect(fetch).toHaveBeenCalledTimes(2)
    })
    it("stops fetching after the selected query is cancelled", async () => {
        const controller = new AbortController()
        const fetch = vi.fn(async () => { controller.abort(); return page([row(1)], true) })
        await expect(fetchGlobalScheduleDay("2026-10-15", fetch, controller.signal)).rejects.toThrow()
        expect(fetch).toHaveBeenCalledTimes(1)
    })
    it("supports a genuinely empty day and rejects invalid dates before a request", async () => {
        expect(await fetchGlobalScheduleDay("2026-10-15", async () => page([]))).toEqual([])
        const fetch = vi.fn()
        await expect(fetchGlobalScheduleDay("invalid", fetch)).rejects.toThrow("Ungültiges")
        expect(fetch).not.toHaveBeenCalled()
    })
})
