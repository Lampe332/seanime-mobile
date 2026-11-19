// geschrieben nach: docs/EIGENER-KERN.md §4q (Phase 6b-1); prüft die Hülle des Torrent-Moduls, die Form der Status-Ereignisse und den Prüf-Link
import { appLinkTarget } from "@/lib/app-links"
import { describe, expect, it, vi } from "vitest"
import { type TorrentFolders, type TorrentNative, TorrentError, base64UrlBytes, createTorrentClient, isInfoHash, isOutletAddress, isShareAddress, plainPath, readTorrentStatus, startLine, torrentDeviceFor } from "./core-torrent"

const HASH = "0123456789abcdef0123456789abcdef01234567"

const status = (over: Record<string, unknown> = {}) => ({
    infoHash: HASH, name: "test.bin", state: "downloading", error: "", hasMetadata: true, progress: 0.5, downRate: 1000, upRate: 0,
    peers: 1, seeds: 1, piecesHave: 100, pieces: 200, bytesDone: 500, bytesWanted: 1000,
    peersKnown: 4, dhtNodes: 120, trackersOk: 1, trackersFailed: 0, trackerError: "", webSeeds: 0, queuePosition: -1, ...over,
})

/** Stands in for the native module: records every call and answers what the test says */
function fakeNative(answers: Partial<Record<keyof TorrentNative, unknown>> = {}) {
    const calls: { name: string, args: unknown[] }[] = []
    let onStatus: (statuses: never[]) => void = () => {}
    const method = (name: keyof TorrentNative) => (...args: unknown[]) => {
        calls.push({ name, args })
        if (name === "start") onStatus = args[1] as typeof onStatus
        const answer = answers[name]
        return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)
    }
    const names: (keyof TorrentNative)[] = ["start", "stop", "addMagnet", "addTorrentFile", "remove", "files", "setFilePriority", "setSequential", "setPaused", "setQueued", "setLimits", "moveStorage", "setPieceDeadlines", "clearDeadlines", "status", "connectPeer", "shareFile", "shareTorrent", "unshare"]
    const native = Object.fromEntries(names.map(name => [name, method(name)])) as unknown as TorrentNative
    return { native, calls, send: (statuses: unknown) => onStatus(statuses as never[]) }
}

