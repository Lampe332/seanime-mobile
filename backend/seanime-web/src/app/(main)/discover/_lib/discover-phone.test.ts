import { describe, expect, it } from "vitest"
import {
    airedAgoLabel,
    airingTimeLabel,
    byMeanScore,
    discoverSeasons,
    episodeTag,
    genreLabel,
    groupScheduleByDay,
    latestAiredPerShow,
    listStatusLabel,
    pickDiscoverTab,
    pickSpotlight,
    recentWindow,
    scheduleDayTitle,
    scheduleFacts,
    scheduleNeedsMore,
    scheduleReach,
    scheduleWindow,
    scoreLabel,
    seeAllLinks,
    withoutFeatured,
} from "./discover-phone"

const en = (english: string) => english
const de = (_: string, german: string) => german

function airing(id: number, mediaId: number, at: Date | number, media: Record<string, unknown> = {}) {
    const airingAt = Math.floor((typeof at === "number" ? at : at.getTime()) / 1000)
    return {
        id, episode: id % 20 + 1, airingAt, timeUntilAiring: 0,
        media: { id: mediaId, isAdult: false, type: "ANIME", countryOfOrigin: "JP", format: "TV", episodes: 12, ...media },
    } as any
}

describe("phone discover tabs", () => {
    it("falls back to Anime for unknown types and for Manga while manga is off", () => {
        expect(pickDiscoverTab("schedule", false)).toBe("schedule")
        expect(pickDiscoverTab("manga", true)).toBe("manga")
        expect(pickDiscoverTab("manga", false)).toBe("anime")
        expect(pickDiscoverTab("Manga", true)).toBe("anime")
        expect(pickDiscoverTab(undefined, true)).toBe("anime")
    })
})

describe("phone discover seasons", () => {
    it("maps months to AniList seasons and steps back a year from Winter", () => {
        expect(discoverSeasons(new Date(2026, 9, 21))).toEqual({ current: { season: "FALL", year: 2026 }, previous: { season: "SUMMER", year: 2026 } })
        expect(discoverSeasons(new Date(2026, 0, 2))).toEqual({ current: { season: "WINTER", year: 2026 }, previous: { season: "FALL", year: 2025 } })
        expect(discoverSeasons(new Date(2026, 3, 1)).current.season).toBe("SPRING")
        expect(discoverSeasons(new Date(2026, 8, 30)).current.season).toBe("SUMMER")
    })
})

describe("phone discover links", () => {
    it("opens Search with the row's sorting and filters", () => {
        expect(seeAllLinks.trending()).toBe("/search?sorting=TRENDING_DESC")
        expect(seeAllLinks.trending("Slice of Life")).toBe("/search?sorting=TRENDING_DESC&genre=Slice+of+Life")
        expect(seeAllLinks.season({ season: "FALL", year: 2026 }, "Action")).toBe("/search?sorting=SCORE_DESC&season=FALL&year=2026&genre=Action")
        expect(seeAllLinks.upcoming()).toBe("/search?sorting=TRENDING_DESC&status=NOT_YET_RELEASED")
        expect(seeAllLinks.movies()).toBe("/search?sorting=TRENDING_DESC&format=MOVIE")
        expect(seeAllLinks.manga("KR", null)).toBe("/search?type=manga&sorting=TRENDING_DESC&country=KR")
    })
})

describe("phone discover query windows", () => {
    it("keeps the aired-recently window for five minutes", () => {
        const now = Date.UTC(2026, 9, 21, 12, 3, 20)
        const window = recentWindow(now)
        expect(window.airingAt_lesser).toBe(Date.UTC(2026, 9, 21, 12, 0) / 1000)
        expect(window.airingAt_greater).toBe(window.airingAt_lesser - 14 * 86400)
        expect(recentWindow(now + 60_000)).toEqual(window)
    })

    it("keeps the schedule window for the whole day", () => {
        const morning = new Date(2026, 9, 21, 8, 0).getTime()
        expect(scheduleWindow(morning)).toEqual(scheduleWindow(new Date(2026, 9, 21, 23, 59).getTime()))
        expect(scheduleWindow(morning).airingAt_greater).toBe(new Date(2026, 9, 21).getTime() / 1000)
        expect(scheduleWindow(morning).airingAt_lesser).toBe(new Date(2026, 10, 4).getTime() / 1000)
    })
})

