// geschrieben nach: Form der Aufzeichnungen TORRENT_SEARCH.* vom 13.11.2026 (nur die Form, search.recorded.json), dem Vertrag anime-torrent-provider.d.ts, dem Muster streams/onlinestream.test.ts und docs/EIGENER-KERN.md §4q (Phase 6c-1); kein Server-Quelltext

import { beforeEach, describe, expect, it } from "vitest"
import { sqlDriverFor } from "@/api/client/core-database"
import { forgetDatabases, openDatabaseSync } from "../../../test/expo-sqlite"
import type { HttpFetch } from "../anilist/client"
import { type CoreDatabase, openCoreDatabase } from "../database/database"
import type { ExtensionPlace } from "../extensions/manage/installed"
import { closeExtensionSandboxes } from "../extensions/manage/manage"
import { nodeSandboxEngine } from "../extensions/sandbox/node-engine"
import { coreAnswerFor } from "../index"
import { type CoreEnvironment } from "../registry"
import { type AutoSelectProfile, type FoundTorrent, bytesOf, chooseTorrent, emptyProfile, namesWebSeed, providersWithoutCount } from "./autoselect"
import { distanceOf, torrentOut } from "./search"
import { type TorrentDevice, type TorrentSessionSettings, forgetTorrentStream, runningTorrentStream, sessionSettingsOf } from "./torrent"
import recorded from "./search.recorded.json"

const HASH_A = "a".repeat(40)
const HASH_B = "b".repeat(40)
const HASH_C = "c".repeat(40)

/* Providers after the contract, with made-up values: each call is logged, so the tests see what the core asked. */
const SMART_TS = `/// <reference path="./anime-torrent-provider.d.ts" />
class Provider {
    getSettings(): AnimeProviderSettings {
        return { canSmartSearch: true, smartSearchFilters: ["batch", "episodeNumber", "resolution", "query", "bestReleases"], supportsAdult: false, type: "main" }
    }
    private list(): AnimeTorrent[] {
        const one = (name: string, hash: string, seeders: number, more: Partial<AnimeTorrent>): AnimeTorrent => ({
            name, date: "2026-01-01T00:00:00Z", size: 500000000, formattedSize: "500 MB", seeders, leechers: 1, downloadCount: 3,
            link: "https://tracker.example/" + hash.slice(0, 4), downloadUrl: "https://tracker.example/d/" + hash.slice(0, 4),
            magnetLink: "magnet:?xt=urn:btih:" + hash, infoHash: hash, isBestRelease: false, confirmed: false, ...more,
        })
        return [
            one("[Alpha] Dr. Stone - 01 [720p].mkv", "${HASH_A}", 40, { resolution: "720p", episodeNumber: 1, releaseGroup: "Alpha" }),
            one("[Beta] Dr. Stone - 01 [1080p].mkv", "${HASH_B}", 9, { resolution: "1080p", episodeNumber: 1, releaseGroup: "Beta" }),
            one("[Gamma] Dr. Stone (01-24) [1080p] Batch", "${HASH_C}", 12, { resolution: "1080p", isBatch: true, releaseGroup: "Gamma" }),
        ]
    }
    async search(opts: AnimeSearchOptions): Promise<AnimeTorrent[]> {
        console.log("search " + opts.query + " " + opts.media.id)
        return this.list()
    }
    async smartSearch(opts: AnimeSmartSearchOptions): Promise<AnimeTorrent[]> {
        console.log("smartSearch " + [opts.query, opts.episodeNumber, opts.batch, opts.resolution, opts.anidbAID, opts.anidbEID, opts.bestReleases, opts.media.romajiTitle, opts.media.absoluteSeasonOffset ?? "-"].join(" "))
        return this.list()
    }
    async getTorrentInfoHash(torrent: AnimeTorrent): Promise<string> { return torrent.infoHash || "" }
    async getTorrentMagnetLink(torrent: AnimeTorrent): Promise<string> { return torrent.magnetLink || "" }
    async getLatest(): Promise<AnimeTorrent[]> {
        console.log("getLatest")
        return this.list().slice(0, 1)
    }
}`

