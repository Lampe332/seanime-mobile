// geschrieben nach: Form der Aufzeichnungen TORRENT_CLIENT.GetActiveTorrentList (leere Liste: data null), TorrentClientAction und TorrentClientDownload vom 13.11.2026 (nur Feldnamen und Arten), App-Typ TorrentClient_Torrent und App-Code torrent-downloads.tsx / torrent-search-phone.tsx; das Gerät (Torrent-Sitzung mit Resume-Daten) ist hier ein Test-Double, kein Netz, kein Torrent

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { sqlDriverFor } from "@/api/client/core-database"
import { forgetDatabases, openDatabaseSync } from "../../../test/expo-sqlite"
import { type CoreDatabase, openCoreDatabase } from "../database/database"
import { coreAnswerFor } from "../index"
import type { CoreEnvironment } from "../registry"
import { clientStatusOf, etaOf, forgetTorrentClient, resumeClientAtStart } from "./client"
import { settingsSections } from "../database/schema"
import { type TorrentDevice, type TorrentDeviceFile, type TorrentDeviceStatus, type TorrentLimits, forgetTorrentStream, limitsOf } from "./torrent"
import type { OngoingNotice, TorrentNotices } from "./torrent-notice"

type Json = Record<string, unknown>

/** The fields of TorrentClient_Torrent and their kinds (`addedAt` optional) */
const TORRENT_FIELDS: Record<string, string> = {
    name: "string", hash: "string", seeds: "number", upSpeed: "string", downSpeed: "string", progress: "number", size: "string", eta: "string",
    status: "string", contentPath: "string", peers: "number", ratio: "number", addedAt: "string", queueIndex: "number", forceStart: "boolean", sequential: "boolean", error: "string",
}
const STATUSES = ["downloading", "seeding", "paused", "other", "stopped", "queued", "error"]

const BATCH = "ab".repeat(20)
const SINGLE = "cd".repeat(20)
const FILES: TorrentDeviceFile[] = [
    { index: 0, path: "Show/[Group] Show - 01 [1080p].mkv", size: 900, pieceStart: 0, pieceEnd: 9 },
    { index: 1, path: "Show/[Group] Show - 02 [1080p].mkv", size: 900, pieceStart: 9, pieceEnd: 19 },
    { index: 2, path: "Show/[Group] Show - 03 [1080p].mkv", size: 950, pieceStart: 19, pieceEnd: 29 },
    { index: 3, path: "Show/Extras/[Group] Show - NCOP1 [1080p].mkv", size: 100, pieceStart: 29, pieceEnd: 30 },
]

/** What the module keeps on its disk across restarts: the resume data of every torrent */
type Saved = { folder: string, paused: boolean, priorities: Record<number, number>, state: string }
let disk = new Map<string, Saved>()
let calls: string[] = []
let held: boolean[] = []
let listeners: ((statuses: TorrentDeviceStatus[]) => void)[] = []
let clock = 0
let database: Promise<CoreDatabase> | null = null
/** Whether the session has the torrents' file lists (false: a magnet without peers yet) */
let metadata = true
/** The phone's free bytes (null: not known) */
let free: number | null = null
/** What the device's notices got (torrent-notice.ts) */
let updates: OngoingNotice[] = []
let ends: string[] = []
let asks = 0

/** The device with its notices, in English */
function withNotices(device: TorrentDevice): TorrentDevice {
    const notices: TorrentNotices = {
        t: english => english,
        update: async notice => {
            updates.push(notice)
            return true
        },
        end: async (_hash, title) => {
            ends.push(title)
            return true
        },
        ask: async () => void asks++,
    }
    return Object.assign(device, { notices })
}

