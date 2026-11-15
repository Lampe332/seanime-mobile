// geschrieben nach: App-Code src/api/hooks/debrid.hooks.ts, handle-debrid-stream.ts, settings-torrents.tsx (DebridGroup, Schlüssel-Prüfung über GET /debrid/torrents), torrent-search-phone.tsx und native-player.tsx (Ereignisse "open-and-await", "watch", "abort-open"), App-Typen Models_DebridSettings, DebridStartStream_Variables, DebridClient_CancelStreamOptions, DebridClient_FilePreview, DebridClient_StreamState, Debrid_TorrentItem und NativePlayer_PlaybackInfo (src/api/generated), Form der Aufzeichnung DEBRID.DebridGetTorrents vom 13.11.2026 (Fehler „debrid: Provider not set“, 500), der öffentlichen API-Doku der Anbieter (providers.ts) und docs/EIGENER-KERN.md §4q (Phase 6c-2); kein Server-Quelltext

import { eq } from "drizzle-orm"
import { inOrder } from "../database/database"
import { torrentKept } from "../database/schema"
import { CoreError } from "../errors"
import { emitCoreEvent } from "../events"
import type { CoreEnvironment, CoreRequest } from "../registry"
import { autoSelectTorrent, magnetFromProvider } from "../torrent/search"
import { type TorrentFinder, chooseFile, episodeOfName, magnetOf, mimeOf, playerExtrasOf } from "../torrent/torrent"
import { type DebridFile, type DebridItem, type DebridProvider, debridProviderFor } from "./providers"

/*
 * Debrid without the server (area `debrid`): the settings in core.db, the service's key in the device's secured
 * storage (never in core.db, never in a log), and the four interfaces the app uses to stream through the service:
 * its torrent list, the files of a torrent, starting and cancelling a stream. A stream adds the torrent to the
 * service, waits until the service has the episode's file, and hands the file's direct download address to the app's
 * player, the way a source of an online stream is played. Adding torrents to download them into a folder on the
 * device stays with the server (POST /debrid/torrents); the settings saved by the core are told to it as well.
 */

type Json = Record<string, unknown>

/** The name of the key in the secured storage */
export const DEBRID_KEY_SECRET = "seanime-core-debrid-api-key"
const SETTINGS_KEY = "debrid-settings"

/** The settings as the screens know them (`Models_DebridSettings`), before the user saved any */
export const DEBRID_SETTINGS: Json = {
    enabled: false, provider: "", apiKey: "", includeDebridStreamInLibrary: false, streamAutoSelect: false, streamPreferredResolution: "",
}

/** How long and how often a stream asks the service; tests set their own */
export const debridTiming = {
    /** Between two questions */
    stepMs: 3000,
    /** The service must know the torrent's files within this time */
    filesPatienceMs: 90_000,
    /** The file must be ready within this time (a torrent the service has cached is ready at once) */
    readyPatienceMs: 2 * 60 * 60_000,
    wait: (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds)),
}

const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value)
const whole = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0)
const bodyOf = (request: CoreRequest): Json => (isRecord(request.body) ? request.body : {})
const VIDEO = /\.(mkv|mp4|m4v|webm|avi|ts|mov|wmv|flv)$/i

/* ---- Settings ---- */

async function keptSettings(environment: CoreEnvironment): Promise<Json | null> {
    const database = await environment.database()
    const rows = await inOrder(database, () => database.select({ content: torrentKept.content }).from(torrentKept).where(eq(torrentKept.key, SETTINGS_KEY)))
    return rows.length > 0 ? rows[0].content : null
}

/**
 * PATCH /api/v1/debrid/settings with the area on: the row in core.db without the key, the key in the secured storage
 * ("" forgets it) → the saved settings with the key, as the server answers. A running server is told the same
 * settings, so that what stays with it (downloads through the service) uses them; when it cannot be told, the core's
 * settings are saved all the same.
 */
export async function saveDebridSettings(request: CoreRequest, environment: CoreEnvironment): Promise<Json> {
    const wanted = bodyOf(request).settings
    if (!isRecord(wanted)) throw new CoreError("settings must be an object", 400)
    if (!environment.keepSecret) throw new CoreError("the secured storage is not available here")
    const before = await keptSettings(environment)
    const now = new Date(environment.now()).toISOString()
    const saved: Json = { id: 1, createdAt: typeof before?.createdAt === "string" ? before.createdAt : now, updatedAt: now }
    for (const [name, standard] of Object.entries(DEBRID_SETTINGS)) {
        if (name === "apiKey") continue
        saved[name] = typeof wanted[name] === typeof standard ? wanted[name] : before?.[name] ?? standard
    }
    // "-" is the screen's word for no service
    if (saved.provider === "-") saved.provider = ""
    let key = (await environment.secret(DEBRID_KEY_SECRET)) ?? ""
    if (typeof wanted.apiKey === "string") {
        key = wanted.apiKey.trim()
        await environment.keepSecret(DEBRID_KEY_SECRET, key || null)
    }
    const database = await environment.database()
    const values = { key: SETTINGS_KEY, content: saved, changedAt: environment.now() }
    await inOrder(database, () => database.insert(torrentKept).values(values).onConflictDoUpdate({ target: torrentKept.key, set: values }))
    const answer = { ...saved, apiKey: key }
    return answer
}