const PLAIN_TS = `/// <reference path="./anime-torrent-provider.d.ts" />
class Provider {
    getSettings(): AnimeProviderSettings {
        return { canSmartSearch: false, smartSearchFilters: [], supportsAdult: false, type: "main" }
    }
    async search(opts: AnimeSearchOptions): Promise<AnimeTorrent[]> {
        console.log("plain search " + opts.query)
        return [{ name: "Dr. Stone 01 [480p]", date: "", size: 1, formattedSize: "1 B", seeders: 99, leechers: 0, downloadCount: 0,
            link: "https://plain.example/1", downloadUrl: "", isBestRelease: false, confirmed: false }]
    }
    async smartSearch(): Promise<AnimeTorrent[]> { throw new Error("cannot") }
    async getTorrentInfoHash(torrent: AnimeTorrent): Promise<string> {
        console.log("plain infoHash " + torrent.link)
        return "${"d".repeat(40)}"
    }
    async getTorrentMagnetLink(): Promise<string> { return "" }
    async getLatest(): Promise<AnimeTorrent[]> { return [] }
}`

type Shape = string | Shape[] | { [key: string]: Shape }
const kindOf = (value: unknown) => (value === null ? "null" : Array.isArray(value) ? "array" : typeof value)

function differences(shape: Shape, value: unknown, at = "data"): string[] {
    if (typeof shape === "string") return kindOf(value) === shape ? [] : [`${at}: ${kindOf(value)} instead of ${shape}`]
    if (Array.isArray(shape)) return Array.isArray(value) ? [] : [`${at}: not an array`]
    if (kindOf(value) !== "object") return [`${at}: ${kindOf(value)} instead of object`]
    const object = value as Record<string, unknown>
    return [
        ...Object.keys(shape).flatMap(key => (key in object ? differences(shape[key]!, object[key], `${at}.${key}`) : [`${at}.${key}: missing`])),
        ...Object.keys(object).filter(key => !(key in shape)).map(key => `${at}.${key}: not recorded`),
    ]
}

const answers = recorded.answers as Record<string, { method: string, endpoint: string, data: Shape, metadataEntry?: Shape, after?: Shape }>
const TORRENT_FIELDS = recorded.torrentFields as Record<string, string>

const MEDIA = {
    id: 105333, idMal: 38691, status: "FINISHED", format: "TV", episodes: 24, synonyms: ["Dcst"], isAdult: false,
    title: { english: "Dr. STONE", native: "x", romaji: "Dr. STONE", userPreferred: "Dr. STONE" }, startDate: { year: 2019, month: 7, day: 5 },
}
const ANIZIP = { titles: { "x-jat": "Dr. STONE" }, episodes: { 1: { episode: "1", anidbEid: 222, title: { en: "Stone World" } } }, episodeCount: 24, mappings: { anidb_id: 14000 } }

let files: Map<string, string>
let place: ExtensionPlace
let database: Promise<CoreDatabase> | null
let calls: string[]
let added: string[]
let used: TorrentSessionSettings[]
const now = 1_700_000_000_000

const httpFetch: HttpFetch = async url => {
    if (url.startsWith("https://graphql.anilist.co")) return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ data: { Media: MEDIA } }) }
    if (url.startsWith("https://api.ani.zip/")) return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify(ANIZIP) }
    throw new TypeError("Network request failed")
}

const device: TorrentDevice = {
    useSettings: settings => void used.push(settings),
    addMagnet: async uri => {
        added.push(uri)
        return /btih:([0-9a-f]{40})/.exec(uri)?.[1] ?? HASH_A
    },
    files: async () => [{ index: 0, path: "Show/[Beta] Dr. Stone - 01 [1080p].mkv", size: 900, pieceStart: 0, pieceEnd: 9 }],
    status: async infoHash => ({ infoHash, state: "downloading", error: "", hasMetadata: true, progress: 0, downRate: 0, upRate: 0, peers: 0, seeds: 0, bytesDone: 0, bytesWanted: 1 }),
    setFilePriority: async () => undefined,
    setSequential: async () => undefined,
    setPieceDeadlines: async () => undefined,
    serve: async infoHash => `http://127.0.0.1:1/${"0".repeat(32)}/${infoHash}/0/x.mkv`,
    remove: async () => undefined,
    stop: async () => undefined,
    onStatus: () => () => undefined,
    wait: async () => undefined,
}

