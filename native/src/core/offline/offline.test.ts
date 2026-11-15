// geschrieben nach: den App-Typen MobileOffline_* (native/src/api/generated/types.ts: Form von Snapshot, Item und Ereignis), dem Vertrag des Laders (download/loader.ts) und docs/EIGENER-KERN.md §4o (Phase 4b-B: Warteschlange, Zustände, Fehlerklassen, WLAN-Regel, Fortsetzen); erfundene Werte, keine echte Quelle; kein Server-Quelltext

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { sqlDriverFor } from "@/api/client/core-database"
import type { MobileOffline_Item, MobileOffline_Snapshot } from "@/api/generated/types"
import { forgetDatabases, openDatabaseSync } from "../../../test/expo-sqlite"
import type { HttpFetch } from "../anilist/client"
import { type CoreDatabase, openCoreDatabase } from "../database/database"
import { offlineItems } from "../database/schema"
import type { LoaderEvent, LoaderRequest, LoaderStatus } from "../download/loader"
import { CoreError } from "../errors"
import { type CoreEvent, onCoreEvent } from "../events"
import { matchCoreRoute } from "../registry"
import { patchAppSwitches } from "../settings/incognito"
import { firstStart } from "../settings/settings"
import {
    AT_ONCE, OFFLINE_EVENT, OFFLINE_FAILURES, type OfflineDevice, type OfflineEnvironment, type OfflineNetwork, RETRY_PAUSES_MS, forgetOfflineService,
    offlineAction, offlineBatch, offlineDownload, offlineFileAddress, offlineNetwork, offlinePosition, offlineSnapshot, setOfflineSettings,
} from "./offline"

const ROOT = "file:///data/user/0/app/files/core-offline"
const WIFI: OfflineNetwork = { known: true, connected: true, metered: false }
const MOBILE: OfflineNetwork = { known: true, connected: true, metered: true }

/** The device after the contract, steered by the test: it notes what the core asks of the loader and sends what the test says */
function testDevice() {
    const listeners = new Set<(event: LoaderEvent) => void>()
    const networkListeners = new Set<(network: OfflineNetwork) => void>()
    const state = {
        calls: [] as string[],
        requests: [] as LoaderRequest[],
        statuses: new Map<string, LoaderStatus>(),
        removed: [] as string[],
        network: WIFI,
        send: (event: LoaderEvent) => listeners.forEach(listener => listener(event)),
        setNetwork(network: OfflineNetwork) {
            state.network = network
            networkListeners.forEach(listener => listener(network))
        },
    }
    const device: OfflineDevice = {
        loader: {
            enqueue: async request => {
                state.requests.push(request)
                state.calls.push(`enqueue ${request.id}`)
            },
            cancel: async id => void state.calls.push(`cancel ${id}`),
            status: async id => state.statuses.get(id) ?? null,
            forget: async id => void state.calls.push(`forget ${id}`),
            listen: listener => {
                listeners.add(listener)
                return () => void listeners.delete(listener)
            },
        },
        root: ROOT,
        removeFolder: async address => void state.removed.push(address),
        network: async () => state.network,
        onNetwork: listener => {
            networkListeners.add(listener)
            return () => void networkListeners.delete(listener)
        },
    }
    return { ...state, state, device }
}

let now = 1_800_000_000_000
let database: Promise<CoreDatabase> | null = null
let t: ReturnType<typeof testDevice>
/** What the sources answer: an address's playlist, a status, or nothing (the connection fails) */
let pages: Map<string, string | number>
let asked: { episodeNumber: number, refresh: boolean }[]
let events: CoreEvent[]
let endEvents = () => {}

const fetchPage: HttpFetch = async url => {
    const page = pages.get(url)
    if (page === undefined) throw new TypeError("Network request failed")
    return { status: typeof page === "number" ? page : 200, headers: { get: () => null }, text: async () => (typeof page === "number" ? "" : page) }
}

