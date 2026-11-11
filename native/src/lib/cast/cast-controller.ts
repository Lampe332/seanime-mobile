import { buildSeaQuery } from "@/api/client/requests"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import type { DlnaCast_Current } from "@/api/generated/types"
import type { DlnaCastDevice, DlnaCastErrorCode, DlnaCastEvent } from "@/api/hooks/dlna_cast.helpers"
import { serverAuthTokenAtom } from "@/main/_atoms/server-status.atoms"
import { isAxiosError } from "axios"
import { getDefaultStore } from "jotai"
import { Platform } from "react-native"
import GoogleCast, { type CastSession, type Device, MediaStreamType } from "react-native-google-cast"
import { CastDevice, CastErrorCode, CastEvent, CastKind, GOOGLE_PREFIX, googleStatus, mergeDevices } from "./cast-state"

/*
 * The cast session behind the player's cast panel (CastController.kt + GoogleCast.kt): finds TVs over DLNA (Go server,
 * /api/v1/dlna-cast) and Google Cast (react-native-google-cast, Google's default receiver), starts, controls and ends
 * casting, and reports one stream of events. Google Cast receivers get the stream through the Go forwarder too
 * (/dlna-cast/forward), since the server itself only listens on 127.0.0.1.
 */

// LG answers Play only once the video is open; Google Cast gets the same time to start a session
const CONNECT_TIMEOUT_MS = 50_000
const DISCOVER_MS = 3000

type Listener = (event: CastEvent) => void

type GoogleSession = { device: Device, name: string, title: string, artworkUrl: string }

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function password() {
    return getDefaultStore().get(serverAuthTokenAtom)
}

async function dlna<T>(endpoint: { endpoint: string, methods: readonly string[] }, data?: unknown): Promise<T | undefined> {
    return buildSeaQuery<T>({ endpoint: endpoint.endpoint, method: endpoint.methods[0] as "POST", data, password: password() })
}

/** The forward's error code from the server's answer ("invalid-stream", "no-wifi"). */
function forwardCode(error: unknown): CastErrorCode {
    const code = isAxiosError(error) ? (error.response?.data as { error?: string } | undefined)?.error : undefined
    return code === "invalid-stream" ? "invalid-stream" : "no-wifi"
}

class CastController {
    private listeners = new Set<Listener>()
    private dlnaDevices: DlnaCastDevice[] = []
    private googleDevices: Device[] = []
    private google: GoogleSession | null = null
    // where the Google Cast TV was at the last status, for an end the app did not start
    private lastPositionMs = 0
    private dlnaActive: { device: string, kind: CastKind } | null = null
    // Cast routes vanish once nobody scans, and selecting a vanished one does nothing: the scan runs until a session starts
    private scan: { remove(): void } | null = null
    private statusSub: { remove(): void } | null = null
    private pendingDiscover: { dlna?: DlnaCastDevice[], google?: Device[] } | null = null

    subscribe(listener: Listener) {
        this.listeners.add(listener)
        return () => {
            this.listeners.delete(listener)
        }
    }

    private emit(event: CastEvent) {
        if (event.state === "started" || event.state === "connecting") {
            if (event.kind !== "googlecast") this.dlnaActive = { device: event.device, kind: event.kind }
        }
        if (event.state === "stopped" || event.state === "idle") this.dlnaActive = null
        this.listeners.forEach(listener => listener(event))
    }

    private fail(code: CastErrorCode) {
        this.emit({ state: "error", code })
    }

    /** True while a TV plays (no picture-in-picture while casting, E3). */
    get casting(): boolean {
        return this.google !== null || this.dlnaActive !== null
    }

    /** DLNA events of the Go server (useCastEventsBridge forwards the "dlna-cast" WebSocket events). */
    onDlnaEvent(event: DlnaCastEvent) {
        if (event.state === "devices") {
            this.dlnaDevices = event.devices ?? []
            if (this.pendingDiscover) {
                this.pendingDiscover.dlna = this.dlnaDevices
                this.finishDiscover()
            }
            return
        }
        // the searching event is sent by discover() itself, once for both
        if (event.state === "searching") return
        if (event.state === "error") return this.fail(event.code)
        // a DLNA session only reports while Google Cast is not in use
        if (this.google && event.state !== "stopped") return
        this.emit(event as CastEvent)
    }

