// geschrieben nach: der am Gerät beobachteten Form von `mobile-offline/queue.json` des Servers (Feldnamen und Arten, Werte hier erfunden), den App-Typen MobileOffline_* und docs/EIGENER-KERN.md §4o (Phase 4c)

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { sqlDriverFor } from "@/api/client/core-database"
import type { MobileOffline_Item } from "@/api/generated/types"
import { forgetDatabases, openDatabaseSync } from "../../../test/expo-sqlite"
import { type CoreDatabase, openCoreDatabase } from "../database/database"
import { offlineItems, offlineMoves } from "../database/schema"
import { OldQueueProblem, oldEpisodes } from "./legacy"
import {
    type OfflineDevice, type OfflineEnvironment, forgetOfflineService, offlineAction, offlineArtworkAddress, offlineBatch, offlineFileAddress, offlineSnapshot,
    repeatOldEpisodes,
} from "./offline"

const ROOT = "file:///data/user/0/app/files/core-offline"
const OLD_ROOT = "file:///data/user/0/app/files/mobile-offline"

/** One entry in the form the server writes (every field it wrote on the device; the values are made up) */
function serverEntry(id: string, more: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        title: "Some anime", description: "Text", genres: ["Action"], year: 2001, format: "TV", totalEpisodes: 12, duration: 24, score: 70,
        coverUrl: "https://img.example/c.jpg", bannerUrl: "https://img.example/b.jpg", episodeTitle: "First", episodeImageUrl: "https://img.example/e.jpg",
        episodeDescription: "About it", coverAsset: "aa11.jpg", bannerAsset: "bb22.jpg", episodeImageAsset: "cc33.jpg", metadataSaved: true,
        id, key: `7:1:prov:false:Auto`, status: "ready", ready: true, mediaId: 7, provider: "prov", episode: "1", dubbed: false, quality: "Auto",
        server: "Auto", audioLanguage: "ja", progress: 100, bytes: 1234, position: 5000,
        files: { video: "video.ts", subtitles: [{ file: "sub-0.vtt", language: "en", label: "English", default: true, mime: "text/vtt" }] },
        order: 1700000000000, source: { url: "https://stream.example/master.m3u8", type: "m3u8", headers: { Referer: "https://stream.example/" }, subtitles: [] },
        videoTotal: 10, video: { segments: 10, bytes: 1234 }, audioState: { segments: 0, bytes: 0 },
        ...more,
    }
}

const queueOf = (...entries: Record<string, unknown>[]) => JSON.stringify({ version: 1, wifiOnly: false, items: Object.fromEntries(entries.map(entry => [entry.id, entry])), manga: {} })

let now = 1_800_000_000_000
let database: Promise<CoreDatabase> | null = null
let queue: string | null
let removed: string[]

function device(): OfflineDevice {
    return {
        loader: { enqueue: async () => {}, cancel: async () => {}, status: async () => null, forget: async () => {}, listen: () => () => {} },
        root: ROOT,
        removeFolder: async address => void removed.push(address),
        network: async () => ({ known: true, connected: true, metered: false }),
        onNetwork: () => () => {},
        oldRoot: OLD_ROOT,
        oldQueue: async () => queue,
        told: line => void told.push(line),
    }
}

/** The lines the take-over wrote to the log */
let told: string[] = []

function environment(): OfflineEnvironment {
    return {
        core: { fetch: async () => { throw new TypeError("no network in this test") }, now: () => now, pause: async () => {},
            database: () => database ??= openCoreDatabase(sqlDriverFor(openDatabaseSync("core.db") as never), () => now) },
        device: device(),
        sources: async () => { throw new Error("no source in this test") },
    }
}

const rowsOf = async () => (await (await environment().core.database()).select().from(offlineItems)).map(row => row.id).sort()

beforeEach(async () => {
    await forgetOfflineService()
    forgetDatabases()
    database = null
    queue = null
    removed = []
})

afterEach(async () => {
    await forgetOfflineService()
    /*SERVER-WAY*/
})

