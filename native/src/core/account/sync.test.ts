// geschrieben nach: Plan „Account + Sync“ (Abschnitte 6.5, 6.6, 8, 13) und dem Verhalten von account-server/src/routes.ts (syncMeta, putSnapshot mit If-Match/409); Werte erfunden

import { eq } from "drizzle-orm"
import { createRequire } from "node:module"
import { gunzipSync, gzipSync } from "fflate"
import { sqlDriverFor } from "@/api/client/core-database"
import { isDeviceKey, isSyncDeviceKey } from "@/lib/app-backup-keys"
import { openDatabaseSync } from "../../../test/expo-sqlite"
import { beforeAll, describe, expect, it } from "vitest"
import { anilistChanges, appearance, extensionUserConfigs, playlists, settingsSections, watchPositions } from "../database/schema"
import { DEBRID_KEY_SECRET } from "../debrid/debrid"
import { ACCOUNT_TOKEN_SECRET } from "../move/move"
import { AccountApiError, ConflictError, type Snapshot, type SyncMeta } from "./client"
import type { AccountDeps } from "./devices"
import { signOut } from "./flows"
import { AccountSession } from "./session"
import type { Sodium } from "./sodium"
import { decryptPackage } from "./crypto"
import { applyPackage, makePackage, readPackage, sealPackage } from "./package"
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
    logout = async () => undefined
    /** Like routes.ts deleteSync: the data goes, the version counts on */
    deleteSync = async () => {
        if (this.version === 0) return
        if (this.blob) this.version++
        this.blob = null
    }
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

