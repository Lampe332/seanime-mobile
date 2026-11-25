// geschrieben nach: jellyfin.recorded.json (von Hand gebaut nach [J3] [J8] [J13], Stück 6 ersetzt sie durch echte Aufzeichnung) und Seanime_Jellyfin_Plan.md §2 und §4; der Server ist hier ein Test-Double, keine Anfrage verlässt den Test

import { describe, expect, it } from "vitest"
import type { HttpFetch } from "../anilist/client"
import { metadataOf } from "../library/metadata"
import {
    type JellyfinIdentity, type JellyfinSession, JellyfinFailure, authenticateByName, authorizationHeader, jellyfinUrl, listEpisodes, listSeasons,
    listSeries,
} from "./client"
import { type AnilistTitle, type ServerShow, type TitleMatch, chooseRule, matchLibrary, matchTitle } from "./match"
import recorded from "./jellyfin.recorded.json"

const BASE = "https://media.example/jellyfin"
const identity: JellyfinIdentity = { device: "Pixel 8", deviceId: "dev-1", version: "1.2.3" }
const session: JellyfinSession = { serverId: "srv-1", url: BASE, userId: "u1", token: "tok-recorded", identity }

type Call = { url: string, method?: string, headers?: Record<string, string>, body?: string }

/** A server that answers from the recorded file and notes every call */
function serverDouble(calls: Call[] = [], status = 200): HttpFetch {
    return async (url, init) => {
        calls.push({ url, method: init.method, headers: init.headers, body: init.body })
        const path = new URL(url).pathname.replace("/jellyfin", "")
        const shows = recorded.shows as Record<string, { seasons: unknown, episodes: unknown }>
        let answer: unknown = null
        if (path === "/Users/AuthenticateByName") answer = recorded.auth
        else if (path === "/Items") answer = recorded.items
        else {
            const found = /^\/Shows\/([^/]+)\/(Seasons|Episodes)$/.exec(path)
            if (found) answer = found[2] === "Seasons" ? shows[found[1]].seasons : shows[found[1]].episodes
        }
        return { status: answer ? status : 404, headers: { get: () => null }, text: async () => JSON.stringify(answer) }
    }
}

async function serverShows(): Promise<ServerShow[]> {
    const fetch = serverDouble()
    const { items } = await listSeries(fetch, session)
    const shows: ServerShow[] = []
    for (const series of items.filter(item => item.type === "Series")) {
        shows.push({ series, seasons: await listSeasons(fetch, session, series.id), episodes: await listEpisodes(fetch, session, series.id) })
    }
    return shows
}

const anizip = recorded.anizip as Record<string, unknown>
const title = (id: number, titles: string[], year: number, aired: number): AnilistTitle =>
    ({ id, titles, year, aired, metadata: anizip[String(id)] ? metadataOf(anizip[String(id)]) : null })
const pairs = (match: TitleMatch | null) => match?.episodes.map(pair => [pair.episode, pair.serverEpisodeId])

describe("jellyfin client", () => {
    it("builds the Authorization line with exactly the five fields", () => {
        expect(authorizationHeader(identity, "tok")).toBe('MediaBrowser Client="Seanime Mobile", Device="Pixel 8", DeviceId="dev-1", Version="1.2.3", Token="tok"')
        expect(authorizationHeader(identity)).toBe('MediaBrowser Client="Seanime Mobile", Device="Pixel 8", DeviceId="dev-1", Version="1.2.3"')
        expect(authorizationHeader({ ...identity, device: 'Nick"s Phone' }, "t")).toContain(`Device="Nick's Phone"`)
    })

    it("keeps a sub path and drops a trailing slash", () => {
        expect(jellyfinUrl(`${BASE}/`, "/Items", { userId: "u1", seasonId: undefined, isMissing: false }))
            .toBe(`${BASE}/Items?userId=u1&isMissing=false`)
    })

    it("signs in by name: body Username and Pw, no token yet, token never in an address", async () => {
        const calls: Call[] = []
        const signedIn = await authenticateByName(serverDouble(calls), `${BASE}/`, identity, "nutzer", "geheim")
        expect(signedIn).toEqual({ serverId: "srv-1", url: BASE, userId: "u1", token: "tok-recorded", identity })
        expect(calls[0].url).toBe(`${BASE}/Users/AuthenticateByName`)
        expect(calls[0].method).toBe("POST")
        expect(JSON.parse(calls[0].body!)).toEqual({ Username: "nutzer", Pw: "geheim" })
        expect(calls[0].headers!.Authorization).not.toContain("Token=")
    })

    it("asks series, seasons and episodes with the plan's fields and the token in the header only", async () => {
        const calls: Call[] = []
        const fetch = serverDouble(calls)
        const page = await listSeries(fetch, session)
        await listSeasons(fetch, session, "a1")
        const episodes = await listEpisodes(fetch, session, "a1", "a1s1")
        expect(calls.map(call => call.url)).toEqual([
            `${BASE}/Items?userId=u1&includeItemTypes=Series%2CMovie&recursive=true&fields=ProviderIds%2CPath&startIndex=0&limit=200`,
            `${BASE}/Shows/a1/Seasons?userId=u1&fields=ProviderIds`,
            `${BASE}/Shows/a1/Episodes?userId=u1&seasonId=a1s1&fields=ProviderIds%2CMediaSources&isMissing=false`,
        ])
        for (const call of calls) {
            expect(call.url).not.toContain("tok-recorded")
            expect(call.headers!.Authorization).toBe(authorizationHeader(identity, "tok-recorded"))
        }
        expect(page.total).toBe(5)
        expect(page.items.map(item => [item.id, item.type, item.serverId])).toContainEqual(["e1", "Movie", "srv-1"])
        const first = episodes.find(episode => episode.id === "a1s1e1")!
        expect(first).toMatchObject({ season: 1, index: 1, seasonId: "a1s1", seriesId: "a1" })
        expect(first.mediaSources[0].id).toBe("ms-a1s1e1")
        expect(first.mediaSources[0].streams.filter(stream => stream.isExternal)).toEqual([{ index: 3, type: "Subtitle", language: "ger", isExternal: true }])
    })

    it("turns another status into a JellyfinFailure", async () => {
        await expect(listSeries(serverDouble([], 401), session)).rejects.toBeInstanceOf(JellyfinFailure)
    })
})

