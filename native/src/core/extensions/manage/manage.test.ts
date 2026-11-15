// geschrieben nach: den Aufzeichnungen EXTENSIONS.* vom 13.11.2026 (nur ihre Form, ohne Werte: manage.recorded.json), den Vertrags-Dateien der Erweiterungs-Arten (.d.ts) und docs/EIGENER-KERN.md §4l; die Beispiel-Erweiterungen sind eigene

import { readFileSync } from "node:fs"
import path from "node:path"
import { beforeEach, describe, expect, it } from "vitest"
import { sqlDriverFor } from "@/api/client/core-database"
import { forgetDatabases, openDatabaseSync } from "../../../../test/expo-sqlite"
import type { HttpFetch } from "../../anilist/client"
import { type CoreDatabase, openCoreDatabase } from "../../database/database"
import { LONGEST_PIECE_MS, createBlockingWatch } from "../../blocking"
import { extensionSettings, extensionUserConfigs } from "../../database/schema"
import { onCoreEvent } from "../../events"
import { type CoreEnvironment, matchCoreRoute } from "../../registry"
import type { HelperFetch } from "../helpers/helpers"
import { nodeSandboxEngine } from "../sandbox/node-engine"
import { SandboxError } from "../sandbox/sandbox"
import { installExtension, uninstallExtension, updateExtension } from "./install"
import { placeWithWaits, readInstalled } from "./installed"
import type { ExtensionPlace } from "./installed"
import { ExtensionLoader, loadScriptOf } from "./loader"
import { DEFAULT_MARKETPLACE_URL, type ManageEnvironment, closeExtensionSandboxes, openExtensionSandboxes, setSandboxSettings } from "./manage"
import recorded from "./manage.recorded.json"

// ---- small extensions of each kind, written after the contract files ----

const ONLINESTREAM_TS = `/// <reference path="./onlinestream-provider.d.ts" />
type Kind = "sub" | "dub"
interface Found { id: string, title: string }
class Provider {
    private readonly base: string = $getUserPreference("baseUrl") ?? "https://stream.example"
    getSettings(): Settings {
        return { episodeServers: ["alpha", "beta"], supportsDub: true }
    }
    async search(opts: SearchOptions): Promise<SearchResult[]> {
        const kind: Kind = opts.dub ? "dub" : "sub"
        const found: Found[] = [{ id: "one", title: opts.query }]
        return found.map(item => ({ id: item.id, title: item.title, url: this.base + "/" + item.id, subOrDub: kind }))
    }
    async findEpisodes(id: string): Promise<EpisodeDetails[]> {
        return [{ id: id + "-1", number: 1, url: this.base + "/" + id + "/1" }]
    }
    async findEpisodeServer(episode: EpisodeDetails, server: string): Promise<EpisodeServer> {
        return { server, headers: {}, videoSources: [{ url: episode.url + ".m3u8", type: "m3u8", quality: "auto", subtitles: [] }] }
    }
}`

const MANGA_TS = `/// <reference path="./manga-provider.d.ts" />
enum Lang { En = "en" }
class Provider {
    getSettings(): Settings {
        return { supportsMultiScanlator: true, supportsMultiLanguage: false }
    }
    async search(opts: QueryOptions): Promise<SearchResult[]> {
        return [{ id: "m1", title: opts.query as string, synonyms: [], year: 2019, image: "", language: Lang.En }]
    }
    async findChapters(id: string): Promise<ChapterDetails[]> { return [] }
    async findChapterPages(id: string): Promise<ChapterPage[]> { return [] }
}`

const TORRENT_JS = `class Provider {
    getSettings() {
        return { canSmartSearch: true, smartSearchFilters: ["batch", "episodeNumber", "query"], supportsAdult: false, type: "main" }
    }
    async search(opts) { return [{ name: opts.query + " [1080p]", link: "https://torrent.example/1", infoHash: "abc" }] }
    async smartSearch(opts) { return this.search(opts) }
    async getTorrentInfoHash(torrent) { return torrent.infoHash }
    async getTorrentMagnetLink(torrent) { return "magnet:?xt=urn:btih:" + torrent.infoHash }
    async getLatest() { return [] }
}`

const CUSTOM_SOURCE_TS = `/// <reference path="./custom-source.d.ts" />
class Provider {
    getSettings(): Settings {
        return { supportsAnime: true, supportsManga: false }
    }
    async listAnime<T extends { id: number }>(search: string, page: number, perPage: number): Promise<{ media: T[], page: number, totalPages: number, total: number }> {
        return { media: [], page, totalPages: 0, total: 0 }
    }
}`

const BROKEN_TS = `class Provider {
    constructor() { throw new Error("cannot start") }
    getSettings(): Settings { return { episodeServers: [], supportsDub: false } }
}`

function manifest(id: string, type: string, language: string, payload: string, more: Record<string, unknown> = {}) {
    return { id, name: `Test ${id}`, version: "1.0.0", manifestURI: `https://ext.example/${id}/manifest.json`, language, type, description: "", author: "tester", icon: "", website: "", readme: "", lang: "en", payload, ...more }
}

