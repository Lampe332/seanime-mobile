// geschrieben nach: docs/EIGENER-KERN.md §4r (Phase 7d: Form des Nakama-Mitschnitts, nur Arten, keine Werte) und den App-Typen Nakama_NakamaStatus/Anime_LibraryCollectionEntry/Anime_Entry (src/api/generated/types.ts); kein Server-Quelltext
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { sqlDriverFor } from "@/api/client/core-database"
import type { Anime_Entry, Anime_LibraryCollectionEntry, Nakama_MessageResponse, Nakama_NakamaStatus } from "@/api/generated/types"
import { mpvHeaderOptions, streamHeadersOf } from "@/main/_features/player/player-logic"
import { forgetDatabases, openDatabaseSync } from "../../../test/expo-sqlite"
import type { HttpFetch } from "../anilist/client"
import { type CoreDatabase, openCoreDatabase } from "../database/database"
import { anilistListEntries, anilistMedia } from "../database/schema"
import { type CoreEvent, onCoreEvent } from "../events"
import { type CoreEnvironment, matchCoreRoute } from "../registry"
import {
    FIRST_PAUSE_MS,
    GUEST_PING_MS,
    NAKAMA_PASSWORD_SECRET,
    NAKAMA_PEER_VERSION,
    type NakamaSocket,
    base64OfText,
    forgetNakamaGuest,
    hostBase,
    nakamaAtStart,
    nakamaStatus,
    withHostLibrary,
} from "./guest"

/*
 * Nakama as a guest (§4r 7e) against the recorded protocol: headers and `auth` of the WebSocket, ping/pong, a new try
 * after a pause, a refused password, the host's library mixed into the own, a host's anime page and playing a host's
 * file with the token as a header. The host, its titles, paths and password are made up.
 */
type Json = Record<string, unknown>
const HOST = "http://127.0.0.1:43299"
const PASSWORD = "made-up-pass"
const SHARED_ID = 7001
const OWN_ID = 7002
const HOST_PATH = "D:\\Made\\Shared Ä\\Made - 01.mkv"

let now = Date.UTC(2026, 10, 14)
let database: CoreDatabase | null = null
const secrets = new Map<string, string>()
const events: CoreEvent[] = []
let stopListening: () => void = () => {}
let hostRequests: { url: string, headers: Record<string, string> }[] = []

type FakeSocket = NakamaSocket & { url: string, headers: Record<string, string>, sent: Json[], closed: boolean }
let sockets: FakeSocket[] = []

function openSocket(url: string, headers: Record<string, string>): NakamaSocket {
    const socket: FakeSocket = { url, headers, sent: [], closed: false, onopen: null, onmessage: null, onclose: null, onerror: null,
        send: text => void socket.sent.push(JSON.parse(text) as Json), close: () => void (socket.closed = true) }
    sockets.push(socket)
    return socket
}
const last = () => sockets[sockets.length - 1]
const hostSays = (socket: FakeSocket, type: string, payload: unknown = null) => socket.onmessage?.({ data: JSON.stringify({ type, payload, timestamp: new Date(now).toISOString() }) })

const media = (id: number) => ({ id, status: "FINISHED", episodes: 3, format: "TV", title: { userPreferred: `Made ${id}` } })
const hostFile = (id: number, episode: number, path = `D:\\Made\\${id}\\${episode}.mkv`) => ({
    path, name: path.slice(path.lastIndexOf("\\") + 1), parsedInfo: {}, parsedFolderInfo: [], metadata: { episode, aniDBEpisode: String(episode), type: "main" },
    locked: false, ignored: false, mediaId: id,
})
const hostLibrary = {
    localFiles: [hostFile(SHARED_ID, 1, HOST_PATH), hostFile(SHARED_ID, 2), hostFile(OWN_ID, 1)],
    animeCollection: { MediaListCollection: { lists: [{ name: "Watching", status: "CURRENT", isCustomList: false, entries: [{ media: media(SHARED_ID) }, { media: media(OWN_ID) }] }] } },
}

const httpFetch: HttpFetch = async (url, init) => {
    if (url.startsWith(HOST)) {
        hostRequests.push({ url, headers: init.headers ?? {} })
        const path = url.slice(HOST.length)
        const data = path === "/api/v1/nakama/host/anime/library" ? hostLibrary
            : path === `/api/v1/nakama/host/anime/library/files/${SHARED_ID}` ? { localFiles: hostLibrary.localFiles.filter(file => file.mediaId === SHARED_ID) }
                : path === "/api/v1/nakama/host/anime/library/shared" ? true : undefined
        return { status: data === undefined ? 404 : 200, headers: { get: () => null }, text: async () => JSON.stringify({ data }) }
    }
    throw new TypeError(`no network in tests: ${url}`)
}

