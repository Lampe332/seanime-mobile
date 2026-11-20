// geschrieben nach: Plan „Seanime Website: App-Einstellungen im Browser ändern“ (Abschnitte 2.3 und 2.4 Punkt 2, Paket A2), package.ts (mergePackages, applyPackage) und web-vectors.json (von web-vectors.test.ts); Werte erfunden

/*
 * The other direction: a package changed the way the website does it (plan 2.3: change the parsed package directly, write
 * V + 1, stamp like a device) must be taken over by the app's own merge. `webEdit` below is the website's rule set written
 * once more as a reference (pure JSON, no crypto); the sealing and opening use the app's real functions.
 * It reads web-vectors.json (made by web-vectors.test.ts); the cases there hold what a DEVICE makes for the same change.
 * Checked per case: (1) the website's rules give the device's package and stamps, (2) the app merges the sealed V + 1 into
 * a device that holds V: the change arrives, nothing else changes, the device is not ahead, (3) the device ends with the
 * same stamps as the package.
 * Besides: a device one version behind (removals stay removed), a device with its own newer change elsewhere (both stay,
 * it is ahead), and the same field changed on a device earlier or later than the website (the newer stamp wins).
 */

import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { gunzipSync, gzipSync } from "fflate"
import { eq } from "drizzle-orm"
import { beforeAll, describe, expect, it } from "vitest"
import { sqlDriverFor } from "@/api/client/core-database"
import { isSyncDeviceKey } from "@/lib/app-backup-keys"
import { openDatabaseSync } from "../../../test/expo-sqlite"
import { settingsSections } from "../database/schema"
import { AccountCryptoError } from "./crypto"
import { openPackage, packageItems, sealPackage, type SyncPackage } from "./package"
import type { Sodium } from "./sodium"
import { coreLocalData } from "./sync"
import { device as makeDevice, fixedRandom, ready, unhex } from "./__fixtures__/harness"

const sodiumLibrary = createRequire(import.meta.url)("libsodium-wrappers-sumo")
const gzip = { gzip: (data: Uint8Array) => gzipSync(data, { mtime: 0 }), gunzip: gunzipSync }
const driver = (name: string) => sqlDriverFor(openDatabaseSync(name) as never)

let sodium: Sodium
beforeAll(async () => {
    sodium = await ready(sodiumLibrary)
})

type Change = { op: "set", key: string, value: unknown } | { op: "delete", key: string }
type Json = Record<string, unknown>
type Vectors = {
    input: { userId: string, dekId: string, dek: string, version: number, editedNonce: string, times: { previous: number, base: number, web: number } }
    package: { object: SyncPackage }
    previous: { object: SyncPackage }
    cases: { name: string, now: number, changes: Change[], expected: { package: SyncPackage, changedStamps: Record<string, number> } }[]
}
const vectors = JSON.parse(readFileSync(path.join(__dirname, "web-vectors.json"), "utf8")) as Vectors
const { input } = vectors
const BASE = vectors.package.object
const SEP = "\u001f"
const ACCOUNT = input.userId
const DEK = unhex(input.dek)

/* ---- The website's rules (plan 2.3), as a reference ---- */

/** Which column holds a row's key, for the tables the website edits */
const KEY_COLUMN: Record<string, string> = { settings: "section", appearance: "id", torrentKept: "key", offlineSettings: "id" }

