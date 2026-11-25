import type { Models_HomeItem } from "@/api/generated/types"
import { describe, expect, it } from "vitest"
import {
    addHomeItem,
    availableHomeItemTypes,
    canMoveHomeItem,
    carouselEmptyCause,
    filterByGenres,
    genreCounts,
    hasSectionGapBefore,
    myShowsPlace,
    homeBannerOpacity,
    homeBannerPosition,
    isDefaultHome,
    isTopBanner,
    moveHomeItem,
    normalizeHomeItems,
    removeHomeItem,
    resetCarouselOptions,
    resolveHomeItems,
    restoreHomeItem,
    withCurrentSchema,
} from "./home-layout"
import { DEFAULT_HOME_ITEMS, HOME_ITEMS } from "./home-items.utils"

const item = (id: string, type: string, extra: Partial<Models_HomeItem> = {}): Models_HomeItem =>
    ({ id, type, schemaVersion: HOME_ITEMS[type]?.schemaVersion ?? 1, ...extra })

describe("resolveHomeItems", () => {
    it("falls back to the default sections only while nothing was ever saved", () => {
        expect(resolveHomeItems(null)).toEqual(DEFAULT_HOME_ITEMS)
        expect(resolveHomeItems(undefined)).toEqual(DEFAULT_HOME_ITEMS)
    })
    it("keeps an emptied Home empty", () => {
        expect(resolveHomeItems([])).toEqual([])
    })
    it("shows a leading continue-watching banner as the continue-watching row and drops the other row", () => {
        const items = resolveHomeItems([item("a", "anime-continue-watching-header"), item("b", "anime-library"), item("c", "anime-continue-watching")])
        expect(items.map(i => [i.id, i.type])).toEqual([["a", "anime-continue-watching"], ["b", "anime-library"]])
    })
    it("moves a banner that is not first to the top instead of hiding it", () => {
        const items = resolveHomeItems([item("b", "anime-library"), item("a", "anime-continue-watching-header")])
        expect(items.map(i => [i.id, i.type])).toEqual([["a", "anime-continue-watching"], ["b", "anime-library"]])
        expect(resolveHomeItems([item("b", "anime-library"), item("d", "discover-header")]).map(i => i.id)).toEqual(["d", "b"])
    })
})

describe("one of each kind (migration of lists saved before 4.3.1)", () => {
    it("keeps the upper one of two sections of a kind", () => {
        const saved = [
            item("a", "anime-carousel", { options: { name: "First" } }), item("b", "missed-sequels"),
            item("c", "anime-carousel", { options: { name: "Second" } }), item("d", "my-lists"), item("e", "my-lists"), item("f", "centered-title"), item("g", "centered-title"),
        ]
        expect(normalizeHomeItems(saved).map(i => i.id)).toEqual(["a", "b", "d", "f"])
        expect(resolveHomeItems(saved).map(i => i.id)).toEqual(["a", "b", "d", "f"])
        expect(normalizeHomeItems(saved)[0].options).toEqual({ name: "First" })
    })
    it("counts the continue-watching row and its banner as one kind", () => {
        expect(normalizeHomeItems([item("a", "anime-continue-watching"), item("b", "anime-library"), item("c", "anime-continue-watching-header")]).map(i => [i.id, i.type]))
            .toEqual([["a", "anime-continue-watching"], ["b", "anime-library"]])
    })
})

describe("banners", () => {
    it("put the discover banner first and turn the continue-watching banner into the row where it stands", () => {
        const items = normalizeHomeItems([item("a", "anime-continue-watching-header"), item("b", "anime-library"), item("d", "discover-header")])
        expect(items.map(i => [i.id, i.type])).toEqual([["d", "discover-header"], ["a", "anime-continue-watching"], ["b", "anime-library"]])
    })
    it("go to the top when added and stay there when moved", () => {
        const added = addHomeItem([item("b", "anime-library"), item("c", "missed-sequels")], "discover-header", "d")
        expect(added.map(i => i.id)).toEqual(["d", "b", "c"])
        expect(moveHomeItem(added, 0, 1).map(i => i.id)).toEqual(["d", "b", "c"])
        expect(moveHomeItem(added, 1, -1).map(i => i.id)).toEqual(["d", "b", "c"])
        expect(addHomeItem([item("b", "anime-library")], "anime-continue-watching-header", "a").map(i => [i.id, i.type]))
            .toEqual([["a", "anime-continue-watching-header"], ["b", "anime-library"]])
    })
    it("offer the continue-watching banner only without the discover banner and without the row", () => {
        expect(availableHomeItemTypes([item("d", "discover-header")])).not.toContain("anime-continue-watching-header")
        expect(availableHomeItemTypes([item("a", "anime-continue-watching")])).not.toContain("anime-continue-watching-header")
        expect(availableHomeItemTypes([item("a", "anime-continue-watching-header")])).not.toContain("anime-continue-watching")
        expect(availableHomeItemTypes([item("b", "anime-library")])).toContain("anime-continue-watching-header")
    })
})

