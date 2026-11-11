import { describe, expect, it } from "vitest"
import { castStreamUrl, DlnaCastErrorCode, dlnaCastErrorText, initialDlnaCastState, reduceDlnaCast } from "./dlna_cast.helpers"

const de = (_en: string, de: string) => de
const en = (en: string) => en

describe("DLNA cast state", () => {
    it("follows a search, a start and the status of the TV", () => {
        let state = reduceDlnaCast(initialDlnaCastState, { state: "searching" })
        expect(state.phase).toBe("searching")
        state = reduceDlnaCast(state, { state: "devices", devices: [{ id: "dlna:x", name: "webOS TV", kind: "webos" }] })
        expect(state.phase).toBe("idle")
        expect(state.devices).toHaveLength(1)
        state = reduceDlnaCast(state, { state: "connecting", device: "webOS TV", kind: "webos" })
        state = reduceDlnaCast(state, { state: "started", device: "webOS TV", kind: "webos" })
        expect(state.phase).toBe("casting")
        state = reduceDlnaCast(state, { state: "status", device: "webOS TV", kind: "webos", playing: true, positionMs: 5000, durationMs: 9000, volume: -1, ended: false })
        expect(state).toMatchObject({ playing: true, positionMs: 5000, volume: -1 })
        state = reduceDlnaCast(state, { state: "stopped", positionMs: 5000, resume: true })
        expect(state.phase).toBe("idle")
        expect(state.devices).toHaveLength(1)
    })

    it("ends connecting on an error but keeps a session after a failed control", () => {
        const connecting = reduceDlnaCast(initialDlnaCastState, { state: "connecting", device: "TV", kind: "dlna" })
        expect(reduceDlnaCast(connecting, { state: "error", code: "tv-off", message: "" })).toMatchObject({ phase: "idle", error: "tv-off" })
        const casting = reduceDlnaCast(connecting, { state: "started", device: "TV", kind: "dlna" })
        expect(reduceDlnaCast(casting, { state: "error", code: "control-failed", message: "" }).phase).toBe("casting")
    })

    it("treats an empty device list as none", () => {
        expect(reduceDlnaCast(initialDlnaCastState, { state: "devices", devices: null }).devices).toEqual([])
    })
})

describe("DLNA cast texts", () => {
    it("has a German and English text for every error code", () => {
        const codes: DlnaCastErrorCode[] = ["gone", "no-wifi", "tv-off", "no-answer", "rejected", "control-failed", "track-failed", "not-connected", "invalid-stream"]
        for (const code of codes) {
            expect(dlnaCastErrorText(code, en)).not.toBe("")
            expect(dlnaCastErrorText(code, de)).not.toBe(dlnaCastErrorText(code, en))
        }
        expect(dlnaCastErrorText("tv-off", de)).toContain("Standby")
    })
})

describe("cast stream tracks", () => {
    it("sets and clears the track patches of the direct stream", () => {
        const url = "http://127.0.0.1:43212/api/v1/directstream/stream?id=abc&audioTrack=1"
        expect(castStreamUrl(url, { audioTrack: 2, subtitleTrack: -1 })).toBe("http://127.0.0.1:43212/api/v1/directstream/stream?id=abc&audioTrack=2&subtitleTrack=-1")
        expect(castStreamUrl(url, { audioTrack: null })).toBe("http://127.0.0.1:43212/api/v1/directstream/stream?id=abc")
    })
    it("keeps the other query values as they are (base64 padding and + of a Nakama path)", () => {
        const url = "http://127.0.0.1:43212/api/v1/nakama/stream?type=file&path=L3N0b3JhZ2UvYS+b/Q==#t"
        expect(castStreamUrl(url, { audioTrack: 2, subtitleTrack: -1 }))
            .toBe("http://127.0.0.1:43212/api/v1/nakama/stream?type=file&path=L3N0b3JhZ2UvYS+b/Q==&audioTrack=2&subtitleTrack=-1#t")
        expect(castStreamUrl(`${url.slice(0, -2)}&subtitleTrack=3&subtitleTrack=4`, { subtitleTrack: null, audioTrack: null }))
            .toBe("http://127.0.0.1:43212/api/v1/nakama/stream?type=file&path=L3N0b3JhZ2UvYS+b/Q==")
        expect(castStreamUrl("http://127.0.0.1:43212/api/v1/directstream/stream", { audioTrack: 1, subtitleTrack: null }))
            .toBe("http://127.0.0.1:43212/api/v1/directstream/stream?audioTrack=1")
    })
})