function environment(): OfflineEnvironment {
    return {
        core: { fetch: fetchPage, now: () => now, pause: async () => {}, database: () => database ??= openCoreDatabase(sqlDriverFor(openDatabaseSync("core.db") as never), () => now) },
        device: t.device,
        sources: async request => {
            asked.push({ episodeNumber: request.episodeNumber, refresh: request.refresh })
            if (request.episodeNumber === 99) throw new CoreError("prov: episode 99 not found", 404)
            return {
                number: request.episodeNumber,
                videoSources: [
                    { server: "Second", headers: {}, url: `https://second.example/${request.episodeNumber}.mp4`, quality: "auto", type: "mp4", subtitles: [] },
                    { server: "First", headers: { Referer: "https://stream.example/" }, url: `https://cdn.example/${request.episodeNumber}-720.mp4`, quality: "720p", type: "mp4", subtitles: [] },
                    { server: "First", headers: { Referer: "https://stream.example/" }, url: `https://cdn.example/${request.episodeNumber}.mp4`, quality: "auto", type: "mp4",
                        subtitles: [{ url: "https://cdn.example/en.vtt", language: "English", isDefault: true }, { url: "https://cdn.example/de.ass?x=1", language: "German", isDefault: false }] },
                ],
            }
        },
    }
}

const batch = (episodes: number[], more: Record<string, unknown> = {}) => ({
    mediaId: 105333, provider: "prov", dubbed: false, quality: "Auto", server: "First", title: "Some anime", coverUrl: "https://img.example/cover.jpg", bannerUrl: "",
    episodes: episodes.map(number => ({ number, title: `Title ${number}`, image: "", description: "" })), ...more,
})

const direct = (more: Record<string, unknown> = {}) => ({
    key: "", url: "https://cdn.example/direct.mp4", type: "mp4", headers: { Referer: "https://stream.example/" }, subtitles: [], mediaId: 7, episode: "3", dubbed: false,
    quality: "auto", title: "Other anime", coverUrl: "", bannerUrl: "", episodeTitle: "", episodeImageUrl: "", episodeDescription: "", ...more,
})

const itemOf = async (id: string) => (await offlineSnapshot(environment())).items.find(item => item.id === id)
const statusOf = async (id: string) => (await itemOf(id))?.status
const reaches = (id: string, status: string) => vi.waitFor(async () => expect(await statusOf(id)).toBe(status))
/** A request that looks at the queue again, as any change of it does */
const lookAgain = () => offlineBatch(environment(), batch([]))
const failedEvent = (id: string, kind: "CONNECTION" | "STORAGE_FULL" | "SOURCE_REFUSED" | "CANCELLED" | "UNKNOWN", httpStatus: number | null = null): LoaderEvent => ({ type: "failed", id, kind, httpStatus, message: `${kind} happened` })

beforeEach(async () => {
    await forgetOfflineService()
    forgetDatabases()
    database = null
    now = 1_800_000_000_000
    t = testDevice()
    pages = new Map()
    asked = []
    events = []
    endEvents = onCoreEvent(event => void events.push(event))
})

afterEach(async () => {
    endEvents()
    await forgetOfflineService()
})

/** Every field of the app's type; true: the app's type demands it */
const ITEM_FORM = {
    id: true, key: true, status: true, ready: true, mediaId: true, provider: true, episode: true, dubbed: true, quality: true, server: true, audioLanguage: true,
    progress: true, bytes: true, position: true, failure: false, error: false, files: true, order: true, title: false, description: false, genres: false, year: false,
    format: false, totalEpisodes: false, duration: false, score: false, coverUrl: false, bannerUrl: false, episodeTitle: false, episodeImageUrl: false,
    episodeDescription: false, airDate: false, coverAsset: false, bannerAsset: false, episodeImageAsset: false, metadataSaved: true,
} satisfies Record<keyof MobileOffline_Item, boolean>