const USER_CONFIG = {
    version: 2,
    requiresConfig: true,
    fields: [
        { type: "select", name: "baseUrl", label: "Mirror", options: [{ value: "https://stream.example", label: "main" }, { value: "https://mirror.example", label: "mirror" }], default: "https://stream.example" },
        { type: "text", name: "greeting", label: "Greeting", default: "hi" },
    ],
}

function folderOf(files: Map<string, string>) {
    return {
        names: async () => [...files.keys()],
        read: async (name: string) => files.get(name) ?? null,
        write: async (name: string, text: string) => void files.set(name, text),
        remove: async (name: string) => void files.delete(name),
        stamp: async (name: string) => stampOf(files.get(name)),
    }
}

/** As a file's size and time would change: any other text gives another stamp */
function stampOf(text: string | undefined): string | null {
    if (text === undefined) return null
    let hash = 0
    for (const letter of text) hash = (hash * 31 + letter.charCodeAt(0)) | 0
    return `${text.length}.${hash}`
}

/** No network in these tests: every address answers from this table */
let web: Record<string, string> = {}

const helperFetch: HelperFetch = async url => {
    throw new TypeError(`no network in tests: ${url}`)
}

const httpFetch: HttpFetch = async url => {
    if (!Object.hasOwn(web, url)) throw new TypeError("Network request failed")
    return { status: 200, headers: { get: () => null }, text: async () => web[url] }
}

let files: Map<string, string>
let cache: Record<string, string>
let place: ExtensionPlace
let database: Promise<CoreDatabase> | null
let environment: CoreEnvironment

function standardFiles() {
    return new Map<string, string>([
        ["stream.json", JSON.stringify(manifest("stream", "onlinestream-provider", "typescript", ONLINESTREAM_TS, { userConfig: USER_CONFIG }))],
        ["reader.json", JSON.stringify(manifest("reader", "manga-provider", "typescript", MANGA_TS))],
        ["tracker.json", JSON.stringify(manifest("tracker", "anime-torrent-provider", "javascript", TORRENT_JS))],
        ["source.json", JSON.stringify(manifest("source", "custom-source", "typescript", CUSTOM_SOURCE_TS))],
        ["off.json", JSON.stringify(manifest("off", "anime-torrent-provider", "javascript", TORRENT_JS))],
        ["broken-file.json", "{ not json"],
        ["notes.txt", "not an extension"],
    ])
}

beforeEach(async () => {
    if (place) await closeExtensionSandboxes(place)
    forgetDatabases()
    web = {}
    files = standardFiles()
    cache = {
        "extension-settings": JSON.stringify({ 1: { value: { disabledExtensionIds: { off: true } }, updated_at: "2026-01-01T00:00:00Z" } }),
        "ext_user_config_stream": JSON.stringify({ stream: { value: { version: 2, values: { baseUrl: "https://mirror.example", greeting: "hello" } }, updated_at: "2026-01-01T00:00:00Z" } }),
    }
    place = {
        folder: folderOf(files),
        serverCache: async bucket => cache[bucket] ?? null,
        serverCacheStamp: async bucket => stampOf(cache[bucket]),
        writeServerCache: async (bucket, text) => void (cache[bucket] = text),
        customSourceNumbers: async () => ({ source: 7 }),
        engine: async () => nodeSandboxEngine,
        fetch: helperFetch,
    }
    database = null
    environment = {
        fetch: httpFetch,
        secret: async () => null,
        database: () => database ??= openCoreDatabase(sqlDriverFor(openDatabaseSync("core.db") as never), () => 1000),
        now: () => 1000,
        pause: async () => undefined,
        extensions: async () => place,
    }
})

function manageEnvironment(): ManageEnvironment {
    return { place, database: environment.database, fetch: httpFetch, now: () => 1000 }
}

async function ask(method: string, endpoint: string, body: unknown = null, query: unknown = null): Promise<unknown> {
    const match = matchCoreRoute(method, endpoint)
    expect(match?.route.area, `${method} ${endpoint}`).toBe("extensions")
    return match!.route.answer({ path: match!.path, query, body }, environment)
}

// ---- comparing with the recorded form ----

type Shape = string | Shape[] | { [key: string]: Shape }

function kindOf(value: unknown): string {
    if (value === null) return "null"
    if (Array.isArray(value)) return "array"
    return typeof value
}

/** Where `value` does not have the recorded form: every field the server had must be there with its kind, no field more */
function misfits(value: unknown, shape: Shape, at = "data"): string[] {
    if (typeof shape === "string") return kindOf(value) === shape ? [] : [`${at}: ${kindOf(value)} instead of ${shape}`]
    if (Array.isArray(shape)) {
        if (!Array.isArray(value)) return [`${at}: ${kindOf(value)} instead of array`]
        return shape[1] === undefined ? [] : value.flatMap((item, index) => misfits(item, shape[1], `${at}[${index}]`))
    }
    if (kindOf(value) !== "object") return [`${at}: ${kindOf(value)} instead of object`]
    const record = value as Record<string, unknown>
    const problems: string[] = []
    const known = new Set<string>()
    for (const [key, inner] of Object.entries(shape)) {
        const name = key.replace(/\?$/, "")
        known.add(name)
        if (!(name in record)) {
            if (!key.endsWith("?")) problems.push(`${at}.${name}: missing`)
            continue
        }
        problems.push(...misfits(record[name], inner, `${at}.${name}`))
    }
    for (const name of Object.keys(record)) if (!known.has(name)) problems.push(`${at}.${name}: not in the recording`)
    return problems
}