describe("phone discover aired recently", () => {
    it("keeps the desktop filter and one card per show with its newest episode", () => {
        const now = Date.UTC(2026, 9, 21, 12)
        const items = [
            airing(1, 10, now - 7 * 86_400_000), airing(2, 10, now - 3_600_000), airing(3, 11, now - 7_200_000),
            airing(4, 12, now, { isAdult: true }), airing(5, 13, now, { countryOfOrigin: "KR" }), airing(6, 14, now, { format: "TV_SHORT" }),
            airing(7, 15, now, { isAdult: undefined }), { id: 8, airingAt: 0, episode: 1, timeUntilAiring: 0 },
        ]
        expect(latestAiredPerShow(items).map(item => item.id)).toEqual([2, 3])
        expect(latestAiredPerShow(undefined)).toEqual([])
    })

    it("says how long ago an episode aired", () => {
        const now = Date.UTC(2026, 9, 21, 12)
        const ago = (seconds: number) => now / 1000 - seconds
        expect(airedAgoLabel(en, ago(20), now)).toBe("Just now")
        expect(airedAgoLabel(en, ago(5 * 60), now)).toBe("5m ago")
        expect(airedAgoLabel(de, ago(5 * 60), now)).toBe("vor 5 Min.")
        expect(airedAgoLabel(en, ago(17 * 3600 + 59), now)).toBe("17h ago")
        expect(airedAgoLabel(de, ago(17 * 3600), now)).toBe("vor 17 Std.")
        expect(airedAgoLabel(en, ago(30 * 3600), now)).toBe("1d ago")
        expect(airedAgoLabel(en, ago(3 * 86400), now)).toBe("3d ago")
        expect(airedAgoLabel(de, ago(3 * 86400), now)).toBe("vor 3 Tagen")
    })

    it("marks the episode and its count, movies as such", () => {
        expect(episodeTag(en, { ...airing(1, 1, 0), episode: 2 })).toBe("Ep 2/12")
        expect(episodeTag(de, { ...airing(1, 1, 0, { episodes: undefined }), episode: 2 })).toBe("Folge 2")
        expect(episodeTag(de, airing(1, 1, 0, { format: "MOVIE" }))).toBe("Film")
    })
})

describe("phone discover schedule", () => {
    it("groups the next 14 days by local day and time, skipping empty days and repeats", () => {
        const now = new Date(2026, 9, 21, 9, 0).getTime()
        const items = [
            airing(3, 3, new Date(2026, 9, 22, 1, 0)), airing(1, 1, new Date(2026, 9, 21, 18, 30)), airing(2, 2, new Date(2026, 9, 21, 11, 0)),
            airing(4, 4, new Date(2026, 9, 23, 20, 0)), airing(5, 5, new Date(2026, 10, 4, 0, 30)), airing(6, 6, new Date(2026, 9, 20, 23, 0)),
            airing(7, 7, new Date(2026, 9, 21, 12, 0), { countryOfOrigin: "CN" }), airing(2, 2, new Date(2026, 9, 21, 11, 0)),
        ]
        const days = groupScheduleByDay(items, now)
        expect(days.map(day => [day.key, day.items.map(item => item.id)])).toEqual([["2026-10-21", [2, 1]], ["2026-10-22", [3]], ["2026-10-23", [4]]])
        expect(days[0].date).toEqual(new Date(2026, 9, 21))
        expect(groupScheduleByDay(items, now, new Date(2026, 9, 23)).map(day => day.key)).toEqual(["2026-10-21", "2026-10-22"])
    })

    it("loads pages until AniList has no more or the two weeks are in, and shows only complete days meanwhile", () => {
        const lesser = new Date(2026, 10, 4).getTime() / 1000
        const page = (hasNextPage: boolean, ...at: number[]) => ({ pageInfo: { hasNextPage }, airingSchedules: at.map(airingAt => ({ airingAt })) })
        expect(scheduleNeedsMore(page(true, lesser - 7200, lesser - 3600), lesser)).toBe(true)
        expect(scheduleNeedsMore(page(true, lesser - 3600, lesser), lesser)).toBe(false)
        expect(scheduleNeedsMore(page(false, lesser - 3600), lesser)).toBe(false)
        expect(scheduleNeedsMore(page(true), lesser)).toBe(false)
        expect(scheduleNeedsMore(undefined, lesser)).toBe(false)
        const now = new Date(2026, 9, 21, 9, 0).getTime()
        expect(scheduleReach(new Date(2026, 9, 25, 3, 0).getTime() / 1000, false, now)).toEqual(new Date(2026, 9, 25))
        expect(scheduleReach(new Date(2026, 9, 25, 3, 0).getTime() / 1000, true, now)).toEqual(new Date(2026, 10, 4))
        expect(scheduleReach(undefined, false, now)).toBeUndefined()
    })

    it("names days and times in the app language", () => {
        const now = new Date(2026, 9, 21, 9, 0).getTime()
        expect(scheduleDayTitle(en, new Date(2026, 9, 21), now, false)).toBe("Later today")
        expect(scheduleDayTitle(de, new Date(2026, 9, 21), now, true)).toBe("Heute noch")
        expect(scheduleDayTitle(de, new Date(2026, 9, 22), now, true)).toBe("Morgen")
        expect(scheduleDayTitle(en, new Date(2026, 9, 23), now, false)).toBe("Friday, 23 Oct")
        expect(scheduleDayTitle(de, new Date(2026, 9, 23), now, true)).toBe("Freitag, 23. Okt.")
        const evening = new Date(2026, 9, 21, 18, 30).getTime() / 1000
        expect(airingTimeLabel(evening, false)).toBe("6:30 PM")
        expect(airingTimeLabel(evening, true)).toBe("18:30")
        expect(scheduleFacts(en, 38)).toBe("38 episodes in the next 2 weeks")
        expect(scheduleFacts(de, 1)).toBe("1 Folge in den nächsten 2 Wochen")
        expect(scheduleFacts(en, 69, 5)).toBe("69 episodes in the next 5 days")
        expect(scheduleFacts(de, 69, 5)).toBe("69 Folgen in den nächsten 5 Tagen")
        expect(scheduleFacts(en, 4, 1)).toBe("4 episodes later today")
    })
})