function expectItemForm(item: object) {
    const form: Record<string, boolean> = ITEM_FORM
    expect(Object.keys(item).filter(key => !(key in form)), "fields the app does not know").toEqual([])
    expect(Object.keys(form).filter(key => form[key] && !(key in item)), "fields the app demands").toEqual([])
}

describe("the form of the answers", () => {
    it("is the one the screens know: snapshot, item and the event with the whole snapshot", async () => {
        const item: MobileOffline_Item = await offlineDownload(environment(), direct({ title: "Other anime", episodeTitle: "The third" }))
        expectItemForm(item)
        // its turn has come at once: the queue was empty
        expect(["queued", "resolving"]).toContain(item.status)
        expect(item).toMatchObject({ id: "7-3-sub", key: "7-3-sub", ready: false, mediaId: 7, episode: "3", dubbed: false, progress: 0, bytes: 0, position: 0, files: {}, order: 1, title: "Other anime", episodeTitle: "The third", metadataSaved: false })
        await reaches("7-3-sub", "downloading")
        const snapshot: MobileOffline_Snapshot = await offlineSnapshot(environment())
        expect(Object.keys(snapshot).sort()).toEqual(["items", "network", "waiting", "wifiOnly"])
        expect(snapshot).toMatchObject({ wifiOnly: false, network: { known: true, connected: true, metered: false }, waiting: "" })
        for (const entry of snapshot.items ?? []) expectItemForm(entry)

        await vi.waitFor(() => expect(events.some(event => event.type === OFFLINE_EVENT && (event.payload as MobileOffline_Snapshot).items?.[0]?.status === "downloading")).toBe(true))
        const last = events.filter(event => event.type === OFFLINE_EVENT).at(-1)!.payload as MobileOffline_Snapshot
        expect(last).toEqual(JSON.parse(JSON.stringify(snapshot)))
        expect(OFFLINE_EVENT).toBe("mobile-offline-updated")
        expect([...OFFLINE_FAILURES].sort()).toEqual(["CONNECTION", "SOURCE_REFUSED", "SOURCE_UNAVAILABLE", "STORAGE_FULL", "UNKNOWN"])
    })

    it("are the interfaces of the area offline", () => {
        for (const [method, endpoint] of [["GET", "snapshot"], ["POST", "batch"], ["POST", "download"], ["POST", "action"], ["POST", "settings"], ["POST", "position"], ["POST", "network"]]) {
            expect(matchCoreRoute(method!, `/api/v1/mobile-offline/${endpoint}`)?.route.area, endpoint).toBe("offline")
        }
    })

    it("gives the player the file itself once the core looked at its downloads", async () => {
        await offlineSnapshot(environment())
        expect(offlineFileAddress("7-3-sub", "video.ts")).toBe(`${ROOT}/episodes/7-3-sub/video.ts`)
    })
})

