// geschrieben nach: docs/EIGENER-KERN.md §4r (Phase 7d: Nakama aufgezeichnet – WS-Kopfzeilen, auth/auth_reply, ping/pong, Gastgeber-Endpunkte library/files/shared/stream), den App-Typen Nakama_NakamaStatus/Nakama_HostConnectionStatus/Nakama_MessageResponse/Anime_NakamaEntryLibraryData (src/api/generated/types.ts) und dem App-Code (nakama-manager.tsx, settings-more.tsx, handle-play-media.ts, episode-section.tsx, anime-entry-page.tsx); kein Server-Quelltext
import { listDataOf } from "../anilist/changes"
import { storedEntry } from "../anilist/store"
import { CoreError } from "../errors"
import { emitCoreEvent } from "../events"
import { animeWithEpisodes } from "../library/library"
import { type LocalFileRow, episodeOfFile, libraryDataOf } from "../library/local-files"
import type { CoreEnvironment, CoreRequest } from "../registry"
import { ownSettingsAndLook } from "../settings/settings"

/*
 * Nakama as a guest in the core (phase 7e, docs/EIGENER-KERN.md §4r): the app connects to a host on a PC (Seanime,
 * Seanime Denshi), shows the anime the host shares and plays the host's files straight from the host. The phone is
 * never a host (no one could reach it), and watch parties are not built yet.
 *
 * - Connection: a WebSocket to `<host>/api/v1/nakama/ws` with the four `X-Seanime-Nakama-*` headers, first message
 *   `auth`; `auth_reply` with success makes the guest "authenticated". Both sides ping, the other answers `pong`; the
 *   guest pings every 30 s. A lost connection is tried again after a pause (5 s, doubling, at most 60 s); a refused
 *   password is not tried again until the settings change or the user asks to reconnect.
 * - Settings: `nakama.enabled`, `remoteServerURL`, `includeNakamaAnimeLibrary` from the core's settings; the host's
 *   password lives in the device's secured storage, the settings keep "" in its place (the status shows it again).
 * - Every HTTP request to the host carries `X-Seanime-Nakama-Token`, the player's too (mpv `http-header-fields`).
 */

type Json = Record<string, unknown>
type Environment = Pick<CoreEnvironment, "fetch" | "secret" | "database" | "now" | "pause"> & Partial<Pick<CoreEnvironment, "keepSecret" | "nakamaSocket">>

/** The device's WebSocket as the core uses it (React Native's, with headers; the tests hand in their own) */
export type NakamaSocket = {
    send: (text: string) => void
    close: () => void
    onopen: (() => void) | null
    onmessage: ((event: { data: unknown }) => void) | null
    onclose: (() => void) | null
    onerror: ((event: unknown) => void) | null
}
export type NakamaSocketOpener = (url: string, headers: Record<string, string>) => NakamaSocket

/** The secured storage's name for the host's password */
export const NAKAMA_PASSWORD_SECRET = "seanime-nakama-host-password"
/** The version a guest names to the host: the server version the protocol was recorded with (§4r 7d) */
export const NAKAMA_PEER_VERSION = "3.10.4"
export const GUEST_PING_MS = 30_000
export const FIRST_PAUSE_MS = 5_000
export const LONGEST_PAUSE_MS = 60_000
const HOST_REQUEST_MS = 20_000

function isRecord(value: unknown): value is Json {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}
const text = (value: unknown) => (typeof value === "string" ? value : "")
const whole = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0)

/* ── Settings ─────────────────────────────────────────────────────────── */

type GuestSettings = { enabled: boolean, username: string, url: string, password: string, includeLibrary: boolean }

/** The host's address as typed ("127.0.0.1:43211", "http://pc:43211/") as `http(s)://host:port`, or "" */
export function hostBase(typed: string): string {
    const trimmed = typed.trim().replace(/\/+$/, "")
    if (!trimmed) return ""
    return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
}