const shapes = recorded as unknown as Record<string, { method: string, endpoint: string, data: Shape, after?: Shape }>

describe("the transpiler script", () => {
    it("is the one the sources and the pinned version give", async () => {
        const script = path.resolve(__dirname, "../../../../scripts/bundle-transpiler.mjs")
        const { buildTranspilerFile, GENERATED } = await import(/* @vite-ignore */ script) as { buildTranspilerFile: () => Promise<string>, GENERATED: string }
        expect(readFileSync(GENERATED, "utf8")).toBe(await buildTranspilerFile())
    })
})

describe("loading extensions of each kind", () => {
    it("takes the types out inside the sandbox and makes the provider", async () => {
        const loader = new ExtensionLoader(place, async () => ({ memoryMb: 128, idleSeconds: 60 }))
        try {
            const stream = manifest("stream", "onlinestream-provider", "typescript", ONLINESTREAM_TS, { userConfig: USER_CONFIG })
            expect(await loader.call(stream, { baseUrl: "https://mirror.example" }, "search", { query: "dr. stone", dub: false })).toEqual([{ id: "one", title: "dr. stone", url: "https://mirror.example/one", subOrDub: "sub" }])
            expect(await loader.call(stream, { baseUrl: "https://mirror.example" }, "findEpisodeServer", { id: "one-1", number: 1, url: "https://x/1" }, "alpha")).toMatchObject({ server: "alpha" })
            expect(await loader.call(manifest("reader", "manga-provider", "typescript", MANGA_TS), {}, "search", { query: "dr. stone" })).toEqual([{ id: "m1", title: "dr. stone", synonyms: [], year: 2019, image: "", language: "en" }])
            expect(await loader.call(manifest("tracker", "anime-torrent-provider", "javascript", TORRENT_JS), {}, "getTorrentMagnetLink", { infoHash: "abc" })).toBe("magnet:?xt=urn:btih:abc")
            expect(await loader.call(manifest("source", "custom-source", "typescript", CUSTOM_SOURCE_TS), {}, "listAnime", "x", 2, 20)).toEqual({ media: [], page: 2, totalPages: 0, total: 0 })
            // the transpiler leaves no global behind
            expect(await loader.use(stream, { baseUrl: "https://mirror.example" }, sandbox => sandbox.call("eval", "typeof __seanimeTranspile"))).toBe("undefined")
            expect(loader.openCount).toBe(4)
        }
        finally {
            await loader.closeAll()
        }
    })

    it("does not touch code that is JavaScript already", () => {
        expect(loadScriptOf(manifest("x", "manga-provider", "javascript", "class Provider {}") as never)).toBe("class Provider {}\n;globalThis.__extension = new Provider();")
    })

    it("closes an idle sandbox, opens a new one for other settings and after a limit", async () => {
        let idle: (() => void) | null = null
        const timers = { set: (work: () => void) => (idle = work), clear: () => undefined }
        const loader = new ExtensionLoader(place, async () => ({ memoryMb: 16, idleSeconds: 1 }), timers)
        const greedy = manifest("greedy", "manga-provider", "javascript", `class Provider {
            getSettings() { return { supportsMultiScanlator: false, supportsMultiLanguage: false } }
            hog() { const all = []; for (;;) all.push(new Array(100000).fill("x")) }
        }`)
        await loader.call(greedy, {}, "getSettings")
        expect(loader.openCount).toBe(1)
        idle!()
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(loader.openCount).toBe(0)
        const failure = await loader.call(greedy, {}, "hog").catch((error: unknown) => error)
        expect(failure).toBeInstanceOf(SandboxError)
        expect((failure as SandboxError).kind).toBe("memory")
        expect(loader.openCount).toBe(0)
        expect(await loader.call(greedy, {}, "getSettings")).toEqual({ supportsMultiScanlator: false, supportsMultiLanguage: false })
        await loader.closeAll()
    })
})