const environment = {
    fetch: httpFetch,
    secret: async (name: string) => secrets.get(name) ?? null,
    keepSecret: async (name: string, value: string | null) => void (value === null ? secrets.delete(name) : secrets.set(name, value)),
    database: async () => database ??= await openCoreDatabase(sqlDriverFor(openDatabaseSync("core.db") as never), () => now),
    now: () => now,
    pause: async () => {},
    nakamaSocket: openSocket,
} as unknown as CoreEnvironment

async function ask(method: string, endpoint: string, body: unknown = null): Promise<unknown> {
    const matched = matchCoreRoute(method, endpoint)
    if (!matched) throw new Error(`no route: ${method} ${endpoint}`)
    return matched.route.answer({ path: matched.path, query: null, body }, environment)
}

/** First start with Nakama on, the password saved like the settings screen does (one field) */
async function setUp(nakama: Json = {}) {
    await ask("POST", "/api/v1/start", { nakama: { enabled: true, username: "tablet", remoteServerURL: "127.0.0.1:43299/", includeNakamaAnimeLibrary: true, ...nakama } })
    await ask("PATCH", "/api/v1/settings/path", { path: "nakama.remoteServerPassword", value: PASSWORD })
    await vi.waitFor(() => expect(sockets.length).toBeGreaterThan(0))
}

async function connected() {
    await setUp()
    last().onopen?.()
    hostSays(last(), "auth_reply", { success: true, message: "ok", username: "Made Host", peerId: "x" })
}

beforeEach(async () => {
    forgetDatabases()
    forgetNakamaGuest()
    database = null
    secrets.clear()
    events.length = 0
    sockets = []
    hostRequests = []
    stopListening = onCoreEvent(event => void events.push(event))
    const opened = await environment.database()
    const [own] = await opened.insert(anilistMedia).values({ anilistId: SHARED_ID, kind: "ANIME", content: media(SHARED_ID), changedAt: now }).returning({ id: anilistMedia.id })
    await opened.insert(anilistListEntries).values({ anilistId: 1, media: own.id, kind: "ANIME", list: 0, position: 0,
        content: { id: 1, progress: 1, status: "CURRENT", score: 0, repeat: 0, startedAt: {}, completedAt: {}, createdAt: 1, updatedAt: 2 }, changedAt: now })
    await opened.insert(anilistMedia).values({ anilistId: OWN_ID, kind: "ANIME", content: media(OWN_ID), changedAt: now })
})

afterEach(() => {
    stopListening()
    forgetNakamaGuest()
    vi.useRealTimers()
})