const manifest = (id: string, payload: string) => JSON.stringify({
    id, name: id, version: "1.0.0", manifestURI: `https://ext.example/${id}/manifest.json`, language: "typescript",
    type: "anime-torrent-provider", description: "", author: "tester", icon: "", website: "", readme: "", lang: "en", payload,
})

const environment = {
    fetch: httpFetch,
    secret: async () => null,
    database: () => database ??= openCoreDatabase(sqlDriverFor(openDatabaseSync("core.db") as never), () => now),
    now: () => now,
    pause: async () => undefined,
    extensions: async () => place,
    torrent: async () => device,
} as unknown as CoreEnvironment

beforeEach(async () => {
    if (place) await closeExtensionSandboxes(place)
    forgetDatabases()
    forgetTorrentStream()
    database = null
    calls = []
    added = []
    used = []
    files = new Map([["smart.json", manifest("smart", SMART_TS)], ["plain.json", manifest("plain", PLAIN_TS)]])
    place = {
        folder: {
            names: async () => [...files.keys()],
            read: async name => files.get(name) ?? null,
            write: async (name, text) => void files.set(name, text),
            remove: async name => void files.delete(name),
            stamp: async name => (files.has(name) ? `${files.get(name)!.length}.1` : null),
        },
        serverCache: async () => null,
        serverCacheStamp: async () => null,
        writeServerCache: async () => undefined,
        customSourceNumbers: async () => ({}),
        serverMappings: async () => null,
        engine: async () => nodeSandboxEngine,
        fetch: async url => {
            throw new TypeError(`no network in tests: ${url}`)
        },
        log: (_id, _level, text) => void calls.push(text),
    }
})

async function ask(method: string, endpoint: string, body?: unknown): Promise<any> {
    const answer = coreAnswerFor(method, endpoint)
    if (!answer) throw new Error(`not answered by the core: ${method} ${endpoint}`)
    return answer({ query: undefined, body }, environment)
}

const SEARCH = { query: "", episodeNumber: 1, batch: false, media: MEDIA, absoluteOffset: 0, resolution: "", type: "smart", provider: "smart", bestRelease: false }


