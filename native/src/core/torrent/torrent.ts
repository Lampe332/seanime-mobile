// geschrieben nach: App-Code src/api/hooks/torrentstream.hooks.ts, handle-torrent-stream.ts und native-player.tsx (Ereignisse "open-and-await", "watch", "abort-open"), App-Typen Models_TorrentstreamSettings, TorrentstreamStartStream_Variables, HibikeTorrent_AnimeTorrent, HibikeTorrent_BatchEpisodeFiles, Torrentstream_BatchHistoryResponse, Torrentstream_FilePreview, Torrentstream_TorrentStatus und NativePlayer_PlaybackInfo (src/api/generated), Form der Aufzeichnungen TORRENTSTREAM.* vom 13.11.2026, eigenem $habari (extensions/helpers/prelude/habari.js, über library/local-files.ts) und docs/EIGENER-KERN.md §4q (Phase 6b-2); kein Server-Quelltext

import { eq } from "drizzle-orm"
import { listDataOf } from "../anilist/changes"
import { storedEntry } from "../anilist/store"
import { inOrder } from "../database/database"
import { settingsSections, torrentKept } from "../database/schema"
import { CoreError } from "../errors"
import { emitCoreEvent } from "../events"
import { parse } from "../extensions/helpers/prelude/habari"
import { animeWithEpisodes } from "../library/library"
import { VIDEO_EXTENSIONS, readName } from "../library/local-files"
import type { CoreEnvironment, CoreRequest } from "../registry"
import type { StreamEnvironment } from "../streams/onlinestream"
import { torrentFileAddressOf } from "./autoselect"
import { hasClientTorrents } from "./client"
import { autoSelectTorrent, magnetFromProvider } from "./search"

/*
 * Torrent streams without the server (area `torrent`): the torrent the app chose is added to the device's own session
 * (modules/core-torrent), the episode's file is picked by its name, and the app's player gets the address of the
 * module's outlet (`http://127.0.0.1:<port>/<token>/…`, with Range) the same way it gets a local file: as a
 * `native-player` "watch" message. One stream at a time; stopping it removes the torrent with what it loaded.
 *
 * Since 6c-1: without a torrent and with `autoSelect` the core finds one itself (search.ts, rule in autoselect.ts), a
 * torrent without magnet link and info hash is asked of its provider, and the saved settings reach the session
 * (`sessionSettingsOf`). Not here (6c-2): debrid.
 */

type Json = Record<string, unknown>

export type TorrentDeviceFile = { index: number, path: string, size: number, pieceStart: number, pieceEnd: number }

export type TorrentDeviceStatus = {
    infoHash: string
    /** The torrent's name once its file list is there (phase 6f, the torrent client's list); missing on a device that does not say */
    name?: string
    state: string
    error: string
    hasMetadata: boolean
    /** 0–1 */
    progress: number
    /** Bytes per second */
    downRate: number
    upRate: number
    peers: number
    seeds: number
    bytesDone: number
    bytesWanted: number
    /** What the session saw of the ways to peers (phase 6b-3); missing on a device that does not say */
    peersKnown?: number
    dhtNodes?: number
    trackersOk?: number
    trackersFailed?: number
    webSeeds?: number
    /** 4.2.0: where a torrent of the download queue stands, from 0; -1 or missing: not in the queue */
    queuePosition?: number
}

/** 4.2.0: what the session may use; a stream is outside all of it (modules/core-torrent) */
export type TorrentLimits = {
    /** Bytes per second, all downloads together; 0: no limit */
    downloadLimit: number
    /** Bytes per second, all uploads together; 0: no limit */
    uploadLimit: number
    /** How many downloads of the torrent client run at once; the others wait as "queued" */
    activeDownloads: number
    /** A download that is complete is paused instead of shared on */
    stopWhenFinished: boolean
}

/** What of the saved torrent stream settings the device's session uses when it starts next */
export type TorrentSessionSettings = {
    /** Where a stream's files go ("": the app's cache) */
    downloadDir: string
    /** The port the session listens on (0: any free one) */
    listenPort: number
}

