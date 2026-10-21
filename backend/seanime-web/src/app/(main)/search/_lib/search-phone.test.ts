import { AL_BaseAnime, AL_BaseManga } from "@/api/generated/types"
import { describe, expect, it } from "vitest"
import {
    clearSearchFilters,
    listStatusLabel,
    nextSearchPage,
    removeSearchFilter,
    resultCardFacts,
    SEARCH_DEFAULTS,
    searchAnnouncement,
    searchFilterChips,
    searchParamsKey,
    SearchPhoneState,
    searchStateFromParams,
    searchStatuses,
    searchTagChoices,
    searchTitle,
    searchVariables,
    searchYears,
    switchSearchType,
    uniqueMedia,
    unseenCount,
    withSearchFilters,
} from "./search-phone"

const en = (english: string) => english
const de = (_: string, german: string) => german
const params = (query: string) => new URLSearchParams(query)
const state = (patch: Partial<SearchPhoneState>): SearchPhoneState => ({ ...SEARCH_DEFAULTS, ...patch })

describe("phone search: links", () => {
    it("reads the links that point here, as the desktop page does", () => {
        expect(searchStateFromParams(params("type=manga"), false)).toEqual(state({ type: "manga" }))
        expect(searchStateFromParams(params("genre=Action&sorting=TRENDING_DESC&format=MANGA"), false))
            .toEqual(state({ type: "manga", sort: "TRENDING_DESC", genres: ["Action"] }))
        expect(searchStateFromParams(params("sorting=SCORE_DESC&format=TV&season=FALL&year=2024"), false))
            .toEqual(state({ format: "TV", season: "FALL", year: 2024 }))
        expect(searchStateFromParams(params("type=manga&sorting=TRENDING_DESC&country=JP&genre=Drama"), false))
            .toEqual(state({ type: "manga", sort: "TRENDING_DESC", country: "JP", genres: ["Drama"] }))
        expect(searchStateFromParams(params("sorting=TRENDING_DESC&status=NOT_YET_RELEASED"), false))
            .toEqual(state({ sort: "TRENDING_DESC", status: "NOT_YET_RELEASED" }))
    })

    it("normalises case, numbers, lists and values the type cannot use", () => {
        const read = searchStateFromParams(params("season=fall&year=2024&status=releasing&genre=action,slice of life&tags=isekai, Time Skip&q=  frieren "), false)
        expect(read).toMatchObject({ season: "FALL", year: 2024, status: "RELEASING", genres: ["Action", "Slice of Life"], tags: ["Isekai", "Time Skip"], title: "frieren" })
        expect(searchStateFromParams(params("year=soon&status=done&sorting=RANDOM"), false)).toMatchObject({ year: null, status: null, sort: "SCORE_DESC" })
        expect(searchStateFromParams(params("type=manga&season=FALL&format=TV&sorting=EPISODES_DESC"), false))
            .toMatchObject({ type: "manga", season: null, format: null, sort: "CHAPTERS_DESC" })
        expect(searchStateFromParams(params("country=KR&sorting=CHAPTERS_DESC"), false)).toMatchObject({ type: "anime", country: null, sort: "EPISODES_DESC" })
        // A manga format other than MANGA means manga too (the desktop searched anime and found nothing)
        expect(searchStateFromParams(params("sorting=SCORE_DESC&format=ONE_SHOT"), false)).toMatchObject({ type: "manga", format: "ONE_SHOT" })
    })

    it("keeps adult tags and the Hentai genre usable only where the server allows adult titles", () => {
        expect(searchStateFromParams(params("tags=Bondage,Isekai"), false).tags).toEqual(["Isekai"])
        expect(searchStateFromParams(params("genre=Hentai&tags=Bondage"), true)).toMatchObject({ adult: true, genres: ["Hentai"], tags: ["Bondage"] })
        expect(searchStateFromParams(params("genre=Hentai"), false)).toMatchObject({ adult: false, genres: ["Hentai"] })
    })

    it("compares arrivals by the params that matter", () => {
        expect(searchParamsKey(params("foo=1"))).toBe("")
        expect(searchParamsKey(params("sorting=SCORE_DESC&foo=1&year=2024"))).toBe("sorting=SCORE_DESC&year=2024")
        expect(searchParamsKey(params("year=2024&sorting=SCORE_DESC"))).toBe(searchParamsKey(params("sorting=SCORE_DESC&year=2024")))
    })
})

