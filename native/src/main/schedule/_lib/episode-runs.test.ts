import { describe, expect, it } from "vitest"
import { episodeRunLabel, groupEpisodeRuns } from "./episode-runs"

type Row = { show: number, at: number, episode: number }
const row = (show: number, at: number, episode: number): Row => ({ show, at, episode })
const runs = (rows: Row[]) => groupEpisodeRuns(rows, r => r).map(r => [r.items[0].show, r.from, r.to, r.items.length])
const en = (english: string) => english
const de = (_english: string, german: string) => german

describe("groupEpisodeRuns", () => {
    it("joins a batch drop of one show at one time into one run", () => {
        const drop = [4, 5, 6, 7, 8, 9, 10, 11].map(n => row(1, 900, n))
        expect(runs([row(2, 800, 3), ...drop, row(3, 1000, 1)])).toEqual([[2, 3, 3, 1], [1, 4, 11, 8], [3, 1, 1, 1]])
    })

    it("keeps a gap, another time and another show apart", () => {
        expect(runs([row(1, 900, 4), row(1, 900, 5), row(1, 900, 7)])).toEqual([[1, 4, 5, 2], [1, 7, 7, 1]])
        expect(runs([row(1, 900, 4), row(1, 960, 5)])).toEqual([[1, 4, 4, 1], [1, 5, 5, 1]])
        expect(runs([row(1, 900, 4), row(2, 900, 5)])).toEqual([[1, 4, 4, 1], [2, 5, 5, 1]])
    })

    it("sorts episodes of the same time by number and keeps the order of the rows", () => {
        expect(runs([row(2, 900, 1), row(1, 900, 6), row(1, 900, 5)])).toEqual([[2, 1, 1, 1], [1, 5, 6, 2]])
        expect(runs([])).toEqual([])
    })
})

describe("episodeRunLabel", () => {
    it("names one episode or a run in both languages", () => {
        expect(episodeRunLabel(en, { from: 5, to: 5 })).toBe("Episode 5")
        expect(episodeRunLabel(en, { from: 4, to: 11 })).toBe("Episodes 4–11")
        expect(episodeRunLabel(de, { from: 4, to: 11 })).toBe("Folgen 4–11")
    })
})
