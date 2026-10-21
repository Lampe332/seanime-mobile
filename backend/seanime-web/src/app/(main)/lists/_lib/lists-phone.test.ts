import { AL_AnimeStats, AL_MangaStats } from "@/api/generated/types"
import { COLLECTION_SORTING_OPTIONS, DEFAULT_COLLECTION_PARAMS, filterListEntries } from "@/lib/helpers/filtering"
import { describe, expect, it } from "vitest"
import {
    airedEpisodes,
    countActiveFilters,
    countValues,
    EMPTY_LISTS_FILTERS,
    filterPhoneLists,
    formatIn,
    formatInSpoken,
    formatScore,
    genreFacet,
    getCardInfo,
    getListFacts,
    getListYears,
    getPhoneLists,
    getStatsView,
    getStatusTabs,
    getTagChips,
    LISTS_SORTING_OPTIONS,
    listDataOf,
    newEpisodes,
    orderedFacet,
    pickStatus,
    RELEASE_LABELS,
    RELEASE_STATUSES,
    scoreScale,
    searchPhoneLists,
    statusLabel,
    validSorting,
} from "./lists-phone"

const NOW = Date.UTC(2026, 9, 21, 12)
const DAY = 86_400_000
const en = (english: string) => english
const de = (_: string, german: string) => german

function anime(id: number, title: string, extra: Record<string, unknown> = {}) {
    return { id, title: { userPreferred: title, english: `${title} EN`, romaji: title }, synonyms: [], genres: [], status: "FINISHED", ...extra } as any
}
function entry(media: any, status: string, progress = 0, extra: Record<string, unknown> = {}) {
    return { id: media.id * 10, media, status, progress, score: 0, ...extra } as any
}

const raw = [
    { status: "COMPLETED", isCustomList: false, entries: [entry(anime(1, "Berserk", { genres: ["Action", "Drama"] }), "COMPLETED", 25, { score: 85 })] },
    { status: "CURRENT", isCustomList: false, entries: [
            entry(anime(2, "Overgeared", { status: "RELEASING", episodes: 12, format: "TV",
                nextAiringEpisode: { episode: 7, airingAt: (NOW + 2 * DAY) / 1000, timeUntilAiring: 0 } }), "CURRENT", 4),
            entry(anime(3, "Mushoku Tensei", { episodes: 14, genres: ["Drama"], format: "MOVIE" }), "CURRENT", 14),
            entry(anime(4, "Adult One", { isAdult: true }), "CURRENT", 1),
            { id: 99, media: null, status: "CURRENT" },
        ] },
    { status: "PLANNING", isCustomList: false, entries: [entry(anime(5, "Blue Lock", { status: "NOT_YET_RELEASED", season: "FALL", seasonYear: 2026 }), "PLANNING")] },
    { status: "DROPPED", isCustomList: false, entries: [] },
    { name: "Favourites", isCustomList: true, entries: [entry(anime(1, "Berserk", { genres: ["Action", "Drama"] }), "COMPLETED", 25, { score: 85 })] },
] as any[]

