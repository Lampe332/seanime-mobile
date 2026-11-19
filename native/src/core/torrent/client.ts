// geschrieben nach: App-Code src/api/hooks/torrent_client.hooks.ts, src/main/android-downloads/_screens/torrent-downloads.tsx (Liste, Pause, Fortsetzen, Entfernen, Restzeit "<n> hours left"), src/main/entry/_containers/torrent-search/torrent-search-phone.tsx (Download-Blatt), App-Typen TorrentClient_Torrent, TorrentClient_TorrentStatus, TorrentClientAction_Variables und TorrentClientDownload_Variables (src/api/generated), Form der Aufzeichnungen TORRENT_CLIENT.* vom 13.11.2026 und docs/EIGENER-KERN.md §4q (Phase 6f); kein Server-Quelltext

import { like } from "drizzle-orm"
import { inOrder } from "../database/database"
import { torrentKept } from "../database/schema"
import { CoreError } from "../errors"
import type { CoreEnvironment, CoreRequest } from "../registry"
import {
    addTorrent,
    amount,
    deviceOf,
    episodeOfName,
    filesOf,
    isVideo,
    keep,
    type TorrentDevice,
    type TorrentDeviceStatus,
    type TorrentFinder,
    torrentOf,
} from "./torrent"

/*
 * The torrent client without the server (area `torrent`, phase 6f): torrents to download, not to stream. They run in
 * the same session of the torrent module as a stream, each saved to the folder the download sheet names (the anime's
 * folder in the library, so the library scan finds the episodes). The module keeps them across restarts by their
 * resume data (paused ones stay paused); the core keeps which of the session's torrents are the client's, in
 * `torrent_kept` under `client:<info hash>`. While one of them downloads, the device holds the app's process in front
 * (`keepRunning`: a notice of the download module), else Android freezes a process in the background.
 *
 * 4.2.0, the download queue: every torrent of the client takes its turn in it, so the row `client:<info hash>` is also
 * what says "queued". The module forgets that for a torrent the user paused when the app ends (a pause takes
 * libtorrent's queue flag out of the resume data), so the core says it again at the app's start and before a resume
 * (`enqueue`). A torrent is queued only after its files are chosen: one that waits in the queue is paused and gets no
 * file list from its peers.
 */

type Json = Record<string, unknown>

const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value)
const PREFIX = "client:"
const isInfoHash = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{40}$/.test(value)

type ClientRow = { hash: string, name: string, destination: string, mediaId: number, addedAt: string }

async function clientRows(environment: CoreEnvironment): Promise<ClientRow[]> {
    const database = await environment.database()
    const rows = await inOrder(database, () => database.select({ content: torrentKept.content }).from(torrentKept).where(like(torrentKept.key, `${PREFIX}%`)))
    return rows
        .map(row => row.content as Partial<ClientRow>)
        .filter((row): row is ClientRow => isInfoHash(row.hash))
        .sort((a, b) => String(a.addedAt).localeCompare(String(b.addedAt)))
}

/** Whether the session has torrents of the client, so it must not end with a stream (torrent.ts, stop) */
export async function hasClientTorrents(environment: CoreEnvironment): Promise<boolean> {
    if (!environment.database) return false
    return (await clientRows(environment)).length > 0
}

/** Into the download queue (4.2.0). A device without a queue, or a torrent it cannot queue, downloads outside it. */
async function enqueue(device: TorrentDevice, infoHash: string): Promise<void> {
    if (!device.setQueued) return
    await device.setQueued(infoHash, true).catch(error => device.note?.(`torrent client: a torrent could not be queued (${error instanceof Error ? error.message : String(error)})`))
}

/* ---- Holding the process while something downloads ---- */

let known = new Set<string>()
let unlisten: (() => void) | null = null
let held: boolean | null = null
let resumedAtStart = false

/** Tests: nothing listens, nothing is held, the next run resumes again */
export function forgetTorrentClient() {
    unlisten?.()
    unlisten = null
    known = new Set()
    held = null
    resumedAtStart = false
}

const isLoading = (status: TorrentDeviceStatus) => !status.error && (status.state === "downloading" || status.state === "metadata" || status.state === "checking")

async function hold(device: TorrentDevice, on: boolean) {
    if (held === on || !device.keepRunning) return
    held = on
    const done = await device.keepRunning(on, "Torrent download").catch(() => false)
    // a start refused in the background is tried again with the next change
    if (on && !done) held = null
}

