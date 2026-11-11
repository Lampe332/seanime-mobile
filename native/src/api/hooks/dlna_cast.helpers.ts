import type { Translate } from "@/lib/app-language"

/** WebSocket event of the Go DLNA cast session (backend/internal/dlnacast); replaces the old app's "seanime-cast" events. */
export const DLNA_CAST_EVENT = "dlna-cast"

/** "webos": LG TV (no volume, hide it as a Google Cast device); "dlna": other renderers. */
export type DlnaCastKind = "webos" | "dlna"

export type DlnaCastDevice = { id: string, name: string, kind: DlnaCastKind }

export type DlnaCastErrorCode =
    | "gone"
    | "no-wifi"
    | "tv-off"
    | "no-answer"
    | "rejected"
    | "control-failed"
    | "track-failed"
    | "not-connected"
    | "invalid-stream"

export type DlnaCastEvent =
    | { state: "searching" }
    | { state: "devices", devices: DlnaCastDevice[] | null }
    | { state: "connecting", device: string, kind: DlnaCastKind }
    | { state: "started", device: string, kind: DlnaCastKind }
    | {
    state: "status", device: string, kind: DlnaCastKind, playing: boolean, positionMs: number, durationMs: number,
    /** 0..100, -1 unknown (webOS: hide the volume buttons) */
    volume: number, ended: boolean
}
    | { state: "idle" }
    | { state: "stopped", positionMs: number, resume: boolean }
    | { state: "error", code: DlnaCastErrorCode, message: string }

/** What the cast panel shows, built from the events. */
export type DlnaCastState = {
    phase: "idle" | "searching" | "connecting" | "casting"
    devices: DlnaCastDevice[]
    device?: string
    kind?: DlnaCastKind
    playing: boolean
    positionMs: number
    durationMs: number
    volume: number
    error?: DlnaCastErrorCode
}

export const initialDlnaCastState: DlnaCastState = { phase: "idle", devices: [], playing: false, positionMs: 0, durationMs: 0, volume: -1 }

export function reduceDlnaCast(state: DlnaCastState, event: DlnaCastEvent): DlnaCastState {
    switch (event.state) {
        case "searching":
            return { ...state, phase: state.phase === "casting" ? "casting" : "searching", error: undefined }
        case "devices":
            return { ...state, phase: state.phase === "searching" ? "idle" : state.phase, devices: event.devices ?? [] }
        case "connecting":
            return { ...state, phase: "connecting", device: event.device, kind: event.kind, error: undefined }
        case "started":
            return { ...state, phase: "casting", device: event.device, kind: event.kind, error: undefined }
        case "status":
            return {
                ...state, phase: "casting", device: event.device, kind: event.kind, playing: event.playing, positionMs: event.positionMs,
                durationMs: event.durationMs, volume: event.volume,
            }
        case "idle":
        case "stopped":
            return { ...initialDlnaCastState, devices: state.devices }
        case "error":
            // a failed start or load ends connecting; a failed control keeps the session
            return { ...state, phase: state.phase === "connecting" ? "idle" : state.phase, error: event.code }
    }
}

export function dlnaCastErrorText(code: DlnaCastErrorCode, tr: Translate): string {
    switch (code) {
        case "gone":
            return tr("This TV is gone, search again.", "Dieser Fernseher ist weg, bitte neu suchen.")
        case "no-wifi":
            return tr("No Wi-Fi: the TV can only be reached in the same Wi-Fi.", "Kein WLAN: Der Fernseher ist nur im selben WLAN erreichbar.")
        case "tv-off":
            return tr("The TV is off or in standby. Turn it on and try again.", "Der Fernseher ist aus oder im Standby. Bitte einschalten und nochmal versuchen.")
        case "no-answer":
            return tr("The TV does not answer. Is it on?", "Der Fernseher antwortet nicht. Ist er eingeschaltet?")
        case "rejected":
            return tr("The TV did not take the video.", "Der Fernseher hat das Video nicht angenommen.")
        case "control-failed":
            return tr("The TV did not answer.", "Der Fernseher hat nicht geantwortet.")
        case "track-failed":
            return tr("The TV did not take the other track.", "Der Fernseher hat die andere Spur nicht übernommen.")
        case "not-connected":
            return tr("No TV is connected.", "Es ist kein Fernseher verbunden.")
        case "invalid-stream":
            return tr("This video cannot be cast.", "Dieses Video kann nicht übertragen werden.")
    }
}

/**
 * The direct stream URL with the tracks the TV should play: LG takes the first subtitle track and the default audio track,
 * so the server hides the others (?audioTrack=N, ?subtitleTrack=N or -1 for none; backend/internal/directstream/audiotrack.go).
 */
export function castStreamUrl(url: string, tracks: { audioTrack?: number | null, subtitleTrack?: number | null }): string {
    return withQueryValues(url, tracks)
}

/**
 * Sets (or removes, for null/undefined) query values and leaves the rest of the URL byte for byte as it was. Not URL():
 * React Native's URL re-parses the whole query on `searchParams` and cuts every value at its second "=", so the base64
 * padding of a Nakama path (`/api/v1/nakama/stream?type=file&path=…==`) was lost and the server could not decode it.
 */
export function withQueryValues(url: string, values: Record<string, number | string | null | undefined>): string {
    const hashAt = url.indexOf("#")
    const hash = hashAt >= 0 ? url.slice(hashAt) : ""
    const beforeHash = hashAt >= 0 ? url.slice(0, hashAt) : url
    const queryAt = beforeHash.indexOf("?")
    const base = queryAt >= 0 ? beforeHash.slice(0, queryAt) : beforeHash
    const pending = new Map(Object.entries(values))
    const parts: string[] = []
    for (const part of queryAt >= 0 ? beforeHash.slice(queryAt + 1).split("&") : []) {
        if (!part) continue
        const name = part.split("=", 1)[0]
        if (!Object.prototype.hasOwnProperty.call(values, name)) {
            parts.push(part)
            continue
        }
        // the first occurrence takes the new value in its place, repeats go
        const value = pending.get(name)
        pending.delete(name)
        if (value !== null && value !== undefined) parts.push(`${name}=${encodeURIComponent(String(value))}`)
    }
    for (const [name, value] of pending) {
        if (value !== null && value !== undefined) parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`)
    }
    return `${base}${parts.length ? `?${parts.join("&")}` : ""}${hash}`
}