describe("phone search: state", () => {
    it("resets what the other type cannot use when switching", () => {
        const anime = state({ title: "fate", sort: "EPISODES_DESC", genres: ["Action"], format: "TV", season: "FALL", year: 2020, minScore: 7 })
        expect(switchSearchType(anime, "manga")).toEqual(state({ type: "manga", title: "fate", genres: ["Action"], year: 2020, minScore: 7 }))
        expect(switchSearchType(state({ type: "manga", country: "KR", sort: "TRENDING_DESC" }), "anime")).toEqual(state({ sort: "TRENDING_DESC" }))
        expect(switchSearchType(anime, "anime")).toBe(anime)
    })

    it("clears filters but keeps type, title and sort, and applies a sheet draft the same way", () => {
        const full = state({ type: "manga", title: "x", sort: "POPULARITY_DESC", genres: ["Drama"], tags: ["Isekai"], status: "FINISHED", adult: true, country: "JP" })
        expect(clearSearchFilters(full)).toEqual(state({ type: "manga", title: "x", sort: "POPULARITY_DESC" }))
        const draft = { ...full, title: "old", sort: "SCORE_DESC" as const, genres: ["Comedy"] }
        expect(withSearchFilters(full, draft)).toEqual({ ...full, genres: ["Comedy"] })
        expect(withSearchFilters(full, { ...full })).toBe(full)
        expect(withSearchFilters(full, { ...draft, type: "anime" })).toBe(full)
    })

    it("lists one removable chip per filter, sent tags only", () => {
        const s = state({ genres: ["Action"], format: "TV", season: "FALL", year: 2024, status: "RELEASING", minScore: 7, tags: ["Isekai", "Bondage"], adult: true })
        expect(searchFilterChips(en, s, false).map(chip => chip.label)).toEqual(["Action", "TV", "Fall", "2024", "Airing", "7+", "#Isekai"])
        expect(searchFilterChips(en, s, true).map(chip => chip.label)).toEqual(["Action", "TV", "Fall", "2024", "Airing", "7+", "#Isekai", "#Bondage", "Adult"])
        expect(searchFilterChips(en, state({ type: "manga", status: "RELEASING" }), false).map(chip => chip.label)).toEqual(["Publishing"])
        expect(searchFilterChips(de, state({ type: "manga", genres: ["Adventure"], country: "KR", minScore: 8 }), false).map(chip => [chip.label, chip.name]))
            .toEqual([["Abenteuer", "Abenteuer"], ["8+", "Wertung 8+"], ["Südkorea", "Südkorea"]])
        expect(removeSearchFilter(s, "genre:Action").genres).toEqual([])
        expect(removeSearchFilter(s, "tag:Isekai").tags).toEqual(["Bondage"])
        expect(removeSearchFilter(s, "adult")).toMatchObject({ adult: false, tags: ["Isekai"] })
        expect(removeSearchFilter(s, "minScore").minScore).toBeNull()
    })
})

