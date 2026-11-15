// geschrieben nach: öffentlicher API-Doku der vier Debrid-Anbieter, die die App anbietet (settings-torrents.tsx DEBRID_PROVIDERS) – TorBox https://api.torbox.app/openapi.json (Doku https://api-docs.torbox.app/), Real-Debrid https://api.real-debrid.com/, AllDebrid https://docs.alldebrid.com/ (v4 und v4.1), Premiumize https://www.premiumize.me/api – und den App-Typen Debrid_TorrentItem, Debrid_TorrentItemFile, Debrid_TorrentItemStatus (src/api/generated/types.ts); kein Server-Quelltext

import { CoreError } from "../errors"
import type { CoreEnvironment } from "../registry"

/*
 * One small client per debrid service. Each knows four things of its service's public API: add a magnet link, read one
 * torrent (with its files) or all of them, give the direct download address of one file, delete a torrent. The answers
 * are put into the app's form (`Debrid_TorrentItem`). The key goes only into the request to the service (the header
 * `Authorization: Bearer`, which all four accept; TorBox's download address asks for it as `token` in the query, as
 * its documentation says) and never into an error text.
 */

type Json = Record<string, unknown>

export type DebridFile = { id: string, index: number, name: string, path: string, size: number }

export type DebridStatus = "downloading" | "completed" | "seeding" | "error" | "stalled" | "paused" | "other"

/** The app's `Debrid_TorrentItem` */
export type DebridItem = {
    id: string
    name: string
    hash: string
    size: number
    formattedSize: string
    completionPercentage: number
    eta: string
    status: DebridStatus
    added: string
    speed?: string
    seeders?: number
    isReady: boolean
    files?: DebridFile[]
}

export type DebridProvider = {
    readonly id: string
    /** → the service's id of the torrent */
    add: (magnet: string) => Promise<string>
    /** One torrent with its files (the files may still be missing while the service reads the magnet link) */
    item: (id: string) => Promise<DebridItem>
    items: () => Promise<DebridItem[]>
    /** Tells the service which file is wanted, where it needs that before it loads (Real-Debrid) */
    choose?: (id: string, file: DebridFile) => Promise<void>
    /** The direct download address of a file of a ready torrent */
    link: (id: string, file: DebridFile) => Promise<string>
    remove: (id: string) => Promise<void>
}

export const DEBRID_PROVIDER_IDS = ["torbox", "realdebrid", "alldebrid", "premiumize"] as const

const ASK_TIMEOUT_MS = 30_000
/** Who asks, as AllDebrid wants to know (`agent`) */
const AGENT = "seanime-mobile"

const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value)
const text = (value: unknown) => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "")
const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 0)
const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1)

function amount(bytes: number) {
    const units = ["B", "KB", "MB", "GB", "TB"]
    let value = Math.max(0, bytes)
    let unit = 0
    while (value >= 1000 && unit < units.length - 1) {
        value /= 1000
        unit++
    }
    return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`
}

const speedOf = (bytesPerSecond: number) => (bytesPerSecond > 0 ? `${amount(bytesPerSecond)}/s` : undefined)

function etaOf(seconds: number) {
    if (!(seconds > 0)) return ""
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    return hours > 0 ? `${hours}h ${minutes}m` : minutes > 0 ? `${minutes}m` : `${Math.round(seconds)}s`
}

function dateOf(value: unknown) {
    if (typeof value === "number" && value > 0) return new Date(value * 1000).toISOString()
    return typeof value === "string" ? value : ""
}

/** Builds an item; size, completion and status are the service's, the rest is put in the app's words */
function itemOf(fields: { id: unknown, name: unknown, hash: unknown, size: unknown, percent: number, eta?: number, status: DebridStatus, added: unknown, speed?: number, seeders?: unknown, files?: DebridFile[] }): DebridItem {
    const size = count(fields.size)
    const percent = Math.max(0, Math.min(100, Math.round(fields.percent)))
    return {
        id: text(fields.id),
        name: text(fields.name),
        hash: text(fields.hash).toLowerCase(),
        size,
        formattedSize: amount(size),
        completionPercentage: percent,
        eta: etaOf(fields.eta ?? 0),
        status: fields.status,
        added: dateOf(fields.added),
        ...(fields.speed !== undefined && speedOf(fields.speed) ? { speed: speedOf(fields.speed) } : {}),
        ...(fields.seeders !== undefined ? { seeders: count(fields.seeders) } : {}),
        isReady: fields.status === "completed" || fields.status === "seeding",
        ...(fields.files ? { files: fields.files } : {}),
    }
}

const form = (fields: [string, string][]) => fields.map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`).join("&")

