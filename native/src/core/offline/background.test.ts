// geschrieben nach: docs/EIGENER-KERN.md §4o (Phase 4b-C1: Warteschlange, während die App nicht vorn ist; Bremse; Bilder und Angaben; Korrektur 4b-C1K: Hinweise vom Gerät, Datei-Abfragen als Wartezeit), den App-Typen MobileOffline_* (native/src/api/generated/types.ts), dem Vertrag des Laders (download/loader.ts), RFC 9110 §10.2.3 (Retry-After); erfundene Werte, keine echte Quelle; kein Server-Quelltext

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { sqlDriverFor } from "@/api/client/core-database"
import type { MobileOffline_Item } from "@/api/generated/types"
import { forgetDatabases, openDatabaseSync } from "../../../test/expo-sqlite"
import type { HttpFetch } from "../anilist/client"
import { type CoreDatabase, openCoreDatabase } from "../database/database"
import { anilistMedia } from "../database/schema"
import { type LoaderEvent, type LoaderRequest, LONGEST_SOURCE_PAUSE_MS, SOURCE_PAUSES_MS, readLoaderEvent, retryAfterMs, sourcePause } from "../download/loader"
import { LONGEST_PIECE_MS, createBlockingWatch } from "../blocking"
import {
    AT_ONCE, LONGEST_WAIT_MS, type OfflineDevice, type OfflineEnvironment, RETRY_PAUSES_MS, forgetOfflineService, offlineAction, offlineBatch,
    offlineDownload, offlineSnapshot,
} from "./offline"

const ROOT = "file:///data/user/0/app/files/core-offline"

/** The device after the contract, steered by the test: it notes what the core asks of it and sends what the test says */
function testDevice() {
    const listeners = new Set<(event: LoaderEvent) => void>()
    const wakers = new Set<() => void>()
    const state = {
        requests: [] as LoaderRequest[],
        /** What the core asked of the device beside the loader, in order: "notice finished 7-3-sub", "wake 15050", "wake null" */
        asked: [] as string[],
        removed: [] as string[],
        /** The addresses of the files that are there */
        files: new Set<string>(),
        send: (event: LoaderEvent) => listeners.forEach(listener => listener(event)),
        /** The device comes back after a wait, as its delayed work does */
        wake: () => wakers.forEach(listener => listener()),
    }
    const device: OfflineDevice = {
        loader: {
            enqueue: async request => void state.requests.push(request),
            cancel: async () => {},
            status: async () => null,
            forget: async () => {},
            listen: listener => {
                listeners.add(listener)
                return () => void listeners.delete(listener)
            },
        },
        root: ROOT,
        removeFolder: async address => void state.removed.push(address),
        network: async () => ({ known: true, connected: true, metered: false }),
        onNetwork: () => () => {},
        has: async address => state.files.has(address),
        notify: (item, outcome) => void state.asked.push(`notice ${outcome} ${item.id}`),
        wakeIn: ms => void state.asked.push(`wake ${ms}`),
        onWake: listener => {
            wakers.add(listener)
            return () => void wakers.delete(listener)
        },
    }
    return { ...state, device }
}

let now = 1_800_000_000_000
let database: Promise<CoreDatabase> | null = null
let t: ReturnType<typeof testDevice>
/** What the sources answer: a playlist, or a refusal with what it says in Retry-After */
let pages: Map<string, string | { status: number, retryAfter: string | null }>
/** The names of the pauses the core's work passed, in order */
let pauses: string[]

const fetchPage: HttpFetch = async url => {
    const page = pages.get(url)
    if (page === undefined) throw new TypeError("Network request failed")
    if (typeof page === "string") return { status: 200, headers: { get: () => null }, text: async () => page }
    return { status: page.status, headers: { get: name => name.toLowerCase() === "retry-after" ? page.retryAfter : null }, text: async () => "" }
}

const core = () => database ??= openCoreDatabase(sqlDriverFor(openDatabaseSync("core.db") as never), () => now)

/** An environment of the test's own (the watch of the app's thread): every request of the test goes through it */
let custom: OfflineEnvironment | null = null

