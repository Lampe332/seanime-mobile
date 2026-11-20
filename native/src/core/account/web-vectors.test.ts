// geschrieben nach: Plan „Seanime Website: App-Einstellungen im Browser ändern“ (Abschnitte 2.2 bis 2.4, Paket A2), crypto.test.ts (feste Eingaben, fixedRandom) und sync.test.ts (Test-Gerät über coreLocalData); Werte erfunden

/*
 * Test vectors for the website (package W1: assets/account/sync-core.js + crypto.js). Everything in web-vectors.json is
 * computed here from the REAL app functions (crypto.ts, package.ts, sync.ts coreLocalData), nothing is mocked. If the app's
 * format changes, this test fails; then the website's copy has to change too.
 *
 * Regenerate (deterministic, same bytes every time):
 *     WRITE_WEB_VECTORS=1 npx vitest run src/core/account/web-vectors.test.ts
 * The file is never written by a normal run, so a changed format cannot overwrite its own proof.
 *
 * web-vectors.json, top level:
 * - "about"     text, how the values are written (hex = lower case hex; b64 = Base64url without padding, as the app sends it)
 * - "input"     every fixed input: password, salt, kdf, userId, dekId, dek (hex), nonces (hex), devicePub (hex), times (ms)
 * - "keys"      authKey/encKey (Argon2id + crypto_kdf), wrappedDek (password wrap, fixed nonce), dekProof, deviceMac,
 *               recovery code / recoveryKey / recoveryProof / recoveryWrappedDek, and the authKey of a password that NFKC changes
 * - "package"   the account package at version V: `object` (parsed JSON, stamps inside), `parts` (packageItems keys, in order),
 *               `partValues` (value of each part), `gzipHex` (fflate gzip, mtime 0), `sealedHex` ("SMS" 0x01 | nonce | XChaCha20-Poly1305,
 *               AAD "sm-snap-v1" userId version dekId), `binding`, `nonce`
 * - "previous"  the same account one step earlier (version V-1 state): `object` only; has parts a later device removed
 * - "cases"     [{ name, note, now, changes[], expected: { package, changedStamps, deletedStamps, clearedTombstones, sealed? } }]
 *               `changes` is the web's change list on the package at V: { op: "set", key, value } | { op: "delete", key } by part key.
 *               `expected.package` is what a DEVICE makes (coreLocalData look()) after the same change at time `now`, its
 *               createdAt kept as in `package.object` (a web edit never changes createdAt, appVersion, format).
 *               `expected.sealed` (first case only): version V+1, fixed nonce, same gzip as `expected.gzipHex`.
 *               Value of a set: a field part (f/...) the field's value; p/ the preference text; s/ the secret text;
 *               a whole-row part (t/torrentKept/..., t/offlineSettings/1) the columns to overwrite (changedAt is set by the editor).
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { gunzipSync, gzipSync } from "fflate"
import { eq } from "drizzle-orm"
import { beforeAll, describe, expect, it } from "vitest"
import { sqlDriverFor } from "@/api/client/core-database"
import { isSyncDeviceKey } from "@/lib/app-backup-keys"
import { openDatabaseSync } from "../../../test/expo-sqlite"
import { appearance, extensionUserConfigs, homeItems, offlineSettings, playlists, settingsSections, silencedAnime, torrentKept, watchPositions } from "../database/schema"
import { DEBRID_KEY_SECRET } from "../debrid/debrid"
import { ACCOUNT_TOKEN_SECRET } from "../move/move"
import { NAKAMA_PASSWORD_SECRET } from "../nakama/guest"
import { DEFAULT_KDF, decryptPackage, dekProof, deriveKeys, deviceMac, newRecoveryCode, recoveryKeyFrom, recoveryProof, toB64, unwrapKey, wrapKey } from "./crypto"
import { openPackage, packageItems, sealPackage, type SyncPackage } from "./package"
import type { Sodium } from "./sodium"
import { coreLocalData } from "./sync"
import { bytes, device as makeDevice, fixedRandom, hex, ready, unhex } from "./__fixtures__/harness"

const sodiumLibrary = createRequire(import.meta.url)("libsodium-wrappers-sumo")
const gzip = { gzip: (data: Uint8Array) => gzipSync(data, { mtime: 0 }), gunzip: gunzipSync }
const driver = (name: string) => sqlDriverFor(openDatabaseSync(name) as never)
const VECTORS_FILE = path.join(__dirname, "web-vectors.json")

let sodium: Sodium
beforeAll(async () => {
    sodium = await ready(sodiumLibrary)
})

const ACCOUNT = "6f1c2c1e-0d7b-4c3a-9a51-2f0e7d4b8a10"
const T0 = Date.parse("2026-11-18T09:00:00.000Z")
const T1 = Date.parse("2026-11-19T18:30:00.000Z")
const WEB_NOW = Date.parse("2026-11-20T12:00:00.000Z")
const SEP = "\u001f"
/** The package version the base lives at; the web writes V + 1 */
const VERSION = 7