/** One request to a service → its JSON (null for an empty answer). An error carries the service's own words, never the key. */
async function ask(environment: Pick<CoreEnvironment, "fetch">, service: string, key: string, url: string, init: { method?: string, form?: [string, string][], json?: Json } = {}): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ASK_TIMEOUT_MS)
    const headers: Record<string, string> = { Authorization: `Bearer ${key}`, Accept: "application/json" }
    let body: string | undefined
    if (init.form) {
        headers["Content-Type"] = "application/x-www-form-urlencoded"
        body = form(init.form)
    }
    else if (init.json) {
        headers["Content-Type"] = "application/json"
        body = JSON.stringify(init.json)
    }
    let status: number
    let raw: string
    try {
        const response = await environment.fetch(url, { method: init.method ?? (body ? "POST" : "GET"), headers, body, signal: controller.signal })
        status = response.status
        raw = await response.text()
    }
    catch (error) {
        throw new CoreError(`debrid: ${service} could not be reached (${controller.signal.aborted ? "no answer within 30 s" : error instanceof Error ? error.name : "network"})`, 502)
    }
    finally {
        clearTimeout(timer)
    }
    let answer: unknown = null
    if (raw.trim()) {
        try {
            answer = JSON.parse(raw)
        }
        catch {
            if (status < 400) throw new CoreError(`debrid: ${service} answered with something that is not JSON`, 502)
        }
    }
    const said = refusalOf(answer)
    if (status === 401 || status === 403) throw new CoreError(`debrid: ${service} refused the API key${said ? ` (${said})` : ""}`, 401)
    if (status >= 400 || said) throw new CoreError(`debrid: ${service}: ${said || `HTTP ${status}`}`, status >= 400 && status < 500 ? 400 : 502)
    return answer
}

/** The error words of the four answer forms: `{ error, error_code }`, `{ status: "error", error: { message } }`, `{ status: "error", message }`, `{ success: false, detail }` */
function refusalOf(answer: unknown): string {
    if (!isRecord(answer)) return ""
    if (answer.success === false) return text(answer.detail) || text(answer.error) || "refused"
    if (answer.status === "error") return isRecord(answer.error) ? text(answer.error.message) || text(answer.error.code) : text(answer.message) || text(answer.error) || "refused"
    if (typeof answer.error === "string" && answer.error) return answer.error
    return ""
}

/* ---- TorBox (https://api.torbox.app/v1/api, answers `{ success, error, detail, data }`) ---- */

const TORBOX = "https://api.torbox.app/v1/api"

function torboxStatus(state: string, finished: boolean, present: boolean): DebridStatus {
    const word = state.toLowerCase()
    if (word.includes("error") || word.includes("failed")) return "error"
    if (word.startsWith("stalled")) return "stalled"
    if (word === "paused") return "paused"
    if (finished && present) return word.includes("upload") || word.includes("seed") ? "seeding" : "completed"
    if (word === "completed" || word === "cached") return "completed"
    if (word === "downloading" || word === "metadl" || word.startsWith("checking")) return "downloading"
    return "other"
}

function torboxItem(raw: unknown): DebridItem {
    const row = isRecord(raw) ? raw : {}
    const files = Array.isArray(row.files) ? row.files.filter(isRecord).map((file, index) => {
        const path = text(file.name)
        return { id: text(file.id), index, name: text(file.short_name) || nameOf(path), path, size: count(file.size) }
    }) : undefined
    return itemOf({
        id: row.id, name: row.name, hash: row.hash, size: row.size, percent: count(row.progress) * 100, eta: count(row.eta),
        status: torboxStatus(text(row.download_state), row.download_finished === true, row.download_present === true), added: row.created_at,
        speed: count(row.download_speed), seeders: row.seeds, files,
    })
}