function environment(): OfflineEnvironment {
    if (custom) return custom
    return {
        core: { fetch: fetchPage, now: () => now, pause: async part => void (part && pauses.push(part)), database: core },
        device: t.device,
        sources: async request => ({
            number: request.episodeNumber,
            videoSources: [{ server: "First", headers: { Referer: "https://stream.example/" }, url: `https://cdn.example/${request.episodeNumber}.mp4`, quality: "auto", type: "mp4", subtitles: [] }],
        }),
    }
}

const batch = (episodes: number[], more: Record<string, unknown> = {}) => ({
    mediaId: 105333, provider: "prov", dubbed: false, quality: "Auto", server: "First", title: "Some anime", coverUrl: "", bannerUrl: "",
    episodes: episodes.map(number => ({ number, title: `Title ${number}`, image: "", description: "" })), ...more,
})

const direct = (more: Record<string, unknown> = {}) => ({
    key: "", url: "https://cdn.example/direct.mp4", type: "mp4", headers: { Referer: "https://stream.example/" }, subtitles: [], mediaId: 7, episode: "3", dubbed: false,
    quality: "auto", title: "Other anime", coverUrl: "", bannerUrl: "", episodeTitle: "", episodeImageUrl: "", episodeDescription: "", ...more,
})

const itemOf = async (id: string) => (await offlineSnapshot(environment())).items.find(item => item.id === id)
/** The state is there, and what the queue does right after writing it (the next start, the wake, the pause) has had its turn */
const reaches = async (id: string, status: string) => {
    await vi.waitFor(async () => expect((await itemOf(id))?.status).toBe(status))
    for (let turn = 0; turn < 20; turn++) await Promise.resolve()
    await new Promise<void>(resolve => setImmediate(resolve))
}
const done = (id: string, bytes = 1000): LoaderEvent => ({ type: "done", id, bytes, resumedFrom: 0 })
const askedFor = (what: "notice" | "wake") => t.asked.filter(call => call.startsWith(`${what} `))

beforeEach(async () => {
    await forgetOfflineService()
    forgetDatabases()
    database = null
    now = 1_800_000_000_000
    t = testDevice()
    pages = new Map()
    pauses = []
    custom = null
})

afterEach(async () => {
    vi.useRealTimers()
    await forgetOfflineService()
})