describe("phone search: AniList variables", () => {
    it("sends the anime score on AniList's 0-100 scale (the server multiplies manga only)", () => {
        expect(searchVariables(state({ minScore: 7 }), false).averageScore_greater).toBe(70)
        expect(searchVariables(state({ type: "manga", minScore: 7 }), false).averageScore_greater).toBe(7)
    })

    it("ranks a title by match first and keeps the sort after it", () => {
        expect(searchVariables(state({ title: "  frieren ", sort: "POPULARITY_DESC" }), false)).toEqual({ sort: ["SEARCH_MATCH", "POPULARITY_DESC"], search: "frieren", isAdult: false })
        expect(searchVariables(state({}), false)).toEqual({ sort: ["SCORE_DESC"], isAdult: false })
    })

    it("leaves out upcoming titles for Newest unless a status is chosen", () => {
        expect(searchVariables(state({ sort: "START_DATE_DESC" }), false).status).toEqual(["FINISHED", "RELEASING"])
        expect(searchVariables(state({ sort: "START_DATE_DESC", status: "NOT_YET_RELEASED" }), false).status).toEqual(["NOT_YET_RELEASED"])
        expect(searchVariables(state({ status: "HIATUS" }), false).status).toEqual(["HIATUS"])
    })

    it("sends season and seasonYear for anime, year and country for manga", () => {
        expect(searchVariables(state({ format: "MOVIE", season: "WINTER", year: 2024, genres: ["Drama"], tags: ["Isekai"] }), false))
            .toEqual({ sort: ["SCORE_DESC"], isAdult: false, format: "MOVIE", season: "WINTER", seasonYear: 2024, genres: ["Drama"], tags: ["Isekai"] })
        expect(searchVariables(state({ type: "manga", format: "ONE_SHOT", year: 2019, country: "KR" }), false))
            .toEqual({ sort: ["SCORE_DESC"], isAdult: false, format: "ONE_SHOT", year: 2019, countryOfOrigin: "KR" })
    })

    it("asks for adult titles and adult tags only while the server allows them", () => {
        const adult = state({ adult: true, tags: ["Bondage", "Isekai"] })
        expect(searchVariables(adult, true)).toMatchObject({ isAdult: true, tags: ["Bondage", "Isekai"] })
        expect(searchVariables(adult, false)).toMatchObject({ isAdult: false, tags: ["Isekai"] })
    })
})

describe("phone search: results", () => {
    it("pages on while AniList has more and shows every title once", () => {
        const page = (ids: number[], currentPage: number, hasNextPage: boolean) => ({ Page: { media: ids.map(id => ({ id })), pageInfo: { currentPage, hasNextPage } } })
        expect(nextSearchPage(page([1], 1, true), [{}])).toBe(2)
        expect(nextSearchPage(page([1], 2, false), [{}, {}])).toBeUndefined()
        expect(nextSearchPage(undefined, [])).toBeUndefined()
        expect(uniqueMedia([page([1, 2, 3], 1, true), page([3, 4], 2, false), undefined]).map(media => media.id)).toEqual([1, 2, 3, 4])
    })

    it("names list statuses short, per type", () => {
        expect(listStatusLabel(en, "anime", "CURRENT")).toBe("Watching")
        expect(listStatusLabel(de, "anime", "REPEATING")).toBe("Schaue erneut")
        expect(listStatusLabel(de, "manga", "CURRENT")).toBe("Lese ich")
        expect(listStatusLabel(de, "manga", "REPEATING")).toBe("Lese erneut")
        expect(listStatusLabel(de, "anime", "COMPLETED")).toBe("Fertig")
        expect(listStatusLabel(en, "manga", undefined)).toBe("")
    })

    it("words release statuses unlike the list statuses on the covers", () => {
        expect(searchStatuses("anime").map(option => option.en)).toEqual(["Finished", "Airing", "Upcoming", "Hiatus", "Cancelled"])
        expect(searchStatuses("manga").map(option => option.de)).toEqual(["Abgeschlossen", "Erscheint", "Demnächst", "Unterbrochen", "Eingestellt"])
        const listWords = ["CURRENT", "PLANNING", "COMPLETED", "DROPPED", "PAUSED", "REPEATING"].map(status => listStatusLabel(de, "anime", status as never))
        expect(searchStatuses("anime").filter(option => listWords.includes(option.de))).toEqual([])
    })
})