function webEdit(base: SyncPackage, changes: Change[], now: number): SyncPackage {
    const pkg = JSON.parse(JSON.stringify(base)) as SyncPackage
    const stamps = pkg.stamps!
    /** rule 2: t = max(now, changed + 1, deleted + 1) */
    const time = (key: string) => Math.max(now, (stamps.changed[key] ?? -1) + 1, (stamps.deleted[key] ?? -1) + 1)
    /** rule 5: a part set again leaves the tombstones */
    const changed = (key: string, at: number) => {
        stamps.changed[key] = at
        delete stamps.deleted[key]
    }
    const removed = (key: string, at: number) => {
        delete stamps.changed[key]
        stamps.deleted[key] = at
    }
    const rowOf = (container: string) => {
        const [, table, rowKey] = container.split("/") as [string, string, string]
        const row = (pkg.tables[table as "settings"] as Json[] | undefined)?.find(row => String(row[KEY_COLUMN[table]!]) === rowKey)
        if (!row) throw new Error(`no row ${container}`)
        return row
    }
    /** rule 3: a row is never older than its fields; the editor sets changedAt with them */
    const rowTimes = new Map<string, number>()
    for (const change of changes) {
        if (change.key.startsWith("f/t/")) {
            const [container, field] = change.key.slice(2).split(SEP) as [string, string]
            const content = rowOf(container).content as Json
            const at = time(change.key)
            if (change.op === "set") {
                content[field] = change.value
                changed(change.key, at)
            }
            else {
                delete content[field]
                removed(change.key, at)
            }
            rowTimes.set(container, Math.max(rowTimes.get(container) ?? 0, at))
        }
        else if (change.key.startsWith("f/p/")) {
            // rule 4: a split preference: only the field part is stamped, the text is the changed JSON
            const [name, field] = change.key.slice(4).split(SEP) as [string, string]
            const object = JSON.parse(pkg.preferences[name]!) as Json
            const at = time(change.key)
            if (change.op === "set") {
                object[field] = change.value
                changed(change.key, at)
            }
            else {
                delete object[field]
                removed(change.key, at)
            }
            pkg.preferences[name] = JSON.stringify(object)
        }
        else if (change.key.startsWith("p/")) {
            const name = change.key.slice(2)
            const at = time(change.key)
            if (change.op === "set") {
                pkg.preferences[name] = change.value as string
                changed(change.key, at)
            }
            else {
                delete pkg.preferences[name]
                removed(change.key, at)
            }
        }
        else if (change.key.startsWith("s/")) {
            const name = change.key.slice(2)
            if (change.op !== "set") throw new Error("the website never removes a secret")
            pkg.secrets[name] = change.value as string
            changed(change.key, time(change.key))
        }
        else if (change.key.startsWith("t/")) {
            // rule 8: a whole row: columns replaced, changedAt and stamp the new time
            if (change.op !== "set") throw new Error("the website never removes a row")
            const row = rowOf(change.key)
            const at = time(change.key)
            Object.assign(row, change.value, { changedAt: at })
            changed(change.key, at)
        }
        else throw new Error(`unknown part ${change.key}`)
    }
    for (const [container, at] of rowTimes) {
        const row = rowOf(container)
        const rowTime = Math.max(time(container), at)
        row.changedAt = rowTime
        changed(container, rowTime)
    }
    return pkg
}

/* ---- Devices, as in sync.test.ts ---- */

async function testDevice(clock: { now: number }) {
    const one = makeDevice(driver, () => clock.now)
    let ledger: string | null = null
    const local = coreLocalData(one.environment, {
        appVersion: "4.2.0",
        preferences: () => Object.fromEntries(one.preferences),
        isDeviceKey: isSyncDeviceKey,
        writePreferences: (preferences, removed) => {
            for (const [key, value] of Object.entries(preferences)) one.preferences.set(key, value)
            for (const key of removed) one.preferences.delete(key)
        },
        ledger: { read: () => ledger, write: text => void (ledger = text) },
        safetyBackup: async () => undefined,
    })
    return { ...one, local }
}

/** A device that took `pkg` as a new device does (replace) */
async function deviceWith(pkg: SyncPackage, clock: { now: number }) {
    const d = await testDevice(clock)
    await d.local.apply(pkg, "replace", ACCOUNT)
    return d
}

/** What the website sends and the app reads: V + 1, sealed with the account's key under the app's own binding */
function viaTheWire(pkg: SyncPackage, nonce = input.editedNonce): SyncPackage {
    const binding = { userId: ACCOUNT, version: input.version + 1, dekId: input.dekId }
    const sealed = sealPackage(fixedRandom(sodium, unhex(nonce)), gzip, pkg, DEK, binding)
    expect(() => openPackage(sodium, gzip, sealed, DEK, { ...binding, version: input.version })).toThrow(AccountCryptoError)
    return openPackage(sodium, gzip, sealed, DEK, binding)
}

/**
 * The stamps of a device after a merge are the package's, with one difference the website must not be surprised by: a device
 * raises the stamp of a split preference ("p/<key>", its fields are parts of their own) to the newest stamp of its fields
 * (package.ts `lifted`). Everything else, and every tombstone, is equal.
 */
