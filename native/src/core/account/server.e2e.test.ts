// geschrieben nach: Plan „Account + Sync“ (Abschnitte 6, 13) und account-server (src/index.ts, vitest.config.ts, test/mail-sink.js, migrations/); Werte erfunden

/*
 * The app core against the real account server: the Worker from account-server/ is bundled with that folder's esbuild
 * and run in its Miniflare (local D1 with the migrations, local R2, a mail sink). Needs `npm install` in account-server/;
 * without it this file is skipped.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { gunzipSync, gzipSync } from "fflate"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { sqlDriverFor } from "@/api/client/core-database"
import { isSyncDeviceKey } from "@/lib/app-backup-keys"
import { openDatabaseSync } from "../../../test/expo-sqlite"
import { appearance, playlists } from "../database/schema"
import { ACCOUNT_TOKEN_SECRET } from "../move/move"
import { createHmac } from "node:crypto"
import { AccountClient, type HttpFetch, MailConfirmationError, RateLimitedError, type RequestSigner, UnauthorizedError } from "./client"
import {
    AccountCryptoError, DEFAULT_KDF, type Kdf, UnsafeKdfError, UntrustedDevicesError, UntrustedKeyChangeError, approvalTranscript, boxDek, chainMac, dekProof,
    deriveKeys, deviceMac, fromB64, openBoxedDek, toB64,
} from "./crypto"
import { type AccountDeps, answerRequest, approveRequest, checkApproval, checkedDevices, compareRequest, confirmApproval, denyRequest, openRequests, requestApproval, rotate } from "./devices"
import { changeKey, createRecoveryCode, loginEmail, removeDevice, resetWithRecovery, resetWithoutRecovery, signOut, signupEmail, startFresh, useRecoveryCode } from "./flows"
import { AccountSession, type SignerStore, sodiumSignerStore } from "./session"
import type { Sodium } from "./sodium"
import { SyncEngine, coreLocalData } from "./sync"
import { device, memoryStore, ready } from "./__fixtures__/harness"

const gzip = { gzip: (data: Uint8Array) => gzipSync(data, { mtime: 0 }), gunzip: gunzipSync }
const driver = (name: string) => sqlDriverFor(openDatabaseSync(name) as never)
type Esbuild = { build(options: Record<string, unknown>): Promise<{ outputFiles: { text: string }[] }> }

const SERVER = path.resolve(__dirname, "../../../../account-server")
const available = ["miniflare", "esbuild", "zod"].every(name => existsSync(path.join(SERVER, "node_modules", name)))

/** Same as account-server/test/mail-sink.js, plus a fetch that lists the mails */
const MAIL_SINK = `
import { WorkerEntrypoint } from "cloudflare:workers";
const outbox = [];
export class MailSink extends WorkerEntrypoint {
  async send(message) { outbox.push(structuredClone(message)); return { messageId: "test-" + outbox.length }; }
}
export default { fetch: () => Response.json(outbox) };
`
/** The floor the app and the server accept (H-1): nothing faster is allowed any more */
const KDF: Kdf = DEFAULT_KDF
/** A signing key no session is bound to */
const freshSigner = () => sodiumSignerStore(memoryStore(), sodium).obtain()

/**
 * The Keystore signer's contract (N-8) with WebCrypto: ECDSA P-256 + SHA-256, non-extractable, signature r || s (WebCrypto's
 * own form; the device module unpacks the Keystore's DER into it), public key the uncompressed point.
 */
function p256SignerStore(): SignerStore {
    let signer: RequestSigner | null = null
    return {
        current: async () => signer,
        async obtain() {
            if (signer) return signer
            const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"])
            const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))
            signer = {
                alg: "p256",
                publicKey,
                sign: async message => new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, message.slice())),
            }
            return signer
        },
        remove: async () => void (signer = null),
    }
}
const EMAIL = "sync-test@example.org"
const PASSWORD = "a long test password 1"

type MiniflareLike = { ready: Promise<URL>, dispose(): Promise<void>, getD1Database(name: string): Promise<{ prepare(sql: string): { run(): Promise<unknown> } }>, getWorker(name: string): Promise<{ fetch(url: string): Promise<Response> }> }

let sodium: Sodium
let mf: MiniflareLike
let baseUrl: string

