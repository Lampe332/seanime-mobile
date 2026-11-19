// geschrieben nach: Plan „Account + Sync“ (Abschnitte 6.5, 6.6, 8, 13) und dem Verhalten von account-server/src/routes.ts (syncMeta, putSnapshot mit If-Match/409); Werte erfunden

import { eq } from "drizzle-orm"
import { createRequire } from "node:module"
import { gunzipSync, gzipSync } from "fflate"
import { sqlDriverFor } from "@/api/client/core-database"
import { isDeviceKey } from "@/lib/app-backup-keys"
import { openDatabaseSync } from "../../../test/expo-sqlite"
import { beforeAll, describe, expect, it } from "vitest"
import { anilistChanges, playlists, settingsSections, watchPositions } from "../database/schema"
import { DEBRID_KEY_SECRET } from "../debrid/debrid"
import { AccountApiError, ConflictError, type Snapshot, type SyncMeta } from "./client"
import { AccountSession } from "./session"
import type { Sodium } from "./sodium"
import { decryptPackage } from "./crypto"
import { applyPackage, makePackage, readPackage } from "./package"
import { SYNC_INTERVAL_MS, type SyncApi, SyncEngine, coreLocalData } from "./sync"
import { bytes, device, memoryStore, ready } from "./__fixtures__/harness"

const sodiumLibrary = createRequire(import.meta.url)("libsodium-wrappers-sumo")
const gzip = { gzip: (data: Uint8Array) => gzipSync(data, { mtime: 0 }), gunzip: gunzipSync }
const driver = (name: string) => sqlDriverFor(openDatabaseSync(name) as never)

let sodium: Sodium
beforeAll(async () => {
    sodium = await ready(sodiumLibrary)
})

const USER = "6f1c2c1e-0d7b-4c3a-9a51-2f0e7d4b8a10"
const DEK_ID = "dek-1"

/** Test double of the server's sync endpoints: one blob, a version, If-Match like routes.ts putSnapshot */
class FakeServer implements SyncApi {
    version = 0
    blob: Uint8Array | null = null
    uploads = 0
    /** What the next answers claim, to play a lying server */
    overrideMeta: Partial<SyncMeta> = {}
    oldSnapshot: Snapshot | null = null
    syncMeta = async (): Promise<SyncMeta> => ({ version: this.version, size: this.blob?.length ?? 0, dekId: this.blob ? DEK_ID : null, updatedAt: null, rotationRequired: false, rewrapNeeded: false, recoveryRenewalNeeded: false, ...this.overrideMeta })
    /** This fake holds no sealed keys: like a device the server no longer knows */
    deviceKey = async () => {
        throw new AccountApiError(404, "not_found", "no key")
    }
    snapshot = async (): Promise<Snapshot | null> => this.oldSnapshot ?? (this.blob ? { bytes: this.blob, version: this.version, dekId: DEK_ID } : null)
    putSnapshot = async (bytes: Uint8Array, ifMatch: number, dekId: string) => {
        if (dekId !== DEK_ID) throw new ConflictError("dek_mismatch", "different key", {})
        if (ifMatch !== this.version) throw new ConflictError("version_conflict", "changed", { version: this.version })
        this.version++
        this.blob = bytes
        this.uploads++
        return { version: this.version, size: bytes.length, updatedAt: 0 }
    }
}

/** The plaintext (still gzipped) of a package on the fake server */
const sodiumOpen = (blob: Uint8Array, version: number) => decryptPackage(sodium, blob, bytes(32, 40), { userId: USER, version, dekId: DEK_ID })

let clock = Date.parse("2026-11-17T10:00:00.000Z")