function sameStamps(after: SyncPackage, web: SyncPackage, label: string) {
    expect(after.stamps!.deleted, label).toEqual(web.stamps!.deleted)
    expect(Object.keys(after.stamps!.changed).sort(), label).toEqual(Object.keys(web.stamps!.changed).sort())
    for (const [key, at] of Object.entries(web.stamps!.changed)) {
        const fields = Object.entries(web.stamps!.changed).filter(([other]) => other.startsWith(`f/${key}${SEP}`)).map(([, time]) => time)
        expect(after.stamps!.changed[key], `${label} ${key}`).toBe(key.startsWith("p/") && fields.length > 0 ? Math.max(at, ...fields) : at)
    }
}

const parts = (pkg: SyncPackage) => Object.fromEntries(packageItems(pkg))
/** The parts whose value is not the same in both packages, and those only one holds */
const differing = (a: SyncPackage, b: SyncPackage) => {
    const [x, y] = [parts(a), parts(b)]
    return [...new Set([...Object.keys(x), ...Object.keys(y)])].filter(key => JSON.stringify(x[key]) !== JSON.stringify(y[key])).sort()
}

/** A device's own save of two fields of the library row at `now` (the app writes changedAt = now) */
async function ownEdit(d: Awaited<ReturnType<typeof testDevice>>, now: number) {
    const library = BASE.tables.settings!.find(row => row.section === "library")!.content as Json
    await (await d.db()).update(settingsSections).set({ content: { ...library, torrentProvider: "subsplease", enableManga: false }, changedAt: now }).where(eq(settingsSections.section, "library"))
}