describe("the queue", () => {
    it("keeps the order, loads at most a few at once and gives a free place to the next", async () => {
        expect(await offlineBatch(environment(), batch([3, 1, 2, 4]))).toBe(4)
        await vi.waitFor(() => expect(t.requests).toHaveLength(AT_ONCE))
        const snapshot = await offlineSnapshot(environment())
        expect(snapshot.items.map(item => [item.episode, item.order, item.status])).toEqual([["3", 1, "downloading"], ["1", 2, "downloading"], ["2", 3, "queued"], ["4", 4, "queued"]])
        expect(asked.map(request => request.episodeNumber)).toEqual([3, 1])
        // already there: not queued twice, whoever asks
        expect(await offlineBatch(environment(), batch([1, 2, 5]))).toBe(1)

        t.send({ type: "progress", id: "105333-3-sub", bytes: 4096, total: null, fraction: 0.25 })
        expect(await itemOf("105333-3-sub")).toMatchObject({ progress: 0.25, bytes: 4096 })
        t.send({ type: "done", id: "105333-3-sub", bytes: 9000, resumedFrom: 0 })
        await reaches("105333-3-sub", "ready")
        expect(await itemOf("105333-3-sub")).toMatchObject({ ready: true, progress: 1, bytes: 9000, files: { video: "video.mp4" } })
        await reaches("105333-2-sub", "downloading")
        expect(await statusOf("105333-4-sub")).toBe("queued")
        expect(t.calls).toContain("forget 105333-3-sub")
    })

    it("asks the provider for the wanted server and quality and hands the loader one request per episode", async () => {
        // without the anime's pictures: they are side files of the request and have their own test (background.test.ts)
        await offlineBatch(environment(), batch([1], { coverUrl: "" }))
        await vi.waitFor(() => expect(t.requests).toHaveLength(1))
        const folder = `${ROOT}/episodes/105333-1-sub`
        expect(t.requests[0]).toEqual({
            id: "105333-1-sub",
            url: "https://cdn.example/en.vtt",
            headers: { Referer: "https://stream.example/" },
            path: `${folder}/video.mp4`,
            title: "Some anime · Episode 1",
            continueParts: true,
            parts: [
                { url: "https://cdn.example/en.vtt", path: `${folder}/subtitle-0.vtt`, weight: 0 },
                { url: "https://cdn.example/de.ass?x=1", path: `${folder}/subtitle-1.ass`, weight: 0 },
                { url: "https://cdn.example/1.mp4", path: `${folder}/video.mp4` },
            ],
        })
        await reaches("105333-1-sub", "downloading")
        expect((await itemOf("105333-1-sub"))?.files).toEqual({
            video: "video.mp4",
            subtitles: [
                { file: "subtitle-0.vtt", language: "English", label: "English", default: true, mime: "text/vtt" },
                { file: "subtitle-1.ass", language: "German", label: "German", default: false, mime: "text/x-ssa" },
            ],
        })
        // a named quality, a server the provider does not have: the provider's sources as they are
        await offlineBatch(environment(), batch([2], { quality: "720p" }))
        await offlineAction(environment(), { id: "105333-1-sub", action: "remove" })
        await offlineBatch(environment(), batch([3], { server: "Gone" }))
        await vi.waitFor(() => expect(t.requests).toHaveLength(3))
        // the last part of the episode itself; behind it only the anime's picture, a side file
        const lastOwn = (request: LoaderRequest) => request.parts!.filter(part => !part.extra).at(-1)!.url
        expect(lastOwn(t.requests[1]!)).toBe("https://cdn.example/2-720.mp4")
        expect(lastOwn(t.requests[2]!)).toBe("https://second.example/3.mp4")
        expect(t.requests[1]!.parts!.at(-1)).toEqual({ url: "https://img.example/cover.jpg", path: `${ROOT}/artwork/105333-2-sub-cover.jpg`, weight: 0, extra: true })
    })

    it("reads an HLS source: best stream, its own sound, the parts of both for one run", async () => {
        const master = "https://cdn.example/ep/master.m3u8"
        pages.set(master, ["#EXTM3U", `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="Japanese",LANGUAGE="ja",DEFAULT=YES,URI="audio/index.m3u8"`,
            `#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360,AUDIO="a"`, "360/index.m3u8",
            `#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,AUDIO="a"`, "1080/index.m3u8"].join("\n"))
        pages.set("https://cdn.example/ep/1080/index.m3u8", ["#EXTM3U", `#EXT-X-KEY:METHOD=AES-128,URI="key.bin"`, "#EXTINF:4,", "000.jpg", "#EXTINF:4,", "001.jpg", "#EXT-X-ENDLIST"].join("\n"))
        pages.set("https://cdn.example/ep/audio/index.m3u8", ["#EXTM3U", "#EXTINF:4,", "a0.aac", "#EXTINF:4,", "a1.aac", "#EXT-X-ENDLIST"].join("\n"))
        await offlineDownload(environment(), direct({ url: master, type: "m3u8", quality: "Auto" }))
        await reaches("7-3-sub", "downloading")
        const folder = `${ROOT}/episodes/7-3-sub`
        expect(t.requests[0]).toMatchObject({ path: `${folder}/video.ts`, continueParts: true, headers: { Referer: "https://stream.example/" } })
        expect(t.requests[0]!.parts).toEqual([
            { url: "https://cdn.example/ep/1080/000.jpg", path: `${folder}/video.ts`, key: { url: "https://cdn.example/ep/1080/key.bin", iv: "0".repeat(32) } },
            { url: "https://cdn.example/ep/1080/001.jpg", path: `${folder}/video.ts`, key: { url: "https://cdn.example/ep/1080/key.bin", iv: "0".repeat(31) + "1" } },
            { url: "https://cdn.example/ep/audio/a0.aac", path: `${folder}/audio.aac` },
            { url: "https://cdn.example/ep/audio/a1.aac", path: `${folder}/audio.aac` },
        ])
        expect((await itemOf("7-3-sub"))?.files).toEqual({ video: "video.ts", audio: "audio.aac" })
    })
})

