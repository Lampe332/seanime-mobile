// geschrieben nach: dem Vertrag Code-Login (Seanime_CodeLogin_Vertrag.md, Abschnitte 1-5) und core/account/{client,flows,devices}.ts; ein Test-Double statt des Servers, Werte erfunden

import { createRequire } from "node:module"
import { beforeAll, describe, expect, it } from "vitest"
import { AccountClient, type HttpFetch, UnauthorizedError } from "./client"
import {
    DEFAULT_KDF, dekProof, deriveKeys, deviceMac, fromB64, newDek, newDeviceKeyPair, newRecoveryCode, toB64, unwrapKey, wrapKey,
} from "./crypto"
import type { AccountDeps } from "./devices"
import { changeKey, disableCodeOnly, enableCodeOnly, loginWithCode, requestSignInCode, setNewPasswordAfterCode, startFresh, useRecoveryCode } from "./flows"
import { AccountSession } from "./session"
import type { Sodium } from "./sodium"
import { bytes, memoryStore, ready } from "./__fixtures__/harness"

let sodium: Sodium
beforeAll(async () => {
    sodium = await ready(createRequire(import.meta.url)("libsodium-wrappers-sumo"))
})

const EMAIL = "code-test@example.org"
const PASSWORD = "a long test password 1"
const USER = "6f1c2c1e-0d7b-4c3a-9a51-2f0e7d4b8a10"
const TOKEN = "s".repeat(43)
const DEK_ID = "dek-id-current-0000000"

type Seen = { method: string, path: string, headers: Record<string, string>, body: Uint8Array, json: Record<string, unknown> | null }
type Reply = { status?: number, json?: unknown, headers?: Record<string, string> }

/** The account server as a test double: answers by "METHOD path" and keeps every request it got */
function fakeServer(routes: Record<string, (request: Seen) => Reply>) {
    const seen: Seen[] = []
    const fetch: HttpFetch = async (url, init) => {
        const path = new URL(url).pathname
        const body = typeof init.body === "string" ? new TextEncoder().encode(init.body) : init.body ?? new Uint8Array(0)
        const text = new TextDecoder().decode(body)
        let json: Record<string, unknown> | null = null
        if (init.headers["Content-Type"] === "application/json") json = JSON.parse(text) as Record<string, unknown>
        const request = { method: init.method, path, headers: init.headers, body, json }
        seen.push(request)
        const route = routes[`${init.method} ${path}`]
        const reply = route ? route(request) : { status: 404, json: { error: "not_found" } }
        const status = reply.status ?? (reply.json === undefined ? 204 : 200)
        return {
            status,
            headers: { get: (name: string) => reply.headers?.[name] ?? null },
            json: async () => reply.json ?? {},
            arrayBuffer: async () => new ArrayBuffer(0),
        }
    }
    return { fetch, seen, last: (method: string, path: string) => seen.filter(request => request.method === method && request.path === path).at(-1) }
}

function deps(fetch: HttpFetch, store = memoryStore()): AccountDeps & { store: ReturnType<typeof memoryStore> } {
    const session = new AccountSession(store, sodium)
    const client = new AccountClient({ baseUrl: "https://account.test", fetch, sodium, credentials: () => session.credentials(), now: () => 1_700_000_000_000 })
    return { client, session, sodium, store }
}

/** The signed text of account-server/src/signature.ts for one request the double got */
function signedText(request: Seen, sessionId: string): Uint8Array {
    const hex = Array.from(sodium.crypto_hash_sha256(request.body), byte => byte.toString(16).padStart(2, "0")).join("")
    return new TextEncoder().encode(["v1", request.method, request.path, hex, request.headers["X-SM-Ts"], request.headers["X-SM-Nonce"], sessionId].join("\n"))
}

const prelogin = (salt = bytes(16, 7)) => () => ({ json: { salt: toB64(sodium, salt), kdf: DEFAULT_KDF, challenge: "challenge-1" } })
const accountInfo = (extra: Record<string, unknown> = {}) => () => ({
    json: { userId: USER, email: EMAIL, emailVerified: true, googleLinked: false, hasPassword: true, hasRecovery: true, dekId: DEK_ID, createdAt: 1, rewrapNeeded: false, rotationRequired: false, recoveryRenewalNeeded: false, ...extra },
})
const codeAnswer = (extra: Record<string, unknown>) => () => ({
    json: { userId: USER, emailVerified: true, kdf: DEFAULT_KDF, wrappedDek: "wrapped", dekId: DEK_ID, rewrapNeeded: false, sessionToken: TOKEN, codeLogin: true, escrowDek: null, ...extra },
})