describe("the queue while the app is not in front", () => {
    it("goes through three episodes by the loader's events alone, and the device shows each end notice", async () => {
        expect(AT_ONCE).toBe(2)
        expect(await offlineBatch(environment(), batch([1, 2, 3]))).toBe(3)
        await vi.waitFor(() => expect(t.requests.map(request => request.id)).toEqual(["105333-1-sub", "105333-2-sub"]))
        expect(askedFor("notice")).toEqual([])
        await reaches("105333-1-sub", "downloading")
        await reaches("105333-2-sub", "downloading")

        // from here on nothing asks the core: only the loader speaks
        t.send(done("105333-1-sub"))
        await vi.waitFor(() => expect(t.requests.map(request => request.id)).toEqual(["105333-1-sub", "105333-2-sub", "105333-3-sub"]))
        t.send(done("105333-2-sub"))
        await vi.waitFor(() => expect(pauses.filter(part => part === "offline: next")).toHaveLength(2))
        await reaches("105333-3-sub", "downloading")
        t.send(done("105333-3-sub"))
        await reaches("105333-3-sub", "ready")
        expect((await offlineSnapshot(environment())).items.map(item => item.status)).toEqual(["ready", "ready", "ready"])
        expect(askedFor("notice")).toEqual(["notice finished 105333-1-sub", "notice finished 105333-2-sub", "notice finished 105333-3-sub"])
    })

    it("shows the end notice with the app's timers standing still, and \"failed\" only once no try is left (4b-C1K)", async () => {
        // timers that never run, as while the app is not in front
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
        await offlineDownload(environment(), direct())
        await reaches("7-3-sub", "downloading")
        t.send(done("7-3-sub"))
        await reaches("7-3-sub", "ready")
        expect(askedFor("notice")).toEqual(["notice finished 7-3-sub"])

        await offlineDownload(environment(), direct({ episode: "4", url: "https://cdn.example/four.mp4" }))
        await reaches("7-4-sub", "downloading")
        // a broken connection gets another try: no notice
        t.send({ type: "failed", id: "7-4-sub", kind: "CONNECTION", httpStatus: null, message: "the connection broke" })
        await reaches("7-4-sub", "queued")
        expect(askedFor("notice")).toEqual(["notice finished 7-3-sub"])
        now += RETRY_PAUSES_MS[0]! + 51
        t.wake()
        await reaches("7-4-sub", "downloading")
        // the player's own address that is gone is not tried again: the episode has failed
        t.send({ type: "failed", id: "7-4-sub", kind: "SOURCE_REFUSED", httpStatus: 404, message: "not found" })
        await reaches("7-4-sub", "failed")
        expect(askedFor("notice")).toEqual(["notice finished 7-3-sub", "notice failed 7-4-sub"])
    })

    it("comes back to a failed episode by the device's wake, with the timer standing still", async () => {
        await offlineDownload(environment(), direct())
        await reaches("7-3-sub", "downloading")
        t.send({ type: "failed", id: "7-3-sub", kind: "CONNECTION", httpStatus: null, message: "the connection broke" })
        await reaches("7-3-sub", "queued")
        // the first pause of the queue, asked of the device as well as of the timer
        expect(askedFor("wake")).toEqual([`wake ${RETRY_PAUSES_MS[0]! + 50}`])
        expect(t.requests).toHaveLength(1)

        // the wait is over; no timer has run, no request of the app comes: the device speaks
        now += RETRY_PAUSES_MS[0]! + 51
        t.wake()
        await vi.waitFor(() => expect(t.requests).toHaveLength(2))
        expect(t.requests[1]).toMatchObject({ id: "7-3-sub", continueParts: true })
        // nothing waits any more
        await vi.waitFor(() => expect(askedFor("wake").at(-1)).toBe("wake null"))
        await reaches("7-3-sub", "downloading")
    })

    it("wakes too early for nothing: the episode keeps waiting", async () => {
        await offlineDownload(environment(), direct())
        await reaches("7-3-sub", "downloading")
        t.send({ type: "failed", id: "7-3-sub", kind: "CONNECTION", httpStatus: null, message: "the connection broke" })
        await reaches("7-3-sub", "queued")
        now += 1_000
        t.wake()
        await new Promise(resolve => setTimeout(resolve, 30))
        expect(t.requests).toHaveLength(1)
        expect(await itemOf("7-3-sub")).toMatchObject({ status: "queued" })
    })
})

