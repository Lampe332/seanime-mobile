// geschrieben nach: Plan Web-Einstellungen Paket A1 (Seanime_Web_Einstellungen_Plan.md) und account-server/src/websync.ts putWebAccess/deleteWebAccess; ein Test-Double statt des Servers, Werte erfunden

import { createRequire } from "node:module"
import { beforeAll, describe, expect, it } from "vitest"
import { AccountApiError, AccountClient, type HttpFetch } from "./client"
import { DEFAULT_KDF, deriveKeys, fromB64, newDek, toB64 } from "./crypto"
import type { AccountDeps } from "./devices"
import { disableWebEdit, enableWebEdit } from "./flows"
import { AccountSession } from "./session"
import type { Sodium } from "./sodium"
import { bytes, memoryStore, ready } from "./__fixtures__/harness"

let sodium: Sodium
beforeAll(async () => {
    sodium = await ready(createRequire(import.meta.url)("libsodium-wrappers-sumo"))
})

const EMAIL = "web-edit@example.org"
const PASSWORD = "a long test password 2"
const USER = "0b8e7f52-4d3a-4c1e-8f6a-2a9d1c7e5b30"
const TOKEN = "w".repeat(43)
const DEK_ID = "dek-id-web-edit-000000"

type Seen = { method: string, path: string, headers: Record<string, string>, body: Uint8Array, json: Record<string, unknown> | null }
type Reply = { status?: number, json?: unknown }

/** The account server as a test double: answers by "METHOD path" and keeps every request it got */
function fakeServer(routes: Record<string, (request: Seen) => Reply>) {
    const seen: Seen[] = []
    const fetch: HttpFetch = async (url, init) => {
        const path = new URL(url).pathname
        const body = typeof init.body === "string" ? new TextEncoder().encode(init.body) : init.body ?? new Uint8Array(0)
        let json: Record<string, unknown> | null = null
        if (init.headers["Content-Type"] === "application/json") json = JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>
        const request = { method: init.method, path, headers: init.headers, body, json }
        seen.push(request)
        const route = routes[`${init.method} ${path}`]
        const reply = route ? route(request) : { status: 404, json: { error: "not_found" } }
        return {
            status: reply.status ?? (reply.json === undefined ? 204 : 200),
            headers: { get: () => null },
            json: async () => reply.json ?? {},
            arrayBuffer: async () => new ArrayBuffer(0),
        }
    }
    return { fetch, seen, last: (method: string, path: string) => seen.filter(request => request.method === method && request.path === path).at(-1) }
}

/** A device signed in to the account with its own row and the key; `email` null: a Google session */
async function signedIn(fetch: HttpFetch, email: string | null): Promise<AccountDeps> {
    const store = memoryStore()
    const session = new AccountSession(store, sodium)
    const client = new AccountClient({ baseUrl: "https://account.test", fetch, sodium, credentials: () => session.credentials(), now: () => 1_700_000_000_000 })
    await session.signer()
    await session.saveSession({ userId: USER, sessionToken: TOKEN, kind: email ? "email" : "google", email, deviceId: "dev-1" })
    await session.saveDek(DEK_ID, newDek(sodium))
    return { client, session, sodium }
}

const prelogin = (salt: Uint8Array) => () => ({ json: { salt: toB64(sodium, salt), kdf: DEFAULT_KDF, challenge: "challenge-1" } })
const accountInfo = (extra: Record<string, unknown> = {}) => () => ({
    json: { userId: USER, email: EMAIL, emailVerified: true, googleLinked: true, hasPassword: true, hasRecovery: true, dekId: DEK_ID, createdAt: 1, rewrapNeeded: false, rotationRequired: false, recoveryRenewalNeeded: false, ...extra },
})