describe("phone search: result cards", () => {
    const anime = (patch: Partial<AL_BaseAnime>) => ({ id: 1, title: { userPreferred: "Frieren" }, format: "TV", status: "FINISHED", season: "FALL", seasonYear: 2023, episodes: 28, ...patch }) as AL_BaseAnime
    const manga = (patch: Partial<AL_BaseManga>) => ({ id: 5, title: { userPreferred: "Berserk" }, format: "MANGA", status: "RELEASING", startDate: { year: 1989 }, chapters: 380, ...patch }) as AL_BaseManga

    it("shows series by season, other forms by name and year, manga by start year", () => {
        expect(resultCardFacts(en, "anime", anime({}), undefined)).toMatchObject({ meta: "Fall 2023", onList: false, tag: undefined, badge: undefined })
        expect(resultCardFacts(de, "anime", anime({ format: "MOVIE", season: "SUMMER", seasonYear: 2022 }), undefined).meta).toBe("Film · 2022")
        expect(resultCardFacts(en, "manga", manga({ status: "FINISHED" }), undefined).meta).toBe("1989")
        expect(resultCardFacts(en, "manga", manga({ format: "ONE_SHOT", startDate: { year: 2017 } }), undefined).meta).toBe("One shot · 2017")
    })

    it("puts the list status in the line, the progress (else airing) and the newest or the score on the cover", () => {
        expect(resultCardFacts(en, "anime", anime({}), { status: "CURRENT", progress: 10 })).toMatchObject({ meta: "Watching · 2023", onList: true, tag: "10/28" })
        expect(resultCardFacts(de, "anime", anime({}), { status: "COMPLETED", progress: 28, score: 85 })).toMatchObject({ meta: "Fertig · 2023", tag: "28/28", badge: "★ 8,5" })
        expect(resultCardFacts(en, "anime", anime({ status: "NOT_YET_RELEASED", episodes: undefined }), { status: "PLANNING", progress: 0 }).tag).toBe("Upcoming")
        expect(resultCardFacts(en, "manga", manga({ chapters: undefined }), { status: "CURRENT", progress: 7 }, { unseen: 3 })).toMatchObject({ tag: "7/–", badge: "3 new" })
        expect(resultCardFacts(en, "manga", manga({}), undefined).tag).toBe("Publishing")
    })

    it("names everything the card shows for screen readers, title first", () => {
        expect(resultCardFacts(en, "anime", anime({ status: "RELEASING" }), { status: "CURRENT", progress: 1, score: 90 }, { unseen: 1, local: true }).label)
            .toBe("Frieren, Watching, 1 of 28 episodes watched, 1 new episode, your score 9, in your library, Fall 2023, TV, Airing")
        expect(resultCardFacts(de, "manga", manga({ chapters: undefined }), { status: "CURRENT", progress: 2 }, { unseen: 4 }).label)
            .toBe("Berserk, Lese ich, 2 Kapitel gelesen, 4 neue Kapitel, 1989, Manga, Erscheint")
    })

    it("counts new episodes and chapters as the desktop card does", () => {
        const options = { anime: true, manga: true }
        expect(unseenCount("anime", anime({ episodes: 12 }), { status: "CURRENT", progress: 10 }, options)).toBe(2)
        expect(unseenCount("anime", anime({ episodes: 24, nextAiringEpisode: { episode: 8 } as never }), { status: "CURRENT", progress: 5 }, options)).toBe(2)
        expect(unseenCount("anime", anime({}), { status: "CURRENT", progress: 5 }, { ...options, library: { mainFileCount: 15, unwatchedCount: 10 } })).toBe(10)
        expect(unseenCount("anime", anime({}), { status: "PAUSED", progress: 5 }, options)).toBe(0)
        expect(unseenCount("anime", anime({}), { status: "CURRENT", progress: 5 }, { ...options, anime: false })).toBe(0)
        const chapters = { latestChapterNumbers: { 5: [{ provider: "mangadex", scanlator: "", language: "", number: 45 }] }, storedProviders: { "5": "mangadex" }, storedFilters: {} }
        expect(unseenCount("manga", manga({}), { status: "CURRENT", progress: 40 }, { ...options, chapters })).toBe(5)
        expect(unseenCount("manga", manga({}), undefined, { ...options, chapters })).toBe(0)
        expect(unseenCount("manga", manga({ id: 6 }), { status: "CURRENT", progress: 40 }, { ...options, chapters })).toBe(0)
    })

    it("announces how a new search turned out", () => {
        expect(searchAnnouncement(en, "anime", 48, true)).toBe("More than 48 results")
        expect(searchAnnouncement(de, "manga", 1, false)).toBe("1 Ergebnis")
        expect(searchAnnouncement(de, "manga", 0, false)).toBe("Keine passenden Manga")
    })
})

