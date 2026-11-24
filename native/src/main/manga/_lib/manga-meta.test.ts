import { rankingBadges, rankingLabel } from "@/main/entry/_lib/anime-meta"
import { describe, expect, it } from "vitest"
import { mangaRelations, publishingPeriod } from "./manga-meta"

const en = (e: string, _d: string) => e
const de = (_e: string, d: string) => d

describe("publishingPeriod", () => {
    it("spans the years of a finished manga", () => {
        expect(publishingPeriod(en, { status: "FINISHED", startDate: { year: 2017 }, endDate: { year: 2020 } })).toBe("2017–2020")
    })
    it("shows one year when it started and ended in it", () => {
        expect(publishingPeriod(en, { status: "FINISHED", startDate: { year: 2019 }, endDate: { year: 2019 } })).toBe("2019")
    })
    it("runs since its start while releasing or on hiatus", () => {
        expect(publishingPeriod(en, { status: "RELEASING", startDate: { year: 2019 } })).toBe("Since 2019")
        expect(publishingPeriod(de, { status: "HIATUS", startDate: { year: 2019 }, endDate: { year: 2022 } })).toBe("Seit 2019")
    })
    it("keeps the start alone before release or without an end, nothing without a start", () => {
        expect(publishingPeriod(en, { status: "NOT_YET_RELEASED", startDate: { year: 2027 }, endDate: { year: 2027 } })).toBe("2027")
        expect(publishingPeriod(en, { status: "CANCELLED", startDate: { year: 2015 }, endDate: null })).toBe("2015")
        expect(publishingPeriod(en, { status: "FINISHED", startDate: { year: null }, endDate: { year: 2020 } })).toBe("")
        expect(publishingPeriod(en, {})).toBe("")
    })
})

describe("manga ranking badges", () => {
    it("label a year's place without a season", () => {
        const [badge] = rankingBadges([{ type: "RATED", rank: 4, allTime: false, year: 2021, season: null }])
        expect(rankingLabel(de, badge)).toBe("#4 Bestbewertet 2021")
    })
})

describe("mangaRelations", () => {
    const edge = (relationType: string, id: number, type = "MANGA") => ({ relationType, node: { id, type } })
    it("orders the story line first and leaves out anime and same characters", () => {
        const edges = [edge("SIDE_STORY", 1), edge("ADAPTATION", 2, "ANIME"), edge("SEQUEL", 3), edge("CHARACTER", 4), edge("PREQUEL", 5), null, edge("WEIRD", 6), edge("SEQUEL", 7)]
        expect(mangaRelations(edges).map(e => e.node.id)).toEqual([5, 3, 7, 1, 6])
    })
    it("keeps at most max", () => {
        expect(mangaRelations([edge("SEQUEL", 1), edge("SEQUEL", 2), edge("SEQUEL", 3)], 2)).toHaveLength(2)
        expect(mangaRelations(undefined)).toEqual([])
    })
})