async function guestSettings(environment: Environment): Promise<GuestSettings> {
    const settings = (await ownSettingsAndLook(await environment.database())).settings
    const nakama = isRecord(settings?.nakama) ? settings.nakama : {}
    const kept = await environment.secret(NAKAMA_PASSWORD_SECRET)
    return {
        enabled: nakama.enabled === true && nakama.isHost !== true,
        username: text(nakama.username).trim(),
        url: hostBase(text(nakama.remoteServerURL)),
        // a password the settings still hold (moved from the server) counts until one is kept in the secured storage
        password: kept ?? text(nakama.remoteServerPassword),
        includeLibrary: nakama.includeNakamaAnimeLibrary === true,
    }
}

/**
 * Before the settings are saved (PATCH /settings and /settings/path): the host's password goes into the secured
 * storage and the settings keep "". Without a secured storage the body stays as it is.
 */
export async function keepNakamaPassword(body: unknown, environment: Environment): Promise<unknown> {
    if (!environment.keepSecret || !isRecord(body)) return body
    if (body.path === "nakama.remoteServerPassword" && typeof body.value === "string") {
        await environment.keepSecret(NAKAMA_PASSWORD_SECRET, body.value || null)
        return { ...body, value: "" }
    }
    if (isRecord(body.nakama) && typeof body.nakama.remoteServerPassword === "string") {
        await environment.keepSecret(NAKAMA_PASSWORD_SECRET, body.nakama.remoteServerPassword || null)
        return { ...body, nakama: { ...body.nakama, remoteServerPassword: "" } }
    }
    return body
}

/** The status as the screens read it: the password field shows the kept password again */
export async function withNakamaPassword(status: unknown, environment: Environment): Promise<unknown> {
    if (!isRecord(status) || !isRecord(status.settings) || !isRecord(status.settings.nakama)) return status
    const kept = await environment.secret(NAKAMA_PASSWORD_SECRET)
    if (kept === null) return status
    return { ...status, settings: { ...status.settings, nakama: { ...status.settings.nakama, remoteServerPassword: kept } } }
}

/** Whether a saved setting concerns the guest's connection */
export function touchesNakama(body: unknown): boolean {
    return isRecord(body) && (isRecord(body.nakama) || (typeof body.path === "string" && body.path.startsWith("nakama.")))
}

/* ── Connection ───────────────────────────────────────────────────────── */

type Guest = {
    settings: GuestSettings
    socket: NakamaSocket | null
    connected: boolean
    authenticated: boolean
    hostName: string
    lastPing?: string
    failures: number
    /** refused or stopped: no new try until the settings change or a reconnect */
    refused: boolean
    retry: ReturnType<typeof setTimeout> | null
    pinger: ReturnType<typeof setInterval> | null
    /** counts the sockets; a socket's events after a newer one opened are ignored */
    generation: number
}

let guest: Guest | null = null
let peerId = ""
let started = false

function ownPeerId(): string {
    if (!peerId) {
        const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16))
        hex[12] = "4"
        hex[16] = "89ab"[Math.floor(Math.random() * 4)]
        const all = hex.join("")
        peerId = `${all.slice(0, 8)}-${all.slice(8, 12)}-${all.slice(12, 16)}-${all.slice(16, 20)}-${all.slice(20)}`
    }
    return peerId
}

function message(type: string, payload: unknown, environment: Environment): string {
    return JSON.stringify({ type, payload, timestamp: new Date(environment.now()).toISOString() })
}

function emitStatus(): void {
    emitCoreEvent("nakama-status", nakamaStatus())
}

function stopTimers(state: Guest): void {
    if (state.retry) clearTimeout(state.retry)
    if (state.pinger) clearInterval(state.pinger)
    state.retry = null
    state.pinger = null
}

function closeSocket(state: Guest): void {
    const socket = state.socket
    state.socket = null
    state.generation++
    if (!socket) return
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null
    try {
        socket.close()
    }
    catch {
        // already closed
    }
}

/** Ends the guest's connection (Nakama off, no host set, a new host): quiet, no new try */
function stopGuest(): void {
    if (!guest) return
    const wasConnected = guest.authenticated
    stopTimers(guest)
    closeSocket(guest)
    guest = null
    if (wasConnected) emitCoreEvent("nakama-host-disconnected", {})
    emitStatus()
}