/** The status with the core's debrid settings in it (and the key, as the server's status carries it), once some were saved with the area on */
export async function withDebridSettings(status: unknown, environment: CoreEnvironment): Promise<unknown> {
    if (!isRecord(status)) return status
    const own = await keptSettings(environment)
    if (!own) return status
    return { ...status, debridSettings: { ...own, apiKey: (await environment.secret(DEBRID_KEY_SECRET)) ?? "" } }
}

/** The service of the saved settings with its key; a clear error, at once, when there is none */
export async function debridProviderOf(environment: CoreEnvironment): Promise<{ provider: DebridProvider, settings: Json }> {
    const settings = await keptSettings(environment)
    const id = typeof settings?.provider === "string" ? settings.provider : ""
    if (!settings || settings.enabled !== true || !id) throw new CoreError("debrid: Provider not set", 500)
    const key = (await environment.secret(DEBRID_KEY_SECRET)) ?? ""
    if (!key) throw new CoreError("debrid: no API key saved for the provider", 500)
    const provider = debridProviderFor(id, environment, key)
    if (!provider) throw new CoreError(`debrid: unknown provider "${id}"`, 500)
    return { provider, settings }
}

/* ---- The service's torrents ---- */

/** GET /api/v1/debrid/torrents → `Debrid_TorrentItem[]` */
export async function debridTorrents(_request: CoreRequest, environment: CoreEnvironment): Promise<DebridItem[]> {
    const { provider } = await debridProviderOf(environment)
    return provider.items()
}

type Run = { cancelled: boolean, provider: DebridProvider, id: string }
let current: Run | null = null

/** For tests: nothing runs */
export function forgetDebridStream() {
    current = null
}

/** Asks the service until `done`, a step apart; an error of the torrent, a cancel or the end of the patience stop it */
async function until(run: Run, done: (item: DebridItem) => boolean, patienceMs: number, each?: (item: DebridItem) => void): Promise<DebridItem> {
    const rounds = Math.max(1, Math.ceil(patienceMs / debridTiming.stepMs))
    for (let round = 0; ; round++) {
        if (run.cancelled) throw new CoreError("debrid: the stream was cancelled", 400)
        const item = await run.provider.item(run.id)
        each?.(item)
        if (done(item)) return item
        if (item.status === "error") throw new CoreError(`debrid: ${run.provider.id} could not load the torrent`, 502)
        if (round + 1 >= rounds) throw new CoreError(`debrid: ${run.provider.id} was not ready in time`, 504)
        await debridTiming.wait(debridTiming.stepMs)
    }
}

/** The torrent of a request and its magnet link: the one the app chose, else (`autoSelect`) the one the core picks */
async function torrentOf(body: Json, settings: Json, finder?: TorrentFinder): Promise<{ torrent: Json, magnet: string }> {
    let torrent = isRecord(body.torrent) ? body.torrent : null
    if (!torrent) {
        if (body.autoSelect !== true || !finder) throw new CoreError("no torrent chosen", 400)
        const resolution = typeof settings.streamPreferredResolution === "string" ? settings.streamPreferredResolution : ""
        torrent = (await autoSelectTorrent(await finder(), whole(body.mediaId), whole(body.episodeNumber), resolution)).torrent
    }
    let magnet = magnetOf(torrent)
    if (!magnet && finder && typeof torrent.provider === "string" && torrent.provider) magnet = await magnetFromProvider(await finder(), torrent)
    if (!magnet) throw new CoreError("the torrent has neither a magnet link nor an info hash, and its provider gave none", 400)
    return { torrent, magnet }
}

/** The file to play: the one the user chose (`fileId`, else `fileIndex`), the only video, or the one whose name numbers the episode */
export function chooseDebridFile(files: DebridFile[], wanted: { fileId?: unknown, fileIndex?: unknown, episodeNumber: number }): DebridFile | null {
    if (typeof wanted.fileId === "string" && wanted.fileId) return files.find(file => file.id === wanted.fileId) ?? null
    const chosen = chooseFile(files.map(file => ({ index: file.index, path: file.path, size: file.size, pieceStart: 0, pieceEnd: 0 })), wanted)
    return chosen ? files.find(file => file.index === chosen.index) ?? null : null
}

/**
 * POST /api/v1/debrid/torrents/file-previews: the video files of a torrent as the service lists them, each with the
 * episode its name numbers and the service's id of the file (`DebridClient_FilePreview`). The torrent is added to the
 * account for this, as the service needs it to read the files.
 */