const INPUT = {
    password: "correct horse battery staple",
    /** Full-width letters, a circled digit and an ideographic space: NFKC turns it into "Correct horse 1 staple" */
    passwordUnnormalized: "Ｃorrect　horse ① staple",
    salt: hex(bytes(16)),
    kdf: DEFAULT_KDF,
    userId: ACCOUNT,
    dekId: "dek-web-vector-1",
    dek: hex(bytes(32, 100)),
    wrapNonce: hex(bytes(24, 200)),
    recoveryBytes: hex(bytes(16, 50)),
    recoveryWrapNonce: hex(bytes(24, 220)),
    devicePub: hex(bytes(32, 1)),
    packageNonce: hex(bytes(24, 7)),
    editedNonce: hex(bytes(24, 77)),
    version: VERSION,
    times: { previous: T0, base: T1, web: WEB_NOW },
}

type Change = { op: "set", key: string, value: unknown } | { op: "delete", key: string }
type Json = Record<string, unknown>

/* ---- A test device: the app's own LocalData over a fresh database, with a clock the test moves ---- */

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

/** The account's package at version V and the one before it, made by a device that changed things in two steps */
async function buildBase(): Promise<{ previous: SyncPackage, base: SyncPackage }> {
    const clock = { now: T0 }
    const a = await testDevice(clock)
    const db = await a.db()
    await db.insert(settingsSections).values([
        { section: "library", changedAt: T0, content: { libraryPath: "/storage/emulated/0/Anime", libraryPaths: ["/storage/emulated/0/Anime", "/storage/emulated/0/Movies"], autoUpdateProgress: true, autoScan: false, refreshLibraryOnStart: false, enableOnlinestream: true, torrentProvider: "animetosho", defaultPlaybackSource: "onlinestream", enableManga: true, disableUpdateCheck: false } },
        { section: "torrent", changedAt: T0, content: { defaultTorrentClient: "qbittorrent", qbittorrentPassword: "test-qbit-pass", seanimeDownloadLimit: 0, seanimeUploadLimit: 512, seanimeMaxActiveDownloads: 3 } },
        { section: "anilist", changedAt: T0, content: { hideAudienceScore: false, enableAdultContent: false, blurAdultContent: true, disableCacheLayer: false } },
        { section: "manga", changedAt: T0, content: { defaultMangaProvider: "mangapill", mangaAutoUpdateProgress: true } },
        { section: "nakama", changedAt: T0, content: { enabled: false, username: "test-user", isHost: false, remoteServerURL: "", remoteServerPassword: "test-nakama-pass" } },
    ])
    await db.insert(appearance).values({ id: 1, createdAt: T0, changedAt: T0, content: { showAnimeUnwatchedCount: true, showMangaUnreadCount: false, hideAnimeSpoilers: false, continueWatchingDefaultSorting: "TITLE", libraryScreenCustomBannerPosition: "50% 50%", libraryScreenCustomBannerOpacity: 50 } })
    await db.insert(extensionUserConfigs).values({ id: "ext-a", version: 1, values: { language: "de", apiKey: "test-ext-key" }, origin: "core", changedAt: T0 })
    await db.insert(torrentKept).values([
        { key: "settings", changedAt: T0, content: { enabled: true, autoSelect: true, preferredResolution: "1080", preloadNextStream: false, includeInLibrary: false, stopSeedingWhenFinished: true } },
        { key: "debrid-settings", changedAt: T0, content: { enabled: false, provider: "torbox", streamAutoSelect: true, streamPreferredResolution: "1080", includeDebridStreamInLibrary: false } },
    ])
    await db.insert(watchPositions).values({ mediaId: 21, kind: "onlinestream", episodeNumber: 3, positionSeconds: 600, durationSeconds: 1400, filepath: "", addedAt: T0, changedAt: T0, expiresAt: null })
    // two playlists of one name stay two parts ("t/playlists/Evening" and "t/playlists/Evening#2")
    await db.insert(playlists).values([
        { name: "Evening", episodes: [], createdAt: T0, updatedAt: T0 },
        { name: "Evening", episodes: [{ ep: 1 }], createdAt: T0, updatedAt: T0 },
        { name: "Morning", episodes: [], createdAt: T0, updatedAt: T0 },
    ])
    await db.insert(homeItems).values([{ position: 0, itemId: "continue-watching", kind: "builtin", schemaVersion: 1, options: null }, { position: 1, itemId: "my-lists", kind: "builtin", schemaVersion: 1, options: null }])
    await db.insert(offlineSettings).values({ id: 1, wifiOnly: true, changedAt: T0 })
    await db.insert(silencedAnime).values({ anilistId: 5114, createdAt: T0, updatedAt: T0 })
    a.files.set("ext-a.json", JSON.stringify({ id: "ext-a", name: "A", version: "1.0.0", type: "onlinestream-provider", language: "typescript", payload: "class Provider {}" }))
    a.secrets.set(ACCOUNT_TOKEN_SECRET, "test-anilist-token")
    a.secrets.set(DEBRID_KEY_SECRET, "test-debrid-key")
    a.secrets.set(NAKAMA_PASSWORD_SECRET, "test-nakama-host-pass")
    const prefs: Record<string, string> = {
        "sea-media-core-preferences": JSON.stringify({ autoNext: true, autoPlay: false, skipOpening: false }),
        "sea-video-core-settings": JSON.stringify({ showChapterMarkers: true, preferredSubtitleLanguage: "eng" }),
        "seanime-mobile-airing-notifications": "\"true\"",
        "seanime-mobile-chapter-notifications": "\"true\"",
        "sea-playback-downloaded-media": "\"system\"",
        "sea-ui-settings-navigation-preload-mode": "\"adjacent\"",
        "sea-search-recent": JSON.stringify(["naruto", "bleach"]),
        "seanime-mobile-language": "\"de\"",
    }
    for (const [key, value] of Object.entries(prefs)) a.preferences.set(key, value)
    const previous = await a.local.make(ACCOUNT)

    // a second step at T1: removals, a field of a row and a field of a shared preference change
    clock.now = T1
    await db.delete(playlists).where(eq(playlists.name, "Morning"))
    a.preferences.delete("sea-search-recent")
    const [library] = await db.select().from(settingsSections).where(eq(settingsSections.section, "library"))
    await db.update(settingsSections).set({ content: { ...library!.content, autoScan: true }, changedAt: T1 }).where(eq(settingsSections.section, "library"))
    a.preferences.set("sea-media-core-preferences", JSON.stringify({ autoNext: true, autoPlay: true, skipOpening: false }))
    const base = await a.local.make(ACCOUNT)
    return { previous, base }
}