/** Another device of the account, its row made by a holder of `dek` */
function otherDeviceRow(dek: Uint8Array, dekId = DEK_ID) {
    const pub = newDeviceKeyPair(sodium).publicKey
    return { id: "dev-other", name: "Pixel", createdAt: 1, lastSeenAt: 1, current: false, devicePub: toB64(sodium, pub), dekId, mac: deviceMac(sodium, dek, { userId: USER, dekId, devicePub: pub }) }
}

describe("the code sign-in calls (contract 1-4)", () => {
    it("asking for a code sends only the email, with no session and no signature", async () => {
        const server = fakeServer({ "POST /v1/auth/code/request": () => ({ json: { sent: true } }) })
        const { client } = deps(server.fetch)
        expect(await client.requestCode(EMAIL)).toEqual({ sent: true })
        const request = server.last("POST", "/v1/auth/code/request")!
        expect(request.json).toEqual({ email: EMAIL })
        expect(request.headers.Authorization).toBeUndefined()
        expect(request.headers["X-SM-Sig"]).toBeUndefined()
    })

    it("signing in with a code is signed like login: the new key, session id \"-\", its public half in sigKey", async () => {
        const server = fakeServer({ "POST /v1/auth/code/login": codeAnswer({}) })
        const { client, session } = deps(server.fetch)
        const signer = await session.signer()
        const answer = await client.codeLogin(EMAIL, "012345", "challenge-1", signer)
        expect(answer.codeLogin).toBe(true)
        const request = server.last("POST", "/v1/auth/code/login")!
        expect(request.json).toEqual({ email: EMAIL, code: "012345", challenge: "challenge-1", sigKey: { alg: "ed25519", pub: toB64(sodium, signer.publicKey) } })
        expect(request.headers.Authorization).toBeUndefined()
        const signature = fromB64(sodium, request.headers["X-SM-Sig"]!)
        expect(sodium.crypto_sign_verify_detached(signature, signedText(request, "-"), signer.publicKey)).toBe(true)
    })

    it("a wrong or expired code is a 401 invalid_code", async () => {
        const server = fakeServer({ "POST /v1/auth/code/login": () => ({ status: 401, json: { error: "invalid_code", message: "The code is wrong or expired." } }) })
        const { client, session } = deps(server.fetch)
        const failure: unknown = await client.codeLogin(EMAIL, "000000", "challenge-1", await session.signer()).catch((error: unknown) => error)
        expect(failure).toBeInstanceOf(UnauthorizedError)
        expect((failure as UnauthorizedError).code).toBe("invalid_code")
    })

    it("escrow on and off and the new password go with the session, signed with its key", async () => {
        const server = fakeServer({
            "PUT /v1/account/escrow": () => ({}),
            "DELETE /v1/account/escrow": () => ({}),
            "POST /v1/account/password/after-code": () => ({}),
        })
        const { client, session } = deps(server.fetch)
        const signer = await session.signer()
        await session.saveSession({ userId: USER, sessionToken: TOKEN, kind: "email", email: EMAIL, deviceId: "dev-1" })
        await client.putEscrow("dek-b64", "proof-b64", "auth-b64")
        await client.deleteEscrow()
        const body = { authKey: "a", salt: "s", kdf: DEFAULT_KDF, wrappedDek: "w", dekId: DEK_ID }
        await client.setPasswordAfterCode(body)
        const sessionId = toB64(sodium, sodium.crypto_hash_sha256(new TextEncoder().encode(TOKEN)))
        expect(server.last("PUT", "/v1/account/escrow")!.json).toEqual({ dek: "dek-b64", dekProof: "proof-b64", authKey: "auth-b64" })
        expect(server.last("POST", "/v1/account/password/after-code")!.json).toEqual(body)
        for (const request of server.seen) {
            expect(request.headers.Authorization).toBe(`Bearer ${TOKEN}`)
            expect(sodium.crypto_sign_verify_detached(fromB64(sodium, request.headers["X-SM-Sig"]!), signedText(request, sessionId), signer.publicKey)).toBe(true)
        }
        expect(server.last("DELETE", "/v1/account/escrow")!.body.length).toBe(0)
    })
})