describe("phone discover cards", () => {
    it("spotlights the first five titles (anime: those that are out), without adult titles while those are blurred", () => {
        const media = [1, 2, 3, 4, 5, 6, 7, 8].map(id => ({ id, status: id === 2 ? "NOT_YET_RELEASED" : "RELEASING", isAdult: id === 3 }))
        expect(pickSpotlight(media, { skipUnreleased: true }).map(item => item.id)).toEqual([1, 3, 4, 5, 6])
        expect(pickSpotlight(media, { hideAdult: true, skipUnreleased: true }).map(item => item.id)).toEqual([1, 4, 5, 6, 7])
        expect(pickSpotlight(media, { hideAdult: true }).map(item => item.id)).toEqual([1, 2, 4, 5, 6])
        expect(pickSpotlight(undefined)).toEqual([])
    })

    it("leaves the spotlight's titles out of the row under it, unless nothing would be left", () => {
        const media = [1, 2, 3, 4].map(id => ({ id }))
        expect(withoutFeatured(media, [media[0], media[2]])?.map(item => item.id)).toEqual([2, 4])
        expect(withoutFeatured(media.slice(0, 2), media.slice(0, 2))?.map(item => item.id)).toEqual([1, 2])
        expect(withoutFeatured(undefined, media)).toBeUndefined()
    })

    it("sorts top rows by mean score with unscored titles last", () => {
        expect(byMeanScore([{ id: 1, meanScore: 70 }, { id: 2 }, { id: 3, meanScore: 88 }]).map(item => item.id)).toEqual([3, 1, 2])
    })

    it("labels scores, list statuses and genres", () => {
        expect(scoreLabel(en, 82)).toBe("82%")
        expect(scoreLabel(de, 82)).toBe("82 %")
        expect(scoreLabel(en, undefined)).toBe("")
        expect(listStatusLabel(en, "anime", "CURRENT")).toBe("Watching")
        expect(listStatusLabel(de, "manga", "CURRENT")).toBe("Lese ich")
        expect(listStatusLabel(de, "anime", "REPEATING")).toBe("Schaue erneut")
        expect(listStatusLabel(en, "anime", undefined)).toBe("")
        expect(genreLabel(de, "Slice of Life")).toBe("Slice of Life")
        expect(genreLabel(de, "Supernatural")).toBe("Übernatürlich")
        expect(genreLabel(de, "Unknown")).toBe("Unknown")
    })
})
