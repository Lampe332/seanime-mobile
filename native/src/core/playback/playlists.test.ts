// geschrieben nach: playlists.recorded.json (Form der Aufzeichnung PLAYLIST.* vom 13.11.2026, Werte erfunden), App-Code global-playlist-manager.tsx / mobile-playlists.tsx und docs/EIGENER-KERN.md §4p; Server, AniList und ani.zip sind hier Test-Doubles, keine Anfrage verlässt den Test

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { sqlDriverFor } from "@/api/client/core-database"
import { forgetDatabases, openDatabaseSync } from "../../../test/expo-sqlite"
import { type CoreDatabase, openCoreDatabase } from "../database/database"
import { anilistListEntries, anilistMedia, playlistMove, playlists } from "../database/schema"
import { type CoreEvent, onCoreEvent } from "../events"
import { METADATA_URL } from "../library/metadata"
import { type CoreEnvironment, matchCoreRoute } from "../registry"
import { forgetPlaying } from "./playback"
import { forgetRunningPlaylist, hearPlaylist } from "./playlists"
import recorded from "./playlists.recorded.json"

type Json = Record<string, unknown>

const MEDIA = 4242
let clock = 0
let database: Promise<CoreDatabase> | null = null
let serverAsked: { method: string, endpoint: string, body?: unknown }[] = []
let serverRows: Record<string, unknown>[] | null | Error = null
let serverRowsRead = 0
let events: CoreEvent[] = []
let stopListening: () => void = () => undefined

const service = {
    titles: { "x-jat": "Meido" }, episodeCount: 3, specialCount: 0, images: [],
    episodes: Object.fromEntries([1, 2, 3].map(n => [String(n), { episodeNumber: n, absoluteEpisodeNumber: n, title: { en: `Made ${n}` }, airDate: "2020-04-01", image: `https://img.example/${n}.jpg`, anidbEid: 500 + n, length: 24 }])),
    mappings: { anilist_id: MEDIA, anidb_id: 77, type: "TV" },
}

const environment = {
    fetch: async (url: string) => {
        if (url === METADATA_URL + MEDIA) return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify(service) }
        throw new TypeError(`no network in tests: ${url}`)
    },
    secret: async () => "token",
    server: async (method: string, endpoint: string, body?: unknown) => {
        serverAsked.push({ method, endpoint, body })
        if (endpoint === "/api/v1/status") return { settings: { library: { autoUpdateProgress: true, enableWatchContinuity: false } } }
        if (method === "GET" && endpoint.startsWith("/api/v1/library/anime-entry/")) return { listData: { progress: 0 } }
        return true
    },
    database: () => database ??= openCoreDatabase(sqlDriverFor(openDatabaseSync("core.db") as never), () => clock),
    now: () => clock,
    pause: async () => undefined,
    serverPlaylists: async () => {
        serverRowsRead++
        if (serverRows instanceof Error) throw serverRows
        return serverRows
    },
} as unknown as CoreEnvironment

async function ask(method: string, endpoint: string, body?: unknown, query?: unknown): Promise<unknown> {
    const matched = matchCoreRoute(method, endpoint)
    if (!matched) throw new Error(`no route: ${method} ${endpoint}`)
    return matched.route.answer({ path: matched.path, query, body }, environment)
}

const episode = (n: number, isCompleted = false) => ({
    episode: { episodeNumber: n, progressNumber: n, aniDBEpisode: String(n), baseAnime: { id: MEDIA, episodes: 3, title: { userPreferred: "Meido" } } },
    isCompleted, watchType: "online", isNakama: false,
})
const said = async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
    const out = events.filter(event => event.type === "playlist").map(event => event.payload as { type: string, payload: Json })
    events = []
    return out
}

beforeEach(() => {
    forgetDatabases()
    forgetPlaying()
    forgetRunningPlaylist()
    database = null
    clock = 1_000_000
    serverAsked = []
    serverRows = null
    serverRowsRead = 0
    events = []
    stopListening = onCoreEvent(event => void events.push(event))
})
afterEach(() => {
    stopListening()
})

