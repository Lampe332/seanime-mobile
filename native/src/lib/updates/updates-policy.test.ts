import { type AppLanguage, translate } from "@/lib/app-language"
import { describe, expect, it } from "vitest"
import {
    chapterItems,
    chapterNotice,
    dayKey,
    dayLabel,
    dueCandidates,
    episodeUpdates,
    fallbackProvider,
    groupByDay,
    highestChapter,
    listStatuses,
    mangaCandidates,
    mergeFeed,
    newChapterNumbers,
    newCount,
    sinceOf,
    UPDATES_WINDOW_MS,
    updatesSubtitle,
    updatesView,
} from "./updates-policy"

const HOUR = 3600_000
const now = Date.parse("2026-11-15T12:00:00Z")

describe("episodes", () => {
    const collection = {
        MediaListCollection: {
            lists: [
                { status: "CURRENT", entries: [{ status: "CURRENT", media: { id: 1 } }] },
                { status: "PLANNING", entries: [{ status: "PLANNING", media: { id: 2 } }] },
                { status: "COMPLETED", entries: [{ status: "COMPLETED", media: { id: 3 } }] },
            ],
        },
    }
    const iso = (at: number) => new Date(at).toISOString()

    it("lists aired episodes of Watching and Planning anime in the window, not completed ones or future ones", () => {
        const schedule = [
            { mediaId: 1, title: "A", episodeNumber: 5, dateTime: iso(now - 2 * HOUR) },
            { mediaId: 2, title: "B", episodeNumber: 1, dateTime: iso(now - 30 * HOUR) },
            { mediaId: 3, title: "C", episodeNumber: 9, dateTime: iso(now - HOUR) },
            { mediaId: 1, title: "A", episodeNumber: 6, dateTime: iso(now + 5 * 24 * HOUR) },
            { mediaId: 1, title: "A", episodeNumber: 4, dateTime: iso(now - UPDATES_WINDOW_MS - HOUR) },
            { mediaId: 9, title: "not on a list", episodeNumber: 1, dateTime: iso(now - HOUR) },
        ]
        const items = episodeUpdates(schedule, listStatuses(collection), now)
        expect(items.map(item => item.key)).toEqual(["e-1-5", "e-2-1"])
        expect(items[0]).toMatchObject({ kind: "episode", mediaId: 1, number: 5, at: now - 2 * HOUR })
    })
})

describe("chapters", () => {
    const list = (...chapters: string[]) => chapters.map(chapter => ({ chapter }))

    it("takes a manga's first list as the baseline: nothing new", () => {
        expect(newChapterNumbers(undefined, list("1", "2", "3"))).toEqual([])
    })

    it("finds the chapters above the known one, once each, ascending, decimals as their whole chapter", () => {
        expect(newChapterNumbers(100, list("99", "100", "101", "101.5", "102", "Extra"))).toEqual([101, 102])
        expect(newChapterNumbers(102, list("101", "102"))).toEqual([])
        expect(highestChapter(list("Chapter 7", "8.5", "none"))).toBe(8)
    })

    it("keeps at most the newest 20 of a renumbered source", () => {
        const many = Array.from({ length: 50 }, (_, i) => String(i + 1))
        expect(newChapterNumbers(0, list(...many))).toEqual(Array.from({ length: 20 }, (_, i) => i + 31))
    })

    it("checks only Reading manga that still publish, with an installed source", () => {
        const lists = [
            {
                status: "CURRENT", entries: [
                    { mediaId: 1, media: { status: "RELEASING", title: { userPreferred: "One" }, coverImage: { large: "one.jpg" } } },
                    { mediaId: 2, media: { status: "FINISHED", title: { userPreferred: "Done" } } },
                    { mediaId: 3, media: { status: "HIATUS", title: { userPreferred: "Three" } } },
                    { mediaId: 4, media: { status: "RELEASING", title: { userPreferred: "Gone source" } } },
                ],
            },
            { status: "PLANNING", entries: [{ mediaId: 5, media: { status: "RELEASING" } }] },
        ]
        const installed = ["mangafire", "comick"]
        const candidates = mangaCandidates(lists, { 1: "comick", 4: "removed" }, installed, "mangafire")
        expect(candidates).toEqual([
            { mediaId: 1, title: "One", image: "one.jpg", provider: "comick" },
            { mediaId: 3, title: "Three", image: undefined, provider: "mangafire" },
            { mediaId: 4, title: "Gone source", image: undefined, provider: "mangafire" },
        ])
        expect(mangaCandidates(lists, {}, [], null)).toEqual([])
    })

    it("falls back to the default source, else the first by name, never the local one", () => {
        const installed = [{ id: "local-manga", name: "Local" }, { id: "weebcentral", name: "WeebCentral" }, { id: "mangafire", name: "MangaFire" }]
        expect(fallbackProvider(installed, "weebcentral")).toBe("weebcentral")
        expect(fallbackProvider(installed, "missing")).toBe("mangafire")
        expect(fallbackProvider([{ id: "local-manga" }], null)).toBeNull()
    })

    it("checks the longest unchecked manga first, a few per run, skipping recent checks", () => {
        const candidates = [{ mediaId: 1 }, { mediaId: 2 }, { mediaId: 3 }, { mediaId: 4 }]
        const checked = { 1: now - 5 * HOUR, 2: now - HOUR, 3: now - 10 * HOUR }
        expect(dueCandidates(candidates, checked, now, 3 * HOUR, 2).map(c => c.mediaId)).toEqual([4, 3])
        expect(dueCandidates(candidates, checked, now, 3 * HOUR, 10).map(c => c.mediaId)).toEqual([4, 3, 1])
        // a clock set back counts as due
        expect(dueCandidates([{ mediaId: 1 }], { 1: now + HOUR }, now, 3 * HOUR, 1)).toHaveLength(1)
    })

    it("keeps the first find of a chapter, drops old ones, newest first", () => {
        const manga = { mediaId: 7, title: "Seven" }
        const first = chapterItems(manga, [10], now - 2 * HOUR)
        const again = chapterItems(manga, [10, 11], now)
        const old = chapterItems(manga, [1], now - 40 * 24 * HOUR)
        const feed = mergeFeed([...first, ...old], again, now)
        expect(feed.map(item => [item.key, item.at])).toEqual([["c-7-11", now], ["c-7-10", now - 2 * HOUR]])
    })

    it("words the notification in the app language", () => {
        const notice = (language: AppLanguage, numbers: number[]) => chapterNotice("One Piece", numbers, (en, de) => translate(language, en, de))
        expect(notice("en", [1130])).toBe("New chapter: One Piece Ch. 1130")
        expect(notice("en", [1129, 1130])).toBe("New chapters: One Piece Ch. 1129–1130")
        expect(notice("de", [1130])).toBe("Neues Kapitel: One Piece Kap. 1130")
        expect(notice("fr", [1130])).toBe("Nouveau chapitre : One Piece ch. 1130")
        expect(notice("ru", [1129, 1130])).toBe("Новые главы: One Piece, гл. 1129–1130")
        expect(notice("ja", [1130])).toBe("新しいチャプター：One Piece 第1130話")
    })
})

