// geschrieben nach: Plan Chamok-Paket 4.2.0 (S2: "Stream behalten", "Nächste Folge vorladen"), dem Test-Double von torrent.test.ts und der Zeile `client:<info hash>` von client.ts; das Gerät (Torrent-Sitzung, Ausgang, Netz) ist hier ein Test-Double, kein Netz, kein Torrent

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { sqlDriverFor } from "@/api/client/core-database"
import { forgetDatabases, openDatabaseSync } from "../../../test/expo-sqlite"
import { type CoreDatabase, openCoreDatabase } from "../database/database"
import { coreAnswerFor } from "../index"
import type { OfflineNetwork } from "../offline/offline"
import { type CoreEnvironment } from "../registry"
import { forgetTorrentClient } from "./client"
import {
    PRELOAD_AT,
    PRELOAD_PRIORITY,
    PRELOAD_RETRY_MS,
    type TorrentDevice,
    type TorrentDeviceFile,
    type TorrentDeviceStatus,
    allLoaded,
    forgetTorrentStream,
    preloadDue,
    preloadedTorrent,
    runningTorrentStream,
    torrentHearsPlayer,
} from "./torrent"

type Json = Record<string, unknown>

const HASH = "ab".repeat(20)
const SHOW = "/storage/emulated/0/Anime/Show"
const BATCH: TorrentDeviceFile[] = [
    { index: 0, path: "Show/[Group] Show - 01 [1080p].mkv", size: 900, pieceStart: 0, pieceEnd: 9 },
    { index: 1, path: "Show/[Group] Show - 02 [1080p].mkv", size: 900, pieceStart: 9, pieceEnd: 19 },
    { index: 2, path: "Show/[Group] Show - 03 [1080p].mkv", size: 950, pieceStart: 19, pieceEnd: 29 },
    { index: 3, path: "Show/notes.txt", size: 1, pieceStart: 29, pieceEnd: 29 },
]
const WIFI: OfflineNetwork = { known: true, connected: true, metered: false }
const MOBILE: OfflineNetwork = { known: true, connected: true, metered: true }

let clock = 0
let database: Promise<CoreDatabase> | null = null
let calls: string[] = []
let listeners: ((statuses: TorrentDeviceStatus[]) => void)[] = []
let network: OfflineNetwork = WIFI
let freeBytes: number | null = null
let moveStorage: TorrentDevice["moveStorage"]
/** The preloads started in the background (environment.unasked) */
let background: Promise<unknown>[] = []

const status = (infoHash: string, more: Partial<TorrentDeviceStatus> = {}): TorrentDeviceStatus => ({
    infoHash, state: "downloading", error: "", hasMetadata: true, progress: 0.25, downRate: 2_500_000, upRate: 0, peers: 3, seeds: 2, bytesDone: 250, bytesWanted: 1000, ...more,
})

const device: TorrentDevice = {
    addMagnet: async uri => {
        calls.push("add")
        return /btih:([0-9a-f]{40})/.exec(uri)?.[1] ?? HASH
    },
    files: async () => BATCH,
    status: async infoHash => status(infoHash, { name: "[Group] Show (01-03)" }),
    setFilePriority: async (_infoHash, index, priority) => void calls.push(`priority ${index}=${priority}`),
    setSequential: async () => undefined,
    setPieceDeadlines: async () => undefined,
    moveStorage: (infoHash, folder) => moveStorage!(infoHash, folder),
    serve: async infoHash => `http://127.0.0.1:40123/${"0f".repeat(16)}/${infoHash}/2/x.mkv`,
    remove: async (infoHash, deleteFiles) => void calls.push(`remove ${infoHash.slice(0, 2)} ${deleteFiles}`),
    stop: async () => void calls.push("stop"),
    onStatus: listener => {
        listeners.push(listener)
        return () => void (listeners = listeners.filter(one => one !== listener))
    },
    wait: async milliseconds => void (clock += milliseconds),
}

const environment = {
    fetch: async (url: string) => {
        throw new TypeError(`no network in tests: ${url}`)
    },
    secret: async () => null,
    database: () => database ??= openCoreDatabase(sqlDriverFor(openDatabaseSync("core.db") as never), () => clock),
    now: () => clock,
    pause: async () => undefined,
    torrent: async () => device,
    offline: async () => ({ network: async () => network, freeBytes: async () => freeBytes }),
    unasked: (_what: string, work: () => Promise<unknown>) => {
        const done = work()
        background.push(done)
        return done
    },
} as unknown as CoreEnvironment

