import { Manga_CollectionEntry } from "@/api/generated/types"
import { describe, expect, it } from "vitest"
import { MANGA_READER_RESUME_MAX_AGE_MS } from "./manga-chapter-reader.atoms"
import { getMangaContinueReading, getMangaResumeChapter, isMangaContinueIntentFor, MANGA_CONTINUE_INTENT_MAX_AGE_MS } from "./manga-continue"

const NOW = 1_800_000_000_000

function entry(mediaId: number, listData: Manga_CollectionEntry["listData"], chapters?: number): Manga_CollectionEntry {
    return { mediaId, media: { id: mediaId, chapters, title: { userPreferred: `Manga ${mediaId}` } } as any, listData }
}

const latestChapterNumbers = {
    1: [{ provider: "p", scanlator: "", language: "", number: 20 }],
    2: [{ provider: "p", scanlator: "", language: "", number: 8 }],
}
const storedProviders = { 1: "p", 2: "p" }
const base = { resumeLocations: {}, latestChapterNumbers, storedProviders, storedFilters: {}, now: NOW }

describe("continue reading row", () => {
    it("keeps started Reading and Rereading manga, newest activity first", () => {
        const items = getMangaContinueReading([
            entry(1, { status: "CURRENT", progress: 12, updatedAt: 1_700_000_000 }),
            entry(3, { status: "REPEATING", progress: 4, updatedAt: 1_700_000_500 }),
            entry(4, { status: "PLANNING", progress: 2, updatedAt: 1_799_000_000 }),
            entry(5, { status: "CURRENT", progress: 0, updatedAt: 1_799_000_000 }),
        ], base)
        expect(items.map(i => i.entry.mediaId)).toEqual([3, 1])
        expect(items[1]).toMatchObject({ progress: 12, total: 20, unread: 8 })
        expect(items[0]).toMatchObject({ unread: null, total: null })
    })

    it("leaves out manga with nothing to continue", () => {
        const items = getMangaContinueReading([
            entry(2, { status: "CURRENT", progress: 8, updatedAt: 1 }),     // caught up on the saved source
            entry(6, { status: "CURRENT", progress: 50, updatedAt: 1 }, 50), // read to AniList's last chapter, source unknown
            entry(7, { status: "CURRENT", progress: 49, updatedAt: 1 }, 50),
        ], base)
        expect(items.map(i => i.entry.mediaId)).toEqual([7])
    })

    it("counts a page saved by the reader as reading activity", () => {
        const resumeLocations = { 5: { chapterId: "c1", provider: "p", pageIndex: 3, updatedAt: NOW - 1000 } }
        const items = getMangaContinueReading([
            entry(1, { status: "CURRENT", progress: 12, updatedAt: 1_790_000_000 }),
            entry(5, { status: "CURRENT", progress: 0, updatedAt: 1_000 }),
        ], { ...base, resumeLocations })
        expect(items.map(i => i.entry.mediaId)).toEqual([5, 1])
        expect(items[0].lastReadAt).toBe(NOW - 1000)

        const stale = { 5: { ...resumeLocations[5], updatedAt: NOW - MANGA_READER_RESUME_MAX_AGE_MS - 1 } }
        expect(getMangaContinueReading([entry(5, { status: "CURRENT", progress: 0 })], { ...base, resumeLocations: stale })).toEqual([])
    })

    it("uses the larger of AniList's chapter count and the source's newest chapter", () => {
        const [item] = getMangaContinueReading([entry(1, { status: "CURRENT", progress: 12, updatedAt: 1 }, 15)], base)
        expect(item.total).toBe(20)
    })

    it("caps the row", () => {
        const many = Array.from({ length: 20 }, (_, i) => entry(100 + i, { status: "CURRENT", progress: 1, updatedAt: i }))
        expect(getMangaContinueReading(many, { ...base, limit: 5 }).map(i => i.entry.mediaId)).toEqual([119, 118, 117, 116, 115])
    })
})

describe("continue reading target", () => {
    const unread = [{ id: "c13", provider: "p" }, { id: "c14", provider: "p" }]

    it("opens the saved chapter while it is unread on the selected source", () => {
        const resume = { chapterId: "c14", provider: "p", pageIndex: 6, updatedAt: NOW - 10 }
        expect(getMangaResumeChapter(unread, resume, "p", NOW)?.id).toBe("c14")
    })

    it("falls back to the first unread chapter otherwise", () => {
        const resume = { chapterId: "c14", provider: "p", pageIndex: 6, updatedAt: NOW - 10 }
        expect(getMangaResumeChapter(unread, resume, "other", NOW)).toBeUndefined()
        expect(getMangaResumeChapter(unread, { ...resume, chapterId: "c2" }, "p", NOW)).toBeUndefined()
        expect(getMangaResumeChapter(unread, { ...resume, pageIndex: -1 }, "p", NOW)).toBeUndefined()
        expect(getMangaResumeChapter(unread, { ...resume, updatedAt: NOW - MANGA_READER_RESUME_MAX_AGE_MS - 1 }, "p", NOW)).toBeUndefined()
        expect(getMangaResumeChapter(unread, undefined, "p", NOW)).toBeUndefined()
    })

    it("acts on a continue intent only for its manga and only while fresh", () => {
        const intent = { mediaId: 117460, at: NOW }
        expect(isMangaContinueIntentFor(intent, "117460", NOW + 500)).toBe(true)
        expect(isMangaContinueIntentFor(intent, 1, NOW + 500)).toBe(false)
        expect(isMangaContinueIntentFor(intent, "117460", NOW + MANGA_CONTINUE_INTENT_MAX_AGE_MS + 1)).toBe(false)
        expect(isMangaContinueIntentFor(intent, null, NOW)).toBe(false)
        expect(isMangaContinueIntentFor(null, "117460", NOW)).toBe(false)
    })
})
