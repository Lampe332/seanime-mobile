// geschrieben nach: docs/EIGENER-KERN.md §4q (Phase 6b-1) und der Schnittstelle des eigenen Moduls (modules/core-torrent/src/CoreTorrent.nitro.ts), BEP 3 (Info-Hash); kein Server-Quelltext
import type { BlockingWatch, TorrentDevice, TorrentSessionSettings } from "@/core"
import type { TorrentLimits } from "@/core/torrent/torrent"
import type { TorrentNoticeHost } from "@/core/torrent/torrent-notice"
import { tr } from "@/lib/app-language"
import { shortcutLink } from "@/lib/app-links"
import { logger } from "@/lib/helpers/debug"
import type { CoreTorrent } from "../../../modules/core-torrent/src/CoreTorrent.nitro"

/*
 * The app's BitTorrent session on the device: types and a thin shell around the native module (modules/core-torrent,
 * libtorrent on a thread of its own). Its callers: the core's torrent area through `torrentDeviceFor` (phase 6b-2,
 * core/torrent/torrent.ts) and the checks of the test app (core-torrent-selftest.ts, core-torrent-stream-check.ts),
 * started by links (lib/app-links.ts).
 *
 * The shell checks what goes in (folders as plain paths, info hashes, numbers), reads what comes out (status once per
 * second) and turns the module's `ERR_TORRENT: ` rejections into TorrentError. No method holds the app's thread: the
 * module answers every call from its own thread.
 */

/** What the shell needs of the native module; the tests put their own in */
export type TorrentNative = Pick<CoreTorrent, "start" | "stop" | "addMagnet" | "addTorrentFile" | "remove" | "files" | "setFilePriority" | "setSequential" | "setPaused" | "setQueued" | "setLimits" | "moveStorage" | "setPieceDeadlines" | "clearDeadlines" | "status" | "connectPeer" | "serve" | "shareFile" | "shareTorrent" | "unshare">