describe("failures", () => {
    it("of finding the files: protected stream, refused playlist, no source, no connection", async () => {
        pages.set("https://cdn.example/drm.m3u8", ["#EXTM3U", `#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://k"`, "#EXTINF:4,", "0.ts", "#EXT-X-ENDLIST"].join("\n"))
        pages.set("https://cdn.example/gone.m3u8", 403)
        await offlineDownload(environment(), direct({ url: "https://cdn.example/drm.m3u8", type: "m3u8", episode: "1" }))
        await offlineDownload(environment(), direct({ url: "https://cdn.example/gone.m3u8", type: "m3u8", episode: "2" }))
        await reaches("7-1-sub", "failed")
        await reaches("7-2-sub", "failed")
        expect(await itemOf("7-1-sub")).toMatchObject({ failure: "SOURCE_UNAVAILABLE", ready: false })
        expect(await itemOf("7-2-sub")).toMatchObject({ failure: "SOURCE_REFUSED" })
        await offlineBatch(environment(), batch([99]))
        await reaches("105333-99-sub", "failed")
        expect(await itemOf("105333-99-sub")).toMatchObject({ failure: "SOURCE_UNAVAILABLE", error: "prov: episode 99 not found" })
        // no answer of the playlist's host: tried again later
        await offlineDownload(environment(), direct({ url: "https://cdn.example/unreachable.m3u8", type: "m3u8", episode: "4" }))
        await vi.waitFor(async () => expect((await database!.then(db => db.select().from(offlineItems))).find(row => row.id === "7-4-sub")).toMatchObject({ status: "queued", tries: 1, retryAt: now + RETRY_PAUSES_MS[0]! }))
        expect(t.requests).toHaveLength(0)
    })

    it("of the connection are tried again with growing pauses, then the episode has failed", async () => {
        await offlineDownload(environment(), direct())
        await reaches("7-3-sub", "downloading")
        for (const pause of RETRY_PAUSES_MS) {
            const before = t.requests.length
            t.send(failedEvent("7-3-sub", "CONNECTION"))
            await reaches("7-3-sub", "queued")
            now += pause - 1
            await lookAgain()
            await new Promise(resolve => setTimeout(resolve, 20))
            expect(t.requests, "not before the pause is over").toHaveLength(before)
            now += 2
            await lookAgain()
            await reaches("7-3-sub", "downloading")
            expect(t.requests).toHaveLength(before + 1)
        }
        t.send(failedEvent("7-3-sub", "CONNECTION"))
        await reaches("7-3-sub", "failed")
        expect(await itemOf("7-3-sub")).toMatchObject({ failure: "CONNECTION", error: "CONNECTION happened" })
        expect(t.requests).toHaveLength(1 + RETRY_PAUSES_MS.length)
        // the user's retry starts the count anew
        await offlineAction(environment(), { id: "7-3-sub", action: "retry" })
        await reaches("7-3-sub", "downloading")
        expect((await itemOf("7-3-sub"))?.failure).toBeUndefined()
    })

    it("are classed as the screens know them: full storage, refusal, the unknown, a stop by the user", async () => {
        await offlineDownload(environment(), direct({ episode: "1" }))
        await reaches("7-1-sub", "downloading")
        t.send(failedEvent("7-1-sub", "STORAGE_FULL"))
        await reaches("7-1-sub", "failed")
        expect((await itemOf("7-1-sub"))?.failure).toBe("STORAGE_FULL")

        // the player's own address was refused for good: no new try
        await offlineDownload(environment(), direct({ episode: "2" }))
        await reaches("7-2-sub", "downloading")
        t.send(failedEvent("7-2-sub", "SOURCE_REFUSED", 403))
        await reaches("7-2-sub", "failed")
        expect((await itemOf("7-2-sub"))?.failure).toBe("SOURCE_REFUSED")

        // a refusal that describes the moment: tried again
        await offlineDownload(environment(), direct({ episode: "5" }))
        await reaches("7-5-sub", "downloading")
        t.send(failedEvent("7-5-sub", "SOURCE_REFUSED", 503))
        await reaches("7-5-sub", "queued")
        await offlineAction(environment(), { id: "7-5-sub", action: "remove" })

        await offlineDownload(environment(), direct({ episode: "6" }))
        await reaches("7-6-sub", "downloading")
        t.send(failedEvent("7-6-sub", "UNKNOWN"))
        await reaches("7-6-sub", "failed")
        expect((await itemOf("7-6-sub"))?.failure).toBe("UNKNOWN")

        await offlineDownload(environment(), direct({ episode: "7" }))
        await reaches("7-7-sub", "downloading")
        t.send(failedEvent("7-7-sub", "CANCELLED"))
        await reaches("7-7-sub", "paused")
    })

    it("of an address the provider gave get one new try with a freshly asked source", async () => {
        await offlineBatch(environment(), batch([1]))
        await reaches("105333-1-sub", "downloading")
        t.send(failedEvent("105333-1-sub", "SOURCE_REFUSED", 403))
        await reaches("105333-1-sub", "queued")
        now += RETRY_PAUSES_MS[0]! + 1
        await lookAgain()
        await reaches("105333-1-sub", "downloading")
        expect(asked).toEqual([{ episodeNumber: 1, refresh: false }, { episodeNumber: 1, refresh: true }])
        t.send(failedEvent("105333-1-sub", "SOURCE_REFUSED", 403))
        await reaches("105333-1-sub", "failed")
        // a failed episode may be queued again
        expect(await offlineBatch(environment(), batch([1]))).toBe(1)
        await reaches("105333-1-sub", "downloading")
    })
})