/** The device's side: the one session of the torrent module. Every call starts the session when it does not run. */
export type TorrentDevice = {
    /** The settings the session starts with the next time it starts (a running session keeps its own) */
    useSettings?: (settings: TorrentSessionSettings) => void
    /** 4.2.0: the limits, for a running session at once, else for the next one. Missing: the device has none. */
    useLimits?: (limits: TorrentLimits) => Promise<void>
    /** The answer is the info hash (40 hex digits, lower case); a torrent the session has already answers with its hash */
    addMagnet: (uri: string, folder?: string) => Promise<string>
    /**
     * Loads the `.torrent` file at this address and adds it: the file list, the trackers and the web seeds are there at
     * once. The answer is the info hash. Missing: the device cannot.
     */
    addTorrentFileFrom?: (address: string, folder?: string) => Promise<string>
    files: (infoHash: string) => Promise<TorrentDeviceFile[]>
    status: (infoHash: string) => Promise<TorrentDeviceStatus>
    /** 0: not loaded, 7: first */
    setFilePriority: (infoHash: string, index: number, priority: number) => Promise<void>
    setSequential: (infoHash: string, on: boolean) => Promise<void>
    /** Phase 6f, the torrent client: kept in the torrent's resume data. Missing: the device cannot pause. */
    setPaused?: (infoHash: string, paused: boolean) => Promise<void>
    /** Phase 6f: holds the app's process in front while the torrent client downloads (a notice); the answer: whether it did */
    keepRunning?: (on: boolean, title: string) => Promise<boolean>
    /** 4.2.0: moves the torrent's files to another folder and goes on from there. Missing: the device cannot. */
    moveStorage?: (infoHash: string, folder: string) => Promise<void>
    setPieceDeadlines: (infoHash: string, firstPiece: number, count: number, firstMs: number, stepMs: number) => Promise<void>
    /** The address of the file at the module's outlet */
    serve: (infoHash: string, index: number) => Promise<string>
    remove: (infoHash: string, deleteFiles: boolean) => Promise<void>
    /** Ends the session; nothing happens without one */
    stop: () => Promise<void>
    /** Every torrent of the session, once per second; the answer ends the listening */
    onStatus: (listener: (statuses: TorrentDeviceStatus[]) => void) => () => void
    /** A wait the watch of the screens' thread sees */
    wait: (milliseconds: number) => Promise<void>
    /** A line for the log (numbers, no names); missing: nothing is written */
    note?: (text: string) => void
}

const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value)
const whole = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0)
const bodyOf = (request: CoreRequest): Json => (isRecord(request.body) ? request.body : {})
const nameOf = (path: string) => path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1)
const extensionOf = (path: string) => path.slice(path.lastIndexOf(".") + 1).toLowerCase()
export const isVideo = (file: TorrentDeviceFile) => VIDEO_EXTENSIONS.has(extensionOf(file.path))

/** The file list of a magnet link must be there within this time */
export const METADATA_PATIENCE_MS = 60_000
const METADATA_STEP_MS = 400
/** Wanted at once when a stream starts: the first pieces of the file, and its last ones (an MP4's index, an MKV's cues) */
const FIRST_PIECES = 6
const LAST_PIECES = 2
const MIME: Record<string, string> = { mp4: "video/mp4", m4v: "video/mp4", mkv: "video/x-matroska", webm: "video/webm", avi: "video/x-msvideo", ts: "video/mp2t" }

export async function deviceOf(environment: CoreEnvironment): Promise<TorrentDevice> {
    if (!environment.torrent) throw new CoreError("torrents are not available here")
    const device = await environment.torrent()
    await applySavedLimits(device, environment)
    return device
}

/* ---- What the core keeps: the settings and, per anime, the batch last streamed from ---- */

const SETTINGS_KEY = "settings"
const batchKey = (mediaId: number) => `batch:${mediaId}`

export async function kept(environment: CoreEnvironment, key: string): Promise<Json | null> {
    const database = await environment.database()
    const rows = await inOrder(database, () => database.select({ content: torrentKept.content }).from(torrentKept).where(eq(torrentKept.key, key)))
    return rows.length > 0 ? rows[0].content : null
}

export async function keep(environment: CoreEnvironment, key: string, content: Json | null): Promise<void> {
    const database = await environment.database()
    if (content === null) {
        await inOrder(database, () => database.delete(torrentKept).where(eq(torrentKept.key, key)))
        return
    }
    const values = { key, content, changedAt: environment.now() }
    await inOrder(database, () => database.insert(torrentKept).values(values).onConflictDoUpdate({ target: torrentKept.key, set: values }))
}

/** The settings as the screens know them (`Models_TorrentstreamSettings`), before the user saved any */
export const TORRENT_SETTINGS: Json = {
    enabled: false, autoSelect: true, preferredResolution: "", disableIPV6: false, downloadDir: "", addToLibrary: false,
    torrentClientHost: "", torrentClientPort: 0, streamingServerHost: "", streamingServerPort: 0, includeInLibrary: false,
    streamUrlAddress: "", slowSeeding: false, preloadNextStream: false, disableAcceleratedStartup: false,
    // the app's own (4.2.0), not a field of the server's row: a complete download is paused instead of shared on
    stopSeedingWhenFinished: false,
}

