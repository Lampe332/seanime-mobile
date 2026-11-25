import { describe, expect, it } from "vitest"
import { getWrappedView, WrappedAnime, WrappedAnimeList, WrappedMangaList, wrappedUndated, wrappedYears } from "./wrapped"

type Entry = NonNullable<WrappedAnimeList["entries"]>[number]
type Date3 = { year?: number, month?: number, day?: number }

/** 2024-06-01 and 2023-06-01, 00:00 UTC, in seconds */
const IN_2024 = 1717200000
const IN_2023 = 1685577600

let nextEntry = 1
function anime(id: number, media: Partial<WrappedAnime>, entry: Partial<Omit<Entry, "media" | "id">> & { completedAt?: Date3 }): Entry {
    return {
        id: nextEntry++,
        status: "COMPLETED",
        progress: 0,
        score: 0,
        ...entry,
        media: { id, title: { userPreferred: `Anime ${id}`, romaji: `Romaji ${id}` }, coverImage: { large: `l${id}`, medium: `m${id}`, color: "#fff" }, ...media },
    }
}

const a1 = anime(1, { episodes: 12, duration: 24, genres: ["Action", "Drama"], format: "TV", studios: { nodes: [{ id: 1, name: "Bones" }] } },
    { progress: 12, score: 90, completedAt: { year: 2024, month: 3, day: 10 } })
/** old saved format: no studios field, no duration */
const a2 = anime(2, { episodes: 25, genres: ["Action"], format: "TV" }, { score: 90, completedAt: { year: 2024, month: 3, day: 20 } })
/** no completion date: counted in no year, only as undated (updatedAt is no stand-in) */
const a3 = anime(3, { episodes: 1, duration: 100, genres: ["Comedy"], format: "MOVIE", studios: { nodes: [{ id: 1, name: "Bones" }, { id: 2, name: "MAPPA" }] } },
    { progress: 1, updatedAt: IN_2024 })
const a4 = anime(4, { episodes: 12, duration: 24, genres: ["Drama"], format: "TV", studios: { nodes: [null, { id: 2, name: "MAPPA" }] } },
    { status: "REPEATING", progress: 3, score: 70, completedAt: { year: 2024, month: 11, day: 5 } })
const a5 = anime(5, { episodes: 10, format: "TV" }, { progress: 10, score: 60, completedAt: { year: 2023, month: 5, day: 1 } })
const a6 = anime(6, { episodes: 2, isAdult: true, format: "OVA" }, { progress: 2, score: 100, completedAt: { year: 2024, month: 7, day: 1 } })
const a7 = anime(7, { episodes: 24, duration: 20 }, { status: "CURRENT", progress: 5, startedAt: { year: 2024, month: 2, day: 1 } })
const a8 = anime(8, { episodes: 24 }, { status: "PAUSED", progress: 4, startedAt: { year: 2023, month: 2, day: 1 } })
const a9 = anime(9, { episodes: 24 }, { status: "REPEATING", progress: 4, updatedAt: IN_2024 })

const animeLists = [
    { status: "COMPLETED", entries: [a1, a2, a3, a4, a5, a6, a9, null as unknown as Entry, { id: 99, media: null } as unknown as Entry] },
    { status: "CURRENT", entries: [a7, a8] },
    { name: "Favourites", isCustomList: true, entries: [{ ...a1, id: 500 }, { ...a4, id: 501 }] },
    null,
] as WrappedAnimeList[]

const manga = (id: number, progress: number, chapters: number | undefined, completedAt: Date3) =>
    ({ id: nextEntry++, status: "COMPLETED", progress, completedAt, media: { id, chapters, title: { userPreferred: `Manga ${id}` } } })
const mangaLists = [
    { entries: [manga(101, 50, 60, { year: 2024, month: 1, day: 1 }), manga(102, 0, 10, { year: 2024 }), manga(103, 30, 30, { year: 2023 })] },
    { isCustomList: true, entries: [manga(101, 50, 60, { year: 2024, month: 1, day: 1 })] },
] as WrappedMangaList[]

const hideAdult = { showAdult: false }

