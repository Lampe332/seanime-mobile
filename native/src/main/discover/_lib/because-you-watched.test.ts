import type { AL_AnimeCollection_MediaListCollection_Lists, AL_BaseAnime } from "@/api/generated/types"
import { describe, expect, it } from "vitest"
import { becauseRows, listedIds, pickSources, sourceTitle } from "./because-you-watched"

const anime = (id: number, isAdult = false) => ({ id, isAdult, title: { userPreferred: `Title ${id}` } }) as AL_BaseAnime

type EntryInput = { id: number, status: string, score?: number, completed?: [number, number, number], updatedAt?: number, isAdult?: boolean }

function lists(...entries: EntryInput[]): AL_AnimeCollection_MediaListCollection_Lists[] {
    return [{
        entries: entries.map(e => ({
            id: e.id * 10,
            status: e.status,
            score: e.score ?? 0,
            completedAt: e.completed ? { year: e.completed[0], month: e.completed[1], day: e.completed[2] } : {},
            updatedAt: e.updatedAt,
            media: anime(e.id, e.isAdult),
        })),
    }] as AL_AnimeCollection_MediaListCollection_Lists[]
}

const ids = (media: AL_BaseAnime[] | undefined) => media?.map(m => m.id)
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => anime(from + i))

describe("pickSources", () => {
    it("takes the newest completed anime, completion date before the last change", () => {
        const picked = pickSources(lists(
            { id: 1, status: "COMPLETED", completed: [2025, 1, 1], updatedAt: 1_900_000_000 },
            { id: 2, status: "COMPLETED", completed: [2026, 5, 3] },
            { id: 3, status: "CURRENT", updatedAt: 1_990_000_000 },
            { id: 4, status: "COMPLETED", updatedAt: 1_700_000_000 },
        ), false)
        expect(ids(picked)).toEqual([2, 1])
    })

    it("prefers liked or unscored titles, uses 50 to 69 only after them and never one below 50", () => {
        const picked = pickSources(lists(
            { id: 1, status: "COMPLETED", score: 60, completed: [2026, 9, 1] },
            { id: 2, status: "COMPLETED", score: 30, completed: [2026, 10, 1] },
            { id: 3, status: "COMPLETED", score: 85, completed: [2024, 1, 1] },
        ), false)
        expect(ids(picked)).toEqual([3, 1])
        expect(ids(pickSources(lists({ id: 2, status: "COMPLETED", score: 49, completed: [2026, 1, 1] }), false))).toEqual([])
    })

    it("skips adult titles unless they are turned on", () => {
        const input = lists({ id: 1, status: "COMPLETED", isAdult: true, completed: [2026, 2, 1] }, { id: 2, status: "COMPLETED", completed: [2025, 2, 1] })
        expect(ids(pickSources(input, false))).toEqual([2])
        expect(ids(pickSources(input, true))).toEqual([1, 2])
    })

    it("gives nothing without lists or completed titles", () => {
        expect(pickSources(undefined, false)).toEqual([])
        expect(pickSources(lists({ id: 1, status: "PLANNING" }), false)).toEqual([])
    })
})

describe("becauseRows", () => {
    it("drops titles on any list, adult titles when off and keeps AniList's order, at most 20", () => {
        const listed = listedIds(lists({ id: 101, status: "PLANNING" }, { id: 102, status: "DROPPED" }))
        const recommendations = [anime(101), anime(103, true), anime(102), ...range(104, 130)]
        const [row] = becauseRows([{ source: anime(1), recommendations }], listed, false)
        expect(ids(row.items)).toEqual(ids(range(104, 123)))
    })

    it("shows a title only in the first row and leaves out rows under 4 titles", () => {
        const rows = becauseRows([
            { source: anime(1), recommendations: range(10, 15) },
            { source: anime(2), recommendations: [...range(12, 15), ...range(20, 22)] },
        ], new Set(), false)
        expect(rows.map(row => row.source.id)).toEqual([1])
        const both = becauseRows([
            { source: anime(1), recommendations: range(10, 13) },
            { source: anime(2), recommendations: [...range(10, 11), ...range(20, 23)] },
        ], new Set(), false)
        expect(both.map(row => ids(row.items))).toEqual([[10, 11, 12, 13], [20, 21, 22, 23]])
    })

    it("a short first row does not take titles from the second", () => {
        const rows = becauseRows([
            { source: anime(1), recommendations: range(10, 12) },
            { source: anime(2), recommendations: range(10, 14) },
        ], new Set(), false)
        expect(rows.map(row => ids(row.items))).toEqual([[10, 11, 12, 13, 14]])
    })

    it("leaves out failed rows and waits while an earlier row loads", () => {
        expect(becauseRows([{ source: anime(1), recommendations: null }], new Set(), false)).toEqual([])
        const rows = becauseRows([
            { source: anime(1), recommendations: undefined },
            { source: anime(2), recommendations: range(10, 15) },
        ], new Set(), false)
        expect(rows.map(row => [row.source.id, row.items])).toEqual([[1, undefined], [2, undefined]])
    })
})

describe("sourceTitle", () => {
    it("uses the preferred title, then romaji, then english", () => {
        expect(sourceTitle(anime(1))).toBe("Title 1")
        expect(sourceTitle({ id: 2, title: { romaji: "Romaji", english: "English" } } as AL_BaseAnime)).toBe("Romaji")
    })
})