/** PATCH /api/v1/torrentstream/settings with the area on: kept by the core → the saved settings */
export async function saveTorrentSettings(request: CoreRequest, environment: CoreEnvironment): Promise<Json> {
    const wanted = bodyOf(request).settings
    if (!isRecord(wanted)) throw new CoreError("settings must be an object", 400)
    const before = await kept(environment, SETTINGS_KEY)
    const now = new Date(environment.now()).toISOString()
    const saved: Json = { id: 1, createdAt: typeof before?.createdAt === "string" ? before.createdAt : now, updatedAt: now }
    // a field of another kind than the screens send keeps what it was
    for (const [name, standard] of Object.entries(TORRENT_SETTINGS)) saved[name] = typeof wanted[name] === typeof standard ? wanted[name] : before?.[name] ?? standard
    await keep(environment, SETTINGS_KEY, saved)
    return saved
}

/**
 * The saved settings the device's session can use: `downloadDir` (an absolute path or a file:// address) as the place
 * of a stream's files, `torrentClientPort` (1–65535) as the port it listens on. The others have no counterpart in the
 * module (yet) and only stay saved.
 */
export function sessionSettingsOf(settings: Json | null): TorrentSessionSettings {
    const folder = typeof settings?.downloadDir === "string" ? settings.downloadDir.trim() : ""
    const port = settings?.torrentClientPort
    return {
        downloadDir: /^(\/|file:\/\/\/)/.test(folder) ? folder : "",
        listenPort: typeof port === "number" && Number.isInteger(port) && port > 0 && port <= 65535 ? port : 0,
    }
}

/** How many downloads run at once before the user chose (the settings' own start value, and the screen's) */
export const ACTIVE_DOWNLOADS = 3
/** The most a limit can be: 1 GiB per second, far above any line and well inside the module's whole numbers */
const LIMIT_MOST_KB = 1024 * 1024

/**
 * 4.2.0: the limits the session gets, from the settings' section `torrent` (`seanimeDownloadLimit` and
 * `seanimeUploadLimit` in KiB per second as the screen shows them, 0: none; `seanimeMaxActiveDownloads`) and the
 * torrent stream row (`stopSeedingWhenFinished`). Anything that is no such number counts as not set.
 */
export function limitsOf(section: Json | null, settings: Json | null): TorrentLimits {
    const kb = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), LIMIT_MOST_KB) * 1024 : 0)
    const active = section?.seanimeMaxActiveDownloads
    return {
        downloadLimit: kb(section?.seanimeDownloadLimit),
        uploadLimit: kb(section?.seanimeUploadLimit),
        activeDownloads: typeof active === "number" && Number.isInteger(active) && active >= 1 ? Math.min(active, 100) : ACTIVE_DOWNLOADS,
        stopWhenFinished: settings?.stopSeedingWhenFinished === true,
    }
}

/** Every use of the session passes here (deviceOf), so a change of the settings reaches a running session with the next request */
async function applySavedLimits(device: TorrentDevice, environment: CoreEnvironment): Promise<void> {
    if (!device.useLimits || !environment.database) return
    try {
        const database = await environment.database()
        const rows = await inOrder(database, () => database.select({ content: settingsSections.content }).from(settingsSections).where(eq(settingsSections.section, "torrent")))
        const section = rows.length > 0 && isRecord(rows[0].content) ? rows[0].content : null
        await device.useLimits(limitsOf(section, await kept(environment, SETTINGS_KEY)))
    }
    catch {
        // settings that cannot be read: the session keeps the limits it has
    }
}

async function applySavedSettings(device: TorrentDevice, environment: CoreEnvironment): Promise<void> {
    device.useSettings?.(sessionSettingsOf(await kept(environment, SETTINGS_KEY)))
}

/** The status with the core's torrent settings in it, once the user saved some with the area on */
export async function withTorrentSettings(status: unknown, environment: CoreEnvironment): Promise<unknown> {
    if (!isRecord(status)) return status
    const own = await kept(environment, SETTINGS_KEY)
    return own ? { ...status, torrentstreamSettings: own } : status
}

