// geschrieben nach: prefetch.ts (Regeln „Download next episodes automatically“) und offline.ts (offlinePrefetch, offlinePosition); erfundene Werte, keine echte Quelle, kein Netz

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { sqlDriverFor } from "@/api/client/core-database"
import { forgetDatabases, openDatabaseSync } from "../../../test/expo-sqlite"
import { type CoreDatabase, openCoreDatabase } from "../database/database"
import { anilistListEntries, anilistMedia, watchPositions } from "../database/schema"
import { patchAppSwitches } from "../settings/incognito"
import { firstStart } from "../settings/settings"
import { type OfflineDevice, type OfflineEnvironment, type OfflineNetwork, forgetOfflineService, offlineBatch, offlineNetwork, offlinePosition, offlinePrefetch, offlineSnapshot } from "./offline"
import { MIN_FREE_BYTES, episodesToPrefetch, prefetchBlock, prefetchCountOf, watchingEpisode } from "./prefetch"

const WIFI: OfflineNetwork = { known: true, connected: true, metered: false }

describe("the rules", () => {
    it("reads only 0 to 3; anything else is off", () => {
        expect([0, 1, 2, 3, 4, -1, "2", undefined].map(prefetchCountOf)).toEqual([0, 1, 2, 3, 0, 0, 0, 0])
    })

    it("holds back when off, in incognito mode, off Wi-Fi and with too little storage", () => {
        const state = { count: 1, incognito: false, network: WIFI, freeBytes: MIN_FREE_BYTES }
        expect(prefetchBlock(state)).toBe("")
        expect(prefetchBlock({ ...state, freeBytes: null })).toBe("")
        expect(prefetchBlock({ ...state, count: 0 })).toBe("off")
        expect(prefetchBlock({ ...state, incognito: true })).toBe("incognito")
        expect(prefetchBlock({ ...state, network: { ...WIFI, metered: true } })).toBe("wifi")
        expect(prefetchBlock({ ...state, network: { ...WIFI, known: false } })).toBe("wifi")
        expect(prefetchBlock({ ...state, network: { ...WIFI, connected: false } })).toBe("wifi")
        expect(prefetchBlock({ ...state, freeBytes: MIN_FREE_BYTES - 1 })).toBe("storage")
    })

    it("starts after the higher of AniList's progress and the episode played", () => {
        expect(watchingEpisode(4, 2)).toBe(4)
        expect(watchingEpisode(4, 5)).toBe(5)
        expect(watchingEpisode(0, 0)).toBe(0)
        expect(watchingEpisode(Number.NaN, -3)).toBe(0)
    })

    it("takes the next episodes that are out and not saved, in a fixed window", () => {
        const none = new Set<string>()
        expect(episodesToPrefetch(5, 1, 12, none)).toEqual([6])
        expect(episodesToPrefetch(5, 3, 12, none)).toEqual([6, 7, 8])
        // only what is out
        expect(episodesToPrefetch(5, 3, 7, none)).toEqual([6, 7])
        expect(episodesToPrefetch(12, 2, 12, none)).toEqual([])
        // a saved or waiting episode is not queued again, and does not push the window further
        expect(episodesToPrefetch(5, 2, 12, new Set(["6"]))).toEqual([7])
        expect(episodesToPrefetch(5, 1, 12, new Set(["6"]))).toEqual([])
        expect(episodesToPrefetch(5, 0, 12, none)).toEqual([])
    })
})

// ---- with the queue ----

const MEDIA = 105333
let now = 1_800_000_000_000
let database: Promise<CoreDatabase> | null = null
let network: OfflineNetwork = WIFI
let free: number | null = 50 * 1024 ** 3
let built: number[] = []
/** true: finding the files of an episode never ends, so it stays "resolving" */
let hold = false

const device: OfflineDevice = {
    loader: {
        enqueue: async () => undefined,
        cancel: async () => undefined,
        status: async () => null,
        forget: async () => undefined,
        listen: () => () => undefined,
    },
    root: "file:///data/user/0/app/files/core-offline",
    removeFolder: async () => undefined,
    network: async () => network,
    onNetwork: () => () => undefined,
    freeBytes: async () => free,
}

