// geschrieben nach: Aufzeichnungen ONLINESTREAM.* vom 13.11.2026 (nur die Form, onlinestream.recorded.json), dem Vertrag onlinestream-provider.d.ts und docs/EIGENER-KERN.md §4m; kein Server-Quelltext

import { beforeEach, describe, expect, it } from "vitest"
import { sqlDriverFor } from "@/api/client/core-database"
import { forgetDatabases, openDatabaseSync } from "../../../test/expo-sqlite"
import type { HttpFetch } from "../anilist/client"
import { type CoreDatabase, openCoreDatabase } from "../database/database"
import { onlinestreamMappings } from "../database/schema"
import type { ExtensionPlace } from "../extensions/manage/installed"
import { closeExtensionSandboxes } from "../extensions/manage/manage"
import { nodeSandboxEngine } from "../extensions/sandbox/node-engine"
import { type CoreEnvironment, matchCoreRoute } from "../registry"
import { chooseEntry, cleanTitle, likeness, type Found, type StreamMedia } from "./choose"
import { SandboxError } from "../extensions/sandbox/sandbox"
import { CoreError } from "../errors"
import { EPISODES_KEEP_MS, NEEDS_USER_TEXT, failureOf, forgetStreamCache, keptStreamAnswers } from "./onlinestream"
import recorded from "./onlinestream.recorded.json"

/* A provider after the contract, with made-up values: it logs each call, so that the tests see what the core asked. */
const PROVIDER_TS = `/// <reference path="./onlinestream-provider.d.ts" />
const TITLES: [string, SubOrDub][] = [["Dr. Stone", "both"], ["Dr. Stone: Ryuusui", "both"], ["Dr. Stone: New World", "both"],
    ["Dr. Stone: New World Part 2", "sub"], ["Dr. Stone 3rd Season Part 2", "both"], ["Swan", "sub"]]
class Provider {
    getSettings(): Settings {
        return { episodeServers: ["first", "empty", "second", "down"], supportsDub: true }
    }
    async search(opts: SearchOptions): Promise<SearchResult[]> {
        console.log("search " + opts.query + " " + opts.dub + " " + opts.media.id + " " + (opts.year ?? "-"))
        if (opts.query === "nothing") return []
        return TITLES.map(([title, kind], index) => ({ id: "entry-" + index, title, url: "https://stream.example/" + index, subOrDub: kind }))
    }
    async findEpisodes(id: string): Promise<EpisodeDetails[]> {
        console.log("findEpisodes " + id)
        if (id === "broken") throw new Error("the site changed")
        const list: EpisodeDetails[] = []
        for (let number = 24; number >= 1; number--) list.push({ id: id + "/" + number, number, url: "https://stream.example/" + id + "/" + number })
        list.push({ id: id + "/dup", number: 3, url: "https://stream.example/dup" })
        return list
    }
    async findEpisodeServer(episode: EpisodeDetails, server: string): Promise<EpisodeServer> {
        console.log("findEpisodeServer " + episode.id + " " + server)
        if (server === "down" || (episode.number === 5 && server !== "empty")) throw new Error(server + " server is down")
        if (server === "first" && episode.number === 2) throw new Error("first server is down")
        if (server === "empty") return { server: "Empty Server", headers: {}, videoSources: [] }
        return {
            server: server === "first" ? "First Server" : "Second Server",
            headers: { Referer: "https://stream.example/" },
            videoSources: [{ url: "https://cdn.example/" + episode.id + ".m3u8", type: "m3u8", quality: "auto",
                subtitles: [{ id: "en", url: "https://cdn.example/en.vtt", language: "English", isDefault: true }] }],
        }
    }
}`

type Shape = string | Shape[] | { [key: string]: Shape }

function kindOf(value: unknown): string {
    if (value === null) return "null"
    if (Array.isArray(value)) return "array"
    return typeof value
}

