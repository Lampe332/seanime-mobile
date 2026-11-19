// geschrieben nach: Form der Aufzeichnungen TORRENTSTREAM.SaveTorrentstreamSettings, GetTorrentstreamBatchHistory und DeleteTorrentstreamBatchHistory vom 13.11.2026 (nur Feldnamen und Arten, Werte erfunden), App-Typen Torrentstream_FilePreview, Torrentstream_TorrentStatus, NativePlayer_PlaybackInfo und App-Code native-player.tsx; das Gerät (Torrent-Sitzung, Ausgang) ist hier ein Test-Double, kein Netz, kein Torrent

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { sqlDriverFor } from "@/api/client/core-database"
import { forgetDatabases, openDatabaseSync } from "../../../test/expo-sqlite"
import { type CoreDatabase, openCoreDatabase } from "../database/database"
import { CoreError } from "../errors"
import { type CoreEvent, onCoreEvent } from "../events"
import { coreAnswerFor } from "../index"
import { type CoreEnvironment } from "../registry"
import { METADATA_PATIENCE_MS, type TorrentDevice, type TorrentDeviceFile, type TorrentDeviceStatus, chooseFile, episodeOfName, forgetTorrentStream, magnetOf, noFileListText, runningTorrentStream, torrentFileAddressOf, streamStateOf } from "./torrent"

type Json = Record<string, unknown>

/** The recorded answer of SaveTorrentstreamSettings: field names and kinds */
/** The recorded answer of GetTorrentstreamBatchHistory for an anime nothing was streamed of */
const RECORDED_NO_HISTORY = { torrent: null, metadata: null, batchEpisodeFiles: null }

const HASH = "ab".repeat(20)
const OTHER = "cd".repeat(20)
const ADDRESS = `http://127.0.0.1:40123/${"0f".repeat(16)}/${HASH}/2/Show%20-%2003.mkv`
const BATCH: TorrentDeviceFile[] = [
    { index: 0, path: "Show/[Group] Show - 01 [1080p].mkv", size: 900, pieceStart: 0, pieceEnd: 9 },
    { index: 1, path: "Show/[Group] Show - 02 [1080p].mkv", size: 900, pieceStart: 9, pieceEnd: 19 },
    { index: 2, path: "Show/[Group] Show - 03 [1080p].mkv", size: 950, pieceStart: 19, pieceEnd: 29 },
    { index: 3, path: "Show/[Group] Show - 03 [480p].mkv", size: 300, pieceStart: 29, pieceEnd: 32 },
    { index: 4, path: "Show/notes.txt", size: 1, pieceStart: 32, pieceEnd: 32 },
]

let clock = 0
let database: Promise<CoreDatabase> | null = null
let events: CoreEvent[] = []
let stopListening: () => void = () => undefined
let calls: string[] = []
let files: TorrentDeviceFile[] = BATCH
let metadataAfter = 0
let listeners: ((statuses: TorrentDeviceStatus[]) => void)[] = []
/** What the device says besides, for every status it answers */
let seen: Partial<TorrentDeviceStatus> = {}

const status = (infoHash: string, more: Partial<TorrentDeviceStatus> = {}): TorrentDeviceStatus => ({
    infoHash, state: "downloading", error: "", hasMetadata: true, progress: 0.25, downRate: 2_500_000, upRate: 0, peers: 3, seeds: 2, bytesDone: 250, bytesWanted: 1000, ...more,
})