/** The outlet's address of a file: loopback only, behind a token (modules/core-torrent/cpp/StreamServer.hpp) */
export const isOutletAddress = (address: string) => /^http:\/\/127\.0\.0\.1:\d{1,5}\/[0-9a-f]{32}\/[0-9a-f]{40}\/\d+\/[^/?#]+$/.test(address)
/** A share of the outlet into the local network (phase 7b): an IPv4 address of the device, a token of 64 hex digits, the name */
export const isShareAddress = (address: string) => /^http:\/\/(?:\d{1,3}\.){3}\d{1,3}:\d{1,5}\/[0-9a-f]{64}\/[^/?#]+$/.test(address) && !/^http:\/\/127\./.test(address)

/** "queued" (4.2.0): a torrent of the download queue that waits for its turn */
export const TORRENT_STATES = ["checking", "metadata", "downloading", "finished", "seeding", "paused", "queued"] as const
export type TorrentState = typeof TORRENT_STATES[number]

export type TorrentSettings = {
    /** The session's own folder (state, resume data): a plain path or a `file://` address inside the app's storage */
    folder: string
    /** 0 or missing: any free port */
    listenPort?: number
    connections?: number
    /** Ways of finding peers, each on unless said otherwise */
    dht?: boolean
    lsd?: boolean
    trackers?: boolean
    pex?: boolean
    /** Ask the router for an open port; on unless said otherwise */
    portMapping?: boolean
    /** uTP (BitTorrent over UDP) besides TCP; on unless said otherwise */
    utp?: boolean
}

export type TorrentFile = {
    index: number
    /** Below the folder the torrent is saved to */
    path: string
    size: number
    offset: number
    pieceStart: number
    /** The last piece that holds bytes of the file */
    pieceEnd: number
}

/** One torrent's state, as it comes once per second and from `status` */
export type TorrentStatus = {
    /** 40 hex digits, lower case */
    infoHash: string
    name: string
    state: TorrentState
    /** "" for none */
    error: string
    hasMetadata: boolean
    /** 0–1 */
    progress: number
    /** Bytes per second */
    downRate: number
    upRate: number
    peers: number
    seeds: number
    piecesHave: number
    /** 0 without metadata */
    pieces: number
    bytesDone: number
    bytesWanted: number
    /** Peers the torrent knows of, connected or not */
    peersKnown: number
    /** Nodes in the DHT's routing table (the whole session) */
    dhtNodes: number
    /** Announces to trackers since the torrent was added: answered, failed, the last failure's text ("" for none) */
    trackersOk: number
    trackersFailed: number
    trackerError: string
    /** Web seed addresses the torrent has */
    webSeeds: number
    /** Where a queued torrent stands among the queued ones that still download, from 0; -1: not in the queue */
    queuePosition: number
}

/** What the device's side needs of the app's file system (expo-file-system/legacy); the tests put their own in */
export type TorrentFolders = {
    cacheDirectory: string | null
    documentDirectory: string | null
    getInfoAsync: (address: string) => Promise<{ exists: boolean }>
    readDirectoryAsync: (address: string) => Promise<string[]>
    deleteAsync: (address: string, options?: { idempotent?: boolean }) => Promise<void>
}

export class TorrentError extends Error {
    override name = "TorrentError"
}

const DEFAULT_CONNECTIONS = 60
const ERROR_MARK = "ERR_TORRENT: "

export const isInfoHash = (text: string) => /^[0-9a-f]{40}$/.test(text)

/** A folder for the module: `file:///data/…` or `/data/…` becomes the plain path without a slash at its end */
export function plainPath(address: string): string {
    let path = address
    if (!address.startsWith("/")) {
        const match = /^file:\/\/(\/.*)$/.exec(address)
        if (!match?.[1]) throw new TorrentError("the folder must be a path inside the app's storage")
        try {
            path = decodeURIComponent(match[1])
        }
        catch {
            throw new TorrentError("the folder's address cannot be read")
        }
    }
    return path.length > 1 ? path.replace(/\/+$/, "") || "/" : path
}

/** A path with `.` or `..` in it names another place than it reads */
export const hasDotSegment = (path: string) => path.split("/").some(part => part === "." || part === "..")

const BASE64_URL ="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

/** The bytes of a base64url text (a `.torrent` file inside a link); null when it is none */
export function base64UrlBytes(text: string): Uint8Array | null {
    const letters = text.replace(/=+$/, "")
    if (!/^[A-Za-z0-9_-]*$/.test(letters) || letters.length % 4 === 1) return null
    const bytes = new Uint8Array(Math.floor(letters.length * 3 / 4))
    let held = 0
    let bits = 0
    let at = 0
    for (const letter of letters) {
        held = ((held << 6) | BASE64_URL.indexOf(letter)) & 0xffff
        bits += 6
        if (bits >= 8) {
            bits -= 8
            bytes[at++] = (held >> bits) & 0xff
        }
    }
    return bytes
}

const amount = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null

/** One status as the module sends it, checked; null for anything that is none */
export function readTorrentStatus(raw: unknown): TorrentStatus | null {
    if (typeof raw !== "object" || raw === null) return null
    const event = raw as Record<string, unknown>
    const infoHash = typeof event.infoHash === "string" ? event.infoHash.toLowerCase() : ""
    if (!isInfoHash(infoHash)) return null
    const progress = amount(event.progress)
    const downRate = amount(event.downRate)
    const upRate = amount(event.upRate)
    const peers = amount(event.peers)
    const seeds = amount(event.seeds)
    const piecesHave = amount(event.piecesHave)
    const pieces = amount(event.pieces)
    const bytesDone = amount(event.bytesDone)
    const bytesWanted = amount(event.bytesWanted)
    if (progress === null || downRate === null || upRate === null || peers === null || seeds === null || piecesHave === null || pieces === null || bytesDone === null || bytesWanted === null) return null
    const state = TORRENT_STATES.find(known => known === event.state)
    if (!state) return null
    return {
        infoHash,
        name: typeof event.name === "string" ? event.name : "",
        state,
        error: typeof event.error === "string" ? event.error : "",
        hasMetadata: event.hasMetadata === true,
        progress: Math.min(1, progress),
        downRate, upRate, peers, seeds, piecesHave, pieces, bytesDone, bytesWanted,
        // since phase 6b-3; a module without them counts as 0
        peersKnown: amount(event.peersKnown) ?? 0,
        dhtNodes: amount(event.dhtNodes) ?? 0,
        trackersOk: amount(event.trackersOk) ?? 0,
        trackersFailed: amount(event.trackersFailed) ?? 0,
        trackerError: typeof event.trackerError === "string" ? event.trackerError : "",
        webSeeds: amount(event.webSeeds) ?? 0,
        // since 4.2.0; a module without the queue says nothing
        queuePosition: amount(event.queuePosition) ?? -1,
    }
}

/** The numbers of a starting torrent as one short line for the log, once per second (§4q phase 6b-3) */
export function startLine(status: TorrentStatus, sinceMs: number): string {
    return `torrent: start ${status.infoHash.slice(0, 8)}… ${Math.round(sinceMs / 1000)} s: peers ${status.peers}/${status.peersKnown}, seeds ${status.seeds}, dht ${status.dhtNodes}, `
        + `trackers ${status.trackersOk} ok ${status.trackersFailed} failed, web seeds ${status.webSeeds}, metadata ${status.hasMetadata ? "yes" : "no"}, ${status.downRate} B/s`
}

/** A torrent has started when its file list is there and its first bytes are (or nothing of it is wanted) */
const hasStarted = (status: TorrentStatus) => status.hasMetadata && (status.bytesDone > 0 || status.bytesWanted === 0)
/** The start of a torrent is logged this long at most */
const START_LOG_MS = 180_000
/** A `.torrent` file must be there within this time and is at most this large */
const TORRENT_FILE_PATIENCE_MS = 15_000
const TORRENT_FILE_LIMIT = 8 * 1024 * 1024

function torrentError(error: unknown): TorrentError {
    if (error instanceof TorrentError) return error
    const text = error instanceof Error ? error.message : String(error)
    const at = text.indexOf(ERROR_MARK)
    return new TorrentError(at >= 0 ? text.slice(at + ERROR_MARK.length) : text)
}

function whole(value: number, what: string): number {
    if (!Number.isSafeInteger(value) || value < 0) throw new TorrentError(`${what} must be a whole number`)
    return value
}

export type TorrentClient = ReturnType<typeof createTorrentClient>

export function createTorrentClient(native: TorrentNative) {
    const listeners = new Set<(statuses: TorrentStatus[]) => void>()
    // the running session's own folder (state, resume data), "" without a session: nothing is moved into it
    let sessionFolder = ""
    // called by the module once per second with every torrent of the session
    const onNative = (statuses: unknown) => {
        if (listeners.size === 0 || !Array.isArray(statuses)) return
        const read = statuses.map(readTorrentStatus).filter((status): status is TorrentStatus => status !== null)
        if (read.length === 0) return
        for (const listener of [...listeners]) listener(read)
    }
    const call = async <Result>(work: () => Promise<Result>): Promise<Result> => {
        try {
            return await work()
        }
        catch (error) {
            throw torrentError(error)
        }
    }
    const hash = (infoHash: string) => {
        const lower = infoHash.toLowerCase()
        if (!isInfoHash(lower)) throw new TorrentError("that is no info hash")
        return lower
    }
    const added = (infoHash: string) => {
        const lower = infoHash.toLowerCase()
        if (!isInfoHash(lower)) throw new TorrentError("the module answered without an info hash")
        return lower
    }

    return {
        /** Starts the session; the torrents of the last one come back from their resume data. Fails while one runs. */
        start: (settings: TorrentSettings) => call(async () => {
            const folder = plainPath(settings.folder)
            await native.start({
                folder,
                listenPort: whole(settings.listenPort ?? 0, "the port"),
                connections: whole(settings.connections ?? DEFAULT_CONNECTIONS, "the number of connections"),
                dht: settings.dht ?? true,
                lsd: settings.lsd ?? true,
                trackers: settings.trackers ?? true,
                pex: settings.pex ?? true,
                portMapping: settings.portMapping ?? true,
                utp: settings.utp ?? true,
            }, onNative)
            sessionFolder = folder
        }),
        /** Saves resume data and state and ends the session; nothing happens without one */
        stop: () => call(async () => {
            await native.stop()
            sessionFolder = ""
        }),
        /** The answer is the info hash; a torrent the session has already is answered with its hash */
        addMagnet: (uri: string, saveFolder: string) => call(async () => {
            if (!/^magnet:\?/i.test(uri)) throw new TorrentError("that is no magnet link")
            return added(await native.addMagnet(uri, plainPath(saveFolder)))
        }),
        addTorrentFile: (bytes: Uint8Array, saveFolder: string) => call(async () => {
            if (bytes.byteLength === 0) throw new TorrentError("the torrent file is empty")
            // exactly the file's bytes, as a buffer of its own
            const buffer = new ArrayBuffer(bytes.byteLength)
            new Uint8Array(buffer).set(bytes)
            return added(await native.addTorrentFile(buffer, plainPath(saveFolder)))
        }),
        /** With `deleteFiles` the answer comes when the files are gone */
        remove: (infoHash: string, deleteFiles: boolean) => call(() => native.remove(hash(infoHash), deleteFiles)),
        files: (infoHash: string): Promise<TorrentFile[]> => call(async () => (await native.files(hash(infoHash))).map(file => ({
            index: file.index, path: file.path, size: file.size, offset: file.offset, pieceStart: file.pieceStart, pieceEnd: file.pieceEnd,
        }))),
        /** 0: not loaded, 1–7: loaded, 7 first */
        setFilePriority: (infoHash: string, index: number, priority: number) => call(async () => {
            if (whole(priority, "the priority") > 7) throw new TorrentError("the priority goes from 0 to 7")
            await native.setFilePriority(hash(infoHash), whole(index, "the file's index"), priority)
        }),
        setSequential: (infoHash: string, on: boolean) => call(() => native.setSequential(hash(infoHash), on)),
        /** Pauses or resumes one torrent; a paused one stays paused after a restart (phase 6f) */
        setPaused: (infoHash: string, paused: boolean) => call(() => native.setPaused(hash(infoHash), paused)),
        /** 4.2.0: into the download queue or out of it; of the queued torrents only `activeDownloads` download at once */
        setQueued: (infoHash: string, queued: boolean) => call(() => native.setQueued(hash(infoHash), queued)),
        /** 4.2.0: the session's limits from now on, in bytes per second (0: none); a stream is never braked or queued */
        setLimits: (limits: TorrentLimits) => call(async () => {
            if (whole(limits.activeDownloads, "the number of downloads at once") < 1) throw new TorrentError("at least one download runs at once")
            await native.setLimits({
                downloadLimit: whole(limits.downloadLimit, "the download limit"),
                uploadLimit: whole(limits.uploadLimit, "the upload limit"),
                activeDownloads: limits.activeDownloads,
                stopWhenFinished: limits.stopWhenFinished,
            })
        }),
        /**
         * 4.2.0: moves the torrent's files to another folder (a path or `file://`); the answer comes when they are there.
         * Nothing there is replaced: a file of the same name in the folder fails the move.
         */
        moveStorage: (infoHash: string, folder: string) => call(async () => {
            const path = plainPath(folder)
            // the module checks the real place (links resolved, other torrents' folders); what the text shows is refused here
            if (hasDotSegment(path)) throw new TorrentError("the folder to move to must be a plain path, without . or ..")
            if (sessionFolder && (path === sessionFolder || path.startsWith(`${sessionFolder}/`))) throw new TorrentError("the files cannot be moved into the session's own folder")
            await native.moveStorage(hash(infoHash), path)
        }),
        /** Piece `firstPiece + n` is wanted within `firstMs + n * stepMs` milliseconds, for `count` pieces */
        setPieceDeadlines: (infoHash: string, firstPiece: number, count: number, firstMs: number, stepMs: number) => call(() => native.setPieceDeadlines(
            hash(infoHash), whole(firstPiece, "the first piece"), whole(count, "the number of pieces"), whole(firstMs, "the first deadline"), whole(stepMs, "the step"),
        )),
        clearDeadlines: (infoHash: string) => call(() => native.clearDeadlines(hash(infoHash))),
        status: (infoHash: string) => call(async () => {
            const status = readTorrentStatus(await native.status(hash(infoHash)))
            if (!status) throw new TorrentError("the module answered without a status")
            return status
        }),
        /** One peer by its IP address, past every way of finding peers */
        connectPeer: (infoHash: string, host: string, port: number) => call(async () => {
            if (whole(port, "the peer's port") < 1 || port > 65535) throw new TorrentError("the peer's port is out of range")
            await native.connectPeer(hash(infoHash), host, port)
        }),
        /**
         * The address one file is served at for the app's player (GET and HEAD with Range). A reader that asks for bytes
         * the torrent does not have yet waits for them, and the download is pulled to where it reads.
         */
        serve: (infoHash: string, index: number) => call(async () => {
            const address = await native.serve(hash(infoHash), whole(index, "the file's index"))
            if (!isOutletAddress(address)) throw new TorrentError("the module answered without an address of its outlet")
            return address
        }),
        /**
         * Phase 7b: a plain file of the app's storage (path or `file://`) shared into the local network for a TV at
         * `toward` (its IPv4 address; "" for the Wi-Fi's address). Needs no session.
         */
        shareFile: (path: string, toward: string) => call(async () => {
            const address = await native.shareFile(plainPath(path), toward)
            if (!isShareAddress(address)) throw new TorrentError("the module answered without an address in the network")
            return address
        }),
        /** Like `shareFile` for one file of a torrent of the session */
        shareTorrent: (infoHash: string, index: number, toward: string) => call(async () => {
            const address = await native.shareTorrent(hash(infoHash), whole(index, "the file's index"), toward)
            if (!isShareAddress(address)) throw new TorrentError("the module answered without an address in the network")
            return address
        }),
        /** Every share into the network ends */
        unshare: () => call(() => native.unshare()),
        /** Every torrent of the session, once per second while there is one; the answer ends the listening */
        onStatus(listener: (statuses: TorrentStatus[]) => void): () => void {
            listeners.add(listener)
            return () => void listeners.delete(listener)
        },
    }
}

let device: Promise<TorrentClient> | null = null
/** The area's session, one for every request of the core, and where its streams are saved */
let session: Promise<TorrentClient> | null = null
let saveFolder = ""
/** Whether that place is the app's cache (and not a folder the user chose) */
let saveInCache = true
/** Torrents whose start is logged once per second: how each listening ends */
const starting = new Map<string, () => void>()

/** Whether the torrent module was loaded in this run (test link core?memory=report) */
export function torrentLoaded(): boolean {
    return device !== null
}

/** The module is loaded when the session is first asked for, so an app that never uses torrents never touches it */
export function deviceTorrent(): Promise<TorrentClient> {
    device ??= import("../../../modules/core-torrent").then(module => createTorrentClient(module.default))
    return device
}

/**
 * The device's side of the core's torrent area (core/torrent/torrent.ts, §4q phase 6b-2): the one session, started
 * when it is first needed (its state under the app's documents, what a stream loads under the app's cache), every call
 * a wait the watch of the screens' thread sees.
 */
export function torrentDeviceFor(
    watch: BlockingWatch,
    client: () => Promise<TorrentClient> = deviceTorrent,
    folders: () => Promise<TorrentFolders> = () => import("expo-file-system/legacy"),
): TorrentDevice & TorrentNoticeHost {
    // the saved settings (core/torrent/torrent.ts, sessionSettingsOf) for the next start of the session
    let wanted: TorrentSessionSettings = { downloadDir: "", listenPort: 0 }
    // 4.2.0: the limits the settings ask for, and what the running session was last told ("": nothing yet)
    let limits: TorrentLimits | null = null
    let told = ""
    const tellLimits = async (torrent: TorrentClient) => {
        if (!limits) return
        const text = JSON.stringify(limits)
        if (text === told) return
        told = text
        try {
            await torrent.setLimits(limits)
            log.info(`torrent: limits down ${limits.downloadLimit} B/s, up ${limits.uploadLimit} B/s, ${limits.activeDownloads} downloads at once, stop when finished ${limits.stopWhenFinished ? "on" : "off"}`)
        }
        catch (error) {
            told = ""
            log.info(`torrent: the limits could not be set (${error instanceof Error ? error.message : String(error)})`)
        }
    }
    // when each torrent was added, for the log line of its file list (metadata from peers for a magnet)
    const addedAt = new Map<string, number>()
    let listed = new Set<string>()
    const log = logger("Core")
    const short = (infoHash: string) => `${infoHash.slice(0, 8)}…`
    /** What is left in the streams' folder, for the log after a removal: the count of its entries (-1: unknown) */
    const leftInFolder = async (): Promise<{ count: number, text: string }> => {
        try {
            const files = await folders()
            const address = `file://${saveFolder}`
            const info = await files.getInfoAsync(address)
            if (!info.exists) return { count: 0, text: "folder gone" }
            const count = (await files.readDirectoryAsync(address)).length
            return { count, text: `${count} entries left in the folder` }
        }
        catch {
            return { count: -1, text: "folder not readable" }
        }
    }
    const endStartLog = (infoHash: string) => {
        starting.get(infoHash)?.()
        starting.delete(infoHash)
    }
    /** One line of numbers per second from adding a torrent until it has started: what the session sees of peers, DHT and trackers */
    const logStart = (torrent: TorrentClient, infoHash: string) => {
        if (starting.has(infoHash)) return
        const since = Date.now()
        let lastError = ""
        starting.set(infoHash, torrent.onStatus(statuses => {
            const mine = statuses.find(status => status.infoHash === infoHash)
            if (!mine) return
            const waited = Date.now() - since
            log.info(startLine(mine, waited))
            if (mine.trackerError && mine.trackerError !== lastError) {
                lastError = mine.trackerError
                log.info(`torrent: a tracker of ${short(infoHash)} failed: ${lastError}`)
            }
            if (hasStarted(mine) || waited >= START_LOG_MS) endStartLog(infoHash)
        }))
    }
    const open = () => session ??= (async () => {
        const [torrent, files] = await Promise.all([client(), folders()])
        saveFolder = plainPath(`${files.cacheDirectory}core-torrent-streams`)
        saveInCache = true
        if (wanted.downloadDir) {
            try {
                saveFolder = plainPath(wanted.downloadDir)
                saveInCache = false
            }
            catch {
                // a place the module cannot use: the app's cache, as without the setting
            }
        }
        try {
            await torrent.start({ folder: plainPath(`${files.documentDirectory}core-torrent`), listenPort: wanted.listenPort })
        }
        catch (error) {
            // a session that runs already (a check of the test app started it) is the one to use
            if (!(error instanceof TorrentError) || !error.message.includes("running already")) {
                session = null
                throw error
            }
        }
        told = ""
        await tellLimits(torrent)
        return torrent
    })()
    const call = <Args extends unknown[], Result>(work: (torrent: TorrentClient, ...args: Args) => Promise<Result>) =>
        watch.waiting(async (...args: Args) => work(await open(), ...args), "torrent")
    return {
        useSettings(settings) {
            wanted = settings
        },
        // a running session hears a change at once, the next one when it starts; no session is started for it
        useLimits: watch.waiting(async (next: TorrentLimits) => {
            limits = next
            const running = session
            if (running) await running.then(tellLimits, () => {})
        }, "torrent"),
        addMagnet: call(async (torrent, uri: string, folder?: string) => {
            // never queued here: a torrent that waits in the queue is paused and gets no file list (see setQueued)
            const infoHash = await torrent.addMagnet(uri, folder || saveFolder)
            addedAt.set(infoHash, Date.now())
            log.info(`torrent: magnet added (${short(infoHash)}, trackers ${(uri.match(/[?&]tr=/g) ?? []).length}, web seeds ${(uri.match(/[?&]ws=/g) ?? []).length})`)
            logStart(torrent, infoHash)
            return infoHash
        }),
        addTorrentFileFrom: call(async (torrent, address: string, folder?: string) => {
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), TORRENT_FILE_PATIENCE_MS)
            try {
                const response = await fetch(address, { signal: controller.signal })
                if (!response.ok) throw new TorrentError(`the torrent file answered ${response.status}`)
                const bytes = new Uint8Array(await response.arrayBuffer())
                if (bytes.byteLength > TORRENT_FILE_LIMIT) throw new TorrentError("the torrent file is too large")
                const infoHash = await torrent.addTorrentFile(bytes, folder || saveFolder)
                addedAt.set(infoHash, Date.now())
                log.info(`torrent: torrent file added (${short(infoHash)}, ${bytes.byteLength} bytes)`)
                logStart(torrent, infoHash)
                return infoHash
            }
            catch (error) {
                // no address in the log
                log.info(`torrent: the torrent file could not be used (${error instanceof TorrentError ? error.message : error instanceof Error ? error.name : "unknown"})`)
                throw error
            }
            finally {
                clearTimeout(timer)
            }
        }),
        files: call(async (torrent, infoHash: string) => {
            const files = await torrent.files(infoHash)
            if (!listed.has(infoHash)) {
                listed.add(infoHash)
                const since = addedAt.get(infoHash)
                log.info(`torrent: file list of ${short(infoHash)} has ${files.length} files${since ? `, ${Date.now() - since} ms after adding` : ""}`)
            }
            return files
        }),
        status: call((torrent, infoHash: string) => torrent.status(infoHash)),
        setFilePriority: call((torrent, infoHash: string, index: number, priority: number) => torrent.setFilePriority(infoHash, index, priority)),
        setSequential: call((torrent, infoHash: string, on: boolean) => torrent.setSequential(infoHash, on)),
        setPaused: call(async (torrent, infoHash: string, paused: boolean) => {
            await torrent.setPaused(infoHash, paused)
            log.info(`torrent: ${short(infoHash)} ${paused ? "paused" : "resumed"}`)
        }),
        // 4.2.0: the torrent client's downloads take their turn; asked by the core once the files of one are chosen
        setQueued: call(async (torrent, infoHash: string, queued: boolean) => {
            await torrent.setQueued(infoHash, queued)
            log.info(`torrent: ${short(infoHash)} ${queued ? "into the queue" : "out of the queue"}`)
        }),
        // phase 6f: the download module's service holds the process while the torrent client downloads
        keepRunning: watch.waiting(async (on: boolean, title: string) => {
            const module = (await import("../../../modules/core-download")).default
            const done = await module.keepTorrents(on, title).catch(() => false)
            log.info(`torrent: process ${on ? (done ? "held in front" : "could not be held (app in the background)") : "released"}`)
            return done
        }, "torrent keep"),
        moveStorage: call(async (torrent, infoHash: string, folder: string) => {
            await torrent.moveStorage(infoHash, folder)
            log.info(`torrent: files of ${short(infoHash)} moved`)
        }),
        // 4.2.0 (core/torrent/torrent-notice.ts): the progress in that notice, a notice at a torrent's end; tapping opens Downloads
        notices: {
            t: tr,
            update: watch.waiting(async ({ title, text, done, total }) => {
                const module = (await import("../../../modules/core-download")).default
                return module.updateTorrentNotice(title, text, done, total, shortcutLink("/android-downloads")).catch(() => false)
            }, "torrent notice"),
            end: watch.waiting(async (hash: string, title: string, text: string) => {
                const module = (await import("../../../modules/core-download")).default
                return module.notice(`torrent-${hash}`, title, text, tr("Episode downloads", "Folgen-Downloads"), shortcutLink("/android-downloads")).catch(() => false)
            }, "torrent end notice"),
            ask: async () => (await import("@/main/android-downloads/_lib/download-notifications")).askForDownloadNotices(),
        },
        setPieceDeadlines: call((torrent, infoHash: string, firstPiece: number, count: number, firstMs: number, stepMs: number) => torrent.setPieceDeadlines(infoHash, firstPiece, count, firstMs, stepMs)),
        serve: call(async (torrent, infoHash: string, index: number) => {
            const address = await torrent.serve(infoHash, index)
            // the address without its token
            log.info(`torrent: outlet for file ${index} of ${short(infoHash)} at ${address.replace(/\/[0-9a-f]{32}\/.*$/, "/<token>/…")}`)
            return address
        }),
        remove: call(async (torrent, infoHash: string, deleteFiles: boolean) => {
            endStartLog(infoHash)
            addedAt.delete(infoHash)
            listed.delete(infoHash)
            try {
                await torrent.remove(infoHash, deleteFiles)
            }
            catch (error) {
                log.info(`torrent: ${short(infoHash)} could not be removed (${error instanceof Error ? error.message : String(error)}); ${(await leftInFolder()).text}`)
                throw error
            }
            log.info(`torrent: ${short(infoHash)} removed${deleteFiles ? " with its files" : ""}; ${(await leftInFolder()).text}`)
        }),
        stop: watch.waiting(async () => {
            const old = session
            session = null
            told = ""
            listed = new Set()
            for (const infoHash of [...starting.keys()]) endStartLog(infoHash)
            if (old) {
                await (await old).stop()
                const left = await leftInFolder()
                let text = left.text
                // What a stream loaded lies in the app's cache, and with the session gone nothing of it is needed:
                // whatever a removal left behind (a torrent that never got removed, a part file) goes now.
                if (saveInCache && left.count > 0) {
                    await (await folders()).deleteAsync(`file://${saveFolder}`, { idempotent: true }).catch(() => {})
                    text += `, folder cleared: ${(await leftInFolder()).text}`
                }
                log.info(`torrent: session stopped; ${text}`)
            }
        }, "torrent"),
        onStatus(listener) {
            let off = () => {}
            let ended = false
            void open().then(torrent => {
                if (!ended) off = torrent.onStatus(listener)
            }, () => {})
            return () => {
                ended = true
                off()
            }
        },
        wait: watch.waiting((milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds)), "torrent wait"),
        // the core's own lines (the file chosen of a collection, phase 6e): numbers only
        note: (text: string) => log.info(`torrent: ${text}`),
    }
}
