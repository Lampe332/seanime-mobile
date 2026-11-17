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
import { AccountClient, type HttpFetch, UnauthorizedError } from "./client"
import { type Kdf, deriveKeys, fromB64, toB64 } from "./crypto"
import { type AccountDeps, ServerContractError, answerRequest, approveRequest, checkApproval, compareRequest, openRequests, requestApproval, rotate } from "./devices"
import { createRecoveryCode, loginEmail, removeDevice, resetWithRecovery, signupEmail } from "./flows"
import { AccountSession } from "./session"
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
/** Fast test parameters inside the server's allowed range; the app uses DEFAULT_KDF */
const KDF: Kdf = { alg: "argon2id", m: 19456, t: 1, p: 1 }
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
            for (const statement of sql.split(";").map(part => part.trim()).filter(Boolean)) await db.prepare(statement).run()
        }
    }, 120_000)

    afterAll(async () => {
        await mf?.dispose()
    })

    let clock = Date.parse("2026-11-17T10:00:00.000Z")

    /** One app install: core data, secured storage, client, sync engine */
    function install() {
        const one = device(driver, () => clock)
        const store = memoryStore()
        const session = new AccountSession(store, sodium)
        const client = new AccountClient({ baseUrl, fetch: fetch as unknown as HttpFetch, token: async () => (await session.load())?.sessionToken ?? null })
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
        return deriveKeys(sodium, password, fromB64(sodium, salt, 16), kdf).encKey
    }

    async function lastMailToken(): Promise<string> {
        const mails = await (await (await mf.getWorker("mail-sink")).fetch("http://mail-sink/")).json() as { to: string, text: string }[]
        const match = /#token=([A-Za-z0-9_-]{43})/.exec(mails.filter(mail => mail.to === EMAIL).at(-1)?.text ?? "")
        if (!match) throw new Error("no mail with a token")
        return match[1]!
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
        const { salt, kdf } = await laptop.client.prelogin(EMAIL)
        const { authKey } = deriveKeys(sodium, PASSWORD, fromB64(sodium, salt, 16), kdf)
        const login = await laptop.client.login(EMAIL, toB64(sodium, authKey))
        await laptop.session.saveSession({ userId: login.userId, sessionToken: login.sessionToken, kind: "email", email: EMAIL, deviceId: null })

        const pending = await requestApproval(laptop.deps, "Laptop")
        expect(await checkApproval(laptop.deps, pending)).toEqual({ state: "waiting" })
        const [request] = await openRequests(phone.deps)
        expect(request).toMatchObject({ id: pending.id, deviceName: "Laptop", status: "pending" })
        const turn = await answerRequest(phone.deps, request!)
        expect(await compareRequest(phone.deps, turn)).toEqual({ state: "waiting" })
        const onLaptop = await checkApproval(laptop.deps, pending)
        const onPhone = await compareRequest(phone.deps, turn)
        expect(onLaptop.state).toBe("compare")
        expect(onPhone).toEqual(onLaptop)
        await approveRequest(phone.deps, turn)
        expect(await checkApproval(laptop.deps, pending)).toEqual({ state: "approved" })
        const [phoneState, laptopState] = [await phone.session.load(), await laptop.session.load()]
        expect(laptopState!.dekId).toBe(phoneState!.dekId)
        expect(laptopState!.dek).toEqual(phoneState!.dek)
        expect(laptopState!.deviceId).toBeTruthy()
        expect(await laptop.engine.importFromAccount()).toMatchObject({ state: "updated", version: 2 })
        expect(await names(laptop)).toEqual(["Evening", "Tablet list"])
    })

    it("rotation: refused by the server contract while other devices exist, works once the device is alone", async () => {
        const encKey = await encKeyFor(phone.client, PASSWORD)
        await expect(rotate(phone.deps, { encKey })).rejects.toThrow(ServerContractError)
        const before = (await phone.session.load())!.dekId
        // remove the laptop (contract error again: the tablet is still there), then the tablet: the phone rotates alone
        const laptopId = (await laptop.session.load())!.deviceId!
        await expect(removeDevice(phone.deps, { deviceId: laptopId, deviceName: "Phone", password: PASSWORD })).rejects.toThrow(ServerContractError)
        const tabletId = (await tablet.session.load())!.deviceId!
        const rotated = await removeDevice(phone.deps, { deviceId: tabletId, deviceName: "Phone", password: PASSWORD })
        expect(rotated.dekId).not.toBe(before)
        expect(await phone.client.syncMeta()).toMatchObject({ dekId: rotated.dekId, version: rotated.version, rotationRequired: false })
        // the re-encrypted package opens with the new DEK; the removed tablet is signed out
        expect(await phone.engine.sync("manual")).toMatchObject({ state: "up-to-date", version: rotated.version })
        await expect(tablet.client.syncMeta()).rejects.toThrow(UnauthorizedError)
        expect(await tablet.engine.sync("manual")).toMatchObject({ state: "signed-out" })
        // and a fresh sign-in on a new install gets the new key through the new password wrap
        const fresh = install()
        expect(await loginEmail(fresh.deps, { email: EMAIL, password: PASSWORD, deviceName: "New" })).toMatchObject({ status: "ready" })
        expect((await fresh.session.load())!.dekId).toBe(rotated.dekId)
        expect(await fresh.engine.importFromAccount()).toMatchObject({ state: "updated" })
        expect(await names(fresh)).toEqual(["Evening", "Tablet list"])
    })

    it("password reset with the recovery code keeps the data", async () => {
        await loginEmail(phone.deps, { email: EMAIL, password: PASSWORD, deviceName: "Phone" })
        const code = await createRecoveryCode(phone.deps)
        await phone.client.resetRequest(EMAIL)
        const token = await lastMailToken()
        const newPassword = "another long password 2"
        expect(await resetWithRecovery(phone.deps, { token, recoveryCode: code, email: EMAIL, newPassword, deviceName: "Phone", kdf: KDF })).toMatchObject({ status: "ready" })
        const other = install()
        expect(await loginEmail(other.deps, { email: EMAIL, password: newPassword, deviceName: "Other" })).toMatchObject({ status: "ready" })
        expect(await other.engine.importFromAccount()).toMatchObject({ state: "updated" })
        expect(await names(other)).toEqual(["Evening", "Tablet list"])
    })
})
