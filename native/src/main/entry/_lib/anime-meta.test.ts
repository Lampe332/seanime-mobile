import { describe, expect, it } from "vitest"
import { airingPeriod, rankingBadges, rankingLabel, seasonOfMonth } from "./anime-meta"

const en = (e: string, _d: string) => e
const de = (_e: string, d: string) => d

describe("seasonOfMonth", () => {
    it("maps quarters", () => {
        expect([1, 3, 4, 6, 7, 9, 10, 12].map(seasonOfMonth)).toEqual(["WINTER", "WINTER", "SPRING", "SPRING", "SUMMER", "SUMMER", "FALL", "FALL"])
    })
    it("rejects missing or invalid months", () => {
        expect(seasonOfMonth(undefined)).toBeNull()
        expect(seasonOfMonth(0)).toBeNull()
        expect(seasonOfMonth(13)).toBeNull()
    })
})

describe("airingPeriod", () => {
    it("one season", () => {
        const media = { status: "FINISHED", startDate: { year: 2024, month: 1 }, endDate: { year: 2024, month: 3 } }
        expect(airingPeriod(en, media)).toBe("Winter 2024")
        expect(airingPeriod(de, media)).toBe("Winter 2024")
    })
    it("several seasons within one year names the year once", () => {
        const media = { status: "FINISHED", startDate: { year: 2024, month: 4 }, endDate: { year: 2024, month: 12 } }
        expect(airingPeriod(en, media)).toBe("Spring – Fall 2024")
        expect(airingPeriod(de, media)).toBe("Frühling – Herbst 2024")
    })
    it("over years shows both seasons and years", () => {
        const media = { status: "FINISHED", startDate: { year: 2017, month: 10 }, endDate: { year: 2020, month: 6 } }
        expect(airingPeriod(en, media)).toBe("Fall 2017 – Spring 2020")
    })
    it("year change December to January", () => {
        const media = { status: "FINISHED", startDate: { year: 2023, month: 12 }, endDate: { year: 2024, month: 1 } }
        expect(airingPeriod(en, media)).toBe("Fall 2023 – Winter 2024")
        expect(airingPeriod(de, media)).toBe("Herbst 2023 – Winter 2024")
    })
    it("running without end", () => {
        const media = { status: "RELEASING", startDate: { year: 2025, month: 10 }, endDate: {} }
        expect(airingPeriod(en, media)).toBe("Since Fall 2025")
        expect(airingPeriod(de, media)).toBe("Seit Herbst 2025")
        expect(airingPeriod(en, { ...media, status: "HIATUS" })).toBe("Since Fall 2025")
    })
    it("not yet released shows the start season only", () => {
        expect(airingPeriod(en, { status: "NOT_YET_RELEASED", startDate: { year: 2026, month: 7 }, endDate: { year: 2026, month: 9 } })).toBe("Summer 2026")
    })
    it("missing month falls back to AniList's season", () => {
        expect(airingPeriod(en, { status: "RELEASING", season: "SPRING", seasonYear: 2025, startDate: { year: 2025 } })).toBe("Since Spring 2025")
        expect(airingPeriod(en, { status: "FINISHED", season: "SUMMER", seasonYear: 2019, startDate: { year: 2019 }, endDate: { year: 2019, month: 12 } }))
            .toBe("Summer – Fall 2019")
    })
    it("only years known", () => {
        expect(airingPeriod(en, { status: "FINISHED", startDate: { year: 2017 }, endDate: { year: 2020 } })).toBe("2017–2020")
        expect(airingPeriod(en, { status: "FINISHED", startDate: { year: 2017 }, endDate: { year: 2017 } })).toBe("2017")
        expect(airingPeriod(en, { status: "FINISHED", startDate: { year: 2017, month: 10 }, endDate: { year: 2020 } })).toBe("Fall 2017 – 2020")
    })
    it("nothing known", () => {
        expect(airingPeriod(en, { status: "FINISHED" })).toBe("")
        expect(airingPeriod(en, { status: "NOT_YET_RELEASED", startDate: {} })).toBe("")
    })
})

describe("rankingBadges", () => {
    it("no rankings", () => {
        expect(rankingBadges(undefined)).toEqual([])
        expect(rankingBadges([])).toEqual([])
    })
    it("prefers the all-time place within #100", () => {
        const badges = rankingBadges([
            { type: "POPULAR", rank: 45, allTime: true },
            { type: "POPULAR", rank: 2, allTime: false, season: "WINTER", year: 2024 },
        ])
        expect(badges).toEqual([{ type: "POPULAR", rank: 45, allTime: true, season: null, year: null }])
        expect(rankingLabel(en, badges[0])).toBe("#45 Popular All Time")
        expect(rankingLabel(de, badges[0])).toBe("#45 Beliebt aller Zeiten")
    })
    it("falls back to the best season or year place within #10", () => {
        const badges = rankingBadges([
            { type: "POPULAR", rank: 101, allTime: true },
            { type: "POPULAR", rank: 7, allTime: false, season: "WINTER", year: 2024 },
            { type: "POPULAR", rank: 9, allTime: false, year: 2024 },
            { type: "RATED", rank: 3, allTime: false, year: 2024 },
        ])
        expect(badges.map(b => rankingLabel(en, b))).toEqual(["#7 Popular Winter 2024", "#3 Highest Rated 2024"])
        expect(badges.map(b => rankingLabel(de, b))).toEqual(["#7 Beliebt Winter 2024", "#3 Bestbewertet 2024"])
    })
    it("ranks just over the limits give no badge", () => {
        expect(rankingBadges([
            { type: "POPULAR", rank: 101, allTime: true },
            { type: "RATED", rank: 11, allTime: false, year: 2024 },
        ])).toEqual([])
        expect(rankingBadges([
            { type: "RATED", rank: 100, allTime: true },
            { type: "POPULAR", rank: 10, allTime: false, season: "FALL", year: 2023 },
        ]).map(b => rankingLabel(en, b))).toEqual(["#10 Popular Fall 2023", "#100 Highest Rated All Time"])
    })
    it("one badge per kind at most", () => {
        expect(rankingBadges([
            { type: "RATED", rank: 5, allTime: true },
            { type: "RATED", rank: 12, allTime: true },
            { type: "RATED", rank: 1, allTime: false, year: 2020 },
        ])).toHaveLength(1)
    })
})