/** Listens to the session while the client has torrents: the process is held exactly while one of them loads */
async function watchClient(device: TorrentDevice, environment: CoreEnvironment) {
    known = new Set((await clientRows(environment)).map(row => row.hash))
    if (known.size === 0) {
        unlisten?.()
        unlisten = null
        await hold(device, false)
        return
    }
    unlisten ??= device.onStatus(statuses => {
        const loading = statuses.some(status => known.has(status.infoHash) && isLoading(status))
        void hold(device, loading)
    })
    // at once as well, not only with the next status a second later
    let loading = false
    for (const hash of known) loading ||= await device.status(hash).then(isLoading, () => false)
    await hold(device, loading)
}

/**
 * At the app's start (the first status with the area on): the session starts when the client has torrents, the module
 * brings them back from their resume data, and they go on downloading. Unasked work, after the request.
 */
export function resumeClientAtStart(environment: CoreEnvironment): void {
    if (resumedAtStart || !environment.torrent || !environment.database) return
    resumedAtStart = true
    const work = async () => {
        const rows = await clientRows(environment)
        if (rows.length === 0) return
        const device = await deviceOf(environment)
        let back = 0
        for (const row of rows) {
            if (!(await device.status(row.hash).then(() => true, () => false))) continue
            back++
            // the module no longer knows that a torrent paused before the restart belongs to the queue
            await enqueue(device, row.hash)
        }
        device.note?.(`torrent client: ${back} of ${rows.length} torrents back after the start`)
        await watchClient(device, environment)
    }
    setTimeout(() => void (environment.unasked ? environment.unasked("torrent client at start", work) : work()).catch(() => undefined), 0)
}

/* ---- GET /api/v1/torrent-client/list ---- */