describe("the user's actions", () => {
    it("pause, resume and remove an episode; an unknown id is an error", async () => {
        await offlineBatch(environment(), batch([1, 2, 3]))
        await reaches("105333-2-sub", "downloading")
        expect(await offlineAction(environment(), { id: "105333-1-sub", action: "pause" })).toBe(true)
        expect(await statusOf("105333-1-sub")).toBe("paused")
        expect(t.calls).toContain("cancel 105333-1-sub")
        // its place goes to the next one
        await reaches("105333-3-sub", "downloading")
        await offlineAction(environment(), { id: "105333-1-sub", action: "resume" })
        expect(await statusOf("105333-1-sub")).toBe("queued")
        // an event of the run that was cancelled does not wake it
        t.send({ type: "done", id: "105333-1-sub", bytes: 5, resumedFrom: 0 })
        expect(await statusOf("105333-1-sub")).toBe("queued")

        await offlineAction(environment(), { id: "105333-2-sub", action: "remove" })
        expect(await itemOf("105333-2-sub")).toBeUndefined()
        expect(t.calls).toContain("forget 105333-2-sub")
        // the episode's folder and the picture that was to be saved with it
        expect(t.removed).toEqual([`${ROOT}/episodes/105333-2-sub`, `${ROOT}/artwork/105333-2-sub-cover.jpg`])
        expect((await database!.then(db => db.select().from(offlineItems))).map(row => row.id).sort()).toEqual(["105333-1-sub", "105333-3-sub"])
        await reaches("105333-1-sub", "downloading")

        await expect(offlineAction(environment(), { id: "nothing", action: "pause" })).rejects.toMatchObject({ message: "invalid id", status: 500 })
        await expect(offlineAction(environment(), { id: "105333-1-sub", action: "explode" })).rejects.toMatchObject({ status: 400 })
        await expect(offlinePosition(environment(), { id: "nothing", positionMs: 1 })).rejects.toThrow("invalid id")
    })

    it("keeps where the user stopped watching", async () => {
        await offlineDownload(environment(), direct())
        expect(await offlinePosition(environment(), { id: "7-3-sub", positionMs: 61_234.4 })).toBe(true)
        expect((await itemOf("7-3-sub"))?.position).toBe(61_234)
        await forgetOfflineService()
        expect((await itemOf("7-3-sub"))?.position).toBe(61_234)
    })
})