describe("playlist interfaces (recorded form)", () => {
    it("lists, creates, updates and deletes like the recording, the server's dbId 0 on creating aside", async () => {
        expect(await ask("GET", "/api/v1/playlists")).toEqual(recorded.listEmpty)
        // the server answered the new playlist with dbId 0 (before saving); the core gives the number it saved under
        expect(await ask("POST", "/api/v1/playlist", recorded.create.request)).toEqual(recorded.create.response)
        expect(await ask("GET", "/api/v1/playlists")).toEqual(recorded.listAfterCreate)
        expect(await ask("PATCH", "/api/v1/playlist", recorded.update.request)).toEqual(recorded.update.response)
        expect(await ask("GET", "/api/v1/playlists")).toEqual(recorded.listAfterUpdate)
        expect(await ask("DELETE", "/api/v1/playlist", recorded.delete.request)).toBe(recorded.delete.response)
        expect(await ask("GET", "/api/v1/playlists")).toEqual(recorded.listAfterDelete)
    })

    it("keeps the playlists oldest first and their episodes in the order given", async () => {
        await ask("POST", "/api/v1/playlist", { name: "a", episodes: [episode(3), episode(1)] })
        await ask("POST", "/api/v1/playlist", { name: "b", episodes: [episode(2)] })
        await ask("PATCH", "/api/v1/playlist", { dbId: 1, name: "a", episodes: [episode(1), episode(2), episode(3)] })
        const list = await ask("GET", "/api/v1/playlists") as { name: string, episodes: ReturnType<typeof episode>[] }[]
        expect(list.map(one => one.name)).toEqual(["a", "b"])
        expect(list[0].episodes.map(one => one.episode.episodeNumber)).toEqual([1, 2, 3])
    })

    it("refuses what is not a playlist and an unknown one", async () => {
        await expect(ask("POST", "/api/v1/playlist", { episodes: [] })).rejects.toMatchObject({ status: 400 })
        await expect(ask("POST", "/api/v1/playlist", { name: "x", episodes: "no" })).rejects.toMatchObject({ status: 400 })
        await expect(ask("PATCH", "/api/v1/playlist", { dbId: 9, name: "x", episodes: [] })).rejects.toMatchObject({ status: 404 })
    })

    it("gives an anime's episodes to pick from, watched up to the list's progress, the watch type left to the screen", async () => {
        const opened = await environment.database()
        const media = { id: MEDIA, status: "FINISHED", type: "ANIME", format: "TV", episodes: 3, title: { userPreferred: "Meido" }, coverImage: {}, startDate: {}, endDate: {} }
        const [row] = await opened.insert(anilistMedia).values({ anilistId: MEDIA, kind: "ANIME", content: media, changedAt: clock }).returning({ id: anilistMedia.id })
        await opened.insert(anilistListEntries).values({ anilistId: 1, media: row.id, kind: "ANIME", list: 0, position: 0, content: { id: 1, progress: 2, status: "CURRENT" }, changedAt: clock })
        const answer = await ask("GET", `/api/v1/playlist/episodes/${MEDIA}`) as { episode: Json, isCompleted: boolean, watchType: string, isNakama: boolean }[]
        expect(answer.map(one => [one.episode.progressNumber, one.isCompleted, one.watchType, one.isNakama])).toEqual([[1, true, "", false], [2, true, "", false], [3, false, "", false]])
        expect(record(answer[0].episode.baseAnime).id).toBe(MEDIA)
        // a progress in the query counts over the list's
        const asked = await ask("GET", `/api/v1/playlist/episodes/${MEDIA}`, undefined, { progress: 0 }) as { isCompleted: boolean }[]
        expect(asked.every(one => !one.isCompleted)).toBe(true)
    })
})

function record(value: unknown): Json {
    return typeof value === "object" && value !== null ? value as Json : {}
}

describe("move of the server's playlists", () => {
    it("takes them once, in their order, episodes from the stored value", async () => {
        const bytes = new TextEncoder().encode(JSON.stringify([episode(1), episode(2)]))
        serverRows = [
            { id: 5, name: "second", value: JSON.stringify({ episodes: [episode(3)] }) },
            { id: 2, name: "first", value: bytes },
            { id: 7, name: "broken", value: "{no json" },
        ]
        const list = await ask("GET", "/api/v1/playlists") as { dbId: number, name: string, episodes: unknown[] }[]
        expect(list.map(one => [one.dbId, one.name, one.episodes.length])).toEqual([[1, "first", 2], [2, "second", 1], [3, "broken", 0]])
        const opened = await environment.database()
        expect(await opened.select().from(playlistMove)).toEqual([{ id: 1, outcome: "moved", count: 3, reason: "1 without readable episodes", movedAt: clock }])
        // never again, also not after the user deleted them all
        for (const one of list) await ask("DELETE", "/api/v1/playlist", { dbId: one.dbId })
        expect(await ask("GET", "/api/v1/playlists")).toEqual([])
        expect(serverRowsRead).toBe(1)
    })

    it("notes a missing server database and a failed read without taking anything", async () => {
        await ask("GET", "/api/v1/playlists")
        const opened = await environment.database()
        expect((await opened.select().from(playlistMove))[0]).toMatchObject({ outcome: "missing", count: 0 })
        forgetDatabases()
        forgetRunningPlaylist()
        database = null
        serverRows = new Error("not readable")
        expect(await ask("GET", "/api/v1/playlists")).toEqual([])
        expect((await (await environment.database()).select().from(playlistMove))[0]).toMatchObject({ outcome: "failed", reason: "not readable" })
        expect(await (await environment.database()).select().from(playlists)).toEqual([])
    })
})

describe("the running playlist (channel `playlist`)", () => {

    it("answers which one plays, stops, and stops when its playlist is deleted", async () => {
        await ask("POST", "/api/v1/playlist", { name: "p", episodes: [episode(1), episode(2)] })
        await hearPlaylist({ type: "current-playlist" }, environment)
        expect(await said()).toEqual([{ type: "current-playlist", payload: { playlist: null, playlistEpisode: null } }])
        expect(await hearPlaylist({ type: "start-playlist", payload: { dbId: 9 } }, environment)).toBe("no playlist 9 to start")
        await hearPlaylist({ type: "start-playlist", payload: { dbId: 1 } }, environment)
        await said()
        expect(await hearPlaylist({ type: "stop-playlist" }, environment)).toBe("stopped the playlist")
        expect((await said())[0].payload).toEqual({ playlist: null, playlistEpisode: null })
        await hearPlaylist({ type: "start-playlist", payload: { dbId: 1 } }, environment)
        await said()
        await ask("PATCH", "/api/v1/playlist", { dbId: 1, name: "p", episodes: [episode(2), episode(1)] })
        expect(record((await said())[0].payload.playlistEpisode).episode).toMatchObject({ episodeNumber: 1 })
        await ask("DELETE", "/api/v1/playlist", { dbId: 1 })
        expect((await said())[0].payload).toEqual({ playlist: null, playlistEpisode: null })
    })
})
