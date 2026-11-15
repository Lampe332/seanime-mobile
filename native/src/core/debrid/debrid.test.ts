// geschrieben nach: Antwort-Formen der öffentlichen API-Doku der Anbieter (TorBox https://api.torbox.app/openapi.json, Real-Debrid https://api.real-debrid.com/, AllDebrid https://docs.alldebrid.com/, Premiumize https://www.premiumize.me/api; nur Feldnamen und Arten, alle Werte erfunden), Form der Aufzeichnung DEBRID.DebridGetTorrents vom 13.11.2026 (Fehler ohne Anbieter) und den App-Typen Models_DebridSettings, Debrid_TorrentItem, DebridClient_FilePreview; kein Netz, kein Konto

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { sqlDriverFor } from "@/api/client/core-database"
import { forgetDatabases, openDatabaseSync } from "../../../test/expo-sqlite"
import { type CoreDatabase, openCoreDatabase } from "../database/database"
import { type CoreEvent, onCoreEvent } from "../events"
import { coreAnswerFor } from "../index"
import type { CoreEnvironment } from "../registry"
import { torrentKept } from "../database/schema"
import { DEBRID_KEY_SECRET, chooseDebridFile, debridTiming, forgetDebridStream, withDebridSettings } from "./debrid"
import type { DebridFile } from "./providers"

type Json = Record<string, unknown>
type Answer = { status: number, body: unknown }
type Sent = { url: string, method: string, headers: Record<string, string>, body: string }

const KEY = "synthetic-key-0123456789"
const HASH = "ab".repeat(20)
const MAGNET = `magnet:?xt=urn:btih:${HASH}`
const FILE_01 = "Show/[Group] Show - 01 [1080p].mkv"
const FILE_03 = "Show/[Group] Show - 03 [1080p].mkv"
/** The recorded settings answer of the screens' type Models_DebridSettings: field names and kinds */
const SETTINGS_KINDS: Record<string, string> = {
    id: "number", createdAt: "string", updatedAt: "string", enabled: "boolean", provider: "string", apiKey: "string",
    includeDebridStreamInLibrary: "boolean", streamAutoSelect: "boolean", streamPreferredResolution: "string",
}

let clock = 0
let database: Promise<CoreDatabase> | null = null
let secrets: Record<string, string> = {}
let sent: Sent[] = []
let events: CoreEvent[] = []
let stopListening: () => void = () => undefined
let serverCalls: unknown[] = []
/** Questions until the service has the files, and until the torrent is ready */
let polls = 0
let readyAfter = 1
let service: (request: Sent) => Answer = () => ({ status: 404, body: null })

const json = (body: unknown, status = 200): Answer => ({ status, body })
const formOf = (body: string) => Object.fromEntries(new URLSearchParams(body))

const environment = {
    fetch: async (url: string, init: { method?: string, headers?: Record<string, string>, body?: string }) => {
        const request = { url, method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body ?? "" }
        sent.push(request)
        const answer = service(request)
        return { status: answer.status, headers: { get: () => "application/json" }, text: async () => (answer.body === null ? "" : JSON.stringify(answer.body)) }
    },
    secret: async (name: string) => secrets[name] ?? null,
    keepSecret: async (name: string, value: string | null) => {
        if (value === null) delete secrets[name]
        else secrets[name] = value
    },
    server: async (...call: unknown[]) => {
        serverCalls.push(call)
        return true
    },
    database: () => database ??= openCoreDatabase(sqlDriverFor(openDatabaseSync("core.db") as never), () => clock),
    now: () => clock,
    pause: async () => undefined,
} as unknown as CoreEnvironment

const ask = (method: string, endpoint: string, body?: unknown) => {
    const answer = coreAnswerFor(method, endpoint)
    if (!answer) throw new Error(`not answered by the core: ${method} ${endpoint}`)
    return answer({ query: undefined, body }, environment)
}
const saveSettings = (settings: Json) => ask("PATCH", "/api/v1/debrid/settings", { settings })
const useProvider = (provider: string) => saveSettings({ enabled: true, provider, apiKey: KEY, includeDebridStreamInLibrary: false, streamAutoSelect: false, streamPreferredResolution: "1080p" })
const start = (more: Json = {}) => ask("POST", "/api/v1/debrid/stream/start", {
    mediaId: 4242, episodeNumber: 3, aniDBEpisode: "3", autoSelect: false, torrent: { name: "[Group] Show (01-12) [1080p]", infoHash: HASH }, fileId: "", playbackType: "nativeplayer", clientId: "", ...more,
})
const settled = () => new Promise(resolve => setTimeout(resolve, 0))
const player = () => events.filter(event => event.type === "native-player").map(event => event.payload as { type: string, payload: Json })
const states = () => events.filter(event => event.type === "debrid-stream-state").map(event => (event.payload as Json).status)

