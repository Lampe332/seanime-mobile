// geschrieben nach: jellyfin.recorded.json (echte Aufzeichnung vom Testserver, scripts/record-jellyfin.mjs) für Client, Untertitel und den echten Abgleich; jellyfin.invented.json (von Hand gebaut, erfunden) für die Lagen, die der Testserver nicht hat; Seanime_Jellyfin_Plan.md §2 und §4. Der Server ist hier ein Test-Double, keine Anfrage verlässt den Test

import { describe, expect, it } from "vitest"
import type { HttpFetch } from "../anilist/client"
import { metadataOf } from "../library/metadata"
import {
    type JellyfinIdentity, type JellyfinSession, JellyfinFailure, authenticateByName, authorizationHeader, jellyfinUrl, listEpisodes, listSeasons,
    listSeries, publicServerInfo,
} from "./client"
import { type AnilistTitle, type ServerShow, type TitleMatch, chooseRule, matchLibrary, matchTitle } from "./match"
import { serverSubtitleTracks } from "./source"
import invented from "./jellyfin.invented.json"
import recorded from "./jellyfin.recorded.json"

const BASE = "https://media.example/jellyfin"
const identity: JellyfinIdentity = { device: "Pixel 8", deviceId: "dev-1", version: "1.2.3" }
/** The session of the invented server */
const session: JellyfinSession = { serverId: "srv-1", url: BASE, userId: "u1", token: "tok-recorded", identity }
/** The session of the recorded server; token and ids are the recording's placeholders */
const real: JellyfinSession = { serverId: "recorded-server", url: BASE, userId: "recorded-user", token: "REDACTED", identity }

// the recorded library: Cowboy Bebop (one season, two files, a subtitle file next to the first) and Mob Psycho 100 (two seasons)
const BEBOP = "dc8b33ed28b586a37929fc76731869b8"
const BEBOP_E1 = "0d8519aea321347648d3416e666fb983"
const BEBOP_E2 = "efb6ff604375bacebe4a65d8e7fc7619"
const MOB = "7a6a3619526e396ee2ba610227c18bdb"

type Call = { url: string, method?: string, headers?: Record<string, string>, body?: string }
type Answers = { auth: unknown, items: unknown, info?: unknown, shows: unknown, anizip: unknown }

/** A server that answers from one of the two files and notes every call */
function serverDouble(data: Answers, calls: Call[] = [], status = 200): HttpFetch {
    return async (url, init) => {
        calls.push({ url, method: init.method, headers: init.headers, body: init.body })
        const path = new URL(url).pathname.replace("/jellyfin", "")
        const shows = data.shows as Record<string, { seasons: unknown, episodes: unknown }>
        let answer: unknown = null
        if (path === "/Users/AuthenticateByName") answer = data.auth
        else if (path === "/System/Info/Public") answer = data.info
        else if (path === "/Items") answer = data.items
        else {
            const found = /^\/Shows\/([^/]+)\/(Seasons|Episodes)$/.exec(path)
            if (found) answer = found[2] === "Seasons" ? shows[found[1]].seasons : shows[found[1]].episodes
        }
        return { status: answer ? status : 404, headers: { get: () => null }, text: async () => JSON.stringify(answer) }
    }
}

async function serverShows(data: Answers, as: JellyfinSession): Promise<ServerShow[]> {
    const fetch = serverDouble(data)
    const { items } = await listSeries(fetch, as)
    const shows: ServerShow[] = []
    for (const series of items.filter(item => item.type === "Series")) {
        shows.push({ series, seasons: await listSeasons(fetch, as, series.id), episodes: await listEpisodes(fetch, as, series.id) })
    }
    return shows
}

const titleFrom = (data: Answers) => (id: number, titles: string[], year: number, aired: number): AnilistTitle => {
    const anizip = data.anizip as Record<string, unknown>
    return { id, titles, year, aired, metadata: anizip[String(id)] ? metadataOf(anizip[String(id)]) : null }
}
const title = titleFrom(invented)
const realTitle = titleFrom(recorded)
const pairs = (match: TitleMatch | null) => match?.episodes.map(pair => [pair.episode, pair.serverEpisodeId])