async function phone(server: FakeServer, options: { imported: boolean }) {
    const one = device(driver, () => clock)
    const session = new AccountSession(memoryStore(), sodium)
    await session.saveSession({ userId: USER, sessionToken: "t".repeat(43), kind: "email", email: "a@example.org", deviceId: "d" })
    await session.saveDek(DEK_ID, bytes(32, 40))
    await session.updateSync({ imported: options.imported })
    let safetyBackups = 0
    let ledger: string | null = null
    const local = coreLocalData(one.environment, {
        appVersion: "4.2.0",
        preferences: () => Object.fromEntries(one.preferences),
        isDeviceKey,
        writePreferences: (preferences, removed) => {
            for (const [key, value] of Object.entries(preferences)) one.preferences.set(key, value)
            for (const key of removed) one.preferences.delete(key)
        },
        ledger: { read: () => ledger, write: text => void (ledger = text) },
        safetyBackup: async () => void safetyBackups++,
    })
    const engine = new SyncEngine({ api: server, session, sodium, gzip, local, now: () => clock })
    return { ...one, session, engine, safetyBackups: () => safetyBackups }
}

const playlist = (name: string) => ({ name, episodes: [], createdAt: clock, updatedAt: clock })

describe("sync engine", () => {
    it("uploads only when the plaintext changed, and the 5-minute tick waits 5 minutes", async () => {
        const server = new FakeServer()
        const a = await phone(server, { imported: true })
        await (await a.db()).insert(playlists).values(playlist("Evening"))
        expect(await a.engine.sync("start")).toMatchObject({ state: "uploaded", version: 1 })
        expect(await a.engine.sync("manual")).toMatchObject({ state: "up-to-date", version: 1 })
        await (await a.db()).insert(playlists).values(playlist("Morning"))
        expect(await a.engine.sync("interval")).toMatchObject({ state: "skipped" })
        clock += SYNC_INTERVAL_MS
        expect(await a.engine.sync("interval")).toMatchObject({ state: "uploaded", version: 2 })
        expect(server.uploads).toBe(2)
    })

    it("a new device never uploads first: it offers the import, which makes a local backup and brings the data", async () => {
        const server = new FakeServer()
        const a = await phone(server, { imported: true })
        await (await a.db()).insert(playlists).values(playlist("Evening"))
        await a.engine.sync("start")

        const b = await phone(server, { imported: false })
        await (await b.db()).insert(playlists).values(playlist("Fresh install"))
        expect(await b.engine.sync("start")).toMatchObject({ state: "import-available", version: 1 })
        expect(await b.engine.sync("manual")).toMatchObject({ state: "import-available" })
        expect(server.uploads).toBe(1)

        expect(await b.engine.importFromAccount()).toMatchObject({ state: "updated", version: 1 })
        expect(b.safetyBackups()).toBe(1)
        expect((await (await b.db()).select().from(playlists)).map(row => row.name)).toEqual(["Evening"])
        expect(await b.engine.sync("manual")).toMatchObject({ state: "up-to-date", version: 1 })
    })

    it("a device that changed nothing takes the newer package as it is", async () => {
        const server = new FakeServer()
        const a = await phone(server, { imported: true })
        await a.engine.sync("start")
        const b = await phone(server, { imported: false })
        await b.engine.importFromAccount()
        await (await a.db()).insert(playlists).values(playlist("From A"))
        await a.engine.sync("manual")
        expect(await b.engine.sync("manual")).toMatchObject({ state: "updated", version: 2 })
        expect((await (await b.db()).select().from(playlists)).map(row => row.name)).toEqual(["From A"])
    })

    it("409: downloads, decrypts, merges (watch positions by time) and uploads the merged state", async () => {
        const server = new FakeServer()
        const a = await phone(server, { imported: true })
        await a.engine.sync("start")
        const b = await phone(server, { imported: false })
        await b.engine.importFromAccount()

        await (await a.db()).insert(playlists).values(playlist("From A"))
        await (await a.db()).insert(watchPositions).values({ mediaId: 7, kind: "onlinestream", episodeNumber: 2, positionSeconds: 10, durationSeconds: 1400, filepath: "", addedAt: clock, changedAt: clock, expiresAt: null })
        await (await b.db()).insert(playlists).values(playlist("From B"))
        await (await b.db()).insert(watchPositions).values({ mediaId: 7, kind: "onlinestream", episodeNumber: 3, positionSeconds: 99, durationSeconds: 1400, filepath: "", addedAt: clock, changedAt: clock + 5000, expiresAt: null })

        expect(await a.engine.sync("manual")).toMatchObject({ state: "uploaded", version: 2 })
        // B built on version 1: the server says 409 on its upload path or B sees the newer version first; both merge
        const merged = await b.engine.sync("manual")
        expect(merged).toMatchObject({ state: "merged", version: 3 })
        expect((await (await b.db()).select().from(playlists)).map(row => row.name).sort()).toEqual(["From A", "From B"])
        expect((await (await b.db()).select().from(watchPositions))[0]).toMatchObject({ episodeNumber: 3, positionSeconds: 99 })

        expect(await a.engine.sync("manual")).toMatchObject({ state: "updated", version: 3 })
        expect((await (await a.db()).select().from(playlists)).map(row => row.name).sort()).toEqual(["From A", "From B"])
        expect((await (await a.db()).select().from(watchPositions))[0]).toMatchObject({ episodeNumber: 3, positionSeconds: 99 })
    })

    it("the changes waiting for AniList stay on the device that made them: never uploaded, never taken from the account", async () => {
        const server = new FakeServer()
        const waiting = (mediaId: number, progress: number) => ({ account: "5", mediaId, kind: "ANIME", action: "update", change: { progress }, createdAt: clock, changedAt: clock })
        const queue = async (one: { db: () => Promise<any> }) => (await (await one.db()).select().from(anilistChanges)).map((row: { mediaId: number, change: unknown }) => [row.mediaId, row.change])
        const a = await phone(server, { imported: true })
        await (await a.db()).insert(anilistChanges).values(waiting(7, 3))
        expect(await a.engine.sync("start")).toMatchObject({ state: "uploaded", version: 1 })
        expect(new TextDecoder().decode(gzip.gunzip(sodiumOpen(server.blob!, 1)))).not.toContain("waitingChanges")

        // import and "newer package, nothing changed here": B's own queue stays, A's never arrives
        const b = await phone(server, { imported: false })
        await (await b.db()).insert(anilistChanges).values(waiting(9, 1))
        await b.engine.importFromAccount()
        expect(await queue(b)).toEqual([[9, { progress: 1 }]])
        await (await a.db()).insert(playlists).values(playlist("From A"))
        await a.engine.sync("manual")
        expect(await b.engine.sync("manual")).toMatchObject({ state: "updated" })
        expect(await queue(b)).toEqual([[9, { progress: 1 }]])

        // merge on both sides: no change is doubled or carried over, and a change in the queue alone is no upload
        await (await a.db()).insert(playlists).values(playlist("A again"))
        await (await b.db()).insert(playlists).values(playlist("B again"))
        await a.engine.sync("manual")
        expect(await b.engine.sync("manual")).toMatchObject({ state: "merged" })
        expect(await queue(b)).toEqual([[9, { progress: 1 }]])
        expect(await a.engine.sync("manual")).toMatchObject({ state: "updated" })
        expect(await queue(a)).toEqual([[7, { progress: 3 }]])
        await (await a.db()).insert(anilistChanges).values(waiting(8, 2))
        expect(await a.engine.sync("manual")).toMatchObject({ state: "up-to-date" })
    })

    it("a package of an older build that still carries waiting changes brings none onto the device", async () => {
        const one = await phone(new FakeServer(), { imported: true })
        const old = { ...await makePackage(one.environment, { appVersion: "4.2.0", preferences: {}, isDeviceKey }) }
        old.tables = { ...old.tables, waitingChanges: [{ id: 1, account: "5", mediaId: 7, kind: "ANIME", action: "update", change: { progress: 1 }, attempts: 0, lastError: null, createdAt: clock, changedAt: clock }] }
        const two = await phone(new FakeServer(), { imported: true })
        for (const mode of ["replace", "merge"] as const) {
            await applyPackage(two.environment, readPackage(JSON.stringify(old)), mode, { preferences: {}, isDeviceKey })
            expect(await (await two.db()).select().from(anilistChanges)).toEqual([])
        }
    })

    it("409 on upload: another device was faster between meta and upload", async () => {
        const server = new FakeServer()
        const a = await phone(server, { imported: true })
        await a.engine.sync("start")
        const b = await phone(server, { imported: false })
        await b.engine.importFromAccount()
        await (await a.db()).insert(playlists).values(playlist("From A"))
        await (await b.db()).insert(playlists).values(playlist("From B"))
        // A uploads right after B read the meta: B's first upload answers 409
        const realMeta = server.syncMeta
        server.syncMeta = async () => {
            const meta = await realMeta()
            server.syncMeta = realMeta
            await a.engine.sync("manual")
            return meta
        }
        expect(await b.engine.sync("manual")).toMatchObject({ state: "merged", version: 3 })
        expect((await (await b.db()).select().from(playlists)).map(row => row.name).sort()).toEqual(["From A", "From B"])
    })

    it("refuses an older version than it saw (rollback), in the meta and in the snapshot", async () => {
        const server = new FakeServer()
        const a = await phone(server, { imported: true })
        await (await a.db()).insert(playlists).values(playlist("One"))
        await a.engine.sync("start")
        const old = { bytes: server.blob!, version: 1, dekId: DEK_ID }
        await (await a.db()).insert(playlists).values(playlist("Two"))
        await a.engine.sync("manual")
        expect(server.version).toBe(2)

        server.overrideMeta = { version: 1 }
        expect(await a.engine.sync("manual")).toMatchObject({ state: "rollback-rejected", version: 1, highest: 2 })

        // the server claims a newer version but hands out the old blob under it: the AAD does not match
        server.overrideMeta = { version: 3 }
        server.oldSnapshot = { ...old, version: 3 }
        await expect(a.engine.sync("manual")).rejects.toThrow("could not be decrypted")
        // or under its true old version: refused as rollback
        server.oldSnapshot = old
        expect(await a.engine.sync("manual")).toMatchObject({ state: "rollback-rejected", version: 1, highest: 2 })
        expect((await (await a.db()).select().from(playlists)).map(row => row.name)).toEqual(["One", "Two"])
    })

    it("stops when another device rotated the key, and reports the server's flags", async () => {
        const server = new FakeServer()
        const a = await phone(server, { imported: true })
        await a.engine.sync("start")
        server.overrideMeta = { dekId: "dek-2", rotationRequired: true, rewrapNeeded: true }
        expect(await a.engine.sync("manual")).toEqual({ state: "key-changed", rotationRequired: true, rewrapNeeded: true, recoveryRenewalNeeded: false })
        expect(server.uploads).toBe(1)
    })
})

