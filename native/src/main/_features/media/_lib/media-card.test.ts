import type { AL_BaseAnime, AL_BaseManga } from "@/api/generated/types"
import { describe, expect, it } from "vitest"
import { CARD_SIZE_FACTORS, fitRowWidth, gridLayout, rowCardWidth } from "@/components/shared/cover-layout"
import { CARD_PILL, cardPillFit, cardPillWidth, cardScoreWidth, cardProgressBar, cardProgressLabel, cardSeasonLine, cardUnwatchedCount, mediaEntryHref, userScoreColor } from "./media-card"

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

    // the narrowest card: a 360dp phone's grid at the small card size; the widest common one: Home's row at large
    const smallest = gridLayout(360 - 32, false, 1, CARD_SIZE_FACTORS.small).width
    const room = (width: number) => width - 2 * CARD_PILL.inset
    const shown = (fit: ReturnType<typeof cardPillFit>, top: string | null, fontScale = 1) => cardPillWidth(fit.top ? top : null, fit.label, fontScale, fit.pad, fit.gap)

    it("fits on one line inside the smallest card, every digit kept", () => {
        for (const fontScale of [1, 1.15, 1.3])
            for (const [top, label] of [["139", "31/170"], ["12", "1234/1500"], [null, "7/-"], ["3", null], ["139", "999"]] as const) {
                const fit = cardPillFit(smallest, top, label, fontScale)
                expect(shown(fit, top, fontScale)).toBeLessThanOrEqual(room(smallest))
                expect(fit.label === null || label?.startsWith(fit.label)).toBe(true)
                expect(fit.top || fit.label).toBeTruthy()
            }
    })

    it("keeps the whole pill where it fits and gives up the count before the progress", () => {
        expect(cardPillFit(rowCardWidth(411), "139", "31/170")).toEqual({ top: true, label: "31/170", pad: 7, gap: 6 })
        expect(cardPillFit(fitRowWidth(rowCardWidth(411, CARD_SIZE_FACTORS.small), 411), "139", "31/170")).toMatchObject({ label: "31/170" })
        expect(cardPillFit(110, "139", "31/170")).toMatchObject({ top: true, label: "31/170", pad: 5 })
        expect(cardPillFit(smallest, "139", "31/170")).toMatchObject({ top: false, label: "31/170" })
        expect(cardPillFit(smallest, "12", "1234/1500")).toMatchObject({ top: false, label: "1234" })
    })

    it("keeps a visible gap to the score badge and never runs under it", () => {
        const small = fitRowWidth(rowCardWidth(411, CARD_SIZE_FACTORS.small), 411)
        expect(cardScoreWidth(90)).toBe(56)
        expect(cardScoreWidth(100)).toBe(56)
        expect(cardScoreWidth(95, 1.3)).toBeGreaterThan(56)
        // the device finding: a 105dp card, "▶ 4 | 3" beside "★ 9"; before, the badge sat on the "3"
        const ends = (fit: ReturnType<typeof cardPillFit>, top: string | null, fontScale = 1) => CARD_PILL.inset + shown(fit, top, fontScale)
        for (const width of [105, small, smallest, rowCardWidth(411)])
            for (const fontScale of [1, 1.3])
                for (const score of [90, 95, 100])
                    for (const [top, label] of [["4", "3"], ["139", "31/170"], ["12", "1234/1500"], [null, "7/-"]] as const) {
                        const badge = cardScoreWidth(score, fontScale)
                        const fit = cardPillFit(width, top, label, fontScale, badge)
                        if (fit.top || fit.label) expect(ends(fit, top, fontScale)).toBeLessThanOrEqual(width - badge - 4)
                        expect(fit.label === null || label?.startsWith(fit.label)).toBe(true)
                    }
        expect(cardPillFit(105, "4", "3", 1, cardScoreWidth(90))).toMatchObject({ top: false, label: "3" })
        // without a badge nothing changes
        expect(cardPillFit(105, "4", "3")).toEqual(cardPillFit(105, "4", "3", 1, 0))
        expect(cardPillFit(rowCardWidth(411), "139", "31/170", 1, cardScoreWidth(90))).toMatchObject({ label: "31/170" })
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
    it("names the season in the app language", () => {
        const en = (en: string) => en
        const de = (_: string, de: string) => de
        expect(cardSeasonLine(en, anime({ season: "FALL", seasonYear: 2023 }))).toBe("Fall 2023")
        expect(cardSeasonLine(de, anime({ season: "FALL", seasonYear: 2023 }))).toBe("Herbst 2023")
        expect(cardSeasonLine(en, manga({ startDate: { year: 2020 } } as never))).toBe("2020")
    })
    it("puts a related title's format before its year, but not TV or manga", () => {
        const en = (en: string) => en
        const de = (_: string, de: string) => de
        expect(cardSeasonLine(en, anime({ format: "MOVIE", season: "FALL", seasonYear: 2021 }), true)).toBe("Movie · Fall 2021")
        expect(cardSeasonLine(de, manga({ format: "NOVEL", startDate: { year: 2005 } } as never), true)).toBe("Roman · 2005")
        expect(cardSeasonLine(en, anime({ format: "MUSIC", seasonYear: 2019 }), true)).toBe("Music · 2019")
        expect(cardSeasonLine(en, anime({ format: "TV", season: "FALL", seasonYear: 2021 }), true)).toBe("Fall 2021")
        expect(cardSeasonLine(en, manga({ format: "MANGA", startDate: { year: 2020 } } as never), true)).toBe("2020")
        expect(cardSeasonLine(en, anime({ format: "MOVIE", season: "FALL", seasonYear: 2021 }))).toBe("Fall 2021")
    })
    it("steps through the user score colours", () => {
        expect(userScoreColor(30)).toContain("220, 38, 38")
        expect(userScoreColor(90)).toContain("79, 70, 229")
    })
})