const ask = (method: string, endpoint: string, body?: unknown) => {
    const answer = coreAnswerFor(method, endpoint)
    if (!answer) throw new Error(`not answered by the core: ${endpoint}`)
    return answer({ query: undefined, body }, environment)
}
const settings = (preloadNextStream: boolean) => ask("PATCH", "/api/v1/torrentstream/settings", { settings: { preloadNextStream } })
/** Episode `episodeNumber` of the batch, played in the app's player; the answer is the id of the player's "watch" */
const start = async (episodeNumber: number) => {
    const id = `core-torrent-${clock}`
    await ask("POST", "/api/v1/torrentstream/start", { mediaId: 4242, episodeNumber, aniDBEpisode: String(episodeNumber), autoSelect: false, torrent: { name: "[Group] Show (01-03) [1080p]", infoHash: HASH }, playbackType: "none", clientId: "" })
    return id
}
/** The player's status of the stream at `share` of the episode */
const at = (id: string, share: number) => torrentHearsPlayer({ type: "video-status", payload: { id, currentTime: share * 1440, duration: 1440, paused: false } }, environment)
/** The session's status once per second, the stream's file fully loaded or not */
const tick = (loaded: boolean) => {
    for (const listener of listeners) listener([status(HASH, loaded ? { bytesDone: 950, bytesWanted: 950, progress: 1 } : {})])
}
const closed = () => torrentHearsPlayer({ type: "video-terminated", payload: { id: "p", playbackType: "torrent" } }, environment)
const clientList = () => ask("GET", "/api/v1/torrent-client/list") as Promise<Json[] | null>

beforeEach(() => {
    forgetDatabases()
    database = null
    clock = 1_700_000_000_000
    calls = []
    listeners = []
    network = WIFI
    freeBytes = null
    background = []
    moveStorage = async (_infoHash, folder) => void calls.push(`move ${folder}`)
    forgetTorrentStream()
    forgetTorrentClient()
})
afterEach(async () => {
    await Promise.allSettled(background)
})

describe("the rule of the preload", () => {
    it("lets the stream's own torrent load the next file once the stream's file is loaded or from 90 %; another torrent only with both", () => {
        expect(preloadDue("same", 0.2, true)).toBe(true)
        expect(preloadDue("same", PRELOAD_AT, false)).toBe(true)
        expect(preloadDue("same", 0.89, false)).toBe(false)
        expect(preloadDue("other", 0.95, false)).toBe(false)
        expect(preloadDue("other", 0.5, true)).toBe(false)
        expect(preloadDue("other", PRELOAD_AT, true)).toBe(true)
        expect(preloadDue("none", 1, true)).toBe(false)
        expect(allLoaded(status(HASH, { bytesDone: 10, bytesWanted: 10 }))).toBe(true)
        expect(allLoaded(status(HASH, { bytesDone: 0, bytesWanted: 0 }))).toBe(false)
        expect(allLoaded(null)).toBe(false)
    })
})

describe("preloading the next episode of the same batch (4.2.0)", () => {
    it("gives only the next file the lowest priority, once the stream's file is loaded, and never touches the stream", async () => {
        await settings(true)
        const id = await start(2)
        const running = runningTorrentStream()
        expect(running).toMatchObject({ infoHash: HASH, index: 1 })
        calls = []
        // half watched, still loading: not yet; a status of another player is not this stream's
        tick(false)
        expect(await at(id, 0.5)).toBe("")
        expect(await torrentHearsPlayer({ type: "video-status", payload: { id: "other", currentTime: 1400, duration: 1440 } }, environment)).toBe("")
        expect(calls).toEqual([])
        // the stream's file is there: the next one may come, at the lowest priority
        tick(true)
        expect(await at(id, 0.5)).toBe("preloading the next episode: file 2 of the stream's torrent")
        await Promise.all(background)
        expect(calls).toEqual([`priority 2=${PRELOAD_PRIORITY}`])
        // once per stream; the stream goes on as it was
        expect(await at(id, 0.95)).toBe("")
        expect(calls).toEqual([`priority 2=${PRELOAD_PRIORITY}`])
        expect(runningTorrentStream()).toEqual(running)
        expect(preloadedTorrent()).toBeNull()
    })

    it("starts from 90 % watched even while the stream's file still loads", async () => {
        await settings(true)
        const id = await start(1)
        calls = []
        tick(false)
        expect(await at(id, 0.89)).toBe("")
        expect(await at(id, 0.9)).toContain("file 1 of the stream's torrent")
        await Promise.all(background)
        expect(calls).toEqual([`priority 1=${PRELOAD_PRIORITY}`])
    })

    it("does nothing with the setting off", async () => {
        await settings(false)
        const id = await start(2)
        calls = []
        tick(true)
        expect(await at(id, 0.95)).toBe("")
        clock += PRELOAD_RETRY_MS
        expect(await at(id, 0.99)).toBe("")
        await Promise.all(background)
        expect(calls).toEqual([])
    })

    it("waits on mobile data and goes on once on Wi-Fi", async () => {
        await settings(true)
        network = MOBILE
        const id = await start(2)
        calls = []
        tick(true)
        expect(await at(id, 0.6)).toBe("next episode not preloaded: mobile data")
        network = WIFI
        // asked again only after a while
        expect(await at(id, 0.61)).toBe("")
        clock += PRELOAD_RETRY_MS
        expect(await at(id, 0.7)).toContain("preloading the next episode")
        await Promise.all(background)
        expect(calls).toEqual([`priority 2=${PRELOAD_PRIORITY}`])
    })

    it("has nothing to load after the batch's last episode, and a closed player still takes the stream's torrent", async () => {
        await settings(true)
        const id = await start(3)
        calls = []
        tick(true)
        // a single torrent the user chose (no auto select): no other torrent is looked for
        expect(await at(id, 0.95)).toBe("")
        await Promise.all(background)
        expect(calls).toEqual([])
        expect(await closed()).toBe("torrent stream stopped, its torrent removed with its files")
        expect(calls).toEqual(["remove ab true", "stop"])
    })
})

