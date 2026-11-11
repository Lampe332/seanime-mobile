import type { AL_BaseManga } from "@/api/generated/types"
import { describe, expect, it } from "vitest"
import { groupMangaDownloads, mangaDownloadChapterItems, mangaDownloadRows, mangaNextDelay, readyChapters } from "./manga-downloads"

const manga = (id: number, title: string) => ({ id, title: { userPreferred: title } }) as AL_BaseManga

describe("manga chapter downloads", () => {
    it("lists saved and queued chapters of a manga", () => {
        expect(mangaDownloadChapterItems({ downloaded: { src: [{ chapterId: "a", chapterNumber: "1" }] }, queued: { src: [{ chapterId: "b", chapterNumber: "2" }] } }))
            .toEqual([
                { provider: "src", chapterId: "a", chapterNumber: "1", queued: false, downloaded: true },
                { provider: "src", chapterId: "b", chapterNumber: "2", queued: true, downloaded: false },
            ])
        expect(mangaDownloadChapterItems(undefined)).toEqual([])
    })

    it("groups by manga with queued ones, by title, and fills in a known title", () => {
        const groups = groupMangaDownloads(
            [{ mediaId: 2, media: manga(2, "Zeta"), downloadData: { src: [{ chapterId: "a", chapterNumber: "1" }] } }],
            [{ mediaId: 1, provider: "src", chapterId: "x", chapterNumber: "3", status: "queued" }],
            { 1: manga(1, "Alpha") },
        )
        expect(groups.map(g => g.mediaId)).toEqual([1, 2])
        expect(groups[0].queued).toHaveLength(1)
    })

    it("keeps a chapter that is still in the queue out of the ready ones and sorts the rows", () => {
        const [group] = groupMangaDownloads(
            [{ mediaId: 1, downloadData: { src: [{ chapterId: "a", chapterNumber: "10" }, { chapterId: "b", chapterNumber: "2" }] } }],
            [{ mediaId: 1, provider: "src", chapterId: "a", chapterNumber: "10", status: "downloading" }],
        )
        expect(readyChapters(group).map(c => c.chapterId)).toEqual(["b"])
        expect(mangaDownloadRows(group).map(r => [r.chapterNumber, r.status])).toEqual([["2", "ready"], ["10", "downloading"]])
    })

    it("polls quickly while one loads, once more after the queue empties, then idles", () => {
        expect(mangaNextDelay([{ status: "downloading" }], false)).toBe(2000)
        expect(mangaNextDelay([{ status: "queued" }], false)).toBe(5000)
        expect(mangaNextDelay([{ status: "errored" }], false)).toBeNull()
        expect(mangaNextDelay([], true)).toBe(2000)
        expect(mangaNextDelay([], false)).toBeNull()
    })
})
