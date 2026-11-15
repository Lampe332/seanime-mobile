// geschrieben nach: settings/incognito.ts und den Schreibwegen playback.ts (keep, progressTo, hearPlayer) und anilist/changes.ts (updateProgressOf); erfundene Werte, AniList ist hier ein Test-Double, keine Anfrage verlässt den Test

import { beforeEach, describe, expect, it } from "vitest"
import { sqlDriverFor } from "@/api/client/core-database"
import { forgetDatabases, openDatabaseSync } from "../../../test/expo-sqlite"
import { forgetChanges } from "../anilist/changes"
import { type CoreDatabase, openCoreDatabase } from "../database/database"
import { account, anilistChanges, anilistMedia, watchPositions } from "../database/schema"
import { coreAnswerFor } from "../index"
import { type PlayerMessage, forgetPlaying, hearPlayer, progressTo } from "../playback/playback"
import type { CoreEnvironment } from "../registry"
import { INCOGNITO_ERROR, incognitoOn } from "./incognito"

let clock = 0
let database: Promise<CoreDatabase> | null = null

const environment: CoreEnvironment = {
    fetch: async () => {
        throw new Error("no AniList in this test")
    },
    secret: async () => "token",
    database: () => database ??= openCoreDatabase(sqlDriverFor(openDatabaseSync("core.db") as never), () => clock),
    now: () => clock,
    pause: async () => undefined,
}

const ask = (method: string, endpoint: string, body?: unknown) => coreAnswerFor(method, endpoint)!({ body, query: undefined }, environment)
const start = async (incognitoMode: boolean) => {
    await ask("POST", "/api/v1/start", { library: { enableWatchContinuity: true, autoUpdateProgress: true } })
    await ask("PATCH", "/api/v1/app-switches", { incognitoMode })
}
const positions = async () => (await environment.database()).select().from(watchPositions)
const changes = async () => (await environment.database()).select().from(anilistChanges)

const MEDIA = 21
const update = { options: { mediaId: MEDIA, episodeNumber: 2, currentTime: 300, duration: 1440, kind: "onlinestream" } }
const loaded: PlayerMessage = {
    type: "video-loaded",
    payload: { state: { playbackInfo: { id: "p1", playbackType: "onlinestream", media: { id: MEDIA, episodes: 24 }, episode: { episodeNumber: 3, progressNumber: 3 } } } },
}
const at = (type: string, currentTime: number): PlayerMessage => ({ type, payload: { id: "p1", currentTime, duration: 1440 } })

beforeEach(() => {
    forgetDatabases()
    forgetChanges()
    forgetPlaying()
    database = null
    clock = 2_000_000
})

describe("incognito mode", () => {
    it("is off unless the switch says so (also before the first start), and stays out of the status", async () => {
        expect(await incognitoOn(environment)).toBe(false)
        // before the first start the switch row alone does not make the settings look set up
        expect(await ask("PATCH", "/api/v1/app-switches", { deleteWatchedEpisodes: "keep-one", prefetchEpisodes: 0 })).toEqual({ incognitoMode: false, deleteWatchedEpisodes: "keep-one", prefetchEpisodes: 0 })
        expect((await ask("GET", "/api/v1/status") as { settings: unknown }).settings).toBeNull()
        await start(false)
        expect(await incognitoOn(environment)).toBe(false)
        const before = await ask("GET", "/api/v1/status") as { settings: Record<string, unknown> }
        expect(await ask("PATCH", "/api/v1/app-switches", { incognitoMode: true })).toEqual({ incognitoMode: true, deleteWatchedEpisodes: "keep-one", prefetchEpisodes: 0 })
        expect(await incognitoOn(environment)).toBe(true)
        expect(await ask("GET", "/api/v1/app-switches")).toEqual({ incognitoMode: true, deleteWatchedEpisodes: "keep-one", prefetchEpisodes: 0 })
        expect((await ask("GET", "/api/v1/status") as { settings: Record<string, unknown> }).settings).toEqual(before.settings)
        await expect(ask("PATCH", "/api/v1/app-switches", { deleteWatchedEpisodes: "always" })).rejects.toMatchObject({ status: 400 })
        await expect(ask("PATCH", "/api/v1/app-switches", { incognitoMode: "yes" })).rejects.toMatchObject({ status: 400 })
    })

    it("keeps nothing in the watch history: the screens' update and the player's messages", async () => {
        await start(true)
        expect(await ask("PATCH", "/api/v1/continuity/item", update)).toBe(true)
        await hearPlayer(loaded, environment)
        await hearPlayer(at("video-paused", 200), environment)
        await hearPlayer(at("video-terminated", 210), environment)
        expect(await positions()).toEqual([])
        expect(await ask("GET", "/api/v1/continuity/history")).toEqual({})
    })

    it("sends no automatic progress: the player's 80 % mark, a playlist's progressTo and both update-progress routes with auto", async () => {
        await start(true)
        await hearPlayer(loaded, environment)
        expect(await hearPlayer(at("video-completed", 1200), environment)).toBe("incognito: progress not sent")
        expect(await progressTo(environment, { mediaId: MEDIA, episodeNumber: 4, totalEpisodes: 24 })).toBe("incognito: progress not sent")
        await expect(ask("POST", "/api/v1/library/anime-entry/update-progress", { mediaId: MEDIA, episodeNumber: 5, totalEpisodes: 24, auto: true }))
            .rejects.toMatchObject({ message: INCOGNITO_ERROR, status: 409 })
        await expect(ask("POST", "/api/v1/manga/update-progress", { mediaId: 30, chapterNumber: 7, totalChapters: 0, auto: true }))
            .rejects.toMatchObject({ message: INCOGNITO_ERROR, status: 409 })
        expect(await changes()).toEqual([])
    })

    it("lets the user's own marks through: \"mark as watched\", \"+1\" and the list editor", async () => {
        await start(true)
        await (await environment.database()).insert(account).values({ id: 1, username: "tester", createdAt: clock, changedAt: clock })
        await ask("POST", "/api/v1/library/anime-entry/update-progress", { mediaId: MEDIA, episodeNumber: 5, totalEpisodes: 24 })
        await ask("POST", "/api/v1/manga/update-progress", { mediaId: 30, chapterNumber: 7, totalChapters: 0 })
        await ask("POST", "/api/v1/anilist/list-entry", { mediaId: 22, type: "anime", status: "CURRENT", score: 0, progress: 3 })
        expect((await changes()).map(row => row.mediaId).sort((a, b) => a - b)).toEqual([MEDIA, 22, 30])
    })

    it("off again: the history keeps the position as before", async () => {
        await start(false)
        await ask("PATCH", "/api/v1/continuity/item", update)
        expect((await positions()).map(row => row.mediaId)).toEqual([MEDIA])
    })
})