/** POST /api/v1/torrentstream/batch-history: the batch an episode of this anime was last streamed from */
export async function torrentBatchHistory(request: CoreRequest, environment: CoreEnvironment): Promise<Json> {
    const mediaId = whole(bodyOf(request).mediaId)
    return (mediaId ? await kept(environment, batchKey(mediaId)) : null) ?? { torrent: null, metadata: null, batchEpisodeFiles: null }
}

/** POST /api/v1/torrentstream/batch-history/delete → true */
export async function deleteTorrentBatchHistory(request: CoreRequest, environment: CoreEnvironment): Promise<true> {
    const mediaId = whole(bodyOf(request).mediaId)
    if (mediaId) await keep(environment, batchKey(mediaId), null)
    return true
}

/* ---- Picking the file ---- */

/** The magnet link of a torrent as the app hands it over: its own, or one made of its info hash; "" when it has neither */
export function magnetOf(torrent: Json): string {
    if (typeof torrent.magnetLink === "string" && /^magnet:\?/i.test(torrent.magnetLink)) return torrent.magnetLink
    const infoHash = typeof torrent.infoHash === "string" ? torrent.infoHash.trim().toLowerCase() : ""
    return /^[0-9a-f]{40}$/.test(infoHash) ? `magnet:?xt=urn:btih:${infoHash}` : ""
}

/* Own reading of a file's place in a collection (phase 6e, docs/EIGENER-KERN.md §4q "Torrent-Reste"): */

/** Kind words of the parser that mark something besides the episodes */
const EXTRA_KINDS = new Set(["op", "ed", "ncop", "nced", "nc", "sp", "special", "specials", "ova", "ovas", "oad", "oads", "oav", "oavs", "pv", "preview", "menu", "trailer", "extra", "extras", "bonus"])
/** A folder of extras ("Extras", "Specials", "NC", "OVA", "Menus", …) */
const EXTRA_FOLDER = /(?:^|[^a-z])(?:extras?|specials?|sps?|bonus|nc|ncop|nced|creditless|ovas?|oads?|oavs?|menus?|trailers?|pvs?|previews?|cms?)(?:$|[^a-z])/i
/** An extra in a file's name: openings and endings with their number, specials, OVAs, menus, recaps */
const EXTRA_NAME = /(?:^|[^a-z0-9])(?:nc ?(?:op|ed)\d*|(?:op|ed)\d+|sp\d*|specials?|ova\d*|oad\d*|oav\d*|extras?|bonus|menu\d*|pv\d*|trailer|preview|recap|creditless)(?:$|[^a-z0-9])/i
/** A season in a folder's name ("Season 2", "S02", "Show S2 [1080p]") */
const SEASON_FOLDER = /(?:^|[^a-z0-9])(?:season ?|s)0*(\d{1,2})(?:$|[^a-z0-9])/i

const positive = (value: unknown) => {
    const number = Number(value)
    return Number.isInteger(number) && number > 0 ? number : 0
}

/**
 * The number a name ends its title with when the parser read none ("Show 01", "01"): the last word of 1–4 digits (with
 * a version, "01v2"), not a year; a number with a decimal ("01.5") is a recap, an extra
 */
function numberLeftInTitle(stem: string): { episode: number, extra: boolean } {
    const plain = stem.replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, " ")
    if (/(?:^|[\s_-])\d{1,4}\.\d(?:$|[\s_-])/.test(plain)) return { episode: 0, extra: true }
    const words = plain.split(/[\s._-]+/).filter(word => /^\d{1,4}(?:v\d)?$/i.test(word) && !/^(?:19|20)\d\d$/.test(word))
    return { episode: positive(Number.parseInt(words.at(-1) ?? "", 10)), extra: false }
}

/** What a file's path says: the episode its name numbers (0: none), its season (0: none) and whether it is an extra */
export function episodeOfName(path: string): { episode: number, season: number, extra: boolean } {
    const name = nameOf(path)
    const folders = path.slice(0, path.length - name.length).split(/[\\/]/).filter(Boolean).reverse()
    const read = readName(name)
    let episode = positive(read.parsed.episode)
    let extra = read.kinds.some(kind => EXTRA_KINDS.has(kind)) || EXTRA_NAME.test(name) || folders.some(folder => EXTRA_FOLDER.test(folder))
    if (!episode && read.parsed.episode === undefined) {
        const left = numberLeftInTitle(name.slice(0, name.lastIndexOf(".") > 0 ? name.lastIndexOf(".") : name.length))
        episode = left.episode
        extra ||= left.extra
    }
    let season = positive(read.parsed.season)
    for (const folder of folders) {
        if (season) break
        season = positive(SEASON_FOLDER.exec(folder)?.[1])
    }
    return { episode, season, extra }
}

