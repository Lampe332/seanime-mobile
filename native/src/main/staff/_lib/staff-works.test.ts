import type { AL_BaseAnime } from "@/api/generated/types"
import { joinDetailPages } from "@/api/hooks/detail-pages"
import type { AL_StaffDetails } from "@/api/hooks/anilist.hooks"
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

    it("joins the roles of a title whose edges sit on two pages, and the counts grow with each page", () => {
        const page = (edges: { staffRole: string, node: AL_BaseAnime }[], hasNextPage: boolean): AL_StaffDetails =>
            ({ Staff: { id: 9, name: { full: "Person" }, staffMedia: { pageInfo: { hasNextPage }, edges } } }) as AL_StaffDetails
        const first = page([{ staffRole: "Director", node: media(1, "ANIME") }, { staffRole: "Story", node: media(2, "MANGA") }], true)
        const second = page([{ staffRole: "Storyboard", node: media(1, "ANIME") }, { staffRole: "Script", node: media(3, "ANIME") }], false)
        const once = staffWorks(joinDetailPages([first], "Staff", "staffMedia", "edges")?.Staff?.staffMedia?.edges, false)
        expect([once.anime.length, once.manga.length]).toEqual([1, 1])
        const both = staffWorks(joinDetailPages([first, second], "Staff", "staffMedia", "edges")?.Staff?.staffMedia?.edges, false)
        expect(both.anime.map(work => [work.media.id, work.roles])).toEqual([[1, ["Director", "Storyboard"]], [3, ["Script"]]])
        expect(both.manga.map(work => work.media.id)).toEqual([2])
    })
})