/* ---- Synthetic services in the form of their documentation ---- */

function torboxService(request: Sent): Answer {
    const url = new URL(request.url)
    if (url.pathname === "/v1/api/torrents/createtorrent") return json({ success: true, error: null, detail: "Found Cached Torrent.", data: { torrent_id: 77, name: "Show", hash: HASH, auth_id: "x" } })
    if (url.pathname === "/v1/api/torrents/mylist") {
        const ready = polls++ >= readyAfter
        const row = {
            id: 77, hash: HASH, name: "[Group] Show (01-12) [1080p]", size: 2_000_000_000, created_at: "2026-11-14T10:00:00Z", download_state: ready ? "cached" : "downloading",
            download_speed: ready ? 0 : 5_000_000, seeds: 12, progress: ready ? 1 : 0.4, eta: ready ? 0 : 120, download_finished: ready, download_present: ready,
            files: [{ id: 0, name: FILE_01, short_name: "[Group] Show - 01 [1080p].mkv", size: 900 }, { id: 2, name: FILE_03, short_name: "[Group] Show - 03 [1080p].mkv", size: 950 }],
        }
        return json({ success: true, error: null, detail: "", data: url.searchParams.get("id") ? row : [row] })
    }
    if (url.pathname === "/v1/api/torrents/requestdl") return json({ success: true, error: null, detail: "", data: `https://store.example/dl/${url.searchParams.get("file_id")}.mkv` })
    if (url.pathname === "/v1/api/torrents/controltorrent") return json({ success: true, error: null, detail: "Torrent deleted.", data: null })
    return json({ success: false, error: "NOT_FOUND", detail: "no such path" }, 404)
}

let realDebridChosen = ""
function realDebridService(request: Sent): Answer {
    const path = new URL(request.url).pathname.replace("/rest/1.0", "")
    if (path === "/torrents/addMagnet") return json({ id: "RDX1", uri: "https://real-debrid.example/torrents/info/RDX1" }, 201)
    if (path === "/torrents/selectFiles/RDX1") {
        realDebridChosen = formOf(request.body).files
        return json(null, 204)
    }
    const info = () => {
        const ready = realDebridChosen !== "" && polls++ >= readyAfter
        return {
            id: "RDX1", filename: "[Group] Show (01-12) [1080p]", original_filename: "x", hash: HASH, bytes: 950, original_bytes: 1850, host: "real-debrid.com", split: 2000,
            progress: ready ? 100 : realDebridChosen ? 40 : 0, status: ready ? "downloaded" : realDebridChosen ? "downloading" : "waiting_files_selection", added: "2026-11-14T10:00:00.000Z",
            files: [{ id: 1, path: `/${FILE_01}`, bytes: 900, selected: 0 }, { id: 2, path: `/${FILE_03}`, bytes: 950, selected: realDebridChosen === "2" ? 1 : 0 }],
            links: ready ? ["https://real-debrid.example/d/HOSTED2"] : [], ended: ready ? "2026-11-14T10:01:00.000Z" : undefined, speed: ready ? undefined : 4_000_000, seeders: 9,
        }
    }
    if (path === "/torrents/info/RDX1") return json(info())
    if (path === "/torrents") return json([{ ...info(), files: undefined }])
    if (path === "/unrestrict/link") return json({ id: "U1", filename: "x.mkv", mimeType: "video/x-matroska", filesize: 950, link: formOf(request.body).link, host: "real-debrid.com", chunks: 32, crc: 1, download: "https://dl.real-debrid.example/abc/Show-03.mkv", streamable: 1 })
    if (path === "/torrents/delete/RDX1") return json(null, 204)
    return json({ error: "unknown_ressource", error_code: 7 }, 404)
}