/** One run of the app: a session that brings back what the disk holds when it is first used */
function deviceRun(): TorrentDevice {
    let session: Map<string, Saved> | null = null
    const open = () => session ??= new Map([...disk].map(([hash, saved]) => [hash, saved]))
    const one = (infoHash: string) => {
        const found = open().get(infoHash)
        if (!found) throw new Error("ERR_TORRENT: the session has no such torrent")
        return found
    }
    const statusOf = (infoHash: string): TorrentDeviceStatus => {
        const saved = one(infoHash)
        return {
            infoHash, name: infoHash === BATCH ? "[Group] Show (01-03)" : "Single", state: saved.paused ? "paused" : metadata ? saved.state : "metadata", error: "", hasMetadata: metadata,
            progress: saved.state === "seeding" ? 1 : 0.5, downRate: saved.paused ? 0 : 1_000_000, upRate: 0, peers: 1, seeds: 1, bytesDone: 500_000_000, bytesWanted: 1_000_000_000,
        }
    }
    const add = (uri: string, folder?: string) => {
        const infoHash = /btih:([0-9a-f]{40})/.exec(uri)?.[1] ?? BATCH
        calls.push(`add ${infoHash.slice(0, 2)} ${folder ?? "-"}`)
        if (!open().has(infoHash)) {
            const saved = { folder: folder ?? "/cache", paused: false, priorities: {}, state: "downloading" }
            open().set(infoHash, saved)
            disk.set(infoHash, saved)
        }
        return infoHash
    }
    return {
        addMagnet: async (uri, folder) => add(uri, folder),
        files: async infoHash => (one(infoHash), infoHash === BATCH ? FILES : [FILES[0]]),
        status: async infoHash => statusOf(infoHash),
        setFilePriority: async (infoHash, index, priority) => {
            one(infoHash).priorities[index] = priority
            calls.push(`priority ${index}=${priority}`)
        },
        setSequential: async () => undefined,
        setPaused: async (infoHash, paused) => {
            one(infoHash).paused = paused
            calls.push(`${paused ? "pause" : "resume"} ${infoHash.slice(0, 2)}`)
        },
        setPieceDeadlines: async () => undefined,
        serve: async () => "",
        remove: async (infoHash, deleteFiles) => {
            one(infoHash)
            open().delete(infoHash)
            disk.delete(infoHash)
            calls.push(`remove ${infoHash.slice(0, 2)} ${deleteFiles}`)
        },
        stop: async () => void calls.push("stop"),
        onStatus: listener => {
            listeners.push(listener)
            return () => void (listeners = listeners.filter(other => other !== listener))
        },
        keepRunning: async on => {
            held.push(on)
            return true
        },
        wait: async ms => void (clock += ms),
    }
}

let current: TorrentDevice = deviceRun()

const environment = {
    fetch: async (url: string) => {
        throw new TypeError(`no network in tests: ${url}`)
    },
    secret: async () => null,
    server: async () => {
        throw new Error("the server is not asked")
    },
    database: () => database ??= openCoreDatabase(sqlDriverFor(openDatabaseSync("core.db") as never), () => clock),
    now: () => clock,
    pause: async () => undefined,
    torrent: async () => current,
    offline: async () => ({ freeBytes: async () => free }),
} as unknown as CoreEnvironment

const ask = (method: string, endpoint: string, body?: unknown) => {
    const answer = coreAnswerFor(method, `/api/v1/torrent-client/${endpoint}`)
    if (!answer) throw new Error(`not answered by the core: ${endpoint}`)
    return answer({ query: undefined, body }, environment) as Promise<unknown>
}
const list = () => ask("GET", "list") as Promise<Json[] | null>
const act = (hash: string, action: string) => ask("POST", "action", { hash, action })
const download = (more: Json = {}) => ask("POST", "download", {
    torrents: [{ name: "[Group] Show (01-03)", infoHash: BATCH, provider: "test" }],
    destination: "/storage/emulated/0/Anime/Show",
    smartSelect: { enabled: true, missingEpisodeNumbers: [2, 3] },
    media: { id: 4242 },
    ...more,
})
const settled = () => new Promise(resolve => setTimeout(resolve, 0))

beforeEach(() => {
    forgetDatabases()
    database = null
    clock = 1_700_000_000_000
    disk = new Map()
    calls = []
    held = []
    listeners = []
    metadata = true
    free = null
    updates = []
    ends = []
    asks = 0
    current = deviceRun()
    forgetTorrentStream()
    forgetTorrentClient()
})
afterEach(() => {
    forgetTorrentClient()
})