function lost(state: Guest, generation: number, environment: Environment): void {
    if (guest !== state || state.generation !== generation) return
    const wasConnected = state.authenticated
    stopTimers(state)
    // React Native's socket reports a failure as onerror and then onclose: the socket is retired here (a new generation),
    // so the second call is ignored instead of planning a second try with a doubled pause
    closeSocket(state)
    state.connected = false
    state.authenticated = false
    if (wasConnected) emitCoreEvent("nakama-host-disconnected", {})
    if (!state.refused) {
        const pause = Math.min(FIRST_PAUSE_MS * 2 ** state.failures, LONGEST_PAUSE_MS)
        state.failures++
        state.retry = setTimeout(() => {
            state.retry = null
            if (guest === state) open(state, environment)
        }, pause)
    }
    emitStatus()
}

function heard(state: Guest, generation: number, data: unknown, environment: Environment): void {
    if (guest !== state || state.generation !== generation) return
    let parsed: unknown
    try {
        parsed = JSON.parse(typeof data === "string" ? data : "")
    }
    catch {
        return
    }
    if (!isRecord(parsed)) return
    const payload = isRecord(parsed.payload) ? parsed.payload : {}
    switch (parsed.type) {
        case "auth_reply":
            if (payload.success === true) {
                state.authenticated = true
                state.failures = 0
                state.hostName = text(payload.username)
                state.lastPing = new Date(environment.now()).toISOString()
                state.pinger = setInterval(() => state.socket?.send(message("ping", null, environment)), GUEST_PING_MS)
                emitCoreEvent("nakama-host-connected", { username: state.hostName })
                emitStatus()
            }
            else {
                // a wrong password: tried again only when asked (reconnect) or after the settings change
                state.refused = true
                emitCoreEvent("nakama-error", { message: text(payload.message) || "The host refused the connection" })
                stopTimers(state)
                closeSocket(state)
                state.connected = false
                emitStatus()
            }
            return
        case "ping":
            state.lastPing = new Date(environment.now()).toISOString()
            state.socket?.send(message("pong", null, environment))
            return
        case "pong":
            state.lastPing = new Date(environment.now()).toISOString()
            return
        default:
            // watch parties and the host's other messages: not built yet (phase 7e)
            return
    }
}

function open(state: Guest, environment: Environment): void {
    const opener = environment.nakamaSocket
    if (!opener) {
        state.refused = true
        emitCoreEvent("nakama-error", { message: "Nakama is not available on this device" })
        return
    }
    closeSocket(state)
    const generation = state.generation
    const { url, password, username } = state.settings
    let socket: NakamaSocket
    try {
        socket = opener(`${url.replace(/^http/i, "ws")}/api/v1/nakama/ws`, {
            "X-Seanime-Nakama-Token": password,
            "X-Seanime-Nakama-Username": username || `Peer ${ownPeerId().slice(0, 4)}`,
            "X-Seanime-Nakama-Peer-Id": ownPeerId(),
            "X-Seanime-Nakama-Server-Version": NAKAMA_PEER_VERSION,
        })
    }
    catch {
        lost(state, generation, environment)
        return
    }
    state.socket = socket
    socket.onopen = () => {
        if (guest !== state || state.generation !== generation) return
        state.connected = true
        socket.send(message("auth", { password, peerId: ownPeerId() }, environment))
        emitStatus()
    }
    socket.onmessage = event => heard(state, generation, event.data, environment)
    socket.onclose = () => lost(state, generation, environment)
    socket.onerror = () => lost(state, generation, environment)
}

function sameHost(a: GuestSettings, b: GuestSettings): boolean {
    return a.url === b.url && a.password === b.password && a.username === b.username
}

/** Why the guest cannot connect with these settings, or "" (the reconnect's error; core-error-text.ts translates it) */
function missingSetting(settings: GuestSettings): string {
    if (!settings.enabled) return "Nakama is turned off"
    if (!settings.url) return "No Nakama host is set up"
    if (!settings.password) return "The Nakama passcode is missing"
    return ""
}

/**
 * Connects as the settings say: a new host or password starts anew, Nakama off, no host or no passcode ends the
 * connection. Answers what is missing, or "" when it connects.
 */