/** The ways the web changes a package (plan 2.3), as the list the website builds and the device does with its own edit */
const CASES: { name: string, note: string, now: number, changes: Change[] }[] = [
    { name: "switch-in-a-settings-row", note: "one bool field of a section: field stamp and row stamp (plan 2.3 rule 3)", now: WEB_NOW, changes: [{ op: "set", key: `f/t/settings/library${SEP}autoScan`, value: false }] },
    { name: "several-categories-one-save", note: "bool, number, text and list fields in four rows (three sections, one appearance row), one common time", now: WEB_NOW, changes: [
        { op: "set", key: `f/t/settings/anilist${SEP}blurAdultContent`, value: false },
        { op: "set", key: `f/t/settings/torrent${SEP}seanimeUploadLimit`, value: 256 },
        { op: "set", key: `f/t/settings/library${SEP}torrentProvider`, value: "nyaa" },
        { op: "set", key: `f/t/settings/library${SEP}libraryPaths`, value: ["/storage/emulated/0/Anime"] },
        { op: "set", key: `f/t/appearance/1${SEP}showMangaUnreadCount`, value: true },
    ] },
    { name: "shared-preference-field", note: "a field of a split preference (FIELD_PREFERENCES) changes, a new field appears; only the field parts are stamped", now: WEB_NOW, changes: [
        { op: "set", key: `f/p/sea-media-core-preferences${SEP}autoNext`, value: false },
        { op: "set", key: `f/p/sea-video-core-settings${SEP}volume`, value: 80 },
    ] },
    { name: "plain-preference", note: "a preference that is no split one is replaced as a whole text", now: WEB_NOW, changes: [{ op: "set", key: "p/seanime-mobile-airing-notifications", value: "\"false\"" }] },
    { name: "preference-and-field-removed", note: "a whole preference and a field of a split preference are removed: tombstones, no change stamp", now: WEB_NOW, changes: [
        { op: "delete", key: "p/seanime-mobile-chapter-notifications" },
        { op: "delete", key: `f/p/sea-video-core-settings${SEP}showChapterMarkers` },
    ] },
    { name: "recreate-removed-preference", note: "a preference a device removed earlier (tombstone in stamps.deleted) is set again: the tombstone goes, the time is above it", now: WEB_NOW, changes: [{ op: "set", key: "p/sea-search-recent", value: "[\"one piece\"]" }] },
    { name: "replace-a-secret", note: "the debrid key is replaced (the website never shows a secret, it only replaces it)", now: WEB_NOW, changes: [{ op: "set", key: `s/${DEBRID_KEY_SECRET}`, value: "test-new-debrid-key" }] },
    { name: "whole-row-torrent-kept", note: "a whole row (torrentKept): columns replaced, changedAt and stamp set to the new time", now: WEB_NOW, changes: [{ op: "set", key: "t/torrentKept/settings", value: { content: { enabled: false, autoSelect: true, preferredResolution: "720", preloadNextStream: true, includeInLibrary: false, stopSeedingWhenFinished: true } } }] },
    { name: "whole-row-offline-settings", note: "download only on Wi-Fi: a one-column row", now: WEB_NOW, changes: [{ op: "set", key: "t/offlineSettings/1", value: { wifiOnly: false } }] },
    { name: "clock-behind-the-stamps", note: "the browser clock is before the last stamp of the field (T1): the new time is stamp + 1 (plan 2.3 rule 2)", now: T0, changes: [{ op: "set", key: `f/p/sea-media-core-preferences${SEP}autoPlay`, value: false }] },
]