describe("connection (recorded protocol)", () => {
    it("opens the WebSocket with the four headers and authenticates with the first message", async () => {
        await setUp()
        const socket = last()
        expect(socket.url).toBe("ws://127.0.0.1:43299/api/v1/nakama/ws")
        expect(Object.keys(socket.headers).sort()).toEqual(["X-Seanime-Nakama-Peer-Id", "X-Seanime-Nakama-Server-Version", "X-Seanime-Nakama-Token", "X-Seanime-Nakama-Username"])
        expect(socket.headers["X-Seanime-Nakama-Token"]).toBe(PASSWORD)
        expect(socket.headers["X-Seanime-Nakama-Username"]).toBe("tablet")
        expect(socket.headers["X-Seanime-Nakama-Server-Version"]).toBe(NAKAMA_PEER_VERSION)
        expect(socket.headers["X-Seanime-Nakama-Peer-Id"]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
        socket.onopen?.()
        expect(socket.sent).toEqual([{ type: "auth", payload: { password: PASSWORD, peerId: socket.headers["X-Seanime-Nakama-Peer-Id"] }, timestamp: new Date(now).toISOString() }])
        expect(nakamaStatus().isConnectedToHost).toBe(false)
        hostSays(socket, "auth_reply", { success: true, message: "ok", username: "Made Host", peerId: "x" })
        const status = nakamaStatus() as Nakama_NakamaStatus
        expect(status).toEqual({
            isHost: false, connectedPeers: [], isConnectedToHost: true, connectionMode: "direct",
            hostConnectionStatus: { connected: true, authenticated: true, url: HOST, lastPing: new Date(now).toISOString(), peerId: socket.headers["X-Seanime-Nakama-Peer-Id"], username: "Made Host", connectionMode: "direct" },
        } satisfies Nakama_NakamaStatus)
        await vi.waitFor(() => expect(events.map(event => event.type)).toContain("nakama-host-connected"))
        expect(events.filter(event => event.type === "nakama-status").at(-1)?.payload).toEqual(status)
    })

    it("answers the host's ping with pong and pings every 30 s itself", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] })
        await connected()
        const socket = last()
        socket.sent.length = 0
        hostSays(socket, "ping")
        expect(socket.sent.map(sent => sent.type)).toEqual(["pong"])
        vi.advanceTimersByTime(GUEST_PING_MS)
        expect(socket.sent.map(sent => sent.type)).toEqual(["pong", "ping"])
        expect(socket.sent[1].payload).toBeNull()
    })

    it("tries again after a pause when the connection is lost, the pause doubles, the same peer id", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] })
        await connected()
        const first = last()
        first.onclose?.()
        vi.advanceTimersByTime(0)
        expect(events.map(event => event.type)).toContain("nakama-host-disconnected")
        expect(nakamaStatus().isConnectedToHost).toBe(false)
        vi.advanceTimersByTime(FIRST_PAUSE_MS - 1)
        expect(sockets).toHaveLength(1)
        // (the 0 ms above count to the pause)
        vi.advanceTimersByTime(1)
        expect(sockets).toHaveLength(2)
        expect(last().headers["X-Seanime-Nakama-Peer-Id"]).toBe(first.headers["X-Seanime-Nakama-Peer-Id"])
        last().onerror?.({})
        vi.advanceTimersByTime(FIRST_PAUSE_MS)
        expect(sockets).toHaveLength(2)
        vi.advanceTimersByTime(FIRST_PAUSE_MS)
        expect(sockets).toHaveLength(3)
        // a late event of an old socket changes nothing
        first.onclose?.()
        vi.advanceTimersByTime(60_000)
        expect(sockets).toHaveLength(3)
    })

    it("a refused password: an error, the socket closed, no new try until asked", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] })
        await setUp()
        const socket = last()
        socket.onopen?.()
        hostSays(socket, "auth_reply", { success: false, message: "Invalid password", username: "", peerId: "" })
        vi.advanceTimersByTime(0)
        expect(events.find(event => event.type === "nakama-error")?.payload).toEqual({ message: "Invalid password" })
        expect(socket.closed).toBe(true)
        vi.advanceTimersByTime(120_000)
        expect(sockets).toHaveLength(1)
        const answer = await ask("POST", "/api/v1/nakama/reconnect", {}) as Nakama_MessageResponse
        expect(answer).toEqual({ success: true, message: "Reconnecting to host" })
        expect(sockets).toHaveLength(2)
    })

    it("Nakama off ends the connection; no host set: reconnect says so; at start it connects once", async () => {
        await connected()
        await ask("PATCH", "/api/v1/settings/path", { path: "nakama.enabled", value: false })
        await vi.waitFor(() => expect(last().closed).toBe(true))
        expect(nakamaStatus()).toEqual({ isHost: false, connectedPeers: [], isConnectedToHost: false, connectionMode: "direct" })
        await expect(ask("POST", "/api/v1/nakama/reconnect", {})).rejects.toThrow("No Nakama host is set up")
        await ask("PATCH", "/api/v1/settings/path", { path: "nakama.enabled", value: true })
        await vi.waitFor(() => expect(sockets).toHaveLength(2))
        forgetNakamaGuest()
        nakamaAtStart(environment)
        nakamaAtStart(environment)
        await vi.waitFor(() => expect(sockets).toHaveLength(3))
    })
})

describe("settings", () => {
    it("keeps the password in the secured storage, the settings hold \"\", the status shows it", async () => {
        await setUp()
        expect(secrets.get(NAKAMA_PASSWORD_SECRET)).toBe(PASSWORD)
        const status = await ask("GET", "/api/v1/status") as { settings: { nakama: Json } }
        expect(status.settings.nakama.remoteServerPassword).toBe(PASSWORD)
        const rows = JSON.stringify(await (await environment.database()).select().from((await import("../database/schema")).settingsSections))
        expect(rows).not.toContain(PASSWORD)
        expect(hostBase("pc.local:43211")).toBe("http://pc.local:43211")
        expect(hostBase(" https://pc/ ")).toBe("https://pc")
    })
})

