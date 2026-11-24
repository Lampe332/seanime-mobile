import { describe, expect, it } from "vitest"
import { DETAIL_PAGE_LIMIT, joinDetailPages, nextDetailPage } from "./detail-pages"

type Studio = { Studio?: { id: number, name: string, media?: { pageInfo?: { hasNextPage?: boolean }, nodes?: { id: number }[] } } }

const page = (ids: number[], hasNextPage?: boolean, name = "Madhouse"): Studio =>
    ({ Studio: { id: 11, name, media: { ...(hasNextPage === undefined ? {} : { pageInfo: { hasNextPage } }), nodes: ids.map(id => ({ id })) } } })

describe("joinDetailPages", () => {
    it("keeps the head of the first page and the items of all pages in order, with the last pageInfo", () => {
        const joined = joinDetailPages([page([1, 2], true), page([3], true, "later"), page([4], false)], "Studio", "media", "nodes")
        expect(joined).toEqual({ Studio: { id: 11, name: "Madhouse", media: { pageInfo: { hasNextPage: false }, nodes: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] } } })
    })

    it("reads an answer kept before paging (no pageInfo) as it is, and nothing as nothing", () => {
        expect(joinDetailPages([page([1, 2])], "Studio", "media", "nodes")).toEqual(page([1, 2]))
        expect(joinDetailPages<Studio>(undefined, "Studio", "media", "nodes")).toBeUndefined()
        expect(joinDetailPages<Studio>([{}], "Studio", "media", "nodes")).toEqual({})
    })
})

describe("nextDetailPage", () => {
    it("asks for the next page only while AniList says one follows", () => {
        expect(nextDetailPage(page([1], true), "Studio", "media", "nodes", 1)).toBe(2)
        expect(nextDetailPage(page([1], false), "Studio", "media", "nodes", 3)).toBeUndefined()
        expect(nextDetailPage(page([1]), "Studio", "media", "nodes", 1)).toBeUndefined()
    })

    it("stops on an empty page and at the guard, so a wrong pageInfo cannot loop", () => {
        expect(nextDetailPage(page([], true), "Studio", "media", "nodes", 2)).toBeUndefined()
        expect(nextDetailPage(page([1], true), "Studio", "media", "nodes", DETAIL_PAGE_LIMIT)).toBeUndefined()
        expect(nextDetailPage(page([1], true), "Studio", "media", "nodes", 10)).toBe(11)
    })
})