describe("since your last visit", () => {
    it("counts what is newer than the last visit; the first visit looks back one window", () => {
        const items = [
            ...chapterItems({ mediaId: 1, title: "A" }, [5], now - HOUR),
            ...chapterItems({ mediaId: 2, title: "B" }, [3], now - 3 * 24 * HOUR),
        ]
        expect(newCount(items, sinceOf(now - 2 * HOUR, now))).toBe(1)
        expect(newCount(items, sinceOf(0, now))).toBe(2)
        expect(newCount(items, sinceOf(now, now))).toBe(0)
    })

    it("groups by local day, newest day first", () => {
        const a = new Date(2026, 10, 15, 9).getTime()
        const b = new Date(2026, 10, 15, 20).getTime()
        const c = new Date(2026, 10, 13, 12).getTime()
        const items = [
            ...chapterItems({ mediaId: 1, title: "A" }, [1], a),
            ...chapterItems({ mediaId: 2, title: "B" }, [2], c),
            ...chapterItems({ mediaId: 3, title: "C" }, [3], b),
        ]
        expect(groupByDay(items).map(group => [group.day, group.items.map(item => item.mediaId)])).toEqual([
            ["2026-11-15", [3, 1]],
            ["2026-11-13", [2]],
        ])
    })
})

describe("day headings", () => {
    it("follow the app's language, not the device's", () => {
        const now = new Date(2026, 10, 15, 12).getTime()
        expect(dayLabel(dayKey(now), now, "en")).toBe("Today")
        expect(dayLabel(dayKey(now), now, "de")).toBe("Heute")
        expect(dayLabel("2026-11-14", now, "en")).toBe("Yesterday")
        expect(dayLabel("2026-11-14", now, "de")).toBe("Gestern")
        expect(dayLabel("2026-11-13", now, "en")).toBe("Friday, November 13")
        expect(dayLabel("2026-11-13", now, "de")).toBe("Freitag, 13. November")
        expect(dayLabel("2026-11-13", now, "zh-Hans")).toBe("11月13日星期五")
    })
})

describe("page state", () => {
    it("a failed load shows the failure, not the empty week", () => {
        expect(updatesView({ count: 0, loading: false, failed: true })).toEqual({ body: "failed", notice: false })
        expect(updatesView({ count: 0, loading: false, failed: false })).toEqual({ body: "empty", notice: false })
    })

    it("loading and retrying show bones until something is there", () => {
        expect(updatesView({ count: 0, loading: true, failed: false }).body).toBe("loading")
        expect(updatesView({ count: 0, loading: true, failed: true }).body).toBe("loading")
    })

    it("items stay on screen; a failed part adds a notice", () => {
        expect(updatesView({ count: 3, loading: false, failed: false })).toEqual({ body: "list", notice: false })
        expect(updatesView({ count: 3, loading: false, failed: true })).toEqual({ body: "list", notice: true })
        expect(updatesView({ count: 3, loading: true, failed: true })).toEqual({ body: "list", notice: false })
    })
})

describe("updatesSubtitle", () => {
    const en = (english: string, german: string) => translate("en", english, german)
    const de = (english: string, german: string) => translate("de", english, german)
    it("matches the list: new ones counted, older ones not called nothing", () => {
        expect(updatesSubtitle(en, 5, 2)).toBe("2 new since your last visit")
        expect(updatesSubtitle(en, 5, 0)).toBe("5 updates · none new since your last visit")
        expect(updatesSubtitle(en, 1, 0)).toBe("1 update · none new since your last visit")
        expect(updatesSubtitle(de, 3, 0)).toBe("3 Updates · nichts Neues seit deinem letzten Besuch")
        expect(updatesSubtitle(en, 0, 0)).toBe("Nothing new since your last visit")
    })
})