function environment(): OfflineEnvironment {
    return {
        core: { fetch: async () => { throw new TypeError("no network in this test") }, now: () => now, pause: async () => {}, database: () => database ??= openCoreDatabase(sqlDriverFor(openDatabaseSync("core.db") as never), () => now) },
        device,
        sources: () => hold ? new Promise(() => undefined) : Promise.resolve({ videoSources: [] }),
        episodes: async mediaId => {
            built.push(mediaId)
            return {
                media: { id: mediaId, title: { userPreferred: "Some anime" }, coverImage: { large: "https://img.example/cover.jpg" }, bannerImage: "" },
                episodes: [1, 2, 3, 4, 5, 6, 7, 8].map(number => ({ episodeNumber: number, episodeTitle: `Title ${number}`, episodeMetadata: { image: `https://img.example/${number}.jpg`, summary: "" } })),
                out: 8,
            }
        },
    }
}

async function onList(mediaId: number, status: string, progress: number) {
    const opened = await environment().core.database()
    const [row] = await opened.insert(anilistMedia).values({ anilistId: mediaId, kind: "ANIME", content: { id: mediaId }, changedAt: now }).returning()
    await opened.insert(anilistListEntries).values({ anilistId: mediaId, media: row.id, kind: "ANIME", list: 0, position: 0, content: { status, progress }, changedAt: now })
}

async function played(mediaId: number, episodeNumber: number, kind = "onlinestream") {
    const opened = await environment().core.database()
    await opened.insert(watchPositions).values({ mediaId, kind, episodeNumber, positionSeconds: 10, durationSeconds: 1440, filepath: "", addedAt: now, changedAt: now, expiresAt: null })
}

async function start(switches: Record<string, unknown>) {
    await firstStart({ library: {} }, environment().core)
    await patchAppSwitches({ body: switches, query: undefined, path: {} } as never, environment().core)
}

const ids = async () => (await offlineSnapshot(environment())).items.map(item => item.id).sort()
const ask = (body: Record<string, unknown> = {}) => offlinePrefetch(environment(), { providers: { [MEDIA]: "prov" }, fallback: "", dubbed: {}, ...body })

beforeEach(async () => {
    await forgetOfflineService()
    forgetDatabases()
    database = null
    now = 1_800_000_000_000
    network = WIFI
    free = 50 * 1024 ** 3
    built = []
    hold = false
})

afterEach(async () => {
    await forgetOfflineService()
})