/** Where `value` does not have the recorded form: every recorded field with its kind, no field more */
function differences(shape: Shape, value: unknown, at = "data"): string[] {
    if (typeof shape === "string") return kindOf(value) === shape ? [] : [`${at}: ${kindOf(value)} instead of ${shape}`]
    if (Array.isArray(shape)) {
        if (!Array.isArray(value)) return [`${at}: ${kindOf(value)} instead of array`]
        if (shape.length === 0 || value.length === 0) return shape.length === value.length ? [] : [`${at}: empty`]
        return differences(shape[0], value[0], `${at}[0]`)
    }
    if (kindOf(value) !== "object") return [`${at}: ${kindOf(value)} instead of object`]
    const object = value as Record<string, unknown>
    const found = Object.keys(shape).flatMap(key => (key in object ? differences(shape[key], object[key], `${at}.${key}`) : [`${at}.${key}: missing`]))
    return [...found, ...Object.keys(object).filter(key => !(key in shape)).map(key => `${at}.${key}: not recorded`)]
}

/** A made-up value of a recorded form */
function madeUp(shape: Shape): unknown {
    if (shape === "string") return "x"
    if (shape === "number") return 1
    if (shape === "boolean") return false
    if (shape === "null") return null
    if (shape === "object") return {}
    if (Array.isArray(shape)) return shape.length === 0 ? [] : [madeUp(shape[0])]
    if (typeof shape === "string") return null
    return Object.fromEntries(Object.entries(shape).map(([key, part]) => [key, madeUp(part)]))
}

const answers = recorded.answers as Record<string, { method?: string, endpoint?: string, requestFields?: string[], data: Shape }>
const LIST_FORM = answers["GetOnlineStreamEpisodeList.kaa"].data as { [key: string]: Shape }

/** The anime as the server's page answer has it: made up after the recorded form */
function madeUpMedia(): Record<string, unknown> {
    return {
        ...(madeUp(LIST_FORM.media) as Record<string, unknown>),
        id: 105333,
        title: { english: "Dr. STONE", native: "x", romaji: "Dr. STONE", userPreferred: "Dr. STONE" },
        synonyms: ["Dcst"],
        episodes: 24,
        format: "TV",
        startDate: { day: 5, month: 7, year: 2019 },
    }
}


let files: Map<string, string>
let place: ExtensionPlace
let database: Promise<CoreDatabase> | null
let environment: CoreEnvironment
let now: number
let calls: string[]
let serverMappingReads: number
let serverRows: { provider: string, mediaId: number, animeId: string }[] | null
let anilist: Record<string, unknown> | null

const httpFetch: HttpFetch = async url => {
    if (url.startsWith("https://graphql.anilist.co") && anilist) return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ data: anilist }) }
    throw new TypeError("Network request failed")
}

beforeEach(async () => {
    if (place) await closeExtensionSandboxes(place)
    forgetDatabases()
    forgetStreamCache()
    now = 1_000_000
    calls = []
    serverMappingReads = 0
    serverRows = [{ provider: "stream", mediaId: 21, animeId: "from-server" }, { provider: "", mediaId: 22, animeId: "no-provider" }]
    anilist = { Media: madeUpMedia() }
    files = new Map([["stream.json", JSON.stringify({
        id: "stream", name: "Test stream", version: "1.0.0", manifestURI: "https://ext.example/stream/manifest.json", language: "typescript",
        type: "onlinestream-provider", description: "", author: "tester", icon: "", website: "", readme: "", lang: "en", payload: PROVIDER_TS,
    })]])
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
        serverMappings: async () => {
            serverMappingReads++
            return serverRows
        },
        engine: async () => nodeSandboxEngine,
        fetch: async url => {
            throw new TypeError(`no network in tests: ${url}`)
        },
        log: (_id, _level, text) => void calls.push(text),
    }
    database = null
    environment = {
        fetch: httpFetch,
        secret: async () => "token",
        database: () => database ??= openCoreDatabase(sqlDriverFor(openDatabaseSync("core.db") as never), () => now),
        now: () => now,
        pause: async () => undefined,
        extensions: async () => place,
    }
})