describe("torrent shell: what goes in", () => {
    it("pauses and resumes by the checked info hash (phase 6f)", async () => {
        const { native, calls } = fakeNative({})
        const client = createTorrentClient(native)
        await client.setPaused("AB".repeat(20), true)
        await client.setPaused("ab".repeat(20), false)
        expect(calls.filter(call => call.name === "setPaused").map(call => call.args)).toEqual([["ab".repeat(20), true], ["ab".repeat(20), false]])
        await expect(client.setPaused("nope", true)).rejects.toBeInstanceOf(TorrentError)
    })

    it("turns a folder's address into a plain path", () => {
        expect(plainPath("file:///data/user/0/app/files/core-torrent/")).toBe("/data/user/0/app/files/core-torrent")
        expect(plainPath("file:///data/user/0/app/my%20files")).toBe("/data/user/0/app/my files")
        expect(plainPath("/data/x/")).toBe("/data/x")
        expect(plainPath("/")).toBe("/")
        expect(() => plainPath("content://com.android.providers/tree/1")).toThrow(TorrentError)
        expect(() => plainPath("relative/folder")).toThrow(TorrentError)
    })

    it("reads base64url as bytes", () => {
        const bytes = Uint8Array.from({ length: 259 }, (_, index) => (index * 7 + 3) % 256)
        for (const length of [0, 1, 2, 3, 4, 257, 258, 259]) {
            const part = bytes.slice(0, length)
            expect([...(base64UrlBytes(Buffer.from(part).toString("base64url")) ?? [])]).toEqual([...part])
        }
        expect([...(base64UrlBytes("-_-_") ?? [])]).toEqual([0xfb, 0xff, 0xbf])
        expect([...(base64UrlBytes("QQ==") ?? [])]).toEqual([0x41])
        expect(base64UrlBytes("a+b/")).toBeNull()
        expect(base64UrlBytes("abcde")).toBeNull()
    })

    it("starts with every way of finding peers on unless said otherwise", async () => {
        const { native, calls } = fakeNative()
        const client = createTorrentClient(native)
        await client.start({ folder: "file:///data/app/files/core-torrent" })
        expect(calls[0]?.args[0]).toEqual({ folder: "/data/app/files/core-torrent", listenPort: 0, connections: 60, dht: true, lsd: true, trackers: true, pex: true, portMapping: true, utp: true })
        await client.start({ folder: "/data/s", listenPort: 6881, connections: 20, dht: false, lsd: false, trackers: false, pex: false, portMapping: false, utp: false })
        expect(calls[1]?.args[0]).toEqual({ folder: "/data/s", listenPort: 6881, connections: 20, dht: false, lsd: false, trackers: false, pex: false, portMapping: false, utp: false })
        await expect(client.start({ folder: "/data/s", listenPort: -1 })).rejects.toBeInstanceOf(TorrentError)
        await expect(client.start({ folder: "content://x" })).rejects.toBeInstanceOf(TorrentError)
        expect(calls).toHaveLength(2)
    })

    it("hands a torrent file over as exactly its bytes and answers the info hash in lower case", async () => {
        const { native, calls } = fakeNative({ addTorrentFile: HASH.toUpperCase(), addMagnet: HASH })
        const client = createTorrentClient(native)
        const whole = Uint8Array.from([9, 9, 1, 2, 3, 9])
        expect(await client.addTorrentFile(whole.subarray(2, 5), "file:///data/app/cache/t/")).toBe(HASH)
        const [buffer, folder] = calls[0]?.args ?? []
        expect(buffer).toBeInstanceOf(ArrayBuffer)
        expect([...new Uint8Array(buffer as ArrayBuffer)]).toEqual([1, 2, 3])
        expect(folder).toBe("/data/app/cache/t")
        await expect(client.addTorrentFile(new Uint8Array(0), "/data/t")).rejects.toThrow("empty")
        expect(await client.addMagnet(`magnet:?xt=urn:btih:${HASH}`, "/data/t")).toBe(HASH)
        await expect(client.addMagnet("https://example.org/a.torrent", "/data/t")).rejects.toThrow("no magnet link")
        expect(calls.map(call => call.name)).toEqual(["addTorrentFile", "addMagnet"])
    })

    it("checks info hashes and numbers before the module is asked", async () => {
        const { native, calls } = fakeNative()
        const client = createTorrentClient(native)
        await client.remove(HASH.toUpperCase(), true)
        expect(calls[0]).toEqual({ name: "remove", args: [HASH, true] })
        await client.setPieceDeadlines(HASH, 3, 4, 1000, 500)
        expect(calls[1]).toEqual({ name: "setPieceDeadlines", args: [HASH, 3, 4, 1000, 500] })
        await client.connectPeer(HASH, "127.0.0.1", 6881)
        expect(calls[2]).toEqual({ name: "connectPeer", args: [HASH, "127.0.0.1", 6881] })
        await expect(client.remove("abc", false)).rejects.toThrow("no info hash")
        await expect(client.setFilePriority(HASH, 0, 8)).rejects.toBeInstanceOf(TorrentError)
        await expect(client.setFilePriority(HASH, 1.5, 1)).rejects.toBeInstanceOf(TorrentError)
        await expect(client.setPieceDeadlines(HASH, -1, 4, 0, 0)).rejects.toBeInstanceOf(TorrentError)
        await expect(client.connectPeer(HASH, "127.0.0.1", 0)).rejects.toBeInstanceOf(TorrentError)
        await expect(client.connectPeer(HASH, "127.0.0.1", 70000)).rejects.toBeInstanceOf(TorrentError)
        expect(calls).toHaveLength(3)
        expect(isInfoHash(HASH)).toBe(true)
        expect(isInfoHash(HASH.toUpperCase())).toBe(false)
    })

    it("turns the module's rejections into TorrentError without the mark", async () => {
        const { native } = fakeNative({ files: new Error("ERR_TORRENT: the torrent has no file list yet"), stop: new Error("something else") })
        const client = createTorrentClient(native)
        await expect(client.files(HASH)).rejects.toThrow(/^the torrent has no file list yet$/)
        await expect(client.files(HASH)).rejects.toBeInstanceOf(TorrentError)
        await expect(client.stop()).rejects.toThrow("something else")
    })
})