describe("watched episodes (Delete watched episodes, incognito mode)", () => {
    const settle = async (episodes: number[]) => {
        await offlineBatch(environment(), batch(episodes))
        for (const number of episodes) {
            await reaches(`105333-${number}-sub`, "downloading")
            t.send({ type: "done", id: `105333-${number}-sub`, bytes: 5, resumedFrom: 0 })
            await reaches(`105333-${number}-sub`, "ready")
        }
    }
    const start = async (switches: Record<string, unknown>) => {
        await firstStart({ library: {} }, environment().core)
        await patchAppSwitches({ body: switches, query: undefined, path: {} } as never, environment().core)
    }
    const watched = (number: number) => offlinePosition(environment(), { id: `105333-${number}-sub`, positionMs: 0, watched: true })

    it("off (the default): a watched episode stays and is noted as watched", async () => {
        await start({})
        await settle([1])
        await watched(1)
        expect((await itemOf("105333-1-sub"))?.watchedAt).toBe(now)
        expect(t.removed).toEqual([])
    })

    it("\"watched\": the watched episode goes, the others stay", async () => {
        await start({ deleteWatchedEpisodes: "watched" })
        await settle([1, 2])
        await offlinePosition(environment(), { id: "105333-1-sub", positionMs: 900_000 })
        expect(await itemOf("105333-1-sub")).toBeDefined()
        await watched(1)
        expect(await itemOf("105333-1-sub")).toBeUndefined()
        expect(await itemOf("105333-2-sub")).toBeDefined()
        expect(t.removed).toContain(`${ROOT}/episodes/105333-1-sub`)
    })

    it("\"keep-one\": the watched one stays, the watched ones before it go", async () => {
        await start({ deleteWatchedEpisodes: "keep-one" })
        await settle([1, 2, 3])
        await watched(1)
        expect(await itemOf("105333-1-sub")).toBeDefined()
        await watched(3)
        // episode 2 was never watched: it stays
        expect((await offlineSnapshot(environment())).items.map(item => item.id).sort()).toEqual(["105333-2-sub", "105333-3-sub"])
    })

    it("incognito: no position kept, nothing noted, nothing deleted", async () => {
        await start({ deleteWatchedEpisodes: "watched", incognitoMode: true })
        await settle([1])
        expect(await offlinePosition(environment(), { id: "105333-1-sub", positionMs: 61_000 })).toBe(true)
        await watched(1)
        const item = await itemOf("105333-1-sub")
        expect(item?.position).toBe(0)
        expect(item?.watchedAt).toBeUndefined()
        expect(t.removed).toEqual([])
    })
})

