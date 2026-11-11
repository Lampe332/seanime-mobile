import { beforeEach, describe, expect, it, vi } from "vitest"
import type { CastEvent } from "./cast-state"

// The controller talks to react-native-google-cast and the Go server; both are replaced so the session logic runs in Node.
const google = vi.hoisted(() => ({
    devices: [{ deviceId: "tv1", friendlyName: "Living room", ipAddress: "/192.168.1.20" }],
    session: null as null | Record<string, unknown>,
    sessionStarted: null as null | ((session: unknown) => void),
}))
const server = vi.hoisted(() => ({ calls: [] as string[] }))

vi.mock("react-native", () => ({ Platform: { OS: "android" } }))
vi.mock("@/api/client/requests", () => ({
    buildSeaQuery: async ({ endpoint }: { endpoint: string }) => {
        server.calls.push(endpoint)
        return endpoint.endsWith("/forward") ? "http://192.168.1.5:40000/abc" : true
    },
}))
vi.mock("react-native-google-cast", () => {
    const sub = { remove: () => undefined }
    return {
        MediaStreamType: { BUFFERED: "buffered" },
        default: {
            getDiscoveryManager: () => ({
                onDevicesUpdated: () => sub,
                startDiscovery: async () => undefined,
                getDevices: async () => google.devices,
            }),
            getSessionManager: () => ({
                onSessionStarted: (handler: (session: unknown) => void) => {
                    google.sessionStarted = handler
                    return sub
                },
                onSessionStartFailed: () => sub,
                startSession: async () => {
                    google.session = {
                        client: {
                            loadMedia: async () => undefined,
                            onMediaStatusUpdated: () => sub,
                            getMediaStatus: async () => ({ playerState: "playing", streamPosition: 754, mediaInfo: { streamDuration: 1440 } }),
                            getStreamPosition: async () => 754,
                            stop: async () => undefined,
                        },
                        getVolume: async () => 0.5,
                    }
                    queueMicrotask(() => google.sessionStarted?.(google.session))
                },
                getCurrentCastSession: async () => google.session,
                endCurrentSession: async () => {
                    google.session = null
                },
            }),
        },
    }
})

const { castController } = await import("./cast-controller")

async function startGoogleCast(events: CastEvent[]) {
    castController.subscribe(event => events.push(event))
    castController.discover()
    await new Promise(resolve => setTimeout(resolve, 3100))
    await castController.start("cast:tv1", "http://127.0.0.1:43212/api/v1/directstream/stream?id=a", "Dr. STONE · Episode 3", 60_000, "")
}

describe("cast controller (Google Cast)", () => {
    beforeEach(() => {
        server.calls = []
    })

    it("notices a session that ended outside the app and leaves the phone paused where the TV was", async () => {
        const events: CastEvent[] = []
        await startGoogleCast(events)
        expect(events.at(-1)).toMatchObject({ state: "started", kind: "googlecast" })
        expect(castController.casting).toBe(true)

        await castController.status()
        expect(events.at(-1)).toMatchObject({ state: "status", positionMs: 754_000 })

        // the system's cast notification ends the session
        google.session = null
        await castController.status()
        expect(events.at(-1)).toEqual({ state: "stopped", positionMs: 754_000, resume: false })
        expect(castController.casting).toBe(false)
        expect(server.calls).toContain("/api/v1/dlna-cast/forward-close")

        // later polls do nothing more
        const count = events.length
        await castController.status()
        expect(events.slice(count)).toEqual([{ state: "idle" }])
    }, 10_000)
})