describe("torrent shell: status", () => {
    it("reads one status and refuses what is none", () => {
        expect(readTorrentStatus(status())).toEqual(status())
        expect(readTorrentStatus(status({ infoHash: HASH.toUpperCase(), progress: 1.0000001 }))).toEqual(status({ progress: 1 }))
        expect(readTorrentStatus(status({ name: 5, error: null, hasMetadata: "yes" }))).toEqual(status({ name: "", error: "", hasMetadata: false }))
        for (const wrong of [null, "text", [], status({ infoHash: "abc" }), status({ state: "flying" }), status({ downRate: Number.NaN }), status({ pieces: -1 }), status({ bytesDone: "5" }), status({ progress: undefined })]) {
            expect(readTorrentStatus(wrong)).toBeNull()
        }
    })

    it("answers `status` checked and fails on an answer that is none", async () => {
        const good = createTorrentClient(fakeNative({ status: status({ state: "seeding", progress: 1 }) }).native)
        expect(await good.status(HASH)).toEqual(status({ state: "seeding", progress: 1 }))
        const bad = createTorrentClient(fakeNative({ status: { infoHash: HASH } }).native)
        await expect(bad.status(HASH)).rejects.toThrow("without a status")
    })

    it("hands the status of every second to each listener until it lets go", async () => {
        const { native, send } = fakeNative()
        const client = createTorrentClient(native)
        const seen: string[] = []
        const stopFirst = client.onStatus(statuses => seen.push(`a:${statuses.map(one => one.piecesHave).join(",")}`))
        const stopSecond = client.onStatus(statuses => seen.push(`b:${statuses.length}`))
        await client.start({ folder: "/data/s" })
        send([status({ piecesHave: 1 }), { broken: true }, status({ infoHash: HASH.replace("0", "f"), piecesHave: 2 })])
        // nothing readable, or no list at all: no call
        send([{ broken: true }])
        send("nothing")
        stopFirst()
        send([status({ piecesHave: 3 })])
        stopSecond()
        send([status({ piecesHave: 4 })])
        expect(seen).toEqual(["a:1,2", "b:2", "b:1"])
    })
})