export type FileWanted = {
    /** The file the user chose */
    fileIndex?: unknown
    episodeNumber: number
    /** The season the torrent's name gives (0 or missing: none) */
    season?: number
    /** The anime's number of episodes (0 or missing: unknown); needed to read absolute numbering */
    episodeCount?: number
}

/**
 * The file of a torrent to stream, and in words how it was found: the one the user chose (`fileIndex`), the only video
 * file, or among the video files that are no extra: the ones of the wanted season (else of the lowest one, when the
 * names give several) whose number is the episode – the largest of them. None fits and the numbers go past the anime's
 * episode count: absolute numbering, the n-th episode is the lowest number + n − 1.
 */
export function fileChoiceOf(files: TorrentDeviceFile[], wanted: FileWanted): { file: TorrentDeviceFile, how: string } | null {
    if (typeof wanted.fileIndex === "number") {
        const file = files.find(one => one.index === wanted.fileIndex)
        return file ? { file, how: "the user's choice" } : null
    }
    const videos = files.filter(isVideo)
    if (videos.length <= 1) return videos[0] ? { file: videos[0], how: "the only video file" } : null
    const read = videos.map(file => ({ file, ...episodeOfName(file.path) }))
    let episodes = read.filter(one => !one.extra && one.episode > 0)
    const seasons = [...new Set(episodes.map(one => one.season).filter(Boolean))].sort((a, b) => a - b)
    const season = wanted.season && seasons.includes(wanted.season) ? wanted.season : seasons[0] ?? 0
    if (seasons.length > 0) episodes = episodes.filter(one => one.season === season || (seasons.length === 1 && one.season === 0))
    const largest = (list: typeof episodes) => list.sort((a, b) => b.file.size - a.file.size)[0]
    const counts = `${videos.length} video files, ${read.filter(one => one.extra).length} extras left out${seasons.length > 1 ? `, season ${season} of ${seasons.join("/")}` : ""}`
    const wantedOnes = episodes.filter(one => one.episode === wanted.episodeNumber)
    if (wantedOnes.length > 0) {
        return { file: largest(wantedOnes)!.file, how: `${counts}, ${wantedOnes.length} ${wantedOnes.length === 1 ? "copy" : "copies"} of the episode, the largest (${amount(largest(wantedOnes)!.file.size)})` }
    }
    const count = wanted.episodeCount ?? 0
    if (!count || wanted.episodeNumber > count || episodes.length === 0) return null
    const numbers = episodes.map(one => one.episode)
    const lowest = Math.min(...numbers)
    if (lowest <= 1 || Math.max(...numbers) <= count) return null
    const absolute = episodes.filter(one => one.episode === lowest + wanted.episodeNumber - 1)
    if (absolute.length === 0) return null
    return { file: largest(absolute)!.file, how: `${counts}, absolute numbering from ${lowest} (episode count ${count}), the largest (${amount(largest(absolute)!.file.size)})` }
}

/** The file of a torrent to stream (`fileChoiceOf` without the words) */
export function chooseFile(files: TorrentDeviceFile[], wanted: FileWanted): TorrentDeviceFile | null {
    return fileChoiceOf(files, wanted)?.file ?? null
}

/* ---- The stream ---- */

type Running = { infoHash: string, index: number, mediaId: number, episodeNumber: number, unlisten: () => void }

let running: Running | null = null
/** A torrent added only for its file list (the file chooser), not loaded */
let previewed: string | null = null

/** For tests: nothing runs, nothing was looked at */
export function forgetTorrentStream() {
    running?.unlisten()
    running = null
    previewed = null
}

/** The stream that runs, for the log and the checks: no address, no name */
export function runningTorrentStream(): { infoHash: string, index: number, mediaId: number, episodeNumber: number } | null {
    return running ? { infoHash: running.infoHash, index: running.index, mediaId: running.mediaId, episodeNumber: running.episodeNumber } : null
}