async function ask(method: string, endpoint: string, body: unknown): Promise<unknown> {
    const match = matchCoreRoute(method, endpoint)
    expect(match?.route.area, `${method} ${endpoint}`).toBe("streams")
    return match!.route.answer({ path: match!.path, query: null, body }, environment)
}

const LIST = { mediaId: 105333, dubbed: false, provider: "stream" }

describe("online stream answers against the recorded form", () => {
    it("registers the seven interfaces with the recorded method and address, area streams", () => {
        for (const name of ["GetOnlineStreamEpisodeList.kaa", "GetOnlineStreamEpisodeSource.kaa", "GetOnlinestreamMapping.kaa", "OnlinestreamManualSearch.kaa", "OnlinestreamManualMapping", "RemoveOnlinestreamMapping", "OnlineStreamEmptyCache"]) {
            const { method, endpoint } = answers[name]
            expect(matchCoreRoute(method!, endpoint!)?.route.area, name).toBe("streams")
        }
    })

    it("episode source: the sources of all servers in the settings' order, empty and failing servers left out; in the recorded form", async () => {
        const one = await ask("POST", "/api/v1/onlinestream/episode-source", { episodeNumber: 1, mediaId: 105333, provider: "stream", dubbed: false }) as { videoSources: { server: string }[] }
        expect(differences(answers["GetOnlineStreamEpisodeSource.kaa"].data, one)).toEqual([])
        expect(differences(answers["GetOnlineStreamEpisodeSource.aq-anikoto"].data, one)).toEqual([])
        expect(one).toMatchObject({ number: 1, servers: [{ server: "First Server", status: "available" }, { server: "Second Server", status: "available" }] })
        expect(one.videoSources.map(source => source.server)).toEqual(["First Server", "Second Server"])
        expect(calls.filter(call => call.startsWith("findEpisodeServer"))).toEqual(["first", "empty", "second", "down"].map(server => "findEpisodeServer entry-0/1 " + server))
        const two = await ask("POST", "/api/v1/onlinestream/episode-source", { episodeNumber: 2, mediaId: 105333, provider: "stream", dubbed: false }) as Record<string, unknown>
        expect(two.servers).toEqual([{ server: "Second Server", status: "available" }])
        // no server with sources: the first error comes back
        await expect(ask("POST", "/api/v1/onlinestream/episode-source", { episodeNumber: 5, mediaId: 105333, provider: "stream", dubbed: false })).rejects.toThrow("first server is down")
        await expect(ask("POST", "/api/v1/onlinestream/episode-source", { episodeNumber: 99, mediaId: 105333, provider: "stream", dubbed: false })).rejects.toThrow("episode 99 not found")
    })

    it("manual search: the provider's results unchosen, in the recorded form", async () => {
        const found = await ask("POST", "/api/v1/onlinestream/search", { provider: "stream", query: "dr. stone", dubbed: false }) as Found[]
        expect(differences(answers["OnlinestreamManualSearch.kaa"].data, found)).toEqual([])
        expect(found).toHaveLength(6)
        expect(calls).toEqual(["search dr. stone false 0 -"])
    })

    it("mapping: none, set by hand (used by the list), removed; answers in the recorded form", async () => {
        const none = await ask("POST", "/api/v1/onlinestream/get-mapping", { provider: "stream", mediaId: 105333 })
        expect(differences(answers["GetOnlinestreamMapping.kaa"].data, none)).toEqual([])
        expect(await ask("POST", "/api/v1/onlinestream/manual-mapping", { provider: "stream", mediaId: 105333, animeId: "by-hand" })).toBe(true)
        const set = await ask("POST", "/api/v1/onlinestream/get-mapping", { provider: "stream", mediaId: 105333 })
        expect(differences(answers["GetOnlinestreamMapping.after-manual-mapping"].data, set)).toEqual([])
        await ask("POST", "/api/v1/onlinestream/episode-list", LIST)
        expect(calls).toEqual(["findEpisodes by-hand"])
        expect(await ask("POST", "/api/v1/onlinestream/remove-mapping", { provider: "stream", mediaId: 105333 })).toBe(true)
        expect(await ask("POST", "/api/v1/onlinestream/get-mapping", { provider: "stream", mediaId: 105333 })).toEqual({ animeId: null })
        expect(differences(answers.OnlinestreamManualMapping.data, true)).toEqual([])
        expect(differences(answers.RemoveOnlinestreamMapping.data, true)).toEqual([])
    })

    it("errors: unknown provider, the extension's own error, missing fields", async () => {
        await expect(ask("POST", "/api/v1/onlinestream/episode-list", { ...LIST, provider: "none" })).rejects.toThrow("online stream provider not found: none")
        await ask("POST", "/api/v1/onlinestream/manual-mapping", { provider: "stream", mediaId: 105333, animeId: "broken" })
        await expect(ask("POST", "/api/v1/onlinestream/episode-list", LIST)).rejects.toThrow("stream: findEpisodes failed: the site changed")
        await expect(ask("POST", "/api/v1/onlinestream/episode-list", { provider: "stream" })).rejects.toThrow("mediaId is required")
    })
})