    private finishDiscover() {
        const pending = this.pendingDiscover
        if (!pending?.dlna || !pending.google) return
        this.pendingDiscover = null
        this.emit({ state: "devices", devices: mergeDevices(pending.dlna, pending.google) })
    }

    discover() {
        this.emit({ state: "searching" })
        const pending: { dlna?: DlnaCastDevice[], google?: Device[] } = {}
        this.pendingDiscover = pending
        // the Go search answers after 3 s as an event; without the WebSocket it never comes, so the list closes anyway
        setTimeout(() => {
            if (this.pendingDiscover !== pending) return
            pending.dlna ??= []
            pending.google ??= this.googleDevices
            this.finishDiscover()
        }, DISCOVER_MS * 3)
        dlna<boolean>(API_ENDPOINTS.DLNA_CAST.DlnaCastDiscover).catch(() => {
            if (this.pendingDiscover) {
                this.pendingDiscover.dlna = []
                this.finishDiscover()
            }
        })
        if (Platform.OS !== "android") {
            this.pendingDiscover.google = []
            return
        }
        try {
            const discovery = GoogleCast.getDiscoveryManager()
            this.scan?.remove()
            this.scan = discovery.onDevicesUpdated(devices => {
                this.googleDevices = devices
            })
            void discovery.startDiscovery().catch(() => undefined)
            setTimeout(() => {
                void discovery.getDevices().catch(() => [] as Device[]).then(devices => {
                    this.googleDevices = devices
                    if (this.pendingDiscover) {
                        this.pendingDiscover.google = devices
                        this.finishDiscover()
                    }
                })
            }, DISCOVER_MS)
        }
        catch {
            this.pendingDiscover.google = []
            this.finishDiscover()
        }
    }

    private endScan() {
        this.scan?.remove()
        this.scan = null
    }

    /** Gives up connecting: ends the scan (the half-made Google Cast selection ends with it). */
    cancel() {
        this.endScan()
    }

    async start(id: string, url: string, title: string, positionMs: number, artworkUrl: string) {
        const known = this.devices().find(device => device.id === id)
        if (!known) return this.fail("gone")
        await this.stopNow()
        if (known.kind !== "googlecast") {
            await dlna(API_ENDPOINTS.DLNA_CAST.DlnaCastStart, { deviceId: id, url, title, positionMs, artworkUrl }).catch(() => this.fail("rejected"))
            return
        }
        this.emit({ state: "connecting", device: known.name, kind: "googlecast" })
        // the route as it is now; selecting a vanished one does nothing
        const fresh = (await GoogleCast.getDiscoveryManager().getDevices().catch(() => [] as Device[]))
            .find(device => GOOGLE_PREFIX + device.deviceId === id)
        if (!fresh) return this.fail("gone")
        let castUrl: string
        try {
            castUrl = (await this.forward(fresh, url))!
        }
        catch (error) {
            return this.fail(forwardCode(error))
        }
        try {
            const session = await this.startSession(fresh.deviceId)
            this.endScan()
            await this.loadInto(session, castUrl, title, artworkUrl, positionMs)
            this.google = { device: fresh, name: known.name, title, artworkUrl }
            this.lastPositionMs = positionMs
            this.watchStatus(session)
            this.emit({ state: "started", device: known.name, kind: "googlecast" })
        }
        catch (error) {
            this.endScan()
            await GoogleCast.getSessionManager().endCurrentSession(true).catch(() => undefined)
            await dlna(API_ENDPOINTS.DLNA_CAST.DlnaCastForwardClose).catch(() => undefined)
            this.fail(error instanceof TimeoutError ? "no-answer" : "rejected")
        }
    }

    private devices(): CastDevice[] {
        return mergeDevices(this.dlnaDevices, this.googleDevices)
    }

