// geschrieben nach: App-Code src/lib/cast/cast-controller.ts und src/api/hooks/dlna_cast.helpers.ts (Schnittstellen, Ereignis `dlna-cast` und seine Form), Aufzeichnung DLNA_CAST.* vom 13.11.2026 (Anfrage-Formen, `current` → null) und öffentlicher UPnP-Spezifikation (AVTransport:1, RenderingControl:1); Phase 7b (Freigabe über den Ausgang ins WLAN): Plan docs/EIGENER-KERN.md §4r; keine Vorlage

import type { HttpFetch } from "../anilist/client"
import { CoreError, errorText } from "../errors"
import { emitCoreEvent } from "../events"
import {
    type DeviceDescription, MEDIA_RENDERER, type ServiceAddress, didlLite, readDeviceDescription,
    readSearchReply, readSoapAnswer, searchMessage, soapRequest, upnpTime, upnpTimeMs,
} from "./upnp"

/*
 * Casting to a TV over DLNA (UPnP MediaRenderer) without the server (phase 7c-1, docs/EIGENER-KERN.md §4r): the search,
 * a session on one TV and its control. The app's cast panel hears the same "dlna-cast" events the server sent. Playing
 * needs an address the TV can reach: a source of the network that needs no headers is handed on as it is; a file of the
 * device and a torrent stream of the core are shared through the outlet into the Wi-Fi (phase 7b), only while the TV
 * plays them: every share ends with the session (stop, another video, the TV gone, forward-close).
 */

/** The device's side: one search into the home network (the native module, multicast held while it runs) */
export type CastSearcher = {
    /** Sends `message` to the SSDP group and returns every answer that came within `waitMs`, as text */
    search: (message: string, waitMs: number) => Promise<string[]>
}

/** The device's side of the outlet into the local network (phase 7b): every answer is `http://<address>:<port>/<token>/<name>` */
export type CastOutlet = {
    /** A file of the device (path or `file://`), for a receiver at `toward` (its IPv4 address; "" for the Wi-Fi's) */
    shareFile: (path: string, toward: string) => Promise<string>
    /** One file of a torrent of the core's session */
    shareTorrent: (infoHash: string, index: number, toward: string) => Promise<string>
    /** Every share ends and the port closes */
    unshare: () => Promise<void>
}

export type CastEnvironment = {
    fetch: HttpFetch
    /** left out: not available here */
    cast?: () => Promise<CastSearcher>
    /** left out: no outlet into the network here, only sources of the network can be cast */
    castOutlet?: () => Promise<CastOutlet>
    /** Runs work no request waits for (the search's answer, the status while playing); left out: it just runs */
    unasked?: (what: string, work: () => Promise<unknown>) => Promise<unknown>
}

type Kind = "webos" | "dlna"
type ErrorCode = "gone" | "no-wifi" | "tv-off" | "no-answer" | "rejected" | "control-failed" | "seek-failed" | "track-failed" | "not-connected" | "invalid-stream"

/** How long the search listens, as the server did (the app closes its list after three times this) */
export const SEARCH_MS = 3000
/** LG answers Play only once the video is open (cast-controller.ts) */
const PLAY_WAIT_MS = 50_000
/** How long the jump to the phone's position may wait for the TV to show the video */
const SEEK_WAIT_MS = 30_000
/** How long after a Seek the core looks where the TV is */
const SEEK_CHECK_MS = 2000
/** Where the TV may be before the target after the jump (it counts whole seconds, some TVs land on a key frame before) */
const SEEK_SLACK_MS = 5000
const REQUEST_MS = 5000
const STATUS_EVERY_MS = 1000
/** Status answers missed in a row before the TV counts as off */
const MISSES_TO_OFF = 5

export const HEADERS_UNSUPPORTED = "a stream that needs request headers cannot be cast by the core"
export const DEVICE_STREAM = "this stream of the device cannot be cast by the core (only its files and torrent streams)"
export const NO_OUTLET = "the outlet into the network is not available here"

/** shown: the TV reported the video playing or paused once, so a later STOPPED is a stop from outside (its remote, another app) */
type Session = { device: DeviceDescription, kind: Kind, url: string, title: string, artworkUrl: string, positionMs: number, misses: number, shown: boolean, timer: ReturnType<typeof setTimeout> | null }