describe("phone lists", () => {
    it("orders status lists, then custom lists; drops entries without media and, unless allowed, adult ones", () => {
        const lists = getPhoneLists(raw, false)
        expect(lists.map(list => [list.key, list.entries.length])).toEqual([["CURRENT", 2], ["PLANNING", 1], ["COMPLETED", 1], ["DROPPED", 0], ["custom:Favourites", 1]])
        expect(getPhoneLists(raw, true)[0].entries.map(e => e.media!.id)).toEqual([2, 3, 4])
        expect(getPhoneLists(undefined, true)).toEqual([])
    })

    it("tabs only for lists with entries, counted after the filters, and keeps the choice while it has a tab", () => {
        const lists = getPhoneLists(raw, false)
        const filtered = filterPhoneLists("anime", lists, { ...EMPTY_LISTS_FILTERS, genres: ["Drama"] }, "SCORE_DESC", false, null)
        const tabs = getStatusTabs("anime", lists, filtered)
        expect(tabs.map(tab => [tab.value, tab.label[0], tab.count])).toEqual([["CURRENT", "Watching", 1], ["PLANNING", "Planning", 0], ["COMPLETED", "Completed", 1],
            ["custom:Favourites", "Favourites", 1]])
        expect(getStatusTabs("manga", lists, filtered)[0].label).toEqual(["Reading", "Lese ich"])
        expect(pickStatus("PLANNING", tabs)).toBe("PLANNING")
        expect(pickStatus("DROPPED", tabs)).toBe("CURRENT")
        expect(pickStatus("CURRENT", tabs.map(tab => ({ ...tab, count: tab.value === "COMPLETED" ? 1 : 0 })).slice(1))).toBe("COMPLETED")
        expect(pickStatus(null, [])).toBeNull()
    })

    it("filters like the desktop (AND genres, format, adult only while allowed) and searches every title", () => {
        const lists = getPhoneLists(raw, true)
        const current = (filters = EMPTY_LISTS_FILTERS, adult = true) =>
            filterPhoneLists("anime", lists, filters, "TITLE", adult, null)[0].entries.map(e => e.media!.id)
        expect(current({ ...EMPTY_LISTS_FILTERS, genres: ["Drama", "Action"] })).toEqual([])
        expect(current({ ...EMPTY_LISTS_FILTERS, format: "MOVIE" })).toEqual([3])
        expect(current({ ...EMPTY_LISTS_FILTERS, format: "TV" })).toEqual([2])
        // Manga have no anime formats: a format left from the anime list must not empty them.
        expect(filterPhoneLists("manga", lists, { ...EMPTY_LISTS_FILTERS, format: "MOVIE" }, "TITLE", true, null)[0].entries.map(e => e.media!.id))
            .toEqual([4, 3, 2])
        expect(current({ ...EMPTY_LISTS_FILTERS, adult: true })).toEqual([4])
        // With adult content off the switch cannot hide everything.
        expect(filterPhoneLists("anime", getPhoneLists(raw, false), { ...EMPTY_LISTS_FILTERS, adult: true }, "TITLE", false, null)[0].entries).toHaveLength(2)
        expect(current({ ...EMPTY_LISTS_FILTERS, status: "RELEASING" })).toEqual([2])
        const searched = searchPhoneLists(filterPhoneLists("anime", lists, EMPTY_LISTS_FILTERS, "TITLE", true, null), "  mushoku   tensei ")
        expect(searched[0].entries.map(e => e.media!.id)).toEqual([3])
        expect(searchPhoneLists(lists, "overgeared en")[0].entries.map(e => e.media!.id)).toEqual([2])
    })

    it("sorts Title (Z-A) from Z to A (shared fix) and keeps undated entries last when sorting by dates", () => {
        const entries = ["Alpha", "Charlie", "Bravo"].map((title, i) => entry(anime(i + 1, title), "COMPLETED"))
        const titles = (sorting: string) => filterListEntries("anime", entries, { ...DEFAULT_COLLECTION_PARAMS, sorting: sorting as any }, true)
            .map(e => e.media?.title?.userPreferred)
        expect(titles("TITLE")).toEqual(["Alpha", "Bravo", "Charlie"])
        expect(titles("TITLE_DESC")).toEqual(["Charlie", "Bravo", "Alpha"])

        const dated = [entry(anime(1, "Undated"), "COMPLETED"), entry(anime(2, "Old"), "COMPLETED", 0, { completedAt: { year: 2020, month: 1, day: 1 } }),
            entry(anime(3, "New"), "COMPLETED", 0, { completedAt: { year: 2025, month: 1, day: 1 } })]
        const list = [{ key: "COMPLETED", status: "COMPLETED", name: "COMPLETED", custom: false, entries: dated }]
        expect(filterPhoneLists("anime", list, EMPTY_LISTS_FILTERS, "END_DATE_DESC", true, null)[0].entries.map(e => e.media!.title!.userPreferred))
            .toEqual(["New", "Old", "Undated"])
    })

    it("offers the 16 desktop sorts with German labels and falls back to the highest score", () => {
        expect(LISTS_SORTING_OPTIONS.map(option => option.value)).toEqual(COLLECTION_SORTING_OPTIONS.map(option => option.value))
        expect(LISTS_SORTING_OPTIONS).toHaveLength(16)
        for (const option of LISTS_SORTING_OPTIONS) expect(option.de).not.toBe(option.en)
        expect(validSorting("TITLE_DESC")).toBe("TITLE_DESC")
        expect(validSorting("AIRDATE")).toBe("SCORE_DESC")
    })
})