function allDebridService(request: Sent): Answer {
    const url = new URL(request.url)
    const ready = () => polls++ >= readyAfter
    if (url.pathname === "/v4/magnet/upload") return json({ status: "success", data: { magnets: [{ magnet: MAGNET, hash: HASH, name: "Show", size: 1850, ready: false, id: 555 }] } })
    if (url.pathname === "/v4.1/magnet/status") {
        const done = ready()
        const magnet = { id: 555, filename: "[Group] Show (01-12) [1080p]", size: 1850, status: done ? "Ready" : "Downloading", statusCode: done ? 4 : 1, downloaded: done ? 1850 : 740, uploaded: 0, seeders: 7, downloadSpeed: done ? 0 : 1_000_000, uploadSpeed: 0, uploadDate: 1_763_114_400, completionDate: done ? 1_763_114_460 : 0 }
        return json({ status: "success", data: { magnets: formOf(request.body).id ? magnet : [magnet] } })
    }
    if (url.pathname === "/v4/magnet/files") return json({ status: "success", data: { magnets: [{ id: "555", files: [{ n: "Show", e: [{ n: "[Group] Show - 01 [1080p].mkv", s: 900, l: "https://alldebrid.example/f/1" }, { n: "[Group] Show - 03 [1080p].mkv", s: 950, l: "https://alldebrid.example/f/3" }] }] }] } })
    if (url.pathname === "/v4/link/unlock") return json({ status: "success", data: { link: "https://debrid.example/dl/abc/Show-03.mkv", host: "alldebrid", filename: "x.mkv", paws: false, filesize: 950, streams: [], id: "abc", hostDomain: "alldebrid.com" } })
    if (url.pathname === "/v4/magnet/delete") return json({ status: "success", data: { message: "Magnet was successfully deleted" } })
    return json({ status: "error", error: { code: "GENERIC", message: "unknown" } }, 404)
}

function premiumizeService(request: Sent): Answer {
    const url = new URL(request.url)
    if (url.pathname === "/api/transfer/create") return json({ status: "success", id: "PMT1", name: "Show" })
    if (url.pathname === "/api/transfer/list") {
        const done = polls++ >= readyAfter
        return json({ status: "success", transfers: [{ id: "PMT1", name: "[Group] Show (01-12) [1080p]", status: done ? "finished" : "running", progress: done ? 1 : 0.42, message: "", folder_id: done ? "F1" : null, file_id: null, created_at: 1_763_114_400 }] })
    }
    if (url.pathname === "/api/folder/list" && url.searchParams.get("id") === "F1") {
        return json({ status: "success", name: "Show", parent_id: "R", folder_id: "F1", content: [{ id: "S1", name: "Show", type: "folder", created_at: 1 }, { id: "N1", name: "notes.txt", type: "file", created_at: 1, size: 3, mime_type: "text/plain", link: "https://pm.example/n" }] })
    }
    if (url.pathname === "/api/folder/list" && url.searchParams.get("id") === "S1") {
        return json({ status: "success", name: "Show", parent_id: "F1", folder_id: "S1", content: [
            { id: "V1", name: "[Group] Show - 01 [1080p].mkv", type: "file", created_at: 1, size: 900, mime_type: "video/x-matroska", link: "https://pm.example/v1.mkv" },
            { id: "V3", name: "[Group] Show - 03 [1080p].mkv", type: "file", created_at: 1, size: 950, mime_type: "video/x-matroska", link: "https://pm.example/v3.mkv" },
        ] })
    }
    if (url.pathname === "/api/transfer/delete") return json({ status: "success" })
    return json({ status: "error", message: "unknown" }, 404)
}

const SERVICES: Record<string, { handle: (request: Sent) => Answer, address: string, chosen: string }> = {
    torbox: { handle: torboxService, address: "https://store.example/dl/2.mkv", chosen: "2" },
    realdebrid: { handle: realDebridService, address: "https://dl.real-debrid.example/abc/Show-03.mkv", chosen: "2" },
    alldebrid: { handle: allDebridService, address: "https://debrid.example/dl/abc/Show-03.mkv", chosen: "1" },
    premiumize: { handle: premiumizeService, address: "https://pm.example/v3.mkv", chosen: "V3" },
}