const rows = { settings: settingsSections, appearance, torrentKept, offlineSettings } as const

/** What a device does when its user makes this change (the app writes the row with changedAt = now, a preference's text, a secret) */
async function changeOnDevice(d: Awaited<ReturnType<typeof testDevice>>, clock: { now: number }, now: number, changes: Change[]) {
    clock.now = now
    const db = await d.db()
    for (const change of changes) {
        const [kind, ...rest] = change.key.split("/")
        if (change.key.startsWith("f/t/")) {
            const [container, field] = change.key.slice(2).split(SEP) as [string, string]
            const [, table, rowKey] = container.split("/") as [string, "settings" | "appearance", string]
            const target = rows[table]
            const keyColumn = table === "settings" ? settingsSections.section : appearance.id
            const [row] = await db.select().from(target as never).where(eq(keyColumn as never, (table === "settings" ? rowKey : Number(rowKey)) as never)) as { content: Json }[]
            const content = { ...row!.content }
            if (change.op === "set") content[field] = change.value
            else delete content[field]
            await db.update(target as never).set({ content, changedAt: now } as never).where(eq(keyColumn as never, (table === "settings" ? rowKey : Number(rowKey)) as never))
        }
        else if (change.key.startsWith("f/p/")) {
            const [name, field] = change.key.slice(4).split(SEP) as [string, string]
            const object = JSON.parse(d.preferences.get(name)!) as Json
            if (change.op === "set") object[field] = change.value
            else delete object[field]
            d.preferences.set(name, JSON.stringify(object))
        }
        else if (kind === "p") {
            const name = rest.join("/")
            if (change.op === "set") d.preferences.set(name, change.value as string)
            else d.preferences.delete(name)
        }
        else if (kind === "s") {
            const name = rest.join("/")
            if (change.op === "set") d.secrets.set(name, change.value as string)
            else d.secrets.delete(name)
        }
        else if (change.key.startsWith("t/torrentKept/")) {
            await db.update(torrentKept).set({ ...(change.op === "set" ? change.value as Json : {}), changedAt: now } as never).where(eq(torrentKept.key, rest[1]!))
        }
        else if (change.key === "t/offlineSettings/1") {
            await db.update(offlineSettings).set({ ...(change.op === "set" ? change.value as Json : {}), changedAt: now } as never).where(eq(offlineSettings.id, 1))
        }
        else throw new Error(`no device edit for ${change.key}`)
    }
}

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** A device that holds `pkg` (version V) takes it like a new device does (replace), then does `changes` at `now` */
async function deviceEdit(pkg: SyncPackage, now: number, changes: Change[]): Promise<SyncPackage> {
    const clock = { now: T1 }
    const d = await testDevice(clock)
    await d.local.apply(pkg, "replace", ACCOUNT)
    const unchanged = await d.local.make(ACCOUNT)
    // holding the package and changing nothing keeps every stamp: nothing counts as a change made here
    expect(unchanged.stamps).toEqual(pkg.stamps)
    expect(Object.fromEntries(packageItems(unchanged))).toEqual(Object.fromEntries(packageItems(pkg)))
    await changeOnDevice(d, clock, now, changes)
    return await d.local.make(ACCOUNT)
}