const device: TorrentDevice = {
    addMagnet: async uri => {
        calls.push(`add ${uri}`)
        return /btih:([0-9a-f]{40})/.exec(uri)?.[1] ?? HASH
    },
    files: async () => files,
    status: async infoHash => status(infoHash, { hasMetadata: metadataAfter-- <= 0, ...seen }),
    setFilePriority: async (_infoHash, index, priority) => void calls.push(`priority ${index}=${priority}`),
    setSequential: async (_infoHash, on) => void calls.push(`sequential ${on}`),
    setPieceDeadlines: async (_infoHash, first, count) => void calls.push(`deadlines ${first}+${count}`),
    serve: async (infoHash, index) => {
        calls.push(`serve ${index}`)
        return ADDRESS.replace(HASH, infoHash)
    },
    remove: async (infoHash, deleteFiles) => void calls.push(`remove ${infoHash.slice(0, 2)} ${deleteFiles}`),
    stop: async () => void calls.push("stop"),
    onStatus: listener => {
        listeners.push(listener)
        return () => void (listeners = listeners.filter(one => one !== listener))
    },
    wait: async milliseconds => void (clock += milliseconds),
}

/** The device the core is handed */
let current: TorrentDevice = device

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

const ask = (endpoint: string, body?: unknown, method = "POST") => {
    const answer = coreAnswerFor(method, `/api/v1/torrentstream/${endpoint}`)
    if (!answer) throw new Error(`not answered by the core: ${endpoint}`)
    return answer({ query: undefined, body }, environment)
}
const settled = () => new Promise(resolve => setTimeout(resolve, 0))
const start = (more: Json = {}) => ask("start", { mediaId: 4242, episodeNumber: 3, aniDBEpisode: "3", autoSelect: false, torrent: { name: "[Group] Show (01-12) [1080p]", infoHash: HASH }, playbackType: "nativeplayer", clientId: "", ...more })
const player = () => events.filter(event => event.type === "native-player").map(event => event.payload as { type: string, payload: unknown })

beforeEach(() => {
    forgetDatabases()
    database = null
    clock = 1_700_000_000_000
    events = []
    calls = []
    files = BATCH
    metadataAfter = 0
    listeners = []
    seen = {}
    current = device
    forgetTorrentStream()
    stopListening = onCoreEvent(event => void events.push(event))
})
afterEach(() => {
    stopListening()
})


describe("picking the file", () => {
    it("reads the magnet link or makes one of the info hash", () => {
        expect(magnetOf({ magnetLink: "magnet:?xt=urn:btih:" + OTHER, infoHash: HASH })).toBe("magnet:?xt=urn:btih:" + OTHER)
        expect(magnetOf({ magnetLink: "", infoHash: HASH.toUpperCase() })).toBe("magnet:?xt=urn:btih:" + HASH)
        expect(magnetOf({ link: "https://tracker.example/t/1" })).toBe("")
    })

    it("takes the chosen index, the only video, or the episode by its name, the larger file first", () => {
        expect(episodeOfName(BATCH[1].path).episode).toBe(2)
        expect(chooseFile(BATCH, { fileIndex: 1, episodeNumber: 3 })?.index).toBe(1)
        expect(chooseFile(BATCH, { fileIndex: 9, episodeNumber: 3 })).toBeNull()
        expect(chooseFile(BATCH, { episodeNumber: 3 })?.index).toBe(2)
        expect(chooseFile(BATCH, { episodeNumber: 7 })).toBeNull()
        expect(chooseFile([BATCH[1], BATCH[4]], { episodeNumber: 7 })?.index).toBe(1)
        expect(chooseFile([BATCH[4]], { episodeNumber: 1 })).toBeNull()
    })
})