describe("the server's mappings, taken over once", () => {
    it("moves the valid rows once, read only; later changes stay in core.db", async () => {
        expect(await ask("POST", "/api/v1/onlinestream/get-mapping", { provider: "stream", mediaId: 21 })).toEqual({ animeId: "from-server" })
        expect(await ask("POST", "/api/v1/onlinestream/get-mapping", { provider: "stream", mediaId: 22 })).toEqual({ animeId: null })
        await ask("POST", "/api/v1/onlinestream/remove-mapping", { provider: "stream", mediaId: 21 })
        expect(await ask("POST", "/api/v1/onlinestream/get-mapping", { provider: "stream", mediaId: 21 })).toEqual({ animeId: null })
        expect(serverMappingReads).toBe(1)
        expect(serverRows).toHaveLength(2)
        const rows = await (await environment.database()).select().from(onlinestreamMappings)
        expect(rows).toEqual([])
    })

    it("a server without a database moves nothing and is not asked again", async () => {
        serverRows = null
        await ask("POST", "/api/v1/onlinestream/get-mapping", { provider: "stream", mediaId: 21 })
        await ask("POST", "/api/v1/onlinestream/manual-mapping", { provider: "stream", mediaId: 21, animeId: "mine" })
        const rows = await (await environment.database()).select().from(onlinestreamMappings)
        expect(rows.map(row => [row.animeId, row.origin])).toEqual([["mine", "core"]])
        expect(serverMappingReads).toBe(1)
    })
})