export const amount = (bytes: number) => {
    const units = ["B", "KB", "MB", "GB", "TB"]
    let value = Math.max(0, bytes)
    let unit = 0
    while (value >= 1000 && unit < units.length - 1) {
        value /= 1000
        unit++
    }
    return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`
}

/**
 * What goes out once per second while a stream runs (`torrentstream-state`). The app has no listener for it and no
 * message of this kind was recorded: `status` has the fields of the app's type Torrentstream_TorrentStatus, `state`
 * is the module's word for the torrent.
 */
export function streamStateOf(status: TorrentDeviceStatus, size: number): Json {
    return {
        state: status.state,
        status: {
            uploadProgress: 0,
            downloadProgress: status.bytesDone,
            progressPercentage: Math.round(status.progress * 1000) / 10,
            downloadSpeed: `${amount(status.downRate)}/s`,
            uploadSpeed: `${amount(status.upRate)}/s`,
            size: amount(size),
            seeders: status.seeds,
        },
    }
}

async function drop(device: TorrentDevice, infoHash: string) {
    try {
        await device.remove(infoHash, true)
    }
    catch {
        // gone already
    }
}

async function endRunning(device: TorrentDevice, except = "") {
    const old = running
    running = null
    old?.unlisten()
    if (old && old.infoHash !== except) await drop(device, old.infoHash)
}

/**
 * Why a magnet link got no file list, with the numbers the session saw. The list comes from peers only (a web seed has
 * the files, not the list), so the text says whether no peer was reached or the reached ones do not have it.
 */
export function noFileListText(status: TorrentDeviceStatus, waitedMs: number): string {
    const numbers = [`peers ${status.peers}${status.peersKnown === undefined ? "" : ` of ${status.peersKnown} known`}`]
    if (status.dhtNodes !== undefined) numbers.push(`DHT nodes ${status.dhtNodes}`)
    if (status.trackersOk !== undefined) numbers.push(`trackers ${status.trackersOk} answered, ${status.trackersFailed ?? 0} failed`)
    if (status.webSeeds !== undefined) numbers.push(`web seeds ${status.webSeeds}`)
    const why = status.peers > 0 ? "no connected peer has it" : "no peer was reached"
    return `the torrent's file list did not come within ${Math.round(waitedMs / 1000)} s: ${why} (${numbers.join(", ")}). Another torrent with more seeders may start.`
}

/** The file list of a torrent; a magnet link gets it from its peers first */
export async function filesOf(device: TorrentDevice, infoHash: string, environment: CoreEnvironment): Promise<TorrentDeviceFile[]> {
    const until = environment.now() + METADATA_PATIENCE_MS
    for (;;) {
        const status = await device.status(infoHash)
        if (status.error) throw new CoreError(`the torrent stopped: ${status.error}`)
        if (status.hasMetadata) return device.files(infoHash)
        if (environment.now() >= until) throw new CoreError(noFileListText(status, METADATA_PATIENCE_MS), 504)
        await device.wait(METADATA_STEP_MS)
    }
}

/** Where the core finds torrents and asks providers (the extensions, search.ts); missing: neither is possible */
export type TorrentFinder = () => Promise<StreamEnvironment>

/**
 * The torrent of a request and its magnet link: the one the app chose, else (`autoSelect`) the one the core picks; a
 * torrent without magnet link and info hash is asked of its provider
 */
export async function torrentOf(body: Json, environment: CoreEnvironment, finder?: TorrentFinder): Promise<{ torrent: Json, magnet: string }> {
    let torrent = isRecord(body.torrent) ? body.torrent : null
    if (!torrent) {
        if (body.autoSelect !== true || !finder) throw new CoreError("no torrent chosen", 400)
        const settings = await kept(environment, SETTINGS_KEY)
        const resolution = typeof settings?.preferredResolution === "string" ? settings.preferredResolution : ""
        torrent = (await autoSelectTorrent(await finder(), whole(body.mediaId), whole(body.episodeNumber), resolution)).torrent
    }
    let magnet = magnetOf(torrent)
    if (!magnet && finder && typeof torrent.provider === "string" && torrent.provider) magnet = await magnetFromProvider(await finder(), torrent)
    if (!magnet) throw new CoreError("the torrent has neither a magnet link nor an info hash, and its provider gave none", 400)
    return { torrent, magnet }
}

/** The address of a torrent's `.torrent` file (kept in autoselect.ts, where the rule reads it as well) */
export { torrentFileAddressOf }

/**
 * Adds a torrent to the session: by its `.torrent` file when its provider names one (no peer is needed for the file
 * list, and the web seeds the file names can serve a torrent nobody seeds – phase 6b-3), else, or when that file cannot
 * be had, by its magnet link → the info hash
 */
export async function addTorrent(device: TorrentDevice, torrent: Json, magnet: string, folder?: string): Promise<string> {
    const address = torrentFileAddressOf(torrent)
    if (address && device.addTorrentFileFrom) {
        try {
            return await (folder ? device.addTorrentFileFrom(address, folder) : device.addTorrentFileFrom(address))
        }
        catch {
            // no file there, or none the session reads: the magnet link is the other way
        }
    }
    return folder ? device.addMagnet(magnet, folder) : device.addMagnet(magnet)
}