async function phone(server: FakeServer, options: { imported: boolean, patienceMs?: number, clockOff?: number }) {
    const now = () => clock + (options.clockOff ?? 0)
    const one = device(driver, now)
    const store = memoryStore()
    const session = new AccountSession(store, sodium)
    await session.saveSession({ userId: USER, sessionToken: "t".repeat(43), kind: "email", email: "a@example.org", deviceId: "d" })
    await session.saveDek(DEK_ID, bytes(32, 40))
    await session.updateSync({ imported: options.imported })
    let safetyBackups = 0
    let ledger: string | null = null
    const ledgerStore = { read: () => ledger, write: (text: string) => void (ledger = text) }
    // the app hands in isSyncDeviceKey (account-app.ts); a build before C3 handed in the file backup's isDeviceKey
    let deviceKeys = isSyncDeviceKey
    const local = coreLocalData(one.environment, {
        appVersion: "4.2.0",
        preferences: () => Object.fromEntries(one.preferences),
        isDeviceKey: key => deviceKeys(key),
        writePreferences: (preferences, removed) => {
            for (const [key, value] of Object.entries(preferences)) one.preferences.set(key, value)
            for (const key of removed) one.preferences.delete(key)
        },
        ledger: ledgerStore,
        safetyBackup: async () => void safetyBackups++,
    })
    const engine = new SyncEngine({ api: server, session, sodium, gzip, local, now, patienceMs: options.patienceMs })
    return { ...one, store, session, engine, safetyBackups: () => safetyBackups, ledger: () => ledger, ledgerStore, useDeviceKeys: (keys: (key: string) => boolean) => void (deviceKeys = keys) }
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
        // B merges and holds the older change of autoUpdate: A's later one wins on B too; each field is its own part,
        // so the field only B set and B's own preference stay
        expect(await b.engine.sync("manual")).toMatchObject({ state: "merged" })
        expect(await a.engine.sync("manual")).toMatchObject({ state: "updated" })
        for (const one of [a, b]) {
            expect(await section(one, "library")).toEqual({ autoUpdate: true, onA: true, onB: true })
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

const looks = async (one: Phone) => (await (await one.db()).select().from(appearance))[0]?.content
const setLooks = async (one: Phone, content: Record<string, unknown>) => {
    await (await one.db()).insert(appearance).values({ id: 1, content, createdAt: clock, changedAt: clock })
        .onConflictDoUpdate({ target: appearance.id, set: { content, changedAt: clock } })
}
const extensionValues = async (one: Phone) => (await (await one.db()).select().from(extensionUserConfigs))[0]?.values
const setExtensionValues = async (one: Phone, values: Record<string, string>) => {
    await (await one.db()).insert(extensionUserConfigs).values({ id: "ext-a", version: 1, values, origin: "core", changedAt: clock })
        .onConflictDoUpdate({ target: extensionUserConfigs.id, set: { values, changedAt: clock } })
}
const PLAYER = "sea-video-core-settings"
const TRACKS = "sea-player-track-memory"

describe("C1: two devices change different fields of one row or one preference", () => {
    it("the device test: the S22 turns one switch off, the tablet another of the same page; after S22, tablet, S22 both are off on both", async () => {
        const { a: s22, b: tablet } = await pair(one => setLooks(one, { unwatchedCount: true, unreadCount: true, accent: "blue" }))
        clock += 60_000
        await setLooks(s22, { unwatchedCount: false, unreadCount: true, accent: "blue" })
        clock += 60_000
        await setLooks(tablet, { unwatchedCount: true, unreadCount: false, accent: "blue" })
        expect(await s22.engine.sync("manual")).toMatchObject({ state: "uploaded" })
        expect(await tablet.engine.sync("manual")).toMatchObject({ state: "merged" })
        expect(await s22.engine.sync("manual")).toMatchObject({ state: "updated" })
        for (const one of [s22, tablet]) expect(await looks(one)).toEqual({ unwatchedCount: false, unreadCount: false, accent: "blue" })
        for (const one of [s22, tablet]) expect(await one.engine.sync("manual")).toMatchObject({ state: "up-to-date" })
    })

    it("the same for a settings section, an extension's config and preferences that hold an object or a map, with a field removed", async () => {
        const { a, b } = await pair(async one => {
            await setSection(one, "library", { autoUpdate: false, scanOnStart: false })
            await setExtensionValues(one, { language: "en", quality: "720" })
            one.preferences.set(PLAYER, JSON.stringify({ autoSkip: false, subtitles: "off" }))
            one.preferences.set(TRACKS, JSON.stringify({ 1: "en", 2: "de" }))
        })
        clock += 60_000
        await setSection(a, "library", { autoUpdate: true, scanOnStart: false })
        await setExtensionValues(a, { language: "de", quality: "720" })
        a.preferences.set(PLAYER, JSON.stringify({ autoSkip: true, subtitles: "off" }))
        a.preferences.set(TRACKS, JSON.stringify({ 1: "en", 2: "de", 3: "ja" }))
        clock += 60_000
        await setSection(b, "library", { autoUpdate: false, scanOnStart: true })
        await setExtensionValues(b, { language: "en", quality: "1080" })
        b.preferences.set(PLAYER, JSON.stringify({ autoSkip: false, subtitles: "on" }))
        b.preferences.set(TRACKS, JSON.stringify({ 1: "en", 4: "fr" }))
        expect(await a.engine.sync("manual")).toMatchObject({ state: "uploaded" })
        expect(await b.engine.sync("manual")).toMatchObject({ state: "merged" })
        expect(await a.engine.sync("manual")).toMatchObject({ state: "updated" })
        for (const one of [a, b]) {
            expect(await section(one, "library")).toEqual({ autoUpdate: true, scanOnStart: true })
            expect(await extensionValues(one)).toEqual({ language: "de", quality: "1080" })
            expect(JSON.parse(one.preferences.get(PLAYER)!)).toEqual({ autoSkip: true, subtitles: "on" })
            // A added 3, B removed 2 and added 4
            expect(JSON.parse(one.preferences.get(TRACKS)!)).toEqual({ 1: "en", 3: "ja", 4: "fr" })
        }
        for (const one of [a, b]) expect(await one.engine.sync("manual")).toMatchObject({ state: "up-to-date" })
        // the device that changed nothing keeps its preference's text as it was written
        expect(a.preferences.get(PLAYER)).toBe(JSON.stringify({ autoSkip: true, subtitles: "on" }))
    })

    it("the same field changed on both: the later change wins; a row changed after another device removed it comes back whole", async () => {
        const { a, b } = await pair(async one => {
            await setLooks(one, { unwatchedCount: true, accent: "blue" })
            await setExtensionValues(one, { language: "en", quality: "720" })
            one.preferences.set(TRACKS, JSON.stringify({ 1: "en", 2: "de" }))
        })
        clock += 60_000
        await setLooks(b, { unwatchedCount: false, accent: "blue" })
        await (await b.db()).delete(extensionUserConfigs)
        b.preferences.delete(TRACKS)
        clock += 60_000
        await setLooks(a, { unwatchedCount: true, accent: "red" })
        await setExtensionValues(a, { language: "en", quality: "1080" })
        a.preferences.set(TRACKS, JSON.stringify({ 1: "en", 2: "de", 3: "ja" }))
        expect(await b.engine.sync("manual")).toMatchObject({ state: "uploaded" })
        expect(await a.engine.sync("manual")).toMatchObject({ state: "merged" })
        expect(await b.engine.sync("manual")).toMatchObject({ state: "updated" })
        for (const one of [a, b]) {
            expect(await looks(one)).toEqual({ unwatchedCount: false, accent: "red" })
            expect(await extensionValues(one)).toEqual({ language: "en", quality: "1080" })
            expect(one.preferences.get(TRACKS)).toBe(JSON.stringify({ 1: "en", 2: "de", 3: "ja" }))
        }
    })
})

describe("C3: the app's language belongs to the device", () => {
    const LANGUAGE = "seanime-mobile-language"

    it("is never sent, never taken by a merge or an import, and a ledger of an older build that knew it names no removal", async () => {
        const { server, a, b } = await pair(async one => {
            one.preferences.set(LANGUAGE, "\"de\"")
            one.preferences.set("sea-theme", "\"dark\"")
        })
        expect(b.preferences.has(LANGUAGE)).toBe(false)
        expect(b.preferences.get("sea-theme")).toBe("\"dark\"")
        b.preferences.set(LANGUAGE, "\"en\"")
        clock += 60_000
        a.preferences.set(LANGUAGE, "\"ru\"")
        a.preferences.set("sea-theme", "\"light\"")
        expect(await a.engine.sync("manual")).toMatchObject({ state: "uploaded" })
        expect(await b.engine.sync("manual")).toMatchObject({ state: "updated" })
        expect([a.preferences.get(LANGUAGE), b.preferences.get(LANGUAGE)]).toEqual(["\"ru\"", "\"en\""])
        expect(b.preferences.get("sea-theme")).toBe("\"light\"")

        // a package of an older build that still carries a language brings none
        const old = await makePackage(a.environment, { appVersion: "4.2.0", preferences: { [LANGUAGE]: "\"ja\"" }, isDeviceKey })
        upload(server, { ...old, stamps: { changed: { [`p/${LANGUAGE}`]: clock + 60_000 }, deleted: {} } })
        await b.engine.sync("manual")
        expect(b.preferences.get(LANGUAGE)).toBe("\"en\"")

        // a device whose older build synced the language: after the update its ledger names no removal of it
        const c = await phone(server, { imported: false })
        c.useDeviceKeys(isDeviceKey)
        c.preferences.set(LANGUAGE, "\"fr\"")
        await c.engine.importFromAccount()
        await c.engine.sync("manual")
        expect(c.ledger()).toContain(`p/${LANGUAGE}`)
        c.useDeviceKeys(isSyncDeviceKey)
        clock += 60_000
        c.preferences.set("sea-theme", "\"sepia\"")
        expect(await c.engine.sync("manual")).toMatchObject({ state: "uploaded" })
        const sent = readPackage(new TextDecoder().decode(gunzipSync(sodiumOpen(server.blob!, server.version))))
        expect(sent.preferences[LANGUAGE]).toBeUndefined()
        expect(sent.stamps?.deleted[`p/${LANGUAGE}`]).toBeUndefined()
    })
})

/** Puts a package on the server as the next version, as another device of the account would */
function upload(server: FakeServer, pkg: Parameters<typeof sealPackage>[2]) {
    server.blob = sealPackage(sodium, gzip, pkg, bytes(32, 40), { userId: USER, version: server.version + 1, dekId: DEK_ID })
    server.version++
}

describe("a package is never taken as it is", () => {
    it("F1: after the synced data was deleted on the website a fresh device syncs first: the other devices keep their data and bring it back", async () => {
        const { server, a, b } = await pair(async one => void await (await one.db()).insert(playlists).values([playlist("Evening"), playlist("Morning")]))
        // deleted on the website: no device of the account knows
        await server.deleteSync()
        const fresh = await phone(server, { imported: false })
        expect(await fresh.engine.sync("start")).toMatchObject({ state: "uploaded", version: 3 })

        expect(await a.engine.sync("manual")).toMatchObject({ state: "merged", version: 4 })
        expect(await names(a)).toEqual(["Evening", "Morning"])
        expect(await b.engine.sync("manual")).toMatchObject({ state: "updated", version: 4 })
        expect(await names(b)).toEqual(["Evening", "Morning"])
        expect(await fresh.engine.sync("manual")).toMatchObject({ state: "updated", version: 4 })
        expect(await names(fresh)).toEqual(["Evening", "Morning"])
        for (const one of [a, b, fresh]) expect(await one.engine.sync("manual")).toMatchObject({ state: "up-to-date", version: 4 })
    })

    it("F1b: a server that tells only a fresh device 'no data' gets its package, and still empties no other device", async () => {
        const { server, a, b } = await pair(async one => {
            await (await one.db()).insert(playlists).values([playlist("Evening"), playlist("Morning")])
            await setSection(one, "library", { autoUpdate: true })
            one.preferences.set("sea-theme", "\"dark\"")
            one.secrets.set(DEBRID_KEY_SECRET, "key")
            one.files.set("ext-a.json", "{\"id\":\"ext-a\"}")
        })
        // the fresh device holds other values for the same parts, changed later than the account's
        clock += 60_000
        const fresh = await phone(server, { imported: false })
        await (await fresh.db()).insert(playlists).values([playlist("Fresh list"), { ...playlist("Evening"), episodes: [{ n: 9 }] }])
        await setSection(fresh, "library", { autoUpdate: false })
        fresh.preferences.set("sea-theme", "\"light\"")
        fresh.secrets.set(DEBRID_KEY_SECRET, "other-key")
        fresh.files.set("ext-a.json", "{\"id\":\"ext-a\",\"v\":2}")
        server.overrideMeta = { size: 0, dekId: null }
        expect(await fresh.engine.sync("start")).toMatchObject({ state: "uploaded", version: 2 })
        server.overrideMeta = {}
        // its state went into a local backup first, as before an import
        expect(fresh.safetyBackups()).toBe(1)

        // the server hands the fresh device's validly sealed package to the devices that changed nothing: it can add a
        // part to them, never replace or remove one of theirs
        const account = async (one: Phone) => {
            expect(await names(one)).toEqual(["Evening", "Fresh list", "Morning"])
            expect((await (await one.db()).select().from(playlists).where(eq(playlists.name, "Evening")))[0]?.episodes).toEqual([])
            expect(await section(one, "library")).toEqual({ autoUpdate: true })
            expect(one.preferences.get("sea-theme")).toBe("\"dark\"")
            expect(one.secrets.get(DEBRID_KEY_SECRET)).toBe("key")
            expect([...one.files]).toEqual([["ext-a.json", "{\"id\":\"ext-a\"}"]])
        }
        for (const one of [a, b]) {
            await one.engine.sync("manual")
            await account(one)
        }
        // the fresh device ends with the account's data, whichever of them the server lets merge first
        expect(await fresh.engine.sync("manual")).toMatchObject({ state: "updated" })
        await account(fresh)
        for (const one of [a, b, fresh]) expect(await one.engine.sync("manual")).toMatchObject({ state: "up-to-date" })
    })

    it("F1b: the fresh device merging first changes nothing: its parts count as older than the account's", async () => {
        const { server, a } = await pair(async one => {
            await (await one.db()).insert(playlists).values(playlist("Evening"))
            one.preferences.set("sea-theme", "\"dark\"")
            one.secrets.set(DEBRID_KEY_SECRET, "key")
        })
        const real = { blob: server.blob!, version: server.version }
        const fresh = await phone(server, { imported: false })
        fresh.preferences.set("sea-theme", "\"light\"")
        fresh.secrets.set(DEBRID_KEY_SECRET, "other-key")
        // the server says "no data, version 0", keeps the fresh device's package to itself and then shows the real one
        server.overrideMeta = { version: 0, size: 0, dekId: null }
        server.version = 0
        expect(await fresh.engine.sync("start")).toMatchObject({ state: "uploaded", version: 1 })
        clock += 60_000
        await (await a.db()).insert(playlists).values(playlist("Morning"))
        server.overrideMeta = {}
        Object.assign(server, real)
        expect(await a.engine.sync("manual")).toMatchObject({ state: "uploaded", version: 2 })
        // the fresh device now merges the account's package, with times of 0 on parts nobody changed since the first sync
        expect(await fresh.engine.sync("manual")).toMatchObject({ state: "updated", version: 2 })
        expect(fresh.preferences.get("sea-theme")).toBe("\"dark\"")
        expect(fresh.secrets.get(DEBRID_KEY_SECRET)).toBe("key")
        expect(await names(fresh)).toEqual(["Evening", "Morning"])
        expect(await a.engine.sync("manual")).toMatchObject({ state: "up-to-date", version: 2 })
        expect(a.preferences.get("sea-theme")).toBe("\"dark\"")
    })

    it("a device that signs in again starts over: what it removed while signed out is no removal for the others", async () => {
        const { server, a, b } = await pair(async one => void await (await one.db()).insert(playlists).values([playlist("Evening"), playlist("Morning")]))
        // B's session ended and the account's key changed meanwhile: B is a new device of the account again (flows.ts startSession)
        clock += 60_000
        await (await b.db()).delete(playlists)
        await b.session.updateSync({ imported: false, highestVersion: 0, lastHash: null, lastSyncAt: null })
        server.overrideMeta = { size: 0, dekId: null }
        expect(await b.engine.sync("start")).toMatchObject({ state: "uploaded", version: 2 })
        server.overrideMeta = {}
        await a.engine.sync("manual")
        expect(await names(a)).toEqual(["Evening", "Morning"])
    })

    it("F2: a secret removed on one device stays removed there and stays on the others, also when that device changed nothing since", async () => {
        const { a, b } = await pair(async one => void one.secrets.set(ACCOUNT_TOKEN_SECRET, "anilist-token"))
        clock += 60_000
        a.secrets.delete(ACCOUNT_TOKEN_SECRET)
        expect(await a.engine.sync("manual")).toMatchObject({ state: "uploaded" })
        clock += 60_000
        await (await b.db()).insert(playlists).values(playlist("From B"))
        expect(await b.engine.sync("manual")).toMatchObject({ state: "merged" })
        expect(b.secrets.get(ACCOUNT_TOKEN_SECRET)).toBe("anilist-token")

        expect(await a.engine.sync("manual")).toMatchObject({ state: "updated" })
        expect(a.secrets.has(ACCOUNT_TOKEN_SECRET)).toBe(false)
        expect(await names(a)).toEqual(["From B"])
        // each keeps its own state of the secret, and neither sends it to the other again
        for (const one of [b, a, b]) expect(await one.engine.sync("manual")).toMatchObject({ state: "up-to-date" })
        expect(b.secrets.get(ACCOUNT_TOKEN_SECRET)).toBe("anilist-token")

        // signing in to AniList again on A is a newer change: it reaches B
        clock += 60_000
        a.secrets.set(ACCOUNT_TOKEN_SECRET, "new-token")
        expect(await a.engine.sync("manual")).toMatchObject({ state: "uploaded" })
        expect(await b.engine.sync("manual")).toMatchObject({ state: "updated" })
        expect(b.secrets.get(ACCOUNT_TOKEN_SECRET)).toBe("new-token")
    })

    it("F3: a package without change times does not overwrite a newer change of a device that changed nothing since its last sync", async () => {
        const { server, a, b } = await pair(one => setSection(one, "library", { v: "old" }))
        clock += 60_000
        await setSection(a, "library", { v: "new" })
        expect(await a.engine.sync("manual")).toMatchObject({ state: "uploaded", version: 2 })
        // an older build uploads its state: the old setting, no times
        const old = await makePackage(b.environment, { appVersion: "4.2.0", preferences: {}, isDeviceKey })
        expect(old.stamps).toBeUndefined()
        upload(server, old)
        expect(await a.engine.sync("manual")).toMatchObject({ state: "merged", version: 4 })
        expect(await section(a, "library")).toEqual({ v: "new" })
    })

    it("the same part changed in the same millisecond on two devices: both settle on one, nobody keeps sending", async () => {
        const { a, b } = await pair(one => setSection(one, "library", { v: 0 }))
        clock += 60_000
        a.preferences.set("sea-theme", "\"light\"")
        b.preferences.set("sea-theme", "\"dark\"")
        expect(await a.engine.sync("manual")).toMatchObject({ state: "uploaded" })
        expect(await b.engine.sync("manual")).toMatchObject({ state: "merged" })
        expect(await a.engine.sync("manual")).toMatchObject({ state: "updated" })
        expect(a.preferences.get("sea-theme")).toBe(b.preferences.get("sea-theme"))
        for (const one of [b, a, b]) expect(await one.engine.sync("manual")).toMatchObject({ state: "up-to-date" })
    })
})

describe("whatever the devices do and in whatever order they sync", () => {
    /** A fixed sequence of "random" numbers below `below` */
    const dice = (seed: number) => (below: number) => {
        seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff
        return seed % below
    }
    const state = async (one: Phone) => ({
        playlists: await names(one),
        library: await section(one, "library"),
        looks: await looks(one),
        preferences: Object.fromEntries([...one.preferences].sort()),
        files: [...one.files.keys()].sort(),
    })

    it("they end with the same data and stop sending: three devices, clocks apart, same-millisecond changes, a late joiner", async () => {
        for (let seed = 1; seed <= 40; seed++) {
            const roll = dice(seed)
            const server = new FakeServer()
            const a = await phone(server, { imported: true })
            await a.engine.sync("start")
            const b = await phone(server, { imported: false, clockOff: 86_400_000 })
            await b.engine.importFromAccount()
            const c = await phone(server, { imported: false, clockOff: -86_400_000 })
            await c.engine.importFromAccount()
            const devices = [a, b, c]
            for (let step = 0; step < 40; step++) {
                const one = devices[roll(devices.length)]!
                // every third step happens in the same millisecond as the one before
                if (roll(3) > 0) clock += 1 + roll(120_000)
                const name = `list-${roll(4)}`
                switch (roll(12)) {
                    case 0: {
                        if (!(await names(one)).includes(name)) await (await one.db()).insert(playlists).values({ ...playlist(name), updatedAt: clock + (one === b ? 86_400_000 : one === c ? -86_400_000 : 0) })
                        break
                    }
                    case 1: await (await one.db()).delete(playlists).where(eq(playlists.name, name)); break
                    case 2: one.preferences.set(`sea-${roll(3)}`, `"${roll(5)}"`); break
                    case 3: one.preferences.delete(`sea-${roll(3)}`); break
                    case 4: await setSection(one, "library", { v: roll(5) }); break
                    case 5: {
                        if (roll(2)) one.files.set(`ext-${roll(2)}.json`, `{"v":${roll(3)}}`)
                        else one.files.delete(`ext-${roll(2)}.json`)
                        break
                    }
                    // a secret may end up different on the devices (a removal stays on its device): it must not keep them sending
                    case 6: {
                        if (roll(2)) one.secrets.set(DEBRID_KEY_SECRET, `key-${roll(3)}`)
                        else one.secrets.delete(DEBRID_KEY_SECRET)
                        break
                    }
                    // C1: a field of one row and an entry of a map, changed or removed on any device
                    case 7: {
                        const content = { ...await looks(one) }
                        if (roll(3) === 0) delete content[`f${roll(3)}`]
                        else content[`f${roll(3)}`] = roll(4)
                        await setLooks(one, content)
                        break
                    }
                    case 8: {
                        const map = JSON.parse(one.preferences.get(TRACKS) ?? "{}") as Record<string, number>
                        if (roll(3) === 0) delete map[roll(4)]
                        else map[roll(4)] = roll(3)
                        one.preferences.set(TRACKS, JSON.stringify(map))
                        break
                    }
                    default: await one.engine.sync("manual")
                }
                // now and then a device that just signed in joins, told by the server that there is nothing to import
                if (step === 20 && seed % 3 === 0) {
                    const late = await phone(server, { imported: false })
                    late.preferences.set("sea-late", "\"1\"")
                    server.overrideMeta = { size: 0, dekId: null }
                    await late.engine.sync("start")
                    server.overrideMeta = {}
                    devices.push(late)
                }
            }
            // a few rounds until every device says it has nothing to do
            let quiet = false
            for (let round = 0; round < 8 && !quiet; round++) {
                quiet = true
                for (const one of devices) if ((await one.engine.sync("manual")).state !== "up-to-date") quiet = false
            }
            expect(quiet, `seed ${seed}: the devices keep sending`).toBe(true)
            const first = await state(devices[0]!)
            for (const one of devices) expect(await state(one), `seed ${seed}`).toEqual(first)
        }
    // 40 seeds take a few seconds alone and more under the whole suite's load
    }, 30_000)
})

describe("the change times a device keeps", () => {
    it("F5: of anything that may hold a password, key or token they lie in the secured storage, never as a hash in the app's store", async () => {
        const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl"
        const { a, b } = await pair(async one => {
            await setSection(one, "torrent", { defaultTorrentClient: "qbittorrent", qbittorrentPassword: "hunter2" })
            await setSection(one, "library", { autoUpdate: true })
            await (await one.db()).insert(extensionUserConfigs).values({ id: "ext-a", version: 1, values: { apiKey: "abc123" }, origin: "core", changedAt: clock })
            await (await one.db()).insert(playlists).values(playlist("Evening"))
            one.preferences.set("sea-theme", "\"dark\"")
            one.preferences.set("debrid-settings", JSON.stringify({ provider: "realdebrid", apiKey: "debrid-pref-key" }))
            one.preferences.set("sea-server-auth-token", `"${jwt}"`)
            one.secrets.set(DEBRID_KEY_SECRET, "key")
        })
        // each field of a settings section and of an extension's config is a part of its own (C1), with its row's place
        const fields = ["t/settings/torrent\u001fdefaultTorrentClient", "t/settings/torrent\u001fqbittorrentPassword", "t/settings/library\u001fautoUpdate", "t/extensionConfigs/ext-a\u001fapiKey"]
        const SECRET = ["t/settings/torrent", "t/settings/library", "t/extensionConfigs/ext-a", "p/debrid-settings", "p/sea-server-auth-token", `s/${DEBRID_KEY_SECRET}`, ...fields.map(key => `f/${key}`)]
        for (const one of [a, b]) {
            const open = Object.keys((JSON.parse(one.ledger()!) as { items: Record<string, unknown> }).items)
            expect(open).toEqual(expect.arrayContaining(["t/playlists/Evening", "p/sea-theme"]))
            expect(open.filter(key => SECRET.includes(key) || /^(f\/)?(s\/|t\/(settings|extensionConfigs|torrentKept)\/)/.test(key))).toEqual([])
            const secured = Object.keys((JSON.parse(one.secrets.get("seanime-core-sync-ledger")!) as { items: Record<string, unknown> }).items)
            expect(secured.sort()).toEqual([...SECRET].sort())
        }
        // their changes still travel
        clock += 60_000
        await setSection(a, "torrent", { defaultTorrentClient: "qbittorrent", qbittorrentPassword: "hunter3" })
        a.preferences.set("debrid-settings", JSON.stringify({ provider: "torbox", apiKey: "other" }))
        expect(await a.engine.sync("manual")).toMatchObject({ state: "uploaded" })
        expect(await b.engine.sync("manual")).toMatchObject({ state: "updated" })
        expect(await section(b, "torrent")).toEqual({ defaultTorrentClient: "qbittorrent", qbittorrentPassword: "hunter3" })
        expect(b.preferences.get("debrid-settings")).toBe(JSON.stringify({ provider: "torbox", apiKey: "other" }))
    })

    it("N2: a merge cut short at any write between the data and its change times is no change of the device: a newer change elsewhere still wins", async () => {
        /** From the `at`-th write of the device on (extension files, secured storage, preferences, ledger) every write fails, as in an app that was killed */
        const killAt = (one: Phone, at: number) => {
            let writes = 0
            const killed = () => {
                if (++writes > at) throw new Error("killed")
            }
            const undo: (() => void)[] = []
            for (const map of [one.files, one.secrets, one.preferences] as Map<string, string>[]) {
                const { set: put, delete: remove } = map
                map.set = (key, value) => (killed(), put.call(map, key, value))
                map.delete = key => (killed(), remove.call(map, key))
                undo.push(() => Object.assign(map, { set: put, delete: remove }))
            }
            const { write } = one.ledgerStore
            one.ledgerStore.write = text => (killed(), write(text))
            undo.push(() => void (one.ledgerStore.write = write))
            return { revive: () => undo.forEach(step => step()) }
        }
        const values = (one: Phone) => [one.files.get("ext-a.json"), one.preferences.get("sea-x"), one.secrets.get(DEBRID_KEY_SECRET)]
        const set = (one: Phone, v: number) => {
            one.files.set("ext-a.json", `{"v":${v}}`)
            one.preferences.set("sea-x", `"${v}"`)
            one.secrets.set(DEBRID_KEY_SECRET, `k${v}`)
        }

        let cuts = 0
        for (let at = 0; ; at++) {
            const { a, b } = await pair(async one => set(one, 0))
            clock += 60_000
            set(a, 1)
            expect(await a.engine.sync("manual")).toMatchObject({ state: "uploaded" })
            clock += 60_000
            const kill = killAt(b, at)
            const cut = await b.engine.sync("manual").then(() => false, error => {
                expect(String(error)).toContain("killed")
                return true
            })
            kill.revive()
            clock += 60_000
            set(a, 2)
            expect(await a.engine.sync("manual")).toMatchObject({ state: "uploaded" })
            clock += 60_000
            await b.engine.sync("manual")
            await a.engine.sync("manual")
            for (const one of [a, b]) expect(values(one), `cut at write ${at}`).toEqual(["{\"v\":2}", "\"2\"", "k2"])
            expect(await b.engine.sync("manual")).toMatchObject({ state: "up-to-date" })
            expect(await a.engine.sync("manual")).toMatchObject({ state: "up-to-date" })
            if (!cut) break
            cuts++
        }
        // cut before and after each write: the note of the times, the file, the key, the preference, both parts of the ledger, the note's removal
        expect(cuts).toBeGreaterThanOrEqual(7)
    })
})

describe("deleting the synced data", () => {
    it("the other devices see no rollback: each uploads its own data again and they sync on", async () => {
        const { server, a, b } = await pair(async one => void await (await one.db()).insert(playlists).values(playlist("Evening")))
        expect(server.version).toBe(1)
        await a.engine.deleteSynced()
        expect(server).toMatchObject({ version: 2, blob: null })

        // B saw version 1 and now meets version 2 without data
        clock += 60_000
        await (await b.db()).insert(playlists).values(playlist("From B"))
        expect(await b.engine.sync("manual")).toMatchObject({ state: "uploaded", version: 3 })
        // A deleted and has not uploaded since: B's package holds all A has, so A takes it and has nothing to send
        expect(await a.engine.sync("manual")).toMatchObject({ state: "updated", version: 3 })
        expect(await names(a)).toEqual(["Evening", "From B"])
        expect(await b.engine.sync("manual")).toMatchObject({ state: "up-to-date", version: 3 })
        expect(await names(b)).toEqual(["Evening", "From B"])
        expect(await a.engine.sync("manual")).toMatchObject({ state: "up-to-date", version: 3 })
    })

    it("the device that deleted uploads again at its next sync, also with nothing changed", async () => {
        const { server, a } = await pair()
        await a.engine.deleteSynced()
        expect(await a.engine.sync("manual")).toMatchObject({ state: "uploaded", version: 3 })
        expect(server.blob).not.toBeNull()
    })

    it("a new device is not asked to import data that is gone", async () => {
        const { server, a } = await pair()
        await a.engine.deleteSynced()
        const c = await phone(server, { imported: false })
        await (await c.db()).insert(playlists).values(playlist("Fresh install"))
        expect(await c.engine.sync("start")).toMatchObject({ state: "uploaded", version: 3 })
        const d = await phone(server, { imported: false })
        await a.engine.deleteSynced()
        expect(await d.engine.importFromAccount()).toMatchObject({ state: "up-to-date" })
        expect(await d.engine.sync("manual")).toMatchObject({ state: "uploaded", version: 5 })
    })

    it("a version below the one this device saw is still refused, with or without data", async () => {
        const { server, a } = await pair()
        await (await a.db()).insert(playlists).values(playlist("Two"))
        await a.engine.sync("manual")
        server.overrideMeta = { version: 1, size: 0, dekId: null }
        expect(await a.engine.sync("manual")).toMatchObject({ state: "rollback-rejected", version: 1, highest: 2 })
        server.overrideMeta = { version: 0, size: 0, dekId: null }
        expect(await a.engine.sync("manual")).toMatchObject({ state: "rollback-rejected", version: 0, highest: 2 })
    })
})

describe("signing out while a sync runs", () => {
    it("waits for the sync and leaves nothing of the account behind: the next sign-in starts clean", async () => {
        const server = new FakeServer()
        const a = await phone(server, { imported: true })
        await (await a.db()).insert(playlists).values(playlist("Evening"))
        // the upload is on its way when the user signs out
        let uploading!: () => void
        let arrive!: () => void
        const started = new Promise<void>(resolve => uploading = resolve)
        const arrived = new Promise<void>(resolve => arrive = resolve)
        const put = server.putSnapshot
        server.putSnapshot = async (...upload) => {
            uploading()
            await arrived
            return put(...upload)
        }
        const syncing = a.engine.sync("manual")
        await started
        const deps = { client: server, session: a.session, sodium } as unknown as AccountDeps
        const out = a.engine.exclusive(() => signOut(deps))
        arrive()
        await Promise.all([syncing, out])
        expect(await a.session.load()).toBeNull()
        // no sync state of the old account (imported, highest version, hash) waits for whoever signs in next
        expect([...a.store.items.keys()].filter(key => key.startsWith("seanime-account."))).toEqual([])
    })

    it("F6: a sync that hangs does not hold up the sign-out: it is given up and writes nothing more", async () => {
        const server = new FakeServer()
        const a = await phone(server, { imported: true, patienceMs: 30 })
        await (await a.db()).insert(playlists).values(playlist("Evening"))
        // the upload gets no answer while the user signs out
        let uploading!: () => void
        let arrive!: () => void
        const started = new Promise<void>(resolve => uploading = resolve)
        const arrived = new Promise<void>(resolve => arrive = resolve)
        const put = server.putSnapshot
        server.putSnapshot = async (...upload) => {
            uploading()
            await arrived
            return put(...upload)
        }
        const syncing = a.engine.sync("manual")
        await started
        const deps = { client: server, session: a.session, sodium } as unknown as AccountDeps
        await a.engine.exclusive(() => signOut(deps))
        expect(await a.session.load()).toBeNull()

        // the answer comes after all: the sync that was given up changes nothing
        arrive()
        expect(await syncing).toMatchObject({ state: "skipped" })
        expect([...a.store.items.keys()].filter(key => key.startsWith("seanime-account."))).toEqual([])
        // and the next sync does not wait behind it
        server.putSnapshot = put
        expect(await a.engine.sync("manual")).toMatchObject({ state: "signed-out" })
    })
})