describe("wrappedYears", () => {
    it("lists every year with a finished anime, newest first, adult titles only when shown", () => {
        expect(wrappedYears(animeLists, mangaLists)).toEqual([2024, 2023])
        const adultOnly = [{ entries: [anime(20, { isAdult: true }, { completedAt: { year: 2021 } })] }] as WrappedAnimeList[]
        expect(wrappedYears(adultOnly, null)).toEqual([])
        expect(wrappedYears(adultOnly, null, { showAdult: true })).toEqual([2021])
        expect(wrappedYears(undefined, undefined)).toEqual([])
    })
})

describe("getWrappedView", () => {
    const view = getWrappedView(animeLists, mangaLists, 2024, hideAdult)

    it("counts each finished title of the year once, only by its completion date", () => {
        expect(view.titles).toBe(3)
        expect(view.empty).toBe(false)
        expect(view.years).toEqual([2024, 2023])
        expect(view.formats.find(f => f.name === "MOVIE")).toBeUndefined()
        const lateUpdate = [{ entries: [anime(30, {}, { updatedAt: IN_2023 }), anime(31, {}, { completedAt: { year: 2024 }, updatedAt: IN_2023 })] }] as WrappedAnimeList[]
        expect(getWrappedView(lateUpdate, null, 2024, hideAdult).titles).toBe(1)
        expect(getWrappedView(lateUpdate, null, 2023, hideAdult).empty).toBe(true)
        expect(wrappedYears(lateUpdate, null)).toEqual([2024])
    })

    it("counts the finished titles without a completion date, each once, in any year", () => {
        expect(view.undated).toBe(1)
        expect(getWrappedView(animeLists, mangaLists, 2020, hideAdult).undated).toBe(1)
        const imported = [
            { entries: [anime(32, {}, { updatedAt: IN_2024 }), anime(33, { isAdult: true }, {}), anime(34, {}, { status: "REPEATING" })] },
            { isCustomList: true, entries: [anime(32, {}, { updatedAt: IN_2024 })] },
        ] as WrappedAnimeList[]
        expect(wrappedYears(imported, null)).toEqual([])
        expect(wrappedUndated(imported)).toBe(1)
        expect(wrappedUndated(imported, { showAdult: true })).toBe(2)
        expect(wrappedUndated(undefined)).toBe(0)
    })

    it("shows adult titles only when asked", () => {
        const adult = getWrappedView(animeLists, null, 2024, { showAdult: true })
        expect(adult.titles).toBe(4)
        expect(adult.topRated[0]).toMatchObject({ id: 6, adult: true })
        expect(view.topRated.some(t => t.id === 6)).toBe(false)
        // the page shows it, the shared image never names it
        expect(adult.shareable.map(t => t.id)).toEqual([2, 1, 4])
    })

    it("leaves private entries in the counts and the page but out of the shared image's names", () => {
        const lists = [{ entries: [
            anime(90, { episodes: 12 }, { private: true, progress: 12, score: 100, completedAt: { year: 2024, month: 1, day: 1 } }),
            ...[91, 92, 93, 94].map(n => anime(n, { episodes: 1 }, { progress: 1, score: n - 10, completedAt: { year: 2024, month: 2, day: 1 } })),
        ] }] as WrappedAnimeList[]
        const year = getWrappedView(lists, null, 2024, hideAdult)
        expect(year.titles).toBe(5)
        expect(year.episodes).toBe(16)
        expect(year.topRated[0]).toMatchObject({ id: 90, private: true })
        expect(year.shareable.map(t => t.id)).toEqual([94, 93, 92])
    })

    it("adds the episodes and minutes of finished titles and of titles started in the year", () => {
        // 12 + 25 (no progress: all episodes) + 12 (a rewatch: the whole title, not its 3 so far), plus 5 of the running title started in 2024
        expect(view.episodes).toBe(54)
        // 12*24 + 25*24 (no duration) + 12*24 + 5*20
        expect(view.minutes).toBe(1276)
        expect(view.meanScore).toBe(83)
        const rewatch = [{ entries: [anime(95, {}, { status: "REPEATING", progress: 2, completedAt: { year: 2024 } })] }] as WrappedAnimeList[]
        expect(getWrappedView(rewatch, null, 2024, hideAdult).episodes).toBe(2)
    })

    it("counts genres, studios and formats, most first, ties by name", () => {
        expect(view.genres).toEqual([{ name: "Action", count: 2, share: 2 / 3 }, { name: "Drama", count: 2, share: 2 / 3 }])
        expect(view.studios).toEqual([{ name: "Bones", count: 1, share: 1 / 3 }, { name: "MAPPA", count: 1, share: 1 / 3 }])
        expect(view.formats).toEqual([{ name: "TV", count: 3, share: 1 }])
        const many = [{ entries: [anime(40, { genres: ["F", "E", "D", "C", "B", "A", "A"] }, { completedAt: { year: 2024 } })] }] as WrappedAnimeList[]
        expect(getWrappedView(many, null, 2024, hideAdult).genres.map(g => g.name)).toEqual(["A", "B", "C", "D", "E"])
    })

    it("lives with lists saved before the studios came", () => {
        const old = [{ entries: [anime(50, { genres: ["Action"] }, { completedAt: { year: 2024, month: 1, day: 2 } })] }] as WrappedAnimeList[]
        const result = getWrappedView(old, null, 2024, hideAdult)
        expect(result.studios).toEqual([])
        expect(result.titles).toBe(1)
    })

    it("ranks the best rated, the later finish first on a tie", () => {
        expect(view.topRated.map(t => t.id)).toEqual([2, 1, 4])
        expect(view.topRated[0]).toEqual({ id: 2, title: "Anime 2", cover: "l2", color: "#fff", score: 90, episodes: 25, completed: "2024-03-20", format: "TV" })
        const six = [{ entries: [1, 2, 3, 4, 5, 6].map(n => anime(60 + n, {}, { score: 50 + n, completedAt: { year: 2024 } })) }] as WrappedAnimeList[]
        expect(getWrappedView(six, null, 2024, hideAdult).topRated.map(t => t.score)).toEqual([56, 55, 54, 53, 52])
    })

    it("counts the months and picks the busiest, the earlier on a tie", () => {
        expect(view.months).toEqual([0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 1, 0])
        expect(view.busiestMonth).toBe(2)
        const tie = [{ entries: [anime(70, {}, { completedAt: { year: 2024, month: 5 } }), anime(71, {}, { completedAt: { year: 2024, month: 2 } })] }] as WrappedAnimeList[]
        expect(getWrappedView(tie, null, 2024, hideAdult).busiestMonth).toBe(1)
    })

    it("names the first, last and longest title", () => {
        expect(view.first?.id).toBe(1)
        expect(view.last?.id).toBe(4)
        expect(view.longest?.id).toBe(2)
        expect(view.first?.completed).toBe("2024-03-10")
    })

    it("counts the finished manga, or none", () => {
        expect(view.manga).toEqual({ titles: 2, chapters: 60 })
        expect(getWrappedView(animeLists, null, 2024, hideAdult).manga).toBeNull()
        expect(getWrappedView(animeLists, mangaLists, 2022, hideAdult).manga).toBeNull()
    })

    it("gives an empty year", () => {
        const empty = getWrappedView(animeLists, mangaLists, 2020, hideAdult)
        expect(empty).toMatchObject({ empty: true, titles: 0, episodes: 0, minutes: 0, meanScore: null, busiestMonth: null, genres: [], studios: [], formats: [], topRated: [], shareable: [], manga: null })
        expect(empty.months).toEqual(Array(12).fill(0))
        expect(empty.first).toBeUndefined()
        expect(empty.years).toEqual([2024, 2023])
        expect(getWrappedView(undefined, undefined, 2024, hideAdult).empty).toBe(true)
    })

    it("uses titleOf and the title fallbacks, and leaves the lists as they were", () => {
        const before = JSON.stringify(animeLists)
        const named = getWrappedView(animeLists, mangaLists, 2024, { showAdult: false, titleOf: media => `#${media.id}` })
        expect(named.first?.title).toBe("#1")
        const romaji = [{ entries: [anime(80, { title: { romaji: "Only Romaji" }, coverImage: { extraLarge: "xl" } }, { completedAt: { year: 2024, month: 1, day: 1 } })] }] as WrappedAnimeList[]
        const fallback = getWrappedView(romaji, null, 2024, hideAdult)
        expect(fallback.first).toMatchObject({ title: "Only Romaji", cover: "xl", score: 0, episodes: 0 })
        expect(fallback.longest).toBeUndefined()
        expect(fallback.topRated).toEqual([])
        expect(JSON.stringify(animeLists)).toBe(before)
    })
})