describe("what the core keeps", () => {
    it("keeps the episode list for its lifetime, empties it per anime, and the sources apart", async () => {
        await ask("POST", "/api/v1/onlinestream/episode-list", LIST)
        await ask("POST", "/api/v1/onlinestream/episode-list", LIST)
        await ask("POST", "/api/v1/onlinestream/episode-source", { episodeNumber: 1, mediaId: 105333, provider: "stream", dubbed: false })
        await ask("POST", "/api/v1/onlinestream/episode-source", { episodeNumber: 1, mediaId: 105333, provider: "stream", dubbed: false })
        expect(calls.filter(call => call.startsWith("findEpisodes"))).toHaveLength(1)
        expect(calls.filter(call => call.startsWith("findEpisodeServer"))).toHaveLength(4)
        await ask("POST", "/api/v1/onlinestream/episode-source", { episodeNumber: 1, mediaId: 105333, provider: "stream", dubbed: false, refresh: true })
        expect(calls.filter(call => call.startsWith("findEpisodeServer"))).toHaveLength(8)

        expect(await ask("DELETE", "/api/v1/onlinestream/cache", { mediaId: 105333 })).toBe(true)
        expect(differences(answers.OnlineStreamEmptyCache.data, true)).toEqual([])
        expect(keptStreamAnswers()).toBe(0)
        await ask("POST", "/api/v1/onlinestream/episode-list", LIST)
        expect(calls.filter(call => call.startsWith("findEpisodes"))).toHaveLength(2)

        now += EPISODES_KEEP_MS + 1
        await ask("POST", "/api/v1/onlinestream/episode-list", LIST)
        expect(calls.filter(call => call.startsWith("findEpisodes"))).toHaveLength(3)
    })

    it("Settings' cache bucket empties what the core keeps for every anime; an unknown bucket is refused", async () => {
        await ask("POST", "/api/v1/onlinestream/episode-list", LIST)
        expect(keptStreamAnswers()).toBeGreaterThan(0)
        expect(await ask("DELETE", "/api/v1/filecache/bucket", { bucket: "manga" })).toBe(true)
        expect(keptStreamAnswers()).toBeGreaterThan(0)
        expect(await ask("DELETE", "/api/v1/filecache/bucket", { bucket: "onlinestream" })).toBe(true)
        expect(keptStreamAnswers()).toBe(0)
        await expect(ask("DELETE", "/api/v1/filecache/bucket", { bucket: "other" })).rejects.toThrow(CoreError)
    })

    it("two requests at once share one run of the provider", async () => {
        await Promise.all([ask("POST", "/api/v1/onlinestream/episode-list", LIST), ask("POST", "/api/v1/onlinestream/episode-list", LIST)])
        expect(calls.filter(call => call.startsWith("findEpisodes"))).toHaveLength(1)
    })

    it("a failed run is not kept", async () => {
        await ask("POST", "/api/v1/onlinestream/manual-mapping", { provider: "stream", mediaId: 105333, animeId: "broken" })
        await expect(ask("POST", "/api/v1/onlinestream/episode-list", LIST)).rejects.toThrow()
        expect(keptStreamAnswers()).toBe(0)
    })
})