/**
 * POST /api/v1/torrentstream/start: adds the torrent, picks the episode's file, pulls its start and its end, and hands
 * the outlet's address to the app's player ("watch") → true. `playbackType` "none"/"noneAndAwait" and `preload` only
 * prepare the stream. What the player shows while it waits ("open-and-await") are the core's own words.
 */
export async function startTorrentStream(request: CoreRequest, environment: CoreEnvironment, finder?: TorrentFinder): Promise<true> {
    const body = bodyOf(request)
    const mediaId = whole(body.mediaId)
    const episodeNumber = whole(body.episodeNumber)
    if (!mediaId) throw new CoreError("mediaId must be a number", 400)
    const playback = typeof body.playbackType === "string" ? body.playbackType : "nativeplayer"
    if (playback === "externalPlayerLink") throw new CoreError("a torrent stream of the core is played by the app's own player only", 400)
    const device = await deviceOf(environment)
    const shown = (playback === "nativeplayer" || playback === "default") && body.preload !== true
    const tell = (text: string) => {
        if (shown) emitCoreEvent("native-player", { type: "open-and-await", payload: text })
    }
    let added = ""
    try {
        if (!isRecord(body.torrent)) tell("Looking for a torrent…")
        const { torrent, magnet } = await torrentOf(body, environment, finder)
        await applySavedSettings(device, environment)
        tell("Adding the torrent…")
        const infoHash = await addTorrent(device, torrent, magnet)
        added = infoHash
        await endRunning(device, infoHash)
        if (previewed && previewed !== infoHash) await drop(device, previewed)
        previewed = null

        tell("Waiting for the torrent's file list…")
        const files = await filesOf(device, infoHash, environment)
        const seasons = (parse(typeof torrent.name === "string" ? torrent.name : "") as { season_number?: string[] }).season_number ?? []
        const wanted: FileWanted = { fileIndex: body.fileIndex, episodeNumber, season: seasons.length === 1 ? positive(seasons[0]) : 0 }
        let choice = fileChoiceOf(files, wanted)
        // the anime's episode count only when the names alone do not do (absolute numbering)
        if (!choice && files.filter(isVideo).length > 1) choice = fileChoiceOf(files, { ...wanted, episodeCount: await episodeCountOf(environment, mediaId) })
        if (!choice) throw new CoreError(`no file of the torrent fits episode ${episodeNumber}`, 404)
        const chosen = choice.file
        device.note?.(`file ${chosen.index} of ${files.length} chosen for episode ${episodeNumber}: ${choice.how}`)

        tell("Loading the start of the episode…")
        for (const file of files) {
            if (file.index !== chosen.index) await device.setFilePriority(infoHash, file.index, 0)
        }
        await device.setFilePriority(infoHash, chosen.index, 7)
        await device.setSequential(infoHash, true)
        await device.setPieceDeadlines(infoHash, chosen.pieceStart, FIRST_PIECES, 0, 250)
        await device.setPieceDeadlines(infoHash, Math.max(chosen.pieceStart, chosen.pieceEnd - (LAST_PIECES - 1)), LAST_PIECES, 1000, 250)
        const address = await device.serve(infoHash, chosen.index)

        const videos = files.filter(isVideo)
        if (videos.length > 1) {
            await keep(environment, batchKey(mediaId), {
                torrent,
                metadata: { ...parse(typeof torrent.name === "string" ? torrent.name : "") },
                batchEpisodeFiles: {
                    current: chosen.index,
                    currentEpisodeNumber: episodeNumber,
                    currentAniDBEpisode: typeof body.aniDBEpisode === "string" ? body.aniDBEpisode : "",
                    files: videos.map(file => ({ index: file.index, path: file.path, name: nameOf(file.path), episodeNumber: episodeOfName(file.path).episode })),
                },
            })
        }

        const unlisten = device.onStatus(statuses => {
            const mine = statuses.find(status => status.infoHash === infoHash)
            if (mine) emitCoreEvent("torrentstream-state", streamStateOf(mine, chosen.size))
        })
        running = { infoHash, index: chosen.index, mediaId, episodeNumber, unlisten }

        if (shown) {
            emitCoreEvent("native-player", {
                type: "watch",
                payload: {
                    id: `core-torrent-${environment.now()}`,
                    streamType: "torrent",
                    streamPath: chosen.path,
                    mimeType: mimeOf(chosen.path),
                    streamUrl: address,
                    contentLength: chosen.size,
                    ...(await playerExtrasOf(environment, mediaId, episodeNumber)),
                    isNakamaWatchParty: false,
                },
            })
        }
        return true
    }
    catch (error) {
        if (running?.infoHash === added) await endRunning(device)
        else if (added) await drop(device, added)
        if (shown) emitCoreEvent("native-player", { type: "abort-open", payload: error instanceof Error ? error.message : String(error) })
        throw error
    }
}

