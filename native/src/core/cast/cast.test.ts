// geschrieben nach: App-Code src/lib/cast/cast-controller.ts und src/api/hooks/dlna_cast.helpers.ts (Ereignis `dlna-cast`), Aufzeichnung DLNA_CAST.* vom 13.11.2026 (nur die Form) und öffentlicher UPnP-Spezifikation; der Fernseher ist erfunden (Adressen aus 192.0.2.0/24)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { onCoreEvent } from "../events"
import { matchCoreRoute } from "../registry"
import { type CastEnvironment, type CastOutlet, DEVICE_STREAM, HEADERS_UNSUPPORTED, NO_OUTLET, castSource, control, current, discover, forward, forwardClose, load, resetCast, start, status, stop, switchStream } from "./cast"

const DESCRIPTION = `<?xml version="1.0"?><root xmlns="urn:schemas-upnp-org:device-1-0"><device>
<deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType><friendlyName>Test TV</friendlyName>
<manufacturer>MAKER</manufacturer><modelName>Renderer 1</modelName><UDN>uuid:tv-1</UDN><serviceList>
<service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><controlURL>/av</controlURL></service>
<service><serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType><controlURL>/rc</controlURL></service>
</serviceList></device></root>`

const REPLY = "HTTP/1.1 200 OK\r\nLOCATION: http://192.0.2.10:1400/desc.xml\r\nST: urn:schemas-upnp-org:device:MediaRenderer:1\r\nUSN: uuid:tv-1\r\n\r\n"

type Call = { url: string, action: string, body: string }

/** A TV after the specification: the actions the core uses, with a transport state it keeps */
function fakeTv(options: { manufacturer?: string, failPlay?: number, deadAfterStart?: boolean, transitioning?: number, seekFault?: number, forgetsFirstSeek?: boolean } = {}) {
    const calls: Call[] = []
    const searches: string[] = []
    let state = "NO_MEDIA_PRESENT"
    let relTime = "0:00:00"
    let volume = 30
    let playFailures = options.failPlay ?? 0
    let opening = 0
    let seeks = 0
    let dead = false
    const answer = (action: string, inner = "") => `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:${action}Response xmlns:u="x">${inner}</u:${action}Response></s:Body></s:Envelope>`
    const environment: CastEnvironment = {
        cast: async () => ({
            search: async (message: string) => {
                searches.push(message)
                // the same TV answers twice, plus something that is no answer
                return [REPLY, REPLY, "NOTIFY * HTTP/1.1\r\n\r\n"]
            },
        }),
        fetch: async (url, init) => {
            if (dead) throw new TypeError("Network request failed")
            if (url.endsWith("/desc.xml")) {
                const xml = options.manufacturer ? DESCRIPTION.replace("MAKER", options.manufacturer) : DESCRIPTION
                return { status: 200, headers: { get: () => null }, text: async () => xml }
            }
            const action = /#(\w+)"$/.exec(init.headers?.SOAPAction ?? "")?.[1] ?? ""
            calls.push({ url, action, body: init.body ?? "" })
            let inner = ""
            if (action === "SetAVTransportURI") state = "STOPPED"
            if (action === "Play") {
                if (playFailures > 0) {
                    playFailures--
                    return { status: 500, headers: { get: () => null }, text: async () => "<s:Envelope><s:Body><s:Fault><detail><UPnPError><errorCode>701</errorCode><errorDescription>Transition not available</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>" }
                }
                // LG: Play answers while the video still opens; a Seek before it shows is refused
                state = options.transitioning ? "TRANSITIONING" : "PLAYING"
                opening = options.transitioning ?? 0
                if (options.deadAfterStart) dead = true
            }
            if (action === "Pause") state = "PAUSED_PLAYBACK"
            if (action === "Stop") state = "STOPPED"
            if (action === "Seek" && (options.seekFault || state === "TRANSITIONING")) {
                return { status: 500, headers: { get: () => null }, text: async () => `<s:Envelope><s:Body><s:Fault><detail><UPnPError><errorCode>${options.seekFault ?? 701}</errorCode><errorDescription>Seek refused</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>` }
            }
            // LG: the first Seek is taken, then the video plays on from its start
            if (action === "Seek") relTime = options.forgetsFirstSeek && seeks++ === 0 ? "0:00:03" : /<Target>([^<]*)</.exec(init.body ?? "")?.[1] ?? relTime
            if (action === "SetVolume") volume = Number(/<DesiredVolume>(\d+)</.exec(init.body ?? "")?.[1])
            if (action === "GetTransportInfo" && state === "TRANSITIONING" && opening-- <= 0) state = "PLAYING"
            if (action === "GetTransportInfo") inner = `<CurrentTransportState>${state}</CurrentTransportState><CurrentTransportStatus>OK</CurrentTransportStatus><CurrentSpeed>1</CurrentSpeed>`
            if (action === "GetPositionInfo") inner = `<Track>1</Track><TrackDuration>0:24:00</TrackDuration><RelTime>${relTime}</RelTime>`
            if (action === "GetVolume") inner = `<CurrentVolume>${volume}</CurrentVolume>`
            return { status: 200, headers: { get: () => null }, text: async () => answer(action, inner) }
        },
    }
    /** Stop from the TV's remote or another control point: the core is not asked */
    const stopFromOutside = () => {
        state = "STOPPED"
        relTime = "0:00:00"
    }
    return { environment, calls, searches, actions: () => calls.map(call => call.action), stopFromOutside }
}