describe("choosing the provider's entry", () => {
    const stone: StreamMedia = { id: 105333, romajiTitle: "Dr. STONE", englishTitle: "Dr. STONE", synonyms: ["Dcst"], isAdult: false, startDate: { year: 2019 }, episodeCount: 24 }
    const found = (title: string, subOrDub: Found["subOrDub"] = "both", id = title): Found => ({ id, title, url: "", subOrDub })

    it("takes the recorded choice for both providers' result lists (titles as recorded, public)", () => {
        const anikoto = ["Dr. Stone", "Dr. Stone: Ryuusui", "Dr. Stone: New World", "Dr. Stone: Stone Wars", "Ninja Scroll: The Series", "Dr. Stone: Science Future", "Dr. Stone 3rd Season Part 2"]
        const kaa = ["Dr. Stone", "Dr. Stone: Stone Wars", "Dr. Stone: Stone Wars Eve of the Battle Special Feature", "Dr. Stone: New World", "Dr. Stone: Ryusui"]
        expect(recorded.mediaTitles.romaji).toBe(stone.romajiTitle)
        expect(chooseEntry(stone, anikoto.map(title => found(title)), false)?.title).toBe("Dr. Stone")
        expect(chooseEntry(stone, kaa.map(title => found(title, "sub")), false)?.title).toBe("Dr. Stone")
    })

    it("a sequel is not the first season, the first season is not the sequel", () => {
        const newWorld: StreamMedia = { ...stone, id: 2, romajiTitle: "Dr. STONE: NEW WORLD", englishTitle: "Dr. STONE NEW WORLD", synonyms: ["Dr. Stone 3rd Season"], startDate: { year: 2023 } }
        const list = ["Dr. Stone", "Dr. Stone: New World Part 2", "Dr. Stone: New World", "Dr. Stone: Stone Wars"].map(title => found(title))
        expect(chooseEntry(newWorld, list, false)?.title).toBe("Dr. Stone: New World")
        expect(chooseEntry(stone, [found("Dr. Stone 2"), found("Dr. Stone: Stone Wars")], false)).toBeNull()
    })

    it("sub or dub, the year, nothing fitting, a tie", () => {
        expect(chooseEntry(stone, [found("Dr. Stone", "sub", "s"), found("Dr. Stone", "dub", "d")], true)?.id).toBe("d")
        expect(chooseEntry(stone, [found("Dr. Stone", "sub", "s")], true)?.id).toBe("s")
        expect(chooseEntry(stone, [found("Dr. Stone (2023)", "both", "late"), found("Dr. Stone (2019)", "both", "right")], false)?.id).toBe("right")
        expect(chooseEntry(stone, [found("Swan"), found("Dragon")], false)).toBeNull()
        expect(chooseEntry(stone, [found("Dr. Stone", "both", "a"), found("dr stone", "both", "b")], false)?.id).toBe("a")
        expect(chooseEntry({ ...stone, romajiTitle: undefined, englishTitle: undefined }, [found("Dcst")], false)?.title).toBe("Dcst")
    })

    it("cleans titles: case, accents, punctuation, season words", () => {
        expect(cleanTitle("Dr. STONE: Ryūsui")).toBe("dr stone ryusui")
        expect(cleanTitle("Title 2nd Season")).toBe(cleanTitle("Title Season 2"))
        expect(likeness("Dr. Stone", "Dr. STONE")).toBe(1)
        expect(likeness("Dr. Stone: Ryusui", "Dr. Stone: Ryuusui")).toBeGreaterThan(0.9)
        expect(likeness("", "x")).toBe(0)
    })
})

describe("cost on the app's thread", () => {
    it("a long episode list crosses as one small JSON text (measured, see §4m)", async () => {
        const many = Array.from({ length: 2000 }, (_value, index) => ({ id: `entry/${index + 1}`, number: index + 1, url: `https://stream.example/entry/${index + 1}` }))
        const text = JSON.stringify(many)
        const started = performance.now()
        for (let round = 0; round < 10; round++) JSON.parse(text)
        const perParse = (performance.now() - started) / 10
        console.info(`[streams] 2000 episodes: ${text.length} bytes, JSON.parse ${perParse.toFixed(2)} ms`)
        expect(text.length).toBeLessThan(200_000)
    })
})

describe("a Cloudflare check that needs the user (§4k)", () => {
    it("becomes one plain sentence for the screen, however the extension passes it on", () => {
        const thrown = new SandboxError("thrown", "CloudflareCheckError: fetch: Cloudflare's check needs the user: site.example did not pass in 30 s")
        const wrapped = new SandboxError("thrown", "Error: search failed: fetch: Cloudflare's check needs the user: site.example")
        const own = Object.assign(new Error("fetch: Cloudflare's check needs the user: site.example"), { name: "CloudflareCheckError", needsUser: true })
        for (const error of [thrown, wrapped, own]) {
            const failure = failureOf("some-provider", "search", error)
            expect(failure).toBeInstanceOf(CoreError)
            expect(failure.message).toBe(`some-provider: ${NEEDS_USER_TEXT}`)
            expect(failure.message).not.toContain("site.example")
            expect(failure.status).toBe(503)
        }
    })

    it("leaves every other failure as before", () => {
        expect(failureOf("p", "search", new SandboxError("thrown", "Error: no results")).message).toBe("p: search failed: no results")
        expect(failureOf("p", "search", new SandboxError("time", "")).message).toBe("p: search took too long")
        expect(failureOf("p", "findEpisodes", new Error("403 from site")).message).toBe("p: findEpisodes failed: 403 from site")
    })
})