describe("torrent search against the recorded form", () => {
    it("smart: asks smartSearch with the episode and the AniDB numbers, answers in the recorded form with previews", async () => {
        const data = await ask("POST", "/api/v1/torrent/search", SEARCH)
        expect(differences(answers["SearchTorrent.dkb"]!.data, data).filter(line => !line.includes("debridInstantAvailability"))).toEqual([])
        expect(data.debridInstantAvailability).toBeNull()
        expect(calls).toContain("smartSearch  1 false  14000 222 false Dr. STONE -")
        expect(data.torrents.map((torrent: FoundTorrent) => torrent.seeders)).toEqual([40, 12, 9])
        for (const torrent of data.torrents) {
            for (const [key, value] of Object.entries(torrent)) expect(kindOf(value), key).toBe(TORRENT_FIELDS[key])
            for (const key of recorded.everyTorrentHas) expect(torrent, key).toHaveProperty(key)
            expect(torrent.provider).toBe("smart")
            expect(differences(answers["SearchTorrent.dkb"]!.metadataEntry!, data.torrentMetadata[torrent.infoHash])).toEqual([])
        }
        expect(data.torrents[1].isBatch).toBe(true)
        expect(data.torrents[1].episodeNumber).toBe(-1)
        expect(data.torrentMetadata[HASH_A].distance).toBe(0)
        expect(data.previews.map((preview: { episode?: { episodeNumber: number } }) => preview.episode?.episodeNumber ?? null)).toEqual([1, null, 1])
        expect(data.animeMetadata.mappings.anidbId).toBe(14000)
    })

    it("smart with a provider that cannot: search with the anime's title; simple: the words, without words the newest", async () => {
        const plain = await ask("POST", "/api/v1/torrent/search", { ...SEARCH, provider: "plain", absoluteOffset: 3 })
        expect(calls).toContain("plain search Dr. STONE")
        expect(plain.torrents[0]).toMatchObject({ provider: "plain", magnetLink: "", infoHash: "", episodeNumber: -1 })
        expect(plain.torrentMetadata).toEqual({})

        const simple = await ask("POST", "/api/v1/torrent/search", { ...SEARCH, type: "simple", query: "dr. stone" })
        expect(calls).toContain("search dr. stone 105333")
        expect(simple.previews).toEqual([])
        expect(simple.torrents).toHaveLength(3)

        const latest = await ask("POST", "/api/v1/torrent/search", { ...SEARCH, type: "simple", media: undefined })
        expect(calls).toContain("getLatest")
        expect(latest.torrents).toHaveLength(1)
        await expect(ask("POST", "/api/v1/torrent/search", { ...SEARCH, provider: "gone" })).rejects.toThrow("torrent provider not found: gone")
        await expect(ask("POST", "/api/v1/torrent/search", { ...SEARCH, provider: "" })).rejects.toThrow("provider is required")
    })

    it("several providers joined by commas (the phone's search): answers put together, most seeders first, a failing one falls away", async () => {
        const one = await ask("POST", "/api/v1/torrent/search", { ...SEARCH, type: "simple", query: "dr. stone" })
        const two = await ask("POST", "/api/v1/torrent/search", { ...SEARCH, type: "simple", query: "dr. stone", provider: "plain" })
        const both = await ask("POST", "/api/v1/torrent/search", { ...SEARCH, type: "simple", query: "dr. stone", provider: `${SEARCH.provider}, plain` })
        expect(both.torrents).toHaveLength(one.torrents.length + two.torrents.length)
        const seeders = both.torrents.map((torrent: { seeders?: number }) => torrent.seeders ?? 0)
        expect(seeders).toEqual([...seeders].sort((a, b) => b - a))
        expect(new Set(both.torrents.map((torrent: { provider: string }) => torrent.provider))).toEqual(new Set([SEARCH.provider, "plain"]))

        const without = await ask("POST", "/api/v1/torrent/search", { ...SEARCH, type: "simple", query: "dr. stone", provider: `gone,${SEARCH.provider}` })
        expect(without.torrents).toHaveLength(one.torrents.length)
        await expect(ask("POST", "/api/v1/torrent/search", { ...SEARCH, provider: "gone,lost" })).rejects.toThrow("torrent provider not found: gone")
    })

    it("fills what a provider leaves out", () => {
        expect(torrentOut("p", { name: "x", infoHash: "ABC", episodeNumber: 0 })).toEqual({
            provider: "p", name: "x", date: "", size: 0, formattedSize: "", seeders: 0, leechers: 0, downloadCount: 0, link: "", downloadUrl: "",
            magnetLink: "", infoHash: "abc", episodeNumber: -1, isBestRelease: false, confirmed: false,
        })
        expect(distanceOf("dr stone", "dr. stone")).toBe(1)
        expect(distanceOf("", "abc")).toBe(3)
    })
})

describe("the auto-select profile", () => {
    it("is empty in the recorded form, saved with dbId 1, read back, deleted", async () => {
        const empty = await ask("GET", "/api/v1/auto-select/profile")
        expect(differences(answers.GetAutoSelectProfile!.data, empty)).toEqual([])
        expect(empty.dbId).toBe(recorded.answers.GetAutoSelectProfile.dbIdWithoutProfile)

        const sent = { ...empty, resolutions: ["1080p", "720p"], minSeeders: 2, releaseGroups: [], unknown: "x" }
        const saved = await ask("POST", "/api/v1/auto-select/profile", { profile: sent })
        expect(differences(answers.SaveAutoSelectProfile!.data, saved)).toEqual([])
        expect(saved).toMatchObject({ dbId: recorded.answers.SaveAutoSelectProfile.dbIdSaved, resolutions: ["1080p", "720p"], releaseGroups: null, minSeeders: 2 })
        expect(await ask("GET", "/api/v1/auto-select/profile")).toEqual(saved)

        expect(await ask("DELETE", "/api/v1/auto-select/profile")).toBe(true)
        expect(differences(answers.DeleteAutoSelectProfile!.after!, await ask("GET", "/api/v1/auto-select/profile"))).toEqual([])
        await expect(ask("POST", "/api/v1/auto-select/profile", { profile: "no" })).rejects.toThrow("profile must be an object")
    })
})