describe("Download next episodes automatically", () => {
    it("off (the default): nothing is queued", async () => {
        await start({})
        await onList(MEDIA, "CURRENT", 2)
        await played(MEDIA, 3)
        expect(await ask()).toBe("nothing ahead (off)")
        expect(await ids()).toEqual([])
    })

    it("queues the next episodes after the one being watched, with the anime's provider and audio", async () => {
        await start({ prefetchEpisodes: 2 })
        await onList(MEDIA, "CURRENT", 2)
        await played(MEDIA, 3)
        expect(await ask({ dubbed: { [MEDIA]: true } })).toBe("2 episode(s) queued ahead")
        const items = (await offlineSnapshot(environment())).items
        expect(items.map(item => item.id).sort()).toEqual([`${MEDIA}-4-dub`, `${MEDIA}-5-dub`])
        expect(items[0]).toMatchObject({ provider: "prov", dubbed: true, title: "Some anime", coverUrl: "https://img.example/cover.jpg" })
        expect(items.find(item => item.episode === "4")).toMatchObject({ episodeTitle: "Title 4", episodeImageUrl: "https://img.example/4.jpg" })
        // asked again (pause, 80 %, closing): nothing twice, and the episodes are not built again
        expect(await ask({ dubbed: { [MEDIA]: true } })).toBe("0 episode(s) queued ahead")
        expect(built).toEqual([MEDIA])
    })

    it("takes the provider picked last anywhere when the anime has none of its own; none at all: passed over", async () => {
        await start({ prefetchEpisodes: 1 })
        await onList(MEDIA, "CURRENT", 0)
        await played(MEDIA, 1)
        expect(await ask({ providers: {} })).toBe("0 episode(s) queued ahead")
        expect(await ask({ providers: {}, fallback: "other" })).toBe("1 episode(s) queued ahead")
        expect((await offlineSnapshot(environment())).items[0]).toMatchObject({ id: `${MEDIA}-2-sub`, provider: "other" })
    })

    it("only anime on Watching, only from an online stream, only what is out", async () => {
        await start({ prefetchEpisodes: 3 })
        await onList(MEDIA, "PAUSED", 1)
        await played(MEDIA, 2)
        await onList(7, "CURRENT", 1)
        await played(7, 2, "mediastream")
        await onList(8, "CURRENT", 7)
        await played(8, 6)
        expect(await ask({ providers: { [MEDIA]: "prov", 7: "prov", 8: "prov" } })).toBe("1 episode(s) queued ahead")
        // 8 is at 7 of 8 episodes out
        expect(await ids()).toEqual(["8-8-sub"])
    })

    it("with a mediaId only that anime", async () => {
        await start({ prefetchEpisodes: 1 })
        await onList(MEDIA, "CURRENT", 1)
        await played(MEDIA, 1)
        await onList(8, "CURRENT", 1)
        await played(8, 1)
        await ask({ providers: { [MEDIA]: "prov", 8: "prov" }, mediaId: 8 })
        expect(await ids()).toEqual(["8-2-sub"])
    })

    it("holds back off Wi-Fi, in incognito mode and under 2 GB free", async () => {
        await start({ prefetchEpisodes: 1 })
        await onList(MEDIA, "CURRENT", 1)
        await played(MEDIA, 1)
        network = { known: true, connected: true, metered: true }
        expect(await ask()).toBe("nothing ahead (wifi)")
        await forgetOfflineService()
        network = WIFI
        free = MIN_FREE_BYTES - 1
        expect(await ask()).toBe("nothing ahead (storage)")
        free = null
        await patchAppSwitches({ body: { incognitoMode: true }, query: undefined, path: {} } as never, environment().core)
        expect(await ask()).toBe("nothing ahead (incognito)")
        expect(await ids()).toEqual([])
    })

    it("an episode queued ahead loads on Wi-Fi only, also with the Wi-Fi only setting off; one the user wants loads anywhere", async () => {
        await start({ prefetchEpisodes: 1 })
        await onList(MEDIA, "CURRENT", 1)
        await played(MEDIA, 1)
        hold = true
        expect(await ask()).toBe("1 episode(s) queued ahead")
        const item = async (episode: string) => (await offlineSnapshot(environment())).items.find(other => other.episode === episode)
        expect(await item("2")).toMatchObject({ wifiOnly: true, status: "resolving" })
        // mobile data: it goes back to waiting for Wi-Fi, though the setting is off
        await offlineNetwork(environment(), { connected: true, metered: true })
        let snapshot = await offlineSnapshot(environment())
        expect(snapshot).toMatchObject({ wifiOnly: false, waiting: "wifi" })
        expect(await item("2")).toMatchObject({ status: "queued" })
        // an episode the user queues loads on mobile data; the one ahead keeps waiting
        await offlineBatch(environment(), { mediaId: MEDIA, provider: "prov", dubbed: false, episodes: [{ number: 5 }] })
        snapshot = await offlineSnapshot(environment())
        expect(snapshot.waiting).toBe("")
        expect(await item("5")).toMatchObject({ status: "resolving" })
        expect((await item("5"))?.wifiOnly).toBeUndefined()
        expect(await item("2")).toMatchObject({ status: "queued" })
        // the user queues the episode ahead itself: it loads like any other
        await offlineBatch(environment(), { mediaId: MEDIA, provider: "prov", dubbed: false, episodes: [{ number: 2 }] })
        expect((await item("2"))?.wifiOnly).toBeUndefined()
        expect(await item("2")).toMatchObject({ status: "resolving" })
    })

    it("a saved episode watched to its end brings the next one from the provider it was saved from", async () => {
        await start({ prefetchEpisodes: 1, deleteWatchedEpisodes: "watched" })
        await onList(MEDIA, "CURRENT", 0)
        await offlineBatch(environment(), { mediaId: MEDIA, provider: "saved-prov", dubbed: false, episodes: [{ number: 1 }] })
        await offlinePosition(environment(), { id: `${MEDIA}-1-sub`, positionMs: 0, watched: true })
        // Delete watched episodes takes only ready episodes before or at the watched one, the next ones lie after it
        expect(await ids()).toEqual([`${MEDIA}-1-sub`, `${MEDIA}-2-sub`])
        expect((await offlineSnapshot(environment())).items.find(item => item.episode === "2")?.provider).toBe("saved-prov")
    })

    it("in incognito mode a watched saved episode brings nothing", async () => {
        await start({ prefetchEpisodes: 1, incognitoMode: true })
        await onList(MEDIA, "CURRENT", 0)
        await offlineBatch(environment(), { mediaId: MEDIA, provider: "saved-prov", dubbed: false, episodes: [{ number: 1 }] })
        await offlinePosition(environment(), { id: `${MEDIA}-1-sub`, positionMs: 0, watched: true })
        expect(await ids()).toEqual([`${MEDIA}-1-sub`])
    })
})