describe("jellyfin matching", () => {
    it("one season (S1): episode = IndexNumber, season 0 left out", async () => {
        const match = matchTitle(title(101, ["Hoshi no Tabi"], 2023, 4), await serverShows())
        expect(match).toMatchObject({ rule: "S1", certain: true, serverId: "srv-1", seriesId: "a1" })
        expect(pairs(match)).toEqual([[1, "a1s1e1"], [2, "a1s1e2"], [3, "a1s1e3"], [4, "a1s1e4"]])
    })

    it("three seasons over Tvdb (S2): each title gets its own season", async () => {
        const shows = await serverShows()
        const matches = [201, 202, 203].map(id => matchTitle(title(id, [`Kyojin Saga ${id}`], 0, 3), shows))
        expect(matches.map(match => match?.rule)).toEqual(["S2", "S2", "S2"])
        expect(matches.map(pairs)).toEqual([1, 2, 3].map(season => [1, 2, 3].map(episode => [episode, `b1s${season}e${episode}`])))
    })

    it("season 0 only over S2", async () => {
        const shows = await serverShows()
        expect(pairs(matchTitle(title(204, ["Kyojin Saga OVA"], 0, 1), shows))).toEqual([[1, "b1s0e1"]])
        // same OVA without ani.zip numbers: no rule may reach the special
        const bare = matchTitle({ ...title(204, ["Kyojin Saga OVA"], 0, 1), metadata: null }, shows)
        expect(bare?.episodes.some(pair => pair.serverEpisodeId.includes("s0"))).not.toBe(true)
    })

    it("counted through (S3): absoluteEpisodeNumber in the one season, not the special", async () => {
        const match = matchTitle(title(302, ["Juuni Cours Part 2"], 2020, 3), await serverShows())
        expect(match).toMatchObject({ rule: "S3", certain: true, seriesId: "c1" })
        expect(pairs(match)).toEqual([[1, "c1s1e4"], [2, "c1s1e5"], [3, "c1s1e6"]])
    })

    it("only the title (S4): the matching season, always uncertain", async () => {
        const match = matchTitle(title(400, ["Mori no Uta Season 2"], 2011, 2), await serverShows())
        expect(match).toMatchObject({ rule: "S4", certain: false, seriesId: "d1" })
        expect(pairs(match)).toEqual([[1, "d1s2e1"], [2, "d1s2e2"]])
        expect(matchTitle(title(401, ["Mori no Uta Season 2"], 2016, 2), await serverShows())).toBeNull()
    })

    it("conflict: no server episode belongs to two titles", async () => {
        const shows = await serverShows()
        const titles = [title(301, ["Juuni Cours"], 2020, 3), title(302, ["Juuni Cours Part 2"], 2020, 3), title(900, ["Juuni Cours"], 2020, 6)]
        expect(matchTitle(titles[2], shows)).toMatchObject({ rule: "S4", certain: false })
        const matches = matchLibrary(titles, shows)
        expect(matches.map(match => [match.anilistId, match.rule])).toEqual([[301, "S2"], [302, "S3"]])
        const files = matches.flatMap(match => match.episodes.map(pair => pair.serverEpisodeId))
        expect(new Set(files).size).toBe(files.length)
        // two certain claims of the same rule: the episode goes to neither
        const twin = { ...title(301, ["Juuni Cours"], 2020, 3), id: 999 }
        expect(matchLibrary([titles[0], twin], shows)).toEqual([])
    })

    it("half rule: a rule below half of the aired episodes gives way to the next that finds more", () => {
        const match = (rule: TitleMatch["rule"], found: number): TitleMatch => ({
            anilistId: 1, serverId: "s", seriesId: "x", rule, certain: rule !== "S4",
            episodes: Array.from({ length: found }, (_, at) => ({ episode: at + 1, serverEpisodeId: `${rule}-${at}` })),
        })
        expect(chooseRule([null, match("S2", 1), match("S3", 3)], 4)?.rule).toBe("S3")
        expect(chooseRule([null, match("S2", 2), match("S3", 4)], 4)?.rule).toBe("S2")
        expect(chooseRule([match("S1", 1), match("S2", 0), match("S3", 1), match("S4", 2)], 4)?.rule).toBe("S4")
        expect(chooseRule([null, null, null, null], 4)).toBeNull()
    })
})