describe("torrent client in the core", () => {
    it("answers an empty list as recorded (data null) without starting a session", async () => {
        expect(await list()).toBeNull()
        expect(calls).toEqual([])
    })

    it("downloads into the library's folder with only the missing episodes, listed in the app's form", async () => {
        expect(await download()).toBe(true)
        expect(calls).toEqual(["add ab /storage/emulated/0/Anime/Show", "priority 0=0", "priority 3=0"])
        const [torrent] = (await list())!
        expect(Object.keys(torrent).sort()).toEqual(Object.keys(TORRENT_FIELDS).sort())
        for (const [field, kind] of Object.entries(TORRENT_FIELDS)) expect(typeof torrent[field], field).toBe(kind)
        expect(torrent).toMatchObject({ hash: BATCH, name: "[Group] Show (01-03)", status: "downloading", progress: 0.5, size: "1.0 GB", contentPath: "/storage/emulated/0/Anime/Show/[Group] Show (01-03)" })
        expect(torrent.eta).toMatch(/^(\d+) (hour|minute|second)s? left$/)
        // the process is held while it loads
        expect(held).toEqual([true])
    })

    it("pauses, resumes and removes with or without the files", async () => {
        await download({ smartSelect: { enabled: false, missingEpisodeNumbers: [] } })
        await download({ torrents: [{ name: "Single", infoHash: SINGLE }] })
        expect(await act(BATCH, "pause")).toBe(true)
        expect((await list())!.map(torrent => torrent.status)).toEqual(["paused", "downloading"])
        await act(BATCH, "resume")
        expect((await list())![0].status).toBe("downloading")
        await act(BATCH, "remove")
        await act(SINGLE, "remove-keep-files")
        expect(calls.filter(call => /^(pause|resume|remove)/.test(call))).toEqual(["pause ab", "resume ab", "remove ab true", "remove cd false"])
        expect(await list()).toBeNull()
    })

    it("refuses what the phone cannot do and torrents it does not have", async () => {
        await download()
        await expect(act(BATCH, "open")).rejects.toMatchObject({ status: 400, message: "opening a folder is not available on the phone" })
        await expect(act(BATCH, "set-limits")).rejects.toMatchObject({ status: 400 })
        await expect(act(SINGLE, "pause")).rejects.toMatchObject({ status: 404 })
        await expect(download({ destination: "content://com.android.externalstorage.documents/tree/x" })).rejects.toMatchObject({ status: 400 })
        await expect(download({ torrents: [] })).rejects.toMatchObject({ status: 400 })
    })

    it("goes on after a restart of the app: back from the resume data, a paused torrent stays paused", async () => {
        await download({ smartSelect: { enabled: false, missingEpisodeNumbers: [] } })
        await download({ torrents: [{ name: "Single", infoHash: SINGLE }] })
        await act(SINGLE, "pause")
        // the app ends: a new run, a new session, the same disk and core.db
        forgetTorrentClient()
        forgetTorrentStream()
        current = deviceRun()
        held = []
        resumeClientAtStart(environment)
        await settled()
        await settled()
        expect(held).toEqual([true])
        expect((await list())!.map(torrent => `${String(torrent.hash).slice(0, 2)} ${torrent.status}`)).toEqual(["ab downloading", "cd paused"])
        // done: the process is let go
        listeners.forEach(listener => listener([{ infoHash: BATCH, state: "seeding", error: "", hasMetadata: true, progress: 1, downRate: 0, upRate: 0, peers: 0, seeds: 0, bytesDone: 1, bytesWanted: 1 }]))
        await settled()
        expect(held).toEqual([true, false])
    })

    it("keeps the session when a stream stops while the client has torrents", async () => {
        await download()
        await coreAnswerFor("POST", "/api/v1/torrentstream/stop")!({ query: undefined, body: {} }, environment)
        expect(calls).not.toContain("stop")
    })

    it("words the time left and the status as the screen reads them", () => {
        const base: TorrentDeviceStatus = { infoHash: BATCH, state: "downloading", error: "", hasMetadata: true, progress: 0, downRate: 1000, upRate: 0, peers: 0, seeds: 0, bytesDone: 0, bytesWanted: 30_000 }
        expect(etaOf(base)).toBe("30 seconds left")
        expect(etaOf({ ...base, bytesWanted: 600_000 })).toBe("10 minutes left")
        expect(etaOf({ ...base, bytesWanted: 7_200_000 })).toBe("2 hours left")
        expect(etaOf({ ...base, downRate: 0 })).toBe("No ETA")
        for (const [state, word] of [["metadata", "downloading"], ["finished", "seeding"], ["seeding", "seeding"], ["paused", "paused"], ["checking", "other"]]) {
            expect(clientStatusOf({ ...base, state })).toBe(word)
            expect(STATUSES).toContain(word)
        }
        expect(clientStatusOf({ ...base, error: "disk full" })).toBe("error")
    })
})