const known = new Map<string, DeviceDescription>()
let session: Session | null = null
/** Whether something may be shared into the network right now (so a stop does not ask the device for nothing) */
let sharing = false
/** A track switch reopens the video on the TV in use: its Stop is no stop from outside */
let switching = false

function emit(payload: Record<string, unknown>) {
    emitCoreEvent("dlna-cast", payload)
}

/** positionMs: where the TV was asked to jump (seek-failed), for the panel's text */
function fail(code: ErrorCode, message: string, positionMs?: number) {
    emit(positionMs === undefined ? { state: "error", code, message } : { state: "error", code, message, positionMs })
}

/** LG's webOS TVs: no volume over DLNA worth showing (the app hides the buttons), and hidden as a Google Cast device */
export function kindOf(device: DeviceDescription): Kind {
    return /\bLG\b/i.test(device.manufacturer) || /webos/i.test(device.model) ? "webos" : "dlna"
}

function body(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
}

function text(value: unknown, name: string): string {
    const field = body(value)[name]
    if (field === undefined || field === null) return ""
    if (typeof field !== "string") throw new CoreError(`${name} must be a text`, 400)
    return field
}

function number(value: unknown, name: string): number {
    const field = Number(body(value)[name] ?? 0)
    return Number.isFinite(field) ? field : 0
}

async function withTimeout<T>(ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ms)
    try {
        return await work(controller.signal)
    }
    finally {
        clearTimeout(timer)
    }
}

/** One control action; its out values, or a thrown error with the UPnP error code in the text */
export async function soap(environment: CastEnvironment, service: ServiceAddress, action: string, args: [string, string | number][]): Promise<Record<string, string>> {
    const request = soapRequest(service.serviceType, action, args)
    const answer = await withTimeout(REQUEST_MS, async signal => {
        const response = await environment.fetch(service.controlUrl, { method: "POST", headers: request.headers, body: request.body, signal })
        return { status: response.status, text: await response.text() }
    })
    const read = readSoapAnswer(answer.text, action)
    if (!read.ok) throw new Error(`${action} failed: UPnP error ${read.code} ${read.description} (HTTP ${answer.status})`.trim())
    if (answer.status >= 300) throw new Error(`${action} failed: HTTP ${answer.status}`)
    return read.values
}

/** The search and every renderer's description, by its UDN; descriptions that cannot be read are left out */
export async function searchRenderers(environment: CastEnvironment, waitMs: number = SEARCH_MS): Promise<DeviceDescription[]> {
    if (!environment.cast) throw new CoreError("DLNA is not available here", 503)
    const searcher = await environment.cast()
    const replies = (await searcher.search(searchMessage(MEDIA_RENDERER), waitMs)).map(readSearchReply)
    const locations = [...new Set(replies.flatMap(reply => (reply ? [reply.location] : [])))]
    const devices = await Promise.all(locations.map(async location => {
        try {
            const xml = await withTimeout(REQUEST_MS, async signal => (await environment.fetch(location, { method: "GET", signal })).text())
            return readDeviceDescription(xml, location)
        }
        catch {
            return null
        }
    }))
    const found = new Map<string, DeviceDescription>()
    for (const device of devices) if (device?.avTransport && !found.has(device.id)) found.set(device.id, device)
    return [...found.values()]
}

function listed(device: DeviceDescription) {
    return { id: device.id, name: device.name || device.model || "TV", kind: kindOf(device) }
}

function unasked(environment: CastEnvironment, what: string, work: () => Promise<unknown>) {
    const run = environment.unasked ? environment.unasked(what, work) : work()
    void run.catch(() => undefined)
}

/** POST /dlna-cast/discover: answers at once; the devices follow as an event (`devices`), as from the server */
export async function discover(environment: CastEnvironment): Promise<boolean> {
    if (!environment.cast) throw new CoreError("DLNA is not available here", 503)
    unasked(environment, "cast discover", async () => {
        let devices: DeviceDescription[] = []
        try {
            devices = await searchRenderers(environment)
        }
        catch {
            // no Wi-Fi, no multicast: an empty list, the panel says nothing was found
        }
        known.clear()
        for (const device of devices) known.set(device.id, device)
        emit({ state: "devices", devices: devices.map(listed) })
    })
    return true
}