describe("the auto-select rule", () => {
    const torrent = (name: string, more: Partial<FoundTorrent> = {}): FoundTorrent => ({
        provider: "smart", name, size: 500_000_000, seeders: 10, magnetLink: "magnet:?xt=urn:btih:" + HASH_A, infoHash: HASH_A, isBestRelease: false, ...more,
    })
    const pick = (list: FoundTorrent[], profile: Partial<AutoSelectProfile> = {}, episodeNumber = 1, preferredResolution = "") =>
        chooseTorrent(list, { ...emptyProfile(), ...profile }, { episodeNumber, preferredResolution })?.torrent.name ?? null

    it("leaves out what cannot or must not be streamed", () => {
        expect(pick([torrent("[A] Show - 01 [1080p]", { seeders: 0 })])).toBeNull()
        expect(pick([torrent("[A] Show - 02 [1080p]")])).toBeNull()
        expect(pick([torrent("[A] Show - 01 [1080p] HEVC")], { excludeTerms: ["hevc"] })).toBeNull()
        expect(pick([torrent("[A] Show - 01 [1080p]", { seeders: 3 })], { minSeeders: 5 })).toBeNull()
        expect(pick([torrent("[A] Show (01-12) [1080p]", { isBatch: true })], { batchPreference: "never" })).toBeNull()
        expect(pick([torrent("[A] Show - 01 [1080p]")], { batchPreference: "only" })).toBeNull()
        expect(pick([torrent("[A] Show (13-24) [1080p] Batch")])).toBeNull()
        expect(pick([torrent("[A] Show - 01 [1080p]", { size: 5_000_000_000 })], { maxSize: "2 GB" })).toBeNull()
        expect(pick([torrent("[A] Show - 01 [1080p]")], { requireLanguage: true, preferredLanguages: ["ger"] })).toBeNull()
        expect(pick([torrent("[A] Show - 01 [720p]")], { resolutions: ["1080p"] })).toBeNull()
        expect(pick([torrent("[A] Show - 01 [720p]", { magnetLink: "", infoHash: "", provider: "" })])).toBeNull()
    })

    it("orders by resolution, preferences, group, provider, seeders", () => {
        const list = [
            torrent("[Low] Show - 01 [720p]", { seeders: 90 }),
            torrent("[Fast] Show - 01 [1080p]", { seeders: 50 }),
            torrent("[Slow] Show - 01 [1080p]", { seeders: 5, provider: "plain" }),
            torrent("[Pack] Show (01-12) [1080p] Batch", { seeders: 70, isBatch: true }),
        ]
        expect(pick(list)).toBe("[Pack] Show (01-12) [1080p] Batch")
        expect(pick(list, { batchPreference: "avoid" })).toBe("[Fast] Show - 01 [1080p]")
        expect(pick(list, { resolutions: ["720p", "1080p"] })).toBe("[Low] Show - 01 [720p]")
        expect(pick(list, {}, 1, "720p")).toBe("[Low] Show - 01 [720p]")
        expect(pick(list, { batchPreference: "never", releaseGroups: ["Slow"] })).toBe("[Slow] Show - 01 [1080p]")
        expect(pick(list, { batchPreference: "never", providers: ["plain", "smart"] })).toBe("[Slow] Show - 01 [1080p]")
        expect(pick([torrent("[A] Show - 01 [1080p]", { seeders: 5 }), torrent("[B] Show - 01 [1080p] Dual Audio", { seeders: 4 })], { multipleAudioPreference: "prefer" })).toBe("[B] Show - 01 [1080p] Dual Audio")
        expect(bytesOf("1.5 GB")).toBe(1_500_000_000)
        expect(bytesOf("700MiB")).toBe(700 * 1024 ** 2)
        expect(bytesOf("soon")).toBe(0)
    })
})