describe("the interfaces, in the form of the recordings", () => {
    it("lists the installed extensions", async () => {
        const all = await ask("POST", "/api/v1/extensions/all", { withUpdates: false }) as Record<string, unknown>
        // an extension, also a switched-off one, has the fields of the recording's six (which fields are optional shows across them)
        const item = (shapes.GetAllExtensions.data as Record<string, Shape>).extensions
        expect(misfits(all.extensions, item)).toEqual([])
        expect(misfits(all.disabledExtensions, item)).toEqual([])
        expect(Object.keys(all).sort()).toEqual(Object.keys(shapes["GetAllExtensions.withDisabled"].data).sort())
        expect((all.extensions as { id: string }[]).map(extension => extension.id)).toEqual(["reader", "source", "stream", "tracker"])
        expect((all.disabledExtensions as { id: string }[]).map(extension => extension.id)).toEqual(["off"])
        expect((all.extensions as { payload: string }[]).every(extension => extension.payload === "")).toBe(true)
        expect(all.invalidExtensions).toMatchObject([{ id: "broken-file", path: "extensions/broken-file.json", code: "invalid_manifest" }])
        // the server had saved settings of this version: nothing to configure
        expect(all.invalidUserConfigExtensions).toEqual([])
        const list = await ask("GET", "/api/v1/extensions/list")
        expect(misfits(list, shapes.ListExtensionData.data)).toEqual([])
        delete cache["extension-settings"]
        const without = await ask("POST", "/api/v1/extensions/all", { withUpdates: false })
        expect(misfits({ ...without as object, invalidExtensions: [] }, shapes.GetAllExtensions.data)).toEqual([])
    })

    it("lists each kind with what its getSettings() says", async () => {
        const torrent = await ask("GET", "/api/v1/extensions/list/anime-torrent-provider")
        expect(misfits(torrent, shapes.ListAnimeTorrentProviderExtensions.data)).toEqual([])
        expect(torrent).toEqual([{ id: "tracker", name: "Test tracker", lang: "en", settings: { canSmartSearch: true, smartSearchFilters: ["batch", "episodeNumber", "query"], supportsAdult: false, type: "main" } }])
        const manga = await ask("GET", "/api/v1/extensions/list/manga-provider")
        expect(misfits(manga, shapes.ListMangaProviderExtensions.data)).toEqual([])
        expect((manga as { id: string }[]).map(item => item.id)).toEqual(["reader"])
        const stream = await ask("GET", "/api/v1/extensions/list/onlinestream-provider")
        expect(misfits(stream, shapes.ListOnlinestreamProviderExtensions.data)).toEqual([])
        expect(stream).toEqual([{ id: "stream", name: "Test stream", lang: "en", episodeServers: ["alpha", "beta"], supportsDub: true }])
        expect(await ask("GET", "/api/v1/extensions/list/custom-source")).toEqual([{ id: "source", extensionIdentifier: 7, name: "Test source", lang: "en", settings: { supportsAnime: true, supportsManga: false } }])
        expect(openExtensionSandboxes(place)).toBe(4)
    })

    it("lists code that does not load as invalid, until it is reloaded", async () => {
        files.set("crash.json", JSON.stringify(manifest("crash", "onlinestream-provider", "typescript", BROKEN_TS)))
        expect((await ask("GET", "/api/v1/extensions/list/onlinestream-provider") as { id: string }[]).map(item => item.id)).toEqual(["stream"])
        const all = await ask("POST", "/api/v1/extensions/all", { withUpdates: false }) as { invalidExtensions: { id: string, code: string, reason: string }[], extensions: { id: string }[] }
        expect(all.invalidExtensions.find(entry => entry.id === "crash")).toMatchObject({ code: "invalid_payload", reason: expect.stringContaining("cannot start") })
        expect(all.extensions.map(extension => extension.id)).not.toContain("crash")
        expect(await ask("POST", "/api/v1/extensions/external/reload", { id: "crash" })).toBe(true)
        const again = await ask("POST", "/api/v1/extensions/all", { withUpdates: false }) as { extensions: { id: string }[] }
        expect(again.extensions.map(extension => extension.id)).toContain("crash")
    })

    it("gives the code and the settings, takes the server's saved settings over once and saves new ones in its own database", async () => {
        const payload = await ask("GET", "/api/v1/extensions/payload/stream")
        expect(misfits(payload, shapes["GetExtensionPayload.dkb"].data)).toEqual([])
        expect(payload).toBe(ONLINESTREAM_TS)
        const config = await ask("GET", "/api/v1/extensions/user-config/stream")
        expect(config).toEqual({ userConfig: USER_CONFIG, savedUserConfig: { version: 2, values: { baseUrl: "https://mirror.example", greeting: "hello" } } })
        expect(misfits((config as { userConfig: unknown }).userConfig, (shapes["GetExtensionUserConfig.aq-anikoto"].data as Record<string, Shape>).userConfig)).toEqual([])
        const none = await ask("GET", "/api/v1/extensions/user-config/tracker")
        expect(misfits(none, shapes["GetExtensionUserConfig.dkb"].data)).toEqual([])
        // taken over: the server's file is not asked again
        delete cache.ext_user_config_stream
        expect(await ask("GET", "/api/v1/extensions/user-config/stream")).toMatchObject({ savedUserConfig: { version: 2 } })
        const saved = await ask("POST", "/api/v1/extensions/user-config", { id: "stream", version: 2, values: { greeting: "hallo" } })
        expect(misfits(saved, shapes.SaveExtensionUserConfig.data)).toEqual([])
        const after = await ask("GET", "/api/v1/extensions/user-config/stream") as { savedUserConfig: unknown }
        expect(after.savedUserConfig).toEqual({ version: 2, values: { greeting: "hallo" } })
        expect(misfits({ userConfig: { version: 1, requiresConfig: false, fields: [{ type: "text", name: "greeting", label: "Greeting", default: "hi" }] }, savedUserConfig: after.savedUserConfig }, shapes.SaveExtensionUserConfig.after!)).toEqual([])
        const rows = await (await environment.database()).select().from(extensionUserConfigs)
        expect(rows.map(row => [row.id, row.origin])).toEqual([["stream", "core"], ["tracker", "server"]])
        // the sandbox is opened again with the new values: the field left out falls back to its default
        const found = await ask("GET", "/api/v1/extensions/list/onlinestream-provider")
        expect(found).toHaveLength(1)
        await expect(ask("GET", "/api/v1/extensions/payload/nothing")).rejects.toThrow("extension not found")
    })

    it("needs settings when the extension requires them and none of its version are saved", async () => {
        delete cache.ext_user_config_stream
        const all = await ask("POST", "/api/v1/extensions/all", { withUpdates: false }) as { invalidUserConfigExtensions: unknown[] }
        expect(all.invalidUserConfigExtensions).toMatchObject([{ id: "stream", code: "user_config_error" }])
    })

    it("reads the marketplace with the fields of the recording", async () => {
        web[DEFAULT_MARKETPLACE_URL] = JSON.stringify([{ ...manifest("market", "manga-provider", "typescript", "code"), payloadURI: "https://ext.example/market.ts", userConfig: USER_CONFIG }])
        const market = await ask("GET", "/api/v1/extensions/marketplace")
        expect(misfits(market, shapes.GetMarketplaceExtensions.data)).toEqual([])
        expect(market).toEqual([{ ...manifest("market", "manga-provider", "typescript", "") }])
        web["https://repo.example/list.json"] = "[]"
        expect(await ask("GET", "/api/v1/extensions/marketplace?marketplace=x", null, { marketplace: "https://repo.example/list.json" })).toEqual([])
        await expect(ask("GET", "/api/v1/extensions/marketplace", null, { marketplace: "file:///x" })).rejects.toThrow("http")
    })

    it("checks for updates and keeps the last result", async () => {
        expect(misfits(await ask("GET", "/api/v1/extensions/updates"), shapes.GetExtensionUpdateData.data)).toEqual([])
        web["https://ext.example/tracker/manifest.json"] = JSON.stringify(manifest("tracker", "anime-torrent-provider", "javascript", TORRENT_JS, { version: "1.1.0" }))
        web["https://ext.example/reader/manifest.json"] = JSON.stringify(manifest("reader", "manga-provider", "typescript", MANGA_TS))
        const all = await ask("POST", "/api/v1/extensions/all", { withUpdates: true }) as { hasUpdate: unknown }
        expect(all.hasUpdate).toEqual([{ extensionID: "tracker", manifestURI: "https://ext.example/tracker/manifest.json", version: "1.1.0", payload: TORRENT_JS }])
        expect(await ask("GET", "/api/v1/extensions/updates")).toEqual(all.hasUpdate)
    })

    it("keeps the sandbox limits as a setting", async () => {
        await setSandboxSettings(await environment.database(), { memoryMb: 128, idleSeconds: 30 }, 1000)
        await expect(setSandboxSettings(await environment.database(), { memoryMb: 1, idleSeconds: 30 }, 1000)).rejects.toThrow("out of range")
    })
})

