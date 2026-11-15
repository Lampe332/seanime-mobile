// geschrieben nach: playback.recorded.json (Form der Aufzeichnung CONTINUITY.* vom 13.11.2026, Werte erfunden) und App-Code use-player-server.ts / player-logic.ts; Server und AniList sind hier Test-Doubles, keine Anfrage verlässt den Test

import { beforeEach, describe, expect, it } from "vitest"
import { sqlDriverFor } from "@/api/client/core-database"
import { forgetDatabases, openDatabaseSync } from "../../../test/expo-sqlite"
import { forgetChanges } from "../anilist/changes"
import { LONGEST_PIECE_MS, createBlockingWatch } from "../blocking"
import { type CoreDatabase, type LineWait, openCoreDatabase } from "../database/database"
import { watchPositions } from "../database/schema"
import { coreAnswerFor } from "../index"
import type { CoreEnvironment } from "../registry"
import { type PlayerMessage, SAVE_EVERY_MS, continuityHistory, forgetPlaying, hearPlayer } from "./playback"
import recorded from "./playback.recorded.json"

let clock = 0
let database: Promise<CoreDatabase> | null = null
let library = { enableWatchContinuity: true, autoUpdateProgress: true }
let anilistDown = false

const environment: CoreEnvironment = {
    fetch: async () => {
        if (anilistDown) throw new TypeError("Network request failed")
        throw new Error("no AniList in this test")
    },
    secret: async () => "token",
    database: () => database ??= openCoreDatabase(sqlDriverFor(openDatabaseSync("core.db") as never), () => clock),
    now: () => clock,
    pause: async () => undefined,
}

const ask = (method: string, endpoint: string, body?: unknown) => coreAnswerFor(method, endpoint)!({ body, query: undefined }, environment)

const MEDIA = 1
const loaded = (id: string, playbackType = "onlinestream"): PlayerMessage => ({
    clientId: "c",
    type: "video-loaded",
    payload: { state: { clientId: "c", playerType: "native", playbackInfo: { id, playbackType, media: { id: MEDIA, episodes: 12 }, episode: { episodeNumber: 3, progressNumber: 3 } } } },
})
const at = (id: string, type: string, currentTime: number, duration = 1440): PlayerMessage => ({ clientId: "c", type, payload: { id, clientId: "c", currentTime, duration, paused: false } })
const rows = async () => (await environment.database()).select().from(watchPositions)

beforeEach(async () => {
    forgetDatabases()
    forgetChanges()
    forgetPlaying()
    database = null
    clock = 1_000_000
    library = { enableWatchContinuity: true, autoUpdateProgress: true }
    await ask("POST", "/api/v1/start", { library })
    anilistDown = false
})

describe("watch history interfaces (recorded form)", () => {
    it("answers history, item and update like the recording", async () => {
        expect(await ask("GET", "/api/v1/continuity/history")).toEqual({})
        expect(await ask("GET", `/api/v1/continuity/item/${MEDIA}`)).toEqual(recorded.itemBefore)
        expect(await ask("PATCH", "/api/v1/continuity/item", recorded.update.request)).toBe(recorded.update.response)

        const history = await ask("GET", "/api/v1/continuity/history") as Record<string, Record<string, unknown>>
        expect(Object.keys(history)).toEqual(Object.keys(recorded.history))
        const item = history[String(MEDIA)]
        const want = recorded.history["1"] as Record<string, unknown>
        expect(Object.keys(item)).toEqual(Object.keys(want))
        for (const key of Object.keys(want)) expect(typeof item[key]).toBe(typeof want[key])
        expect(item.timeAdded).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d+Z$/)
        const { timeAdded: _a, timeUpdated: _u, ...rest } = want
        expect(item).toMatchObject(rest)

        const found = await ask("GET", `/api/v1/continuity/item/${MEDIA}`) as Record<string, unknown>
        expect(Object.keys(found)).toEqual(Object.keys(recorded.itemAfter))
        expect(found).toMatchObject({ found: true, item: rest })
    })

    it("keeps one row per anime: a later episode replaces it, the time added stays", async () => {
        await ask("PATCH", "/api/v1/continuity/item", recorded.update.request)
        clock += 60_000
        await ask("PATCH", "/api/v1/continuity/item", { options: { ...recorded.update.request.options, episodeNumber: 2, currentTime: 5 } })
        const [row] = await rows()
        expect(row).toMatchObject({ mediaId: MEDIA, episodeNumber: 2, positionSeconds: 5, addedAt: 1_000_000, changedAt: 1_060_000 })
        await expect(ask("PATCH", "/api/v1/continuity/item", { options: { mediaId: MEDIA, kind: "x", episodeNumber: 1, currentTime: 1, duration: 2 } })).rejects.toThrow("invalid kind")
    })

    it("leaves an expired row out (moved from the server's cache with its expiry)", async () => {
        const opened = await environment.database()
        await opened.insert(watchPositions).values({ mediaId: 7, kind: "onlinestream", episodeNumber: 1, positionSeconds: 1, durationSeconds: 2, filepath: "", addedAt: 1, changedAt: 1, expiresAt: clock - 1 })
        expect(await ask("GET", "/api/v1/continuity/history")).toEqual({})
        expect(await ask("GET", "/api/v1/continuity/item/7")).toEqual({ item: null, found: false })
    })

})

