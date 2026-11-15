// geschrieben nach: history.ts; erfundene Werte

import { describe, expect, it } from "vitest"
import { animeHistory, entryLine, groupByDay, historyEntries, mangaHistory, withoutManga } from "./history"

const at = (day: number, hour: number) => new Date(2026, 10, day, hour, 0).getTime()
const NOW = at(15, 20)

const anime = animeHistory({
    1: { kind: "onlinestream", filepath: "", mediaId: 1, episodeNumber: 3, currentTime: 600, duration: 1440, timeAdded: new Date(at(10, 9)).toISOString(), timeUpdated: new Date(at(15, 19)).toISOString() },
    2: { kind: "mediastream", filepath: "", mediaId: 2, episodeNumber: 12, currentTime: 1400, duration: 1440, timeAdded: "", timeUpdated: new Date(at(13, 9)).toISOString() },
    3: { kind: "mediastream", filepath: "", mediaId: 3, episodeNumber: 1, currentTime: 0, duration: 0, timeAdded: "", timeUpdated: "not a time" },
} as never)
const locations = {
    10: { chapterId: "c", provider: "p", pageIndex: 4, updatedAt: at(14, 22), chapterNumber: "12" },
    11: { chapterId: "d", provider: "p", pageIndex: 0, updatedAt: at(15, 8) },
}
const manga = mangaHistory(locations)

describe("history", () => {
    it("takes the watch history and the reader's pages, newest first, without broken rows", () => {
        expect(historyEntries(anime, manga).map(entry => `${entry.kind} ${entry.mediaId}`)).toEqual(["anime 1", "manga 11", "manga 10", "anime 2"])
    })

    it("groups in days: Today, Yesterday, then a date", () => {
        const days = groupByDay(historyEntries(anime, manga), NOW, "en")
        expect(days.map(day => [day.label, day.entries.length])).toEqual([["Today", 2], ["Yesterday", 1], [new Date(at(13, 9)).toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" }), 1]])
        expect(groupByDay(historyEntries(anime, manga), NOW, "de").slice(0, 2).map(day => day.label)).toEqual(["Heute", "Gestern"])
    })

    it("says episode, time left, chapter and page", () => {
        expect(entryLine(anime[0], "en")).toBe("Episode 3 · 14 min left")
        expect(entryLine(anime[1], "de")).toBe("Folge 12")
        expect(entryLine(manga[0], "en")).toBe("Chapter 12 · page 5")
        expect(entryLine(manga[1], "de")).toBe("Seite 1")
    })

    it("removes one manga's page only", () => {
        expect(Object.keys(withoutManga(locations, 10))).toEqual(["11"])
    })
})