const diff = (before: Record<string, number>, after: Record<string, number>) => Object.fromEntries(Object.entries(after).filter(([key, time]) => before[key] !== time))

async function compute() {
    const dek = unhex(INPUT.dek)
    const binding = { userId: INPUT.userId, version: VERSION, dekId: INPUT.dekId }

    const { authKey, encKey } = await deriveKeys(sodium, INPUT.password, unhex(INPUT.salt), INPUT.kdf)
    const other = await deriveKeys(sodium, INPUT.passwordUnnormalized, unhex(INPUT.salt), INPUT.kdf)
    const { code, key: recoveryKey } = newRecoveryCode(fixedRandom(sodium, unhex(INPUT.recoveryBytes)))
    const keys = {
        authKeyHex: hex(authKey),
        authKey: toB64(sodium, authKey),
        encKeyHex: hex(encKey),
        wrappedDek: wrapKey(fixedRandom(sodium, unhex(INPUT.wrapNonce)), dek, encKey, INPUT.userId, INPUT.dekId, "password"),
        dekProof: dekProof(sodium, dek),
        deviceMac: deviceMac(sodium, dek, { userId: INPUT.userId, dekId: INPUT.dekId, devicePub: unhex(INPUT.devicePub) }),
        recoveryCode: code,
        recoveryCodeAlternateWriting: (code.toLowerCase().match(/.{1,5}/g) ?? []).join("-"),
        recoveryKeyHex: hex(recoveryKey),
        recoveryProof: recoveryProof(sodium, recoveryKey),
        recoveryWrappedDek: wrapKey(fixedRandom(sodium, unhex(INPUT.recoveryWrapNonce)), dek, recoveryKey, INPUT.userId, INPUT.dekId, "recovery"),
        passwordUnnormalizedAuthKey: toB64(sodium, other.authKey),
        passwordUnnormalizedNfkc: INPUT.passwordUnnormalized.normalize("NFKC"),
    }

    const { previous, base } = await buildBase()
    const seal = (pkg: SyncPackage, version: number, nonce: string) => ({
        nonce,
        binding: { ...binding, version },
        gzipHex: hex(gzip.gzip(new TextEncoder().encode(JSON.stringify(pkg)))),
        sealedHex: hex(sealPackage(fixedRandom(sodium, unhex(nonce)), gzip, pkg, dek, { ...binding, version })),
    })
    const items = packageItems(base)
    const cases = []
    for (const [index, one] of CASES.entries()) {
        const made = await deviceEdit(base, one.now, one.changes)
        // the web keeps the package's own header (createdAt, appVersion, format); only the parts and their stamps differ
        const expected: SyncPackage = { ...made, createdAt: base.createdAt }
        const stamps = expected.stamps!
        cases.push({
            ...one,
            expected: {
                package: expected,
                changedStamps: diff(base.stamps!.changed, stamps.changed),
                deletedStamps: diff(base.stamps!.deleted, stamps.deleted),
                clearedTombstones: Object.keys(base.stamps!.deleted).filter(key => !(key in stamps.deleted)),
                ...(index === 0 ? { sealed: seal(expected, VERSION + 1, INPUT.editedNonce) } : {}),
            },
        })
    }
    return {
        about: "Written by web-vectors.test.ts from the app's own functions. hex = lower case hex, b64 = Base64url without padding. See the comment at the top of that file for the layout.",
        input: INPUT,
        keys,
        package: { object: base, parts: [...items.keys()], partValues: Object.fromEntries(items), ...seal(base, VERSION, INPUT.packageNonce) },
        previous: { object: previous },
        cases,
    }
}

