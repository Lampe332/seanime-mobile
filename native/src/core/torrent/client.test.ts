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
            infoHash, name: infoHash === BATCH ? "[Group] Show (01-03)" : "Single", state: saved.paused ? "paused" : saved.state, error: "", hasMetadata: true,
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
        setQueued: async (infoHash, queued) => {
            one(infoHash)
            calls.push(`${queued ? "queue" : "unqueue"} ${infoHash.slice(0, 2)}`)
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
        // queued last, when its files are chosen
        expect(calls).toEqual(["add ab /storage/emulated/0/Anime/Show", "priority 0=0", "priority 3=0", "queue ab"])
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

    /**
     * A session whose queue is full, as libtorrent runs it: a queued torrent is paused, and a paused magnet link gets
     * no file list from its peers. The list is there once the torrent has run (not queued) for two seconds in all.
     */
    function fullQueue(): TorrentDevice {
        const device = deviceRun()
        let added = false
        let waiting = false
        let ranMs = 0
        let runningSince = 0
        const ran = () => ranMs + (added && !waiting ? clock - runningSince : 0)
        return {
            ...device,
            addMagnet: async (uri, folder) => {
                if (!added) runningSince = clock
                added = true
                return device.addMagnet(uri, folder)
            },
            setQueued: async (infoHash, on) => {
                await device.setQueued?.(infoHash, on)
                if (on === waiting) return
                if (on) ranMs = ran()
                else runningSince = clock
                waiting = on
            },
            status: async infoHash => {
                const status = await device.status(infoHash)
                return { ...status, state: waiting ? "queued" : status.state, downRate: waiting ? 0 : status.downRate, hasMetadata: ran() >= 2000 }
            },
        }
    }

    it("queues a magnet link only after its files are chosen: behind a full queue it still gets its file list", async () => {
        current = fullQueue()
        expect(await download()).toBe(true)
        expect(calls).toEqual(["add ab /storage/emulated/0/Anime/Show", "priority 0=0", "priority 3=0", "queue ab"])
        expect((await list())![0]).toMatchObject({ hash: BATCH })
        expect(disk.get(BATCH)?.priorities).toEqual({ 0: 0, 3: 0 })
    })

    it("the same session answers 504 when a torrent is queued before its file list (what the order prevents)", async () => {
        const device = fullQueue()
        current = { ...device, addMagnet: async (uri, folder) => {
            const infoHash = await device.addMagnet(uri, folder)
            await device.setQueued?.(infoHash, true)
            return infoHash
        }, setQueued: undefined }
        await expect(download()).rejects.toMatchObject({ status: 504 })
    })

    it("takes a torrent that waits without its file list out of the queue until its files are chosen", async () => {
        const device = fullQueue()
        current = device
        // added without a choice of files: queued at once, behind the others, before any peer gave the list
        await download({ smartSelect: { enabled: false, missingEpisodeNumbers: [] } })
        expect(calls).toEqual(["add ab /storage/emulated/0/Anime/Show", "queue ab"])
        expect((await device.status(BATCH)).hasMetadata).toBe(false)
        calls = []
        // asked for again, now with a choice
        await download()
        expect(calls).toEqual(["add ab /storage/emulated/0/Anime/Show", "unqueue ab", "priority 0=0", "priority 3=0", "queue ab"])
    })

    it("queues every torrent of the sheet, also when the files of one cannot be chosen", async () => {
        const device = deviceRun()
        current = { ...device, files: async infoHash => {
            if (infoHash === BATCH) throw new Error("ERR_TORRENT: the torrent has no file list yet")
            return device.files(infoHash)
        } }
        await expect(download()).rejects.toThrow(/no file list/)
        expect(calls).toEqual(["add ab /storage/emulated/0/Anime/Show", "queue ab"])
    })

    it("says again which torrents are queued after a restart and before a resume (the module forgets it for a paused one)", async () => {
        await download({ smartSelect: { enabled: false, missingEpisodeNumbers: [] } })
        await download({ torrents: [{ name: "Single", infoHash: SINGLE }] })
        await act(SINGLE, "pause")
        forgetTorrentClient()
        forgetTorrentStream()
        current = deviceRun()
        calls = []
        resumeClientAtStart(environment)
        await settled()
        await settled()
        expect(calls).toEqual(["queue ab", "queue cd"])
        calls = []
        await act(SINGLE, "resume")
        // into the queue first, so the resume hands it to the queue instead of starting it past the others
        expect(calls).toEqual(["queue cd", "resume cd"])
        calls = []
        await act(SINGLE, "pause")
        expect(calls).toEqual(["pause cd"])
    })

    it("downloads as before on a device without a queue", async () => {
        current = { ...deviceRun(), setQueued: undefined }
        expect(await download()).toBe(true)
        await act(BATCH, "pause")
        await act(BATCH, "resume")
        expect(calls).toEqual(["add ab /storage/emulated/0/Anime/Show", "priority 0=0", "priority 3=0", "pause ab", "resume ab"])
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