describe("loginWithCode", () => {
    it("asks for a code without a session", async () => {
        const server = fakeServer({ "POST /v1/auth/code/request": () => ({ json: { sent: true } }) })
        await requestSignInCode(deps(server.fetch), EMAIL)
        expect(server.last("POST", "/v1/auth/code/request")!.json).toEqual({ email: EMAIL })
    })

    it("with escrowDek: takes the key the account's devices vouch for and registers this device; ready", async () => {
        const dek = newDek(sodium)
        const server = fakeServer({
            "POST /v1/auth/prelogin": prelogin(),
            "POST /v1/auth/code/login": codeAnswer({ escrowDek: toB64(sodium, dek) }),
            "GET /v1/account": accountInfo({ codeOnly: true }),
            "GET /v1/devices": () => ({ json: { devices: [otherDeviceRow(dek)] } }),
            "PUT /v1/account/keys": () => ({ json: { dekId: DEK_ID, deviceId: "dev-new" } }),
        })
        const d = deps(server.fetch)
        const result = await loginWithCode(d, { email: EMAIL, code: "123456", deviceName: "Tab S9" })
        expect(result).toMatchObject({ status: "ready", escrow: true, userId: USER })
        expect(server.last("POST", "/v1/auth/code/login")!.json).toMatchObject({ email: EMAIL, code: "123456", challenge: "challenge-1" })
        const keys = server.last("PUT", "/v1/account/keys")!.json!
        expect(keys).toMatchObject({ dekId: DEK_ID, dekProof: dekProof(sodium, dek) })
        expect(keys.recoveryProof).toBeUndefined()
        const state = await d.session.load()
        expect(state).toMatchObject({ userId: USER, kind: "email", email: EMAIL, deviceId: "dev-new", dekId: DEK_ID, codeLogin: true })
        expect(toB64(sodium, state!.dek!)).toBe(toB64(sodium, dek))
    })

    it("with an escrowDek no device row vouches for: nothing is taken and the sign-in is undone", async () => {
        const dek = newDek(sodium)
        const invented = newDek(sodium)
        const server = fakeServer({
            "POST /v1/auth/prelogin": prelogin(),
            "POST /v1/auth/code/login": codeAnswer({ escrowDek: toB64(sodium, invented) }),
            "GET /v1/account": accountInfo(),
            "GET /v1/devices": () => ({ json: { devices: [otherDeviceRow(dek)] } }),
            "PUT /v1/account/keys": () => ({ json: { dekId: DEK_ID, deviceId: "dev-new" } }),
        })
        const d = deps(server.fetch)
        await expect(loginWithCode(d, { email: EMAIL, code: "123456", deviceName: "Tab S9" })).rejects.toMatchObject({ name: "UntrustedEscrowError" })
        expect(server.last("PUT", "/v1/account/keys")).toBeUndefined()
        expect(await d.session.load()).toBeNull()
        expect(await d.session.keptKey()).toBeNull()
    })

    it("without escrowDek: signed in with the data locked; the recovery code from the answer unlocks it", async () => {
        const dek = newDek(sodium)
        const { code, key } = newRecoveryCode(sodium)
        const recoveryWrappedDek = wrapKey(sodium, dek, key, USER, DEK_ID, "recovery")
        const server = fakeServer({
            "POST /v1/auth/prelogin": prelogin(),
            "POST /v1/auth/code/login": codeAnswer({ escrowDek: null, recoveryWrappedDek }),
            "GET /v1/account": accountInfo(),
            "PUT /v1/account/keys": () => ({ json: { dekId: DEK_ID, deviceId: "dev-new" } }),
        })
        const d = deps(server.fetch)
        const result = await loginWithCode(d, { email: EMAIL, code: "000123", deviceName: "Tab S9" })
        expect(result).toMatchObject({ status: "needs-key", escrow: false, recoveryWrappedDek })
        const locked = await d.session.load()
        expect(locked).toMatchObject({ userId: USER, sessionToken: TOKEN, dek: null, deviceId: null })
        expect(server.last("PUT", "/v1/account/keys")).toBeUndefined()

        await useRecoveryCode(d, { code, recoveryWrappedDek, dekId: DEK_ID, deviceName: "Tab S9" })
        expect(server.last("PUT", "/v1/account/keys")!.json).toMatchObject({ dekId: DEK_ID, dekProof: dekProof(sodium, dek) })
        expect(typeof server.last("PUT", "/v1/account/keys")!.json!.recoveryProof).toBe("string")
        expect(toB64(sodium, (await d.session.load())!.dek!)).toBe(toB64(sodium, dek))
    })

    it("a wrong code changes nothing on the device", async () => {
        const server = fakeServer({
            "POST /v1/auth/prelogin": prelogin(),
            "POST /v1/auth/code/login": () => ({ status: 401, json: { error: "invalid_code" } }),
        })
        const d = deps(server.fetch)
        await expect(loginWithCode(d, { email: EMAIL, code: "999999", deviceName: "Tab S9" })).rejects.toMatchObject({ code: "invalid_code" })
        expect(await d.session.load()).toBeNull()
    })

    it("an account without a password stays a Google session", async () => {
        const server = fakeServer({
            "POST /v1/auth/prelogin": prelogin(),
            "POST /v1/auth/code/login": codeAnswer({ wrappedDek: null }),
            "GET /v1/account": accountInfo({ hasPassword: false, googleLinked: true }),
        })
        const d = deps(server.fetch)
        expect((await loginWithCode(d, { email: EMAIL, code: "123456", deviceName: "Tab S9" })).status).toBe("needs-key")
        expect(await d.session.load()).toMatchObject({ kind: "google", email: null })
    })
})