    private forward(device: Device, url: string) {
        return dlna<string>(API_ENDPOINTS.DLNA_CAST.DlnaCastForward, { host: device.ipAddress.replace(/^\//, ""), url })
    }

    /** The first answer wins: started, failed or the timeout. */
    private startSession(deviceId: string): Promise<CastSession> {
        const sessions = GoogleCast.getSessionManager()
        return new Promise<CastSession>((resolve, reject) => {
            const subs: { remove(): void }[] = []
            const done = (run: () => void) => {
                clearTimeout(timer)
                subs.forEach(sub => sub.remove())
                run()
            }
            const timer = setTimeout(() => done(() => reject(new TimeoutError())), CONNECT_TIMEOUT_MS)
            subs.push(sessions.onSessionStarted(session => done(() => resolve(session))))
            subs.push(sessions.onSessionStartFailed((_session, error) => done(() => reject(new Error(error ?? "cast session failed")))))
            sessions.startSession(deviceId).catch(error => done(() => reject(error)))
        })
    }

    private async loadInto(session: CastSession, url: string, title: string, artworkUrl: string, positionMs: number) {
        await withTimeout(CONNECT_TIMEOUT_MS, session.client.loadMedia({
            autoplay: true,
            startTime: Math.max(0, positionMs) / 1000,
            mediaInfo: {
                contentUrl: url,
                // Matroska: the receiver plays it like Chrome does (H.264/HEVC/VP9/AV1 with AAC/Opus/…)
                contentType: "video/x-matroska",
                streamType: MediaStreamType.BUFFERED,
                metadata: { type: "movie", title, images: artworkUrl ? [{ url: artworkUrl }] : [] },
            },
        }))
    }

    private watchStatus(session: CastSession) {
        this.statusSub?.remove()
        this.statusSub = session.client.onMediaStatusUpdated(() => {
            void this.status()
        })
    }

    private async googleSession(): Promise<CastSession | null> {
        return GoogleCast.getSessionManager().getCurrentCastSession().catch(() => null)
    }

    /** play, pause, seek (to value ms), skip (by value ms), volume (to value percent); answers with a status. */
    async control(action: "play" | "pause" | "seek" | "skip" | "volume", value: number = 0) {
        if (!this.google) {
            if (this.dlnaActive) await dlna(API_ENDPOINTS.DLNA_CAST.DlnaCastControl, { action, value }).catch(() => this.fail("control-failed"))
            return
        }
        try {
            const session = await this.googleSession()
            if (!session) throw new Error("no cast session")
            const client = session.client
            if (action === "play") await client.play()
            else if (action === "pause") await client.pause()
            else if (action === "seek") await client.seek({ position: Math.max(0, value) / 1000 })
            else if (action === "skip") await client.seek({ position: Math.max(0, ((await client.getStreamPosition()) ?? 0) + value / 1000) })
            else session.setVolume(Math.min(100, Math.max(0, value)) / 100)
        }
        catch {
            return this.fail("control-failed")
        }
        await sleep(400)
        await this.status()
    }

    /** Plays url on the TV instead, from where it is now: another audio or subtitle track picked on the phone. */
    async switchStream(url: string) {
        const current = this.google
        if (!current) {
            if (this.dlnaActive) await dlna(API_ENDPOINTS.DLNA_CAST.DlnaCastSwitchStream, { url }).catch(() => this.fail("track-failed"))
            return
        }
        try {
            const session = await this.googleSession()
            if (!session) throw new Error("no cast session")
            const positionMs = ((await session.client.getStreamPosition()) ?? 0) * 1000
            const castUrl = (await this.forward(current.device, url))!
            await this.loadInto(session, castUrl, current.title, current.artworkUrl, positionMs)
        }
        catch {
            return this.fail("track-failed")
        }
        await this.status()
    }

    /** Plays another video (the next episode) on the TV in use from positionMs, without a new search. */
    async load(url: string, title: string, positionMs: number, artworkUrl: string) {
        const current = this.google
        if (!current) {
            if (!this.dlnaActive) return this.fail("not-connected")
            await dlna(API_ENDPOINTS.DLNA_CAST.DlnaCastLoad, { url, title, positionMs, artworkUrl }).catch(() => this.fail("rejected"))
            return
        }
        this.emit({ state: "connecting", device: current.name, kind: "googlecast" })
        try {
            const session = await this.googleSession()
            if (!session) throw new Error("no cast session")
            const castUrl = (await this.forward(current.device, url))!
            await this.loadInto(session, castUrl, title, artworkUrl, positionMs)
        }
        catch (error) {
            return this.fail(error instanceof TimeoutError ? "no-answer" : "rejected")
        }
        // ended while loading
        if (this.google !== current) return
        this.google = { ...current, title, artworkUrl }
        this.lastPositionMs = positionMs
        this.emit({ state: "started", device: current.name, kind: "googlecast" })
        await this.status()
    }

    async status() {
        const current = this.google
        if (!current) {
            if (this.dlnaActive) await dlna(API_ENDPOINTS.DLNA_CAST.DlnaCastStatus).catch(() => undefined)
            else this.emit({ state: "idle" })
            return
        }
        const session = await this.googleSession()
        if (!session) {
            // ended outside the app (the system's cast notification, the TV, another phone): the poll notices it, the
            // phone stays paused where the TV was (GoogleCast.kt never noticed and kept the pill up)
            if (this.google === current) await this.endedOutside()
            return
        }
        const [mediaStatus, volume] = await Promise.all([session.client.getMediaStatus().catch(() => null), session.getVolume().catch(() => 0)])
        const status = googleStatus(mediaStatus, volume)
        if (!status || this.google !== current) return
        this.lastPositionMs = status.positionMs
        this.emit({ state: "status", device: current.name, kind: "googlecast", ...status })
    }

    private async endedOutside() {
        this.google = null
        this.statusSub?.remove()
        this.statusSub = null
        await dlna(API_ENDPOINTS.DLNA_CAST.DlnaCastForwardClose).catch(() => undefined)
        this.emit({ state: "stopped", positionMs: this.lastPositionMs, resume: false })
    }

    /** Ends casting; with resume the phone continues where the TV was. */
    async stop(resume: boolean) {
        const current = this.google
        if (!current) {
            if (this.dlnaActive) await dlna(API_ENDPOINTS.DLNA_CAST.DlnaCastStop, { resume }).catch(() => undefined)
            return
        }
        const session = await this.googleSession()
        const positionMs = Math.round((((await session?.client.getStreamPosition().catch(() => 0)) ?? 0)) * 1000)
        await this.stopNow()
        this.emit({ state: "stopped", positionMs, resume })
    }

    /** The casting device, or null when nothing casts (the panel asks after the app restarted). */
    async current(): Promise<{ device: string, kind: CastKind } | null> {
        if (this.google) return { device: this.google.name, kind: "googlecast" }
        const current = await buildSeaQuery<DlnaCast_Current | null>({
            endpoint: API_ENDPOINTS.DLNA_CAST.DlnaCastCurrent.endpoint, method: "GET", password: password(),
        }).catch(() => null)
        this.dlnaActive = current ? { device: current.device, kind: current.kind as CastKind } : null
        return this.dlnaActive
    }

    /** A new start stops the old session first, without a "stopped" event. */
    private async stopNow() {
        if (this.google) {
            this.google = null
            this.statusSub?.remove()
            this.statusSub = null
            const session = await this.googleSession()
            await session?.client.stop().catch(() => undefined)
            await GoogleCast.getSessionManager().endCurrentSession(true).catch(() => undefined)
            await dlna(API_ENDPOINTS.DLNA_CAST.DlnaCastForwardClose).catch(() => undefined)
        }
    }
}

class TimeoutError extends Error {
    constructor() {
        super("timeout")
    }
}

function withTimeout<T>(ms: number, promise: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new TimeoutError()), ms)
        promise.then(value => {
            clearTimeout(timer)
            resolve(value)
        }, error => {
            clearTimeout(timer)
            reject(error)
        })
    })
}

export const castController = new CastController()

export type { DlnaCastErrorCode }