describe("limits and the download queue (4.2.0)", () => {
    const NONE: TorrentLimits = { downloadLimit: 0, uploadLimit: 0, activeDownloads: 3, stopWhenFinished: false }

    it("reads the limits of the settings: KiB per second as bytes, three downloads at once and sharing on unless set", () => {
        expect(limitsOf(null, null)).toEqual(NONE)
        expect(limitsOf({ seanimeDownloadLimit: 0, seanimeUploadLimit: 0, seanimeMaxActiveDownloads: 0 }, { stopSeedingWhenFinished: false })).toEqual(NONE)
        expect(limitsOf({ seanimeDownloadLimit: 2048, seanimeUploadLimit: 64, seanimeMaxActiveDownloads: 1 }, { stopSeedingWhenFinished: true }))
            .toEqual({ downloadLimit: 2048 * 1024, uploadLimit: 64 * 1024, activeDownloads: 1, stopWhenFinished: true })
        expect(limitsOf({ seanimeDownloadLimit: -5, seanimeUploadLimit: "64", seanimeMaxActiveDownloads: 2.5 }, { stopSeedingWhenFinished: "yes" })).toEqual(NONE)
        expect(limitsOf({ seanimeDownloadLimit: 1e12, seanimeMaxActiveDownloads: 5000 }, null)).toMatchObject({ downloadLimit: 1024 * 1024 * 1024, activeDownloads: 100 })
    })

    it("hands the saved limits to the device with every request, so a change reaches a running session", async () => {
        const seen: TorrentLimits[] = []
        current = { ...deviceRun(), useLimits: async limits => void seen.push(limits) }
        await download()
        expect(seen.at(-1)).toEqual(NONE)

        const opened = await environment.database()
        await opened.insert(settingsSections).values({ section: "torrent", content: { seanimeDownloadLimit: 1024, seanimeUploadLimit: 128, seanimeMaxActiveDownloads: 2 }, changedAt: clock })
        await coreAnswerFor("PATCH", "/api/v1/torrentstream/settings")!({ query: undefined, body: { settings: { stopSeedingWhenFinished: true } } }, environment)
        await list()
        expect(seen.at(-1)).toEqual({ downloadLimit: 1024 * 1024, uploadLimit: 128 * 1024, activeDownloads: 2, stopWhenFinished: true })
    })

    it("lists a waiting torrent with its place in the queue", async () => {
        const device = deviceRun()
        current = { ...device, status: async infoHash => ({ ...(await device.status(infoHash)), state: "queued", downRate: 0, queuePosition: 2 }) }
        await download()
        expect((await list())![0]).toMatchObject({ hash: BATCH, queueIndex: 2, eta: "No ETA" })
        // a device that says nothing of a queue, or a torrent outside it (-1), lists 0 as before
        current = { ...device, status: async infoHash => ({ ...(await device.status(infoHash)), queuePosition: -1 }) }
        expect((await list())![0]).toMatchObject({ queueIndex: 0 })
    })
})