/** A device signed in to the account with the DEK and its own verified row */
async function signedInDevice(fetch: HttpFetch, dek: Uint8Array) {
    const d = deps(fetch)
    await d.session.signer()
    await d.session.saveSession({ userId: USER, sessionToken: TOKEN, kind: "email", email: EMAIL, deviceId: "dev-1" })
    await d.session.saveDek(DEK_ID, dek)
    const keys = newDeviceKeyPair(sodium)
    await d.session.saveDeviceKeys(keys)
    const row = { id: "dev-1", name: "Tab S9", createdAt: 1, lastSeenAt: 1, current: true, devicePub: toB64(sodium, keys.publicKey), dekId: DEK_ID, mac: deviceMac(sodium, dek, { userId: USER, dekId: DEK_ID, devicePub: keys.publicKey }) }
    return { d, row }
}

describe("after a code sign-in", () => {
    it("a new password: new salt and KDF, its authKey, and the DEK wrapped for it under the same dekId", async () => {
        const dek = newDek(sodium)
        const server = fakeServer({ "POST /v1/account/password/after-code": () => ({}) })
        const { d } = await signedInDevice(server.fetch, dek)
        await setNewPasswordAfterCode(d, { newPassword: PASSWORD })
        const body = server.last("POST", "/v1/account/password/after-code")!.json as { authKey: string, salt: string, kdf: typeof DEFAULT_KDF, wrappedDek: string, dekId: string }
        expect(body.dekId).toBe(DEK_ID)
        expect(body.kdf).toEqual(DEFAULT_KDF)
        // the DEK proof goes along: a session without a device row needs it (403 key_required)
        expect((body as { dekProof?: string }).dekProof).toBe(dekProof(sodium, dek))
        const { authKey, encKey } = await deriveKeys(sodium, PASSWORD, fromB64(sodium, body.salt, 16), body.kdf)
        expect(body.authKey).toBe(toB64(sodium, authKey))
        expect(toB64(sodium, unwrapKey(sodium, body.wrappedDek, encKey, USER, DEK_ID, "password"))).toBe(toB64(sodium, dek))
        expect(await d.session.kdfFloor(EMAIL)).toEqual({ m: DEFAULT_KDF.m, t: DEFAULT_KDF.t })
    })

    it("Start fresh from a code session goes without the password and without a password wrap; a new password follows", async () => {
        let fresh: Record<string, unknown> | null = null
        const server = fakeServer({
            "POST /v1/auth/prelogin": prelogin(),
            "POST /v1/auth/code/login": codeAnswer({}),
            "GET /v1/account": accountInfo(),
            "POST /v1/account/start-fresh": request => {
                fresh = request.json
                return { json: { dekId: request.json!.dekId, deviceId: "dev-fresh" } }
            },
            "POST /v1/account/password/after-code": () => ({}),
        })
        const d = deps(server.fetch)
        expect((await loginWithCode(d, { email: EMAIL, code: "123456", deviceName: "Tab S9" })).status).toBe("needs-key")
        await startFresh(d, { deviceName: "Tab S9" })
        expect(server.last("POST", "/v1/auth/login")).toBeUndefined()
        expect(fresh).not.toBeNull()
        expect(fresh!.wrappedDek).toBeUndefined()
        const state = await d.session.load()
        expect(state).toMatchObject({ deviceId: "dev-fresh", dekId: fresh!.dekId })
        await setNewPasswordAfterCode(d, { newPassword: PASSWORD })
        expect(server.last("POST", "/v1/account/password/after-code")!.json).toMatchObject({ dekId: fresh!.dekId })
    })

    it("a password session still gives the password for Start fresh", async () => {
        const server = fakeServer({ "POST /v1/auth/prelogin": prelogin() })
        const { d } = await signedInDevice(server.fetch, newDek(sodium))
        await expect(startFresh(d, { deviceName: "Tab S9" })).rejects.toThrow(/password/)
    })

    it("a new password needs the unlocked key", async () => {
        const server = fakeServer({ "POST /v1/account/password/after-code": () => ({}) })
        const d = deps(server.fetch)
        await d.session.saveSession({ userId: USER, sessionToken: TOKEN, kind: "email", email: EMAIL, deviceId: null })
        await expect(setNewPasswordAfterCode(d, { newPassword: PASSWORD })).rejects.toThrow(/no key/)
        expect(server.seen).toHaveLength(0)
    })
})

