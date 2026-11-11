import type { AL_BaseAnime, AL_BaseManga } from "@/api/generated/types"
import { describe, expect, it } from "vitest"
import { cardProgressBar, cardProgressLabel, cardSeasonLine, cardUnwatchedCount, mediaEntryHref, userScoreColor } from "./media-card"

describe("card link", () => {
    it("opens the anime page or the manga page at the web paths", () => {
        expect(mediaEntryHref("anime", 21)).toBe("/entry?id=21")
        expect(mediaEntryHref("manga", 30013)).toBe("/manga/entry?id=30013")
    })
})

const anime = (extra: Partial<AL_BaseAnime> = {}) => ({ id: 1, episodes: 12, ...extra }) as AL_BaseAnime
const manga = (extra: Partial<AL_BaseManga> = {}) => ({ id: 2, chapters: 40, ...extra }) as AL_BaseManga

describe("progress line", () => {
    it("shows for watched anime with a known episode count, in the accent while current", () => {
        expect(cardProgressBar("anime", anime(), { progress: 6, status: "CURRENT" })).toEqual({ percent: 50, current: true })
        expect(cardProgressBar("anime", anime(), { progress: 5, status: "PAUSED" })).toEqual({ percent: 42, current: false })
    })
    it("hides without progress, without a total or when completed", () => {
        expect(cardProgressBar("anime", anime(), { progress: 0, status: "CURRENT" })).toBeNull()
        expect(cardProgressBar("anime", anime({ episodes: undefined }), { progress: 3, status: "CURRENT" })).toBeNull()
        expect(cardProgressBar("anime", anime(), { progress: 12, status: "COMPLETED" })).toBeNull()
        expect(cardProgressBar("manga", manga(), { progress: 40, status: "COMPLETED" })).toBeNull()
        expect(cardProgressBar("manga", manga({ chapters: undefined }), { progress: 7, status: "CURRENT" })).toBeNull()
    })
})

describe("progress pill", () => {
    it("reads progress/total, manga with a dash for an unknown total", () => {
        expect(cardProgressLabel("anime", 6, 12)).toBe("6/12")
        expect(cardProgressLabel("manga", 7, undefined)).toBe("7/-")
        expect(cardProgressLabel("anime", 3, undefined)).toBe("3")
        expect(cardProgressLabel("anime", 0, 12)).toBeNull()
    })
})

describe("unwatched count", () => {
    it("counts aired episodes past the progress", () => {
        expect(cardUnwatchedCount(anime({ nextAiringEpisode: { episode: 8 } as AL_BaseAnime["nextAiringEpisode"] }), 5)).toBe(2)
        expect(cardUnwatchedCount(anime(), 12)).toBe(0)
    })
    it("takes the library's count when the series has local files", () => {
        expect(cardUnwatchedCount(anime(), 2, { unwatchedCount: 3, mainFileCount: 4 } as never)).toBe(3)
    })
})

describe("season line and score colour", () => {
    it("capitalises the season", () => {
        expect(cardSeasonLine(anime({ season: "FALL", seasonYear: 2023 }))).toBe("Fall 2023")
        expect(cardSeasonLine(manga({ startDate: { year: 2020 } } as never))).toBe("2020")
    })
    it("steps through the user score colours", () => {
        expect(userScoreColor(30)).toContain("220, 38, 38")
        expect(userScoreColor(90)).toContain("79, 70, 229")
    })
})
