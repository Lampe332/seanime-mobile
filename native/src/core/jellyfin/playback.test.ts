// geschrieben nach: server-settings.test.ts (Test-Double des Servers, Umgebung) und playback.ts; Server, Namen, Token und Passwort sind erfunden

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { sqlDriverFor } from "@/api/client/core-database"
import { forgetDatabases, openDatabaseSync } from "../../../test/expo-sqlite"
import type { HttpFetch } from "../anilist/client"
import { type CoreDatabase, openCoreDatabase } from "../database/database"
import { type CoreEnvironment, matchCoreRoute } from "../registry"
import { TICKS_PER_SECOND, playbackCalls, playbackReportOf, positionTicks } from "./playback"
import { forgetServerSource } from "./source"

type Json = Record<string, unknown>
const BASE = "https://media.example/jellyfin"
const TOKEN = "made-up-server-token"
const PASSWORD = "made-up-password-7f3"

const now = Date.UTC(2026, 10, 25)
let database: CoreDatabase | null = null
/** Set: the server never answers a report (the fetch ignores the signal, as a stuck one would) */
let silent = false
/** Set: the server answers the session reports with this code */
let sessionsFail = 0
let sent: { path: string, url: string, method: string, body: Json | null, head: string }[] = []
let background: Promise<unknown>[] = []
const secrets = new Map<string, string>()

const answer = (code: number, data: unknown) => ({ status: code, headers: { get: () => null }, text: async () => (data === null ? "" : JSON.stringify(data)) })

const httpFetch = (async (url: string, init: { method?: string, body?: string, headers?: unknown }) => {
    if (!url.startsWith(BASE)) throw new TypeError(`no network in tests: ${url}`)
    const path = url.slice(BASE.length).split("?")[0]
    if (path === "/System/Info/Public") return answer(200, { Id: "srv-9", ServerName: "Home Jellyfin" })
    if (path === "/Users/AuthenticateByName") {
        const login = JSON.parse(init.body ?? "{}") as { Pw?: string }
        return login.Pw === PASSWORD ? answer(200, { AccessToken: TOKEN, ServerId: "srv-9", User: { Id: "u9", ServerId: "srv-9" } }) : answer(401, {})
    }
    if (path === "/Items") return answer(200, { Items: [], TotalRecordCount: 0 })
    if (!path.startsWith("/Sessions/Playing") && !path.startsWith("/UserPlayedItems/")) return answer(404, {})
    const headers = init.headers instanceof Headers ? Object.fromEntries(init.headers.entries()) : init.headers
    sent.push({ path, url, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) as Json : null, head: JSON.stringify(headers) })
    if (silent) return new Promise(() => undefined)
    if (path.startsWith("/Sessions/Playing")) return sessionsFail ? answer(sessionsFail, {}) : answer(204, null)
    return answer(200, { Played: true })
}) as unknown as HttpFetch

const environment = {
    fetch: httpFetch,
    secret: async (name: string) => secrets.get(name) ?? null,
    keepSecret: async (name: string, value: string | null) => void (value === null ? secrets.delete(name) : secrets.set(name, value)),
    database: async () => database ??= await openCoreDatabase(sqlDriverFor(openDatabaseSync("core.db") as never), () => now),
    now: () => now,
    pause: async () => {},
    unasked: (_what: string, work: () => Promise<unknown>) => {
        const running = work()
        background.push(running)
        return running
    },
} as unknown as CoreEnvironment

async function call(method: string, endpoint: string, body: unknown = null): Promise<unknown> {
    const matched = matchCoreRoute(method, endpoint)
    if (!matched) throw new Error(`no route ${method} ${endpoint}`)
    return await matched.route.answer({ path: matched.path, query: null, body }, environment)
}

async function signIn(sendProgress = true) {
    await call("POST", "/api/v1/mediaserver/login", { url: BASE, username: "made", password: PASSWORD })
    await Promise.allSettled(background)
    await call("PATCH", "/api/v1/mediaserver/settings", { sendProgress })
}

const report = (kind: string, more: Json = {}) => call("POST", "/api/v1/mediaserver/playback", {
    kind, episodeId: "ep1", mediaSourceId: "ep1-src", playSessionId: "play-1", positionSeconds: 20, paused: false, watched: false, ...more,
})

beforeEach(() => {
    forgetDatabases()
    forgetServerSource()
    database = null
    silent = false
    sessionsFail = 0
    sent = []
    background = []
    secrets.clear()
})

afterEach(() => {
    vi.useRealTimers()
})