export async function debridFilePreviews(request: CoreRequest, environment: CoreEnvironment, finder?: TorrentFinder): Promise<Json[]> {
    const body = bodyOf(request)
    const { provider, settings } = await debridProviderOf(environment)
    const { magnet } = await torrentOf({ ...body, autoSelect: false }, settings, finder)
    const run: Run = { cancelled: false, provider, id: await provider.add(magnet) }
    const item = await until(run, one => (one.files?.length ?? 0) > 0, debridTiming.filesPatienceMs)
    const episodeNumber = whole(body.episodeNumber)
    return (item.files ?? []).filter(file => VIDEO.test(file.path)).map(file => {
        const { episode } = episodeOfName(file.path)
        return {
            path: file.path,
            displayPath: file.path.slice(0, Math.max(0, file.path.length - file.name.length - 1)),
            displayTitle: episode ? `Episode ${episode}` : file.name,
            episodeNumber: episode,
            relativeEpisodeNumber: episode,
            isLikely: episode !== 0 && episode === episodeNumber,
            index: file.index,
            fileId: file.id,
        }
    })
}

/**
 * POST /api/v1/debrid/stream/start: adds the torrent to the service, chooses the episode's file, waits until the
 * service has it, and hands its direct address to the app's player ("watch", `streamType` "debrid") → true. Meanwhile
 * `debrid-stream-state` tells what happens (`DebridClient_StreamState`). "none"/"noneAndAwait" only prepare.
 */
export async function startDebridStream(request: CoreRequest, environment: CoreEnvironment, finder?: TorrentFinder): Promise<true> {
    const body = bodyOf(request)
    const mediaId = whole(body.mediaId)
    const episodeNumber = whole(body.episodeNumber)
    if (!mediaId) throw new CoreError("mediaId must be a number", 400)
    const playback = typeof body.playbackType === "string" ? body.playbackType : "nativeplayer"
    if (playback === "externalPlayerLink") throw new CoreError("a debrid stream of the core is played by the app's own player only", 400)
    // before anything else: no service, no key → an error at once
    const { provider, settings } = await debridProviderOf(environment)
    const shown = playback === "nativeplayer" || playback === "default"
    let name = ""
    const state = (status: "downloading" | "ready" | "failed" | "started", message: string) => emitCoreEvent("debrid-stream-state", { status, torrentName: name, message })
    const tell = (words: string) => {
        if (shown) emitCoreEvent("native-player", { type: "open-and-await", payload: words })
    }
    const run: Run = { cancelled: false, provider, id: "" }
    current = run
    try {
        state("started", "")
        if (!isRecord(body.torrent)) tell("Looking for a torrent…")
        const { torrent, magnet } = await torrentOf(body, settings, finder)
        name = typeof torrent.name === "string" ? torrent.name : ""
        tell("Adding the torrent to the debrid service…")
        state("downloading", "Adding the torrent")
        run.id = await provider.add(magnet)

        tell("Waiting for the torrent's file list…")
        const listed = await until(run, item => (item.files?.length ?? 0) > 0 || item.isReady, debridTiming.filesPatienceMs)
        let files = listed.files ?? []
        // a service that lists files only when the torrent is ready (AllDebrid, Premiumize) lists them now
        if (!files.length) files = (await provider.item(run.id)).files ?? []
        const file = chooseDebridFile(files, { fileId: body.fileId, fileIndex: body.fileIndex, episodeNumber })
        if (!file) throw new CoreError(`no file of the torrent fits episode ${episodeNumber}`, 404)
        await provider.choose?.(run.id, file)

        tell("Waiting for the debrid service…")
        await until(run, item => item.isReady, debridTiming.readyPatienceMs, item => {
            if (!item.isReady) state("downloading", `${item.completionPercentage}%`)
        })
        const address = await provider.link(run.id, file)
        if (run.cancelled) throw new CoreError("debrid: the stream was cancelled", 400)
        state("ready", "")
        if (shown) {
            emitCoreEvent("native-player", {
                type: "watch",
                payload: {
                    id: `core-debrid-${environment.now()}`,
                    streamType: "debrid",
                    streamPath: file.path,
                    mimeType: mimeOf(file.path),
                    streamUrl: address,
                    contentLength: file.size,
                    ...(await playerExtrasOf(environment, mediaId, episodeNumber)),
                    isNakamaWatchParty: false,
                },
            })
        }
        return true
    }
    catch (error) {
        const words = error instanceof Error ? error.message : String(error)
        state("failed", words)
        if (shown) emitCoreEvent("native-player", { type: "abort-open", payload: words })
        throw error
    }
    finally {
        if (current === run) current = null
    }
}

/** POST /api/v1/debrid/stream/cancel: the waiting stream stops; `removeTorrent` deletes its torrent at the service → true */
export async function cancelDebridStream(request: CoreRequest): Promise<true> {
    const options = bodyOf(request).options
    const run = current
    if (!run) return true
    run.cancelled = true
    current = null
    if (isRecord(options) && options.removeTorrent === true && run.id) await run.provider.remove(run.id)
    return true
}
