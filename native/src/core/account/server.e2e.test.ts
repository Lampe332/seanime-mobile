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
import { isDeviceKey } from "@/lib/app-backup-keys"
import { openDatabaseSync } from "../../../test/expo-sqlite"
import { playlists } from "../database/schema"
import { ACCOUNT_TOKEN_SECRET } from "../move/move"
import { AccountClient, type HttpFetch, RateLimitedError, type RequestSigner, UnauthorizedError } from "./client"
import {
    AccountCryptoError, DEFAULT_KDF, type Kdf, RemovedDeviceListedError, UnsafeKdfError, UntrustedDevicesError, UntrustedKeyChangeError, approvalTranscript, boxDek, chainMac, dekProof,
    deriveKeys, deviceMac, fromB64, toB64,
} from "./crypto"
import { type AccountDeps, answerRequest, approveRequest, checkApproval, checkedDevices, compareRequest, confirmApproval, openRequests, requestApproval, rotate } from "./devices"
import { completeRotation, createRecoveryCode, loginEmail, removeDevice, resetWithRecovery, resetWithoutRecovery, signOut, signupEmail, startFresh } from "./flows"
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

    /** One app install: core data, secured storage, client, sync engine */
    function install(signers?: SignerStore) {
        const one = device(driver, () => clock)
        const store = memoryStore()
        const session = new AccountSession(store, sodium, signers)
        const client = new AccountClient({ baseUrl, fetch: fetch as unknown as HttpFetch, sodium, credentials: () => session.credentials() })
        const deps: AccountDeps = { client, session, sodium }
        let backups = 0
        const local = coreLocalData(one.environment, {
            appVersion: "4.2.0",
            preferences: () => Object.fromEntries(one.preferences),
            isDeviceKey,
            writePreferences: preferences => {
                for (const [key, value] of Object.entries(preferences)) one.preferences.set(key, value)
            },
            safetyBackup: async () => void backups++,
        })
        const engine = new SyncEngine({ api: client, session, sodium, gzip, local, now: () => clock })
        return { ...one, store, session, client, deps, engine, backups: () => backups }
    }

    async function encKeyFor(client: AccountClient, password: string): Promise<Uint8Array> {
        const { salt, kdf } = await client.prelogin(EMAIL)
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
        const rotated = await rotate(phone.deps, { encKey: await encKeyFor(phone.client, PASSWORD) })
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
        expect(await resetWithoutRecovery(lonely.deps, { token, email: EMAIL, newPassword: password, deviceName: "Lonely", kdf: KDF })).toMatchObject({ status: "needs-key", rotation: "blocked" })
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
        // the victim's rotation seals nothing to it
        await victim.session.updateSession({ kind: "google" })
        await expect(rotate(victim.deps)).rejects.toThrow(UntrustedDevicesError)
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
        const rotated = await rotate(owner.deps, { encKey: (await deriveKeys(sodium, PASSWORD, fromB64(sodium, salt, 16), kdf)).encKey })
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

    it("(e) N-3 and M-4: a reset without code keeps the key through the 401, the next sign-in wraps it and finishes the rotation; a pending rotation never stops the sync", async () => {
        const email = "e-normal@example.org"
        const phone2 = await accountWithData(email)
        const tablet2 = install()
        expect(await loginEmail(tablet2.deps, { email, password: PASSWORD, deviceName: "Tablet" })).toMatchObject({ status: "ready" })
        expect(await tablet2.engine.importFromAccount()).toMatchObject({ state: "updated", version: 1 })
        const laptop2 = install()
        expect(await loginEmail(laptop2.deps, { email, password: PASSWORD, deviceName: "Laptop" })).toMatchObject({ status: "ready" })

        // the laptop is removed (as on the website): the server asks for a rotation; without the password here the sync goes on
        await phone2.client.deleteDevice((await laptop2.session.load())!.deviceId!)
        const withRotation = new SyncEngine({ api: tablet2.client, session: tablet2.session, sodium, gzip, local: coreLocalData(tablet2.environment, { appVersion: "4.2.0", preferences: () => ({}), isDeviceKey, writePreferences: () => undefined, safetyBackup: async () => undefined }), now: () => clock, rotate: async () => {
            await rotate(tablet2.deps)
            return true
        } })
        await (await tablet2.db()).insert(playlists).values({ name: "Tablet", episodes: [], createdAt: clock, updatedAt: clock })
        expect(await withRotation.sync("manual")).toMatchObject({ state: "uploaded", version: 2, rotationRequired: true })

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

        // the tablet still holds the key: it wraps it for the new password and rotates right away
        const keptId = (await tablet2.session.keptKey())!.dekId
        expect(await loginEmail(tablet2.deps, { email, password: newPassword, deviceName: "Tablet" })).toMatchObject({ status: "ready" })
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
        await expect(thief.client.putKeys({ dekId: stolen.dekId!, dekProof: dekProof(sodium, kept), device: rowFor(sodium.crypto_box_keypair()) })).rejects.toMatchObject({ status: 403, code: "rotation_pending" })
        await expect(thief.client.snapshot()).rejects.toMatchObject({ status: 403 })
        await expect(rotate(thief.deps)).rejects.toThrow(AccountCryptoError)
        // the owner finishes the removal with the password; the chain names the removed key
        const done = await completeRotation(victim.deps, { deviceName: "Victim", password: PASSWORD })
        expect(done.dekId).not.toBe(stolen.dekId)
        expect(await victim.client.syncMeta()).toMatchObject({ rotationRequired: false, dekId: done.dekId })
        expect(await d1.prepare("SELECT chain_removed FROM users WHERE id = ?").bind(stolen.userId).first()).toEqual({ chain_removed: JSON.stringify([toB64(sodium, own.publicKey)]) })
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
        await expect(completeRotation(victim.deps, { deviceName: "Victim", password: PASSWORD })).rejects.toThrow(RemovedDeviceListedError)
        expect(await d1.prepare("SELECT dek_id FROM devices WHERE id = ?").bind(rRow.id).first()).toEqual({ dek_id: vState.dekId })
        expect(await d1.prepare("SELECT dek_id FROM users WHERE id = ?").bind(r.userId).first()).toEqual({ dek_id: vState.dekId })
        expect((await checkedDevices(victim.deps)).find(device => device.devicePub === rRow.device_pub)?.verified).toBe(false)
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

type D1Like = { prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown>, first<T = Record<string, unknown>>(): Promise<T | null> } } }