describe("the unit and the calls", () => {
    it("a second is ten million ticks, as measured on the server (a 60.023 s episode has 600,230,000)", () => {
        expect(TICKS_PER_SECOND).toBe(10_000_000)
        expect(positionTicks(60.023)).toBe(600_230_000)
        expect(positionTicks(20)).toBe(200_000_000)
        expect(positionTicks(0.00000004)).toBe(0)
        expect(positionTicks(-3)).toBe(0)
        expect(positionTicks(Number.NaN)).toBe(0)
    })

    it("a request without kind or episode is no report", () => {
        expect(playbackReportOf(null)).toBeNull()
        expect(playbackReportOf({ kind: "progress" })).toBeNull()
        expect(playbackReportOf({ kind: "rewind", episodeId: "ep1" })).toBeNull()
        expect(playbackReportOf({ kind: "stop", episodeId: "ep1" })).toEqual({ kind: "stop", episodeId: "ep1", mediaSourceId: "ep1", playSessionId: "", positionSeconds: 0, paused: false, watched: false })
    })

    it("watched at the end goes after the stop, which would leave a position to resume from", () => {
        const stop = playbackReportOf({ kind: "stop", episodeId: "e/1", watched: true, positionSeconds: 1200 })
        expect(playbackCalls(stop!, "u9").map(one => one.path)).toEqual(["/Sessions/Playing/Stopped", "/UserPlayedItems/e%2F1"])
    })
})

describe("POST /api/v1/mediaserver/playback", () => {
    it("tells the server start, position and end", async () => {
        await signIn()
        expect(await report("start", { positionSeconds: 0 })).toBe(true)
        expect(await report("progress", { positionSeconds: 20, paused: true })).toBe(true)
        expect(await report("stop", { positionSeconds: 31.5 })).toBe(true)
        const playing = { ItemId: "ep1", MediaSourceId: "ep1-src", PlaySessionId: "play-1", PlayMethod: "DirectPlay", CanSeek: true }
        expect(sent.map(one => [one.method, one.path, one.body])).toEqual([
            ["POST", "/Sessions/Playing", { ...playing, PositionTicks: 0, IsPaused: false }],
            ["POST", "/Sessions/Playing/Progress", { ...playing, PositionTicks: 200_000_000, IsPaused: true }],
            ["POST", "/Sessions/Playing/Stopped", { ItemId: "ep1", MediaSourceId: "ep1-src", PlaySessionId: "play-1", PositionTicks: 315_000_000 }],
        ])
    })

    it("marks the episode played for the signed-in user: alone, and after the stop of a watched episode", async () => {
        await signIn()
        expect(await report("watched")).toBe(true)
        expect(await report("stop", { watched: true })).toBe(true)
        expect(sent.map(one => one.path)).toEqual(["/UserPlayedItems/ep1", "/Sessions/Playing/Stopped", "/UserPlayedItems/ep1"])
        expect(sent[0].url).toBe(`${BASE}/UserPlayedItems/ep1?userId=u9`)
        expect(sent[0].method).toBe("POST")
    })

    it("carries the token in the header only", async () => {
        await signIn()
        await report("start")
        await report("watched")
        expect(sent).toHaveLength(2)
        for (const one of sent) {
            expect(one.head).toContain(TOKEN)
            expect(one.url).not.toContain(TOKEN)
            expect(JSON.stringify(one.body)).not.toContain(TOKEN)
        }
    })

    it("sends nothing while the switch is off", async () => {
        await signIn(false)
        for (const kind of ["start", "progress", "watched", "stop"]) expect(await report(kind, { watched: true })).toBe(false)
        expect(sent).toEqual([])
        await call("PATCH", "/api/v1/mediaserver/settings", { sendProgress: true })
        expect(await report("progress")).toBe(true)
        expect(sent).toHaveLength(1)
    })

    it("sends nothing when no one is signed in", async () => {
        expect(await report("start")).toBe(false)
        expect(sent).toEqual([])
    })

    it("a refusing server is no error for the player, and watched still goes", async () => {
        await signIn()
        sessionsFail = 500
        expect(await report("progress")).toBe(false)
        expect(await report("stop", { watched: true })).toBe(false)
        expect(sent.map(one => one.path)).toEqual(["/Sessions/Playing/Progress", "/Sessions/Playing/Stopped", "/UserPlayedItems/ep1"])
        sessionsFail = 401
        expect(await report("start")).toBe(false)
    })

    it("a server that never answers is given up; meanwhile positions are dropped instead of piling up", async () => {
        await signIn()
        vi.useFakeTimers()
        silent = true
        const start = report("start")
        const first = report("progress", { positionSeconds: 10 })
        // two already wait: this one is dropped at once
        expect(await report("progress", { positionSeconds: 20 })).toBe(false)
        // the end is never dropped
        const stop = report("stop", { positionSeconds: 21 })
        await vi.advanceTimersByTimeAsync(60_000)
        expect(await Promise.all([start, first, stop])).toEqual([false, false, false])
        expect(sent.map(one => one.path)).toEqual(["/Sessions/Playing", "/Sessions/Playing/Progress", "/Sessions/Playing/Stopped"])
        // afterwards reports go again
        silent = false
        expect(await report("progress", { positionSeconds: 30 })).toBe(true)
    })
})