describe("the stream with auto select, the provider's magnet link and the saved settings", () => {
    it("picks a torrent itself and starts it, nothing played (playbackType none)", async () => {
        await ask("POST", "/api/v1/auto-select/profile", { profile: { ...emptyProfile(), batchPreference: "never", resolutions: ["1080p"] } })
        expect(await ask("POST", "/api/v1/torrentstream/start", { mediaId: 105333, episodeNumber: 1, aniDBEpisode: "1", autoSelect: true, playbackType: "none", clientId: "" })).toBe(true)
        expect(added).toEqual([`magnet:?xt=urn:btih:${HASH_B}`])
        expect(runningTorrentStream()?.infoHash).toBe(HASH_B)
        expect(used).toEqual([{ downloadDir: "", listenPort: 0 }])
    })

    it("asks the provider for a torrent without magnet link and info hash", async () => {
        const torrent = { provider: "plain", name: "Dr. Stone 01 [480p]", link: "https://plain.example/1", magnetLink: "", infoHash: "" }
        await ask("POST", "/api/v1/torrentstream/start", { mediaId: 105333, episodeNumber: 1, aniDBEpisode: "1", autoSelect: false, torrent, playbackType: "none", clientId: "" })
        expect(calls).toContain("plain infoHash https://plain.example/1")
        expect(added).toEqual([`magnet:?xt=urn:btih:${"d".repeat(40)}`])
    })

    it("hands the saved download folder and port to the session", async () => {
        await ask("PATCH", "/api/v1/torrentstream/settings", { settings: { downloadDir: "/storage/emulated/0/Movies/x", torrentClientPort: 43215 } })
        await ask("POST", "/api/v1/torrentstream/start", { mediaId: 105333, episodeNumber: 1, aniDBEpisode: "1", autoSelect: false, torrent: { infoHash: HASH_A, name: "x" }, playbackType: "none", clientId: "" })
        expect(used.at(-1)).toEqual({ downloadDir: "/storage/emulated/0/Movies/x", listenPort: 43215 })
        expect(sessionSettingsOf({ downloadDir: "relative/x", torrentClientPort: 70000 })).toEqual({ downloadDir: "", listenPort: 0 })
        expect(sessionSettingsOf(null)).toEqual({ downloadDir: "", listenPort: 0 })
    })
})

describe("the auto-select rule and the way to a torrent's data (phase 6b-3)", () => {
    const WEB_SEED = `magnet:?xt=urn:btih:${"ab".repeat(20)}&ws=https%3A%2F%2Ffiles.example%2Fshow%2F`
    const found = (name: string, more: Partial<FoundTorrent> = {}): FoundTorrent => ({ provider: "p", name, size: 500_000_000, seeders: 5, isBestRelease: false, infoHash: "cd".repeat(20), ...more })
    const pick = (list: FoundTorrent[], profile: Partial<AutoSelectProfile> = {}) =>
        chooseTorrent(list, { ...emptyProfile(), ...profile }, { episodeNumber: 1, preferredResolution: "" })?.torrent.name ?? null

    it("reads a web seed out of a magnet link only", () => {
        expect(namesWebSeed({ magnetLink: WEB_SEED })).toBe(true)
        expect(namesWebSeed({ magnetLink: `magnet:?xt=urn:btih:${"ab".repeat(20)}&tr=https%3A%2F%2Ftracker.example%2Fannounce` })).toBe(false)
        expect(namesWebSeed({})).toBe(false)
    })

    it("never picks a torrent nobody seeds whose link names no web seed", () => {
        expect(pick([found("[A] Show - 01 [1080p]", { seeders: 0 })])).toBeNull()
        expect(pick([found("[A] Show - 01 [1080p]", { seeders: 0, magnetLink: `magnet:?xt=urn:btih:${"ab".repeat(20)}` })])).toBeNull()
        // unknown counts (a provider that says nothing) are none
        expect(pick([found("[A] Show - 01 [1080p]", { seeders: undefined as unknown as number })])).toBeNull()
        expect(pick([found("[A] Show - 01 [1080p]", { seeders: 0 }), found("[B] Show - 01 [480p]", { seeders: 1 })])).toBe("[B] Show - 01 [480p]")
    })

    it("takes a torrent that only names a web seed last, and never below the profile's minimum of seeders", () => {
        const webOnly = found("[W] Show - 01 [1080p]", { seeders: 0, magnetLink: WEB_SEED })
        expect(pick([webOnly])).toBe("[W] Show - 01 [1080p]")
        // a seeded torrent wins, whatever its resolution
        expect(pick([webOnly, found("[B] Show - 01 [480p]", { seeders: 2 })])).toBe("[B] Show - 01 [480p]")
        expect(pick([webOnly], { minSeeders: 1 })).toBeNull()
        expect(pick([webOnly, found("[B] Show - 01 [480p]", { seeders: 2 })], { minSeeders: 3 })).toBeNull()
    })
})