async function follow(environment: Environment, again: boolean): Promise<string> {
    const settings = await guestSettings(environment)
    const missing = missingSetting(settings)
    if (missing) {
        stopGuest()
        return missing
    }
    if (guest && sameHost(guest.settings, settings) && !again) {
        guest.settings = settings
        return ""
    }
    if (guest) {
        stopTimers(guest)
        closeSocket(guest)
        if (guest.authenticated) emitCoreEvent("nakama-host-disconnected", {})
    }
    guest = { settings, socket: null, connected: false, authenticated: false, hostName: "", failures: 0, refused: false, retry: null, pinger: null, generation: 0 }
    open(guest, environment)
    emitStatus()
    return ""
}

/** Once per run, with the first answer of the core: connects when Nakama is set up */
export function nakamaAtStart(environment: Environment): void {
    if (started) return
    started = true
    void follow(environment, false).catch(() => {})
}

/** After a saved setting of Nakama: the guest follows (recorded: a new connection at once, §4r 7d) */
export async function nakamaSettingsChanged(environment: Environment): Promise<void> {
    await follow(environment, false)
}

/** POST /api/v1/nakama/reconnect */
export async function reconnectToHost(_request: unknown, environment: Environment): Promise<Json> {
    const missing = await follow(environment, true)
    if (missing) throw new CoreError(missing, 400)
    return { success: true, message: "Reconnecting to host" }
}

/** POST /api/v1/nakama/cleanup: only a host has peers to clean up; the guest has none */
export async function removeStaleConnections(): Promise<Json> {
    return { success: true, message: "Stale connections cleaned up" }
}

/** The status as the Nakama manager reads it (`Nakama_NakamaStatus`) */
export function nakamaStatus(): Json {
    const state = guest
    return {
        isHost: false,
        connectedPeers: [],
        isConnectedToHost: !!state?.authenticated,
        ...(state ? {
            hostConnectionStatus: {
                connected: state.connected,
                authenticated: state.authenticated,
                url: state.settings.url,
                ...(state.lastPing ? { lastPing: state.lastPing } : {}),
                peerId: ownPeerId(),
                username: state.hostName,
                connectionMode: "direct",
            },
        } : {}),
        connectionMode: "direct",
    }
}

/** `nakama-status-requested` of the screens: the status follows as event `nakama-status` */
export function askNakamaStatus(): void {
    emitStatus()
}

/** For the tests: forgets the connection and the run */
export function forgetNakamaGuest(): void {
    if (guest) {
        stopTimers(guest)
        closeSocket(guest)
    }
    guest = null
    started = false
}

/* ── The host's library ───────────────────────────────────────────────── */

/** The connection when the host's library is to be used, else null */
function libraryGuest(): Guest | null {
    return guest?.authenticated && guest.settings.includeLibrary ? guest : null
}

async function hostGet(environment: Environment, state: Guest, path: string): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), HOST_REQUEST_MS)
    try {
        const response = await environment.fetch(`${state.settings.url}${path}`, {
            method: "GET",
            headers: { "X-Seanime-Nakama-Token": state.settings.password },
            signal: controller.signal,
        })
        const body = await response.text()
        if (response.status !== 200) throw new CoreError(`The Nakama host answered ${response.status}`, 502)
        const parsed: unknown = JSON.parse(body)
        return isRecord(parsed) ? parsed.data : undefined
    }
    finally {
        clearTimeout(timer)
    }
}

/** A file of the host (`Anime_LocalFile`) as the core's own rows are, so the library's rules apply to it */
export function hostFileRow(file: unknown): LocalFileRow | null {
    if (!isRecord(file) || typeof file.path !== "string" || !file.path) return null
    const metadata = isRecord(file.metadata) ? file.metadata : {}
    return {
        path: file.path,
        name: text(file.name),
        mediaId: whole(file.mediaId),
        episode: typeof metadata.episode === "number" ? metadata.episode : 0,
        anidbEpisode: text(metadata.aniDBEpisode),
        type: text(metadata.type) || "main",
        locked: file.locked === true,
        ignored: file.ignored === true,
        size: 0,
        parsed: isRecord(file.parsedInfo) ? file.parsedInfo : {},
        folders: Array.isArray(file.parsedFolderInfo) ? file.parsedFolderInfo.filter(isRecord) : [],
        changedAt: 0,
    }
}

