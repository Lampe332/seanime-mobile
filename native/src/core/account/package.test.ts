// geschrieben nach: Plan „Account + Sync“ (Abschnitt 3), core/backup/backup.test.ts (Aufbau eines gefüllten Geräts) und lib/app-backup-keys.ts; Werte erfunden

import { eq } from "drizzle-orm"
import { createRequire } from "node:module"
import { gunzipSync, gzipSync } from "fflate"
import { sqlDriverFor } from "@/api/client/core-database"
import { isDeviceKey } from "@/lib/app-backup-keys"
import { openDatabaseSync } from "../../../test/expo-sqlite"
import { beforeAll, describe, expect, it } from "vitest"
import { makeBackup } from "../backup/backup"
import { appearance, extensionUserConfigs, settingsSections, watchPositions } from "../database/schema"
import { DEBRID_KEY_SECRET } from "../debrid/debrid"
import { ACCOUNT_TOKEN_SECRET } from "../move/move"
import { NAKAMA_PASSWORD_SECRET } from "../nakama/guest"
import { AccountCryptoError } from "./crypto"
import { applyPackage, ledgerStamps, makePackage, mergePackages, openPackage, packageHash, packageItems, readPackage, sealPackage, stampChanges } from "./package"
import type { Sodium } from "./sodium"
import { bytes, device as makeDevice, ready } from "./__fixtures__/harness"

const sodiumLibrary = createRequire(import.meta.url)("libsodium-wrappers-sumo")
const gzip = { gzip: (data: Uint8Array) => gzipSync(data, { mtime: 0 }), gunzip: gunzipSync }
const driver = (name: string) => sqlDriverFor(openDatabaseSync(name) as never)
const device = (clock: () => number) => makeDevice(driver, clock)
const app = (preferences: Record<string, string>) => ({ appVersion: "4.2.0", preferences, isDeviceKey })

let sodium: Sodium
beforeAll(async () => {
    sodium = await ready(sodiumLibrary)
})

const CLOCK = Date.parse("2026-11-17T10:00:00.000Z")
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl"
const PREFERENCES = {
    "seanime-mobile-language": "\"de\"",
    "sea-server-auth-token": `"${JWT}"`,
    "debrid-settings": JSON.stringify({ provider: "realdebrid", apiKey: "debrid-pref-key" }),
    "seanime-core-start-mode": "\"own\"",
    "seanime-mobile-anilist-user": "{\"id\":5}",
    "seanime-account.session": "{\"sessionToken\":\"must-not-travel\"}",
}
const SECRETS = ["hunter2", "nakama-pass", "abc123", "anilist-token-x", "torbox-key-y", "nakama-host-z", JWT, "debrid-pref-key"]

async function filled() {
    const one = device(() => CLOCK)
    const db = await one.db()
    await db.insert(settingsSections).values([
        { section: "torrent", content: { defaultTorrentClient: "qbittorrent", qbittorrentPassword: "hunter2" }, changedAt: CLOCK },
        { section: "nakama", content: { enabled: true, remoteServerPassword: "nakama-pass" }, changedAt: CLOCK },
    ])
    await db.insert(extensionUserConfigs).values({ id: "ext-a", version: 1, values: { language: "de", apiKey: "abc123" }, origin: "core", changedAt: CLOCK })
    await db.insert(watchPositions).values({ mediaId: 21, kind: "onlinestream", episodeNumber: 3, positionSeconds: 600, durationSeconds: 1400, filepath: "", addedAt: CLOCK, changedAt: CLOCK, expiresAt: null })
    one.files.set("ext-a.json", JSON.stringify({ id: "ext-a", name: "A", version: "1.0.0", type: "onlinestream-provider", language: "typescript", payload: "class Provider {}" }))
    one.secrets.set(ACCOUNT_TOKEN_SECRET, "anilist-token-x")
    one.secrets.set(DEBRID_KEY_SECRET, "torbox-key-y")
    one.secrets.set(NAKAMA_PASSWORD_SECRET, "nakama-host-z")
    return one
}