const readVectors = () => JSON.parse(readFileSync(VECTORS_FILE, "utf8")) as Awaited<ReturnType<typeof compute>>

describe("web test vectors", () => {
    it("reproduces web-vectors.json from the app's own functions", async () => {
        const vectors = plain(await compute())
        if (process.env.WRITE_WEB_VECTORS === "1") writeFileSync(VECTORS_FILE, JSON.stringify(vectors, null, 2) + "\n")
        if (!existsSync(VECTORS_FILE)) throw new Error("web-vectors.json is missing: run with WRITE_WEB_VECTORS=1 once")
        expect(vectors).toEqual(readVectors())
    }, 120_000)

    it("the stored keys open each other: wraps, recovery code, NFKC password", async () => {
        const stored = readVectors()
        const { keys, input } = stored
        const encKey = unhex(keys.encKeyHex)
        expect(hex(unwrapKey(sodium, keys.wrappedDek, encKey, input.userId, input.dekId, "password"))).toBe(input.dek)
        expect(hex(unwrapKey(sodium, keys.recoveryWrappedDek, unhex(keys.recoveryKeyHex), input.userId, input.dekId, "recovery"))).toBe(input.dek)
        // the code in another writing (lower case, groups, dashes) gives the same key
        expect(hex(recoveryKeyFrom(sodium, keys.recoveryCodeAlternateWriting))).toBe(keys.recoveryKeyHex)
        expect(keys.recoveryCode).toHaveLength(26)
        // a password NFKC changes derives like its normalised text
        expect(keys.passwordUnnormalizedNfkc).toBe("Correct horse 1 staple")
        const normalised = await deriveKeys(sodium, keys.passwordUnnormalizedNfkc, unhex(input.salt), input.kdf)
        expect(toB64(sodium, normalised.authKey)).toBe(keys.passwordUnnormalizedAuthKey)
        expect(keys.passwordUnnormalizedAuthKey).not.toBe(keys.authKey)
    }, 60_000)

    it("the stored package opens with the stored DEK; its parts and gzip are what the file says", () => {
        const stored = readVectors()
        const dek = unhex(stored.input.dek)
        const opened = openPackage(sodium, gzip, unhex(stored.package.sealedHex), dek, stored.package.binding)
        expect(opened).toEqual(stored.package.object)
        // the sealed bytes are the fixed-nonce envelope around exactly this gzip
        const zipped = decryptPackage(sodium, unhex(stored.package.sealedHex), dek, stored.package.binding)
        expect(hex(zipped)).toBe(stored.package.gzipHex)
        expect(new TextDecoder().decode(gunzipSync(zipped))).toBe(JSON.stringify(stored.package.object))
        expect([...packageItems(opened).keys()]).toEqual(stored.package.parts)
        expect(Object.fromEntries(packageItems(opened))).toEqual(stored.package.partValues)
        // every part has a change stamp, the removed ones a tombstone and no change stamp
        const { changed, deleted } = opened.stamps!
        expect(Object.keys(changed).sort()).toEqual([...stored.package.parts].sort())
        expect(Object.keys(deleted).sort()).toEqual(["p/sea-search-recent", "t/playlists/Morning"])
        // all part kinds the website edits or has to carry
        for (const prefix of ["t/settings/", "t/appearance/", "t/extensionConfigs/", "t/torrentKept/", "t/watchPositions/", "t/playlists/Evening#2", "t/homeItems", "t/offlineSettings/", "t/silencedAnime/", "x/ext-a.json", "p/", "s/", "f/t/settings/library", "f/t/appearance/1", "f/p/sea-media-core-preferences"]) {
            expect(stored.package.parts.some(part => part.startsWith(prefix)), prefix).toBe(true)
        }
    })

    it("the edited package of the first case opens at V + 1 and not at V (the website writes V + 1)", () => {
        const stored = readVectors()
        const dek = unhex(stored.input.dek)
        const first = stored.cases[0]!
        const sealed = first.expected.sealed!
        expect(sealed.binding.version).toBe(stored.input.version + 1)
        expect(openPackage(sodium, gzip, unhex(sealed.sealedHex), dek, sealed.binding)).toEqual(first.expected.package)
        expect(() => openPackage(sodium, gzip, unhex(sealed.sealedHex), dek, { ...sealed.binding, version: stored.input.version })).toThrow()
        expect(hex(decryptPackage(sodium, unhex(sealed.sealedHex), dek, sealed.binding))).toBe(sealed.gzipHex)
    })

    it("every case changes only its own parts and stamps them above both their old stamps and the time of the edit", () => {
        const stored = readVectors()
        const base = stored.package.object
        for (const one of stored.cases) {
            const stamps = one.expected.package.stamps!
            const asked = new Set(one.changes.map(change => change.key))
            for (const [key, time] of Object.entries(one.expected.changedStamps)) {
                expect(time, `${one.name} ${key}`).toBeGreaterThanOrEqual(one.now)
                expect(time, `${one.name} ${key}`).toBeGreaterThan(Math.max(base.stamps!.changed[key] ?? -1, base.stamps!.deleted[key] ?? -1) as number)
                expect(stamps.changed[key]).toBe(time)
            }
            // a changed stamp is a change asked for or the row of an asked field, nothing else
            for (const key of Object.keys(one.expected.changedStamps)) {
                const row = key.startsWith("f/") ? undefined : [...asked].some(asking => asking.startsWith("f/") && asking.slice(2).split(SEP)[0] === key)
                expect(asked.has(key) || row, `${one.name} ${key}`).toBe(true)
            }
            // tombstones the case did not touch stay exactly as they were
            for (const [key, time] of Object.entries(base.stamps!.deleted)) {
                if (!one.expected.clearedTombstones.includes(key)) expect(stamps.deleted[key], `${one.name} ${key}`).toBe(time)
            }
        }
    })
})