/** A collection as found in the wild (names invented): numbers the parser leaves in the title, extras, copies, other files */
const video = (index: number, path: string, size = 400_000_000): TorrentDeviceFile => ({ index, path, size, pieceStart: index * 10, pieceEnd: index * 10 + 9 })
const COLLECTION: TorrentDeviceFile[] = [
    video(0, "Rock World (2019) [BD]/Rock World 01.5.mkv", 500_000_000),
    ...Array.from({ length: 12 }, (_, at) => video(at + 1, `Rock World (2019) [BD]/Rock World ${String(at + 1).padStart(2, "0")}.mkv`)),
    ...Array.from({ length: 12 }, (_, at) => video(at + 13, `Rock World (2019) [BD]/Rock World ${String(at + 1).padStart(2, "0")}.ia.mp4`, 150_000_000)),
    video(25, "Rock World (2019) [BD]/Extras/Rock World 01.mkv", 900_000_000),
    video(26, "Rock World (2019) [BD]/Rock World NCOP1.mkv", 90_000_000),
    video(27, "Rock World (2019) [BD]/Rock World - NCED 01.mkv", 90_000_000),
    video(28, "Rock World (2019) [BD]/Rock World SP01.mkv", 600_000_000),
    video(29, "Rock World (2019) [BD]/Specials/Rock World - 01.mkv", 700_000_000),
    video(30, "Rock World (2019) [BD]/OVA/Rock World - 01.mkv", 700_000_000),
    video(31, "Rock World (2019) [BD]/Rock World - Recap.mkv", 300_000_000),
    { index: 32, path: "Rock World (2019) [BD]/Rock World 01.jpg", size: 9000, pieceStart: 320, pieceEnd: 320 },
    { index: 33, path: "Rock World (2019) [BD]/rockworld_meta.xml", size: 900, pieceStart: 320, pieceEnd: 320 },
]

describe("picking the file in a collection (phase 6e)", () => {
    it("finds the episode by a number the parser leaves in the title, leaves extras out and takes the largest copy", () => {
        expect(chooseFile(COLLECTION, { episodeNumber: 1 })?.index).toBe(1)
        expect(chooseFile(COLLECTION, { episodeNumber: 12 })?.index).toBe(12)
        expect(chooseFile(COLLECTION, { episodeNumber: 13 })).toBeNull()
        // a collection of extras only has no episode
        expect(chooseFile(COLLECTION.slice(25), { episodeNumber: 1 })).toBeNull()
    })

    it("reads bare numbers and the season of the folder, the wanted season first, else the lowest", () => {
        const seasons = [
            video(0, "Show/Season 1/01.mkv"), video(1, "Show/Season 1/02.mkv"),
            video(2, "Show/Season 2/01.mkv"), video(3, "Show/Season 2/02.mkv"),
            video(4, "Show/Season 2/Extras/01.mkv", 900_000_000),
        ]
        expect(chooseFile(seasons, { episodeNumber: 1 })?.index).toBe(0)
        expect(chooseFile(seasons, { episodeNumber: 2, season: 2 })?.index).toBe(3)
        expect(chooseFile(seasons, { episodeNumber: 1, season: 3 })?.index).toBe(0)
        const marked = [video(0, "Show.S01E01.1080p.WEB.mkv"), video(1, "Show.S02E01.1080p.WEB.mkv"), video(2, "Show.S02E02.1080p.WEB.mkv")]
        expect(chooseFile(marked, { episodeNumber: 1, season: 2 })?.index).toBe(1)
        expect(chooseFile(marked, { episodeNumber: 1 })?.index).toBe(0)
        expect(chooseFile([video(0, "Show/Episode 01.mp4"), video(1, "Show/Episode 02.mp4")], { episodeNumber: 2 })?.index).toBe(1)
    })

    it("maps absolute numbers onto the entry's episodes only when the numbers go past its count", () => {
        const absolute = Array.from({ length: 12 }, (_, at) => video(at, `[Grp] Show - ${at + 25} [1080p].mkv`))
        expect(chooseFile(absolute, { episodeNumber: 1 })).toBeNull()
        expect(chooseFile(absolute, { episodeNumber: 1, episodeCount: 12 })?.index).toBe(0)
        expect(chooseFile(absolute, { episodeNumber: 12, episodeCount: 12 })?.index).toBe(11)
        expect(chooseFile(absolute, { episodeNumber: 13, episodeCount: 12 })).toBeNull()
        // a collection that only misses its first episode is no absolute numbering
        const missing = Array.from({ length: 11 }, (_, at) => video(at, `[Grp] Show - ${String(at + 2).padStart(2, "0")} [1080p].mkv`))
        expect(chooseFile(missing, { episodeNumber: 1, episodeCount: 24 })).toBeNull()
    })

    it("streams the episode of a collection and says in the log how the file was chosen", async () => {
        const notes: string[] = []
        current = { ...device, note: text => void notes.push(text) }
        files = COLLECTION
        await start({ episodeNumber: 1, aniDBEpisode: "1", torrent: { name: "Rock World (2019) [BD]", infoHash: HASH } })
        expect(calls.at(-1)).toBe("serve 1")
        expect(notes).toEqual(["file 1 of 34 chosen for episode 1: 32 video files, 8 extras left out, 2 copies of the episode, the largest (400.0 MB)"])
        await settled()
        expect(await ask("stop")).toBe(true)
    })
})

