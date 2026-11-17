// geschrieben nach: Plan „Account + Sync“ (Abschnitt 3), core/backup/backup.test.ts (Aufbau eines gefüllten Geräts) und lib/app-backup-keys.ts; Werte erfunden

import { eq } from "drizzle-orm"
import { createRequire } from "node:module"
import { gunzipSync, gzipSync } from "fflate"
import { sqlDriverFor } from "@/api/client/core-database"
import { isDeviceKey } from "@/lib/app-backup-keys"
import { openDatabaseSync } from "../../../test/expo-sqlite"
import { beforeAll, describe, expect, it } from "vitest"
import { makeBackup } from "../backup/backup"
import { extensionUserConfigs, settingsSections, watchPositions } from "../database/schema"
import { DEBRID_KEY_SECRET } from "../debrid/debrid"
import { ACCOUNT_TOKEN_SECRET } from "../move/move"
import { NAKAMA_PASSWORD_SECRET } from "../nakama/guest"
import { AccountCryptoError } from "./crypto"
import { applyPackage, makePackage, openPackage, packageHash, sealPackage } from "./package"
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