describe("the sync package", () => {
    it("carries the secrets the file backup leaves out, never the device's or the account's keys", async () => {
        const one = await filled()
        const pkg = await makePackage(one.environment, app(PREFERENCES))
        const text = JSON.stringify(pkg)
        for (const secret of SECRETS) expect(text).toContain(secret)
        expect(pkg.secrets).toEqual({ [ACCOUNT_TOKEN_SECRET]: "anilist-token-x", [DEBRID_KEY_SECRET]: "torbox-key-y", [NAKAMA_PASSWORD_SECRET]: "nakama-host-z" })
        expect(pkg.tables.extensionConfigs?.[0]?.values).toEqual({ language: "de", apiKey: "abc123" })
        expect(Object.keys(pkg.preferences).sort()).toEqual(["debrid-settings", "sea-server-auth-token", "seanime-mobile-language"])
        expect(text).not.toContain("must-not-travel")
        expect(text).not.toContain("seanime-core-start-mode")
        expect(text).not.toContain("seanime-mobile-anilist-user")
    })

    it("leaves the file backup as it was: no secret in it", async () => {
        const one = await filled()
        const file = JSON.stringify(await makeBackup(one.environment, { appVersion: "4.2.0", preferences: PREFERENCES }))
        for (const secret of SECRETS) expect(file).not.toContain(secret)
        expect(file).not.toContain("\"secrets\"")
    })

    it("goes through gzip and encryption and back, and its hash ignores only the time it was made", async () => {
        const one = await filled()
        const pkg = await makePackage(one.environment, app(PREFERENCES))
        const binding = { userId: "6f1c2c1e-0d7b-4c3a-9a51-2f0e7d4b8a10", version: 2, dekId: "dek-1" }
        const blob = sealPackage(sodium, gzip, pkg, bytes(32, 3), binding)
        expect(new TextDecoder().decode(blob)).not.toContain("hunter2")
        expect(openPackage(sodium, gzip, blob, bytes(32, 3), binding)).toEqual(pkg)
        expect(() => openPackage(sodium, gzip, blob, bytes(32, 3), { ...binding, version: 1 })).toThrow(AccountCryptoError)
        expect(packageHash(sodium, { ...pkg, createdAt: "1999-01-01T00:00:00.000Z" })).toBe(packageHash(sodium, pkg))
        expect(packageHash(sodium, { ...pkg, preferences: { ...pkg.preferences, x: "1" } })).not.toBe(packageHash(sodium, pkg))
    })
})