function hostRows(data: unknown): LocalFileRow[] {
    const files = isRecord(data) && Array.isArray(data.localFiles) ? data.localFiles : []
    const order = (row: LocalFileRow) => (row.type === "main" ? 0 : row.type === "special" ? 1 : 2)
    return files.map(hostFileRow).filter((row): row is LocalFileRow => !!row && row.mediaId > 0 && !row.ignored)
        .sort((a, b) => order(a) - order(b) || a.episode - b.episode || a.path.localeCompare(b.path))
}

function nakamaData(rows: LocalFileRow[], progress: number): Json {
    const main = rows.filter(row => row.type === "main")
    return { unwatchedCount: main.filter(row => row.episode > progress).length, mainFileCount: main.length }
}

/**
 * GET /api/v1/library/collection with the host's library (`includeNakamaAnimeLibrary`): the host's anime that have
 * files there and none here join the lists as Nakama entries (`nakamaLibraryData`, no `libraryData`), under the
 * user's own list status, else the host's. A host that does not answer leaves the own library as it is.
 */
export async function withHostLibrary(collection: unknown, environment: Environment): Promise<unknown> {
    const state = libraryGuest()
    if (!state || !isRecord(collection) || !Array.isArray(collection.lists)) return collection
    let data: unknown
    try {
        data = await hostGet(environment, state, "/api/v1/nakama/host/anime/library")
    }
    catch {
        return collection
    }
    const byMedia = new Map<number, LocalFileRow[]>()
    for (const row of hostRows(data)) byMedia.set(row.mediaId, [...(byMedia.get(row.mediaId) ?? []), row])
    const lists = (collection.lists as unknown[]).filter(isRecord).map((list): Json & { entries: unknown[] } => ({ ...list, entries: Array.isArray(list.entries) ? [...list.entries] : [] }))
    const own = new Set(lists.flatMap(list => list.entries.filter(isRecord).map(entry => entry.mediaId)))
    const collected = isRecord(data) && isRecord(data.animeCollection) && isRecord(data.animeCollection.MediaListCollection)
        ? data.animeCollection.MediaListCollection.lists : undefined
    const database = await environment.database()
    for (const list of Array.isArray(collected) ? collected.filter(isRecord) : []) {
        for (const item of Array.isArray(list.entries) ? list.entries.filter(isRecord) : []) {
            const media = isRecord(item.media) ? item.media : null
            const id = whole(media?.id)
            const rows = byMedia.get(id)
            if (!media || !rows?.length || own.has(id)) continue
            own.add(id)
            await environment.pause("nakama library")
            const entry = await storedEntry(database, "ANIME", id)
            const listData = entry ? listDataOf(entry) : undefined
            const status = text(listData?.status) || text(item.status) || text(list.status)
            const place = status === "REPEATING" ? "CURRENT" : status
            let target = lists.find(candidate => candidate.status === place)
            if (!target) {
                const added: Json & { entries: unknown[] } = { type: place, status: place, entries: [] }
                lists.push(added)
                target = added
            }
            target.entries.push({ media, mediaId: id, nakamaLibraryData: nakamaData(rows, whole(listData?.progress)), ...(listData ? { listData } : {}) })
        }
    }
    return { ...collection, lists }
}

/**
 * GET /api/v1/library/anime-entry/{id}: an anime without own files that the host has becomes the host's (
 * `_isNakamaEntry`, its files as episodes with `_isNakamaEpisode`, "Shared by <host>" on the page).
 */