describe("a stream", () => {
    it("adds the torrent, pulls the episode's file and hands the outlet's address to the player", async () => {
        metadataAfter = 2
        expect(await start()).toBe(true)
        await settled()
        expect(calls).toEqual([`add magnet:?xt=urn:btih:${HASH}`, "priority 0=0", "priority 1=0", "priority 3=0", "priority 4=0", "priority 2=7", "sequential true", "deadlines 19+6", "deadlines 28+2", "serve 2"])
        expect(player().map(message => message.type)).toEqual(["open-and-await", "open-and-await", "open-and-await", "watch"])
        expect(player()[3].payload).toMatchObject({ streamType: "torrent", streamPath: BATCH[2].path, mimeType: "video/x-matroska", streamUrl: ADDRESS, contentLength: 950, isNakamaWatchParty: false })
        expect(runningTorrentStream()).toEqual({ infoHash: HASH, index: 2, mediaId: 4242, episodeNumber: 3 })

        // the batch is remembered for the anime's other episodes, and forgotten on request
        const history = await ask("batch-history", { mediaId: 4242 }) as Json
        expect(Object.keys(history).sort()).toEqual(Object.keys(RECORDED_NO_HISTORY).sort())
        expect(history.batchEpisodeFiles).toMatchObject({ current: 2, currentEpisodeNumber: 3, currentAniDBEpisode: "3" })
        expect((history.batchEpisodeFiles as { files: Json[] }).files.map(file => [file.index, file.episodeNumber])).toEqual([[0, 1], [1, 2], [2, 3], [3, 3]])
        expect(await ask("batch-history/delete", { mediaId: 4242 })).toBe(true)
        expect(await ask("batch-history", { mediaId: 4242 })).toEqual(RECORDED_NO_HISTORY)

        // once per second: the state in the fields of Torrentstream_TorrentStatus
        events = []
        for (const listener of listeners) listener([status(OTHER), status(HASH)])
        await settled()
        expect(events).toEqual([{ type: "torrentstream-state", payload: streamStateOf(status(HASH), 950) }])
        expect(streamStateOf(status(HASH), 950)).toEqual({ state: "downloading", status: { uploadProgress: 0, downloadProgress: 250, progressPercentage: 25, downloadSpeed: "2.5 MB/s", uploadSpeed: "0 B/s", size: "950 B", seeders: 2, peers: 3, downloadRate: 2_500_000 } })

        // another torrent: the first one goes with what it loaded; stopping removes the second and ends the session
        calls = []
        await start({ torrent: { infoHash: OTHER }, fileIndex: 0, playbackType: "none" })
        expect(calls.slice(0, 2)).toEqual([`add magnet:?xt=urn:btih:${OTHER}`, "remove ab true"])
        expect(listeners).toHaveLength(1)
        calls = []
        expect(await ask("stop")).toBe(true)
        expect(calls).toEqual(["remove cd true", "stop"])
        expect(runningTorrentStream()).toBeNull()
        expect(listeners).toHaveLength(0)
    })

    it("only prepares the stream when no player is asked for", async () => {
        await start({ playbackType: "none" })
        await start({ preload: true })
        await settled()
        expect(player()).toEqual([])
        expect(runningTorrentStream()?.index).toBe(2)
    })

    it("says what is missing and leaves nothing behind", async () => {
        // without extensions here: auto select cannot search (search.test.ts has the search)
        await expect(start({ torrent: undefined, autoSelect: true })).rejects.toBeInstanceOf(Error)
        await expect(start({ torrent: undefined, autoSelect: false })).rejects.toThrow("no torrent chosen")
        await expect(start({ torrent: { link: "https://tracker.example/t/1" } })).rejects.toThrow(/its provider gave none/)
        await expect(start({ playbackType: "externalPlayerLink" })).rejects.toBeInstanceOf(CoreError)
        expect(calls).toEqual([])

        await expect(start({ episodeNumber: 7 })).rejects.toThrow("no file of the torrent fits episode 7")
        expect(calls.at(-1)).toBe("remove ab true")
        // a magnet link nobody has the file list of
        metadataAfter = Number.MAX_SAFE_INTEGER
        const before = clock
        await expect(start()).rejects.toThrow(/file list did not come/)
        expect(clock - before).toBeGreaterThanOrEqual(METADATA_PATIENCE_MS)
        await settled()
        expect(player().at(-1)).toMatchObject({ type: "abort-open" })
        expect(runningTorrentStream()).toBeNull()
    })
})