export function torbox(environment: Pick<CoreEnvironment, "fetch">, key: string): DebridProvider {
    const call = (url: string, init?: Parameters<typeof ask>[4]) => ask(environment, "TorBox", key, url, init)
    const dataOf = (answer: unknown) => (isRecord(answer) ? answer.data : null)
    return {
        id: "torbox",
        add: async magnet => {
            const data = dataOf(await call(`${TORBOX}/torrents/createtorrent`, { form: [["magnet", magnet]] }))
            const id = isRecord(data) ? text(data.torrent_id) : ""
            if (!id) throw new CoreError("debrid: TorBox gave no torrent id", 502)
            return id
        },
        item: async id => torboxItem(dataOf(await call(`${TORBOX}/torrents/mylist?id=${encodeURIComponent(id)}&bypass_cache=true`))),
        items: async () => {
            const data = dataOf(await call(`${TORBOX}/torrents/mylist?bypass_cache=true`))
            return Array.isArray(data) ? data.map(torboxItem) : []
        },
        link: async (id, file) => {
            const url = `${TORBOX}/torrents/requestdl?token=${encodeURIComponent(key)}&torrent_id=${encodeURIComponent(id)}&file_id=${encodeURIComponent(file.id)}&zip_link=false`
            const data = dataOf(await call(url))
            if (typeof data !== "string" || !/^https?:\/\//.test(data)) throw new CoreError("debrid: TorBox gave no download address", 502)
            return data
        },
        remove: async id => {
            await call(`${TORBOX}/torrents/controltorrent`, { json: { torrent_id: Number(id), operation: "delete" } })
        },
    }
}

/* ---- Real-Debrid (https://api.real-debrid.com/rest/1.0, errors `{ error, error_code }`) ---- */

const REALDEBRID = "https://api.real-debrid.com/rest/1.0"

function realDebridStatus(status: string): DebridStatus {
    switch (status) {
        case "downloaded": return "completed"
        case "downloading": case "queued": case "magnet_conversion": case "compressing": case "uploading": return "downloading"
        case "waiting_files_selection": return "paused"
        case "magnet_error": case "error": case "virus": case "dead": return "error"
        default: return "other"
    }
}

function realDebridItem(raw: unknown): DebridItem & { links: string[], chosen: string[] } {
    const row = isRecord(raw) ? raw : {}
    const listed = Array.isArray(row.files) ? row.files.filter(isRecord) : null
    const files = listed?.map((file, index) => {
        const path = text(file.path).replace(/^\/+/, "")
        return { id: text(file.id), index, name: nameOf(path), path, size: count(file.bytes) }
    })
    return {
        ...itemOf({
            id: row.id, name: row.filename, hash: row.hash, size: row.bytes, percent: count(row.progress), status: realDebridStatus(text(row.status)),
            added: row.added, speed: count(row.speed), seeders: row.seeders, files,
        }),
        links: Array.isArray(row.links) ? row.links.map(text) : [],
        // the files whose links come in `links`, in their order
        chosen: listed ? listed.filter(file => count(file.selected) === 1).map(file => text(file.id)) : [],
    }
}

export function realDebrid(environment: Pick<CoreEnvironment, "fetch">, key: string): DebridProvider {
    const call = (url: string, init?: Parameters<typeof ask>[4]) => ask(environment, "Real-Debrid", key, url, init)
    const strip = ({ links: _links, chosen: _chosen, ...item }: ReturnType<typeof realDebridItem>): DebridItem => item
    return {
        id: "realdebrid",
        add: async magnet => {
            const answer = await call(`${REALDEBRID}/torrents/addMagnet`, { form: [["magnet", magnet]] })
            const id = isRecord(answer) ? text(answer.id) : ""
            if (!id) throw new CoreError("debrid: Real-Debrid gave no torrent id", 502)
            return id
        },
        item: async id => strip(realDebridItem(await call(`${REALDEBRID}/torrents/info/${encodeURIComponent(id)}`))),
        items: async () => {
            const answer = await call(`${REALDEBRID}/torrents?limit=100`)
            return Array.isArray(answer) ? answer.map(row => strip(realDebridItem(row))) : []
        },
        // the service loads nothing before files are chosen; only the wanted one is
        choose: async (id, file) => {
            const info = realDebridItem(await call(`${REALDEBRID}/torrents/info/${encodeURIComponent(id)}`))
            if (info.status === "paused") await call(`${REALDEBRID}/torrents/selectFiles/${encodeURIComponent(id)}`, { form: [["files", file.id]] })
        },
        link: async (id, file) => {
            const info = realDebridItem(await call(`${REALDEBRID}/torrents/info/${encodeURIComponent(id)}`))
            const place = info.chosen.indexOf(file.id)
            const hosted = place >= 0 ? info.links[place] : ""
            if (!hosted) throw new CoreError("debrid: Real-Debrid has no link for this file", 404)
            const answer = await call(`${REALDEBRID}/unrestrict/link`, { form: [["link", hosted]] })
            const direct = isRecord(answer) ? text(answer.download) : ""
            if (!/^https?:\/\//.test(direct)) throw new CoreError("debrid: Real-Debrid gave no download address", 502)
            return direct
        },
        remove: async id => {
            await call(`${REALDEBRID}/torrents/delete/${encodeURIComponent(id)}`, { method: "DELETE" })
        },
    }
}

/* ---- AllDebrid (https://api.alldebrid.com, v4 and v4.1, answers `{ status, data }` or `{ status: "error", error }`) ---- */

const ALLDEBRID = "https://api.alldebrid.com"

/** statusCode: 0 queued, 1 downloading, 2 compressing or moving, 3 uploading, 4 ready, 5 and more errors */
function allDebridStatus(code: number): DebridStatus {
    if (code === 4) return "completed"
    if (code >= 0 && code <= 3) return "downloading"
    return "error"
}

/** The file tree (`n` name, `s` size, `l` link, `e` entries of a folder) as a flat list with paths */
function allDebridFiles(tree: unknown, folder = "", out: (DebridFile & { link: string })[] = []) {
    if (!Array.isArray(tree)) return out
    for (const node of tree) {
        if (!isRecord(node)) continue
        const path = folder ? `${folder}/${text(node.n)}` : text(node.n)
        if (Array.isArray(node.e)) allDebridFiles(node.e, path, out)
        else out.push({ id: String(out.length), index: out.length, name: text(node.n), path, size: count(node.s), link: text(node.l) })
    }
    return out
}

function allDebridItem(raw: unknown, files?: DebridFile[]): DebridItem {
    const row = isRecord(raw) ? raw : {}
    const size = count(row.size)
    const done = count(row.downloaded)
    const code = count(row.statusCode)
    const speed = count(row.downloadSpeed)
    return itemOf({
        id: row.id, name: row.filename, hash: row.hash, size, percent: code === 4 ? 100 : size > 0 ? (done / size) * 100 : 0,
        eta: speed > 0 ? (size - done) / speed : 0, status: allDebridStatus(code), added: row.uploadDate, speed, seeders: row.seeders, files,
    })
}

export function allDebrid(environment: Pick<CoreEnvironment, "fetch">, key: string): DebridProvider {
    const call = (path: string, fields: [string, string][]) => ask(environment, "AllDebrid", key, `${ALLDEBRID}${path}?agent=${AGENT}`, { form: fields })
    const dataOf = (answer: unknown): Json => (isRecord(answer) && isRecord(answer.data) ? answer.data : {})
    const filesOf = async (id: string) => {
        const magnets = dataOf(await call("/v4/magnet/files", [["id[]", id]])).magnets
        const mine = Array.isArray(magnets) ? magnets.filter(isRecord).find(one => text(one.id) === id) : null
        return allDebridFiles(mine?.files)
    }
    const statusOf = async (id: string) => {
        const magnets = dataOf(await call("/v4.1/magnet/status", [["id", id]])).magnets
        return Array.isArray(magnets) ? magnets[0] : magnets
    }
    return {
        id: "alldebrid",
        add: async magnet => {
            const magnets = dataOf(await call("/v4/magnet/upload", [["magnets[]", magnet]])).magnets
            const first = Array.isArray(magnets) && isRecord(magnets[0]) ? magnets[0] : {}
            if (isRecord(first.error)) throw new CoreError(`debrid: AllDebrid: ${text(first.error.message) || text(first.error.code)}`, 400)
            const id = text(first.id)
            if (!id) throw new CoreError("debrid: AllDebrid gave no magnet id", 502)
            return id
        },
        item: async id => {
            const row = await statusOf(id)
            const ready = isRecord(row) && count(row.statusCode) === 4
            const files = ready ? (await filesOf(id)).map(({ link: _link, ...file }) => file) : undefined
            return allDebridItem(row, files)
        },
        items: async () => {
            const magnets = dataOf(await call("/v4.1/magnet/status", [])).magnets
            return Array.isArray(magnets) ? magnets.map(row => allDebridItem(row)) : []
        },
        link: async (id, file) => {
            const hosted = (await filesOf(id)).find(one => one.id === file.id && one.path === file.path)?.link ?? ""
            if (!hosted) throw new CoreError("debrid: AllDebrid has no link for this file", 404)
            const data = dataOf(await call("/v4/link/unlock", [["link", hosted]]))
            const direct = text(data.link)
            if (!/^https?:\/\//.test(direct)) throw new CoreError("debrid: AllDebrid gave no download address (the link is delayed)", 502)
            return direct
        },
        remove: async id => {
            await call("/v4/magnet/delete", [["id", id]])
        },
    }
}

/* ---- Premiumize (https://www.premiumize.me/api, answers `{ status: "success", … }` or `{ status: "error", message }`) ---- */

const PREMIUMIZE = "https://www.premiumize.me/api"

function premiumizeStatus(status: string): DebridStatus {
    switch (status) {
        case "finished": return "completed"
        case "seeding": return "seeding"
        case "running": case "queued": case "waiting": return "downloading"
        case "error": case "banned": case "timeout": case "deleted": return "error"
        default: return "other"
    }
}

export function premiumize(environment: Pick<CoreEnvironment, "fetch">, key: string): DebridProvider {
    const call = (url: string, init?: Parameters<typeof ask>[4]) => ask(environment, "Premiumize", key, url, init)
    const transfers = async () => {
        const answer = await call(`${PREMIUMIZE}/transfer/list`)
        return isRecord(answer) && Array.isArray(answer.transfers) ? answer.transfers.filter(isRecord) : []
    }
    /** The files of a finished transfer: its folder, read down to the last subfolder, or its one file */
    const filesOf = async (transfer: Json) => {
        const out: (DebridFile & { link: string })[] = []
        const read = async (folderId: string, folder: string, depth: number) => {
            const answer = await call(`${PREMIUMIZE}/folder/list?id=${encodeURIComponent(folderId)}`)
            const content = isRecord(answer) && Array.isArray(answer.content) ? answer.content.filter(isRecord) : []
            for (const entry of content) {
                const path = folder ? `${folder}/${text(entry.name)}` : text(entry.name)
                if (entry.type === "folder") {
                    if (depth < 4) await read(text(entry.id), path, depth + 1)
                }
                else out.push({ id: text(entry.id), index: out.length, name: text(entry.name), path, size: count(entry.size), link: text(entry.link) })
            }
        }
        if (text(transfer.file_id)) {
            const answer = await call(`${PREMIUMIZE}/item/details?id=${encodeURIComponent(text(transfer.file_id))}`)
            if (isRecord(answer)) out.push({ id: text(answer.id), index: 0, name: text(answer.name), path: text(answer.name), size: count(answer.size), link: text(answer.link) })
        }
        else if (text(transfer.folder_id)) await read(text(transfer.folder_id), "", 0)
        return out
    }
    const transferOf = async (id: string) => {
        const found = (await transfers()).find(one => text(one.id) === id)
        if (!found) throw new CoreError("debrid: Premiumize has no such transfer", 404)
        return found
    }
    const itemFrom = (transfer: Json, files?: DebridFile[]) => itemOf({
        id: transfer.id, name: transfer.name, hash: "", size: files ? files.reduce((sum, file) => sum + file.size, 0) : 0,
        percent: count(transfer.progress) * 100, status: premiumizeStatus(text(transfer.status)), added: transfer.created_at, files,
    })
    return {
        id: "premiumize",
        add: async magnet => {
            const answer = await call(`${PREMIUMIZE}/transfer/create`, { form: [["src", magnet]] })
            const id = isRecord(answer) ? text(answer.id) : ""
            if (!id) throw new CoreError("debrid: Premiumize gave no transfer id", 502)
            return id
        },
        item: async id => {
            const transfer = await transferOf(id)
            const status = premiumizeStatus(text(transfer.status))
            const files = status === "completed" || status === "seeding" ? (await filesOf(transfer)).map(({ link: _link, ...file }) => file) : undefined
            return itemFrom(transfer, files)
        },
        items: async () => (await transfers()).map(transfer => itemFrom(transfer)),
        link: async (id, file) => {
            const direct = (await filesOf(await transferOf(id))).find(one => one.id === file.id)?.link ?? ""
            if (!/^https?:\/\//.test(direct)) throw new CoreError("debrid: Premiumize gave no download address", 502)
            return direct
        },
        remove: async id => {
            await call(`${PREMIUMIZE}/transfer/delete`, { form: [["id", id]] })
        },
    }
}

/** The client of a service by the id the settings keep; null for none or an unknown one */
export function debridProviderFor(id: string, environment: Pick<CoreEnvironment, "fetch">, key: string): DebridProvider | null {
    switch (id) {
        case "torbox": return torbox(environment, key)
        case "realdebrid": return realDebrid(environment, key)
        case "alldebrid": return allDebrid(environment, key)
        case "premiumize": return premiumize(environment, key)
        default: return null
    }
}