describe("the History screen's routes", () => {
    it("remove one anime, clear all, and give the titles the core keeps", async () => {
        await start(false)
        await ask("PATCH", "/api/v1/continuity/item", update)
        await ask("PATCH", "/api/v1/continuity/item", { options: { ...update.options, mediaId: 22 } })
        expect(await ask("DELETE", "/api/v1/continuity/item", { mediaId: MEDIA })).toBe(true)
        expect((await positions()).map(row => row.mediaId)).toEqual([22])
        expect(await ask("DELETE", "/api/v1/continuity/history")).toBe(true)
        expect(await positions()).toEqual([])
        await expect(ask("DELETE", "/api/v1/continuity/item", { mediaId: 0 })).rejects.toMatchObject({ status: 400 })

        const db = await environment.database()
        await db.insert(anilistMedia).values([
            { anilistId: MEDIA, kind: "ANIME", content: { id: MEDIA, title: { userPreferred: "List form" } }, details: { id: MEDIA, title: { userPreferred: "Details form" } }, changedAt: 1 },
            { anilistId: 30, kind: "MANGA", content: { id: 30, title: { userPreferred: "A manga" } }, details: null, changedAt: 1 },
        ])
        expect(await ask("POST", "/api/v1/history/media", { ids: [MEDIA, 30, 99] })).toEqual({
            [MEDIA]: { id: MEDIA, title: { userPreferred: "List form" } },
            30: { id: 30, title: { userPreferred: "A manga" } },
        })
        expect(await ask("POST", "/api/v1/history/media", { ids: [] })).toEqual({})
        await expect(ask("POST", "/api/v1/history/media", { ids: ["x"] })).rejects.toMatchObject({ status: 400 })
    })

    it("read the title and cover of a title the core never kept from AniList once, and keep them for offline", async () => {
        await start(false)
        const sent: unknown[] = []
        let online = true
        const reading: CoreEnvironment = {
            ...environment,
            fetch: async (_url, init) => {
                if (!online) throw new Error("offline")
                sent.push((JSON.parse(init?.body ?? "{}") as { variables?: unknown }).variables)
                const asked = (JSON.parse(init?.body ?? "{}") as { variables: { ids: number[] } }).variables.ids
                const media = [{ id: 88, type: "ANIME", format: "TV", title: { userPreferred: "Only its details page seen" } }, { id: 99, type: "ANIME", format: "TV", title: { userPreferred: "Watched from search", english: null }, coverImage: { large: "https://img/99.jpg" } },
                    { id: 77, type: "MANGA", format: "MANGA", title: { userPreferred: "Only read" }, coverImage: { large: "https://img/77.jpg" } }].filter(one => asked.includes(one.id))
                return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ data: { Page: { pageInfo: { hasNextPage: false }, media } } }) }
            },
        }
        const titles = (ids: number[]) => coreAnswerFor("POST", "/api/v1/history/media")!({ body: { ids }, query: undefined }, reading)
        const db = await environment.database()
        await db.insert(anilistMedia).values([
            { anilistId: MEDIA, kind: "ANIME", content: { id: MEDIA, title: { userPreferred: "In a list" } }, details: null, changedAt: 1 },
            // the details page's form has no title of its own
            { anilistId: 88, kind: "ANIME", content: null, details: { id: 88, genres: ["Action"] }, changedAt: 1 },
        ])
        const expected = {
            [MEDIA]: { id: MEDIA, title: { userPreferred: "In a list" } },
            99: { id: 99, type: "ANIME", format: "TV", title: { userPreferred: "Watched from search" }, coverImage: { large: "https://img/99.jpg" } },
            77: { id: 77, type: "MANGA", format: "MANGA", title: { userPreferred: "Only read" }, coverImage: { large: "https://img/77.jpg" } },
            88: { id: 88, type: "ANIME", format: "TV", title: { userPreferred: "Only its details page seen" } },
        }
        expect(await titles([MEDIA, 77, 88, 99])).toEqual(expected)
        // only the ones without a kept title were asked for
        expect(sent).toEqual([{ ids: [77, 88, 99], page: 1 }])
        // kept: offline (and without asking again) the same titles
        online = false
        expect(await titles([MEDIA, 77, 88, 99])).toEqual(expected)
        expect(sent).toHaveLength(1)
        // never kept and offline: left out, no error
        expect(await titles([MEDIA, 55])).toEqual({ [MEDIA]: expected[MEDIA] })
        // the lists' and details' table stays untouched
        expect((await db.select().from(anilistMedia)).map(row => row.anilistId)).toEqual([MEDIA, 88])
    })
})