describe("the torrent client's notices and checks (4.2.0)", () => {
    const status = (fields: Partial<TorrentDeviceStatus> = {}): TorrentDeviceStatus => ({
        infoHash: BATCH, name: "[Group] Show (01-03)", state: "downloading", error: "", hasMetadata: true, progress: 0.45, downRate: 3_100_000,
        upRate: 0, peers: 1, seeds: 1, bytesDone: 1_800_000_000, bytesWanted: 4_032_000_000, ...fields,
    })
    const tick = async (fields: Partial<TorrentDeviceStatus> = {}) => {
        listeners.forEach(listener => listener([status(fields)]))
        await settled()
    }

    it("shows the progress in the held notice at most once a second and tells the end exactly once", async () => {
        current = withNotices(deviceRun())
        await download()
        await tick()
        expect(updates).toEqual([{ title: "[Group] Show (01-03)", text: "45 % · ↓ 3.1 MB/s · 12 min left", done: 45, total: 100 }])
        clock += 400
        await tick({ progress: 0.46 })
        expect(updates).toHaveLength(1)
        clock += 600
        await tick({ progress: 0.46 })
        clock += 1000
        await tick({ progress: 0.46 })
        expect(updates.map(notice => notice.done)).toEqual([45, 46])
        // done: the process is let go, one notice of its own
        await tick({ state: "seeding", progress: 1, downRate: 0, bytesDone: 4_032_000_000 })
        clock += 1000
        await tick({ state: "seeding", progress: 1, downRate: 0, bytesDone: 4_032_000_000 })
        expect(ends).toEqual(["Download finished: [Group] Show (01-03)"])
        expect(held).toEqual([true, false])
        expect(updates).toHaveLength(2)
    })

    it("tells a failed torrent and asks for the notices' permission only with the first torrent", async () => {
        current = withNotices(deviceRun())
        await download()
        await download({ torrents: [{ name: "Single", infoHash: SINGLE }] })
        expect(asks).toBe(1)
        await tick()
        await tick({ error: "disk full" })
        expect(ends).toEqual(["Download failed: [Group] Show (01-03)"])
    })

    it("no file list after 60 s: the torrent stays in the list as loading, its files are chosen once the list is there", async () => {
        metadata = false
        current = withNotices(deviceRun())
        expect(await download()).toBe(true)
        expect(calls).toEqual(["add ab /storage/emulated/0/Anime/Show"])
        expect((await list())!.map(torrent => [torrent.status, torrent.error])).toEqual([["downloading", ""]])
        await tick({ state: "metadata", hasMetadata: false, progress: 0, bytesDone: 0, bytesWanted: 0 })
        expect(updates.at(-1)).toEqual({ title: "[Group] Show (01-03)", text: "Getting file list…", done: 0, total: 0 })
        metadata = true
        await tick()
        await settled()
        expect(calls).toEqual(["add ab /storage/emulated/0/Anime/Show", "priority 0=0", "priority 3=0"])
    })

    it("refuses what does not fit into the free storage with the numbers, before it loads", async () => {
        // the whole torrent: before it starts
        free = 1_000_000_000
        await expect(download({ smartSelect: { enabled: false }, torrents: [{ name: "Single", infoHash: SINGLE, size: 5_000_000_000 }] }))
            .rejects.toMatchObject({ status: 507, message: "Not enough free space: the download needs 5.0 GB, 1.0 GB are free." })
        expect(calls).toEqual([])
        // the chosen episodes 2 and 3 (1850 bytes): once their sizes are known, the new torrent goes again
        free = 1000
        await expect(download()).rejects.toMatchObject({ status: 507, message: "Not enough free space: the download needs 1.9 KB, 1.0 KB are free." })
        expect(calls.at(-1)).toBe("remove ab true")
        expect(await list()).toBeNull()
        // it fits
        free = 2000
        expect(await download()).toBe(true)
        expect((await list())!.map(torrent => torrent.hash)).toEqual([BATCH])
    })
})