describe("applying a package", () => {
    it("replace: a new device gets the data with its secrets", async () => {
        const pkg = await makePackage((await filled()).environment, app(PREFERENCES))
        const two = device(() => CLOCK)
        const { preferences } = await applyPackage(two.environment, pkg, "replace", { preferences: {}, isDeviceKey })
        const db = await two.db()
        expect((await db.select().from(settingsSections).where(eq(settingsSections.section, "torrent")))[0]?.content).toEqual({ defaultTorrentClient: "qbittorrent", qbittorrentPassword: "hunter2" })
        expect((await db.select().from(extensionUserConfigs))[0]?.values).toEqual({ language: "de", apiKey: "abc123" })
        expect(two.secrets.get(ACCOUNT_TOKEN_SECRET)).toBe("anilist-token-x")
        expect(two.secrets.get(DEBRID_KEY_SECRET)).toBe("torbox-key-y")
        expect(preferences["sea-server-auth-token"]).toBe(`"${JWT}"`)
        expect(preferences["seanime-core-start-mode"]).toBeUndefined()
        expect(two.files.has("ext-a.json")).toBe(true)
    })

    it("merge: the device's values and secrets stay, missing secrets are filled in, the newer watch position wins", async () => {
        const one = await filled()
        const later = CLOCK + 60_000
        await (await one.db()).update(watchPositions).set({ positionSeconds: 900, changedAt: later }).where(eq(watchPositions.mediaId, 21))
        const pkg = await makePackage(one.environment, app(PREFERENCES))

        const two = device(() => CLOCK)
        const db = await two.db()
        await db.insert(settingsSections).values({ section: "torrent", content: { defaultTorrentClient: "transmission" }, changedAt: CLOCK })
        await db.insert(watchPositions).values({ mediaId: 21, kind: "onlinestream", episodeNumber: 3, positionSeconds: 100, durationSeconds: 1400, filepath: "", addedAt: CLOCK, changedAt: CLOCK, expiresAt: null })
        two.secrets.set(ACCOUNT_TOKEN_SECRET, "own-token")
        const { preferences } = await applyPackage(two.environment, pkg, "merge", { preferences: { "seanime-mobile-language": "\"en\"" }, isDeviceKey })

        expect((await db.select().from(settingsSections).where(eq(settingsSections.section, "torrent")))[0]?.content).toEqual({ defaultTorrentClient: "transmission", qbittorrentPassword: "hunter2" })
        expect((await db.select().from(watchPositions))[0]?.positionSeconds).toBe(900)
        expect(two.secrets.get(ACCOUNT_TOKEN_SECRET)).toBe("own-token")
        expect(two.secrets.get(DEBRID_KEY_SECRET)).toBe("torbox-key-y")
        expect(preferences["seanime-mobile-language"]).toBeUndefined()
        expect(preferences["debrid-settings"]).toBeDefined()
    })

    it("merge: an older watch position of the package does not overwrite the device's", async () => {
        const pkg = await makePackage((await filled()).environment, app({}))
        const two = device(() => CLOCK)
        const db = await two.db()
        await db.insert(watchPositions).values({ mediaId: 21, kind: "onlinestream", episodeNumber: 4, positionSeconds: 50, durationSeconds: 1400, filepath: "", addedAt: CLOCK, changedAt: CLOCK + 1, expiresAt: null })
        await applyPackage(two.environment, pkg, "merge", { preferences: {}, isDeviceKey })
        expect((await db.select().from(watchPositions))[0]).toMatchObject({ episodeNumber: 4, positionSeconds: 50 })
    })
})