/** A Stop at the TV that keeps its place (some TVs stop at the end of the video this way) */
async function soapStop(tv: ReturnType<typeof fakeTv>) {
    await tv.environment.fetch("http://192.0.2.10:1400/av", { method: "POST", headers: { SOAPAction: "\"urn:schemas-upnp-org:service:AVTransport:1#Stop\"" }, body: "", signal: new AbortController().signal })
}

let events: Record<string, unknown>[] = []
let stopListening = () => {}

const settle = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms))

async function found(tv: ReturnType<typeof fakeTv>) {
    await discover(tv.environment)
    for (let i = 0; i < 50 && !events.some(event => event.state === "devices"); i++) await settle(10)
}

beforeEach(() => {
    resetCast()
    events = []
    stopListening = onCoreEvent(event => {
        if (event.type === "dlna-cast") events.push(event.payload as Record<string, unknown>)
    })
})

afterEach(() => {
    stopListening()
    resetCast()
})

describe("area cast", () => {
    it("owns the app's ten DLNA addresses", () => {
        for (const endpoint of Object.values(API_ENDPOINTS.DLNA_CAST)) {
            const method = endpoint.methods[0]
            expect(matchCoreRoute(method, endpoint.endpoint)?.route.area, endpoint.endpoint).toBe("cast")
        }
        expect(Object.keys(API_ENDPOINTS.DLNA_CAST)).toHaveLength(10)
    })

    it("answers current with null when nothing casts, as recorded ({ data: null })", async () => {
        expect(await current()).toBeNull()
    })
})

describe("search", () => {
    it("answers true at once and sends the devices as an event, each TV once", async () => {
        const tv = fakeTv()
        expect(await discover(tv.environment)).toBe(true)
        await found(tv)
        expect(tv.searches[0]).toContain("ST: urn:schemas-upnp-org:device:MediaRenderer:1")
        expect(events.find(event => event.state === "devices")).toEqual({ state: "devices", devices: [{ id: "uuid:tv-1", name: "Test TV", kind: "dlna" }] })
    })

    it("names an LG TV webos (the app hides its volume)", async () => {
        const tv = fakeTv({ manufacturer: "LG Electronics" })
        await found(tv)
        expect((events.find(event => event.state === "devices")?.devices as { kind: string }[])[0]?.kind).toBe("webos")
    })

    it("sends an empty list when the search fails, and fails without the device's side", async () => {
        const tv = fakeTv()
        tv.environment.cast = async () => ({ search: async () => { throw new Error("no multicast") } })
        await found(tv)
        expect(events.find(event => event.state === "devices")).toEqual({ state: "devices", devices: [] })
        await expect(discover({ fetch: tv.environment.fetch })).rejects.toThrow("DLNA is not available here")
    })
})