describe("the brake for a source that limits requests", () => {
    it("reads Retry-After as seconds or as a date", () => {
        expect(retryAfterMs("5", now)).toBe(5_000)
        expect(retryAfterMs(" 120 ", now)).toBe(120_000)
        expect(retryAfterMs(new Date(now + 30_000).toUTCString(), now)).toBe(30_000)
        // a date that has passed: no wait
        expect(retryAfterMs(new Date(now - 30_000).toUTCString(), now)).toBe(0)
        for (const unreadable of [null, undefined, "", "soon", "-3", "1.5"]) expect(retryAfterMs(unreadable, now), String(unreadable)).toBeNull()
    })

    it("waits at least as long as the source asked, longer with every refusal in a row, and only for refusals of the moment", () => {
        expect(SOURCE_PAUSES_MS).toEqual([5_000, 15_000, 45_000])
        // 429 with a short Retry-After: the own pause is the longer one
        expect(sourcePause(429, 3_000, 0)).toBe(5_000)
        // the source asks for more than the own pause
        expect(sourcePause(429, 20_000, 0)).toBe(20_000)
        expect(sourcePause(503, null, 0)).toBe(5_000)
        expect(sourcePause(503, null, 1)).toBe(15_000)
        expect(sourcePause(408, null, 2)).toBe(45_000)
        // used up: the run gives the episode back to the queue
        expect(sourcePause(429, null, 3)).toBeNull()
        // the source asks for too long a wait to sit through inside a run
        expect(sourcePause(429, LONGEST_SOURCE_PAUSE_MS + 1, 0)).toBeNull()
        expect(sourcePause(429, LONGEST_SOURCE_PAUSE_MS, 0)).toBe(LONGEST_SOURCE_PAUSE_MS)
        // the address or its headers are wrong: waiting heals nothing
        for (const status of [401, 403, 404, 410]) expect(sourcePause(status, 1_000, 0), String(status)).toBeNull()
    })

    it("carries the wait of a refusal in the loader's event only when the source named one", () => {
        expect(readLoaderEvent("failed", { id: "a", kind: "SOURCE_REFUSED", httpStatus: 429, message: "HTTP 429", retryAfterMs: 7000 }))
            .toEqual({ type: "failed", id: "a", kind: "SOURCE_REFUSED", httpStatus: 429, message: "HTTP 429", retryAfterMs: 7000 })
        expect(readLoaderEvent("failed", { id: "a", kind: "SOURCE_REFUSED", httpStatus: 429, message: "HTTP 429" }))
            .toEqual({ type: "failed", id: "a", kind: "SOURCE_REFUSED", httpStatus: 429, message: "HTTP 429" })
    })

    it("keeps the queue's next try behind the wait the source asked for, and goes on where the loader was", async () => {
        await offlineDownload(environment(), direct())
        await reaches("7-3-sub", "downloading")
        // the loader's own pauses are used up, the source still says 429 and names 90 s
        t.send({ type: "failed", id: "7-3-sub", kind: "SOURCE_REFUSED", httpStatus: 429, message: "HTTP 429", retryAfterMs: 90_000 })
        await reaches("7-3-sub", "queued")
        expect(askedFor("wake")).toEqual(["wake 90050"])
        // the queue's own pause would be over, the source's wait is not
        now += RETRY_PAUSES_MS[0]! + 1_000
        t.wake()
        await new Promise(resolve => setTimeout(resolve, 30))
        expect(t.requests).toHaveLength(1)
        now += 90_000
        t.wake()
        await vi.waitFor(() => expect(t.requests).toHaveLength(2))
        // the same parts, what the loader finished is kept: no start from the beginning
        expect(t.requests[1]).toMatchObject({ continueParts: true, parts: t.requests[0]!.parts })
    })

    it("never waits longer than the queue's longest wait, and takes Retry-After of a refused playlist the same way", async () => {
        await offlineDownload(environment(), direct())
        await reaches("7-3-sub", "downloading")
        t.send({ type: "failed", id: "7-3-sub", kind: "SOURCE_REFUSED", httpStatus: 503, message: "HTTP 503", retryAfterMs: 3 * 60 * 60_000 })
        await reaches("7-3-sub", "queued")
        expect(askedFor("wake")).toEqual([`wake ${LONGEST_WAIT_MS + 50}`])

        pages.set("https://cdn.example/list.m3u8", { status: 429, retryAfter: "120" })
        await offlineDownload(environment(), direct({ episode: "4", url: "https://cdn.example/list.m3u8", type: "m3u8" }))
        await vi.waitFor(async () => expect(await itemOf("7-4-sub")).toMatchObject({ status: "queued" }))
        // the wake is asked for the nearer of the two waits
        await vi.waitFor(() => expect(askedFor("wake").at(-1)).toBe("wake 120050"))
        expect(t.requests).toHaveLength(1)
    })
})