describe("jellyfin client, against the recorded server", () => {
    it("builds the Authorization line with exactly the five fields", () => {
        expect(authorizationHeader(identity, "tok")).toBe('MediaBrowser Client="Seanime Mobile", Device="Pixel 8", DeviceId="dev-1", Version="1.2.3", Token="tok"')
        expect(authorizationHeader(identity)).toBe('MediaBrowser Client="Seanime Mobile", Device="Pixel 8", DeviceId="dev-1", Version="1.2.3"')
        expect(authorizationHeader({ ...identity, device: 'Nick"s Phone' }, "t")).toContain(`Device="Nick's Phone"`)
    })

    it("keeps a sub path and drops a trailing slash", () => {
        expect(jellyfinUrl(`${BASE}/`, "/Items", { userId: "u1", seasonId: undefined, isMissing: false }))
            .toBe(`${BASE}/Items?userId=u1&isMissing=false`)
    })

    it("holds no secret: the recording names its version and carries placeholders only", () => {
        expect(recorded.serverVersion).toBe(recorded.info.Version)
        expect(recorded.auth.AccessToken).toBe("REDACTED")
        expect(JSON.stringify(recorded)).not.toMatch(/[A-Za-z]:\\\\|api_key/i)
    })

    it("reads the public info: the server's id and name", async () => {
        expect(await publicServerInfo(serverDouble(recorded), BASE, identity)).toEqual({ serverId: "recorded-server", name: "recorded-server-name" })
    })

    it("signs in by name: body Username and Pw, no token yet, token never in an address", async () => {
        const calls: Call[] = []
        const signedIn = await authenticateByName(serverDouble(recorded, calls), `${BASE}/`, identity, "nutzer", "geheim")
        expect(signedIn).toEqual(real)
        expect(calls[0].url).toBe(`${BASE}/Users/AuthenticateByName`)
        expect(calls[0].method).toBe("POST")
        expect(JSON.parse(calls[0].body!)).toEqual({ Username: "nutzer", Pw: "geheim" })
        expect(calls[0].headers!.Authorization).not.toContain("Token=")
    })

    it("asks series, seasons and episodes with the plan's fields and the token in the header only", async () => {
        const calls: Call[] = []
        const fetch = serverDouble(recorded, calls)
        const page = await listSeries(fetch, real)
        const seasons = await listSeasons(fetch, real, MOB)
        const season = "2a7e096873b4d64d948de691c44fe3d6"
        const episodes = await listEpisodes(fetch, real, BEBOP, season)
        expect(calls.map(call => call.url)).toEqual([
            `${BASE}/Items?userId=recorded-user&includeItemTypes=Series%2CMovie&recursive=true&fields=ProviderIds%2CPath&startIndex=0&limit=200`,
            `${BASE}/Shows/${MOB}/Seasons?userId=recorded-user&fields=ProviderIds`,
            `${BASE}/Shows/${BEBOP}/Episodes?userId=recorded-user&seasonId=${season}&fields=ProviderIds%2CMediaSources&isMissing=false`,
        ])
        for (const call of calls) {
            expect(call.url).not.toContain(real.token)
            expect(call.headers!.Authorization).toBe(authorizationHeader(identity, real.token))
        }
        expect(page.total).toBe(2)
        expect(page.items.find(item => item.id === BEBOP)).toEqual({
            serverId: "recorded-server", id: BEBOP, type: "Series", name: "Cowboy Bebop", year: 1998,
            providerIds: { Imdb: "tt0213338", Tmdb: "30991", Tvdb: "76885" }, path: "/media/Shows/Cowboy Bebop (1998)",
        })
        // a season carries its own Tvdb and Tmdb numbers, not the series' ones
        expect(seasons.map(item => [item.index, item.seriesId, item.year])).toEqual([[1, MOB, 2016], [2, MOB, 2019]])
        expect(seasons.every(item => item.providerIds.Tvdb && item.providerIds.Tvdb !== "307375")).toBe(true)
        const first = episodes.find(episode => episode.id === BEBOP_E1)!
        expect(first).toMatchObject({ season: 1, index: 1, seasonId: season, seriesId: BEBOP })
        // one version: the source is named after the episode
        expect(first.mediaSources.map(source => [source.id, source.container])).toEqual([[BEBOP_E1, "mkv"]])
        // the subtitle file next to the video stands first, with index 0
        expect(first.mediaSources[0].streams.map(stream => [stream.index, stream.type, stream.codec])).toEqual([[0, "Subtitle", "subrip"], [1, "Video", "h264"], [2, "Audio", "aac"]])
        expect(first.mediaSources[0].streams[0]).toEqual({
            index: 0, type: "Subtitle", codec: "subrip", language: "eng", title: "English - SUBRIP - External", isExternal: true, isText: true, isDefault: false,
        })
    })

    it("turns another status into a JellyfinFailure", async () => {
        await expect(listSeries(serverDouble(recorded, [], 401), real)).rejects.toBeInstanceOf(JellyfinFailure)
    })
})