describe.skipIf(!available)("against the real account server (Miniflare)", () => {
    beforeAll(async () => {
        sodium = await ready(createRequire(import.meta.url)("libsodium-wrappers-sumo"))
        const load = createRequire(path.join(SERVER, "package.json"))
        const esbuild = load("esbuild") as Esbuild
        // Miniflare 5 takes a new option shape; the classic (v4) one, as the server's vitest config uses, is converted
        const { Miniflare, convertV4MiniflareOptions } = load("miniflare") as { Miniflare: new (options: unknown) => MiniflareLike, convertV4MiniflareOptions(options: unknown): unknown }
        const bundle = await esbuild.build({
            entryPoints: [path.join(SERVER, "src", "index.ts")],
            bundle: true,
            write: false,
            format: "esm",
            platform: "neutral",
            target: "es2022",
            conditions: ["workerd", "worker", "browser"],
            mainFields: ["module", "main"],
            external: ["cloudflare:*"],
            logLevel: "silent",
        })
        mf = new Miniflare(convertV4MiniflareOptions({
            workers: [
                {
                    name: "seanime-account",
                    modules: true,
                    script: bundle.outputFiles[0]!.text,
                    compatibilityDate: "2026-11-17",
                    d1Databases: ["DB"],
                    r2Buckets: ["SNAPSHOTS"],
                    ratelimits: { LOGIN_LIMITER: { namespace_id: "1001", simple: { limit: 1000, period: 60 } }, SIGNUP_LIMITER: { namespace_id: "1002", simple: { limit: 1000, period: 60 } } },
                    serviceBindings: { EMAIL: { name: "mail-sink", entrypoint: "MailSink" } },
                    bindings: {
                        ALLOWED_ORIGIN: "https://seanimemobile.com",
                        WEB_BASE_URL: "https://seanimemobile.com",
                        GOOGLE_JWKS_URL: "https://jwks.test/certs",
                        PEPPER_V1: "dev-pepper-not-secret-0123456789abcdef",
                        ENUM_SECRET: "dev-enum-secret-not-secret-0123456789",
                        GOOGLE_WEB_CLIENT_ID: "test-client.apps.googleusercontent.com",
                    },
                },
                { name: "mail-sink", modules: true, compatibilityDate: "2026-11-17", script: MAIL_SINK },
            ],
        }))
        baseUrl = (await mf.ready).toString()
        const db = await mf.getD1Database("DB")
        const folder = path.join(SERVER, "migrations")
        for (const file of readdirSync(folder).filter(name => name.endsWith(".sql")).sort()) {
            const sql = readFileSync(path.join(folder, file), "utf8").split("\n").filter(line => !line.trim().startsWith("--")).join("\n")
            for (const statement of sqlStatements(sql)) await db.prepare(statement).run().catch((error: Error) => { throw new Error(`${file}: ${error.message}: ${statement}`) })
        }
    }, 120_000)

    afterAll(async () => {
        await mf?.dispose()
    })

    let clock = Date.parse("2026-11-17T10:00:00.000Z")

    /** One app install: core data, secured storage, client, sync engine; `ip`: the sender address the server sees */
    function install(signers?: SignerStore, ip?: string) {
        const one = device(driver, () => clock)
        const store = memoryStore()
        const session = new AccountSession(store, sodium, signers)
        const reach = (ip ? (url: string, init: { headers: Record<string, string> }) => fetch(url, { ...init, headers: { ...init.headers, "CF-Connecting-IP": ip } } as RequestInit) : fetch) as unknown as HttpFetch
        /**
         * `fails`: the requests that never reach the server, like a connection that drops. `lies`: what a compromised
         * server answers this device instead of the true JSON answer.
         */
        const net: { fails: ((method: string, url: string) => boolean) | null, lies: ((method: string, url: string, answer: unknown) => unknown) | null } = { fails: null, lies: null }
        const send: HttpFetch = async (url, init) => {
            if (net.fails?.(init.method, url)) throw new TypeError("Network request failed")
            const answer = await reach(url, init)
            const lie = net.lies
            if (!lie) return answer
            return { status: answer.status, headers: answer.headers, json: async () => lie(init.method, url, await answer.json()), arrayBuffer: () => answer.arrayBuffer() }
        }
        const client = new AccountClient({ baseUrl, fetch: send, sodium, credentials: () => session.credentials() })
        const deps: AccountDeps = { client, session, sodium }
        let backups = 0
        let ledger: string | null = null
        const local = coreLocalData(one.environment, {
            appVersion: "4.2.0",
            preferences: () => Object.fromEntries(one.preferences),
            isDeviceKey: isSyncDeviceKey,
            writePreferences: (preferences, removed) => {
                for (const [key, value] of Object.entries(preferences)) one.preferences.set(key, value)
                for (const key of removed) one.preferences.delete(key)
            },
            safetyBackup: async () => void backups++,
            ledger: { read: () => ledger, write: text => void (ledger = text) },
        })
        const engine = new SyncEngine({ api: client, session, sodium, gzip, local, now: () => clock })
        return { ...one, store, session, client, deps, engine, net, backups: () => backups }
    }

    async function encKeyFor(client: AccountClient, password: string, email = EMAIL): Promise<Uint8Array> {
        const { salt, kdf } = await client.prelogin(email)
        return (await deriveKeys(sodium, password, fromB64(sodium, salt, 16), kdf)).encKey
    }

    const mailCount = async () => ((await (await (await mf.getWorker("mail-sink")).fetch("http://mail-sink/")).json()) as unknown[]).length

    /** The reset mail goes out after the server answered (waitUntil): waits for a mail newer than `after` mails */
    async function nextMailToken(after: number, to = EMAIL): Promise<string> {
        for (let attempt = 0; attempt < 50; attempt++) {
            const mails = await (await (await mf.getWorker("mail-sink")).fetch("http://mail-sink/")).json() as { to: string, text: string }[]
            const match = /#token=([A-Za-z0-9_-]{43})/.exec(mails.slice(after).filter(mail => mail.to === to).at(-1)?.text ?? "")
            if (match) return match[1]!
            await new Promise(resolve => setTimeout(resolve, 50))
        }
        throw new Error("no mail with a token")
    }

    let phone: ReturnType<typeof install>
    let tablet: ReturnType<typeof install>
    let laptop: ReturnType<typeof install>
    beforeAll(() => {
        phone = install()
        tablet = install()
        laptop = install()
    })
    const names = async (one: ReturnType<typeof install>) => (await (await one.db()).select().from(playlists)).map(row => row.name).sort()
    /** S2: what the "Change encryption key" screen ticks by default */
    const keepAll = async (one: ReturnType<typeof install>) => (await checkedDevices(one.deps)).filter(device => device.keepByDefault).map(device => device.id)

    it("signup → upload → second device signs in → import → same data, both ways", async () => {
        expect(await signupEmail(phone.deps, { email: EMAIL, password: PASSWORD, deviceName: "Phone", kdf: KDF })).toMatchObject({ status: "ready" })
        await (await phone.db()).insert(playlists).values({ name: "Evening", episodes: [], createdAt: clock, updatedAt: clock })
        phone.secrets.set(ACCOUNT_TOKEN_SECRET, "anilist-token-phone")
        expect(await phone.engine.sync("start")).toMatchObject({ state: "uploaded", version: 1 })

        expect(await loginEmail(tablet.deps, { email: EMAIL, password: PASSWORD, deviceName: "Tablet" })).toMatchObject({ status: "ready" })
        expect(await tablet.engine.sync("start")).toMatchObject({ state: "import-available", version: 1 })
        expect(await tablet.engine.importFromAccount()).toMatchObject({ state: "updated", version: 1 })
        expect(tablet.backups()).toBe(1)
        expect(await names(tablet)).toEqual(["Evening"])
        expect(tablet.secrets.get(ACCOUNT_TOKEN_SECRET)).toBe("anilist-token-phone")

        await (await tablet.db()).insert(playlists).values({ name: "Tablet list", episodes: [], createdAt: clock, updatedAt: clock })
        expect(await tablet.engine.sync("manual")).toMatchObject({ state: "uploaded", version: 2 })
        expect(await phone.engine.sync("manual")).toMatchObject({ state: "updated", version: 2 })
        expect(await names(phone)).toEqual(["Evening", "Tablet list"])
        // the server only ever held ciphertext
        const stored = await phone.client.snapshot()
        expect(new TextDecoder().decode(stored!.bytes)).not.toContain("anilist-token-phone")
    })

    it("device approval with commitment and the same number on both devices", async () => {
        // a session without the DEK (as after a Google sign-in on a new device)
        const { salt, kdf, challenge } = await laptop.client.prelogin(EMAIL)
        const { authKey } = await deriveKeys(sodium, PASSWORD, fromB64(sodium, salt, 16), kdf)
        const login = await laptop.client.login(EMAIL, toB64(sodium, authKey), challenge, await laptop.session.signer())
        await laptop.session.saveSession({ userId: login.userId, sessionToken: login.sessionToken, kind: "email", email: EMAIL, deviceId: null })

        const pending = await requestApproval(laptop.deps, "Laptop")
        expect(await checkApproval(laptop.deps, pending)).toEqual({ state: "waiting" })
        const [request] = await openRequests(phone.deps)
        expect(request).toMatchObject({ id: pending.id, deviceName: "Laptop", status: "pending" })
        const turn = await answerRequest(phone.deps, request!)
        expect(await compareRequest(phone.deps, turn)).toEqual({ state: "waiting" })
        const onLaptop = await checkApproval(laptop.deps, pending)
        const onPhone = await compareRequest(phone.deps, turn)
        expect(onLaptop).toMatchObject({ state: "compare", confirmed: false })
        expect(onPhone).toEqual(onLaptop)
        await approveRequest(phone.deps, turn)
        // approval v2 (NEU-1): the laptop takes the key only after its own user said the numbers are the same
        expect(await checkApproval(laptop.deps, pending)).toEqual(onLaptop)
        expect((await laptop.session.load())!.dek).toBeNull()
        expect(await confirmApproval(laptop.deps, pending, true)).toEqual({ state: "approved" })
        const [phoneState, laptopState] = [await phone.session.load(), await laptop.session.load()]
        expect(laptopState!.dekId).toBe(phoneState!.dekId)
        expect(laptopState!.dek).toEqual(phoneState!.dek)
        expect(laptopState!.deviceId).toBeTruthy()
        expect(await laptop.engine.importFromAccount()).toMatchObject({ state: "updated", version: 2 })
        expect(await names(laptop)).toEqual(["Evening", "Tablet list"])
    })

    it("rotation with several devices: the others fetch the new key on their own and read on", async () => {
        const before = (await phone.session.load())!.dekId
        // the phone removes the laptop: the new key is sealed to the phone and the tablet
        const laptopId = (await laptop.session.load())!.deviceId!
        const rotated = await removeDevice(phone.deps, { deviceId: laptopId, deviceName: "Phone", password: PASSWORD })
        expect(rotated.dekId).not.toBe(before)
        expect(rotated.recoveryNeedsRenewal).toBe(false)
        expect(await phone.client.syncMeta()).toMatchObject({ dekId: rotated.dekId, version: rotated.version, rotationRequired: false })
        await expect(laptop.client.syncMeta()).rejects.toThrow(UnauthorizedError)
        // NEU-2: the removed device hears so (the app then drops its key and session)
        expect(await laptop.engine.sync("manual")).toMatchObject({ state: "removed" })

        await (await phone.db()).insert(playlists).values({ name: "After rotation", episodes: [], createdAt: clock, updatedAt: clock })
        expect(await phone.engine.sync("manual")).toMatchObject({ state: "uploaded", version: rotated.version + 1 })
        // the tablet still holds the old key; its sync picks up the sealed new one without a sign-in. The pickup needs
        // only the device key pair, so a Google account (no password on the device) does the same.
        await tablet.session.updateSession({ kind: "google", email: null })
        expect((await tablet.session.load())!.dekId).toBe(before)
        expect(await tablet.engine.sync("manual")).toMatchObject({ state: "updated", version: rotated.version + 1 })
        const [phoneState, tabletState] = [await phone.session.load(), await tablet.session.load()]
        expect(tabletState!.dekId).toBe(rotated.dekId)
        expect(tabletState!.dek).toEqual(phoneState!.dek)
        expect(await names(tablet)).toEqual(["After rotation", "Evening", "Tablet list"])
        await tablet.session.updateSession({ kind: "email", email: EMAIL })

        // a fresh sign-in on a new install gets the new key through the new password wrap
        const fresh = install()
        expect(await loginEmail(fresh.deps, { email: EMAIL, password: PASSWORD, deviceName: "New" })).toMatchObject({ status: "ready" })
        expect((await fresh.session.load())!.dekId).toBe(rotated.dekId)
        expect(await fresh.engine.importFromAccount()).toMatchObject({ state: "updated" })
        expect(await names(fresh)).toEqual(["After rotation", "Evening", "Tablet list"])
    })

    it("a rotation without the recovery code says the code needs renewal, a new code clears it", async () => {
        await loginEmail(phone.deps, { email: EMAIL, password: PASSWORD, deviceName: "Phone" })
        await createRecoveryCode(phone.deps)
        const rotated = await rotate(phone.deps, { keep: await keepAll(phone), encKey: await encKeyFor(phone.client, PASSWORD) })
        expect(rotated).toMatchObject({ recoveryRenewed: false, recoveryNeedsRenewal: true })
        expect(await tablet.engine.sync("manual")).toMatchObject({ state: "updated", recoveryRenewalNeeded: true })
        expect((await tablet.session.load())!.dekId).toBe(rotated.dekId)
        expect(await phone.client.account()).toMatchObject({ hasRecovery: false, recoveryRenewalNeeded: true })
        await createRecoveryCode(phone.deps)
        expect(await phone.engine.sync("manual")).toMatchObject({ recoveryRenewalNeeded: false })
    })

    it("password reset with the recovery code on a device that never held the account (userId from the server)", async () => {
        await loginEmail(phone.deps, { email: EMAIL, password: PASSWORD, deviceName: "Phone" })
        const code = await createRecoveryCode(phone.deps)
        const stranger = install()
        expect(await stranger.session.load()).toBeNull()
        const mails = await mailCount()
        await stranger.client.resetRequest(EMAIL)
        const token = await nextMailToken(mails)
        const newPassword = "another long password 2"
        expect(await resetWithRecovery(stranger.deps, { token, recoveryCode: code, email: EMAIL, newPassword, deviceName: "Stranger", kdf: KDF })).toMatchObject({ status: "ready" })
        expect(await stranger.engine.importFromAccount()).toMatchObject({ state: "updated" })
        expect(await names(stranger)).toEqual(["After rotation", "Evening", "Tablet list"])
        const other = install()
        expect(await loginEmail(other.deps, { email: EMAIL, password: newPassword, deviceName: "Other" })).toMatchObject({ status: "ready" })
        expect(await other.engine.importFromAccount()).toMatchObject({ state: "updated" })
        expect(await names(other)).toEqual(["After rotation", "Evening", "Tablet list"])
    })

    it("start fresh after a reset without code and without any device holding the key", async () => {
        const lonely = install()
        const mails = await mailCount()
        await lonely.client.resetRequest(EMAIL)
        const token = await nextMailToken(mails)
        const password = "a third long password 3"
        expect(await resetWithoutRecovery(lonely.deps, { token, email: EMAIL, newPassword: password, deviceName: "Lonely", kdf: KDF })).toMatchObject({ status: "needs-key" })
        expect(await lonely.engine.sync("manual")).toMatchObject({ state: "needs-key" })

        const witness = install()
        expect(await loginEmail(witness.deps, { email: EMAIL, password, deviceName: "Witness" })).toMatchObject({ status: "needs-key" })
        await (await lonely.db()).insert(playlists).values({ name: "Fresh start", episodes: [], createdAt: clock, updatedAt: clock })
        const started = await startFresh(lonely.deps, { deviceName: "Lonely", password })
        expect(await lonely.client.syncMeta()).toMatchObject({ version: 0, dekId: null, rotationRequired: false, rewrapNeeded: false })
        expect(await lonely.client.devices()).toEqual([expect.objectContaining({ id: started.deviceId, current: true })])
        expect(await lonely.engine.sync("manual")).toMatchObject({ state: "uploaded", version: 1 })
        // every other session is gone; a new sign-in gets the new key and the new data
        await expect(witness.client.syncMeta()).rejects.toThrow(UnauthorizedError)
        const next = install()
        expect(await loginEmail(next.deps, { email: EMAIL, password, deviceName: "Next" })).toMatchObject({ status: "ready" })
        expect((await next.session.load())!.dekId).toBe(started.dekId)
        expect(await next.engine.importFromAccount()).toMatchObject({ state: "updated", version: 1 })
        expect(await names(next)).toEqual(["Fresh start"])
    })

    it("plan 10.2b: the token alone, a replayed request, another key or a replayed login get 401", async () => {
        const password = "a third long password 3"
        const probe = install()
        expect(await loginEmail(probe.deps, { email: EMAIL, password, deviceName: "Probe" })).toMatchObject({ status: "ready" })
        const { sessionToken } = (await probe.session.credentials())!
        expect((await fetch(`${baseUrl.replace(/\/$/, "")}/v1/sync/meta`, { headers: { Authorization: `Bearer ${sessionToken}` } })).status).toBe(401)

        const seen: { url: string, init: RequestInit }[] = []
        const recording = new AccountClient({
            baseUrl,
            sodium,
            credentials: () => probe.session.credentials(),
            fetch: (async (url: string, init: RequestInit) => {
                seen.push({ url, init })
                return fetch(url, init)
            }) as unknown as HttpFetch,
        })
        expect(await recording.syncMeta()).toMatchObject({ version: 1 })
        expect((await fetch(seen.at(-1)!.url, seen.at(-1)!.init)).status).toBe(401)

        const otherKey = new AccountClient({ baseUrl, fetch: fetch as unknown as HttpFetch, sodium, credentials: async () => ({ sessionToken, signer: await freshSigner() }) })
        await expect(otherKey.syncMeta()).rejects.toThrow(UnauthorizedError)

        const { salt, kdf, challenge } = await recording.prelogin(EMAIL)
        const { authKey } = await deriveKeys(sodium, password, fromB64(sodium, salt, 16), kdf)
        expect(await recording.login(EMAIL, toB64(sodium, authKey), challenge, await freshSigner())).toMatchObject({ sessionToken: expect.any(String) })
        expect((await fetch(seen.at(-1)!.url, seen.at(-1)!.init)).status).toBe(401)
    })

    /* ---- Security review fix round 1 (18.11.): the server is not trusted, only the DEK is ---- */

    const random = (n: number) => sodium.randombytes_buf(n)
    const db = async () => (await mf.getD1Database("DB")) as unknown as D1Like

    /** A new account with one device that uploaded one playlist */
    async function accountWithData(email: string) {
        // every test signs up from the same local address: the signup limit (5 per hour per IP) starts over
        await (await db()).prepare("DELETE FROM rate_limits").bind().run()
        const owner = install()
        expect(await signupEmail(owner.deps, { email, password: PASSWORD, deviceName: "Victim", kdf: KDF })).toMatchObject({ status: "ready" })
        await (await owner.db()).insert(playlists).values({ name: "Mine", episodes: [], createdAt: clock, updatedAt: clock })
        expect(await owner.engine.sync("start")).toMatchObject({ state: "uploaded", version: 1 })
        return owner
    }

    /** A signed-in session WITHOUT the DEK: to the server this is exactly what a taken-over Google account or a website session is */
    async function keylessSession(email: string, password = PASSWORD) {
        const one = install()
        const { salt, kdf, challenge } = await one.client.prelogin(email)
        const { authKey } = await deriveKeys(sodium, password, fromB64(sodium, salt, 16), kdf)
        const login = await one.client.login(email, toB64(sodium, authKey), challenge, await one.session.signer())
        await one.session.saveSession({ userId: login.userId, sessionToken: login.sessionToken, kind: "google", email: null, deviceId: null })
        return one
    }

    /** The attacker's own key and device */
    function attackerKeys(userId: string) {
        const dek = random(32)
        const dekId = toB64(sodium, random(16))
        const keys = sodium.crypto_box_keypair()
        const row = { name: "Galaxy S22", devicePub: toB64(sodium, keys.publicKey), sealedDek: boxDek(sodium, dek, dekId, { kind: "own", userId }, keys.publicKey, keys), mac: deviceMac(sodium, dek, { userId, dekId, devicePub: keys.publicKey }) }
        return { dek, dekId, keys, row }
    }

    it("K-1 (a): a session without the key can neither add a device nor rotate; a server that does it anyway is refused by the device", async () => {
        const victim = await accountWithData("k1-victim@example.org")
        const before = (await victim.session.load())!
        const attacker = await keylessSession("k1-victim@example.org")
        const evil = attackerKeys(before.userId)
        // the server refuses: no device without the key, not even on the victim's own row, and no rotation
        await expect(attacker.client.putKeys({ dekId: before.dekId!, device: evil.row })).rejects.toMatchObject({ status: 403, code: "key_required" })
        await expect(attacker.client.putKeys({ dekId: before.dekId!, dekProof: toB64(sodium, random(32)), device: { ...evil.row, devicePub: toB64(sodium, before.deviceKeys!.publicKey) } })).rejects.toMatchObject({ status: 403 })
        await expect(attacker.client.rotate({ oldDekId: before.dekId!, dekId: evil.dekId, dekProof: dekProof(sodium, evil.dek), chainMac: toB64(sodium, random(32)), devices: [], removed: [] }, null, 1)).rejects.toMatchObject({ status: 403 })
        expect((await victim.client.devices()).map(device => device.name)).toEqual(["Victim"])

        // a manipulated server (or anyone with D1 write access) puts the attacker's device in the list anyway
        const d1 = await db()
        await d1.prepare("INSERT INTO devices (id, user_id, name, device_pub, sealed_dek, dek_id, mac, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)")
            .bind(crypto.randomUUID(), before.userId, evil.row.name, evil.row.devicePub, evil.row.sealedDek, before.dekId, toB64(sodium, random(32))).run()
        expect((await checkedDevices(victim.deps)).map(device => [device.name, device.verified]).sort()).toEqual([["Galaxy S22", false], ["Victim", true]])
        // the victim's key change can't keep it (S2: it is not even ticked)
        await victim.session.updateSession({ kind: "google" })
        expect(await keepAll(victim)).toEqual([before.deviceId])
        await expect(rotate(victim.deps, { keep: (await victim.client.devices()).map(device => device.id) })).rejects.toThrow(UntrustedDevicesError)
        // and switches the account to the attacker's key, sealed to the victim's device, with a made-up chain
        await d1.prepare("UPDATE users SET dek_id = ?, chain_from = ?, chain_mac = ? WHERE id = ?").bind(evil.dekId, before.dekId, toB64(sodium, random(32)), before.userId).run()
        await d1.prepare("UPDATE devices SET dek_id = ?, sealed_dek = ? WHERE user_id = ? AND name = 'Victim'")
            .bind(evil.dekId, boxDek(sodium, evil.dek, evil.dekId, { kind: "rotate", userId: before.userId }, before.deviceKeys!.publicKey, evil.keys), before.userId).run()
        await d1.prepare("UPDATE snapshots SET dek_id = ? WHERE user_id = ?").bind(evil.dekId, before.userId).run()
        await (await victim.db()).insert(playlists).values({ name: "Local only", episodes: [], createdAt: clock, updatedAt: clock })

        expect(await victim.engine.sync("manual")).toMatchObject({ state: "key-untrusted" })
        expect(await victim.engine.importFromAccount()).toMatchObject({ state: "key-untrusted" })
        const after = (await victim.session.load())!
        expect(after.dekId).toBe(before.dekId)
        expect(after.dek).toEqual(before.dek)
        expect(await names(victim)).toEqual(["Local only", "Mine"])
        // nothing was uploaded with any key
        expect(await d1.prepare("SELECT version FROM snapshots WHERE user_id = ?").bind(before.userId).first()).toEqual({ version: 1 })
    })

    it("N-1 (b): an old password wrap or an old sealed key served under a new dekId is refused", async () => {
        const email = "n1-victim@example.org"
        const owner = await accountWithData(email)
        const second = install()
        expect(await loginEmail(second.deps, { email, password: PASSWORD, deviceName: "Second" })).toMatchObject({ status: "ready" })
        const d1 = await db()
        const old = (await d1.prepare("SELECT dek_id, wrapped_dek FROM users WHERE email = ?").bind(email).first<{ dek_id: string, wrapped_dek: string }>())!
        const secondPub = toB64(sodium, (await second.session.load())!.deviceKeys!.publicKey)
        const oldSealed = (await d1.prepare("SELECT sealed_dek FROM devices WHERE device_pub = ?").bind(secondPub).first<{ sealed_dek: string }>())!.sealed_dek
        const { salt, kdf } = await owner.client.prelogin(email)
        const rotated = await rotate(owner.deps, { keep: await keepAll(owner), encKey: (await deriveKeys(sodium, PASSWORD, fromB64(sodium, salt, 16), kdf)).encKey })
        expect(rotated.dekId).not.toBe(old.dek_id)

        await d1.prepare("UPDATE users SET wrapped_dek = ? WHERE email = ?").bind(old.wrapped_dek, email).run()
        const fresh = install()
        await expect(loginEmail(fresh.deps, { email, password: PASSWORD, deviceName: "Fresh" })).rejects.toThrow(AccountCryptoError)
        expect((await fresh.session.load())?.dek ?? null).toBeNull()

        await d1.prepare("UPDATE devices SET sealed_dek = ? WHERE device_pub = ?").bind(oldSealed, secondPub).run()
        expect(await second.engine.sync("manual")).toMatchObject({ state: "key-untrusted" })
        expect((await second.session.load())!.dekId).toBe(old.dek_id)
    })

    it("H-1 (c): KDF parameters from the server below the floor, or below what this device saw, are refused", async () => {
        const proxied = (one: ReturnType<typeof install>, kdf: Kdf) => new AccountClient({
            baseUrl,
            sodium,
            credentials: () => one.session.credentials(),
            fetch: (async (url: string, init: RequestInit) => {
                const response = await fetch(url, init)
                if (!url.endsWith("/auth/prelogin")) return response
                return new Response(JSON.stringify({ ...(await response.json() as object), kdf }), { status: response.status })
            }) as unknown as HttpFetch,
        })
        const victim = install()
        await expect(loginEmail({ ...victim.deps, client: proxied(victim, { alg: "argon2id", m: 8, t: 1, p: 1 }) }, { email: EMAIL, password: "a third long password 3", deviceName: "Victim" })).rejects.toThrow(UnsafeKdfError)
        expect(await victim.session.load()).toBeNull()

        const strong = install()
        const email = "h1-strong@example.org"
        await signupEmail(strong.deps, { email, password: PASSWORD, deviceName: "Strong", kdf: { alg: "argon2id", m: 131072, t: 3, p: 1 } })
        await expect(loginEmail({ ...strong.deps, client: proxied(strong, DEFAULT_KDF) }, { email, password: PASSWORD, deviceName: "Strong" })).rejects.toThrow(UnsafeKdfError)
    })

    it("K-1 (d): start fresh by a session without the key stops the device visibly; it never switches to the new key", async () => {
        const email = "d-victim@example.org"
        const victim = await accountWithData(email)
        const before = (await victim.session.load())!
        const attacker = await keylessSession(email)
        const evil = attackerKeys(before.userId)
        // the attacker has no password key: its password wrap is made up
        await attacker.client.startFresh({ dekId: evil.dekId, dekProof: dekProof(sodium, evil.dek), wrappedDek: toB64(sodium, random(72)), device: evil.row })

        expect(await victim.engine.sync("manual")).toMatchObject({ state: "signed-out" })
        // the app drops only the session (N-3): the key stays for a sign-in
        await victim.session.dropSession()
        expect(await victim.session.keptKey()).toMatchObject({ userId: before.userId, dekId: before.dekId })
        // signing in again: the account's key changed without a chain, so the kept key and the sync state go and the made-up wrap does not open
        await expect(loginEmail(victim.deps, { email, password: PASSWORD, deviceName: "Victim" })).rejects.toThrow(AccountCryptoError)
        const after = (await victim.session.load())!
        expect(after.dek).toBeNull()
        expect(after.imported).toBe(false)
        expect(await victim.engine.sync("manual")).toMatchObject({ state: "needs-key" })
        expect(await names(victim)).toEqual(["Mine"])
    })

    it("(e) N-3 and M-4: a reset without code keeps the key through the 401, the next sign-in wraps it; a pending key change never stops the sync and runs only when the user picks the devices", async () => {
        const email = "e-normal@example.org"
        const phone2 = await accountWithData(email)
        const tablet2 = install()
        expect(await loginEmail(tablet2.deps, { email, password: PASSWORD, deviceName: "Tablet" })).toMatchObject({ status: "ready" })
        expect(await tablet2.engine.importFromAccount()).toMatchObject({ state: "updated", version: 1 })
        const laptop2 = install()
        expect(await loginEmail(laptop2.deps, { email, password: PASSWORD, deviceName: "Laptop" })).toMatchObject({ status: "ready" })

        // the laptop is removed (as on the website): the server asks for a key change; the sync goes on and reports it
        await phone2.client.deleteDevice((await laptop2.session.load())!.deviceId!)
        await (await tablet2.db()).insert(playlists).values({ name: "Tablet", episodes: [], createdAt: clock, updatedAt: clock })
        expect(await tablet2.engine.sync("manual")).toMatchObject({ state: "uploaded", version: 2, rotationRequired: true })

        // reset without code on the website: every session ends
        const web = install()
        const mails = await mailCount()
        await web.client.resetRequest(email)
        const token = await nextMailToken(mails, email)
        const newPassword = "a fourth long password 4"
        const salt = sodium.randombytes_buf(16)
        const { authKey } = await deriveKeys(sodium, newPassword, salt, DEFAULT_KDF)
        expect(await web.client.reset({ token, salt: toB64(sodium, salt), kdf: DEFAULT_KDF, authKey: toB64(sodium, authKey) })).toEqual({ rewrapNeeded: true })
        expect(await tablet2.engine.sync("manual")).toMatchObject({ state: "signed-out" })
        await tablet2.session.dropSession()

        // the tablet still holds the key: it wraps it for the new password; the user then changes the key there
        const keptId = (await tablet2.session.keptKey())!.dekId
        expect(await loginEmail(tablet2.deps, { email, password: newPassword, deviceName: "Tablet" })).toMatchObject({ status: "ready" })
        expect(await tablet2.client.syncMeta()).toMatchObject({ rotationRequired: true, rewrapNeeded: false, dekId: keptId })
        await changeKey(tablet2.deps, { deviceName: "Tablet", password: newPassword, keep: await keepAll(tablet2) })
        const meta = await tablet2.client.syncMeta()
        expect(meta).toMatchObject({ rotationRequired: false, rewrapNeeded: false })
        expect(meta.dekId).not.toBe(keptId)
        expect((await checkedDevices(tablet2.deps)).every(device => device.verified)).toBe(true)

        // the phone signs in with the new password, gets the new key from its wrap and is asked before importing
        await phone2.session.dropSession()
        expect(await loginEmail(phone2.deps, { email, password: newPassword, deviceName: "Victim" })).toMatchObject({ status: "ready" })
        expect(await phone2.engine.sync("manual")).toMatchObject({ state: "import-available" })
        expect(await phone2.engine.importFromAccount()).toMatchObject({ state: "updated" })
        expect(await names(phone2)).toEqual(["Mine", "Tablet"])
    })

    /* ---- Fix round 3: the attacks of the second review (B1, B1b, B2, B3, B5) against the real core ---- */

    it("B1 (NEU-1): a new device takes no key the server approves on its own, nor one from a device whose number its user did not confirm", async () => {
        const email = "b1-fix3@example.org"
        const owner = await accountWithData(email)
        const ownerState = (await owner.session.load())!
        const fresh = await keylessSession(email)
        const d1 = await db()
        const evil = sodium.crypto_box_keypair()
        const evilDek = random(32)
        // (a) the server jumps the request to "approved" with a key of its own under the account's real dekId
        const jumped = await requestApproval(fresh.deps, "New Phone")
        await d1.prepare("UPDATE device_requests SET status = 'approved', approver_pub = ?, approver_nonce = ?, reveal = ?, sealed_dek = ?, dek_id = ?, device_id = ? WHERE id = ?")
            .bind(toB64(sodium, evil.publicKey), toB64(sodium, random(32)), toB64(sodium, jumped.rN), boxDek(sodium, evilDek, ownerState.dekId!, { kind: "approve", transcript: random(32) }, jumped.devicePub, evil), ownerState.dekId, ownerState.deviceId, jumped.id).run()
        await expect(checkApproval(fresh.deps, jumped)).rejects.toThrow(AccountCryptoError)
        expect((await fresh.session.load())!.dek).toBeNull()
        // (b) the server sits in between with its own key: this device shows a number the user's phone never shows
        const between = await requestApproval(fresh.deps, "New Phone")
        const rO = random(32)
        await d1.prepare("UPDATE device_requests SET status = 'nonce', approver_pub = ?, approver_nonce = ? WHERE id = ?").bind(toB64(sodium, evil.publicKey), toB64(sodium, rO), between.id).run()
        expect(await checkApproval(fresh.deps, between)).toMatchObject({ state: "compare", confirmed: false })
        const transcript = approvalTranscript(sodium, between.devicePub, evil.publicKey, between.rN, rO)
        await d1.prepare("UPDATE device_requests SET status = 'approved', sealed_dek = ?, dek_id = ?, device_id = ? WHERE id = ?")
            .bind(boxDek(sodium, evilDek, ownerState.dekId!, { kind: "approve", transcript }, between.devicePub, evil), ownerState.dekId, ownerState.deviceId, between.id).run()
        // "approved" on the server, but this device's user has not said the numbers match: nothing is taken
        expect(await checkApproval(fresh.deps, between)).toMatchObject({ state: "compare", confirmed: false })
        expect((await fresh.session.load())!.dek).toBeNull()
        // the user's phone shows no such number: "No" ends it, also when the server calls it approved
        expect(await confirmApproval(fresh.deps, between, false)).toEqual({ state: "denied" })
        expect((await fresh.session.load())!.dek).toBeNull()
        expect(await fresh.engine.sync("manual")).toMatchObject({ state: "needs-key" })
    })

    it("B1b (NEU-1): a device that keeps the account's key never goes to an approval, even when the server ends its session and hides the wrap", async () => {
        const email = "b1b-fix3@example.org"
        const victim = await accountWithData(email)
        const before = (await victim.session.load())!
        const d1 = await db()
        await d1.prepare("DELETE FROM sessions WHERE user_id = ?").bind(before.userId).run()
        await d1.prepare("UPDATE users SET wrapped_dek = NULL WHERE id = ?").bind(before.userId).run()
        expect(await victim.engine.sync("manual")).toMatchObject({ state: "signed-out" })
        await victim.session.dropSession()
        expect(await loginEmail(victim.deps, { email, password: PASSWORD, deviceName: "Victim" })).toMatchObject({ status: "ready", keyChanged: false })
        const after = (await victim.session.load())!
        expect(after.dek).toEqual(before.dek)
        expect(after.dekId).toBe(before.dekId)
        // it put its password wrap back, and syncs on with its own key and data
        expect(await d1.prepare("SELECT wrapped_dek IS NOT NULL AS w FROM users WHERE id = ?").bind(before.userId).first()).toEqual({ w: 1 })
        expect(await victim.engine.sync("manual")).toMatchObject({ state: "up-to-date", version: 1 })
        expect(await names(victim)).toEqual(["Mine"])
    })

    it("B2 (NEU-1, NEU-7): after someone else started fresh, the device says so, imports nothing and takes no key without its user's yes", async () => {
        const email = "b2-fix3@example.org"
        const victim = await accountWithData(email)
        const before = (await victim.session.load())!
        const attacker = await keylessSession(email)
        const evil = attackerKeys(before.userId)
        const started = await attacker.client.startFresh({ dekId: evil.dekId, dekProof: dekProof(sodium, evil.dek), wrappedDek: toB64(sodium, random(72)), device: evil.row })
        await attacker.session.saveDeviceKeys(evil.keys)
        await attacker.session.saveDek(evil.dekId, evil.dek)
        await attacker.session.updateSession({ deviceId: started.deviceId })
        expect(await victim.engine.sync("manual")).toMatchObject({ state: "signed-out" })
        await victim.session.dropSession()
        // signing in again: the key changed without a chain; the device says so instead of a bare error
        await expect(loginEmail(victim.deps, { email, password: PASSWORD, deviceName: "Victim" })).rejects.toThrow(UntrustedKeyChangeError)
        expect((await victim.session.load())!.dek).toBeNull()
        // it asks for an approval (as a Google account would); the attacker's device answers and approves
        const pending = await requestApproval(victim.deps, "Victim")
        const [request] = await openRequests(attacker.deps)
        const turn = await answerRequest(attacker.deps, request!)
        expect(await checkApproval(victim.deps, pending)).toMatchObject({ state: "compare", confirmed: false })
        await approveRequest(attacker.deps, turn)
        expect(await checkApproval(victim.deps, pending)).toMatchObject({ state: "compare", confirmed: false })
        expect((await victim.session.load())!.dek).toBeNull()
        // none of the user's devices shows that number: "No"
        expect(await confirmApproval(victim.deps, pending, false)).toEqual({ state: "denied" })
        expect((await victim.session.load())!.dek).toBeNull()
        expect(await victim.engine.sync("manual")).toMatchObject({ state: "needs-key" })
        expect(await names(victim)).toEqual(["Mine"])
    })

    it("B3 (NEU-2): a removed device that kept the key can't bind again, read the data or rotate; the owner's rotation leaves it out", async () => {
        const email = "b3-fix3@example.org"
        const victim = await accountWithData(email)
        const thief = install()
        expect(await loginEmail(thief.deps, { email, password: PASSWORD, deviceName: "Stolen" })).toMatchObject({ status: "ready" })
        const stolen = (await thief.session.load())!
        const d1 = await db()
        // removed on the website: a session of the account with a recent sign-in
        const web = await keylessSession(email)
        await web.client.deleteDevice(stolen.deviceId!)
        // the thief keeps the app from syncing and signs in again like with Google (no password check), with the key it kept
        const { salt, kdf, challenge } = await thief.client.prelogin(email)
        const { authKey } = await deriveKeys(sodium, PASSWORD, fromB64(sodium, salt, 16), kdf)
        const login = await thief.client.login(email, toB64(sodium, authKey), challenge, await thief.session.signer())
        await thief.session.saveSession({ userId: login.userId, sessionToken: login.sessionToken, kind: "google", email: null, deviceId: null })
        await d1.prepare("UPDATE sessions SET password_auth = 0 WHERE user_id = ? AND device_id IS NULL").bind(login.userId).run()
        const kept = stolen.dek!
        const own = stolen.deviceKeys!
        const rowFor = (keys: { publicKey: Uint8Array, privateKey: Uint8Array }) => ({
            name: "Stolen", devicePub: toB64(sodium, keys.publicKey),
            sealedDek: boxDek(sodium, kept, stolen.dekId!, { kind: "own", userId: stolen.userId }, keys.publicKey, keys),
            mac: deviceMac(sodium, kept, { userId: stolen.userId, dekId: stolen.dekId!, devicePub: keys.publicKey }),
        })
        await expect(thief.client.putKeys({ dekId: stolen.dekId!, dekProof: dekProof(sodium, kept), device: rowFor(own) })).rejects.toMatchObject({ status: 403, code: "device_removed" })
        // S3: the copied key's proof is no account: without the password or the recovery code no new row either
        await expect(thief.client.putKeys({ dekId: stolen.dekId!, dekProof: dekProof(sodium, kept), device: rowFor(sodium.crypto_box_keypair()) })).rejects.toMatchObject({ status: 403, code: "owner_required" })
        await expect(thief.client.snapshot()).rejects.toMatchObject({ status: 403 })
        await expect(rotate(thief.deps, { keep: [] })).rejects.toThrow(AccountCryptoError)
        // the owner changes the key with the password; only the owner's device keeps it
        const done = await changeKey(victim.deps, { deviceName: "Victim", password: PASSWORD, keep: await keepAll(victim) })
        expect(done.dekId).not.toBe(stolen.dekId)
        expect(await victim.client.syncMeta()).toMatchObject({ rotationRequired: false, dekId: done.dekId })
        expect((await victim.client.devices()).map(device => device.name)).toEqual(["Victim"])
        // the old key's proof is worth nothing now
        await expect(thief.client.putKeys({ dekId: stolen.dekId!, dekProof: dekProof(sodium, kept), device: rowFor(sodium.crypto_box_keypair()) })).rejects.toMatchObject({ status: 409 })
    })

    it("B5 (NEU-3): a removed device with a compromised server can't move the devices to its key, and the owner's rotation never seals to it", async () => {
        const email = "b5-fix3@example.org"
        const victim = await accountWithData(email)
        const tab = install()
        expect(await loginEmail(tab.deps, { email, password: PASSWORD, deviceName: "Tablet" })).toMatchObject({ status: "ready" })
        expect(await tab.engine.importFromAccount()).toMatchObject({ state: "updated" })
        const removed = install()
        expect(await loginEmail(removed.deps, { email, password: PASSWORD, deviceName: "Old Tablet" })).toMatchObject({ status: "ready" })
        const r = (await removed.session.load())!
        const d1 = await db()
        const rRow = (await d1.prepare("SELECT * FROM devices WHERE id = ?").bind(r.deviceId).first<{ id: string, device_pub: string, sealed_dek: string, mac: string }>())!
        // removed on the website; the user's devices sync once and keep the removed key from the server's list
        const web = await keylessSession(email)
        await web.client.deleteDevice(r.deviceId!)
        expect(await victim.engine.sync("manual")).toMatchObject({ rotationRequired: true })
        expect(await tab.engine.sync("manual")).toMatchObject({ rotationRequired: true })
        const vState = (await victim.session.load())!
        // (a) the removed device makes a valid chain from the old key to its own and boxes it with its own key
        const evil = random(32)
        const evilId = toB64(sodium, random(16))
        const chain = chainMac(sodium, r.dek!, { userId: r.userId, oldDekId: r.dekId!, newDekId: evilId, rotatorPub: r.deviceKeys!.publicKey, removed: [] }, evil)
        await d1.prepare("UPDATE users SET dek_id = ?, chain_from = ?, chain_mac = ?, chain_rotator = ?, chain_removed = '[]' WHERE id = ?")
            .bind(evilId, r.dekId, chain, toB64(sodium, r.deviceKeys!.publicKey), r.userId).run()
        for (const one of [victim, tab]) {
            const s = (await one.session.load())!
            await d1.prepare("UPDATE devices SET dek_id = ?, sealed_dek = ? WHERE id = ?")
                .bind(evilId, boxDek(sodium, evil, evilId, { kind: "rotate", userId: r.userId }, s.deviceKeys!.publicKey, r.deviceKeys!), s.deviceId).run()
        }
        await d1.prepare("UPDATE snapshots SET dek_id = ? WHERE user_id = ?").bind(evilId, r.userId).run()
        // (a') claiming the victim's phone as the rotating device does not help: only that phone's key makes its boxes
        const tState = (await tab.session.load())!
        expect(await victim.engine.sync("manual")).toMatchObject({ state: "key-untrusted" })
        await d1.prepare("UPDATE users SET chain_rotator = ?, chain_mac = ? WHERE id = ?")
            .bind(toB64(sodium, vState.deviceKeys!.publicKey), chainMac(sodium, r.dek!, { userId: r.userId, oldDekId: r.dekId!, newDekId: evilId, rotatorPub: vState.deviceKeys!.publicKey, removed: [] }, evil), r.userId).run()
        expect(await tab.engine.sync("manual")).toMatchObject({ state: "key-untrusted" })
        expect((await victim.session.load())!.dekId).toBe(vState.dekId)
        expect((await tab.session.load())!.dekId).toBe(tState.dekId)
        expect(await d1.prepare("SELECT version FROM snapshots WHERE user_id = ?").bind(r.userId).first()).toEqual({ version: 1 })
        // (b) the server puts the account back and lists the removed device again (its MAC is valid under the current key)
        await d1.prepare("UPDATE users SET dek_id = ?, chain_from = NULL, chain_mac = NULL, chain_rotator = NULL, chain_removed = NULL WHERE id = ?").bind(vState.dekId, r.userId).run()
        await d1.prepare("UPDATE snapshots SET dek_id = ? WHERE user_id = ?").bind(vState.dekId, r.userId).run()
        await d1.prepare("INSERT INTO devices (id, user_id, name, device_pub, sealed_dek, dek_id, mac, created_at, last_seen_at) VALUES (?, ?, 'Galaxy S22', ?, ?, ?, ?, 0, 0)")
            .bind(rRow.id, r.userId, rRow.device_pub, rRow.sealed_dek, vState.dekId, rRow.mac).run()
        expect((await checkedDevices(victim.deps)).find(device => device.devicePub === rRow.device_pub)).toMatchObject({ verified: false, keepByDefault: false })
        await expect(rotate(victim.deps, { keep: [rRow.id], encKey: await encKeyFor(victim.client, PASSWORD, email) })).rejects.toThrow(UntrustedDevicesError)
        // S2: the owner's key change leaves it out (and removes it again); the removed device can't open the new key
        const done = await changeKey(victim.deps, { deviceName: "Victim", password: PASSWORD, keep: await keepAll(victim) })
        expect(await d1.prepare("SELECT COUNT(*) AS n FROM devices WHERE id = ?").bind(rRow.id).first()).toEqual({ n: 0 })
        const sealed = (await d1.prepare("SELECT sealed_dek FROM devices WHERE user_id = ?").bind(r.userId).all<{ sealed_dek: string }>()).results
        for (const row of sealed) expect(() => openBoxedDek(sodium, row.sealed_dek, done.dekId, { kind: "rotate", userId: r.userId }, vState.deviceKeys!.publicKey, r.deviceKeys!)).toThrow()
    })

    it("R4: removing a device in the app rotates in the same step; the other device learns the removal from the chain and refuses that device's chains", async () => {
        const email = "r4-fix3@example.org"
        const owner = await accountWithData(email)
        const other = install()
        expect(await loginEmail(other.deps, { email, password: PASSWORD, deviceName: "Tablet" })).toMatchObject({ status: "ready" })
        expect(await other.engine.importFromAccount()).toMatchObject({ state: "updated" })
        const gone = install()
        expect(await loginEmail(gone.deps, { email, password: PASSWORD, deviceName: "Old Phone" })).toMatchObject({ status: "ready" })
        const goneState = (await gone.session.load())!
        const result = await removeDevice(owner.deps, { deviceId: goneState.deviceId!, deviceName: "Victim", password: PASSWORD })
        expect(await owner.client.syncMeta()).toMatchObject({ rotationRequired: false, dekId: result.dekId })
        expect(await other.engine.sync("manual")).toMatchObject({ state: "updated", version: result.version })
        const otherState = (await other.session.load())!
        expect(otherState.dekId).toBe(result.dekId)
        expect(await other.session.removedDevices(otherState.userId)).toContain(toB64(sodium, goneState.deviceKeys!.publicKey))
        expect(await gone.engine.sync("manual")).toMatchObject({ state: "removed" })
    })

    /* ---- Fix round 4: the attacks of the third review (c1 to c9) and the invariants I1 to I5 (devices.ts) ---- */

    const mails = async () => (await (await (await mf.getWorker("mail-sink")).fetch("http://mail-sink/")).json()) as { to: string, subject: string, text: string }[]
    const subjects = async (to: string, from: number) => (await mails()).slice(from).filter(mail => mail.to === to).map(mail => mail.subject)
    const googleStyle = async (one: ReturnType<typeof install>) => {
        // to the server a Google sign-in is a session without a password check
        const token = (await one.session.credentials())!.sessionToken
        const hash = Buffer.from(sodium.crypto_hash_sha256(new TextEncoder().encode(token))).toString("base64url")
        await (await db()).prepare("UPDATE sessions SET password_auth = 0 WHERE token_hash = ?").bind(hash).run()
    }

    it("c1, c1b / I1, I2 (NEU3-1): a request shows one number; after 'No' or a swapped value it is over, nothing is ever taken from it", async () => {
        const email = "c1-fix4@example.org"
        const owner = await accountWithData(email)
        const fresh = await keylessSession(email)
        const d1 = await db()
        const pending = await requestApproval(fresh.deps, "Pixel 8")
        const [request] = await openRequests(owner.deps)
        const turn = await answerRequest(owner.deps, request!)
        const real = (await d1.prepare("SELECT approver_pub, approver_nonce FROM device_requests WHERE id = ?").bind(pending.id).first<{ approver_pub: string, approver_nonce: string }>())!
        // c1: the server shows the new phone its own key, so the numbers differ, and the user taps "No"
        const evil = sodium.crypto_box_keypair()
        await d1.prepare("UPDATE device_requests SET approver_pub = ?, approver_nonce = ? WHERE id = ?").bind(toB64(sodium, evil.publicKey), toB64(sodium, random(32)), pending.id).run()
        const first = await checkApproval(fresh.deps, pending)
        await d1.prepare("UPDATE device_requests SET approver_pub = ?, approver_nonce = ? WHERE id = ?").bind(real.approver_pub, real.approver_nonce, pending.id).run()
        const onOwner = await compareRequest(owner.deps, turn)
        expect(first).toMatchObject({ state: "compare" })
        expect(onOwner).toMatchObject({ state: "compare" })
        expect(first).not.toEqual(onOwner)
        expect(await confirmApproval(fresh.deps, pending, false)).toEqual({ state: "denied" })
        // the server ignores the "No" and turns the request into one whose number matches the owner's phone (c1b: the
        // owner's phone then really approves, boxing the real key): the new phone shows no second number and takes nothing
        await d1.prepare("UPDATE device_requests SET status = 'revealed' WHERE id = ?").bind(pending.id).run()
        await approveRequest(owner.deps, turn)
        expect(await checkApproval(fresh.deps, pending)).toEqual({ state: "denied" })
        expect(await confirmApproval(fresh.deps, pending, true)).toEqual({ state: "denied" })
        expect((await fresh.session.load())!.dek).toBeNull()

        // a value swapped while the number shows ends the request too (a new sign-in: the server bound the first one)
        const fresh2 = await keylessSession(email)
        const second = await requestApproval(fresh2.deps, "Pixel 8")
        const [request2] = (await openRequests(owner.deps)).filter(one => one.id === second.id)
        await answerRequest(owner.deps, request2!)
        expect(await checkApproval(fresh2.deps, second)).toMatchObject({ state: "compare" })
        await d1.prepare("UPDATE device_requests SET approver_pub = ? WHERE id = ?").bind(toB64(sodium, evil.publicKey), second.id).run()
        await expect(checkApproval(fresh2.deps, second)).rejects.toThrow(AccountCryptoError)
        expect(await checkApproval(fresh2.deps, second)).toEqual({ state: "denied" })
        expect(await d1.prepare("SELECT status FROM device_requests WHERE id = ?").bind(second.id).first()).toEqual({ status: "denied" })

        // the legitimate way still works: a new request, the same number on both, "Yes" on both
        const third = await requestApproval(fresh2.deps, "Pixel 8")
        const [request3] = (await openRequests(owner.deps)).filter(one => one.id === third.id)
        const turn3 = await answerRequest(owner.deps, request3!)
        const shown = await checkApproval(fresh2.deps, third)
        expect(await compareRequest(owner.deps, turn3)).toEqual(shown)
        await approveRequest(owner.deps, turn3)
        expect(await confirmApproval(fresh2.deps, third, true)).toEqual({ state: "approved" })
        expect((await fresh2.session.load())!.dek).toEqual((await owner.session.load())!.dek)
    })

    it("S1: three 'No' within an hour pause approvals for an hour, mailed and listed", async () => {
        const email = "s1-fix4@example.org"
        const owner = await accountWithData(email)
        const fresh = await keylessSession(email)
        const before = (await mails()).length
        for (let i = 0; i < 3; i++) {
            const pending = await requestApproval(fresh.deps, "Pixel 8")
            const [request] = (await openRequests(owner.deps)).filter(one => one.id === pending.id)
            const turn = await answerRequest(owner.deps, request!)
            await checkApproval(fresh.deps, pending)
            await compareRequest(owner.deps, turn)
            // NEU4-4: the "No" that counts is the owner's, on the device that showed the number
            await denyRequest(owner.deps, pending.id)
            expect(await checkApproval(fresh.deps, pending)).toEqual({ state: "denied" })
        }
        await expect(requestApproval(fresh.deps, "Pixel 8")).rejects.toMatchObject({ status: 429, code: "approvals_paused" })
        expect(await subjects(email, before)).toEqual(["New device sign-ins are paused"])
        expect((await owner.client.account()).events?.[0]).toMatchObject({ kind: "approvals_paused" })
    })

    it("c2 / I3 (NEU3-2): the only device removed on the website; back in with the recovery code and with the password, data there; the key change and Start fresh work", async () => {
        const email = "c2-fix4@example.org"
        const owner = await accountWithData(email)
        const code = await createRecoveryCode(owner.deps)
        const web = await keylessSession(email)
        await web.client.deleteDevice((await owner.session.load())!.deviceId!)
        expect(await owner.engine.sync("manual")).toMatchObject({ state: "removed" })
        const d1 = await db()
        const wrap = (await d1.prepare("SELECT recovery_wrapped_dek, dek_id FROM users WHERE email = ?").bind(email).first<{ recovery_wrapped_dek: string, dek_id: string }>())!
        // a Google-style session (as on a Google account) gets in with the recovery code
        const viaCode = await keylessSession(email)
        await googleStyle(viaCode)
        await useRecoveryCode(viaCode.deps, { code, recoveryWrappedDek: wrap.recovery_wrapped_dek, dekId: wrap.dek_id, deviceName: "Recovered" })
        expect(await viaCode.engine.importFromAccount()).toMatchObject({ state: "updated" })
        expect(await names(viaCode)).toEqual(["Mine"])
        // a new phone gets in with the password, data there
        const phone = install()
        expect(await loginEmail(phone.deps, { email, password: PASSWORD, deviceName: "New Phone" })).toMatchObject({ status: "ready" })
        expect(await phone.engine.importFromAccount()).toMatchObject({ state: "updated" })
        expect(await names(phone)).toEqual(["Mine"])
        // and changes the key; the removed phone is not in the list any more
        await changeKey(phone.deps, { deviceName: "New Phone", password: PASSWORD, keep: await keepAll(phone) })
        expect(await phone.client.syncMeta()).toMatchObject({ rotationRequired: false })
        expect(await viaCode.engine.sync("manual")).toMatchObject({ state: "updated" })
        expect((await viaCode.session.load())!.dekId).toBe((await phone.session.load())!.dekId)

        // Start fresh after the only device was removed (email account)
        const other = await accountWithData("c2b-fresh@example.org")
        const web2 = await keylessSession("c2b-fresh@example.org")
        await web2.client.deleteDevice((await other.session.load())!.deviceId!)
        const lonely = install()
        await expect(startFresh(lonely.deps, { deviceName: "Lonely", password: PASSWORD })).rejects.toThrow()
        expect(await loginEmail(lonely.deps, { email: "c2b-fresh@example.org", password: PASSWORD, deviceName: "Lonely" })).toMatchObject({ status: "ready" })
        const started = await startFresh(lonely.deps, { deviceName: "Lonely", password: PASSWORD })
        expect(await lonely.client.devices()).toEqual([expect.objectContaining({ id: started.deviceId, current: true })])
    })

    it("c2b / I3 (NEU3-2): a device that missed a key change by a device removed later stops visibly, then gets back in with the password", async () => {
        const email = "c2b-fix4@example.org"
        const owner = await accountWithData(email)
        const late = install()
        expect(await loginEmail(late.deps, { email, password: PASSWORD, deviceName: "Late" })).toMatchObject({ status: "ready" })
        expect(await late.engine.importFromAccount()).toMatchObject({ state: "updated" })
        // the owner changes the key while the late phone is offline; then the owner's phone is removed on the website
        await changeKey(owner.deps, { deviceName: "Victim", password: PASSWORD, keep: await keepAll(owner) })
        const web = await keylessSession(email)
        await web.client.deleteDevice((await owner.session.load())!.deviceId!)
        expect(await late.engine.sync("manual")).toMatchObject({ state: "key-untrusted" })
        // the app's text: join again with the password. It works, the data is there
        await signOut(late.deps)
        expect(await loginEmail(late.deps, { email, password: PASSWORD, deviceName: "Late" })).toMatchObject({ status: "ready" })
        expect(await late.engine.importFromAccount()).toMatchObject({ state: "updated" })
        expect(await names(late)).toEqual(["Mine"])
    })

    it("c3 / I3, I5 (NEU3-4): a thief who signs out leaves a trace, can't join again with the copied key, and the owner's key change shuts it out", async () => {
        const email = "c3-fix4@example.org"
        const owner = await accountWithData(email)
        const thief = install()
        expect(await loginEmail(thief.deps, { email, password: PASSWORD, deviceName: "Stolen Tab" })).toMatchObject({ status: "ready" })
        const copied = (await thief.session.load())!
        const before = (await mails()).length
        await signOut(thief.deps)
        // the owner sees it: signed out in the list, a mail, an event, and a key change asked for
        const listed = (await checkedDevices(owner.deps)).find(device => device.name === "Stolen Tab")
        expect(listed).toMatchObject({ signedOut: true, keepByDefault: false })
        expect(await subjects(email, before)).toEqual(["A device signed out"])
        expect((await owner.client.account()).events?.[0]).toMatchObject({ kind: "device_signed_out", deviceName: "Stolen Tab" })
        expect(await owner.engine.sync("manual")).toMatchObject({ rotationRequired: true })
        // the thief signs in like with Google and shows the copied key's proof: refused
        const back = await keylessSession(email)
        await googleStyle(back)
        const keys = sodium.crypto_box_keypair()
        const row = { name: "Stolen Tab", devicePub: toB64(sodium, keys.publicKey), sealedDek: boxDek(sodium, copied.dek!, copied.dekId!, { kind: "own", userId: copied.userId }, keys.publicKey, keys), mac: deviceMac(sodium, copied.dek!, { userId: copied.userId, dekId: copied.dekId!, devicePub: keys.publicKey }) }
        await expect(back.client.putKeys({ dekId: copied.dekId!, dekProof: dekProof(sodium, copied.dek!), device: row })).rejects.toMatchObject({ status: 403, code: "owner_required" })
        // the owner changes the key; the copied key reads nothing new
        const done = await changeKey(owner.deps, { deviceName: "Victim", password: PASSWORD, keep: await keepAll(owner) })
        expect(done.dekId).not.toBe(copied.dekId)
        expect((await owner.client.devices()).map(device => device.name)).toEqual(["Victim"])
    })

    it("c4 / I4 (NEU3-5): over the email's counter nobody is locked out; the right password signs in through the mailed link", async () => {
        const email = "c4-fix4@example.org"
        await accountWithData(email)
        for (let i = 0; i < 20; i++) {
            const guesser = install(undefined, `198.${i}.7.9`)
            const { challenge } = await guesser.client.prelogin(email)
            await expect(guesser.client.login(email, toB64(sodium, random(32)), challenge, await freshSigner())).rejects.toThrow(UnauthorizedError)
        }
        const before = (await mails()).length
        const phone = install(undefined, "203.0.113.20")
        await expect(loginEmail(phone.deps, { email, password: PASSWORD, deviceName: "New Phone" })).rejects.toThrow(MailConfirmationError)
        // a wrong password gets the same answer, without a mail
        const guess = install(undefined, "203.0.114.20")
        await expect(loginEmail(guess.deps, { email, password: "a wrong long password 9", deviceName: "Guess" })).rejects.toThrow(MailConfirmationError)
        const token = await nextMailToken(before, email)
        expect(await subjects(email, before)).toEqual(["Confirm your sign-in"])
        expect(await phone.client.confirmLogin(token)).toEqual({ confirmed: true })
        expect(await loginEmail(phone.deps, { email, password: PASSWORD, deviceName: "New Phone" })).toMatchObject({ status: "ready" })
    })

    it("NEU4-1 / I4: the sec8 attack (54 resets from 18 networks, 20 wrong passwords) no longer keeps the owner out", async () => {
        const email = "neu41-polish@example.org"
        await accountWithData(email)
        for (let n = 0; n < 18; n++) {
            const stranger = install(undefined, `172.19.${n}.9`)
            for (let i = 0; i < 3; i++) await stranger.client.resetRequest(email)
        }
        for (let i = 0; i < 20; i++) {
            const guesser = install(undefined, `172.20.${i % 5}.9`)
            const { challenge } = await guesser.client.prelogin(email)
            await expect(guesser.client.login(email, toB64(sodium, random(32)), challenge, await freshSigner())).rejects.toThrow(UnauthorizedError)
        }
        await new Promise(resolve => setTimeout(resolve, 300))
        const before = (await mails()).length
        // the owner's new phone in a new network: the link comes from its own pot, which only the right password fills
        const phone = install(undefined, "172.21.1.9")
        await expect(loginEmail(phone.deps, { email, password: PASSWORD, deviceName: "New Phone" })).rejects.toThrow(MailConfirmationError)
        const token = await nextMailToken(before, email)
        expect(await phone.client.confirmLogin(token)).toEqual({ confirmed: true })
        expect(await loginEmail(phone.deps, { email, password: PASSWORD, deviceName: "New Phone" })).toMatchObject({ status: "ready" })
        expect(await phone.engine.importFromAccount()).toMatchObject({ state: "updated" })
        expect(await names(phone)).toEqual(["Mine"])
    })

    it("NEU4-4: a session without the key can't pause the owner's approvals with its own 'No'", async () => {
        const email = "neu44-polish@example.org"
        const owner = await accountWithData(email)
        const thief = await keylessSession(email)
        for (let i = 0; i < 3; i++) {
            const pending = await requestApproval(thief.deps, "Thief")
            const [request] = (await openRequests(owner.deps)).filter(one => one.id === pending.id)
            await answerRequest(owner.deps, request!)
            await checkApproval(thief.deps, pending)
            expect(await confirmApproval(thief.deps, pending, false)).toEqual({ state: "denied" })
        }
        // the owner's own new phone still gets approved by the old one
        const phone = await keylessSession(email)
        const pending = await requestApproval(phone.deps, "Pixel 8")
        const [request] = (await openRequests(owner.deps)).filter(one => one.id === pending.id)
        const turn = await answerRequest(owner.deps, request!)
        await checkApproval(phone.deps, pending)
        expect(await compareRequest(owner.deps, turn)).toMatchObject({ state: "compare" })
        await approveRequest(owner.deps, turn)
        expect(await confirmApproval(phone.deps, pending, true)).toEqual({ state: "approved" })
        expect(await phone.engine.importFromAccount()).toMatchObject({ state: "updated" })
    })

    it("c5 (accepted limit, documented): a device that learned a removal from a key change refuses the removed device's chains", async () => {
        const email = "c5-fix4@example.org"
        const owner = await accountWithData(email)
        const other = install()
        expect(await loginEmail(other.deps, { email, password: PASSWORD, deviceName: "Pixel 8" })).toMatchObject({ status: "ready" })
        expect(await other.engine.importFromAccount()).toMatchObject({ state: "updated" })
        const removed = install()
        expect(await loginEmail(removed.deps, { email, password: PASSWORD, deviceName: "Tab" })).toMatchObject({ status: "ready" })
        const r = (await removed.session.load())!
        const done = await removeDevice(owner.deps, { deviceId: r.deviceId!, deviceName: "Victim", password: PASSWORD })
        expect(await other.engine.sync("manual")).toMatchObject({ state: "updated" })
        // the server now hands the other phone a chain the removed tablet made from the old key: refused, even with the
        // tablet claiming the current key as the old one is impossible (it never held it)
        const o = (await other.session.load())!
        expect(o.dekId).toBe(done.dekId)
        expect(await other.session.removedDevices(o.userId)).toContain(toB64(sodium, r.deviceKeys!.publicKey))
        const evil = random(32)
        const evilId = toB64(sodium, random(16))
        const d1 = await db()
        await d1.prepare("UPDATE users SET dek_id = ?, chain_from = ?, chain_mac = ?, chain_rotator = ?, chain_removed = '[]' WHERE id = ?")
            .bind(evilId, r.dekId, chainMac(sodium, r.dek!, { userId: r.userId, oldDekId: r.dekId!, newDekId: evilId, rotatorPub: r.deviceKeys!.publicKey, removed: [] }, evil), toB64(sodium, r.deviceKeys!.publicKey), r.userId).run()
        await d1.prepare("UPDATE devices SET dek_id = ?, sealed_dek = ? WHERE id = ?").bind(evilId, boxDek(sodium, evil, evilId, { kind: "rotate", userId: r.userId }, o.deviceKeys!.publicKey, r.deviceKeys!), o.deviceId).run()
        await d1.prepare("UPDATE snapshots SET dek_id = ? WHERE user_id = ?").bind(evilId, r.userId).run()
        expect(await other.engine.sync("manual")).toMatchObject({ state: "key-untrusted" })
        expect((await other.session.load())!.dekId).toBe(done.dekId)
    })

    it("c7 (NEU3-6): a stranger uses up only his own network's reset mails, never the owner's", async () => {
        const email = "c7-fix4@example.org"
        await accountWithData(email)
        const before = (await mails()).length
        const stranger = install(undefined, "203.0.113.70")
        for (let i = 0; i < 6; i++) await stranger.client.resetRequest(email).catch(() => undefined)
        const owner = install(undefined, "198.51.100.70")
        await new Promise(resolve => setTimeout(resolve, 300))
        const strangers = (await subjects(email, before)).length
        expect(strangers).toBeLessThanOrEqual(3)
        await owner.client.resetRequest(email)
        await nextMailToken(before + strangers, email)
    })

    it("c8 (NEU3-7): a waiting sender writes no sign-in nonce or challenge", async () => {
        const d1 = await db()
        const count = async () => (await d1.prepare("SELECT COUNT(*) AS n FROM used_nonces").bind().first<{ n: number }>())!.n
        const flood = install(undefined, "192.0.2.80")
        for (let i = 0; i < 20; i++) {
            const { challenge } = await flood.client.prelogin("c8-nobody@example.org")
            await flood.client.login("c8-nobody@example.org", toB64(sodium, random(32)), challenge, await freshSigner()).catch(() => undefined)
        }
        const before = await count()
        for (let i = 0; i < 4; i++) {
            const { challenge } = await flood.client.prelogin("c8-nobody@example.org")
            await expect(flood.client.login("c8-nobody@example.org", toB64(sodium, random(32)), challenge, await freshSigner())).rejects.toThrow(RateLimitedError)
        }
        expect(await count()).toBe(before)
    })

    it("c9 / I2 (NEU3-3): a flood of made-up removed keys from the server never makes a device forget its own removal", async () => {
        const email = "c9-fix4@example.org"
        const owner = await accountWithData(email)
        const tab = install()
        expect(await loginEmail(tab.deps, { email, password: PASSWORD, deviceName: "Tab" })).toMatchObject({ status: "ready" })
        const t = (await tab.session.load())!
        await removeDevice(owner.deps, { deviceId: t.deviceId!, deviceName: "Victim", password: PASSWORD })
        const o = (await owner.session.load())!
        const d1 = await db()
        for (let i = 0; i < 250; i++) await d1.prepare("INSERT INTO removed_devices (user_id, device_pub, removed_at) VALUES (?, ?, ?)").bind(o.userId, toB64(sodium, random(32)), 4_000_000_000 + i).run()
        for (let i = 0; i < 6; i++) await owner.engine.sync("manual")
        expect(await owner.session.removedDevices(o.userId)).toContain(toB64(sodium, t.deviceKeys!.publicKey))
        // the server puts the tablet's row back with a MAC under the current key (as if it had never been removed): it is
        // not ticked and can't be kept
        const mac = deviceMac(sodium, o.dek!, { userId: o.userId, dekId: o.dekId!, devicePub: t.deviceKeys!.publicKey })
        await d1.prepare("INSERT INTO devices (id, user_id, name, device_pub, sealed_dek, dek_id, mac, created_at, last_seen_at) VALUES (?, ?, 'Tab', ?, 'x', ?, ?, 0, 0)")
            .bind(t.deviceId, o.userId, toB64(sodium, t.deviceKeys!.publicKey), o.dekId, mac).run()
        expect((await checkedDevices(owner.deps)).find(device => device.id === t.deviceId)).toMatchObject({ keepByDefault: false })
        await expect(rotate(owner.deps, { keep: [t.deviceId!], encKey: await encKeyFor(owner.client, PASSWORD, email) })).rejects.toThrow(UntrustedDevicesError)
        const done = await changeKey(owner.deps, { deviceName: "Victim", password: PASSWORD, keep: await keepAll(owner) })
        expect((await owner.client.devices()).map(device => device.id)).not.toContain(t.deviceId)
        expect(done.dekId).not.toBe(o.dekId)
    }, 30_000) // 250 D1 writes and six syncs: over 5 s on a busy machine (a parallel Gradle build)

    it("I5: every security change sends a mail and leaves an event", async () => {
        const email = "i5-fix4@example.org"
        const owner = await accountWithData(email)
        const tab = install()
        expect(await loginEmail(tab.deps, { email, password: PASSWORD, deviceName: "Tab" })).toMatchObject({ status: "ready" })
        await createRecoveryCode(owner.deps)
        await changeKey(owner.deps, { deviceName: "Victim", password: PASSWORD, keep: [(await owner.session.load())!.deviceId!] })
        const kinds = (await owner.client.account()).events!.map(event => event.kind)
        // newest first; the owner's re-sign-in for the key change takes its own row back and is no new device
        expect(kinds).toEqual(["key_rotated", "device_removed", "recovery_changed", "new_device", "new_device"])
        expect(await subjects(email, 0)).toEqual(expect.arrayContaining(["New device signed in", "Your recovery code was changed", "A device was removed", "Your account key was changed"]))
    })

    it("a connection that drops in the middle of a sign-in leaves no half session: signing in again simply works", async () => {
        const email = "half-sign-in@example.org"
        const registering = (method: string, url: string) => method === "PUT" && url.endsWith("/account/keys")
        // sign-up: the account exists, the key did not arrive
        const one = install()
        one.net.fails = registering
        await expect(signupEmail(one.deps, { email, password: PASSWORD, deviceName: "One", kdf: KDF })).rejects.toThrow("Network request failed")
        expect(await one.session.load()).toBeNull()
        one.net.fails = null
        expect(await loginEmail(one.deps, { email, password: PASSWORD, deviceName: "One" })).toMatchObject({ status: "ready" })
        await (await one.db()).insert(playlists).values({ name: "Evening", episodes: [], createdAt: clock, updatedAt: clock })
        expect(await one.engine.sync("start")).toMatchObject({ state: "uploaded", version: 1 })

        // a second device: the password opened the key, registering the device failed
        const two = install()
        two.net.fails = registering
        await expect(loginEmail(two.deps, { email, password: PASSWORD, deviceName: "Two" })).rejects.toThrow("Network request failed")
        // not "signed in without the key" (which offers Start fresh and would delete the account's data)
        expect(await two.session.load()).toBeNull()
        expect(await two.engine.sync("start")).toMatchObject({ state: "signed-out" })
        two.net.fails = null
        expect(await loginEmail(two.deps, { email, password: PASSWORD, deviceName: "Two" })).toMatchObject({ status: "ready" })
        expect(await two.engine.importFromAccount()).toMatchObject({ state: "updated", version: 1 })
        expect(await names(two)).toEqual(["Evening"])

        // a signed-in device that gives its password again (key change, recovery code) stays signed in as it was
        const before = await one.session.load()
        one.net.fails = registering
        await expect(loginEmail(one.deps, { email, password: PASSWORD, deviceName: "One" })).rejects.toThrow("Network request failed")
        one.net.fails = null
        expect(await one.session.load()).toMatchObject({ sessionToken: before!.sessionToken, deviceId: before!.deviceId, dekId: before!.dekId })
        expect(await one.engine.sync("manual")).toMatchObject({ state: "up-to-date", version: 1 })
    })

    it("delete synced data: the server counts the version on, the other device uploads again, and a key change still works", async () => {
        const email = "delete-synced@example.org"
        const [one, two] = [install(), install()]
        await signupEmail(one.deps, { email, password: PASSWORD, deviceName: "One", kdf: KDF })
        await (await one.db()).insert(playlists).values({ name: "Evening", episodes: [], createdAt: clock, updatedAt: clock })
        expect(await one.engine.sync("start")).toMatchObject({ state: "uploaded", version: 1 })
        await loginEmail(two.deps, { email, password: PASSWORD, deviceName: "Two" })
        expect(await two.engine.importFromAccount()).toMatchObject({ state: "updated", version: 1 })

        await one.engine.deleteSynced()
        expect(await one.client.syncMeta()).toMatchObject({ version: 2, size: 0, dekId: null })
        expect(await one.client.snapshot()).toBeNull()
        // a key change with no data in the account
        await changeKey(one.deps, { deviceName: "One", password: PASSWORD, keep: await keepAll(one) })
        expect(await one.client.syncMeta()).toMatchObject({ version: 2, size: 0 })

        // the other device saw version 1: no rollback, it follows the key change and uploads its own data
        expect(await two.engine.sync("manual")).toMatchObject({ state: "uploaded", version: 3 })
        // the device that deleted holds nothing that package lacks: it takes it and has nothing to send
        expect(await one.engine.sync("manual")).toMatchObject({ state: "updated", version: 3 })
        expect(await names(one)).toEqual(["Evening"])
        expect(await two.engine.sync("manual")).toMatchObject({ state: "up-to-date", version: 3 })
    })

    it("F1: the synced data is deleted on the website and a fresh device syncs first: no other device loses its data, all end with it", async () => {
        const email = "f1-website-delete@example.org"
        const one = await accountWithData(email)
        const two = install()
        await loginEmail(two.deps, { email, password: PASSWORD, deviceName: "Two" })
        expect(await two.engine.importFromAccount()).toMatchObject({ state: "updated", version: 1 })
        // on the website: neither device knows, both still hold the hash of what they synced last
        const web = await keylessSession(email)
        await web.client.deleteSync()
        expect(await web.client.syncMeta()).toMatchObject({ version: 2, size: 0, dekId: null })

        const fresh = install()
        expect(await loginEmail(fresh.deps, { email, password: PASSWORD, deviceName: "Fresh" })).toMatchObject({ status: "ready" })
        expect(await fresh.engine.sync("start")).toMatchObject({ state: "uploaded", version: 3 })

        expect(await one.engine.sync("manual")).toMatchObject({ state: "merged", version: 4 })
        expect(await names(one)).toEqual(["Mine"])
        expect(await two.engine.sync("manual")).toMatchObject({ state: "updated", version: 4 })
        expect(await names(two)).toEqual(["Mine"])
        expect(await fresh.engine.sync("manual")).toMatchObject({ state: "updated", version: 4 })
        expect(await names(fresh)).toEqual(["Mine"])
        for (const device of [one, two, fresh]) expect(await device.engine.sync("manual")).toMatchObject({ state: "up-to-date", version: 4 })
    })

    it("F1b: a compromised server tells only a fresh device 'no data' and gets its sealed package for the next version: it empties no device with it", async () => {
        const email = "f1b-size-zero@example.org"
        const one = await accountWithData(email)
        one.secrets.set(ACCOUNT_TOKEN_SECRET, "anilist-token")
        one.preferences.set("sea-theme", "\"dark\"")
        expect(await one.engine.sync("manual")).toMatchObject({ state: "uploaded", version: 2 })
        const two = install()
        await loginEmail(two.deps, { email, password: PASSWORD, deviceName: "Two" })
        expect(await two.engine.importFromAccount()).toMatchObject({ state: "updated", version: 2 })

        const fresh = install()
        expect(await loginEmail(fresh.deps, { email, password: PASSWORD, deviceName: "Fresh" })).toMatchObject({ status: "ready" })
        fresh.net.lies = (method, url, answer) => method === "GET" && url.endsWith("/sync/meta") ? { ...answer as object, size: 0, dekId: null } : answer
        // no import question, and the upload is accepted: the server now holds a package of the fresh device, bound to version 3
        expect(await fresh.engine.sync("start")).toMatchObject({ state: "uploaded", version: 3 })
        fresh.net.lies = null
        expect(await one.client.syncMeta()).toMatchObject({ version: 3 })

        // the devices that changed nothing get it as the account's newer package
        for (const device of [one, two]) {
            await device.engine.sync("manual")
            expect(await names(device)).toEqual(["Mine"])
            expect(device.secrets.get(ACCOUNT_TOKEN_SECRET)).toBe("anilist-token")
            expect(device.preferences.get("sea-theme")).toBe("\"dark\"")
        }
        // and what the attack leaves behind is the account's data on every device
        expect(await fresh.engine.sync("manual")).toMatchObject({ state: "updated" })
        expect(await names(fresh)).toEqual(["Mine"])
        for (const device of [one, two, fresh]) expect(await device.engine.sync("manual")).toMatchObject({ state: "up-to-date" })
    })

    it("C1: two devices turn off two different switches of one page (one row) and a field each of a player preference: after S22, tablet, S22 both keep both", async () => {
        const email = "c1-fields@example.org"
        const PLAYER = "sea-video-core-settings"
        const looks = async (one: ReturnType<typeof install>) => (await (await one.db()).select().from(appearance))[0]?.content
        const setLooks = async (one: ReturnType<typeof install>, content: Record<string, unknown>) => {
            await (await one.db()).insert(appearance).values({ id: 1, content, createdAt: clock, changedAt: clock })
                .onConflictDoUpdate({ target: appearance.id, set: { content, changedAt: clock } })
        }
        const s22 = await accountWithData(email)
        await setLooks(s22, { unwatchedCount: true, unreadCount: true })
        s22.preferences.set(PLAYER, JSON.stringify({ autoSkip: false, subtitles: "off" }))
        expect(await s22.engine.sync("manual")).toMatchObject({ state: "uploaded", version: 2 })
        const tablet = install()
        await loginEmail(tablet.deps, { email, password: PASSWORD, deviceName: "Tablet" })
        expect(await tablet.engine.importFromAccount()).toMatchObject({ state: "updated", version: 2 })

        clock += 60_000
        await setLooks(s22, { unwatchedCount: false, unreadCount: true })
        s22.preferences.set(PLAYER, JSON.stringify({ autoSkip: true, subtitles: "off" }))
        clock += 60_000
        await setLooks(tablet, { unwatchedCount: true, unreadCount: false })
        tablet.preferences.set(PLAYER, JSON.stringify({ autoSkip: false, subtitles: "on" }))
        expect(await s22.engine.sync("manual")).toMatchObject({ state: "uploaded", version: 3 })
        expect(await tablet.engine.sync("manual")).toMatchObject({ state: "merged", version: 4 })
        expect(await s22.engine.sync("manual")).toMatchObject({ state: "updated", version: 4 })
        for (const device of [s22, tablet]) {
            expect(await looks(device)).toEqual({ unwatchedCount: false, unreadCount: false })
            expect(JSON.parse(device.preferences.get(PLAYER)!)).toEqual({ autoSkip: true, subtitles: "on" })
            expect(await names(device)).toEqual(["Mine"])
            expect(await device.engine.sync("manual")).toMatchObject({ state: "up-to-date", version: 4 })
        }
    })

    it("F4: a device that does not trust the account's key gives its password again and the connection drops: it stays as it was, never signed in without the key", async () => {
        const email = "f4-untrusted-retry@example.org"
        const owner = await accountWithData(email)
        const late = install()
        expect(await loginEmail(late.deps, { email, password: PASSWORD, deviceName: "Late" })).toMatchObject({ status: "ready" })
        expect(await late.engine.importFromAccount()).toMatchObject({ state: "updated" })
        // as in c2b: a key change the late device missed, by a device removed afterwards
        await changeKey(owner.deps, { deviceName: "Victim", password: PASSWORD, keep: await keepAll(owner) })
        const web = await keylessSession(email)
        await web.client.deleteDevice((await owner.session.load())!.deviceId!)
        expect(await late.engine.sync("manual")).toMatchObject({ state: "key-untrusted" })
        const before = (await late.session.load())!

        // the password again while the session lives; registering the device does not get through
        late.net.fails = (method, url) => method === "PUT" && url.endsWith("/account/keys")
        await expect(loginEmail(late.deps, { email, password: PASSWORD, deviceName: "Late" })).rejects.toThrow("Network request failed")
        late.net.fails = null
        expect(await late.session.load()).toMatchObject({
            sessionToken: before.sessionToken, deviceId: before.deviceId, dekId: before.dekId, dek: before.dek,
            imported: before.imported, highestVersion: before.highestVersion, lastHash: before.lastHash,
        })
        expect(await late.engine.sync("manual")).toMatchObject({ state: "key-untrusted" })
        expect(await names(late)).toEqual(["Mine"])

        // with the connection back the password gets the device in, and the data is there
        expect(await loginEmail(late.deps, { email, password: PASSWORD, deviceName: "Late" })).toMatchObject({ status: "ready", keyChanged: true })
        expect(await late.engine.importFromAccount()).toMatchObject({ state: "updated" })
        expect(await names(late)).toEqual(["Mine"])
    })

    it("N-8 and M-2: a P-256 key like the Keystore's signs everything; the device keeps it, so a lockout of its email never stops it; signing out makes a new one", async () => {
        const email = "n8-keystore@example.org"
        const one = install(p256SignerStore())
        expect(await signupEmail(one.deps, { email, password: PASSWORD, deviceName: "Keystore phone" })).toMatchObject({ status: "ready" })
        expect(await one.client.syncMeta()).toMatchObject({ version: 0 })
        const key = (await one.session.signer()).publicKey
        expect(key).toHaveLength(65)
        const row = await (await db()).prepare("SELECT d.sig_alg AS alg, d.sig_pub AS pub FROM devices d JOIN users u ON u.id = d.user_id WHERE u.email = ?").bind(email).first<{ alg: string, pub: string }>()
        expect(row).toEqual({ alg: "p256", pub: toB64(sodium, key) })

        // somebody fails five times for this email (same network as the device here)
        for (let i = 0; i < 5; i++) {
            const { challenge } = await one.client.prelogin(email)
            await expect(one.client.login(email, toB64(sodium, random(32)), challenge, await freshSigner())).rejects.toThrow(UnauthorizedError)
        }
        // a new browser on that network has to wait ...
        await expect(loginEmail(install().deps, { email, password: PASSWORD, deviceName: "Stranger" })).rejects.toThrow(RateLimitedError)
        // ... the device whose session the server ended (expired, reset) signs in again with its kept key and gets in
        await one.session.dropSession()
        expect(await loginEmail(one.deps, { email, password: PASSWORD, deviceName: "Keystore phone" })).toMatchObject({ status: "ready" })
        expect((await one.session.signer()).publicKey).toEqual(key)

        await signOut(one.deps)
        expect(await one.session.credentials()).toBeNull()
        expect((await one.session.signer()).publicKey).not.toEqual(key)
    })
})

/** Statements of a migration file; a trigger body (BEGIN ... END) keeps its inner semicolons */
function sqlStatements(sql: string): string[] {
    const out: string[] = []
    let pending = ""
    for (const part of sql.split(";")) {
        pending += pending ? `;${part}` : part
        if (/CREATE\s+TRIGGER/i.test(pending) && !/END\s*$/i.test(pending.trim())) continue
        if (pending.trim()) out.push(`${pending.trim()};`)
        pending = ""
    }
    return out
}

type D1Like = { prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown>, first<T = Record<string, unknown>>(): Promise<T | null>, all<T = Record<string, unknown>>(): Promise<{ results: T[] }> } } }