describe("keeping the stream (4.2.0, \"Keep in library\")", () => {
    it("moves the files into the anime's folder, makes the torrent the client's and keeps it when the player closes", async () => {
        await start(2)
        calls = []
        expect(await ask("POST", "/api/v1/torrentstream/keep", { destination: `file://${SHOW.replace(" ", "%20")}` })).toEqual({ hash: HASH, destination: SHOW })
        // only the move: the priorities stay as the stream set them (the watched file, the others 0)
        expect(calls).toEqual([`move ${SHOW}`])
        expect(runningTorrentStream()).toMatchObject({ infoHash: HASH, index: 1 })
        const list = await clientList()
        expect(list?.map(torrent => [torrent.hash, torrent.contentPath])).toEqual([[HASH, `${SHOW}/[Group] Show (01-03)`]])
        // a second tap changes nothing
        expect(await ask("POST", "/api/v1/torrentstream/keep", { destination: "/elsewhere" })).toEqual({ hash: HASH, destination: SHOW })
        expect(calls).toEqual([`move ${SHOW}`])
        // the player closes: the torrent stays (no removal), the session goes on with the client's download
        expect(await closed()).toBe("torrent stream stopped, its torrent stays in the torrent client")
        expect(calls).toEqual([`move ${SHOW}`])
        expect(runningTorrentStream()).toBeNull()
        // a later stream of the kept torrent leaves its files loading
        calls = []
        await start(3)
        expect(calls.filter(call => call.startsWith("priority"))).toEqual(["priority 2=7"])
    })

    it("leaves everything as it was when the move fails: the stream goes on, the client has no such torrent", async () => {
        await start(2)
        calls = []
        moveStorage = async () => {
            throw new Error("the files cannot be moved: No space left on device")
        }
        await expect(ask("POST", "/api/v1/torrentstream/keep", { destination: SHOW })).rejects.toThrow("the files could not be moved: the files cannot be moved: No space left on device")
        expect(calls).toEqual([])
        expect(runningTorrentStream()).toMatchObject({ infoHash: HASH })
        expect(await clientList()).toBeNull()
        // closing then removes the stream's torrent as always
        await closed()
        expect(calls).toEqual(["remove ab true", "stop"])
    })

    it("cleans up after a failed move when the player closed meanwhile, and never removes the torrent during the move", async () => {
        await start(2)
        calls = []
        moveStorage = async () => {
            await closed()
            // closed during the move: the torrent was not removed under the move
            calls.push("closed")
            throw new Error("the files cannot be moved: Input/output error")
        }
        await expect(ask("POST", "/api/v1/torrentstream/keep", { destination: SHOW })).rejects.toThrow(/could not be moved/)
        expect(calls).toEqual(["closed", "remove ab true", "stop"])
        expect(await clientList()).toBeNull()
    })

    it("refuses without a stream, without a folder and without room for the episode, before anything changes", async () => {
        await expect(ask("POST", "/api/v1/torrentstream/keep", { destination: SHOW })).rejects.toMatchObject({ status: 409 })
        await start(2)
        calls = []
        await expect(ask("POST", "/api/v1/torrentstream/keep", { destination: "content://tree/1" })).rejects.toMatchObject({ status: 400 })
        freeBytes = 899
        await expect(ask("POST", "/api/v1/torrentstream/keep", { destination: SHOW })).rejects.toMatchObject({ status: 507, message: expect.stringContaining("Not enough free space") })
        expect(calls).toEqual([])
        expect(await clientList()).toBeNull()
        freeBytes = 900
        await ask("POST", "/api/v1/torrentstream/keep", { destination: SHOW })
        expect(calls).toEqual([`move ${SHOW}`])
    })
})