describe("defaults", () => {
    it("are saved under their section's current schema, with options the schema knows", () => {
        for (const section of DEFAULT_HOME_ITEMS) {
            const schema = HOME_ITEMS[section.type]
            expect(schema, section.type).toBeDefined()
            expect(section.schemaVersion, section.type).toBe(schema.schemaVersion)
            expect(withCurrentSchema(section), section.type).toBe(section)
            for (const [name, value] of Object.entries(section.options ?? {})) {
                const option = schema.options?.find(candidate => candidate.name === name)
                expect(option, `${section.type}.${name}`).toBeDefined()
                const values = (option!.options ?? []).map(choice => choice.value)
                for (const picked of Array.isArray(value) ? value : [value]) if (values.length) expect(values, `${section.type}.${name}`).toContain(picked)
            }
        }
    })
    it("offer no option that does nothing (layout, a season for manga) and every manga status", () => {
        for (const type of ["anime-library", "my-lists", "local-anime-library", "manga-library"]) {
            expect(HOME_ITEMS[type].options?.some(option => option.name === "layout") ?? false, type).toBe(false)
        }
        expect(HOME_ITEMS["manga-carousel"].options!.some(option => option.name === "season")).toBe(false)
        expect(HOME_ITEMS["anime-carousel"].options!.some(option => option.name === "season")).toBe(true)
        expect(HOME_ITEMS["manga-library"].options!.find(option => option.name === "statuses")!.options!.map(option => option.value).sort())
            .toEqual(["COMPLETED", "CURRENT", "DROPPED", "PAUSED", "PLANNING", "REPEATING"])
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

describe("empty carousel", () => {
    // every genre ticked: AniList's genre_in wants all of them on one title and answers an empty page (checked 20.11.2026)
    const allTicked = {
        status: ["RELEASING", "FINISHED", "NOT_YET_RELEASED"],
        genres: HOME_ITEMS["anime-carousel"].options!.find(option => option.name === "genres")!.options!.map(option => option.value),
    }
    it("blames two or more genres, which must all match, when nothing else narrows the row", () => {
        expect(carouselEmptyCause(allTicked, "anime")).toEqual({ genres: 18 })
        expect(carouselEmptyCause({ genres: ["Sports", "Mecha"], sorting: "SCORE", name: "Mine" }, "manga")).toEqual({ genres: 2 })
    })
    it("names every narrowing option instead of blaming the genres when others narrow the row too", () => {
        expect(carouselEmptyCause({ genres: ["Action", "Comedy"], format: "SPECIAL" }, "anime")).toEqual({ options: ["Format", "Genres"] })
        expect(carouselEmptyCause({ genres: ["Action", "Comedy"], status: ["NOT_YET_RELEASED"] }, "anime")).toEqual({ options: ["Status", "Genres"] })
        expect(carouselEmptyCause({ genres: ["Action", "Comedy"], year: 2026, season: "FALL" }, "anime")).toEqual({ options: ["Genres", "Season", "Year"] })
    })
    it("otherwise names the options that narrow the row", () => {
        expect(carouselEmptyCause({ name: "Mine", sorting: "SCORE", format: "SPECIAL", genres: ["Music"], season: "FALL", year: 0, countryOfOrigin: "TW" }, "anime"))
            .toEqual({ options: ["Format", "Genres", "Season", "Country of origin"] })
        expect(carouselEmptyCause({ season: "FALL", year: 2025, status: [] }, "manga")).toEqual({ options: ["Year"] })
        expect(carouselEmptyCause(undefined, "anime")).toEqual({ options: [] })
    })
    it("resets one carousel to its defaults and keeps its name", () => {
        const items = [item("a", "anime-carousel", { options: { name: "Mine", ...allTicked } }), item("b", "manga-carousel", { options: allTicked })]
        expect(resetCarouselOptions(items, "a")).toEqual([item("a", "anime-carousel", { options: { name: "Mine" } }), items[1]])
        expect(resetCarouselOptions(items, "b")).toEqual([items[0], item("b", "manga-carousel", { options: undefined })])
    })
})

describe("customize", () => {
    it("offers every kind only while it is not on Home", () => {
        const available = availableHomeItemTypes([item("a", "anime-library"), item("b", "anime-carousel"), item("c", "my-lists")])
        expect(available).not.toContain("anime-library")
        expect(available).not.toContain("anime-carousel")
        expect(available).not.toContain("my-lists")
        expect(available).toContain("manga-carousel")
        expect(available).toContain("missed-sequels")
    })
    it("adds at the end and refuses a kind already on Home", () => {
        expect(addHomeItem([item("a", "anime-library")], "missed-sequels", "x").map(i => i.id)).toEqual(["a", "x"])
        const current = [item("a", "anime-carousel")]
        expect(addHomeItem(current, "anime-carousel", "x")).toBe(current)
        expect(addHomeItem(current, "gone", "x")).toBe(current)
    })
    it("moves up and down and ignores moves past the ends", () => {
        const items = [item("a", "anime-library"), item("b", "missed-sequels"), item("c", "aired-recently")]
        expect(moveHomeItem(items, 1, -1).map(i => i.id)).toEqual(["b", "a", "c"])
        expect(moveHomeItem(items, 1, 1).map(i => i.id)).toEqual(["a", "c", "b"])
        expect(moveHomeItem(items, 0, -1)).toBe(items)
        expect(moveHomeItem(items, 2, 1)).toBe(items)
    })
    it("keeps the top banner first: it has no moves and nothing moves above it", () => {
        for (const banner of ["discover-header", "anime-continue-watching-header"]) {
            const items = normalizeHomeItems([item("h", banner), item("a", "anime-library"), item("b", "missed-sequels")])
            expect(isTopBanner(items, 0), banner).toBe(true)
            expect(isTopBanner(items, 1), banner).toBe(false)
            expect(canMoveHomeItem(items, 0, 1), banner).toBe(false)
            expect(canMoveHomeItem(items, 1, -1), banner).toBe(false)
            expect(canMoveHomeItem(items, 1, 1), banner).toBe(true)
            expect(canMoveHomeItem(items, 2, -1), banner).toBe(true)
            expect(canMoveHomeItem(items, 2, 1), banner).toBe(false)
            expect(moveHomeItem(items, 1, -1)).toBe(items)
            expect(moveHomeItem(items, 0, 1)).toBe(items)
            expect(moveHomeItem(items, 2, -1).map(i => i.id)).toEqual(["h", "b", "a"])
        }
        // without a banner the first section moves like any other
        const plain = [item("a", "anime-library"), item("b", "missed-sequels")]
        expect(isTopBanner(plain, 0)).toBe(false)
        expect(canMoveHomeItem(plain, 0, 1)).toBe(true)
        expect(canMoveHomeItem(plain, 5, -1)).toBe(false)
    })
    it("removes a section and puts it back at its old place on Undo, keeping changes made since", () => {
        const items = [item("a", "anime-library"), item("b", "missed-sequels"), item("c", "aired-recently")]
        const removed = removeHomeItem(items, "b")
        expect(removed.map(i => i.id)).toEqual(["a", "c"])
        expect(restoreHomeItem(removed, items[1], 1).map(i => i.id)).toEqual(["a", "b", "c"])
        // a section added after the removal stays
        const later = addHomeItem(removed, "my-lists", "d")
        expect(restoreHomeItem(later, items[1], 1).map(i => i.id)).toEqual(["a", "b", "c", "d"])
        // an index past the end puts it last; a kind on Home again is not added twice
        expect(restoreHomeItem([item("a", "anime-library")], items[2], 7).map(i => i.id)).toEqual(["a", "c"])
        const again = addHomeItem(removed, "missed-sequels", "x")
        expect(restoreHomeItem(again, items[1], 1)).toBe(again)
        // a removed banner comes back on top
        const withBanner = normalizeHomeItems([item("d", "discover-header"), ...items])
        expect(restoreHomeItem(removeHomeItem(withBanner, "d"), withBanner[0], 0).map(i => i.id)).toEqual(["d", "a", "b", "c"])
        // an emptied Home stays empty until something is put back
        expect(removeHomeItem([item("a", "anime-library")], "a")).toEqual([])
    })
    it("knows when Home already is the default one", () => {
        expect(isDefaultHome(DEFAULT_HOME_ITEMS)).toBe(true)
        expect(isDefaultHome(DEFAULT_HOME_ITEMS.map(section => ({ ...section, id: `x-${section.id}` })))).toBe(true)
        expect(isDefaultHome([])).toBe(false)
        expect(isDefaultHome([...DEFAULT_HOME_ITEMS].reverse())).toBe(false)
        expect(isDefaultHome(DEFAULT_HOME_ITEMS.map(section => section.type === "anime-library" ? { ...section, options: { statuses: ["CURRENT"] } } : section))).toBe(false)
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

describe("My shows on Home", () => {
    const item = (id: string, type: string, options?: Record<string, unknown>) => ({ id, type, schemaVersion: 1, options }) as Models_HomeItem

    it("sits after Currently watching on the default Home, below Continue watching", () => {
        const items = [...DEFAULT_HOME_ITEMS]
        const place = myShowsPlace(items)
        expect(place).toEqual({ after: items.find(i => i.type === "anime-library")!.id, inLibrary: true })
        expect(items.findIndex(i => i.type === "anime-continue-watching")).toBeLessThan(items.findIndex(i => i.id === place!.after))
    })

    it("keeps a custom order and only picks the library section that shows Currently watching", () => {
        const items = [item("a", "anime-continue-watching"), item("b", "anime-library", { statuses: ["PLANNING"] }), item("c", "anime-library", { statuses: ["CURRENT"] })]
        expect(myShowsPlace(items)).toEqual({ after: "c", inLibrary: true })
        expect(myShowsPlace([item("x", "anime-library")])).toEqual({ after: "x", inLibrary: true })
        expect(myShowsPlace(items.slice(0, 2))).toEqual({ after: "a", inLibrary: false })
        expect(myShowsPlace([item("d", "discover-header")])).toBeNull()
    })
})