/** What sharing needs of the environment (Google Cast asks no TV over HTTP) */
type Sharing = Pick<CastEnvironment, "castOutlet">

/** Where the TV gets the video from: a source of the network as it is, or something of the device to share */
export type CastSource = { kind: "network", url: string } | { kind: "file", path: string } | { kind: "torrent", infoHash: string, index: number }

/** The torrent area's outlet for the app's player (phase 6b-2): `http://127.0.0.1:<port>/<token>/<info hash>/<index>/<name>` */
const TORRENT_OUTLET = /^http:\/\/127\.0\.0\.1:\d{1,5}\/[0-9a-f]{32}\/([0-9a-f]{40})\/(\d+)\/[^/?#]+$/

/** Reads what the app asks to cast; `headers` (as a request may name them) cannot be given to a TV */
export function castSource(url: string, headers?: unknown): CastSource {
    if (typeof headers === "object" && headers !== null && Object.keys(headers).length > 0) throw new CoreError(HEADERS_UNSUPPORTED, 501)
    if (/^file:\/\/\//i.test(url) || url.startsWith("/")) return { kind: "file", path: url }
    const found = /^https?:\/\/(\[[^\]]+\]|[^/:?#]+)/i.exec(url)
    if (!found) throw new CoreError("invalid-stream", 400)
    const host = (found[1] ?? "").toLowerCase()
    // the device's own loopback: the TV would ask itself. The torrent stream is shared; the server's streams are not
    if (host === "localhost" || /^127\./.test(host) || host === "[::1]" || host === "0.0.0.0") {
        const torrent = TORRENT_OUTLET.exec(url)
        if (torrent) return { kind: "torrent", infoHash: torrent[1]!, index: Number(torrent[2]) }
        throw new CoreError(DEVICE_STREAM, 503)
    }
    return { kind: "network", url }
}

/** The host of an address (the TV's, from its control address), for the device's address toward it */
function hostOf(url: string): string {
    return /^https?:\/\/([^/:?#\]]+)/i.exec(url)?.[1] ?? ""
}

/** The address the TV is given; something of the device is shared into the network from now on */
async function addressFor(environment: Sharing, source: CastSource, toward: string): Promise<string> {
    if (source.kind === "network") return source.url
    if (!environment.castOutlet) throw new CoreError(NO_OUTLET, 503)
    const outlet = await environment.castOutlet()
    sharing = true
    return source.kind === "file" ? outlet.shareFile(source.path, toward) : outlet.shareTorrent(source.infoHash, source.index, toward)
}

/** Every share into the network ends (the outlet's port closes) */
async function unshare(environment: Sharing) {
    if (!sharing || !environment.castOutlet) return
    sharing = false
    await environment.castOutlet().then(outlet => outlet.unshare()).catch(() => undefined)
}

function sourceOf(value: unknown): CastSource {
    return castSource(text(value, "url"), body(value).headers)
}

function stopStatus() {
    if (session?.timer) clearTimeout(session.timer)
    if (session) session.timer = null
}

/** Reads where the TV is; null when it did not answer */
async function readStatus(environment: CastEnvironment, current: Session) {
    const transport = current.device.avTransport!
    const [info, position] = await Promise.all([
        soap(environment, transport, "GetTransportInfo", [["InstanceID", 0]]),
        soap(environment, transport, "GetPositionInfo", [["InstanceID", 0]]),
    ])
    let volume = -1
    if (current.kind !== "webos" && current.device.renderingControl) {
        volume = await soap(environment, current.device.renderingControl, "GetVolume", [["InstanceID", 0], ["Channel", "Master"]])
            .then(values => Number(values.CurrentVolume ?? -1), () => -1)
    }
    const state = info.CurrentTransportState ?? ""
    const positionMs = upnpTimeMs(position.RelTime)
    const durationMs = upnpTimeMs(position.TrackDuration)
    return {
        transport: state,
        playing: state === "PLAYING" || state === "TRANSITIONING",
        positionMs,
        durationMs,
        volume: Number.isFinite(volume) ? Math.max(-1, Math.min(100, volume)) : -1,
        // played to its end: stopped near the end, or no media left
        ended: (state === "STOPPED" || state === "NO_MEDIA_PRESENT") && durationMs > 0 && positionMs >= durationMs - 3000,
    }
}

async function sendStatus(environment: CastEnvironment): Promise<boolean> {
    const current = session
    if (!current) {
        emit({ state: "idle" })
        return false
    }
    try {
        const { transport, ...status } = await readStatus(environment, current)
        if (session !== current) return false
        current.misses = 0
        // stopped from outside before the end (the TV's remote, a Stop of another control point): the session ends as with
        // "Stop casting", the share closes and the phone stays paused where the TV was
        const idle = transport === "STOPPED" || transport === "NO_MEDIA_PRESENT"
        if (idle && current.shown && !status.ended && !switching) {
            stopStatus()
            session = null
            await unshare(environment)
            emit({ state: "stopped", positionMs: status.positionMs > 0 ? status.positionMs : current.positionMs, resume: false })
            return false
        }
        if (!idle) current.shown = true
        current.positionMs = status.positionMs
        emit({ state: "status", device: listed(current.device).name, kind: current.kind, ...status })
        return true
    }
    catch {
        if (session !== current) return false
        current.misses++
        if (current.misses >= MISSES_TO_OFF) {
            stopStatus()
            session = null
            await unshare(environment)
            fail("tv-off", "the TV stopped answering")
            emit({ state: "stopped", positionMs: current.positionMs, resume: true })
        }
        return false
    }
}

/** While a session runs, the panel hears its status every second, as from the server */
function watchStatus(environment: CastEnvironment, current: Session) {
    stopStatus()
    const next = () => {
        current.timer = setTimeout(() => unasked(environment, "cast status", async () => {
            if (session !== current) return
            await sendStatus(environment)
            if (session === current) next()
        }), STATUS_EVERY_MS)
    }
    next()
}

/** The video plays on the TV; the answer is why it did not jump to `positionMs` (null when it did, or needed not) */
async function open(environment: CastEnvironment, device: DeviceDescription, url: string, title: string, positionMs: number, artworkUrl: string): Promise<string | null> {
    const transport = device.avTransport!
    // a TV that still plays something else takes a new address only after Stop on some models
    await soap(environment, transport, "Stop", [["InstanceID", 0]]).catch(() => undefined)
    await soap(environment, transport, "SetAVTransportURI", [["InstanceID", 0], ["CurrentURI", url], ["CurrentURIMetaData", didlLite(url, title, artworkUrl)]])
    const until = Date.now() + PLAY_WAIT_MS
    for (;;) {
        try {
            await soap(environment, transport, "Play", [["InstanceID", 0], ["Speed", "1"]])
            break
        }
        catch (error) {
            if (Date.now() >= until) throw error
            await new Promise(resolve => setTimeout(resolve, 1000))
        }
    }
    return positionMs > 1000 ? seekOnceShown(environment, transport, positionMs) : null
}

/**
 * The jump to where the phone was, once the TV shows the video: LG answers Play while it still opens it (TRANSITIONING) and
 * refuses or forgets a Seek until then, so the core asks for PLAYING first and checks where the TV is afterwards.
 * Null when the TV got there, else why not (the video plays on from its start).
 */
async function seekOnceShown(environment: CastEnvironment, transport: ServiceAddress, positionMs: number): Promise<string | null> {
    const target = upnpTime(positionMs)
    const until = Date.now() + SEEK_WAIT_MS
    let why = ""
    for (;;) {
        try {
            const state = (await soap(environment, transport, "GetTransportInfo", [["InstanceID", 0]])).CurrentTransportState ?? ""
            if (state === "PLAYING") {
                await soap(environment, transport, "Seek", [["InstanceID", 0], ["Unit", "REL_TIME"], ["Target", target]])
                // LG (14.11.2026) takes a Seek in the first seconds, reports the target at once and still plays on from
                // the start: only where it is a moment later tells
                await new Promise(resolve => setTimeout(resolve, SEEK_CHECK_MS))
                const at = upnpTimeMs((await soap(environment, transport, "GetPositionInfo", [["InstanceID", 0]])).RelTime)
                if (at >= positionMs - SEEK_SLACK_MS) {
                    console.log(`[Core] info cast: seek to ${target} done, the TV is at ${upnpTime(at)}`)
                    return null
                }
                why = `the TV is at ${upnpTime(at)} after Seek`
            }
            else why = `the TV is ${state || "in no state"}`
        }
        catch (error) {
            why = errorText(error)
        }
        if (Date.now() >= until) {
            const problem = `seek to ${target} failed: ${why}`
            console.warn(`[Core] warn cast: ${problem}`)
            return problem
        }
        await new Promise(resolve => setTimeout(resolve, 1000))
    }
}

/** POST /dlna-cast/start `{ deviceId, url, title, positionMs, artworkUrl }` */
export async function start(request: { body: unknown }, environment: CastEnvironment): Promise<boolean> {
    const device = known.get(text(request.body, "deviceId"))
    if (!device?.avTransport) {
        // the panel hears why; the request itself ends well, so the app does not report a second error
        fail("gone", "this TV is not in the last search")
        return false
    }
    const source = sourceOf(request.body)
    const title = text(request.body, "title")
    const artworkUrl = text(request.body, "artworkUrl")
    const positionMs = Math.max(0, number(request.body, "positionMs"))
    await stopSession(environment)
    await unshare(environment)
    const url = await addressFor(environment, source, hostOf(device.avTransport!.controlUrl))
    const kind = kindOf(device)
    const name = listed(device).name
    emit({ state: "connecting", device: name, kind })
    let missed: string | null
    try {
        missed = await open(environment, device, url, title, positionMs, artworkUrl)
    }
    catch (error) {
        await unshare(environment)
        fail("no-answer", errorText(error))
        return false
    }
    session = { device, kind, url, title, artworkUrl, positionMs, misses: 0, shown: false, timer: null }
    emit({ state: "started", device: name, kind })
    // the video plays, from its start: the panel says where the TV did not jump to (the session stays)
    if (missed) fail("seek-failed", missed, positionMs)
    watchStatus(environment, session)
    return true
}

function running(): Session {
    if (!session) throw new CoreError("not-connected", 409)
    return session
}

/** POST /dlna-cast/control `{ action, value }`: play, pause, seek (to value ms), skip (by value ms), volume (to value percent) */
export async function control(request: { body: unknown }, environment: CastEnvironment): Promise<boolean> {
    const current = running()
    const action = text(request.body, "action")
    const value = number(request.body, "value")
    const transport = current.device.avTransport!
    try {
        if (action === "play") await soap(environment, transport, "Play", [["InstanceID", 0], ["Speed", "1"]])
        else if (action === "pause") await soap(environment, transport, "Pause", [["InstanceID", 0]])
        else if (action === "seek" || action === "skip") {
            const from = action === "skip" ? upnpTimeMs((await soap(environment, transport, "GetPositionInfo", [["InstanceID", 0]])).RelTime) : 0
            await soap(environment, transport, "Seek", [["InstanceID", 0], ["Unit", "REL_TIME"], ["Target", upnpTime(Math.max(0, from + value))]])
        }
        else if (action === "volume") {
            if (!current.device.renderingControl) throw new Error("this TV has no volume control")
            await soap(environment, current.device.renderingControl, "SetVolume", [["InstanceID", 0], ["Channel", "Master"], ["DesiredVolume", Math.round(Math.min(100, Math.max(0, value)))]])
        }
        else throw new CoreError(`unknown action ${action}`, 400)
    }
    catch (error) {
        if (error instanceof CoreError) throw error
        fail("control-failed", errorText(error))
        return false
    }
    await sendStatus(environment)
    return true
}

/** POST /dlna-cast/status: the status follows as an event; without a session `idle` */
export async function status(environment: CastEnvironment): Promise<boolean> {
    await sendStatus(environment)
    return true
}

async function stopSession(environment: CastEnvironment): Promise<number> {
    const current = session
    if (!current) return 0
    stopStatus()
    session = null
    const transport = current.device.avTransport!
    const positionMs = await soap(environment, transport, "GetPositionInfo", [["InstanceID", 0]]).then(values => upnpTimeMs(values.RelTime), () => current.positionMs)
    await soap(environment, transport, "Stop", [["InstanceID", 0]]).catch(() => undefined)
    await unshare(environment)
    return positionMs
}

/** POST /dlna-cast/stop `{ resume }`: the phone continues where the TV was when resume is set */
export async function stop(request: { body: unknown }, environment: CastEnvironment): Promise<boolean> {
    if (!session) {
        await unshare(environment)
        return true
    }
    const positionMs = await stopSession(environment)
    emit({ state: "stopped", positionMs, resume: body(request.body).resume === true })
    return true
}

/** GET /dlna-cast/current: `{ device, kind }` while a TV plays, else null (as recorded) */
export async function current(): Promise<{ device: string, kind: Kind } | null> {
    return session ? { device: listed(session.device).name, kind: session.kind } : null
}

/** POST /dlna-cast/load `{ url, title, positionMs, artworkUrl }`: another video on the TV in use */
export async function load(request: { body: unknown }, environment: CastEnvironment): Promise<boolean> {
    const was = running()
    const source = sourceOf(request.body)
    const title = text(request.body, "title")
    const artworkUrl = text(request.body, "artworkUrl")
    const positionMs = Math.max(0, number(request.body, "positionMs"))
    stopStatus()
    session = null
    // the last video's share ends with it
    await unshare(environment)
    const name = listed(was.device).name
    emit({ state: "connecting", device: name, kind: was.kind })
    let missed: string | null
    try {
        const url = await addressFor(environment, source, hostOf(was.device.avTransport!.controlUrl))
        missed = await open(environment, was.device, url, title, positionMs, artworkUrl)
        session = { ...was, url, title, artworkUrl, positionMs, misses: 0, shown: false, timer: null }
    }
    catch (error) {
        await unshare(environment)
        fail("rejected", errorText(error))
        return false
    }
    emit({ state: "started", device: name, kind: was.kind })
    if (missed) fail("seek-failed", missed, positionMs)
    watchStatus(environment, session!)
    return true
}

/** POST /dlna-cast/switch-stream `{ url }`: the same video with another track, from where the TV is */
export async function switchStream(request: { body: unknown }, environment: CastEnvironment): Promise<boolean> {
    const was = running()
    const source = sourceOf(request.body)
    const positionMs = await soap(environment, was.device.avTransport!, "GetPositionInfo", [["InstanceID", 0]]).then(values => upnpTimeMs(values.RelTime), () => was.positionMs)
    stopStatus()
    await unshare(environment)
    let url = ""
    let missed: string | null
    switching = true
    try {
        url = await addressFor(environment, source, hostOf(was.device.avTransport!.controlUrl))
        missed = await open(environment, was.device, url, was.title, positionMs, was.artworkUrl)
    }
    catch (error) {
        session = null
        await unshare(environment)
        fail("track-failed", errorText(error))
        return false
    }
    finally {
        switching = false
    }
    session = { ...was, url, positionMs, misses: 0, shown: false, timer: null }
    if (missed) fail("seek-failed", missed, positionMs)
    watchStatus(environment, session)
    return true
}

/**
 * POST /dlna-cast/forward `{ host, url }`: the address a Google Cast TV at `host` is given. A source of the network goes
 * through as it is; a file or torrent stream of the device is shared into the network (the last share ends).
 */
export async function forward(request: { body: unknown }, environment: Sharing): Promise<string> {
    const source = sourceOf(request.body)
    await unshare(environment)
    return addressFor(environment, source, text(request.body, "host").replace(/^\//, ""))
}

/** POST /dlna-cast/forward-close: the Google Cast session ended, every share ends */
export async function forwardClose(environment: Sharing): Promise<boolean> {
    await unshare(environment)
    return true
}

/** For the tests: forgets devices and the session */
export function resetCast() {
    stopStatus()
    session = null
    sharing = false
    switching = false
    known.clear()
}