describe("the auto-select rule and a provider that does not count seeders (phase 6e)", () => {
    const TORRENT_FILE = "https://files.example/show/show.torrent"
    const fixed = (name: string, more: Partial<FoundTorrent> = {}): FoundTorrent => ({ provider: "archive", name, size: 900_000_000, seeders: 1, isBestRelease: false, infoHash: "ef".repeat(20), downloadUrl: TORRENT_FILE, ...more })
    const counted = (name: string, seeders: number): FoundTorrent => ({ provider: "tracker", name, size: 500_000_000, seeders, isBestRelease: false, infoHash: "ab".repeat(20) })
    const ARCHIVE = [fixed("Show - 01 [480p]"), fixed("Show - 01 [1080p]"), fixed("Show (01-12) [720p]", { isBatch: true })]
    const pick = (list: FoundTorrent[], profile: Partial<AutoSelectProfile> = {}) =>
        chooseTorrent(list, { ...emptyProfile(), ...profile }, { episodeNumber: 1, preferredResolution: "" })?.torrent.name ?? null

    it("reads a provider whose every torrent (three or more) says the same number as one without a count", () => {
        expect(providersWithoutCount(ARCHIVE)).toEqual(new Set(["archive"]))
        expect(providersWithoutCount(ARCHIVE.slice(0, 2))).toEqual(new Set())
        expect(providersWithoutCount([counted("A", 4), counted("B", 4), counted("C", 9)])).toEqual(new Set())
        expect(providersWithoutCount([counted("A", 0), counted("B", 0), counted("C", 0)])).toEqual(new Set(["tracker"]))
    })

    it("puts a counted seeder before an uncounted one, whatever the resolution", () => {
        expect(pick([...ARCHIVE, counted("[B] Show - 01 [480p]", 1)])).toBe("[B] Show - 01 [480p]")
        // among themselves the uncounted ones go by the rest of the rule
        expect(pick(ARCHIVE)).toBe("Show - 01 [1080p]")
    })

    it("needs a way to the data for an uncounted torrent and never counts it towards the profile's minimum", () => {
        const noWay = ARCHIVE.map(torrent => ({ ...torrent, downloadUrl: "" }))
        expect(pick(noWay)).toBeNull()
        expect(pick(ARCHIVE.map(torrent => ({ ...torrent, downloadUrl: "http://files.example/show.torrent" })))).toBeNull()
        // a web seed in the magnet link is a way, and a surer one than a .torrent file that may name some
        const named = { ...noWay[0]!, name: "Show - 01 [720p] web", magnetLink: `magnet:?xt=urn:btih:${"ef".repeat(20)}&ws=https%3A%2F%2Ffiles.example%2F` }
        expect(pick([...noWay, named])).toBe("Show - 01 [720p] web")
        expect(pick([...ARCHIVE, named])).toBe("Show - 01 [720p] web")
        expect(pick(ARCHIVE, { minSeeders: 1 })).toBeNull()
    })
})