/** The time left in the words the screen reads ("3 hours left", "No ETA") */
export function etaOf(status: TorrentDeviceStatus): string {
    const left = Math.max(0, status.bytesWanted - status.bytesDone)
    if (status.state !== "downloading" || status.downRate <= 0 || left === 0) return "No ETA"
    const seconds = Math.ceil(left / status.downRate)
    if (seconds < 60) return `${seconds} seconds left`
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes left`
    return `${Math.floor(seconds / 3600)} hours left`
}

/** The module's word for a torrent as the screen's status (TorrentClient_TorrentStatus) */
export function clientStatusOf(status: TorrentDeviceStatus): string {
    if (status.error) return "error"
    if (status.state === "paused") return "paused"
    if (status.state === "finished" || status.state === "seeding") return "seeding"
    if (status.state === "downloading" || status.state === "metadata") return "downloading"
    return "other"
}

/** One torrent in the form of TorrentClient_Torrent */
export function clientTorrentOf(row: ClientRow, status: TorrentDeviceStatus | null): Json {
    const name = status?.name || row.name || row.hash
    return {
        name,
        hash: row.hash,
        seeds: status?.seeds ?? 0,
        upSpeed: `${amount(status?.upRate ?? 0)}/s`,
        downSpeed: `${amount(status?.downRate ?? 0)}/s`,
        progress: status ? Math.min(1, Math.max(0, status.progress)) : 0,
        size: amount(status?.bytesWanted ?? 0),
        eta: status ? etaOf(status) : "No ETA",
        status: status ? clientStatusOf(status) : "error",
        contentPath: `${row.destination.replace(/\/+$/, "")}/${name}`,
        peers: status?.peers ?? 0,
        ratio: 0,
        addedAt: row.addedAt,
        queueIndex: Math.max(0, status?.queuePosition ?? 0),
        forceStart: false,
        sequential: false,
        error: status ? status.error : "the torrent is no longer in the session",
    }
}

/** GET /api/v1/torrent-client/list → the client's torrents, `null` without any (as recorded) */
export async function torrentClientList(_request: CoreRequest, environment: CoreEnvironment): Promise<Json[] | null> {
    const rows = await clientRows(environment)
    if (rows.length === 0) return null
    const device = await deviceOf(environment)
    const list: Json[] = []
    for (const row of rows) list.push(clientTorrentOf(row, await device.status(row.hash).catch(() => null)))
    await watchClient(device, environment)
    return list
}

/* ---- POST /api/v1/torrent-client/action ---- */

/** POST /api/v1/torrent-client/action: pause, resume, remove (with its files), remove-keep-files → true */
export async function torrentClientAction(request: CoreRequest, environment: CoreEnvironment): Promise<true> {
    const body = isRecord(request.body) ? request.body : {}
    const action = typeof body.action === "string" ? body.action : ""
    // the phone has no file manager to open a folder in (the server opened one on the computer it ran on)
    if (action.startsWith("open")) throw new CoreError("opening a folder is not available on the phone", 400)
    if (!["pause", "resume", "remove", "remove-keep-files"].includes(action)) throw new CoreError(`the torrent client of the core does not know the action "${action}"`, 400)
    const hash = typeof body.hash === "string" ? body.hash.toLowerCase() : ""
    if (!(await clientRows(environment)).some(row => row.hash === hash)) throw new CoreError("the torrent client has no such torrent", 404)
    const device = await deviceOf(environment)
    if (action === "pause" || action === "resume") {
        if (!device.setPaused) throw new CoreError("torrents cannot be paused here")
        // a resumed torrent takes its turn again, also when the start's enqueue has not come to it yet
        if (action === "resume") await enqueue(device, hash)
        await device.setPaused(hash, action === "pause")
    }
    else {
        try {
            await device.remove(hash, action === "remove")
        }
        catch (error) {
            // a torrent the session lost is only forgotten; anything else stays and is told
            const text = error instanceof Error ? error.message : String(error)
            if (!/no such torrent/.test(text)) throw new CoreError(`the torrent could not be removed: ${text}`)
        }
        await keep(environment, `${PREFIX}${hash}`, null)
    }
    await watchClient(device, environment)
    return true
}

/* ---- POST /api/v1/torrent-client/download ---- */

/** A folder the module can save to: an absolute path or a file:// address */
function folderOf(destination: unknown): string {
    const text = typeof destination === "string" ? destination.trim() : ""
    if (/^file:\/\/\//.test(text)) {
        try {
            return decodeURIComponent(text.slice("file://".length))
        }
        catch {
            return ""
        }
    }
    return text.startsWith("/") ? text : ""
}

/** The files to load: with `smartSelect` only the video files of the missing episodes, with `deselect` not those indices */
async function chooseFiles(device: TorrentDevice, infoHash: string, body: Json, environment: CoreEnvironment) {
    const smart = isRecord(body.smartSelect) && body.smartSelect.enabled === true && Array.isArray(body.smartSelect.missingEpisodeNumbers)
        ? (body.smartSelect.missingEpisodeNumbers as unknown[]).filter((value): value is number => typeof value === "number")
        : []
    const deselected = isRecord(body.deselect) && body.deselect.enabled === true && Array.isArray(body.deselect.indices)
        ? (body.deselect.indices as unknown[]).filter((value): value is number => typeof value === "number")
        : []
    if (smart.length === 0 && deselected.length === 0) return
    // a torrent the session had already may wait in the queue without its file list, and would never get it there
    if (device.setQueued) {
        const status = await device.status(infoHash)
        if (status.state === "queued" && !status.hasMetadata) await device.setQueued(infoHash, false).catch(() => undefined)
    }
    const files = await filesOf(device, infoHash, environment)
    const wanted = new Set(smart.length === 0
        ? files.map(file => file.index)
        : files.filter(file => {
            const named = episodeOfName(file.path)
            return isVideo(file) && !named.extra && smart.includes(named.episode)
        }).map(file => file.index))
    for (const index of deselected) wanted.delete(index)
    // nothing would be left: the whole torrent, rather than a download of nothing
    if (wanted.size === 0) {
        device.note?.(`torrent client: no file of ${files.length} fits the missing episodes, all are loaded`)
        return
    }
    for (const file of files) {
        if (!wanted.has(file.index)) await device.setFilePriority(infoHash, file.index, 0)
    }
    device.note?.(`torrent client: ${wanted.size} of ${files.length} files chosen`)
}

/**
 * POST /api/v1/torrent-client/download: every torrent of the sheet into the destination (the anime's folder in the
 * library) → true. A torrent without magnet link and info hash is asked of its provider, as for a stream.
 */
export async function torrentClientDownload(request: CoreRequest, environment: CoreEnvironment, finder?: TorrentFinder): Promise<true> {
    const body = isRecord(request.body) ? request.body : {}
    const torrents = Array.isArray(body.torrents) ? body.torrents.filter(isRecord) : []
    if (torrents.length === 0) throw new CoreError("no torrent chosen", 400)
    const folder = folderOf(body.destination)
    if (!folder) throw new CoreError("the destination must be a folder on the phone (a path starting with /)", 400)
    const mediaId = isRecord(body.media) && typeof body.media.id === "number" ? body.media.id : 0
    const device = await deviceOf(environment)
    for (const chosen of torrents) {
        const { torrent, magnet } = await torrentOf({ torrent: chosen }, environment, finder)
        const infoHash = await addTorrent(device, torrent, magnet, folder)
        await keep(environment, `${PREFIX}${infoHash}`, {
            hash: infoHash,
            name: typeof torrent.name === "string" ? torrent.name : "",
            destination: folder,
            mediaId,
            addedAt: new Date(environment.now()).toISOString(),
        })
        try {
            await chooseFiles(device, infoHash, body, environment)
        }
        finally {
            // only now: queued before its file list, a magnet link behind `activeDownloads` running downloads would be
            // paused, get no list, and later load every file instead of the chosen ones
            await enqueue(device, infoHash)
        }
    }
    await watchClient(device, environment)
    return true
}