describe("the network", () => {
    it("holds the queue on mobile data with Wi-Fi only, and without a connection", async () => {
        await offlineBatch(environment(), batch([1, 2, 3]))
        await reaches("105333-2-sub", "downloading")
        expect(await setOfflineSettings(environment(), { wifiOnly: true })).toBe(true)
        expect((await offlineSnapshot(environment())).waiting).toBe("")

        t.setNetwork(MOBILE)
        await reaches("105333-1-sub", "queued")
        await reaches("105333-2-sub", "queued")
        expect(await offlineSnapshot(environment())).toMatchObject({ wifiOnly: true, waiting: "wifi", network: MOBILE })
        expect(t.calls.filter(call => call.startsWith("cancel"))).toEqual(["cancel 105333-1-sub", "cancel 105333-2-sub"])
        const before = t.requests.length
        await lookAgain()
        expect(t.requests).toHaveLength(before)

        // the screens' own report says the same as the device
        await offlineNetwork(environment(), { connected: true, metered: false })
        await reaches("105333-1-sub", "downloading")
        expect((await offlineSnapshot(environment())).waiting).toBe("")
        expect(t.requests.at(-1)).toMatchObject({ continueParts: true })

        t.setNetwork({ known: true, connected: false, metered: false })
        await reaches("105333-1-sub", "queued")
        expect((await offlineSnapshot(environment())).waiting).toBe("internet")
        await setOfflineSettings(environment(), { wifiOnly: false })
        expect((await offlineSnapshot(environment())).waiting).toBe("internet")
        t.setNetwork(MOBILE)
        await reaches("105333-1-sub", "downloading")
    })

    it("keeps Wi-Fi only over a restart and waits while the network is not known; nothing waits without episodes", async () => {
        await setOfflineSettings(environment(), { wifiOnly: true })
        await forgetOfflineService()
        t.state.network = { known: false, connected: true, metered: false }
        expect(await offlineSnapshot(environment())).toMatchObject({ wifiOnly: true, waiting: "" })
        await offlineDownload(environment(), direct())
        expect(await offlineSnapshot(environment())).toMatchObject({ waiting: "wifi", network: { known: false } })
        expect(t.requests).toHaveLength(0)
        t.setNetwork(WIFI)
        await reaches("7-3-sub", "downloading")
    })
})

describe("after the app was ended", () => {
    const status = (id: string, state: LoaderStatus["state"], bytes: number): LoaderStatus => ({ id, state, bytes, total: null, validator: null, failure: null })

    it("goes on with what was interrupted, takes what finished and leaves what the system still holds", async () => {
        await offlineSettingsOff()
        await offlineBatch(environment(), batch([1, 2]))
        await reaches("105333-2-sub", "downloading")
        await offlineDownload(environment(), direct())
        expect(t.requests).toHaveLength(2)

        // a new start of the app: the core's memory is gone, the database and the loader's record are not
        await forgetOfflineService()
        t.statuses.set("105333-1-sub", status("105333-1-sub", "interrupted", 4000))
        t.statuses.set("105333-2-sub", status("105333-2-sub", "done", 9000))
        const snapshot = await offlineSnapshot(environment())
        expect(snapshot.items.find(item => item.id === "105333-2-sub")).toMatchObject({ status: "ready", ready: true, bytes: 9000, progress: 1 })
        await reaches("105333-1-sub", "downloading")
        await reaches("7-3-sub", "downloading")
        // the interrupted one is asked for again, keeping its finished parts; the source is asked anew
        expect(t.requests.slice(2).map(request => [request.id, request.continueParts])).toEqual([["105333-1-sub", true], ["7-3-sub", true]])
        expect(asked.filter(request => request.episodeNumber === 1)).toHaveLength(2)

        await forgetOfflineService()
        t.statuses.set("105333-1-sub", status("105333-1-sub", "running", 6000))
        t.statuses.set("7-3-sub", status("7-3-sub", "queued", 0))
        await offlineSnapshot(environment())
        await new Promise(resolve => setTimeout(resolve, 20))
        expect(t.requests, "held by the system: no new request").toHaveLength(4)
        t.send({ type: "done", id: "105333-1-sub", bytes: 9500, resumedFrom: 6000 })
        await reaches("105333-1-sub", "ready")
    })

    const offlineSettingsOff = () => setOfflineSettings(environment(), { wifiOnly: false })
})