/** Two devices of one account, both holding the same synced state */
async function pair(fill: (a: Awaited<ReturnType<typeof phone>>) => Promise<void> = async () => undefined) {
    const server = new FakeServer()
    const a = await phone(server, { imported: true })
    await fill(a)
    await a.engine.sync("start")
    const b = await phone(server, { imported: false })
    await b.engine.importFromAccount()
    return { server, a, b }
}
type Phone = Awaited<ReturnType<typeof phone>>
const names = async (one: Phone) => (await (await one.db()).select().from(playlists)).map(row => row.name).sort()
const section = async (one: Phone, name: string) => (await (await one.db()).select().from(settingsSections).where(eq(settingsSections.section, name)))[0]?.content
const setSection = async (one: Phone, name: string, content: Record<string, unknown>) => {
    await (await one.db()).insert(settingsSections).values({ section: name, content, changedAt: clock })
        .onConflictDoUpdate({ target: settingsSections.section, set: { content, changedAt: clock } })
}

describe("two devices that changed different things between two syncs", () => {
    it("a setting, a preference and a key changed on one device survive the other device's merge", async () => {
        const { a, b } = await pair(async one => {
            await setSection(one, "library", { autoUpdate: false })
            one.preferences.set("sea-theme", "\"dark\"")
            one.secrets.set(DEBRID_KEY_SECRET, "old-key")
        })
        clock += 60_000
        await setSection(a, "library", { autoUpdate: true })
        a.preferences.set("sea-theme", "\"light\"")
        a.secrets.set(DEBRID_KEY_SECRET, "new-key")
        expect(await a.engine.sync("manual")).toMatchObject({ state: "uploaded" })

        clock += 60_000
        await (await b.db()).insert(playlists).values(playlist("From B"))
        expect(await b.engine.sync("manual")).toMatchObject({ state: "merged" })
        expect(await a.engine.sync("manual")).toMatchObject({ state: "updated" })
        for (const one of [a, b]) {
            expect(await section(one, "library")).toEqual({ autoUpdate: true })
            expect(one.preferences.get("sea-theme")).toBe("\"light\"")
            expect(one.secrets.get(DEBRID_KEY_SECRET)).toBe("new-key")
            expect(await names(one)).toEqual(["From B"])
        }
        // both hold the same now: nothing more to send
        expect(await b.engine.sync("manual")).toMatchObject({ state: "up-to-date" })
        expect(await a.engine.sync("manual")).toMatchObject({ state: "up-to-date" })
    })

    it("a deleted playlist, an uninstalled extension and a removed preference do not come back", async () => {
        const { a, b } = await pair(async one => {
            await (await one.db()).insert(playlists).values([playlist("Keep"), playlist("Drop"), playlist("Drop on B")])
            one.files.set("ext-a.json", "{\"id\":\"ext-a\"}")
            one.files.set("ext-b.json", "{\"id\":\"ext-b\"}")
            one.preferences.set("sea-old", "\"x\"")
        })
        clock += 60_000
        await (await a.db()).delete(playlists).where(eq(playlists.name, "Drop"))
        a.files.delete("ext-b.json")
        a.preferences.delete("sea-old")
        expect(await a.engine.sync("manual")).toMatchObject({ state: "uploaded" })

        clock += 60_000
        // B removed something too: the device that merges keeps its own removal against the account's older copy
        await (await b.db()).delete(playlists).where(eq(playlists.name, "Drop on B"))
        await (await b.db()).insert(playlists).values(playlist("From B"))
        expect(await b.engine.sync("manual")).toMatchObject({ state: "merged" })
        expect(await a.engine.sync("manual")).toMatchObject({ state: "updated" })
        for (const one of [a, b]) {
            expect(await names(one)).toEqual(["From B", "Keep"])
            expect([...one.files.keys()]).toEqual(["ext-a.json"])
            expect(one.preferences.has("sea-old")).toBe(false)
        }
    })

    it("the same setting changed on both: the later change wins, whichever device merges", async () => {
        const { a, b } = await pair(one => setSection(one, "library", { autoUpdate: false }))
        clock += 60_000
        await setSection(b, "library", { autoUpdate: false, onB: true })
        b.preferences.set("sea-volume", "\"1\"")
        clock += 60_000
        await setSection(a, "library", { autoUpdate: true, onA: true })
        expect(await a.engine.sync("manual")).toMatchObject({ state: "uploaded" })
        // B merges and holds the older change: A's later one wins on B too, B's own preference stays
        expect(await b.engine.sync("manual")).toMatchObject({ state: "merged" })
        expect(await a.engine.sync("manual")).toMatchObject({ state: "updated" })
        for (const one of [a, b]) {
            expect(await section(one, "library")).toEqual({ autoUpdate: true, onA: true })
            expect(one.preferences.get("sea-volume")).toBe("\"1\"")
        }
    })

    it("a playlist made again after it was deleted elsewhere is kept", async () => {
        const { a, b } = await pair(async one => void await (await one.db()).insert(playlists).values(playlist("Evening")))
        clock += 60_000
        await (await a.db()).delete(playlists)
        await a.engine.sync("manual")
        clock += 60_000
        await (await b.db()).delete(playlists)
        await (await b.db()).insert(playlists).values({ ...playlist("Evening"), episodes: [{ n: 1 }] })
        expect(await b.engine.sync("manual")).toMatchObject({ state: "merged" })
        await a.engine.sync("manual")
        for (const one of [a, b]) expect((await (await one.db()).select().from(playlists)).map(row => [row.name, row.episodes])).toEqual([["Evening", [{ n: 1 }]]])
    })
})
