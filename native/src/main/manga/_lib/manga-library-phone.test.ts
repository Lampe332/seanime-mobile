import { Manga_CollectionList } from "@/api/generated/types"
import { MANGA_COLLECTION_SORTING_OPTIONS } from "@/lib/helpers/filtering"
import { describe, expect, it } from "vitest"
import { getMangaGenreCounts, getMangaStatusTabs, MANGA_PHONE_SORTING_OPTIONS, pickMangaStatus } from "./manga-library-phone"

function list(type: Manga_CollectionList["type"], genres: string[][]): Manga_CollectionList {
    return { type, status: type, entries: genres.map((g, i) => ({ mediaId: i + 1, media: { id: i + 1, genres: g } as any })) }
}

const raw = [
    list("CURRENT", [["Action"], ["Action", "Romance"]]),
    list("PLANNING", [["Drama"]]),
    list("COMPLETED", [["Action"], ["Comedy"], ["Romance"]]),
    list("PAUSED", []),
]

describe("phone manga status tabs", () => {
    it("lists statuses that hold manga in a fixed order, counting the filtered lists", () => {
        const filtered = [list("CURRENT", [["Action"], ["Action", "Romance"]]), list("PLANNING", []), list("COMPLETED", [["Action"]])]
        expect(getMangaStatusTabs(raw, filtered).map(t => [t.value, t.count])).toEqual([["CURRENT", 2], ["PLANNING", 0], ["COMPLETED", 1]])
        expect(getMangaStatusTabs(raw, filtered)[0]).toMatchObject({ en: "Reading", de: "Lese ich" })
        expect(getMangaStatusTabs(undefined, undefined)).toEqual([])
    })

    it("keeps the chosen status while it has a tab, else falls back to the first tab with manga", () => {
        const tabs = getMangaStatusTabs(raw, [list("CURRENT", []), list("PLANNING", [[]]), list("COMPLETED", [[]])])
        expect(pickMangaStatus("COMPLETED", tabs)).toBe("COMPLETED")
        expect(pickMangaStatus("CURRENT", tabs)).toBe("CURRENT") // an emptied tab stays selected
        expect(pickMangaStatus("DROPPED", tabs)).toBe("PLANNING")
        expect(pickMangaStatus(null, tabs)).toBe("PLANNING")
        expect(pickMangaStatus("CURRENT", [])).toBeNull()
    })
})

describe("phone manga filter sheet", () => {
    it("offers every library genre with the shown list's count", () => {
        expect(getMangaGenreCounts(raw, "CURRENT")).toEqual([
            { genre: "Action", count: 2 },
            { genre: "Comedy", count: 0 },
            { genre: "Drama", count: 0 },
            { genre: "Romance", count: 1 },
        ])
        expect(getMangaGenreCounts(raw, "COMPLETED").find(g => g.genre === "Comedy")?.count).toBe(1)
    })

    it("offers the settings' sorting options, each with a German label", () => {
        expect(MANGA_PHONE_SORTING_OPTIONS.map(o => o.value)).toEqual(MANGA_COLLECTION_SORTING_OPTIONS.map(o => o.value))
        for (const option of MANGA_PHONE_SORTING_OPTIONS) expect(option.de).not.toBe(option.en)
    })
})