beforeEach(() => {
    forgetDatabases()
    database = null
    clock = 1_700_000_000_000
    secrets = {}
    sent = []
    events = []
    serverCalls = []
    polls = 0
    readyAfter = 1
    realDebridChosen = ""
    service = () => json(null, 404)
    debridTiming.wait = async () => undefined
    debridTiming.stepMs = 1000
    debridTiming.filesPatienceMs = 5000
    debridTiming.readyPatienceMs = 10_000
    forgetDebridStream()
    stopListening = onCoreEvent(event => void events.push(event))
})

afterEach(() => {
    stopListening()
})

describe("debrid settings", () => {
    it("keeps the row in core.db and the key only in the secured storage; the answer has the recorded form", async () => {
        const saved = await useProvider("torbox") as Json
        for (const [name, kind] of Object.entries(SETTINGS_KINDS)) expect(typeof saved[name], name).toBe(kind)
        expect(saved.apiKey).toBe(KEY)
        expect(secrets[DEBRID_KEY_SECRET]).toBe(KEY)
        const database = await environment.database()
        const rows = await database.select().from(torrentKept)
        expect(rows.map(row => row.key)).toContain("debrid-settings")
        expect(JSON.stringify(rows)).not.toContain(KEY)
        const status = await withDebridSettings({ debridSettings: { provider: "", apiKey: "" } }, environment) as Json
        expect((status.debridSettings as Json).provider).toBe("torbox")
        expect((status.debridSettings as Json).apiKey).toBe(KEY)
    })

    it("forgets the key for an empty one, keeps it when the field is left out, reads '-' as no service", async () => {
        await useProvider("realdebrid")
        await saveSettings({ enabled: true, provider: "realdebrid" })
        expect(secrets[DEBRID_KEY_SECRET]).toBe(KEY)
        const none = await saveSettings({ enabled: false, provider: "-", apiKey: "" }) as Json
        expect(none.provider).toBe("")
        expect(none.apiKey).toBe("")
        expect(secrets[DEBRID_KEY_SECRET]).toBeUndefined()
    })

})

describe("no service or no key", () => {
    it("answers at once with the recorded error, without asking any service", async () => {
        await expect(ask("GET", "/api/v1/debrid/torrents")).rejects.toMatchObject({ status: 500, message: "debrid: Provider not set" })
        await expect(start()).rejects.toMatchObject({ message: "debrid: Provider not set" })
        await saveSettings({ enabled: true, provider: "torbox", apiKey: "" })
        await expect(ask("GET", "/api/v1/debrid/torrents")).rejects.toMatchObject({ message: "debrid: no API key saved for the provider" })
        await saveSettings({ enabled: false, provider: "torbox", apiKey: KEY })
        await expect(ask("GET", "/api/v1/debrid/torrents")).rejects.toMatchObject({ message: "debrid: Provider not set" })
        expect(sent).toHaveLength(0)
    })

    it("a refused key is said without the key", async () => {
        await useProvider("realdebrid")
        service = () => json({ error: "bad_token", error_code: 8 }, 401)
        const error = await (ask("GET", "/api/v1/debrid/torrents") as Promise<unknown>).catch(caught => caught as Error)
        expect((error as Error).message).toBe("debrid: Real-Debrid refused the API key (bad_token)")
        expect((error as Error).message).not.toContain(KEY)
    })

    it("a service that does not answer is said in time, without the key", async () => {
        await useProvider("torbox")
        const failing = { ...environment, fetch: async () => {
            throw new TypeError(`failed ${KEY}`)
        } } as unknown as CoreEnvironment
        const answer = coreAnswerFor("GET", "/api/v1/debrid/torrents")!
        const error = await (answer({ query: undefined, body: undefined }, failing) as Promise<unknown>).catch(caught => caught as Error)
        expect((error as Error).message).toBe("debrid: TorBox could not be reached (TypeError)")
    })
})