describe("phone list cards", () => {
    const lists = getPhoneLists(raw, false)
    const [overgeared, mushoku] = lists[0].entries

    it("counts aired episodes from the next airing, or all of a finished show", () => {
        expect(airedEpisodes(overgeared.media as any, NOW)).toBe(6)
        expect(airedEpisodes(overgeared.media as any, NOW + 3 * DAY)).toBe(7)
        expect(airedEpisodes(anime(9, "x", { status: "FINISHED", episodes: 24 }), NOW)).toBe(24)
        expect(airedEpisodes(anime(9, "x", { status: "RELEASING" }), NOW)).toBeNull()
    })

    it("watching anime: bar, progress tag, new episodes of a running show and the next airing", () => {
        expect(getCardInfo("anime", overgeared, NOW)).toMatchObject({ progress: { value: 4, total: 12 }, tag: "4/12", fresh: 2, unwatched: 2,
            meta: { kind: "airing", episode: 7 }, canContinue: true })
        expect(getCardInfo("anime", mushoku, NOW)).toMatchObject({ tag: "14/14", fresh: 0, unwatched: 0, meta: { kind: "season" } })
        // A rewatch has episodes left, not new ones.
        const unknownTotal = entry(anime(8, "Long", { status: "RELEASING", nextAiringEpisode: { episode: 1101, airingAt: (NOW + DAY) / 1000 } }), "REPEATING", 1000)
        expect(getCardInfo("anime", unknownTotal, NOW)).toMatchObject({ progress: { value: 1000, total: 1100 }, tag: "1000/–", fresh: 0, unwatched: 100 })
    })

    it("new episodes only for running shows: a finished or never started show has episodes left", () => {
        const finished = entry(anime(9, "Done", { status: "FINISHED", episodes: 12 }), "CURRENT", 6)
        expect(getCardInfo("anime", finished, NOW)).toMatchObject({ fresh: 0, unwatched: 6, tag: "6/12" })
        expect(newEpisodes(finished.media, 6, NOW)).toBe(0)
        expect(newEpisodes(overgeared.media as any, 4, NOW)).toBe(2)
        expect(getCardInfo("anime", entry(anime(10, "Unstarted", { status: "FINISHED", episodes: 6 }), "CURRENT", 0), NOW)).toMatchObject({ fresh: 0, unwatched: 6 })
    })

    it("every scored title shows its score; running and upcoming titles say so in every list; manga show chapters once", () => {
        expect(getCardInfo("anime", lists[2].entries[0], NOW)).toMatchObject({ score: 8.5, meta: { kind: "season" }, canContinue: false })
        expect(getCardInfo("anime", lists[2].entries[0], NOW).tag).toBeUndefined()
        expect(getCardInfo("anime", lists[1].entries[0], NOW).meta).toEqual({ kind: "upcoming" })
        const paused = getCardInfo("anime", entry(anime(6, "Paused"), "PAUSED", 3, { score: 70 }), NOW)
        expect(paused).toMatchObject({ tag: "3/–", canContinue: true, score: 7 })
        expect(paused.progress).toBeUndefined()
        expect(getCardInfo("anime", entry(overgeared.media, "PLANNING"), NOW).meta).toMatchObject({ kind: "airing", episode: 7 })
        expect(getCardInfo("anime", entry(anime(11, "Airing", { status: "RELEASING" }), "DROPPED", 2), NOW)).toMatchObject({ meta: { kind: "releasing" }, tag: "2/–" })
        const manga = { id: 7, title: { userPreferred: "Overgeared" }, chapters: 344, status: "RELEASING" } as any
        const reading = getCardInfo("manga", entry(manga, "CURRENT", 12), NOW)
        expect(reading).toMatchObject({ progress: { value: 12, total: 344 }, meta: { kind: "chapters", progress: 12, total: 344 }, canContinue: false })
        expect(reading.tag).toBeUndefined()
        expect(getCardInfo("manga", entry(manga, "CURRENT", 0), NOW).meta).toEqual({ kind: "count", total: 344 })
        expect(getCardInfo("manga", entry(manga, "PAUSED", 30), NOW)).toMatchObject({ tag: "30/344", meta: { kind: "releasing" } })
    })

    it("header facts count each title once and the watched running shows with new episodes (manga: unread chapters)", () => {
        expect(getListFacts("anime", lists, NOW)).toEqual({ total: 4, current: 2, fresh: 1 })
        expect(getListFacts("manga", lists, NOW).fresh).toBe(0)
        expect(getListFacts("manga", lists, NOW, item => item.media!.id === 3 ? 5 : 0).fresh).toBe(1)
    })

    it("formats times, scores and list data like the desktop card", () => {
        expect([formatIn(en, 45 * 60_000), formatIn(en, 5 * 3_600_000), formatIn(de, 2 * DAY), formatIn(de, DAY), formatIn(en, 30_000)])
            .toEqual(["45 min", "5 h", "2 Tagen", "1 Tag", "1 min"])
        expect([formatInSpoken(en, 2 * DAY), formatInSpoken(de, 3_600_000), formatInSpoken(en, 60_000), formatInSpoken(de, 45 * 60_000)])
            .toEqual(["2 days", "1 Stunde", "1 minute", "45 Minuten"])
        expect([formatScore(en, 8.5), formatScore(de, 8.5), formatScore(en, 8)]).toEqual(["8.5", "8,5", "8"])
        expect(listDataOf(entry(anime(1, "a"), "COMPLETED", 3, { score: 70, startedAt: { year: 2024, month: 2 } })))
            .toMatchObject({ progress: 3, score: 70, status: "COMPLETED", startedAt: new Date(2024, 1, 1).toISOString(), completedAt: undefined })
    })

    it("names the release status apart from the list statuses in German", () => {
        const listNames = ["CURRENT", "REPEATING", "PLANNING", "PAUSED", "COMPLETED", "DROPPED"].map(status => statusLabel(status, "anime")[1])
        for (const status of RELEASE_STATUSES) expect(listNames).not.toContain(RELEASE_LABELS[status][1])
    })
})