describe("the server's list of saved episodes", () => {
    it("gives the finished episodes in the core's form, and leaves the unfinished and unknown ones", () => {
        const { items, left } = oldEpisodes(queueOf(
            serverEntry("abc123"),
            serverEntry("def456", { status: "downloading", ready: false }),
            serverEntry("bad", { files: { video: "../x.ts" } }),
        ))
        expect(left).toBe(2)
        expect(items).toHaveLength(1)
        const item = items[0]!
        expect(item).toMatchObject({ id: "abc123", key: "7:1:prov:false:Auto", status: "ready", ready: true, progress: 1, mediaId: 7, episode: "1", provider: "prov",
            bytes: 1234, position: 5000, coverAsset: "aa11.jpg", metadataSaved: true, files: { video: "video.ts", subtitles: [{ file: "sub-0.vtt", language: "en" }] } })
        // the source's addresses and the server's own counters stay behind
        expect(Object.keys(item)).not.toEqual(expect.arrayContaining(["source"]))
        expect("videoTotal" in item || "audioState" in item).toBe(false)
        // every field the screens read is of their type
        const screen: MobileOffline_Item = item as unknown as MobileOffline_Item
        expect(screen.id).toBe("abc123")
    })

    it("names a list that is not one without quoting it", () => {
        expect(() => oldEpisodes("{secret")).toThrow(OldQueueProblem)
        expect(() => oldEpisodes("{secret")).toThrow(/not readable as JSON$/)
        expect(() => oldEpisodes(JSON.stringify({ items: [] }))).toThrow(OldQueueProblem)
        expect(oldEpisodes(JSON.stringify({ version: 1, wifiOnly: false, items: {}, manga: {} }))).toEqual({ items: [], left: 0 })
    })
})

describe("taking the server's episodes over", () => {
    it("shows them with their files and pictures in the server's folder, read only", async () => {
        queue = queueOf(serverEntry("abc123"))
        const before = queue
        const snapshot = await offlineSnapshot(environment())
        expect(snapshot.items.map(item => [item.id, item.status])).toEqual([["abc123", "ready"]])
        expect(offlineFileAddress("abc123", "video.ts")).toBe(`${OLD_ROOT}/episodes/abc123/video.ts`)
        expect(offlineArtworkAddress("aa11.jpg")).toBe(`${OLD_ROOT}/artwork/aa11.jpg`)
        expect(offlineFileAddress("7-2-sub", "video.ts")).toBe(`${ROOT}/episodes/7-2-sub/video.ts`)
        expect(queue).toBe(before)
        expect(removed).toEqual([])
    })

    it("runs once per database; a second start and a repeat change nothing", async () => {
        queue = queueOf(serverEntry("abc123"))
        await offlineSnapshot(environment())
        const first = await rowsOf()
        expect(told.at(-1)).toBe("move from the server: saved episodes taken 1, left with the server 0")
        told = []
        await forgetOfflineService()
        await offlineSnapshot(environment())
        expect(await rowsOf()).toEqual(first)
        expect(told).toEqual([])
        expect(await repeatOldEpisodes()).toEqual({ taken: 0, left: 1 })
        expect(await rowsOf()).toEqual(first)
        const notes = await (await environment().core.database()).select().from(offlineMoves)
        expect(notes).toEqual([{ part: "episodes", count: 0, movedAt: now }])
    })

    it("does not add an episode the core has in the same audio, and a repeat adds only new ones", async () => {
        queue = queueOf()
        await offlineBatch(environment(), { mediaId: 7, provider: "prov", dubbed: false, quality: "Auto", server: "", episodes: [{ number: 1, title: "", image: "", description: "" }] })
        queue = queueOf(serverEntry("abc123"), serverEntry("ghi789", { episode: "2" }))
        expect(await repeatOldEpisodes()).toEqual({ taken: 1, left: 1 })
        expect(await rowsOf()).toEqual(["7-1-sub", "ghi789"])
    })

    it("removing one takes only the core's entry: the server's files stay, and it does not come back by itself", async () => {
        queue = queueOf(serverEntry("abc123"))
        await offlineSnapshot(environment())
        await offlineAction(environment(), { id: "abc123", action: "remove" })
        expect(removed).toEqual([])
        expect(await rowsOf()).toEqual([])
        expect(offlineFileAddress("abc123", "video.ts")).toBe(`${ROOT}/episodes/abc123/video.ts`)
        await forgetOfflineService()
        expect((await offlineSnapshot(environment())).items).toEqual([])
    })

    it("leaves no note when the list cannot be read, so the next start tries again", async () => {
        queue = "{broken"
        expect((await offlineSnapshot(environment())).items).toEqual([])
        expect(await (await environment().core.database()).select().from(offlineMoves)).toEqual([])
        await forgetOfflineService()
        queue = queueOf(serverEntry("abc123"))
        expect((await offlineSnapshot(environment())).items.map(item => item.id)).toEqual(["abc123"])
    })

    it("without a list of the server there is nothing to take", async () => {
        expect((await offlineSnapshot(environment())).items).toEqual([])
        expect(await (await environment().core.database()).select().from(offlineMoves)).toEqual([{ part: "episodes", count: 0, movedAt: now }])
    })
})
