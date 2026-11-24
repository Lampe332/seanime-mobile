import type { AL_BaseAnime } from "@/api/generated/types"
import { describe, expect, it } from "vitest"
import { staffWorks } from "./staff-works"

const media = (id: number, type: "ANIME" | "MANGA", isAdult = false) => ({ id, type, isAdult, title: { userPreferred: `Work ${id}` } }) as AL_BaseAnime

describe("staffWorks", () => {
    it("joins the roles of one title, keeps AniList's order and splits anime from manga", () => {
        const works = staffWorks([
            { staffRole: "Director", node: media(1, "ANIME") },
            { staffRole: "Story & Art", node: media(2, "MANGA") },
            { staffRole: "Storyboard (ep 1)", node: media(1, "ANIME") },
            { staffRole: "Director", node: media(1, "ANIME") },
            { staffRole: "Original Creator", node: media(3, "ANIME") },
        ], false)
        expect(works.anime.map(work => [work.media.id, work.roles])).toEqual([[1, ["Director", "Storyboard (ep 1)"]], [3, ["Original Creator"]]])
        expect(works.manga.map(work => [work.media.id, work.roles])).toEqual([[2, ["Story & Art"]]])
    })

    it("leaves adult titles out unless they are allowed, and skips edges without a title", () => {
        const edges = [{ staffRole: "Art", node: media(4, "MANGA", true) }, null, { staffRole: "Art", node: null }]
        expect(staffWorks(edges, false)).toEqual({ anime: [], manga: [] })
        expect(staffWorks(edges, true).manga.map(work => work.media.id)).toEqual([4])
    })
})
