// geschrieben nach: source.test.ts (Test-Double des Servers, Umgebung) und server-settings.ts; Server, Namen, Token und Passwort sind erfunden

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { sqlDriverFor } from "@/api/client/core-database"
import { forgetDatabases, openDatabaseSync } from "../../../test/expo-sqlite"
import type { HttpFetch } from "../anilist/client"
import { type CoreDatabase, openCoreDatabase } from "../database/database"
import { mediaserverSeries, settingsSections } from "../database/schema"
import { type CoreEnvironment, matchCoreRoute } from "../registry"
import { MEDIASERVER_TOKEN_SECRET, forgetServerSource, refreshServerLibrary, serverSettingsOf } from "./source"

type Json = Record<string, unknown>
const BASE = "https://media.example/jellyfin"
const TOKEN = "made-up-server-token"
const PASSWORD = "made-up-password-7f3"

let now = Date.UTC(2026, 10, 25)
let database: CoreDatabase | null = null
/** Set: the server never answers (the fetch ignores the signal, as a stuck one would) */
let silent = false
let calls: string[] = []
let background: Promise<unknown>[] = []
const secrets = new Map<string, string>()

const answer = (code: number, data: unknown) => ({ status: code, headers: { get: () => null }, text: async () => JSON.stringify(data) })

const httpFetch = (async (url: string, init: { body?: string }) => {
    if (!url.startsWith(BASE)) throw new TypeError(`no network in tests: ${url}`)
    calls.push(url)
    if (silent) return new Promise(() => undefined)
    const path = url.slice(BASE.length).split("?")[0]
    if (path === "/System/Info/Public") return answer(200, { Id: "srv-9", ServerName: "Home Jellyfin" })
    if (path === "/Users/AuthenticateByName") {
        const sent = JSON.parse(init.body ?? "{}") as { Pw?: string }
        return sent.Pw === PASSWORD ? answer(200, { AccessToken: TOKEN, ServerId: "srv-9", User: { Id: "u9", ServerId: "srv-9" } }) : answer(401, {})
    }
    if (path === "/Items") return answer(200, { Items: [{ Id: "sA", Type: "Series", Name: "Crimson Harbor", ProductionYear: 2020, ProviderIds: {}, Path: "" }], TotalRecordCount: 1 })
    const [, id, kind] = /^\/Shows\/([^/]+)\/(Seasons|Episodes)$/.exec(path) ?? []
    if (kind === "Seasons") return answer(200, { Items: [{ Id: `${id}-s1`, SeriesId: id, IndexNumber: 1, Name: "Season 1", ProductionYear: 2020, ProviderIds: {} }] })
    if (kind === "Episodes") return answer(200, { Items: [] })
    return answer(404, {})
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

async function call(method: string, endpoint: string, body: unknown = null): Promise<Json> {
    const matched = matchCoreRoute(method, endpoint)
    if (!matched) throw new Error(`no route ${method} ${endpoint}`)
    return await matched.route.answer({ path: matched.path, query: null, body }, environment) as Json
}

const signIn = (password = PASSWORD, url = BASE) => call("POST", "/api/v1/mediaserver/login", { url, username: "made", password })

/** Everything the core keeps: the settings rows and the safe store */
async function kept(): Promise<string> {
    const rows = await (await environment.database()).select().from(settingsSections)
    return JSON.stringify(rows) + JSON.stringify([...secrets.values()])
}

async function seriesRows() {
    return (await (await environment.database()).select().from(mediaserverSeries)).length
}

beforeEach(() => {
    forgetDatabases()
    forgetServerSource()
    database = null
    silent = false
    calls = []
    background = []
    secrets.clear()
    now = Date.UTC(2026, 10, 25)
})

afterEach(async () => {
    vi.useRealTimers()
    await Promise.all(background.map(work => work.catch(() => undefined)))
})

describe("the media server's settings routes", () => {
    it("signs in, keeps the token only in the safe store and never the password", async () => {
        const status = await signIn()
        expect(status).toMatchObject({ signedIn: true, serverName: "Home Jellyfin", username: "made", url: BASE })
        expect(secrets.get(MEDIASERVER_TOKEN_SECRET)).toBe(TOKEN)
        const rows = JSON.stringify(await (await environment.database()).select().from(settingsSections))
        expect(rows).not.toContain(TOKEN)
        expect(await kept()).not.toContain(PASSWORD)
        expect(JSON.stringify(status)).not.toContain(TOKEN)
    })

    it("answers a wrong password with 422 and changes nothing", async () => {
        await expect(signIn("wrong")).rejects.toMatchObject({ status: 422, message: "Wrong username or password" })
        expect(secrets.size).toBe(0)
        expect(await kept()).not.toContain("wrong")
        expect((await serverSettingsOf(environment)).url).toBe("")
        expect(await call("GET", "/api/v1/mediaserver/status")).toMatchObject({ signedIn: false })
    })

    it("answers a server that stays silent with 504 after the time limit and changes nothing", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
        silent = true
        const failing = expect(signIn()).rejects.toMatchObject({ status: 504 })
        await vi.advanceTimersByTimeAsync(10_000)
        await failing
        expect(secrets.size).toBe(0)
        expect((await serverSettingsOf(environment)).url).toBe("")
    })

    it("signs out: the token, the server's settings and the kept series go", async () => {
        await signIn()
        await refreshServerLibrary(environment)
        expect(await seriesRows()).toBeGreaterThan(0)
        const status = await call("POST", "/api/v1/mediaserver/logout")
        expect(status).toMatchObject({ signedIn: false, serverName: "", username: "", url: "", series: 0, unmatched: [] })
        expect(secrets.has(MEDIASERVER_TOKEN_SECRET)).toBe(false)
        expect(await serverSettingsOf(environment)).toMatchObject({ serverId: "", url: "", userId: "", username: "" })
        expect(await seriesRows()).toBe(0)
    })

    it("answers the status without token or password", async () => {
        await signIn()
        const status = await call("GET", "/api/v1/mediaserver/status")
        expect(status.signedIn).toBe(true)
        const text = JSON.stringify(status)
        expect(text).not.toContain(TOKEN)
        expect(text).not.toContain(PASSWORD)
        expect(Object.keys(status)).not.toEqual(expect.arrayContaining(["token"]))
        expect(Object.keys(status)).not.toEqual(expect.arrayContaining(["password"]))
    })

    it("answers an address that names no server with 400 and asks nobody", async () => {
        for (const url of ["", "media.example", "ftp://media.example", "http://", "http://user@media.example", "https://media example"]) {
            await expect(signIn(PASSWORD, url)).rejects.toMatchObject({ status: 400 })
        }
        expect(calls).toEqual([])
        expect(secrets.size).toBe(0)
    })
})