describe("phone list filter sheet", () => {
    const lists = getPhoneLists(raw, true)

    it("counts values of the shown list, keeps chosen ones and orders fixed chips, values with hits first", () => {
        const genres = countValues(lists, "CURRENT", media => media.genres ?? [])
        expect(genreFacet(genres, ["Comedy"])).toEqual([{ value: "Drama", count: 1 }, { value: "Action", count: 0 }, { value: "Comedy", count: 0 }])
        const releases = countValues(lists, "CURRENT", media => [media.status])
        expect(orderedFacet(releases, RELEASE_STATUSES, "HIATUS").map(chip => chip.value)).toEqual(["FINISHED", "RELEASING", "NOT_YET_RELEASED", "HIATUS"])
        expect(getListYears("anime", lists)).toEqual(["2026"])
    })

    it("tags: chosen first, then by count, adult ones only when allowed, 24 until expanded", () => {
        const counts = new Map<string, number>([["Isekai", 3], ["Bondage", 9], ["Magic", 5], ...Array.from({ length: 30 }, (_, i) => [`Tag ${i}`, 1] as [string, number])])
        const plain = getTagChips(counts, ["Tag 7"], { adult: false, query: "", expanded: false })
        expect(plain.chips.slice(0, 3).map(chip => chip.value)).toEqual(["Tag 7", "Magic", "Isekai"])
        expect(plain.chips).toHaveLength(24)
        expect(plain.total).toBe(32)
        expect(plain.available).toBe(32)
        expect(getTagChips(counts, [], { adult: true, query: "", expanded: true }).chips[0].value).toBe("Bondage")
        expect(getTagChips(counts, [], { adult: false, query: "mag", expanded: false }).chips.map(chip => chip.value)).toEqual(["Magic"])
    })

    it("counts active filters per genre and tag", () => {
        expect(countActiveFilters("anime", { ...EMPTY_LISTS_FILTERS, genres: ["A", "B"], format: "TV", adult: true }, false)).toBe(3)
        expect(countActiveFilters("manga", { ...EMPTY_LISTS_FILTERS, format: "TV", season: "FALL", year: "2020" }, true)).toBe(1)
    })
})