describe("jellyfin subtitles next to the video", () => {
    it("recorded: the file's address without a token, its language and format", async () => {
        const episodes = await listEpisodes(serverDouble(recorded), real, BEBOP)
        const [first, second] = [BEBOP_E1, BEBOP_E2].map(id => episodes.find(episode => episode.id === id)!)
        const tracks = serverSubtitleTracks(real, first.id, first.mediaSources[0])
        expect(tracks).toEqual([{
            index: 0, src: `${BASE}/Videos/${BEBOP_E1}/${BEBOP_E1}/Subtitles/0/Stream.srt`, label: "English - SUBRIP - External", language: "eng", type: "srt", default: false,
        }])
        // the very address the recording asked, answered without the Authorization line too
        expect(tracks[0].src).toBe(BASE + recorded.subtitle.path)
        expect(recorded.subtitle.withoutAuthorization.status).toBe(200)
        expect(recorded.subtitle.withAuthorization.text).toContain("Seanime test subtitle one")
        expect(tracks[0].src).not.toContain(real.token)
        expect(tracks[0].src).not.toMatch(/[?&]/)
        expect(serverSubtitleTracks(real, second.id, second.mediaSources[0])).toEqual([])
        expect(serverSubtitleTracks(real, second.id, undefined)).toEqual([])
    })

    it("invented: ass stays ass, the video's own and picture subtitles are left out", () => {
        const stream = { type: "Subtitle", language: "ger", title: "", isExternal: true, isText: true, isDefault: true }
        const tracks = serverSubtitleTracks(session, "e 1", { id: "m/1", container: "mkv", streams: [
            { ...stream, index: 0, codec: "ASS" },
            { ...stream, index: 1, codec: "mov_text", language: "" },
            { ...stream, index: 2, codec: "subrip", isExternal: false },
            { ...stream, index: 3, codec: "pgssub", isText: false },
            { ...stream, index: 4, codec: "aac", type: "Audio" },
        ] })
        expect(tracks).toEqual([
            { index: 0, src: `${BASE}/Videos/e%201/m%2F1/Subtitles/0/Stream.ass`, label: "ger", language: "ger", type: "ass", default: true },
            { index: 1, src: `${BASE}/Videos/e%201/m%2F1/Subtitles/1/Stream.srt`, label: "External", language: "", type: "srt", default: true },
        ])
    })
})