describe("torrent self test link", () => {
    const file = Buffer.from("d4:infod6:lengthi1e4:name1:a12:piece lengthi16384e6:pieces20:aaaaaaaaaaaaaaaaaaaaee").toString("base64url")
    const sha256 = "ab".repeat(32)

    it("is read in the test and the scratch app only", () => {
        const query = `core?torrent=selftest&file=${file}&peer=127.0.0.1:6881&sha256=${sha256.toUpperCase()}&size=52428800`
        for (const [scheme, variant] of [["seanime-native", "test"], ["seanime-scratch", "scratch"]] as const) {
            expect(appLinkTarget(`${scheme}://${query}`, variant)).toEqual({ kind: "core-torrent-selftest", file, peerHost: "127.0.0.1", peerPort: 6881, sha256, size: 52428800 })
            expect(appLinkTarget(`${scheme}://core?torrent=selftest&file=${file}&peer=127.0.0.1:6881&sha256=${sha256}`, variant)).toEqual({ kind: "core-torrent-selftest", file, peerHost: "127.0.0.1", peerPort: 6881, sha256, size: null })
        }
        for (const scheme of ["seanime", "seanime-native", "seanime-scratch"]) expect(appLinkTarget(`${scheme}://${query}`, "release")).toBeNull()
    })

    it("search check: anime, episode (1 without), provider; test and scratch app only", () => {
        expect(appLinkTarget("seanime-native://core?torrent=search-check&media=105333&episode=1&provider=archive-org", "test")).toEqual({ kind: "core-torrent-search-check", mediaId: 105333, episodeNumber: 1, provider: "archive-org" })
        expect(appLinkTarget("seanime-scratch://core?torrent=search-check&media=105333", "scratch")).toEqual({ kind: "core-torrent-search-check", mediaId: 105333, episodeNumber: 1, provider: "" })
        expect(appLinkTarget("seanime-native://core?torrent=search-check", "test")).toBeNull()
        expect(appLinkTarget("seanime-native://core?torrent=search-check&media=1&provider=a%2Fb", "test")).toBeNull()
        expect(appLinkTarget("seanime://core?torrent=search-check&media=105333", "release")).toBeNull()
    })

    it("refuses a link without a file, a peer by address or a hash", () => {
        const link = (query: string) => appLinkTarget(`seanime-native://core?${query}`, "test")
        expect(link(`torrent=other&file=${file}&peer=127.0.0.1:6881&sha256=${sha256}`)).toBeNull()
        expect(link(`torrent=selftest&peer=127.0.0.1:6881&sha256=${sha256}`)).toBeNull()
        expect(link(`torrent=selftest&file=a%2Bb&peer=127.0.0.1:6881&sha256=${sha256}`)).toBeNull()
        expect(link(`torrent=selftest&file=${file}&peer=example.org:6881&sha256=${sha256}`)).toBeNull()
        expect(link(`torrent=selftest&file=${file}&peer=127.0.0.1:0&sha256=${sha256}`)).toBeNull()
        expect(link(`torrent=selftest&file=${file}&peer=127.0.0.1:70000&sha256=${sha256}`)).toBeNull()
        expect(link(`torrent=selftest&file=${file}&peer=127.0.0.1:6881&sha256=abc`)).toBeNull()
        expect(link(`torrent=selftest&file=${file}&peer=127.0.0.1:6881`)).toBeNull()
    })

    it("reads the stream check with its four parts, in the test and the scratch app only", () => {
        const part = (first: number, last: number) => `${first}-${last}.${sha256}`
        const parts = [part(0, 1023), part(5000, 6023), part(8976, 9999), part(3000, 4023)].join(",")
        const query = `core?torrent=stream-check&file=${file}&peer=127.0.0.1:6889&size=10000&parts=${parts}&media=4242`
        const read = [[0, 1023], [5000, 6023], [8976, 9999], [3000, 4023]].map(([first, last]) => ({ first, last, sha256 }))
        expect(appLinkTarget(`seanime-native://${query}`, "test")).toEqual({ kind: "core-torrent-stream-check", file, peerHost: "127.0.0.1", peerPort: 6889, size: 10000, parts: read, mediaId: 4242 })
        expect(appLinkTarget(`seanime-scratch://${query.replace("&media=4242", "")}`, "scratch")).toMatchObject({ kind: "core-torrent-stream-check", mediaId: 0 })
        expect(appLinkTarget(`seanime-native://${query}`, "release")).toBeNull()
        const link = (changed: string) => appLinkTarget(`seanime-native://${changed}`, "test")
        // three parts, a part beyond the file, a part backwards, no size, a peer by name
        expect(link(query.replace(`,${part(3000, 4023)}`, ""))).toBeNull()
        expect(link(query.replace(part(8976, 9999), part(8976, 10000)))).toBeNull()
        expect(link(query.replace(part(5000, 6023), part(6023, 5000)))).toBeNull()
        expect(link(query.replace("&size=10000", ""))).toBeNull()
        expect(link(query.replace("127.0.0.1:6889", "example.org:6889"))).toBeNull()
    })
})

describe("the outlet's address", () => {
    const address = `http://127.0.0.1:40123/${"0f".repeat(16)}/${"ab".repeat(20)}/0/Test%20-%2001.mp4`

    it("is asked of the module and must be a loopback address behind a token", async () => {
        const served: unknown[][] = []
        const serving = (answer: string) => createTorrentClient({ ...fakeNative().native, serve: async (...args: unknown[]) => (served.push(args), answer) } as TorrentNative)
        expect(await serving(address).serve("AB".repeat(20), 0)).toBe(address)
        expect(served).toEqual([["ab".repeat(20), 0]])
        expect(isOutletAddress(address)).toBe(true)
        for (const other of [address.replace("127.0.0.1", "192.168.1.5"), address.replace("http:", "https:"), address.replace("0f".repeat(16), "0f"), `${address}?x=1`, "http://127.0.0.1:40123/"]) {
            expect(isOutletAddress(other)).toBe(false)
            await expect(serving(other).serve("ab".repeat(20), 0)).rejects.toBeInstanceOf(TorrentError)
        }
        await expect(serving(address).serve("nothing", 0)).rejects.toBeInstanceOf(TorrentError)
        await expect(serving(address).serve("ab".repeat(20), 1.5)).rejects.toBeInstanceOf(TorrentError)
    })
})