describe("Edit on the website", () => {
    it("the client: on sends {authKey} or {}, off is a DELETE without a body, both with the session", async () => {
        const server = fakeServer({ "PUT /v1/account/web-access": () => ({}), "DELETE /v1/account/web-access": () => ({}) })
        const { client } = await signedIn(server.fetch, EMAIL)
        await client.putWebAccess("auth-b64")
        expect(server.last("PUT", "/v1/account/web-access")!.json).toEqual({ authKey: "auth-b64" })
        await client.putWebAccess()
        expect(server.last("PUT", "/v1/account/web-access")!.json).toEqual({})
        await client.deleteWebAccess()
        expect(server.last("DELETE", "/v1/account/web-access")!.body.length).toBe(0)
        for (const request of server.seen) {
            expect(request.headers.Authorization).toBe(`Bearer ${TOKEN}`)
            expect(typeof request.headers["X-SM-Sig"]).toBe("string")
        }
    })

    it("the account says whether it is on", async () => {
        const server = fakeServer({ "GET /v1/account": accountInfo({ webEdit: true }) })
        const { client } = await signedIn(server.fetch, EMAIL)
        expect((await client.account()).webEdit).toBe(true)
    })

    it("on with a password: only the authKey from the account's salt goes along, never the key", async () => {
        const salt = bytes(16, 41)
        const server = fakeServer({ "POST /v1/auth/prelogin": prelogin(salt), "PUT /v1/account/web-access": () => ({}) })
        const d = await signedIn(server.fetch, EMAIL)
        await enableWebEdit(d, { password: PASSWORD })
        const { authKey } = await deriveKeys(sodium, PASSWORD, salt, DEFAULT_KDF)
        expect(server.last("POST", "/v1/auth/prelogin")!.json).toEqual({ email: EMAIL })
        expect(server.last("PUT", "/v1/account/web-access")!.json).toEqual({ authKey: toB64(sodium, authKey) })
        expect(fromB64(sodium, server.last("PUT", "/v1/account/web-access")!.json!.authKey as string)).toHaveLength(32)
    })

    it("on with a password from a Google session: the address comes from the account", async () => {
        const salt = bytes(16, 42)
        const server = fakeServer({ "GET /v1/account": accountInfo(), "POST /v1/auth/prelogin": prelogin(salt), "PUT /v1/account/web-access": () => ({}) })
        const d = await signedIn(server.fetch, null)
        await enableWebEdit(d, { password: PASSWORD })
        const { authKey } = await deriveKeys(sodium, PASSWORD, salt, DEFAULT_KDF)
        expect(server.last("POST", "/v1/auth/prelogin")!.json).toEqual({ email: EMAIL })
        expect(server.last("PUT", "/v1/account/web-access")!.json).toEqual({ authKey: toB64(sodium, authKey) })
    })

    it("on without a password (Google only): one PUT with {}, nothing else", async () => {
        const server = fakeServer({ "PUT /v1/account/web-access": () => ({}) })
        const d = await signedIn(server.fetch, null)
        await enableWebEdit(d, {})
        expect(server.seen.map(request => `${request.method} ${request.path}`)).toEqual(["PUT /v1/account/web-access"])
        expect(server.seen[0]!.json).toEqual({})
    })

    for (const error of ["wrong_password", "device_required", "reauth_required", "app_required"]) {
        it(`on: the server's 403 ${error} reaches the screen with its code`, async () => {
            const server = fakeServer({
                "POST /v1/auth/prelogin": prelogin(bytes(16, 43)),
                "PUT /v1/account/web-access": () => ({ status: 403, json: { error, message: "x" } }),
            })
            const d = await signedIn(server.fetch, EMAIL)
            const failure: unknown = await enableWebEdit(d, { password: PASSWORD }).catch((caught: unknown) => caught)
            expect(failure).toBeInstanceOf(AccountApiError)
            expect(failure).toMatchObject({ status: 403, code: error })
        })
    }

    it("off: one DELETE, nothing else", async () => {
        const server = fakeServer({ "DELETE /v1/account/web-access": () => ({}) })
        const d = await signedIn(server.fetch, EMAIL)
        await disableWebEdit(d)
        expect(server.seen.map(request => `${request.method} ${request.path}`)).toEqual(["DELETE /v1/account/web-access"])
    })
})