describe("a package changed the way the website does it", () => {
    it("the website's rules give the package and stamps a device makes, for every case", () => {
        expect(vectors.cases.length).toBeGreaterThanOrEqual(8)
        for (const one of vectors.cases) {
            const made = webEdit(BASE, one.changes, one.now)
            expect(made, one.name).toEqual(one.expected.package)
            // the header is untouched (rule 7), and so is every tombstone the case does not clear
            expect({ ...made, tables: null, preferences: null, secrets: null, stamps: null }, one.name).toEqual({ ...BASE, tables: null, preferences: null, secrets: null, stamps: null })
            for (const [key, at] of Object.entries(BASE.stamps!.deleted)) {
                if (!(key in one.expected.package.stamps!.changed)) expect(made.stamps!.deleted[key], `${one.name} ${key}`).toBe(at)
            }
        }
    })

    it("the app takes each web package over: the change arrives, nothing else changes, the device is not ahead, stamps end equal", async () => {
        for (const one of vectors.cases) {
            const web = viaTheWire(webEdit(BASE, one.changes, one.now))
            const clock = { now: input.times.web + 3_600_000 }
            const d = await deviceWith(BASE, clock)
            const before = await d.local.make(ACCOUNT)
            expect(before.stamps, one.name).toEqual(BASE.stamps)
            const { ahead } = await d.local.apply(web, "merge", ACCOUNT)
            expect(ahead, one.name).toBe(false)
            const after = await d.local.make(ACCOUNT)
            // arrived: the device's package is the web package, part for part, with the web's stamps
            expect(parts(after), one.name).toEqual(parts(web))
            sameStamps(after, web, one.name)
            // nothing else: the parts that differ from V are exactly the ones the case's stamps name (and the removed ones)
            const touched = new Set([...Object.keys(one.expected.changedStamps), ...Object.keys(one.expected.package.stamps!.deleted).filter(key => !(key in BASE.stamps!.deleted))])
            expect(differing(BASE, after).every(key => touched.has(key)), one.name).toBe(true)
            expect(differing(BASE, after).length, one.name).toBeGreaterThan(0)
            // the preferences the device holds are the package's (a removed one is gone), its own language key untouched
            expect(Object.fromEntries(d.preferences), one.name).toEqual(web.preferences)
        }
    }, 60_000)

    it("a device one version behind takes the change; what was removed stays removed, with its tombstone", async () => {
        const previous = vectors.previous.object
        expect(previous.tables.playlists?.some(row => row.name === "Morning")).toBe(true)
        expect(previous.preferences["sea-search-recent"]).toBeDefined()
        const web = viaTheWire(webEdit(BASE, vectors.cases[0]!.changes, vectors.cases[0]!.now))
        const d = await deviceWith(previous, { now: input.times.web + 3_600_000 })
        const { ahead } = await d.local.apply(web, "merge", ACCOUNT)
        expect(ahead).toBe(false)
        const after = await d.local.make(ACCOUNT)
        expect(after.tables.playlists?.map(row => row.name)).toEqual(["Evening", "Evening"])
        expect(after.preferences["sea-search-recent"]).toBeUndefined()
        expect(d.preferences.has("sea-search-recent")).toBe(false)
        expect(after.stamps!.deleted).toEqual(web.stamps!.deleted)
        expect(Object.keys(after.stamps!.deleted).sort()).toEqual(["p/sea-search-recent", "t/playlists/Morning"])
        expect(parts(after)).toEqual(parts(web))
        sameStamps(after, web, "one version behind")
    })

    it("a removal made by the website reaches a device that still holds the part", async () => {
        const one = vectors.cases.find(item => item.name === "preference-and-field-removed")!
        const web = viaTheWire(webEdit(BASE, one.changes, one.now))
        const d = await deviceWith(BASE, { now: input.times.web + 3_600_000 })
        expect(d.preferences.has("seanime-mobile-chapter-notifications")).toBe(true)
        await d.local.apply(web, "merge", ACCOUNT)
        expect(d.preferences.has("seanime-mobile-chapter-notifications")).toBe(false)
        expect(JSON.parse(d.preferences.get("sea-video-core-settings")!)).toEqual({ preferredSubtitleLanguage: "eng" })
        const after = await d.local.make(ACCOUNT)
        expect(after.stamps!.deleted["p/seanime-mobile-chapter-notifications"]).toBe(one.now)
        expect(after.stamps!.changed["p/seanime-mobile-chapter-notifications"]).toBeUndefined()
    })

    it("a device with its own newer change elsewhere keeps it next to the web change and is ahead", async () => {
        const one = vectors.cases[0]!
        const web = viaTheWire(webEdit(BASE, one.changes, one.now))
        const clock = { now: input.times.base + 1000 }
        const d = await deviceWith(BASE, clock)
        // the device's user switched another preference before the web saved, and has not synced yet
        clock.now = input.times.web - 60_000
        d.preferences.set("seanime-mobile-airing-notifications", "\"false\"")
        const { ahead } = await d.local.apply(web, "merge", ACCOUNT)
        expect(ahead).toBe(true)
        const after = await d.local.make(ACCOUNT)
        expect(after.preferences["seanime-mobile-airing-notifications"]).toBe("\"false\"")
        expect(after.stamps!.changed["f/t/settings/library\u001fautoScan"]).toBe(one.now)
        expect(JSON.stringify(after.tables.settings)).toContain("\"autoScan\":false")
    })

    it("the same field changed on a device later than the website: the device's value stays; earlier: the website's value arrives", async () => {
        const one = vectors.cases.find(item => item.name === "several-categories-one-save")!
        const web = viaTheWire(webEdit(BASE, one.changes, one.now))
        const library = (pkg: SyncPackage) => pkg.tables.settings!.find(row => row.section === "library")!.content as Json
        expect(library(web).torrentProvider).toBe("nyaa")

        const clockLater = { now: input.times.base + 1000 }
        const later = await deviceWith(BASE, clockLater)
        clockLater.now = one.now + 60_000
        await ownEdit(later, clockLater.now)
        expect((await later.local.apply(web, "merge", ACCOUNT)).ahead).toBe(true)
        const kept = library(await later.local.make(ACCOUNT))
        // the device's newer field stays, the website's other fields of the same row still arrive
        expect(kept.torrentProvider).toBe("subsplease")
        expect(kept.enableManga).toBe(false)
        expect(kept.libraryPaths).toEqual(["/storage/emulated/0/Anime"])

        const clockEarlier = { now: input.times.base + 1000 }
        const earlier = await deviceWith(BASE, clockEarlier)
        clockEarlier.now = input.times.base + 60_000
        await ownEdit(earlier, clockEarlier.now)
        await earlier.local.apply(web, "merge", ACCOUNT)
        const taken = library(await earlier.local.make(ACCOUNT))
        // the website's field wins by its newer stamp; the device's other field, changed in the same row, stays
        expect(taken.torrentProvider).toBe("nyaa")
        expect(taken.enableManga).toBe(false)
        expect(taken.libraryPaths).toEqual(["/storage/emulated/0/Anime"])
    })
})