/** The type of a video file by its ending, for the player */
export const mimeOf = (path: string) => MIME[extensionOf(path)] ?? "video/*"

/** The anime's number of episodes as the core knows it (0: unknown) */
async function episodeCountOf(environment: CoreEnvironment, mediaId: number): Promise<number> {
    const built = await animeWithEpisodes(environment, mediaId).catch(() => null)
    return positive(built?.media.episodes)
}

/** Title and episode for the player's top line (a stream plays without them as well) */
export async function playerExtrasOf(environment: CoreEnvironment, mediaId: number, episodeNumber: number): Promise<Json> {
    const built = await animeWithEpisodes(environment, mediaId).catch(() => null)
    const entry = built ? await storedEntry(await environment.database(), "ANIME", mediaId).catch(() => null) : null
    const episode = built?.episodes.find(one => one.episodeNumber === episodeNumber && one.type === "main") ?? built?.episodes.find(one => one.episodeNumber === episodeNumber)
    return {
        ...(entry ? { entryListData: listDataOf(entry) } : {}),
        ...(episode ? { episode } : {}),
        ...(built ? { media: built.media } : {}),
    }
}

/** POST /api/v1/torrentstream/stop: the stream's torrent is removed with what it loaded, the session ends → true */
export async function stopTorrentStream(_request: CoreRequest, environment: CoreEnvironment): Promise<true> {
    const device = await deviceOf(environment)
    await endRunning(device)
    if (previewed) await drop(device, previewed)
    previewed = null
    // the torrent client's downloads (phase 6f) run in the same session: it ends only without them
    if (!(await hasClientTorrents(environment))) await device.stop()
    return true
}

/**
 * Whether a message of the app's player (videocore) closes the core's torrent stream: the player was closed
 * ("video-terminated") on a torrent stream with the area `torrent` on. Goes to the core whether or not the area
 * `playback` hears the player (playback.ts tellPlayer), since only the core knows its stream.
 */
export function closesTorrentStream(message: { type: string, payload?: unknown }): boolean {
    return message.type === "video-terminated" && isRecord(message.payload) && message.payload.playbackType === "torrent"
}

/** The player closed the torrent stream: like `stop`, the torrent is removed with what it loaded and the session ends */
export async function torrentHearsPlayer(message: { type: string, payload?: unknown }, environment: CoreEnvironment): Promise<string> {
    if (!closesTorrentStream(message) || (!running && !previewed)) return ""
    await stopTorrentStream({ path: {}, query: undefined, body: undefined } as CoreRequest, environment)
    return "torrent stream stopped, its torrent removed with its files"
}

/**
 * POST /api/v1/torrentstream/torrent-file-previews: the video files of a torrent for the file chooser, each with the
 * episode its name numbers. The torrent is added for its file list only: nothing of it is loaded until a stream starts.
 */
export async function torrentFilePreviews(request: CoreRequest, environment: CoreEnvironment, finder?: TorrentFinder): Promise<Json[]> {
    const body = bodyOf(request)
    const episodeNumber = whole(body.episodeNumber)
    const { torrent, magnet } = await torrentOf({ ...body, autoSelect: false }, environment, finder)
    const device = await deviceOf(environment)
    await applySavedSettings(device, environment)
    const infoHash = await addTorrent(device, torrent, magnet)
    const streamed = running?.infoHash === infoHash
    if (!streamed) {
        if (previewed && previewed !== infoHash) await drop(device, previewed)
        previewed = infoHash
    }
    const files = await filesOf(device, infoHash, environment)
    if (!streamed) {
        for (const file of files) await device.setFilePriority(infoHash, file.index, 0)
    }
    return files.filter(isVideo).map(file => {
        const name = nameOf(file.path)
        const { episode } = episodeOfName(file.path)
        return {
            path: file.path,
            displayPath: file.path.slice(0, Math.max(0, file.path.length - name.length - 1)),
            displayTitle: episode ? `Episode ${episode}` : name,
            episodeNumber: episode,
            relativeEpisodeNumber: episode,
            isLikely: episode !== 0 && episode === episodeNumber,
            index: file.index,
        }
    })
}
