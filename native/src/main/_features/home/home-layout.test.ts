import type { Models_HomeItem } from "@/api/generated/types"
import { describe, expect, it } from "vitest"
import {
    addHomeItem,
    availableHomeItemTypes,
    filterByGenres,
    genreCounts,
    hasSectionGapBefore,
    homeBannerOpacity,
    homeBannerPosition,
    moveHomeItem,
    normalizeHomeItems,
    resolveHomeItems,
    withCurrentSchema,
} from "./home-layout"
import { DEFAULT_HOME_ITEMS, HOME_ITEMS } from "./home-items.utils"

const item = (id: string, type: string, extra: Partial<Models_HomeItem> = {}): Models_HomeItem =>
    ({ id, type, schemaVersion: HOME_ITEMS[type]?.schemaVersion ?? 1, ...extra })

describe("resolveHomeItems", () => {
    it("falls back to the default sections", () => {
        expect(resolveHomeItems(null)).toBe(DEFAULT_HOME_ITEMS)
        expect(resolveHomeItems([])).toBe(DEFAULT_HOME_ITEMS)
    })
    it("shows a leading continue-watching banner as the continue-watching row and drops the other row", () => {
        const items = resolveHomeItems([item("a", "anime-continue-watching-header"), item("b", "anime-library"), item("c", "anime-continue-watching")])
        expect(items.map(i => [i.id, i.type])).toEqual([["a", "anime-continue-watching"], ["b", "anime-library"]])
    })
    it("leaves a banner that is not first alone", () => {
        const saved = [item("b", "anime-library"), item("a", "anime-continue-watching-header")]
        expect(resolveHomeItems(saved)).toBe(saved)
    })
})

describe("schema", () => {
    it("drops options saved under an older schema", () => {
        const old = item("a", "anime-library", { schemaVersion: 1, options: { layout: "carousel" } })
        expect(withCurrentSchema(old)).toEqual({ ...old, schemaVersion: 2, options: undefined })
        const current = item("b", "anime-library", { options: { layout: "grid" } })
        expect(withCurrentSchema(current)).toBe(current)
        expect(withCurrentSchema(item("c", "gone"))).toBeUndefined()
    })
    it("normalizes to known sections with their current version", () => {
        expect(normalizeHomeItems([item("a", "gone"), item("b", "manga-library", { schemaVersion: 1 })])).toEqual([item("b", "manga-library")])
    })
})

describe("customize", () => {
    it("offers repeatable sections always and the others only while off", () => {
        const available = availableHomeItemTypes([item("a", "anime-library"), item("b", "anime-carousel")])
        expect(available).not.toContain("anime-library")
        expect(available).toContain("anime-carousel")
        expect(available).toContain("my-lists")
        expect(available).toContain("missed-sequels")
    })
    it("adds at the end", () => {
        expect(addHomeItem([item("a", "anime-library")], "missed-sequels", "x").map(i => i.id)).toEqual(["a", "x"])
    })
    it("moves up and down and ignores moves past the ends", () => {
        const items = [item("a", "anime-library"), item("b", "missed-sequels"), item("c", "aired-recently")]
        expect(moveHomeItem(items, 1, -1).map(i => i.id)).toEqual(["b", "a", "c"])
        expect(moveHomeItem(items, 1, 1).map(i => i.id)).toEqual(["a", "c", "b"])
        expect(moveHomeItem(items, 0, -1)).toBe(items)
        expect(moveHomeItem(items, 2, 1)).toBe(items)
    })
    it("puts a gap only before sections without their own heading space", () => {
        expect(hasSectionGapBefore("missed-sequels", 1)).toBe(true)
        expect(hasSectionGapBefore("manga-library", 1)).toBe(false)
        expect(hasSectionGapBefore("missed-sequels", 0)).toBe(false)
    })
})

describe("banner", () => {
    it("reads the stored opacity, unset as full", () => {
        expect(homeBannerOpacity(undefined)).toBe(1)
        expect(homeBannerOpacity(0)).toBe(1)
        expect(homeBannerOpacity(40)).toBe(0.4)
        expect(homeBannerOpacity(250)).toBe(1)
    })
    it("turns the stored object-position into a content position", () => {
        expect(homeBannerPosition("30% 70%")).toEqual({ left: "30%", top: "70%" })
        expect(homeBannerPosition("12.5% 0%")).toEqual({ left: "12.5%", top: "0%" })
        expect(homeBannerPosition("center")).toEqual({ left: "50%", top: "50%" })
        expect(homeBannerPosition(undefined)).toEqual({ left: "50%", top: "50%" })
    })
})

describe("Currently watching genre filter", () => {
    const entries = [
        { media: { genres: ["Action", "Comedy"] } },
        { media: { genres: ["Action", "Fantasy"] } },
        { media: { genres: ["Comedy"] } },
        { media: null },
    ]
    it("counts genres, most first, then A–Z", () => {
        expect(genreCounts(entries)).toEqual([["Action", 2], ["Comedy", 2], ["Fantasy", 1]])
    })
    it("keeps only entries with every picked genre", () => {
        expect(filterByGenres(entries, ["Action"]).length).toBe(2)
        expect(filterByGenres(entries, ["Action", "Comedy"]).length).toBe(1)
        expect(filterByGenres(entries, [])).toBe(entries)
        expect(filterByGenres(undefined, ["Action"])).toEqual([])
    })
})