describe("the file chooser", () => {
    it("lists the video files in the screens' form without loading anything", async () => {
        const previews = await ask("torrent-file-previews", { torrent: { infoHash: HASH }, episodeNumber: 3 }) as Json[]
        expect(calls).toEqual([`add magnet:?xt=urn:btih:${HASH}`, "priority 0=0", "priority 1=0", "priority 2=0", "priority 3=0", "priority 4=0"])
        expect(previews.map(preview => [preview.index, preview.episodeNumber, preview.isLikely])).toEqual([[0, 1, false], [1, 2, false], [2, 3, true], [3, 3, true]])
        expect(previews[2]).toEqual({ path: BATCH[2].path, displayPath: "Show", displayTitle: "Episode 3", episodeNumber: 3, relativeEpisodeNumber: 3, isLikely: true, index: 2, size: 950 })
        // looking at another torrent lets the first one go; a stream of the looked-at one keeps it
        calls = []
        await ask("torrent-file-previews", { torrent: { infoHash: OTHER }, episodeNumber: 1 })
        expect(calls.slice(0, 2)).toEqual([`add magnet:?xt=urn:btih:${OTHER}`, "remove ab true"])
        calls = []
        await start({ torrent: { infoHash: OTHER }, playbackType: "none" })
        expect(calls.filter(call => call.startsWith("remove"))).toEqual([])
    })

    // 4.2.0 (A2): the download sheet's file choice reads the list and lets the torrent go, so the download adds it afresh
    it("lets the torrent go after the list for the download sheet, and ends the empty session", async () => {
        const previews = await ask("torrent-file-previews", { torrent: { infoHash: HASH }, episodeNumber: 0, listOnly: true }) as Json[]
        expect(previews.map(preview => [preview.index, preview.size])).toEqual([[0, 900], [1, 900], [2, 950], [3, 300]])
        expect(calls.slice(-2)).toEqual(["remove ab true", "stop"])
        // a later look of the stream's file chooser has nothing to let go
        calls = []
        await ask("torrent-file-previews", { torrent: { infoHash: OTHER }, episodeNumber: 1 })
        expect(calls.filter(call => call.startsWith("remove"))).toEqual([])
    })

    it("leaves a running stream's torrent and its priorities alone", async () => {
        await start({ playbackType: "none" })
        calls = []
        await ask("torrent-file-previews", { torrent: { infoHash: HASH }, episodeNumber: 3, listOnly: true })
        expect(calls.filter(call => !call.startsWith("add"))).toEqual([])
    })
})