describe("phone search: texts", () => {
    it("titles the results like the desktop, in both languages", () => {
        expect(searchTitle(en, state({}))).toBe("Highest rated anime")
        expect(searchTitle(de, state({}))).toBe("Bestbewertete Anime")
        expect(searchTitle(en, state({ type: "manga", sort: "TRENDING_DESC", genres: ["Action"] }))).toBe("Trending Action manga")
        expect(searchTitle(de, state({ type: "manga", sort: "TRENDING_DESC", genres: ["Action", "Adventure"] }))).toBe("Angesagte Manga: Action, Abenteuer")
        expect(searchTitle(en, state({ season: "WINTER", year: 2024 }))).toBe("Highest rated anime from Winter 2024")
        expect(searchTitle(de, state({ season: "FALL", year: 2024 }))).toBe("Bestbewertete Anime aus dem Herbst 2024")
        expect(searchTitle(de, state({ year: 2024 }))).toBe("Bestbewertete Anime aus dem Jahr 2024")
        expect(searchTitle(en, state({ sort: "EPISODES_DESC", genres: ["Comedy"] }))).toBe("Comedy anime with the most episodes")
        expect(searchTitle(en, state({ sort: "EPISODES_DESC" }))).toBe("Anime with the most episodes")
        expect(searchTitle(en, state({ sort: "START_DATE_DESC" }))).toBe("Newest anime")
        expect(searchTitle(de, state({ type: "manga", sort: "CHAPTERS_DESC" }))).toBe("Manga mit den meisten Kapiteln")
        expect(searchTitle(en, state({ title: "frieren ", genres: ["Action"] }))).toBe("Results for “frieren”")
        expect(searchTitle(de, state({ title: "frieren" }))).toBe("Treffer für „frieren“")
    })

    it("offers 70 years like the desktop, two ahead", () => {
        const years = searchYears(new Date(2026, 9, 21))
        expect([years.length, years[0], years[69]]).toEqual([70, 2028, 1959])
    })
})

describe("phone search: tag chips", () => {
    it("shows 30 of 349 tags, all 417 with adult titles, selected first, prefix matches first", () => {
        const plain = searchTagChoices({ query: "", adult: false, selected: [], all: false })
        expect([plain.tags.length, plain.total, plain.more]).toEqual([30, 349, true])
        expect(searchTagChoices({ query: "", adult: true, selected: [], all: true }).tags.length).toBe(417)
        const picked = searchTagChoices({ query: "", adult: false, selected: ["Time Skip"], all: false })
        expect(picked.tags[0]).toBe("Time Skip")
        expect(picked.tags.length).toBe(31)
        const query = searchTagChoices({ query: "isek", adult: false, selected: [], all: false })
        expect(query.tags[0]).toBe("Isekai")
        expect(query.more).toBe(false)
        expect(searchTagChoices({ query: "zzz", adult: false, selected: [], all: false })).toEqual({ tags: [], total: 0, more: false })
    })
})