describe("session", () => {
    it("starts: stop, address with DIDL-Lite, play, seek to the position; then started and status events", async () => {
        const tv = fakeTv()
        await found(tv)
        expect(await start({ body: { deviceId: "uuid:tv-1", url: "http://192.0.2.5/e1.mp4", title: "Ep 1", positionMs: 65_000, artworkUrl: "" } }, tv.environment)).toBe(true)
        expect(tv.actions()).toEqual(["Stop", "SetAVTransportURI", "Play", "GetTransportInfo", "Seek", "GetPositionInfo"])
        expect(tv.calls[1]?.url).toBe("http://192.0.2.10:1400/av")
        expect(tv.calls[1]?.body).toContain("&lt;res protocolInfo=&quot;http-get:*:video/mp4:DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000&quot;&gt;http://192.0.2.5/e1.mp4&lt;/res&gt;")
        expect(tv.calls[4]?.body).toContain("<Unit>REL_TIME</Unit><Target>0:01:05</Target>")
        await settle()
        expect(events.filter(event => event.state !== "devices").slice(0, 2)).toEqual([
            { state: "connecting", device: "Test TV", kind: "dlna" },
            { state: "started", device: "Test TV", kind: "dlna" },
        ])
        expect(await current()).toEqual({ device: "Test TV", kind: "dlna" })

        await status(tv.environment)
        await settle()
        expect(events.at(-1)).toEqual({ state: "status", device: "Test TV", kind: "dlna", playing: true, positionMs: 65_000, durationMs: 1_440_000, volume: 30, ended: false })
    })

    it("waits for Play while the TV opens the video (LG)", async () => {
        const tv = fakeTv({ failPlay: 1 })
        await found(tv)
        expect(await start({ body: { deviceId: "uuid:tv-1", url: "http://192.0.2.5/e1.mkv", title: "x", positionMs: 0 } }, tv.environment)).toBe(true)
        expect(tv.actions()).toEqual(["Stop", "SetAVTransportURI", "Play", "Play"])
    })

    it("jumps only once the TV shows the video (LG answers Play while TRANSITIONING) and checks where it landed", async () => {
        const tv = fakeTv({ transitioning: 1 })
        await found(tv)
        expect(await start({ body: { deviceId: "uuid:tv-1", url: "http://192.0.2.5/e1.mkv", title: "x", positionMs: 287_400 } }, tv.environment)).toBe(true)
        expect(tv.actions()).toEqual(["Stop", "SetAVTransportURI", "Play", "GetTransportInfo", "GetTransportInfo", "Seek", "GetPositionInfo"])
        expect(tv.calls[5]?.body).toContain("<Unit>REL_TIME</Unit><Target>0:04:47</Target>")
        expect(events.some(event => event.state === "error")).toBe(false)
    })

    it("jumps again when the TV took the Seek but played on from the start (LG)", async () => {
        const tv = fakeTv({ forgetsFirstSeek: true })
        await found(tv)
        vi.useFakeTimers()
        try {
            const starting = start({ body: { deviceId: "uuid:tv-1", url: "http://192.0.2.5/e1.mkv", title: "x", positionMs: 287_000 } }, tv.environment)
            await vi.advanceTimersByTimeAsync(10_000)
            expect(await starting).toBe(true)
        }
        finally {
            vi.useRealTimers()
        }
        expect(tv.actions().slice(2, 9)).toEqual(["Play", "GetTransportInfo", "Seek", "GetPositionInfo", "GetTransportInfo", "Seek", "GetPositionInfo"])
        expect(events.some(event => event.state === "error")).toBe(false)
    })

    it("does not swallow a refused jump: it is logged and the panel hears it, the session stays", async () => {
        const tv = fakeTv({ seekFault: 710 })
        await found(tv)
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
        vi.useFakeTimers()
        try {
            const starting = start({ body: { deviceId: "uuid:tv-1", url: "http://192.0.2.5/e1.mkv", title: "x", positionMs: 3_725_000 } }, tv.environment)
            await vi.advanceTimersByTimeAsync(35_000)
            expect(await starting).toBe(true)
        }
        finally {
            vi.useRealTimers()
        }
        const after = events.slice(events.findIndex(event => event.state === "connecting"))
        expect(after.slice(0, 2).map(event => event.state)).toEqual(["connecting", "started"])
        // its own code with the target, not "the TV did not answer" (control-failed)
        expect(after[2]).toMatchObject({ state: "error", code: "seek-failed", positionMs: 3_725_000 })
        expect(String(after[2]?.message)).toContain("seek to 1:02:05 failed: Seek failed: UPnP error 710")
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("UPnP error 710"))
        expect(await current()).toEqual({ device: "Test TV", kind: "dlna" })
        warn.mockRestore()
    })

    it("controls: pause, play, seek, skip and volume, each followed by a status", async () => {
        const tv = fakeTv()
        await found(tv)
        await start({ body: { deviceId: "uuid:tv-1", url: "http://192.0.2.5/e1.mp4", title: "x", positionMs: 0 } }, tv.environment)
        tv.calls.length = 0
        await control({ body: { action: "pause", value: 0 } }, tv.environment)
        await control({ body: { action: "seek", value: 120_000 } }, tv.environment)
        await control({ body: { action: "skip", value: 85_000 } }, tv.environment)
        await control({ body: { action: "volume", value: 140 } }, tv.environment)
        const changing = tv.calls.filter(call => !call.action.startsWith("Get"))
        expect(changing.map(call => call.action)).toEqual(["Pause", "Seek", "Seek", "SetVolume"])
        expect(changing[1]?.body).toContain("<Target>0:02:00</Target>")
        expect(changing[2]?.body).toContain("<Target>0:03:25</Target>")
        expect(changing[3]?.body).toContain("<Channel>Master</Channel><DesiredVolume>100</DesiredVolume>")
        await settle()
        expect(events.at(-1)).toMatchObject({ state: "status", playing: false, positionMs: 205_000, volume: 100 })
    })

    it("stops with the TV's position and the resume wish; then idle", async () => {
        const tv = fakeTv()
        await found(tv)
        await start({ body: { deviceId: "uuid:tv-1", url: "http://192.0.2.5/e1.mp4", title: "x", positionMs: 30_000 } }, tv.environment)
        expect(await stop({ body: { resume: true } }, tv.environment)).toBe(true)
        expect(tv.actions().at(-1)).toBe("Stop")
        await settle()
        expect(events.at(-1)).toEqual({ state: "stopped", positionMs: 30_000, resume: true })
        expect(await current()).toBeNull()
        await status(tv.environment)
        await settle()
        expect(events.at(-1)).toEqual({ state: "idle" })
    })

    it("loads the next video and switches the track from where the TV is", async () => {
        const tv = fakeTv()
        await found(tv)
        await start({ body: { deviceId: "uuid:tv-1", url: "http://192.0.2.5/e1.mp4", title: "Ep 1", positionMs: 0 } }, tv.environment)
        await load({ body: { url: "http://192.0.2.5/e2.mp4", title: "Ep 2", positionMs: 0, artworkUrl: "" } }, tv.environment)
        await control({ body: { action: "seek", value: 50_000 } }, tv.environment)
        tv.calls.length = 0
        await switchStream({ body: { url: "http://192.0.2.5/e2-de.mp4" } }, tv.environment)
        expect(tv.actions()).toEqual(["GetPositionInfo", "Stop", "SetAVTransportURI", "Play", "GetTransportInfo", "Seek", "GetPositionInfo"])
        expect(tv.calls[2]?.body).toContain("Ep 2")
        expect(tv.calls[5]?.body).toContain("<Target>0:00:50</Target>")
    })

    it("reports a TV that is not in the last search as gone, and controls without a session as not connected", async () => {
        const tv = fakeTv()
        expect(await start({ body: { deviceId: "uuid:other", url: "http://192.0.2.5/e1.mp4", title: "x", positionMs: 0 } }, tv.environment)).toBe(false)
        await settle()
        expect(events.at(-1)).toMatchObject({ state: "error", code: "gone" })
        await expect(control({ body: { action: "play" } }, tv.environment)).rejects.toThrow("not-connected")
        await expect(load({ body: { url: "http://192.0.2.5/e2.mp4" } }, tv.environment)).rejects.toThrow("not-connected")
    })

    it("ends the session when the TV is stopped from outside: stopped where it was, the phone does not play", async () => {
        const tv = fakeTv()
        await found(tv)
        await start({ body: { deviceId: "uuid:tv-1", url: "http://192.0.2.5/e1.mp4", title: "x", positionMs: 0 } }, tv.environment)
        await control({ body: { action: "seek", value: 120_000 } }, tv.environment)
        tv.stopFromOutside()
        await status(tv.environment)
        await settle()
        expect(events.at(-1)).toEqual({ state: "stopped", positionMs: 120_000, resume: false })
        expect(await current()).toBeNull()
    })

    it("keeps the session while the TV has not shown the video yet, and when it stopped at the end", async () => {
        const tv = fakeTv()
        await found(tv)
        await start({ body: { deviceId: "uuid:tv-1", url: "http://192.0.2.5/e1.mp4", title: "x", positionMs: 0 } }, tv.environment)
        tv.stopFromOutside()
        await status(tv.environment)
        await settle()
        expect(events.at(-1)).toMatchObject({ state: "status", playing: false })
        expect(await current()).not.toBeNull()

        await control({ body: { action: "play" } }, tv.environment)
        await control({ body: { action: "seek", value: 1_439_000 } }, tv.environment)
        await soapStop(tv)
        await status(tv.environment)
        await settle()
        expect(events.at(-1)).toMatchObject({ state: "status", ended: true })
        expect(await current()).not.toBeNull()
    })

    it("ends the session when the TV stops answering (tv-off)", async () => {
        const tv = fakeTv({ deadAfterStart: true })
        await found(tv)
        await start({ body: { deviceId: "uuid:tv-1", url: "http://192.0.2.5/e1.mp4", title: "x", positionMs: 0 } }, tv.environment)
        for (let i = 0; i < 5; i++) await status(tv.environment)
        await settle()
        expect(events.slice(-2)).toEqual([{ state: "error", code: "tv-off", message: "the TV stopped answering" }, { state: "stopped", positionMs: 0, resume: true }])
        expect(await current()).toBeNull()
    })
})