describe("installing, updating and uninstalling on a test folder", () => {
    it("writes the manifest with its code in the server's format, after the code loaded", async () => {
        web["https://ext.example/fresh/manifest.json"] = JSON.stringify({ ...manifest("fresh", "manga-provider", "typescript", ""), payloadURI: "https://ext.example/fresh/code.ts" })
        web["https://ext.example/fresh/code.ts"] = MANGA_TS
        const answer = await installExtension(manageEnvironment(), "https://ext.example/fresh/manifest.json")
        expect(misfits(answer, shapes.InstallExternalExtension.data)).toEqual([])
        expect(answer).toEqual({ message: "Successfully installed Test fresh" })
        const written = JSON.parse(files.get("fresh.json")!) as Record<string, unknown>
        expect(written).toMatchObject({ id: "fresh", payload: MANGA_TS, payloadURI: "https://ext.example/fresh/code.ts", language: "typescript" })
        expect((await ask("GET", "/api/v1/extensions/list") as { id: string }[]).map(item => item.id)).toContain("fresh")
        expect(openExtensionSandboxes(place)).toBe(0)

        web["https://ext.example/fresh/manifest.json"] = JSON.stringify(manifest("fresh", "manga-provider", "typescript", BROKEN_TS, { version: "2.0.0" }))
        await expect(updateExtension(manageEnvironment(), "fresh")).rejects.toThrow("failed to load extension code")
        expect(JSON.parse(files.get("fresh.json")!)).toMatchObject({ version: "1.0.0" })
        web["https://ext.example/fresh/manifest.json"] = JSON.stringify(manifest("fresh", "manga-provider", "typescript", MANGA_TS.replace("m1", "m2"), { version: "2.0.0" }))
        expect(await updateExtension(manageEnvironment(), "fresh")).toEqual({ message: "Successfully updated Test fresh" })
        expect(JSON.parse(files.get("fresh.json")!)).toMatchObject({ version: "2.0.0" })

        const removed = await uninstallExtension(manageEnvironment(), "fresh")
        expect(misfits(removed, shapes["UninstallExternalExtension.probe"].data)).toEqual([])
        expect(files.has("fresh.json")).toBe(false)
        await expect(uninstallExtension(manageEnvironment(), "local-manga")).rejects.toThrow("extension not found")
        await expect(uninstallExtension(manageEnvironment(), "fresh")).rejects.toThrow("extension not found")
        // a file that is not valid can be removed too
        expect(await uninstallExtension(manageEnvironment(), "broken-file")).toBe(true)
        expect(files.has("broken-file.json")).toBe(false)
    })

    it("does not install code that does not load, nor plugins", async () => {
        web["https://ext.example/bad/manifest.json"] = JSON.stringify(manifest("bad", "onlinestream-provider", "typescript", BROKEN_TS))
        await expect(installExtension(manageEnvironment(), "https://ext.example/bad/manifest.json")).rejects.toThrow("cannot start")
        expect(files.has("bad.json")).toBe(false)
        web["https://ext.example/plug/manifest.json"] = JSON.stringify(manifest("plug", "plugin", "typescript", "x", { plugin: { version: "1", permissions: { allow: { networkAccess: {} } } } }))
        await expect(installExtension(manageEnvironment(), "https://ext.example/plug/manifest.json")).rejects.toThrow("plugins")
    })
})