describe("the device's side: the start in numbers and cleaning up (phase 6b-3)", () => {
    const short = `${HASH.slice(0, 8)}…`
    const watch = { waiting: (work: unknown) => work } as never
    /** The app's file system: a streams' folder with these entries, until it is deleted */
    const foldersWith = (entries: string[]) => {
        const deleted: string[] = []
        const folders: TorrentFolders = {
            cacheDirectory: "file:///cache/", documentDirectory: "file:///docs/",
            getInfoAsync: async () => ({ exists: true }),
            readDirectoryAsync: async () => [...entries],
            deleteAsync: async address => {
                deleted.push(address)
                entries.length = 0
            },
        }
        return { deleted, folders: async () => folders }
    }
    /** What the device wrote into the app's log while `work` ran */
    const logged = async (work: () => Promise<void>) => {
        const lines: string[] = []
        const spy = vi.spyOn(console, "log").mockImplementation((...data: unknown[]) => void lines.push(data.join(" ")))
        try {
            await work()
        }
        finally {
            spy.mockRestore()
        }
        return lines.filter(line => line.includes("torrent:")).map(line => line.replace("[Core] info ", ""))
    }

    it("reads the numbers of the ways to peers; a module without them counts as 0", () => {
        const old: Record<string, unknown> = status()
        for (const name of ["peersKnown", "dhtNodes", "trackersOk", "trackersFailed", "trackerError", "webSeeds"]) delete old[name]
        expect(readTorrentStatus(old)).toEqual(status({ peersKnown: 0, dhtNodes: 0, trackersOk: 0, trackersFailed: 0, trackerError: "", webSeeds: 0 }))
        expect(readTorrentStatus(status({ dhtNodes: -1, trackerError: 7 }))).toEqual(status({ dhtNodes: 0, trackerError: "" }))
        expect(startLine(readTorrentStatus(status({ hasMetadata: false, peers: 0, seeds: 0, peersKnown: 3, dhtNodes: 87, trackersOk: 1, trackersFailed: 2, downRate: 0 }))!, 2_400))
            .toBe(`torrent: start ${short} 2 s: peers 0/3, seeds 0, dht 87, trackers 1 ok 2 failed, web seeds 0, metadata no, 0 B/s`)
    })

    it("logs one line of numbers per second from adding a torrent until its first bytes are there", async () => {
        const { native, send } = fakeNative({ addMagnet: HASH })
        const device = torrentDeviceFor(watch, async () => createTorrentClient(native), foldersWith([]).folders)
        const waiting = status({ hasMetadata: false, peers: 0, seeds: 0, peersKnown: 3, dhtNodes: 87, trackersOk: 0, trackersFailed: 1, trackerError: "certificate verify failed", downRate: 0, bytesDone: 0, bytesWanted: 0 })
        const lines = await logged(async () => {
            await device.addMagnet(`magnet:?xt=urn:btih:${HASH}&tr=https%3A%2F%2Ftracker.example%2Fannounce&ws=https%3A%2F%2Ffiles.example%2F`)
            send([waiting])
            send([status({ infoHash: HASH.replace("0", "f") })])
            send([{ ...waiting, peers: 2, trackersOk: 1 }])
            // the file list is there, nothing loaded yet: still starting
            send([{ ...waiting, hasMetadata: true, peers: 2, bytesWanted: 1000 }])
            send([status({ downRate: 2048, peersKnown: 9 })])
            // started: no further line
            send([status()])
            await device.stop()
        })
        expect(lines).toEqual([
            `torrent: magnet added (${short}, trackers 1, web seeds 1)`,
            `torrent: start ${short} 0 s: peers 0/3, seeds 0, dht 87, trackers 0 ok 1 failed, web seeds 0, metadata no, 0 B/s`,
            `torrent: a tracker of ${short} failed: certificate verify failed`,
            `torrent: start ${short} 0 s: peers 2/3, seeds 0, dht 87, trackers 1 ok 1 failed, web seeds 0, metadata no, 0 B/s`,
            `torrent: start ${short} 0 s: peers 2/3, seeds 0, dht 87, trackers 0 ok 1 failed, web seeds 0, metadata yes, 0 B/s`,
            `torrent: start ${short} 0 s: peers 1/9, seeds 1, dht 120, trackers 1 ok 0 failed, web seeds 0, metadata yes, 2048 B/s`,
            "torrent: session stopped; 0 entries left in the folder",
        ])
    })

    it("says what is left in the streams' folder after a removal, also a refused one, and clears it when the session ends", async () => {
        const { native, calls } = fakeNative({ addMagnet: HASH })
        const { deleted, folders } = foldersWith([".parts", "Show"])
        const device = torrentDeviceFor(watch, async () => createTorrentClient(native), folders)
        const refusing = fakeNative({ addMagnet: HASH, remove: new Error("ERR_TORRENT: the files cannot be deleted: busy") })
        const lines = await logged(async () => {
            await device.addMagnet(`magnet:?xt=urn:btih:${HASH}`)
            await device.remove(HASH, true)
            await device.stop()
            const other = torrentDeviceFor(watch, async () => createTorrentClient(refusing.native), foldersWith(["Show"]).folders)
            await other.addMagnet(`magnet:?xt=urn:btih:${HASH}`)
            await expect(other.remove(HASH, true)).rejects.toThrow("the files cannot be deleted: busy")
            await other.stop()
        })
        expect(calls.map(call => call.name)).toEqual(["start", "addMagnet", "remove", "stop"])
        expect(deleted).toEqual(["file:///cache/core-torrent-streams"])
        expect(lines).toEqual([
            `torrent: magnet added (${short}, trackers 0, web seeds 0)`,
            `torrent: ${short} removed with its files; 2 entries left in the folder`,
            "torrent: session stopped; 2 entries left in the folder, folder cleared: 0 entries left in the folder",
            `torrent: magnet added (${short}, trackers 0, web seeds 0)`,
            `torrent: ${short} could not be removed (the files cannot be deleted: busy); 1 entries left in the folder`,
            "torrent: session stopped; 1 entries left in the folder, folder cleared: 0 entries left in the folder",
        ])
    })

    it("leaves a folder the user chose alone", async () => {
        const { native } = fakeNative({ addMagnet: HASH })
        const { deleted, folders } = foldersWith(["Show"])
        const device = torrentDeviceFor(watch, async () => createTorrentClient(native), folders)
        device.useSettings?.({ downloadDir: "/storage/emulated/0/Download/streams", listenPort: 0 })
        const lines = await logged(async () => {
            await device.addMagnet(`magnet:?xt=urn:btih:${HASH}`)
            await device.stop()
        })
        expect(deleted).toEqual([])
        expect(lines.at(-1)).toBe("torrent: session stopped; 1 entries left in the folder")
    })
})