describe("phone list stats", () => {
    const animeStats = {
        count: 10, minutesWatched: 60 * 24 * 41, episodesWatched: 400, meanScore: 78.5,
        scores: [{ score: 80, count: 4 }, { score: 100, count: 1 }, { score: 0, count: 3 }],
        statuses: [{ status: "PLANNING", count: 2 }, { status: "COMPLETED", count: 6 }, { status: "CURRENT", count: 2 }],
        genres: [{ genre: "Drama", count: 3, minutesWatched: 600, meanScore: 80 }, { genre: "Action", count: 7, minutesWatched: 1200, meanScore: 75 }],
        formats: [{ format: "MOVIE", count: 1, minutesWatched: 120 }, { format: "TV", count: 9, minutesWatched: 5000 }],
        startYears: [{ startYear: 2025, count: 4 }, { startYear: 2026, count: 6 }],
        releaseYears: Array.from({ length: 14 }, (_, i) => ({ releaseYear: 2000 + i, count: i + 1 })),
        studios: [{ studio: { id: 1, name: "MAPPA" }, count: 2, meanScore: 81 }],
    } as unknown as AL_AnimeStats

    it("uses the desktop math for facts and highlights", () => {
        const view = getStatsView("anime", animeStats, 2026)
        expect(view).toMatchObject({ count: 10, episodes: 400, thisYear: 6, lastYear: 4, modeScore: { score: 8, count: 4 },
            completion: { rate: 75, completed: 6, started: 8 }, topGenre: { genre: "Action", count: 7 }, peakYear: { year: 2026, count: 6 } })
    })

    it("ranks bars: scores high to low, statuses in desktop order, top 12 release years newest first", () => {
        const view = getStatsView("anime", animeStats, 2026)
        expect(view.scores.map(row => [row.key, row.score, row.ratio])).toEqual([["100", 10, 0.25], ["80", 8, 1]])
        expect(view.statuses.map(row => row.key)).toEqual(["CURRENT", "COMPLETED", "PLANNING"])
        expect(view.formats.map(row => row.key)).toEqual(["TV", "MOVIE"])
        expect(view.releaseYears.map(row => row.key)).toEqual(Array.from({ length: 12 }, (_, i) => String(2013 - i)))
        expect(view.studios[0]).toMatchObject({ key: "1", label: "MAPPA", count: 2 })
        const manga = getStatsView("manga", { count: 3, chaptersRead: 120, meanScore: 0 } as AL_MangaStats, 2026)
        expect(manga).toMatchObject({ chapters: 120, formats: [], studios: [], completion: null, thisYear: null })
    })

    it("reads the score scale once per list: a 100-point 10 (1/10) stays apart from 100 (10/10)", () => {
        const scores = [{ score: 100, count: 5 }, { score: 10, count: 2 }, { score: 80, count: 3 }]
        const view = getStatsView("anime", { ...animeStats, scores } as unknown as AL_AnimeStats, 2026)
        expect(view.scores.map(row => [row.key, row.score])).toEqual([["100", 10], ["80", 8], ["10", 1]])
        expect(new Set(view.scores.map(row => row.key)).size).toBe(3)
        expect(view.modeScore).toEqual({ score: 10, count: 5 })
        expect([scoreScale(scores), scoreScale([{ score: 7 }, { score: 10 }])]).toEqual([10, 1])
    })
})