describe("a magnet link whose file list does not come (phase 6b-3)", () => {
    it("fails after the wait with the numbers the session saw, and the torrent is removed", async () => {
        metadataAfter = Number.MAX_SAFE_INTEGER
        seen = { peers: 0, seeds: 0, peersKnown: 4, dhtNodes: 87, trackersOk: 1, trackersFailed: 2, webSeeds: 0 }
        await expect(start()).rejects.toThrow("the torrent's file list did not come within 60 s: no peer was reached (peers 0 of 4 known, DHT nodes 87, trackers 1 answered, 2 failed, web seeds 0)")
        expect(calls.filter(call => call.startsWith("remove"))).toEqual(["remove ab true"])
        expect(calls).not.toContain("serve 2")
        await settled()
        expect(player().at(-1)).toMatchObject({ type: "abort-open", payload: expect.stringContaining("no peer was reached") })
        expect(runningTorrentStream()).toBeNull()
    })

    it("sends its state while the list does not come (no file yet: size 0) and stops sending once the start failed", async () => {
        metadataAfter = Number.MAX_SAFE_INTEGER
        const waiting = status(HASH, { state: "metadata", hasMetadata: false, progress: 0, downRate: 0, peers: 0, seeds: 0 })
        let ticks = 0
        current = { ...device, wait: async milliseconds => {
            clock += milliseconds
            if (ticks++ === 0) for (const listener of listeners) listener([waiting])
        } }
        await expect(start()).rejects.toThrow(/file list did not come/)
        await settled()
        expect(events.filter(event => event.type === "torrentstream-state").map(event => event.payload))
            .toEqual([{ state: "metadata", status: expect.objectContaining({ size: "0 B", seeders: 0, peers: 0, downloadRate: 0 }) }])
        expect(listeners).toHaveLength(0)
    })

    it("tells apart peers that were not reached from peers that do not have the list, and a device without numbers", () => {
        expect(noFileListText(status(HASH, { peers: 2, peersKnown: 9, dhtNodes: 120, trackersOk: 3, trackersFailed: 0, webSeeds: 1 }), 60_000))
            .toBe("the torrent's file list did not come within 60 s: no connected peer has it (peers 2 of 9 known, DHT nodes 120, trackers 3 answered, 0 failed, web seeds 1). Another torrent with more seeders may start.")
        expect(noFileListText(status(HASH, { peers: 0 }), 30_400)).toBe("the torrent's file list did not come within 30 s: no peer was reached (peers 0). Another torrent with more seeders may start.")
    })
})


describe("a torrent whose provider names its .torrent file (phase 6b-3)", () => {
    const withFile: TorrentDevice = {
        ...device,
        addTorrentFileFrom: async address => {
            calls.push(`file ${address}`)
            if (address.includes("broken")) throw new Error("answered 404")
            return HASH
        },
    }
    const torrent = (downloadUrl: string) => ({ torrent: { name: "[Group] Show (01-12) [1080p]", infoHash: HASH, downloadUrl } })

    it("is added by that file, and by its magnet link when the file cannot be had, is not named over HTTPS or the device cannot", async () => {
        current = withFile
        await start(torrent("https://files.example/show/show.torrent"))
        expect(calls[0]).toBe("file https://files.example/show/show.torrent")
        expect(calls.some(call => call.startsWith("add "))).toBe(false)
        expect(calls).toContain("serve 2")

        calls = []
        await start(torrent("https://files.example/broken.torrent"))
        expect(calls.slice(0, 2)).toEqual(["file https://files.example/broken.torrent", `add magnet:?xt=urn:btih:${HASH}`])

        calls = []
        await start(torrent("http://files.example/show.torrent"))
        expect(calls[0]).toBe(`add magnet:?xt=urn:btih:${HASH}`)

        calls = []
        current = device
        await start(torrent("https://files.example/show/show.torrent"))
        expect(calls[0]).toBe(`add magnet:?xt=urn:btih:${HASH}`)
    })

    it("reads the address", () => {
        expect(torrentFileAddressOf({ downloadUrl: " https://a.example/x.torrent " })).toBe("https://a.example/x.torrent")
        expect(torrentFileAddressOf({ downloadUrl: "magnet:?xt=urn:btih:abc" })).toBe("")
        expect(torrentFileAddressOf({ downloadUrl: "https://a.example/x y" })).toBe("")
        expect(torrentFileAddressOf({})).toBe("")
    })
})