describe.each(Object.keys(SERVICES))("service %s", provider => {
    beforeEach(async () => {
        await useProvider(provider)
        service = SERVICES[provider].handle
        sent = []
    })

    it("lists the torrents in the app's form", async () => {
        const items = await ask("GET", "/api/v1/debrid/torrents") as Json[]
        expect(items).toHaveLength(1)
        const item = items[0]
        for (const [name, kind] of Object.entries({ id: "string", name: "string", hash: "string", size: "number", formattedSize: "string", completionPercentage: "number", eta: "string", status: "string", added: "string", isReady: "boolean" })) {
            expect(typeof item[name], name).toBe(kind)
        }
        expect(["downloading", "completed", "seeding", "error", "stalled", "paused", "other"]).toContain(item.status)
        expect(item.name).toBe("[Group] Show (01-12) [1080p]")
        // every request carries the key only as Bearer (TorBox's download address aside)
        for (const request of sent) expect(request.headers.Authorization).toBe(`Bearer ${KEY}`)
    })

    it("streams episode 3: waits until ready, plays the direct address", async () => {
        await expect(start()).resolves.toBe(true)
        await settled()
        const watch = player().find(message => message.type === "watch")!.payload
        expect(watch.streamType).toBe("debrid")
        expect(watch.streamUrl).toBe(SERVICES[provider].address)
        expect(String(watch.streamPath)).toMatch(/Show - 03 \[1080p\]\.mkv$/)
        expect(watch.mimeType).toBe("video/x-matroska")
        expect(watch.contentLength).toBe(950)
        expect(states()[0]).toBe("started")
        expect(states()).toContain("downloading")
        expect(states().at(-1)).toBe("ready")
        expect(sent.some(request => request.body.includes(encodeURIComponent(HASH)) || request.body.includes(HASH))).toBe(true)
    })

    it("plays the file the user chose by its id", async () => {
        await expect(start({ fileId: SERVICES[provider].chosen })).resolves.toBe(true)
        await settled()
        expect(player().find(message => message.type === "watch")!.payload.streamUrl).toBe(SERVICES[provider].address)
    })

    it("gives up when the service is not ready in time, and says so to the player", async () => {
        readyAfter = 1000
        await expect(start()).rejects.toMatchObject({ status: 504 })
        await settled()
        expect(player().at(-1)!.type).toBe("abort-open")
        expect(states().at(-1)).toBe("failed")
    })

    it("cancel stops the waiting stream and removes the torrent when asked", async () => {
        readyAfter = 1000
        debridTiming.wait = async () => {
            await ask("POST", "/api/v1/debrid/stream/cancel", { options: { removeTorrent: true } })
        }
        await expect(start()).rejects.toMatchObject({ message: "debrid: the stream was cancelled" })
        await settled()
        const removed = sent.filter(request => /delete|controltorrent/.test(request.url) || request.method === "DELETE")
        expect(removed).toHaveLength(1)
        expect(player().some(message => message.type === "watch")).toBe(false)
    })
})

describe("file previews", () => {
    it("lists the video files with the service's file ids (TorBox lists them before ready)", async () => {
        await useProvider("torbox")
        service = torboxService
        readyAfter = 1000
        const previews = await ask("POST", "/api/v1/debrid/torrents/file-previews", { torrent: { name: "Show", magnetLink: MAGNET }, episodeNumber: 3 }) as Json[]
        expect(previews.map(preview => [preview.fileId, preview.episodeNumber, preview.isLikely])).toEqual([["0", 1, false], ["2", 3, true]])
        expect(Object.keys(previews[0]).sort()).toEqual(["displayPath", "displayTitle", "episodeNumber", "fileId", "index", "isLikely", "path", "relativeEpisodeNumber"])
    })

    it("a torrent without magnet and info hash is refused", async () => {
        await useProvider("premiumize")
        await expect(ask("POST", "/api/v1/debrid/torrents/file-previews", { torrent: { name: "x" }, episodeNumber: 1 })).rejects.toMatchObject({ status: 400 })
    })
})

describe("choosing the file", () => {
    const files: DebridFile[] = [
        { id: "a", index: 0, name: "", path: FILE_01, size: 900 },
        { id: "b", index: 1, name: "", path: FILE_03, size: 950 },
        { id: "c", index: 2, name: "", path: "Show/[Group] Show - 03 [480p].mkv", size: 300 },
    ]
    it("by id, by index, by the episode in the name (larger first)", () => {
        expect(chooseDebridFile(files, { fileId: "c", episodeNumber: 3 })?.id).toBe("c")
        expect(chooseDebridFile(files, { fileIndex: 0, episodeNumber: 3 })?.id).toBe("a")
        expect(chooseDebridFile(files, { episodeNumber: 3 })?.id).toBe("b")
        expect(chooseDebridFile(files, { episodeNumber: 7 })).toBeNull()
    })
})
