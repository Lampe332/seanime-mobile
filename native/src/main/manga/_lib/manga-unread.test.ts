import { describe, expect, it } from "vitest"
import { getMangaChapterTotal, getMangaEntryLatestChapterNumber, getMangaEntryUnreadState } from "./manga-unread"

const latestChapterNumbers = {
    1: [
        { provider: "provider-a", language: "en", scanlator: "A", number: 12 },
        { provider: "provider-a", language: "fr", scanlator: "A", number: 10 },
        { provider: "provider-a", language: "en", scanlator: "B", number: 14 },
        { provider: "provider-b", language: "en", scanlator: "A", number: 100 },
    ],
}

describe("manga unread state", () => {
    it("uses only the selected provider and active filters", () => {
        expect(getMangaEntryLatestChapterNumber(1, latestChapterNumbers, { 1: "provider-a" }, {
            1: { language: "en", scanlators: ["A"] },
        })).toBe(12)

        expect(getMangaEntryLatestChapterNumber(1, latestChapterNumbers, { 1: "provider-a" }, {
            1: { language: "en", scanlators: [] },
        })).toBe(14)
    })

    it("returns unknown when the selected source or filter has no data", () => {
        expect(getMangaEntryLatestChapterNumber(1, latestChapterNumbers, {}, {})).toBeNull()
        expect(getMangaEntryLatestChapterNumber(1, latestChapterNumbers, { 1: "provider-a" }, {
            1: { language: "jp", scanlators: [] },
        })).toBeNull()
        expect(getMangaEntryLatestChapterNumber(2, latestChapterNumbers, { 2: "provider-a" }, {})).toBeNull()
    })

    it("never reports a negative unread count", () => {
        expect(getMangaEntryUnreadState(1, 9, latestChapterNumbers, { 1: "provider-a" }, {}).unread).toBe(5)
        expect(getMangaEntryUnreadState(1, 20, latestChapterNumbers, { 1: "provider-a" }, {})).toEqual({
            known: true,
            latest: 14,
            unread: 0,
        })
        expect(getMangaEntryUnreadState(2, 0, latestChapterNumbers, { 2: "provider-a" }, {})).toEqual({
            known: false,
            latest: null,
            unread: 0,
        })
    })
})

describe("manga chapter total (library and page show the same)", () => {
    it("takes the newest source chapter when AniList has no count (running manga)", () => {
        const latest = getMangaEntryLatestChapterNumber(1, latestChapterNumbers, { 1: "provider-a" }, {})
        expect(getMangaChapterTotal(null, latest)).toBe(14)
    })
    it("takes the larger of both, and AniList's count without a source", () => {
        expect(getMangaChapterTotal(120, 98)).toBe(120)
        expect(getMangaChapterTotal(40, 52)).toBe(52)
        expect(getMangaChapterTotal(40, null)).toBe(40)
    })
    it("is unknown when neither knows a count", () => {
        expect(getMangaChapterTotal(undefined, null)).toBeNull()
        expect(getMangaChapterTotal(0, 0)).toBeNull()
    })
    it("ignores a source that ends below the progress: 7 read, Local has 2 → 7/- as in 2.0.33, not 7/2 (r18)", () => {
        expect(getMangaChapterTotal(null, 2, 7)).toBeNull()
        expect(getMangaChapterTotal(40, 2, 7)).toBe(40)
        expect(getMangaChapterTotal(null, 7, 7)).toBe(7)
        expect(getMangaChapterTotal(null, 14, 7)).toBe(14)
        expect(getMangaChapterTotal(null, 14, 0)).toBe(14)
    })
})