describe("code only (escrow)", () => {
    it("on: the password's authKey from the account's salt and the DEK this device holds", async () => {
        const dek = newDek(sodium)
        const salt = bytes(16, 90)
        const server = fakeServer({ "POST /v1/auth/prelogin": prelogin(salt), "PUT /v1/account/escrow": () => ({}) })
        const { d } = await signedInDevice(server.fetch, dek)
        await enableCodeOnly(d, { password: PASSWORD })
        const { authKey } = await deriveKeys(sodium, PASSWORD, salt, DEFAULT_KDF)
        expect(server.last("PUT", "/v1/account/escrow")!.json).toEqual({ dek: toB64(sodium, dek), dekProof: dekProof(sodium, dek), authKey: toB64(sodium, authKey) })
    })

    it("off: one DELETE, nothing else", async () => {
        const server = fakeServer({ "DELETE /v1/account/escrow": () => ({}) })
        const { d } = await signedInDevice(server.fetch, newDek(sodium))
        await disableCodeOnly(d)
        expect(server.seen.map(request => `${request.method} ${request.path}`)).toEqual(["DELETE /v1/account/escrow"])
    })

    for (const codeOnly of [true, false]) {
        it(`a key change ${codeOnly ? "sends" : "leaves out"} the new DEK as escrowDek when code only is ${codeOnly ? "on" : "off"}`, async () => {
            const dek = newDek(sodium)
            const salt = bytes(16, 3)
            const { encKey } = await deriveKeys(sodium, PASSWORD, salt, DEFAULT_KDF)
            let row: Record<string, unknown> = {}
            let meta: Record<string, unknown> | null = null
            const server = fakeServer({
                "POST /v1/auth/prelogin": prelogin(salt),
                "POST /v1/auth/login": () => ({ json: { userId: USER, emailVerified: true, kdf: DEFAULT_KDF, wrappedDek: wrapKey(sodium, dek, encKey, USER, DEK_ID, "password"), dekId: DEK_ID, rewrapNeeded: false, sessionToken: TOKEN } }),
                "PUT /v1/account/keys": () => ({ json: { dekId: DEK_ID, deviceId: "dev-1" } }),
                "GET /v1/account": accountInfo({ codeOnly }),
                "GET /v1/sync/meta": () => ({ json: { version: 0, size: 0, dekId: DEK_ID, updatedAt: null, rotationRequired: false, rewrapNeeded: false, recoveryRenewalNeeded: false } }),
                "GET /v1/devices": () => ({ json: { devices: [row] } }),
                "POST /v1/account/rotate": request => {
                    const text = new TextDecoder().decode(request.body)
                    meta = JSON.parse(/name="meta"\r\nContent-Type: application\/json\r\n\r\n(.*)\r\n/.exec(text)![1]!) as Record<string, unknown>
                    return { json: { dekId: meta.dekId, version: 1, recoveryRenewalNeeded: false } }
                },
            })
            const signedIn = await signedInDevice(server.fetch, dek)
            row = signedIn.row
            await changeKey(signedIn.d, { deviceName: "Tab S9", password: PASSWORD, keep: ["dev-1"] })
            expect(meta).not.toBeNull()
            const sent = meta as unknown as { escrowDek?: string, dekProof: string, dekId: string }
            if (codeOnly) {
                expect(dekProof(sodium, fromB64(sodium, sent.escrowDek!, 32))).toBe(sent.dekProof)
                expect(toB64(sodium, (await signedIn.d.session.load())!.dek!)).toBe(sent.escrowDek)
            }
            else expect(sent.escrowDek).toBeUndefined()
        })
    }
})
