// geschrieben nach: App-Code anilist-login-mobile.tsx/settings-app.tsx (Anmelden mit Token, Abmelden, Antwort = Status), öffentliche AniList-Doku (Viewer) und docs/EIGENER-KERN.md §4p; kein Server-Quelltext
import { beforeEach, describe, expect, it } from "vitest"
import { sqlDriverFor } from "@/api/client/core-database"
import { forgetDatabases, openDatabaseSync } from "../../../test/expo-sqlite"
import { type CoreDatabase, openCoreDatabase } from "../database/database"
import { account, anilistListEntries, anilistMedia } from "../database/schema"
import { ACCOUNT_TOKEN_SECRET } from "../move/move"
import { type CoreEnvironment, type CoreMethod, matchCoreRoute } from "../registry"
import { OTHER_ACCOUNT_REFUSED } from "./auth"
import { ANILIST_URL, type HttpFetch } from "./client"

/* Signing in and out in the core (phase 5a-3). Names, numbers and tokens are made up. */

type Json = Record<string, unknown>

const now = Date.UTC(2026, 10, 14)
let database: CoreDatabase | null = null
let secrets = new Map<string, string>()
let told: string[] = []
let only: number | null = null
let tokensSeen: string[] = []

const httpFetch: HttpFetch = async (url, init) => {
    if (url !== ANILIST_URL) throw new TypeError(`no network in tests: ${url}`)
    tokensSeen.push(init.headers?.Authorization ?? "")
    const viewer = { id: 77, name: "Made Up", avatar: { large: "https://img.example/l.png", medium: "https://img.example/m.png" }, isBlocked: false, options: { displayAdultContent: false, airingNotifications: true, profileColor: "blue" } }
    return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ data: { Viewer: viewer } }) }
}

const environment = {
    fetch: httpFetch,
    secret: async (name: string) => secrets.get(name) ?? null,
    keepSecret: async (name: string, value: string | null) => void (value === null ? secrets.delete(name) : secrets.set(name, value)),
    server: async (method: CoreMethod, endpoint: string) => {
        told.push(`${method} ${endpoint}`)
        return { serverReady: true, user: null }
    },
    onlyAccount: () => only,
    database: async () => database ??= await openCoreDatabase(sqlDriverFor(openDatabaseSync("core.db") as never), () => now),
    now: () => now,
    pause: async () => undefined,
} as unknown as CoreEnvironment

async function post(endpoint: string, body: unknown = null): Promise<unknown> {
    const matched = matchCoreRoute("POST", endpoint)
    if (!matched) throw new Error(`no route: ${endpoint}`)
    expect(matched.route.area).toBe("anilist")
    return matched.route.answer({ path: matched.path, query: null, body }, environment)
}

beforeEach(() => {
    forgetDatabases()
    database = null
    secrets = new Map()
    told = []
    only = null
    tokensSeen = []
})

describe("auth", () => {
    it("signs in: token in the secured storage, viewer in the account, server told, status answered", async () => {
        const status = await post("/api/v1/auth/login", { token: " made-up-token " }) as Json
        expect(secrets.get(ACCOUNT_TOKEN_SECRET)).toBe("made-up-token")
        expect(tokensSeen[0]).toContain("made-up-token")
        const opened = await environment.database()
        const [row] = await opened.select().from(account)
        expect(row.username).toBe("Made Up")
        // the recorded viewer of the status has no id
        expect(Object.keys(JSON.parse(row.viewer ?? "{}") as Json).sort()).toEqual(["avatar", "isBlocked", "name", "options"])
        expect(status.serverReady).toBe(true)
    })

    it("forgets the kept lists when another account signs in", async () => {
        const opened = await environment.database()
        await opened.insert(account).values({ id: 1, username: "Someone Else", viewer: "{}", createdAt: now, changedAt: now })
        const [media] = await opened.insert(anilistMedia).values({ anilistId: 5, kind: "ANIME", content: { id: 5 }, changedAt: now }).returning({ id: anilistMedia.id })
        await opened.insert(anilistListEntries).values({ anilistId: 1, media: media.id, kind: "ANIME", list: 0, position: 0, content: {}, changedAt: now })
        await post("/api/v1/auth/login", { token: "t" })
        expect(await opened.select().from(anilistListEntries)).toEqual([])
    })

    it("signs in the test account only, when the app names one", async () => {
        only = 12
        await expect(post("/api/v1/auth/login", { token: "t" })).rejects.toThrow(OTHER_ACCOUNT_REFUSED)
        expect(secrets.size).toBe(0)
        expect(told).toEqual([])
        only = 77
        await post("/api/v1/auth/login", { token: "t" })
        expect(secrets.get(ACCOUNT_TOKEN_SECRET)).toBe("t")
    })

    it("refuses a missing token", async () => {
        await expect(post("/api/v1/auth/login", {})).rejects.toThrow("missing token")
    })

    it("signs out: token and account gone, server told", async () => {
        await post("/api/v1/auth/login", { token: "t" })
        told = []
        await post("/api/v1/auth/logout")
        expect(secrets.has(ACCOUNT_TOKEN_SECRET)).toBe(false)
        expect(await (await environment.database()).select().from(account)).toEqual([])
    })
})