describe("jellyfin matching, recorded library", () => {
    it("one season over Tvdb (S2): ani.zip's season and episode numbers decide, not the order on AniList", async () => {
        const match = matchTitle(realTitle(1, ["Cowboy Bebop"], 1998, 26), await serverShows(recorded, real))
        expect(match).toMatchObject({ rule: "S2", certain: true, serverId: "recorded-server", seriesId: BEBOP })
        // ani.zip counts AniList's episode 2 as S01E13 and episode 3 as S01E02: the server's second file is episode 3
        expect(pairs(match)).toEqual([[1, BEBOP_E1], [3, BEBOP_E2]])
    })

    it("two seasons that are two AniList titles (S2): each gets its own season, no file twice", async () => {
        const shows = await serverShows(recorded, real)
        const titles = [realTitle(21507, ["Mob Psycho 100"], 2016, 12), realTitle(101338, ["Mob Psycho 100 II"], 2019, 13)]
        const matches = matchLibrary([...titles, realTitle(1, ["Cowboy Bebop"], 1998, 26)], shows)
        expect(matches.map(match => [match.anilistId, match.rule, match.seriesId])).toEqual([[21507, "S2", MOB], [101338, "S2", MOB], [1, "S2", BEBOP]])
        expect(pairs(matches[0])).toEqual([[1, "3930b754c96db8dc2cfe56d3caeccdd3"], [2, "cfb6e41e3864faaf43eba21c6b029d8c"]])
        expect(pairs(matches[1])).toEqual([[1, "f42ba4f705e9e73b2a3f50784ce2c35a"], [2, "d1d7156ba19be3614bfa1a140822bc45"]])
        const files = matches.flatMap(match => match.episodes.map(pair => pair.serverEpisodeId))
        expect(new Set(files).size).toBe(files.length)
    })
})

describe("jellyfin matching, invented cases", () => {
    it("one season (S1): episode = IndexNumber, season 0 left out", async () => {
        const match = matchTitle(title(101, ["Hoshi no Tabi"], 2023, 4), await serverShows(invented, session))
        expect(match).toMatchObject({ rule: "S1", certain: true, serverId: "srv-1", seriesId: "a1" })
        expect(pairs(match)).toEqual([[1, "a1s1e1"], [2, "a1s1e2"], [3, "a1s1e3"], [4, "a1s1e4"]])
    })

    it("three seasons over Tvdb (S2): each title gets its own season", async () => {
        const shows = await serverShows(invented, session)
        const matches = [201, 202, 203].map(id => matchTitle(title(id, [`Kyojin Saga ${id}`], 0, 3), shows))
        expect(matches.map(match => match?.rule)).toEqual(["S2", "S2", "S2"])
        expect(matches.map(pairs)).toEqual([1, 2, 3].map(season => [1, 2, 3].map(episode => [episode, `b1s${season}e${episode}`])))
    })

    it("season 0 only over S2", async () => {
        const shows = await serverShows(invented, session)
        expect(pairs(matchTitle(title(204, ["Kyojin Saga OVA"], 0, 1), shows))).toEqual([[1, "b1s0e1"]])
        // same OVA without ani.zip numbers: no rule may reach the special
        const bare = matchTitle({ ...title(204, ["Kyojin Saga OVA"], 0, 1), metadata: null }, shows)
        expect(bare?.episodes.some(pair => pair.serverEpisodeId.includes("s0"))).not.toBe(true)
    })

    it("counted through (S3): absoluteEpisodeNumber in the one season, not the special", async () => {
        const match = matchTitle(title(302, ["Juuni Cours Part 2"], 2020, 3), await serverShows(invented, session))
        expect(match).toMatchObject({ rule: "S3", certain: true, seriesId: "c1" })
        expect(pairs(match)).toEqual([[1, "c1s1e4"], [2, "c1s1e5"], [3, "c1s1e6"]])
    })

    it("only the title (S4): the matching season, always uncertain", async () => {
        const match = matchTitle(title(400, ["Mori no Uta Season 2"], 2011, 2), await serverShows(invented, session))
        expect(match).toMatchObject({ rule: "S4", certain: false, seriesId: "d1" })
        expect(pairs(match)).toEqual([[1, "d1s2e1"], [2, "d1s2e2"]])
        expect(matchTitle(title(401, ["Mori no Uta Season 2"], 2016, 2), await serverShows(invented, session))).toBeNull()
    })

    it("conflict: no server episode belongs to two titles", async () => {
        const shows = await serverShows(invented, session)
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