export async function withHostFiles(entry: unknown, environment: Environment): Promise<unknown> {
    const state = libraryGuest()
    if (!state || !isRecord(entry) || entry.libraryData || !whole(entry.mediaId)) return entry
    const id = whole(entry.mediaId)
    let rows: LocalFileRow[]
    try {
        rows = hostRows(await hostGet(environment, state, `/api/v1/nakama/host/anime/library/files/${id}`)).filter(row => row.mediaId === id)
    }
    catch {
        return entry
    }
    if (rows.length === 0) return entry
    const { media, episodes } = await animeWithEpisodes(environment, id)
    const progress = whole(isRecord(entry.listData) ? entry.listData.progress : 0)
    const rewatch = isRecord(entry.listData) && (entry.listData.status === "COMPLETED" || entry.listData.status === "REPEATING")
    const hostEpisodes = rows.map((row): Json => ({ ...episodeOfFile(row, media, episodes), _isNakamaEpisode: true }))
    return {
        ...entry,
        libraryData: libraryDataOf(rows, progress),
        nakamaLibraryData: nakamaData(rows, progress),
        episodes: hostEpisodes,
        nextEpisode: hostEpisodes.find(episode => episode.type === "main" && (rewatch || (episode.episodeNumber as number) > progress)) ?? null,
        localFiles: hostEpisodes.map(episode => episode.localFile),
        _isNakamaEntry: true,
    }
}

/** GET /api/v1/nakama/host/anime/library/shared of the host: whether it shares its library */
export async function hostShares(_request: unknown, environment: Environment): Promise<boolean> {
    const state = guest?.authenticated ? guest : null
    if (!state) return false
    return (await hostGet(environment, state, "/api/v1/nakama/host/anime/library/shared")) === true
}

/* ── Playing a file of the host ───────────────────────────────────────── */

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

/** Standard Base64 of the text's UTF-8 bytes (the host reads the path so) */
export function base64OfText(value: string): string {
    const bytes = new TextEncoder().encode(value)
    let out = ""
    for (let at = 0; at < bytes.length; at += 3) {
        const [a, b = 0, c = 0] = [bytes[at], bytes[at + 1], bytes[at + 2]]
        const n = (a << 16) | (b << 8) | c
        out += BASE64[(n >> 18) & 63] + BASE64[(n >> 12) & 63]
        out += at + 1 < bytes.length ? BASE64[(n >> 6) & 63] : "="
        out += at + 2 < bytes.length ? BASE64[n & 63] : "="
    }
    return out
}

/** The address of a host's file for the player (with the token header, never a token in the address) */
export function hostStreamAddress(url: string, path: string): string {
    return `${url}/api/v1/nakama/host/anime/library/stream?path=${encodeURIComponent(base64OfText(path))}`
}

const MIME: Record<string, string> = { mkv: "video/x-matroska", mp4: "video/mp4", webm: "video/webm", avi: "video/x-msvideo", mov: "video/quicktime", m4v: "video/mp4", ts: "video/mp2t" }

/**
 * POST /api/v1/nakama/play {path, mediaId, anidbEpisode, clientId}: the player opens the host's file straight from the
 * host, with the token as a header (`requestHeaders`, mpv `http-header-fields`); the progress goes as for any episode.
 */
export async function playHostFile(request: CoreRequest, environment: Environment): Promise<boolean> {
    const body = isRecord(request.body) ? request.body : {}
    const path = text(body.path)
    const mediaId = whole(body.mediaId)
    if (!path || !mediaId) throw new CoreError("path and mediaId are needed", 400)
    const state = guest?.authenticated ? guest : null
    if (!state) throw new CoreError("Not connected to a Nakama host", 400)
    const rows = hostRows(await hostGet(environment, state, `/api/v1/nakama/host/anime/library/files/${mediaId}`))
    const row = rows.find(candidate => candidate.path === path)
    if (!row) throw new CoreError("The file is not in the host's library", 404)
    const { media, episodes } = await animeWithEpisodes(environment, mediaId)
    const entry = await storedEntry(await environment.database(), "ANIME", mediaId)
    const extension = row.name.slice(row.name.lastIndexOf(".") + 1).toLowerCase()
    emitCoreEvent("native-player", {
        type: "watch",
        payload: {
            id: `core-nakama-${environment.now()}`,
            streamType: "nakama",
            streamPath: row.path,
            mimeType: MIME[extension] ?? "video/*",
            streamUrl: hostStreamAddress(state.settings.url, row.path),
            requestHeaders: { "X-Seanime-Nakama-Token": state.settings.password },
            contentLength: 0,
            ...(entry ? { entryListData: listDataOf(entry) } : {}),
            episode: { ...episodeOfFile(row, media, episodes), _isNakamaEpisode: true },
            media,
            isNakamaWatchParty: false,
        },
    })
    return true
}
