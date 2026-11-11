import { DlnaCastDevice, DlnaCastErrorCode, dlnaCastErrorText } from "@/api/hooks/dlna_cast.helpers"
import type { Translate } from "@/lib/app-language"

/*
 * The one cast panel over both ways to a TV (CastController.kt): DLNA (LG webOS and other renderers, in the Go server)
 * and Google Cast (Chromecast/Google TV, react-native-google-cast). Same events as before: searching, devices,
 * connecting, started, status, stopped, error. Pure, so it can be unit tested.
 */
export type CastKind = "webos" | "dlna" | "googlecast"

export type CastDevice = { id: string, name: string, kind: CastKind }

export type CastErrorCode = DlnaCastErrorCode

export type CastEvent =
    | { state: "searching" }
    | { state: "devices", devices: CastDevice[] }
    | { state: "connecting", device: string, kind: CastKind }
    | { state: "started", device: string, kind: CastKind }
    | { state: "status", device: string, kind: CastKind, playing: boolean, positionMs: number, durationMs: number, volume: number, ended: boolean }
    | { state: "idle" }
    | { state: "stopped", positionMs: number, resume: boolean }
    | { state: "error", code: CastErrorCode }

export type CastState = {
    phase: "idle" | "searching" | "connecting" | "casting"
    devices: CastDevice[]
    device?: string
    kind?: CastKind
    playing: boolean
    positionMs: number
    durationMs: number
    /** 0..100, -1 unknown (webOS: hide the volume buttons) */
    volume: number
    ended: boolean
    error?: CastErrorCode
    /** the phone's position when casting stopped, and whether the phone continues there */
    stopped?: { positionMs: number, resume: boolean }
}

export const initialCastState: CastState = { phase: "idle", devices: [], playing: false, positionMs: 0, durationMs: 0, volume: -1, ended: false }

export function reduceCast(state: CastState, event: CastEvent): CastState {
    switch (event.state) {
        case "searching":
            return { ...state, phase: state.phase === "casting" ? "casting" : "searching", error: undefined }
        case "devices":
            return { ...state, phase: state.phase === "searching" ? "idle" : state.phase, devices: event.devices }
        case "connecting":
            return { ...state, phase: "connecting", device: event.device, kind: event.kind, error: undefined, stopped: undefined }
        case "started":
            return { ...state, phase: "casting", device: event.device, kind: event.kind, error: undefined, ended: false }
        case "status":
            return {
                ...state, phase: "casting", device: event.device, kind: event.kind, playing: event.playing, positionMs: event.positionMs,
                durationMs: event.durationMs, volume: event.volume, ended: event.ended,
            }
        case "idle":
            return { ...initialCastState, devices: state.devices }
        case "stopped":
            return { ...initialCastState, devices: state.devices, stopped: { positionMs: event.positionMs, resume: event.resume } }
        case "error":
            // a failed start or load ends connecting; a failed control keeps the session
            return { ...state, phase: state.phase === "connecting" ? "idle" : state.phase, error: event.code }
    }
}

/** "[LG] webOS TV OLED65B59LA" → "webOS TV OLED65B59LA"; LG lists its TVs with this prefix over DLNA and Google Cast. */
export function displayName(name: string): string {
    return name.replace(/^\[LG]/, "").trim()
}

export function isWebOs(name: string): boolean {
    return name.includes("[LG]") || name.toLowerCase().includes("webos")
}

export type GoogleCastDeviceLike = { deviceId: string, friendlyName: string, modelName?: string }

export const GOOGLE_PREFIX = "cast:"

/**
 * One list for the panel. LG TVs also answer over Google Cast, but their Cast receiver shows no picture for AV1 and no
 * subtitles: they are offered over DLNA only (the same name as a webOS renderer, or a webOS name of their own).
 */
export function mergeDevices(dlna: DlnaCastDevice[], google: GoogleCastDeviceLike[]): CastDevice[] {
    const webOs = new Set(dlna.filter(it => it.kind === "webos").map(it => displayName(it.name)))
    const devices: CastDevice[] = dlna.map(it => ({ id: it.id, name: displayName(it.name), kind: it.kind }))
    for (const route of google) {
        const name = displayName(route.friendlyName)
        if (webOs.has(name) || isWebOs(route.friendlyName) || isWebOs(route.modelName ?? "")) continue
        devices.push({ id: GOOGLE_PREFIX + route.deviceId, name, kind: "googlecast" })
    }
    return devices
}

/** Google Cast's media status → the panel's status (positions in ms; ended = idle because the video finished). */
export function googleStatus(status: { playerState: string | null, idleReason?: string | null, streamPosition: number, mediaInfo?: { streamDuration?: number } | null } | null,
    volume: number): { playing: boolean, positionMs: number, durationMs: number, volume: number, ended: boolean } | null {
    if (!status) return null
    return {
        playing: status.playerState === "playing",
        positionMs: Math.round(status.streamPosition * 1000),
        durationMs: Math.round((status.mediaInfo?.streamDuration ?? 0) * 1000),
        volume: Math.round(volume * 100),
        ended: status.playerState === "idle" && status.idleReason === "finished",
    }
}

export function castErrorText(code: CastErrorCode, tr: Translate): string {
    return dlnaCastErrorText(code, tr)
}
