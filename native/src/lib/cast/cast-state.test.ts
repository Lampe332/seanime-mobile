import { describe, expect, it } from "vitest"
import { displayName, googleStatus, initialCastState, isWebOs, mergeDevices, reduceCast } from "./cast-state"

describe("cast devices", () => {
    it("hides an LG TV as Google Cast device and lists it over DLNA", () => {
        const devices = mergeDevices(
            [{ id: "dlna:http://tv/av", name: "[LG] webOS TV OLED65B59LA", kind: "webos" }, { id: "dlna:http://box/av", name: "Kodi", kind: "dlna" }],
            [{ deviceId: "a", friendlyName: "[LG] webOS TV OLED65B59LA" }, { deviceId: "b", friendlyName: "Living Room TV", modelName: "Chromecast" }],
        )
        expect(devices).toEqual([
            { id: "dlna:http://tv/av", name: "webOS TV OLED65B59LA", kind: "webos" },
            { id: "dlna:http://box/av", name: "Kodi", kind: "dlna" },
            { id: "cast:b", name: "Living Room TV", kind: "googlecast" },
        ])
    })
    it("hides an LG Google Cast device also when DLNA did not find it", () => {
        expect(mergeDevices([], [{ deviceId: "a", friendlyName: "[LG] webOS TV" }, { deviceId: "c", friendlyName: "TV", modelName: "webOS TV" }])).toEqual([])
    })
    it("names", () => {
        expect(displayName("[LG] webOS TV OLED65B59LA")).toBe("webOS TV OLED65B59LA")
        expect(isWebOs("LG webOS TV")).toBe(true)
        expect(isWebOs("Chromecast")).toBe(false)
    })
})

describe("cast session state", () => {
    it("searching → devices → connecting → started → status → stopped", () => {
        let state = reduceCast(initialCastState, { state: "searching" })
        expect(state.phase).toBe("searching")
        state = reduceCast(state, { state: "devices", devices: [{ id: "cast:b", name: "TV", kind: "googlecast" }] })
        expect(state.phase).toBe("idle")
        state = reduceCast(state, { state: "connecting", device: "TV", kind: "googlecast" })
        state = reduceCast(state, { state: "started", device: "TV", kind: "googlecast" })
        expect(state.phase).toBe("casting")
        state = reduceCast(state, { state: "status", device: "TV", kind: "googlecast", playing: true, positionMs: 5000, durationMs: 9000, volume: 40, ended: false })
        expect(state).toMatchObject({ playing: true, positionMs: 5000, volume: 40 })
        state = reduceCast(state, { state: "stopped", positionMs: 5000, resume: true })
        expect(state).toMatchObject({ phase: "idle", stopped: { positionMs: 5000, resume: true } })
        expect(state.devices).toHaveLength(1)
    })
    it("a failed start ends connecting, a failed control keeps the session", () => {
        const connecting = reduceCast(initialCastState, { state: "connecting", device: "TV", kind: "webos" })
        expect(reduceCast(connecting, { state: "error", code: "tv-off" })).toMatchObject({ phase: "idle", error: "tv-off" })
        const casting = reduceCast(connecting, { state: "started", device: "TV", kind: "webos" })
        expect(reduceCast(casting, { state: "error", code: "control-failed" })).toMatchObject({ phase: "casting", error: "control-failed" })
    })
})

describe("Google Cast status", () => {
    it("maps seconds to ms and finished to ended", () => {
        expect(googleStatus({ playerState: "playing", streamPosition: 12.5, mediaInfo: { streamDuration: 1440 } }, 0.5))
            .toEqual({ playing: true, positionMs: 12500, durationMs: 1440000, volume: 50, ended: false })
        expect(googleStatus({ playerState: "idle", idleReason: "finished", streamPosition: 0 }, 1)?.ended).toBe(true)
        expect(googleStatus({ playerState: "idle", idleReason: "cancelled", streamPosition: 0 }, 1)?.ended).toBe(false)
        expect(googleStatus(null, 1)).toBeNull()
    })
})
