// geschrieben nach: docs/EIGENER-KERN.md §4p (Phase 5c-1: ohne Server) und der Aufzeichnung SETTINGS.GettingStarted vom 13.11.2026 (Felder des Status); kein Server-Quelltext
import { beforeEach, describe, expect, it } from "vitest"
import { sqlDriverFor } from "@/api/client/core-database"
import { forgetDatabases, openDatabaseSync } from "../../../test/expo-sqlite"
import { type CoreDatabase, openCoreDatabase } from "../database/database"
import { account, serverAnswers, settingsSections } from "../database/schema"
import { coreAnswerFor } from "../index"
import type { CoreEnvironment } from "../registry"

/*
 * The app without its server (phase 5c-1): every area counts as on, the status is the core's alone and nothing waits
 * for the server; the server is never asked. Every personal value is made up.
 */

type Json = Record<string, any>

const STATUS = "/api/v1/status"

let database: Promise<CoreDatabase> | null = null
let token: string | null = null
let asked: string[] = []

const environment: CoreEnvironment = {
    fetch: async () => {
        throw new Error("the start needs no network")
    },
    secret: async name => (name === "seanime-core.account-token" ? token : null),
    database: () => database ??= openCoreDatabase(sqlDriverFor(openDatabaseSync("core.db") as never), () => 1000),
    now: () => 1000,
    pause: async () => undefined,
}

function answer(method: "GET" | "POST", endpoint: string, body: unknown = null): Promise<Json> {
    const found = coreAnswerFor(method, endpoint)
    expect(found, endpoint).not.toBeNull()
    return found!({ query: null, body }, environment) as Promise<Json>
}

beforeEach(() => {
    forgetDatabases()
    database = null
    token = null
    asked = []
})

describe("without the server", () => {

    it("first start with an empty store: no settings, the user without an account, ready, nothing held back", async () => {
        const status = await answer("GET", STATUS)
        expect(status.settings).toBeNull()
        expect(status.user).toEqual({ viewer: { name: "Guest" }, token: "", isSimulated: true })
        expect(status.serverReady).toBe(true)
        expect(status.updating).toBe(false)
        expect(status.os).toBe("android")
        expect(status.debridSettings.apiKey).toBe("")
        expect(status.torrentstreamSettings.enabled).toBe(false)
        expect(asked).toEqual([])
    })

    it("the first start's settings are kept and answered with the core's status, without the server", async () => {
        const status = await answer("POST", "/api/v1/start", {})
        expect(status.settings).not.toBeNull()
        expect(status.serverReady).toBe(true)
        expect((await answer("GET", STATUS)).settings).toEqual(status.settings)
        expect(asked).toEqual([])
    })

    it("an account with its token and the server's kept part: the signed-in user and the kept part", async () => {
        const opened = await environment.database()
        await opened.insert(settingsSections).values({ section: "library", content: { libraryPath: "" }, changedAt: 1 })
        await opened.insert(account).values({ id: 1, username: "tester", viewer: JSON.stringify({ name: "tester" }), createdAt: 1, changedAt: 1 })
        await opened.insert(serverAnswers).values({ question: STATUS, answer: { version: "9.9.9", serverReady: true, user: null, settings: null }, changedAt: 1 })
        token = "made-up-token"
        const status = await answer("GET", STATUS)
        expect(status.version).toBe("9.9.9")
        expect(status.user).toEqual({ viewer: { name: "tester" }, token: "", isSimulated: false })
        expect(status.settings).not.toBeNull()
        expect(status.serverReady).toBe(true)
        expect(asked).toEqual([])
    })

    it("an account without its token counts as none", async () => {
        const opened = await environment.database()
        await opened.insert(account).values({ id: 1, username: "tester", viewer: JSON.stringify({ name: "tester" }), createdAt: 1, changedAt: 1 })
        expect((await answer("GET", STATUS)).user.isSimulated).toBe(true)
    })
})