describe("torrent shell: shares into the network (phase 7b)", () => {
    const TOKEN = "ab".repeat(32)

    it("knows a share's address: a device address, a token of 64 hex digits, the name", () => {
        expect(isShareAddress(`http://192.0.2.7:40111/${TOKEN}/Folge%201.mkv`)).toBe(true)
        expect(isShareAddress(`http://127.0.0.1:40111/${TOKEN}/x.mkv`)).toBe(false)
        expect(isShareAddress(`http://192.0.2.7:40111/${TOKEN.slice(2)}/x.mkv`)).toBe(false)
        expect(isShareAddress(`http://192.0.2.7:40111/${TOKEN}/a/b.mkv`)).toBe(false)
    })

    it("hands the module plain paths and checks its answers", async () => {
        const { native, calls } = fakeNative({ shareFile: `http://192.0.2.7:40111/${TOKEN}/x.mkv`, shareTorrent: "http://127.0.0.1:1/x" })
        const client = createTorrentClient(native)
        expect(await client.shareFile("file:///data/app/files/core-offline/x%201.mkv", "192.0.2.10")).toBe(`http://192.0.2.7:40111/${TOKEN}/x.mkv`)
        expect(calls[0]).toEqual({ name: "shareFile", args: ["/data/app/files/core-offline/x 1.mkv", "192.0.2.10"] })
        // the player's own address is no share
        await expect(client.shareTorrent(HASH.toUpperCase(), 2, "")).rejects.toThrow("without an address in the network")
        expect(calls[1]).toEqual({ name: "shareTorrent", args: [HASH, 2, ""] })
        await expect(client.shareTorrent("nohash", 0, "")).rejects.toBeInstanceOf(TorrentError)
        await client.unshare()
        expect(calls.map(call => call.name)).toEqual(["shareFile", "shareTorrent", "unshare"])
    })
})