/** The outlet into the network as the device has it: every share an address with a token of its own, until unshare */
function fakeOutlet() {
    const calls: string[] = []
    let next = 0
    const shares = new Set<string>()
    const share = (name: string) => {
        const address = `http://192.0.2.7:40111/${String(++next).padStart(64, "0")}/${name}`
        shares.add(address)
        return address
    }
    const outlet: CastOutlet = {
        shareFile: async (path, toward) => {
            calls.push(`file ${path} toward ${toward}`)
            return share(path.split("/").pop() ?? "")
        },
        shareTorrent: async (infoHash, index, toward) => {
            calls.push(`torrent ${infoHash} ${index} toward ${toward}`)
            return share(`t${index}`)
        },
        unshare: async () => {
            calls.push("unshare")
            shares.clear()
        },
    }
    return { outlet, calls, shares }
}

const HASH = "0123456789abcdef0123456789abcdef01234567"
const TORRENT_URL = `http://127.0.0.1:38211/${"c".repeat(32)}/${HASH}/3/Folge%201.mkv`

describe("addresses the TV can reach (phase 7b: the outlet into the network)", () => {
    it("hands on a source of the network as it is", async () => {
        const { outlet, calls } = fakeOutlet()
        const environment = { castOutlet: async () => outlet }
        expect(castSource("https://cdn.example.com/v.mp4")).toEqual({ kind: "network", url: "https://cdn.example.com/v.mp4" })
        expect(await forward({ body: { host: "192.0.2.10", url: "http://192.0.2.5/v.mkv" } }, environment)).toBe("http://192.0.2.5/v.mkv")
        expect(await forwardClose(environment)).toBe(true)
        // nothing was shared, so nothing is asked of the device
        expect(calls).toEqual([])
    })

    it("tells a file, the torrent stream and the server's streams apart", () => {
        expect(castSource("file:///data/user/0/app/files/core-offline/1/e.mkv")).toEqual({ kind: "file", path: "file:///data/user/0/app/files/core-offline/1/e.mkv" })
        expect(castSource("/storage/emulated/0/Anime/e.mp4")).toEqual({ kind: "file", path: "/storage/emulated/0/Anime/e.mp4" })
        expect(castSource(TORRENT_URL)).toEqual({ kind: "torrent", infoHash: HASH, index: 3 })
        for (const url of ["http://127.0.0.1:43213/api/v1/mediastream/file", "http://localhost:8080/x", "http://[::1]/x"]) {
            expect(() => castSource(url), url).toThrow(DEVICE_STREAM)
        }
        expect(() => castSource("content://x/1")).toThrow("invalid-stream")
        expect(() => castSource("https://cdn.example.com/v.m3u8", { Referer: "https://example.com" })).toThrow(HEADERS_UNSUPPORTED)
        expect(castSource("https://cdn.example.com/v.m3u8", {})).toEqual({ kind: "network", url: "https://cdn.example.com/v.m3u8" })
    })

    it("shares a file for Google Cast toward the TV and ends the share with forward-close", async () => {
        const { outlet, calls, shares } = fakeOutlet()
        const environment = { castOutlet: async () => outlet }
        const address = await forward({ body: { host: "/192.0.2.20", url: "file:///data/app/files/e.mkv" } }, environment)
        expect(address).toMatch(/^http:\/\/192\.0\.2\.7:40111\/0{63}1\/e\.mkv$/)
        // another video: the last share ends first
        await forward({ body: { host: "192.0.2.20", url: TORRENT_URL } }, environment)
        expect(shares.size).toBe(1)
        await forwardClose(environment)
        expect(calls).toEqual(["file file:///data/app/files/e.mkv toward 192.0.2.20", "unshare", `torrent ${HASH} 3 toward 192.0.2.20`, "unshare"])
        expect(shares.size).toBe(0)
    })

    it("gives a DLNA TV the share and ends it with the session", async () => {
        const tv = fakeTv()
        const { outlet, calls, shares } = fakeOutlet()
        const environment = { ...tv.environment, castOutlet: async () => outlet }
        await found(tv)
        expect(await start({ body: { deviceId: "uuid:tv-1", url: "file:///data/app/files/e.mkv", title: "e", positionMs: 0 } }, environment)).toBe(true)
        const set = tv.calls.find(call => call.action === "SetAVTransportURI")
        expect(set?.body).toContain("http://192.0.2.7:40111/")
        // toward the TV's own address (from its control address)
        expect(calls).toContain("file file:///data/app/files/e.mkv toward 192.0.2.10")
        expect(await switchStream({ body: { url: TORRENT_URL } }, environment)).toBe(true)
        expect(shares.size).toBe(1)
        expect(await load({ body: { url: "https://cdn.example.com/v.mp4", title: "v", positionMs: 0 } }, environment)).toBe(true)
        expect(shares.size).toBe(0)
        expect(await load({ body: { url: "/data/app/files/f.mkv", title: "f", positionMs: 0 } }, environment)).toBe(true)
        expect(shares.size).toBe(1)
        await stop({ body: { resume: false } }, environment)
        expect(shares.size).toBe(0)
        expect(calls.at(-1)).toBe("unshare")
    })

    it("ends the share when the TV is stopped from outside", async () => {
        const tv = fakeTv()
        const { outlet, shares } = fakeOutlet()
        const environment = { ...tv.environment, castOutlet: async () => outlet }
        await found(tv)
        await start({ body: { deviceId: "uuid:tv-1", url: "file:///data/app/files/e.mkv", title: "e", positionMs: 0 } }, environment)
        await status(environment)
        expect(shares.size).toBe(1)
        tv.stopFromOutside()
        await status(environment)
        expect(shares.size).toBe(0)
    })

    it("ends the share when the TV stops answering", async () => {
        const tv = fakeTv({ deadAfterStart: true })
        const { outlet, shares } = fakeOutlet()
        const environment = { ...tv.environment, castOutlet: async () => outlet }
        await found(tv)
        await start({ body: { deviceId: "uuid:tv-1", url: "file:///data/app/files/e.mkv", title: "e", positionMs: 0 } }, environment)
        expect(shares.size).toBe(1)
        for (let i = 0; i < 5; i++) await status(environment)
        expect(shares.size).toBe(0)
    })

    it("refuses what it cannot share with a clear error, before the TV is asked", async () => {
        const tv = fakeTv()
        await found(tv)
        await expect(start({ body: { deviceId: "uuid:tv-1", url: "http://127.0.0.1:43213/x", title: "x", positionMs: 0 } }, tv.environment)).rejects.toThrow(DEVICE_STREAM)
        await expect(start({ body: { deviceId: "uuid:tv-1", url: "https://cdn.example.com/x", headers: { Referer: "r" }, title: "x", positionMs: 0 } }, tv.environment)).rejects.toThrow(HEADERS_UNSUPPORTED)
        // without the outlet a file cannot reach the TV
        await expect(start({ body: { deviceId: "uuid:tv-1", url: "file:///data/e.mkv", title: "x", positionMs: 0 } }, tv.environment)).rejects.toThrow(NO_OUTLET)
        expect(tv.calls).toEqual([])
    })
})