describe("the player's videocore messages", () => {
    it("keep the position: status at most every 5 s, seek and close at once", async () => {
        await hearPlayer(loaded("p"), environment)
        await hearPlayer(at("p", "video-status", 10), environment)
        expect((await rows())[0]).toMatchObject({ mediaId: MEDIA, episodeNumber: 3, positionSeconds: 10, kind: "onlinestream" })
        clock += SAVE_EVERY_MS - 1
        await hearPlayer(at("p", "video-status", 14), environment)
        expect((await rows())[0].positionSeconds).toBe(10)
        clock += 1
        await hearPlayer(at("p", "video-status", 15), environment)
        expect((await rows())[0].positionSeconds).toBe(15)
        await hearPlayer(at("p", "video-seeked", 1200), environment)
        expect((await rows())[0].positionSeconds).toBe(1200)
        await hearPlayer(at("p", "video-status", 1203), environment)
        expect(await hearPlayer({ clientId: "c", type: "video-terminated", payload: { id: "p" } }, environment)).toContain("closed")
        expect((await rows())[0].positionSeconds).toBe(1203)
        // the playback is gone: a late status changes nothing
        await hearPlayer(at("p", "video-status", 5), environment)
        expect((await rows())[0].positionSeconds).toBe(1203)
        const item = await ask("GET", `/api/v1/continuity/item/${MEDIA}`) as { item: { currentTime: number, episodeNumber: number } }
        expect(item.item).toMatchObject({ currentTime: 1203, episodeNumber: 3 })
    })

    it("keep nothing with the watch history off", async () => {
        library = { enableWatchContinuity: false, autoUpdateProgress: true }
        await ask("POST", "/api/v1/start", { library })
        await hearPlayer(loaded("p"), environment)
        await hearPlayer(at("p", "video-seeked", 100), environment)
        expect(await rows()).toEqual([])
    })
})


describe("the screens' thread (8 ms watch, phase 5a-2b)", () => {
    // On the tablet the writing messages held the thread 15-101 ms "after start, until sql": a message whose statement
    // waited in the database's line behind another request's statement kept its piece open over that wait, and the
    // player's drawing in that time counted as the core's.
    it.each(["video-status", "video-seeked"])("%s waiting in the database's line for another statement is a wait, not the core's piece", async type => {
        let thread = 0
        const pieces: { milliseconds: number, what: string, until: string }[] = []
        const watch = createBlockingWatch({
            now: () => thread,
            onPiece: (milliseconds, what, where) => void pieces.push({ milliseconds, what, until: where.until }),
            free: () => new Promise<void>(resolve => setTimeout(resolve, 0)),
        })
        const driver = sqlDriverFor(openDatabaseSync("core.db") as never)
        // a statement runs on the database's own thread; meanwhile the player draws on the screens' thread for 12 ms
        const statement: typeof driver = async (sql, params, method) => {
            await new Promise<void>(resolve => setTimeout(resolve, 5))
            thread += 12
            return driver(sql, params, method)
        }
        const opened = openCoreDatabase(watch.waiting(statement, "sql"), () => clock, watch.waiting(<T>(pending: Promise<T>) => pending, "database line") as LineWait)
        const measured: CoreEnvironment = { ...environment, database: () => opened, mark: watch.mark }
        const call = async (what: string, work: () => Promise<unknown>) => {
            await Promise.resolve()
            watch.enter(what)
            try {
                await work()
            }
            finally {
                watch.leave()
            }
        }
        await opened
        await call("videocore video-loaded", () => hearPlayer(loaded("p"), measured))
        pieces.length = 0

        // another request's statement is on the database's thread when the player's message comes
        const other = call("GET /api/v1/continuity/history", () => continuityHistory({ path: {}, query: undefined, body: undefined }, measured))
        await new Promise<void>(resolve => setTimeout(resolve, 0))
        await Promise.all([other, call(`videocore ${type}`, () => hearPlayer(at("p", type, 1200), measured))])

        const longest = Math.max(...pieces.map(piece => piece.milliseconds))
        expect(pieces.filter(piece => piece.milliseconds > LONGEST_PIECE_MS)).toEqual([])
        expect(longest).toBeLessThanOrEqual(LONGEST_PIECE_MS)
        const [row] = await (await opened).select().from(watchPositions)
        expect(row.positionSeconds).toBe(1200)
    })
})