describe("limits, the download queue and moving files (4.2.0)", () => {
    const watch = { waiting: (work: unknown) => work } as never
    const folders = async (): Promise<TorrentFolders> => ({
        cacheDirectory: "file:///cache/", documentDirectory: "file:///docs/",
        getInfoAsync: async () => ({ exists: false }), readDirectoryAsync: async () => [], deleteAsync: async () => undefined,
    })
    const LIMITS = { downloadLimit: 512 * 1024, uploadLimit: 64 * 1024, activeDownloads: 2, stopWhenFinished: true }
    const quiet = async (work: () => Promise<void>) => {
        const spy = vi.spyOn(console, "log").mockImplementation(() => {})
        try {
            await work()
        }
        finally {
            spy.mockRestore()
        }
    }

    it("hands the module checked limits, the queue flag and a plain path to move to", async () => {
        const { native, calls } = fakeNative({})
        const client = createTorrentClient(native)
        await client.setLimits(LIMITS)
        await client.setQueued(HASH.toUpperCase(), true)
        await client.moveStorage(HASH, "file:///storage/emulated/0/Anime/My%20Show/")
        expect(calls).toEqual([
            { name: "setLimits", args: [LIMITS] },
            { name: "setQueued", args: [HASH, true] },
            { name: "moveStorage", args: [HASH, "/storage/emulated/0/Anime/My Show"] },
        ])
        for (const wrong of [{ activeDownloads: 0 }, { activeDownloads: 1.5 }, { downloadLimit: -1 }, { uploadLimit: Number.NaN }]) {
            await expect(client.setLimits({ ...LIMITS, ...wrong })).rejects.toBeInstanceOf(TorrentError)
        }
        await expect(client.setQueued("nope", true)).rejects.toBeInstanceOf(TorrentError)
        await expect(client.moveStorage(HASH, "content://tree/1")).rejects.toBeInstanceOf(TorrentError)
        expect(calls).toHaveLength(3)
    })

    it("tells a failed move as the module words it", async () => {
        const client = createTorrentClient(fakeNative({ moveStorage: new Error("ERR_TORRENT: the files cannot be moved: No space left on device") }).native)
        await expect(client.moveStorage(HASH, "/storage/emulated/0/Anime")).rejects.toThrow(/^the files cannot be moved: No space left on device$/)
    })

    it("reads a waiting torrent and its place in the queue; a module without the queue says -1", () => {
        expect(readTorrentStatus(status({ state: "queued", queuePosition: 2 }))).toEqual(status({ state: "queued", queuePosition: 2 }))
        const old: Record<string, unknown> = status()
        delete old.queuePosition
        expect(readTorrentStatus(old)?.queuePosition).toBe(-1)
    })

    it("refuses to move files to a path with . or .. in it, or into the running session's own folder", async () => {
        const { native, calls } = fakeNative({})
        const client = createTorrentClient(native)
        for (const wrong of ["/storage/emulated/0/Anime/../../../data/data/other", "/storage/emulated/0/..", "file:///storage/emulated/0/Anime/%2E%2E/x", "/storage/./Anime", "/.."]) {
            await expect(client.moveStorage(HASH, wrong), wrong).rejects.toThrow(/plain path, without \. or \.\./)
        }
        // names that only look alike are folders like any other
        await client.moveStorage(HASH, "/storage/emulated/0/Anime/..hidden/Show.../")
        expect(calls).toEqual([{ name: "moveStorage", args: [HASH, "/storage/emulated/0/Anime/..hidden/Show..."] }])

        await client.start({ folder: "file:///data/user/0/app/files/core-torrent/" })
        for (const inside of ["/data/user/0/app/files/core-torrent", "/data/user/0/app/files/core-torrent/", "file:///data/user/0/app/files/core-torrent/resume"]) {
            await expect(client.moveStorage(HASH, inside), inside).rejects.toThrow(/session's own folder/)
        }
        // a folder beside it whose name only starts the same
        await client.moveStorage(HASH, "/data/user/0/app/files/core-torrent-streams")
        expect(calls.filter(call => call.name === "moveStorage")).toHaveLength(2)
        // without a session there is no such folder
        await client.stop()
        await client.moveStorage(HASH, "/data/user/0/app/files/core-torrent")
        expect(calls.filter(call => call.name === "moveStorage")).toHaveLength(3)
    })

    it("never queues a torrent when it adds it (a waiting magnet link gets no file list); the core asks for the queue", async () => {
        const { native, calls } = fakeNative({ addMagnet: HASH })
        const device = torrentDeviceFor(watch, async () => createTorrentClient(native), folders)
        await quiet(async () => {
            await device.addMagnet(`magnet:?xt=urn:btih:${HASH}`)
            await device.addMagnet(`magnet:?xt=urn:btih:${HASH}`, "/storage/emulated/0/Anime/Show")
            expect(calls.map(call => call.name)).toEqual(["start", "addMagnet", "addMagnet"])
            await device.setQueued?.(HASH, true)
            await device.setQueued?.(HASH, false)
            await device.stop()
        })
        expect(calls.map(call => call.name)).toEqual(["start", "addMagnet", "addMagnet", "setQueued", "setQueued", "stop"])
        expect(calls[3].args).toEqual([HASH, true])
        expect(calls[4].args).toEqual([HASH, false])
    })

    it("tells a torrent the module cannot queue as the module words it", async () => {
        const { native } = fakeNative({ addMagnet: HASH, setQueued: new Error("ERR_TORRENT: the session has no such torrent") })
        const device = torrentDeviceFor(watch, async () => createTorrentClient(native), folders)
        await quiet(async () => {
            await device.addMagnet(`magnet:?xt=urn:btih:${HASH}`, "/storage/emulated/0/Anime/Show")
            await expect(device.setQueued?.(HASH, true)).rejects.toThrow(/^the session has no such torrent$/)
            await device.stop()
        })
    })

    it("tells a session its limits when it starts and again only when they change; no session starts for them", async () => {
        const { native, calls } = fakeNative({ addMagnet: HASH })
        const device = torrentDeviceFor(watch, async () => createTorrentClient(native), folders)
        const told = () => calls.filter(call => call.name === "setLimits").map(call => call.args[0])
        await quiet(async () => {
            await device.useLimits?.(LIMITS)
            expect(calls).toEqual([])
            await device.addMagnet(`magnet:?xt=urn:btih:${HASH}`)
            expect(calls.map(call => call.name)).toEqual(["start", "setLimits", "addMagnet"])
            await device.useLimits?.({ ...LIMITS })
            expect(told()).toEqual([LIMITS])
            await device.useLimits?.({ ...LIMITS, downloadLimit: 0 })
            expect(told()).toEqual([LIMITS, { ...LIMITS, downloadLimit: 0 }])
            // the next session hears them again
            await device.stop()
            await device.addMagnet(`magnet:?xt=urn:btih:${HASH}`)
            expect(told()).toHaveLength(3)
            await device.stop()
        })
    })

    it("asks again after limits the module refused", async () => {
        const { native, calls } = fakeNative({ addMagnet: HASH, setLimits: new Error("ERR_TORRENT: the limits are out of range") })
        const device = torrentDeviceFor(watch, async () => createTorrentClient(native), folders)
        await quiet(async () => {
            await device.useLimits?.(LIMITS)
            await device.addMagnet(`magnet:?xt=urn:btih:${HASH}`)
            await device.useLimits?.(LIMITS)
            await device.stop()
        })
        expect(calls.filter(call => call.name === "setLimits")).toHaveLength(2)
    })
})