describe("change times and removals", () => {
    it("a package of a build without change times still merges, and what this device removed does not come back from it", async () => {
        const old = await makePackage((await filled()).environment, app(PREFERENCES))
        expect(old.stamps).toBeUndefined()
        const read = readPackage(JSON.stringify(old))
        expect(read).toEqual(old)

        const two = device(() => CLOCK)
        await (await two.db()).insert(settingsSections).values({ section: "torrent", content: { defaultTorrentClient: "transmission" }, changedAt: CLOCK })
        const removed = { changed: {}, deleted: { "x/ext-a.json": CLOCK, "p/seanime-mobile-language": CLOCK } }
        const applied = await applyPackage(two.environment, read, "merge", { preferences: {}, isDeviceKey, stamps: removed })
        expect(two.files.has("ext-a.json")).toBe(false)
        expect(applied.preferences["seanime-mobile-language"]).toBeUndefined()
        expect(applied.preferences["debrid-settings"]).toBeDefined()
        // on a tie the device's own row stays, as before the times were kept; the rows it lacks arrive
        const sections = Object.fromEntries((await (await two.db()).select().from(settingsSections)).map(row => [row.section, row.content]))
        expect(sections).toEqual({ torrent: { defaultTorrentClient: "transmission", qbittorrentPassword: "hunter2" }, nakama: { enabled: true, remoteServerPassword: "nakama-pass" } })
        expect(applied.stamps.deleted["x/ext-a.json"]).toBe(CLOCK)
    })

    it("the times travel in the package; what is no time is dropped when it is read", async () => {
        const pkg = { ...await makePackage((await filled()).environment, app({})), stamps: { changed: { "p/a": 5, "p/b": "soon" }, deleted: { "p/c": 7, "p/d": null } } }
        expect(readPackage(JSON.stringify(pkg)).stamps).toEqual({ changed: { "p/a": 5 }, deleted: { "p/c": 7 } })
    })

    it("the ledger: a changed part gets the time of the change, a missing one a removal, a returned one loses its removal", async () => {
        const items = (preferences: Record<string, string>) => new Map(Object.entries(preferences).map(([key, value]) => [`p/${key}`, value as unknown]))
        const first = stampChanges(null, items({ a: "1", b: "1" }), 100)
        expect(ledgerStamps(first)).toEqual({ changed: { "p/a": 0, "p/b": 0 }, deleted: {} })
        const second = stampChanges(first, items({ a: "2" }), 200)
        expect(ledgerStamps(second)).toEqual({ changed: { "p/a": 200 }, deleted: { "p/b": 200 } })
        expect(ledgerStamps(stampChanges(second, items({ a: "2" }), 300))).toEqual(ledgerStamps(second))
        // a device whose clock went back still orders its own changes
        expect(ledgerStamps(stampChanges(second, items({ a: "3", b: "1" }), 150))).toEqual({ changed: { "p/a": 201, "p/b": 201 }, deleted: {} })
    })

    it("C1: a ledger and a package of the row-wide form still count: an unchanged row keeps its time, the row's time stands for its fields", async () => {
        const looks = async (content: Record<string, unknown>, changedAt: number, preferences: Record<string, string>) => {
            const one = device(() => CLOCK)
            await (await one.db()).insert(appearance).values({ id: 1, content, createdAt: CLOCK, changedAt })
            return makePackage(one.environment, app(preferences))
        }
        const PLAYER = "sea-video-core-settings"
        const pkg = await looks({ x: true, y: true }, 300, { [PLAYER]: "{\"a\":1,\"b\":1}" })
        // the ledger of a build before field parts: one entry per row and per preference, hashed whole, at time 500
        const whole = new Map<string, unknown>([["t/appearance/1", pkg.tables.appearance![0]], [`p/${PLAYER}`, pkg.preferences[PLAYER]]])
        const legacy = { items: Object.fromEntries(Object.entries(stampChanges(null, whole, 0).items).map(([key, [hash]]) => [key, [hash, 500] as [number, number]])), deleted: {} }
        const items = packageItems(pkg)
        expect(items.size).toBeGreaterThan(whole.size)
        // nothing changed: every part keeps the row's or the preference's time, nothing counts as removed
        const settled = ledgerStamps(stampChanges(legacy, items, 9_000))
        expect(new Set(Object.values(settled.changed))).toEqual(new Set([500]))
        expect(settled.deleted).toEqual({})
        // something changed since: the row-wide entry cannot tell which field, so all of that row count as changed, as before
        const changed = await looks({ x: true, y: false }, 9_000, { [PLAYER]: "{\"a\":1,\"b\":1}" })
        const after = ledgerStamps(stampChanges(legacy, packageItems(changed), 9_100)).changed
        const field = (name: string) => Object.keys(after).find(key => key.startsWith("f/") && key.endsWith(name))!
        expect([after[field("x")], after[field("y")], after[field("a")], after[field("b")]]).toEqual([9_000, 9_000, 500, 500])
        // from then on the ledger holds the fields: the next change counts for its own field only
        const next = stampChanges(stampChanges(legacy, packageItems(changed), 9_100), packageItems(await looks({ x: false, y: false }, 9_500, {})), 9_600)
        expect([ledgerStamps(next).changed[field("x")], ledgerStamps(next).changed[field("y")]]).toEqual([9_500, 9_000])

        // a package of the row-wide form: the row's time counts for each of its fields against the device's own field times
        const mine = await looks({ x: false, y: true }, 900, {})
        const mineItems = [...packageItems(mine).keys()]
        const mineStamps = { changed: Object.fromEntries(mineItems.map(key => [key, key.endsWith("x") ? 900 : 100])), deleted: {} }
        const theirs = { ...await looks({ x: true, y: false }, 800, {}), stamps: { changed: { "t/appearance/1": 800 }, deleted: {} } }
        expect(mergePackages({ ...mine, stamps: mineStamps }, theirs).pkg.tables.appearance![0]).toMatchObject({ content: { x: false, y: false } })
    })

    it("a merge keeps two playlists of one name, and takes another device's playlist without its database number", async () => {
        const row = (dbId: number, name: string, updatedAt: number) => ({ dbId, name, episodes: [], createdAt: CLOCK, updatedAt })
        const base = await makePackage(device(() => CLOCK).environment, app({}))
        const mine = { ...base, tables: { ...base.tables, playlists: [row(1, "Same", CLOCK), row(2, "Same", CLOCK), row(3, "Old", CLOCK)] } }
        const theirs = { ...base, tables: { ...base.tables, playlists: [row(1, "Theirs", CLOCK), row(9, "Old", CLOCK + 5)] } }
        expect(mergePackages(mine, theirs).pkg.tables.playlists).toEqual([row(1, "Same", CLOCK), row(2, "Same", CLOCK), row(3, "Old", CLOCK + 5), { name: "Theirs", episodes: [], createdAt: CLOCK, updatedAt: CLOCK }])
    })

    it("a merge says whether the device holds something the account's package does not, and settles a tie for the device", async () => {
        const base = await makePackage(device(() => CLOCK).environment, app({}))
        const pkg = (preferences: Record<string, string>, secrets: Record<string, string>, stamps: { changed: Record<string, number>, deleted: Record<string, number> }) => ({ ...base, preferences, secrets, stamps })
        const none = { changed: {}, deleted: {} }
        // the package of a device that never held the account's data names no removal: nothing goes, and the device is ahead
        const kept = mergePackages(pkg({ a: "1", b: "1" }, { [ACCOUNT_TOKEN_SECRET]: "t" }, { changed: { "p/a": 5, "p/b": 5 }, deleted: {} }), pkg({ c: "1" }, {}, { changed: { "p/c": 9 }, deleted: {} }))
        expect(kept.pkg.preferences).toEqual({ a: "1", b: "1", c: "1" })
        expect(kept.pkg.secrets).toEqual({ [ACCOUNT_TOKEN_SECRET]: "t" })
        expect(kept.ahead).toBe(true)
        // everything the device has is in the package, or older than it: nothing to send
        const behind = mergePackages(pkg({ a: "1", b: "1" }, {}, { changed: { "p/a": 5, "p/b": 5 }, deleted: {} }), pkg({ a: "2" }, {}, { changed: { "p/a": 6 }, deleted: { "p/b": 7 } }))
        expect(behind.pkg.preferences).toEqual({ a: "2" })
        expect(behind).toMatchObject({ ahead: false, pkg: { stamps: { changed: { "p/a": 6 }, deleted: { "p/b": 7 } } } })
        // a tie: the device's part stays and is the newer one from now on, so the other device takes it
        const tie = mergePackages(pkg({ a: "mine" }, {}, { changed: { "p/a": 5 }, deleted: {} }), pkg({ a: "theirs" }, {}, { changed: { "p/a": 5 }, deleted: {} }))
        expect(tie).toMatchObject({ ahead: true, pkg: { preferences: { a: "mine" }, stamps: { changed: { "p/a": 6 } } } })
        expect(mergePackages(pkg({ a: "theirs" }, {}, { changed: { "p/a": 5 }, deleted: {} }), tie.pkg)).toMatchObject({ ahead: false, pkg: { preferences: { a: "mine" } } })
        // a secret: removed elsewhere later, it stays here; removed here, it is not taken back; neither is a reason to send
        const token = { [ACCOUNT_TOKEN_SECRET]: "t" }
        const key = `s/${ACCOUNT_TOKEN_SECRET}`
        expect(mergePackages(pkg({}, token, { changed: { [key]: 5 }, deleted: {} }), pkg({}, {}, { changed: {}, deleted: { [key]: 9 } }))).toMatchObject({ ahead: false, pkg: { secrets: token } })
        expect(mergePackages(pkg({}, {}, { changed: {}, deleted: { [key]: 9 } }), pkg({}, token, { changed: { [key]: 5 }, deleted: {} }))).toMatchObject({ ahead: false, pkg: { secrets: {} } })
        expect(mergePackages(pkg({}, {}, none), pkg({}, {}, none)).ahead).toBe(false)
    })
})