describe("what is saved with an episode", () => {
    const COVER = "https://img.example/cover/large.png"
    const BANNER = "https://img.example/banner"
    const STILL = "https://img.example/stills/1.webp?size=big"

    it("takes the anime's details from the kept lists and loads its pictures as side files that may fail", async () => {
        await (await core()).insert(anilistMedia).values({
            anilistId: 105333, kind: "anime", changedAt: now,
            content: { id: 105333, description: "Stone and science.", genres: ["Adventure", "Sci-Fi", 7], seasonYear: 2019, format: "TV", episodes: 24, duration: 24, meanScore: 81 },
        })
        expect(await offlineBatch(environment(), batch([1], { coverUrl: COVER, bannerUrl: BANNER, episodes: [{ number: 1, title: "First", image: STILL, description: "It begins." }] }))).toBe(1)
        await reaches("105333-1-sub", "downloading")
        const queued: MobileOffline_Item = (await itemOf("105333-1-sub"))!
        expect(queued).toMatchObject({
            title: "Some anime", description: "Stone and science.", genres: ["Adventure", "Sci-Fi"], year: 2019, format: "TV", totalEpisodes: 24, duration: 24, score: 81,
            coverUrl: COVER, bannerUrl: BANNER, episodeTitle: "First", episodeImageUrl: STILL, episodeDescription: "It begins.", metadataSaved: false,
        })
        expect(queued.coverAsset).toBeUndefined()

        // the pictures come last, weigh nothing, go without the source's headers and may be passed over
        const parts = t.requests[0]!.parts!
        expect(parts.slice(-3)).toEqual([
            { url: COVER, path: `${ROOT}/artwork/105333-1-sub-cover.png`, weight: 0, extra: true },
            { url: BANNER, path: `${ROOT}/artwork/105333-1-sub-banner.jpg`, weight: 0, extra: true },
            { url: STILL, path: `${ROOT}/artwork/105333-1-sub-episode.webp`, weight: 0, extra: true },
        ])
        expect(parts.slice(0, -3).some(part => part.extra)).toBe(false)

        // the banner's source gave nothing: the episode is ready all the same, and says so
        t.files.add(`${ROOT}/artwork/105333-1-sub-cover.png`).add(`${ROOT}/artwork/105333-1-sub-episode.webp`)
        t.send(done("105333-1-sub", 5000))
        await reaches("105333-1-sub", "ready")
        const ready: MobileOffline_Item = (await itemOf("105333-1-sub"))!
        expect(ready).toMatchObject({ coverAsset: "105333-1-sub-cover.png", episodeImageAsset: "105333-1-sub-episode.webp", metadataSaved: false, bytes: 5000 })
        expect(ready.bannerAsset).toBeUndefined()

        await offlineAction(environment(), { id: "105333-1-sub", action: "remove" })
        expect(t.removed).toEqual([`${ROOT}/episodes/105333-1-sub`, `${ROOT}/artwork/105333-1-sub-cover.png`, `${ROOT}/artwork/105333-1-sub-banner.jpg`, `${ROOT}/artwork/105333-1-sub-episode.webp`])
    })

    it("counts as saved when every picture it names is on the device; an anime the lists do not hold brings no details", async () => {
        await offlineDownload(environment(), direct({ coverUrl: COVER, episodeImageUrl: STILL }))
        await reaches("7-3-sub", "downloading")
        expect(Object.keys((await itemOf("7-3-sub"))!).filter(key => ["description", "genres", "year", "format", "totalEpisodes", "duration", "score"].includes(key))).toEqual([])
        t.files.add(`${ROOT}/artwork/7-3-sub-cover.png`).add(`${ROOT}/artwork/7-3-sub-episode.webp`)
        t.send(done("7-3-sub"))
        await reaches("7-3-sub", "ready")
        expect(await itemOf("7-3-sub")).toMatchObject({ coverAsset: "7-3-sub-cover.png", episodeImageAsset: "7-3-sub-episode.webp", metadataSaved: true })

        // no pictures named: nothing is missing
        await offlineDownload(environment(), direct({ episode: "4" }))
        await reaches("7-4-sub", "downloading")
        expect(t.requests[1]!.parts).toEqual([{ url: "https://cdn.example/direct.mp4", path: `${ROOT}/episodes/7-4-sub/video.mp4` }])
        t.send(done("7-4-sub"))
        await reaches("7-4-sub", "ready")
        expect(await itemOf("7-4-sub")).toMatchObject({ metadataSaved: true })
    })

    it("names the language of a stream's own sound when it is the wanted one", async () => {
        const list = (count: number, name: string) => ["#EXTM3U", "#EXT-X-TARGETDURATION:4", ...Array.from({ length: count }, (_, index) => `#EXTINF:4.0,\n${name}-${index}.ts`), "#EXT-X-ENDLIST"].join("\n")
        pages.set("https://cdn.example/m/master.m3u8", [
            "#EXTM3U",
            "#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"aud\",NAME=\"Japanese\",LANGUAGE=\"ja-JP\",DEFAULT=YES,URI=\"audio.m3u8\"",
            "#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1920x1080,AUDIO=\"aud\"",
            "video.m3u8",
        ].join("\n"))
        // as many segments as a long episode has: the work on them is cut into pieces by the pauses below
        pages.set("https://cdn.example/m/video.m3u8", list(1500, "v"))
        pages.set("https://cdn.example/m/audio.m3u8", list(300, "a"))
        await offlineDownload(environment(), direct({ url: "https://cdn.example/m/master.m3u8", type: "m3u8" }))
        await reaches("7-3-sub", "downloading")
        expect(await itemOf("7-3-sub")).toMatchObject({ audioLanguage: "ja", files: { video: "video.ts", audio: "audio.ts" } })
        expect(t.requests[0]!.parts).toHaveLength(1800)
        // reading the lists, building the request and handing it to the loader are pieces of their own (one piece took 14.7 ms)
        expect(pauses).toEqual(["offline: playlist", "offline: sound parts", "offline: parts", "offline: request", "offline: loader"])
        // and so is the start of the next episode after the end of this one (14.8 ms)
        t.send(done("7-3-sub"))
        await reaches("7-3-sub", "ready")
        expect(pauses.at(-1)).toBe("offline: next")
    })
})