describe("the changing interfaces, in the form of the recordings (phase 3e-2)", () => {

    beforeEach(() => {
    })

    function ids(list: unknown): string[] {
        return (list as { id: string }[]).map(item => item.id)
    }

    it("installs, lists without opening a sandbox again, and tells the server", async () => {
        web["https://ext.example/fresh/manifest.json"] = JSON.stringify(manifest("fresh", "anime-torrent-provider", "javascript", TORRENT_JS))
        // events of earlier tests are sent first
        await new Promise(resolve => setTimeout(resolve, 0))
        const heard: string[] = []
        const stop = onCoreEvent(event => heard.push(event.type))
        const answer = await ask("POST", "/api/v1/extensions/external/install", { manifestUri: "https://ext.example/fresh/manifest.json" })
        await new Promise(resolve => setTimeout(resolve, 0))
        stop()
        // the screens read the lists again, as after the server's own event
        expect(heard).toEqual(["extensions-reloaded"])
        expect(misfits(answer, shapes.InstallExternalExtension.data)).toEqual([])
        expect(JSON.parse(files.get("fresh.json")!)).toMatchObject({ id: "fresh", payload: TORRENT_JS })
        // the trial gave the settings: the list needs no sandbox for the new one
        expect(openExtensionSandboxes(place)).toBe(0)
        const torrents = await ask("GET", "/api/v1/extensions/list/anime-torrent-provider") as { id: string, settings: unknown }[]
        expect(torrents.find(item => item.id === "fresh")?.settings).toEqual(torrents.find(item => item.id === "tracker")?.settings)
        expect(openExtensionSandboxes(place)).toBe(1)
    })

    it("lists from the database after the app started again, without a sandbox", async () => {
        const first = await ask("GET", "/api/v1/extensions/list/onlinestream-provider")
        await closeExtensionSandboxes(place)
        let opened = 0
        const again: ExtensionPlace = { ...place, engine: async () => (opened++, nodeSandboxEngine) }
        environment.extensions = async () => again
        expect(await ask("GET", "/api/v1/extensions/list/onlinestream-provider")).toEqual(first)
        expect(opened).toBe(0)
        // other code: asked again
        files.set("stream.json", JSON.stringify(manifest("stream", "onlinestream-provider", "typescript", ONLINESTREAM_TS.replace("\"beta\"", "\"gamma\""), { userConfig: USER_CONFIG })))
        const changed = await ask("GET", "/api/v1/extensions/list/onlinestream-provider") as { episodeServers: string[] }[]
        expect(changed[0].episodeServers).toEqual(["alpha", "gamma"])
        expect(opened).toBe(1)
        await closeExtensionSandboxes(again)
    })

    it("asks getSettings() again when the server changed the files while the area was off", async () => {
        await ask("GET", "/api/v1/extensions/list/onlinestream-provider")
        await closeExtensionSandboxes(place)
        let opened = 0
        const again: ExtensionPlace = { ...place, engine: async () => (opened++, nodeSandboxEngine) }
        environment.extensions = async () => again
        const codeKey = async () => (await (await environment.database()).select().from(extensionSettings)).find(row => row.id === "stream")?.codeKey
        const first = await codeKey()
        await ask("GET", "/api/v1/extensions/list/onlinestream-provider")
        expect(opened).toBe(0)
        // the server wrote the same code again, in its own layout: the file changed, getSettings() is asked again
        files.set("stream.json", JSON.stringify(JSON.parse(files.get("stream.json")!), null, 2))
        await ask("GET", "/api/v1/extensions/list/onlinestream-provider")
        expect(opened).toBe(1)
        const second = await codeKey()
        expect(second).not.toBe(first)
        // the server saved the user's settings of the extension: asked again as well
        cache["ext_user_config_stream"] = cache["ext_user_config_stream"].replace("2026-01-01", "2026-02-01")
        await ask("GET", "/api/v1/extensions/list/onlinestream-provider")
        expect(await codeKey()).not.toBe(second)
        // nothing changed: from memory
        const third = await codeKey()
        await ask("GET", "/api/v1/extensions/list/onlinestream-provider")
        expect(await codeKey()).toBe(third)
        await closeExtensionSandboxes(again)
    })

    it("counts the screens' work during a file read as theirs, not the core's", async () => {
        const pieces: number[] = []
        const watch = createBlockingWatch({ now: () => performance.now(), onPiece: milliseconds => void pieces.push(milliseconds), free: () => new Promise(resolve => setTimeout(resolve, 0)) })
        // a file is read on another thread for 20 ms; meanwhile the screens run for 15 ms
        const slow: ExtensionPlace = { ...place, folder: { ...place.folder, read: name => new Promise(resolve => setTimeout(() => resolve(files.get(name) ?? null), 20)) } }
        async function longestPiece(where: ExtensionPlace, joining = false) {
            // another request started the read already: this one joins it
            const other = joining ? readInstalled(where) : null
            if (joining) await new Promise(resolve => setTimeout(resolve, 1))
            pieces.length = 0
            const screens = new Promise<void>(resolve => setTimeout(() => {
                const end = performance.now() + 15
                while (performance.now() < end) { /* the screens' work */ }
                resolve()
            }, 5))
            watch.enter("list")
            try {
                await readInstalled(where)
            }
            finally {
                watch.leave()
            }
            await Promise.all([screens, other])
            return Math.max(...pieces)
        }
        // without the waits seen, the core's piece stays open over the read and takes in the screens' 15 ms
        expect(await longestPiece(slow)).toBeGreaterThan(15)
        expect(await longestPiece(placeWithWaits(slow, watch.waiting))).toBeLessThan(8)
        expect(await longestPiece({ ...slow, folder: placeWithWaits(slow, watch.waiting).folder }, true)).toBeGreaterThan(15)
        expect(await longestPiece(placeWithWaits(slow, watch.waiting), true)).toBeLessThan(8)
    })

    it("sees closing a sandbox that is still being opened as a wait (3f-2: 1150 ms at the S22)", async () => {
        const pieces: number[] = []
        const watch = createBlockingWatch({ now: () => performance.now(), onPiece: milliseconds => void pieces.push(milliseconds), free: () => new Promise(resolve => setTimeout(resolve, 0)) })
        // opening takes 30 ms on another thread; meanwhile the screens run for 15 ms
        const slow: ExtensionPlace = { ...place, engine: () => new Promise(resolve => setTimeout(() => void place.engine().then(resolve), 30)) }
        async function closingPiece(where: ExtensionPlace) {
            const loader = new ExtensionLoader(where, async () => ({ memoryMb: 128, idleSeconds: 60 }))
            const stream = manifest("stream", "onlinestream-provider", "typescript", ONLINESTREAM_TS, { userConfig: USER_CONFIG })
            const using = loader.use(stream, { baseUrl: "https://mirror.example" }, async () => 1)
            const screens = new Promise<void>(resolve => setTimeout(() => {
                const end = performance.now() + 15
                while (performance.now() < end) { /* the screens' work */ }
                resolve()
            }, 5))
            pieces.length = 0
            watch.enter("close")
            try {
                await loader.close("stream")
            }
            finally {
                watch.leave()
            }
            await Promise.all([screens, using.catch(() => undefined)])
            await loader.closeAll()
            return Math.max(...pieces)
        }
        expect(await closingPiece(slow)).toBeGreaterThan(15)
        expect(await closingPiece(placeWithWaits(slow, watch.waiting))).toBeLessThan(8)
    })

    it("reads the folder once for lists asked at the same time", async () => {
        let reads = 0
        const counted: ExtensionPlace = { ...place, folder: { ...place.folder, read: async (name: string) => (reads++, place.folder.read(name)) } }
        await Promise.all([readInstalled(counted), readInstalled(counted), readInstalled(counted)])
        expect(reads).toBe(6)
    })

    it("lets the thread go between the manifests of the folder (3f-4)", async () => {
        const parts: (string | undefined)[] = []
        const pausing: ExtensionPlace = { ...place, pause: async part => void parts.push(part) }
        const read = await readInstalled(pausing)
        expect(parts).toEqual(Array.from({ length: 6 }, () => "manifests"))
        expect(read.extensions.length + read.disabled.length + read.invalid.length).toBeGreaterThan(0)
    })

    it("checks a large manifest once while its file stays the same (3g)", async () => {
        // a provider with a large bundled script: parsing its manifest is one step that cannot be cut
        const code = `class Provider { getSettings() { return { episodeServers: [], supportsDub: false } } }\n${"const row = \"<a href=\\\"/x\\\">Folge – 1</a>\";\n".repeat(300_000)}`
        files.set("zz-large.json", JSON.stringify(manifest("zz-large", "onlinestream-provider", "javascript", code)))
        try {
            const longestStep = async () => {
                const at: number[] = []
                const timed: ExtensionPlace = { ...place, pause: async () => void at.push(performance.now()) }
                const read = await readInstalled(timed)
                at.push(performance.now())
                expect(read.extensions.some(extension => extension.id === "zz-large" && extension.payload === code)).toBe(true)
                return Math.max(...at.slice(1).map((time, index) => time - at[index]!))
            }
            const first = await longestStep()
            const again = await longestStep()
            expect(first).toBeGreaterThan(LONGEST_PIECE_MS)
            expect(again).toBeLessThan(LONGEST_PIECE_MS)
        }
        finally {
            files.delete("zz-large.json")
        }
    })

    it("previews and installs a repository", async () => {
        web["https://ext.example/repo.json"] = JSON.stringify({ name: "Test repository", urls: ["https://ext.example/a/manifest.json", "https://ext.example/b/manifest.json", "https://ext.example/gone/manifest.json"] })
        web["https://ext.example/a/manifest.json"] = JSON.stringify({ ...manifest("repo-a", "onlinestream-provider", "javascript", ""), payloadURI: "https://ext.example/a/code.js", userConfig: { version: 1, requiresConfig: false, fields: [{ type: "text", name: "greeting", label: "Greeting", default: "hi" }] } })
        web["https://ext.example/a/code.js"] = "class Provider { getSettings() { return { episodeServers: [], supportsDub: false } } }"
        web["https://ext.example/b/manifest.json"] = JSON.stringify(manifest("repo-b", "onlinestream-provider", "typescript", BROKEN_TS))
        const preview = await ask("POST", "/api/v1/extensions/external/install-repository", { repositoryUri: "https://ext.example/repo.json", install: false }) as { extensions: unknown[], message: string }
        expect(misfits(preview, shapes["InstallExternalExtensionRepository.preview"].data)).toEqual([])
        expect(preview.message).toBe("Successfully fetched 2 extensions from the repository")
        expect(files.has("repo-a.json")).toBe(false)
        const installed = await ask("POST", "/api/v1/extensions/external/install-repository", { repositoryUri: "https://ext.example/repo.json", install: true }) as { extensions: unknown[], message: string }
        expect(misfits(installed, shapes["InstallExternalExtensionRepository.install"].data)).toEqual([])
        // the one whose code does not load is left out
        expect([ids(installed.extensions), installed.message]).toEqual([["repo-a"], "Successfully installed 1 extensions from the repository"])
        expect(files.has("repo-a.json") && !files.has("repo-b.json")).toBe(true)
        await expect(ask("POST", "/api/v1/extensions/external/install-repository", { repositoryUri: "file:///repo.json", install: true })).rejects.toThrow("http")
    })

    it("saves edited code in the same file and lists code that does not load as invalid", async () => {
        const before = JSON.parse(files.get("tracker.json")!) as Record<string, unknown>
        const edited = `${TORRENT_JS}\n// edited`
        const answer = await ask("POST", "/api/v1/extensions/external/edit-payload", { id: "tracker", payload: edited })
        expect(misfits(answer, shapes.UpdateExtensionCode.data)).toEqual([])
        expect(JSON.parse(files.get("tracker.json")!)).toEqual({ ...before, payload: edited })
        expect(await ask("GET", "/api/v1/extensions/payload/tracker")).toBe(edited)

        await ask("POST", "/api/v1/extensions/external/edit-payload", { id: "tracker", payload: "class Provider { constructor() { throw new Error('no') } }" })
        expect(ids(await ask("GET", "/api/v1/extensions/list/anime-torrent-provider"))).not.toContain("tracker")
        const all = await ask("POST", "/api/v1/extensions/all", { withUpdates: false }) as { invalidExtensions: { id: string, code: string }[] }
        expect(all.invalidExtensions.find(item => item.id === "tracker")?.code).toBe("invalid_payload")
        await expect(ask("POST", "/api/v1/extensions/external/edit-payload", { id: "local-manga", payload: "x" })).rejects.toThrow("not found")
    })

    it("switches off and on in the server's file cache, in its format", async () => {
        const off = await ask("POST", "/api/v1/extensions/external/disabled", { id: "tracker", disabled: true })
        expect(misfits(off, shapes["SetExternalExtensionDisabled.disable"].data)).toEqual([])
        expect(JSON.parse(cache["extension-settings"])).toEqual({ 1: { value: { disabledExtensionIds: { off: true, tracker: true } }, updated_at: new Date(1000).toISOString() } })
        expect(ids(await ask("GET", "/api/v1/extensions/list"))).not.toContain("tracker")
        const all = await ask("POST", "/api/v1/extensions/all", { withUpdates: false }) as { disabledExtensions: unknown }
        expect(ids(all.disabledExtensions)).toEqual(["off", "tracker"])

        const on = await ask("POST", "/api/v1/extensions/external/disabled", { id: "tracker", disabled: false })
        expect(misfits(on, shapes["SetExternalExtensionDisabled.enable"].data)).toEqual([])
        expect((JSON.parse(cache["extension-settings"]) as Record<string, { value: unknown }>)[1].value).toEqual({ disabledExtensionIds: { off: true } })
        expect(ids(await ask("GET", "/api/v1/extensions/list"))).toContain("tracker")
        // without a file the server's form is written new
        delete cache["extension-settings"]
        await ask("POST", "/api/v1/extensions/external/disabled", { id: "tracker", disabled: true })
        expect(JSON.parse(cache["extension-settings"])).toEqual({ 1: { value: { disabledExtensionIds: { tracker: true } }, updated_at: new Date(1000).toISOString() } })
        await expect(ask("POST", "/api/v1/extensions/external/disabled", { id: "nothing", disabled: true })).rejects.toThrow("not found")
    })

    it("uninstalls, and the server is not needed", async () => {
        const removed = await ask("POST", "/api/v1/extensions/external/uninstall", { id: "tracker" })
        expect(misfits(removed, shapes["UninstallExternalExtension.probe"].data)).toEqual([])
        expect(files.has("tracker.json")).toBe(false)
        expect(ids(await ask("GET", "/api/v1/extensions/list"))).not.toContain("tracker")
    })
})