describe("the host's library", () => {
    it("mixes the host's anime without own files into the lists as Nakama entries", async () => {
        await connected()
        const ownEntry = { media: media(OWN_ID), mediaId: OWN_ID, libraryData: { allFilesLocked: false, sharedPath: "", unwatchedCount: 0, mainFileCount: 1 } }
        const collection = await withHostLibrary({ lists: [{ type: "CURRENT", status: "CURRENT", entries: [ownEntry] }], stream: {} }, environment) as { lists: { status: string, entries: Anime_LibraryCollectionEntry[] }[], stream: Json }
        expect(collection.stream).toEqual({})
        const entries = collection.lists.flatMap(list => list.entries)
        const shared = entries.find(entry => entry.mediaId === SHARED_ID)!
        expect(shared).toEqual({ media: media(SHARED_ID), mediaId: SHARED_ID, nakamaLibraryData: { unwatchedCount: 1, mainFileCount: 2 }, listData: expect.objectContaining({ progress: 1, status: "CURRENT" }) })
        expect(shared.libraryData).toBeUndefined()
        expect(collection.lists.find(list => list.status === "CURRENT")?.entries).toContain(shared)
        // an anime with own files stays the user's, once
        expect(entries.filter(entry => entry.mediaId === OWN_ID)).toEqual([ownEntry])
        expect(hostRequests.every(request => request.headers["X-Seanime-Nakama-Token"] === PASSWORD)).toBe(true)
    })

    it("leaves the library alone without `includeNakamaAnimeLibrary` or a connection", async () => {
        await setUp({ includeNakamaAnimeLibrary: false })
        last().onopen?.()
        hostSays(last(), "auth_reply", { success: true, message: "ok", username: "Made Host", peerId: "x" })
        const own = { lists: [{ type: "CURRENT", status: "CURRENT", entries: [] }] }
        expect(await withHostLibrary(own, environment)).toBe(own)
        forgetNakamaGuest()
        expect(await withHostLibrary(own, environment)).toBe(own)
        expect(hostRequests).toEqual([])
        expect(matchCoreRoute("GET", "/api/v1/library/collection")).not.toBeNull()
    })

    it("an anime only the host has: its page shows the host's files as Nakama episodes", async () => {
        await connected()
        const entry = await ask("GET", `/api/v1/library/anime-entry/${SHARED_ID}`) as Anime_Entry
        expect(entry._isNakamaEntry).toBe(true)
        expect(entry.libraryData?.mainFileCount).toBe(2)
        expect(entry.episodes?.map(episode => [episode.episodeNumber, episode._isNakamaEpisode, episode.localFile?.path])).toEqual([[1, true, HOST_PATH], [2, true, "D:\\Made\\7001\\2.mkv"]])
        expect(entry.nextEpisode?.episodeNumber).toBe(2)
        expect(await ask("GET", "/api/v1/nakama/host/anime/library/shared")).toBe(true)
    })

    it("plays a host's file straight from the host, the token as a header, never in the address", async () => {
        await connected()
        expect(await ask("POST", "/api/v1/nakama/play", { path: HOST_PATH, mediaId: SHARED_ID, anidbEpisode: "1", clientId: "c" })).toBe(true)
        await vi.waitFor(() => expect(events.some(event => event.type === "native-player")).toBe(true))
        const watch = events.find(event => event.type === "native-player")?.payload as { type: string, payload: Json }
        expect(watch.type).toBe("watch")
        const info = watch.payload
        expect(info.streamType).toBe("nakama")
        expect(info.streamUrl).toBe(`${HOST}/api/v1/nakama/host/anime/library/stream?path=${encodeURIComponent(base64OfText(HOST_PATH))}`)
        expect(String(info.streamUrl)).not.toContain(PASSWORD)
        expect((info.episode as Json)._isNakamaEpisode).toBe(true)
        expect((info.media as Json).id).toBe(SHARED_ID)
        expect(mpvHeaderOptions(streamHeadersOf(info))).toEqual([["http-header-fields", `X-Seanime-Nakama-Token: ${PASSWORD}`]])
        // any other file clears the fields of the one before
        expect(mpvHeaderOptions(streamHeadersOf({ streamType: "localfile" }))).toEqual([["http-header-fields", ""]])
        await expect(ask("POST", "/api/v1/nakama/play", { path: "D:\\other.mkv", mediaId: SHARED_ID })).rejects.toThrow("not in the host's library")
    })

    it("Base64 of a path as UTF-8 (as the host reads it)", () => {
        expect(base64OfText("D:\\a")).toBe("RDpcYQ==")
        expect(base64OfText("Ä")).toBe("w4Q=")
        expect(base64OfText("abc")).toBe("YWJj")
    })
})