describe("the piece of an episode's end on the app's thread (4b-C1K)", () => {
    /**
     * The end of an episode as the app runs it: the loader's event enters the watch, the core's pauses are the watch's.
     * Each of the three file checks costs 4 ms: on the app's thread (as File.exists did until 4b-C1), or on the
     * module's thread while the core waits (a function of the loader's module, as now).
     */
    async function longestEndPiece(checks: "on the app's thread" | "a wait"): Promise<{ milliseconds: number, untils: string[] }> {
        const clock = { now: 0 }
        const pieces: { milliseconds: number, what: string, until: string }[] = []
        const watch = createBlockingWatch({ now: () => clock.now, onPiece: (milliseconds, what, where) => void pieces.push({ milliseconds, what, until: where.until }), free: () => new Promise<void>(resolve => setTimeout(resolve, 0)) })
        const check = (address: string) => {
            clock.now += 4
            return t.files.has(address)
        }
        const base = environment()
        custom = {
            ...base,
            core: { ...base.core, pause: watch.pause, unasked: async (what, work) => {
                watch.enter(what)
                try {
                    return await work()
                }
                finally {
                    watch.leave()
                }
            } },
            device: { ...t.device, has: checks === "a wait" ? watch.waiting(async address => (await Promise.resolve(), check(address)), "file check") : async address => check(address) },
        }
        await offlineDownload(environment(), direct({ coverUrl: "https://img.example/c.png", bannerUrl: "https://img.example/b.jpg", episodeImageUrl: "https://img.example/e.jpg" }))
        await reaches("7-3-sub", "downloading")
        for (const name of ["cover.png", "banner.jpg", "episode.jpg"]) t.files.add(`${ROOT}/artwork/7-3-sub-${name}`)
        pieces.length = 0
        t.send(done("7-3-sub"))
        await reaches("7-3-sub", "ready")
        expect(await itemOf("7-3-sub")).toMatchObject({ coverAsset: "7-3-sub-cover.png", metadataSaved: true })
        const ends = pieces.filter(piece => piece.what.startsWith("offline: event of the loader"))
        return { milliseconds: Math.max(...ends.map(piece => piece.milliseconds)), untils: ends.map(piece => piece.until) }
    }

    it("held the thread for the three checks in one piece before, and cuts the piece at each check now", async () => {
        const before = await longestEndPiece("on the app's thread")
        expect(before.milliseconds).toBeGreaterThan(LONGEST_PIECE_MS)
        await forgetOfflineService()
        forgetDatabases()
        database = null
        t = testDevice()
        custom = null
        const after = await longestEndPiece("a wait")
        expect(after.milliseconds).toBeLessThanOrEqual(LONGEST_PIECE_MS / 2)
        expect(after.untils.filter(until => until === "file check")).toHaveLength(3)
    })
})
