// geschrieben nach: Befund der Offline-Schnittstellen der App (Form von Snapshot, Item und Ereignis: native/src/api/generated/types.ts MobileOffline_*, Aufrufer und Felder der Anfragen in native/src/api/hooks/mobile_offline.hooks.ts, offline-library.ts, onlinestream-source.ts), docs/NATIVE-UMBAU.md (Verhalten: Warteschlange, „Nur WLAN“, Fehlerklassen, Ablage je Folge, Fortsetzen), docs/EIGENER-KERN.md §4m (Quelle über die Erweiterung) und §4o (Lader, Phase 4b-B; Hintergrund-Kette, Bremse, Bilder und Angaben, Phase 4b-C1; alte Downloads des Servers, Phase 4c), RFC 9110 §10.2.3 (Retry-After), React-Native-Doku „Headless JS“ (Zeitgeber, während die App nicht vorn ist); kein Server-Quelltext

import { eq } from "drizzle-orm"
import { inOrder } from "../database/database"
import { anilistMedia, offlineItems, offlineMoves, offlineSettings, watchPositions } from "../database/schema"
import { type LoaderEvent, type LoaderPart, type LoaderRequest, type NativeLoader, retryAfterMs, worthAnotherTry } from "../download/loader"
import { CoreError } from "../errors"
import { emitCoreEvent } from "../events"
import type { CoreEnvironment } from "../registry"
import { HlsUnavailable, chooseAudio, chooseVariant, isMasterPlaylist, readMaster, readMedia } from "./hls"
import type { OldChapterFolder } from "../manga/legacy"
import { oldEpisodes } from "./legacy"
import { watchedToDelete } from "./auto-delete"
import { appSwitchesOf, incognitoOn } from "../settings/incognito"
import { storedEntry } from "../anilist/store"
import { episodesToPrefetch, prefetchBlock, watchingEpisode } from "./prefetch"

/*
 * Episodes saved for watching without a network (phase 4b-B, area `offline`). The queue, its states and the tries
 * after a failure live here and in core.db; the files are loaded by the device's loader (download/loader.ts), one run
 * per episode: the picture's file (a plain file, or the segments of an HLS stream joined to one), its own sound when
 * the stream has one, and the subtitles. The source of an episode queued from a list is asked from its provider's
 * extension when its turn comes (streams/onlinestream.ts), because the addresses of providers stop working after a
 * while; an episode saved from the player brings its address along.
 *
 * The answers and the event have the form the screens know from the server: the whole snapshot each time.
 */

export const OFFLINE_EVENT = "mobile-offline-updated"

export const OFFLINE_FAILURES = ["SOURCE_REFUSED", "CONNECTION", "STORAGE_FULL", "SOURCE_UNAVAILABLE", "UNKNOWN"] as const
export type OfflineFailure = typeof OFFLINE_FAILURES[number]

export const OFFLINE_STATES = ["queued", "resolving", "downloading", "paused", "failed", "ready"] as const
export type OfflineStatus = typeof OFFLINE_STATES[number]

export type OfflineNetwork = { known: boolean, connected: boolean, metered: boolean }

export type OfflineSubtitle = { file: string, language: string, label: string, default: boolean, mime: string }

export type OfflineItem = {
    id: string
    key: string
    status: OfflineStatus
    ready: boolean
    mediaId: number
    provider: string
    /** The episode's number as text */
    episode: string
    dubbed: boolean
    quality: string
    server: string
    audioLanguage: string
    /** 0 to 1 */
    progress: number
    bytes: number
    /** Where the user stopped watching, in milliseconds */
    position: number
    failure?: OfflineFailure
    error?: string
    /** The names of the files in the episode's folder */
    files: { video?: string, audio?: string, subtitles?: OfflineSubtitle[] }
    order: number
    title?: string
    /** What the kept lists knew about the anime when the episode was queued; missing when they did not */
    description?: string
    genres?: string[]
    year?: number
    format?: string
    totalEpisodes?: number
    /** Minutes of one episode */
    duration?: number
    score?: number
    coverUrl?: string
    bannerUrl?: string
    episodeTitle?: string
    episodeImageUrl?: string
    episodeDescription?: string
    airDate?: string
    /** The names of the saved pictures in `artwork/`, once they are on the device */
    coverAsset?: string
    bannerAsset?: string
    episodeImageAsset?: string
    /** Every picture the episode names is saved on the device */
    metadataSaved: boolean
    /** When the episode was last watched to its 80 % or end (position with `watched`); "Delete watched episodes" reads it */
    watchedAt?: number
    /** Loads on Wi-Fi only, whatever the "Wi-Fi only" setting says (an episode queued ahead, prefetch.ts) */
    wifiOnly?: boolean
}

export type OfflineSnapshot = { items: OfflineItem[], wifiOnly: boolean, network: OfflineNetwork, waiting: "" | "wifi" | "internet" }

/** What the device gives the downloads: its loader, the folder of the files and the state of the network */
export type OfflineDevice = {
    loader: NativeLoader
    /** The folder of the offline files as a file address, without a slash at its end */
    root: string
    /** The folder of the saved manga chapters as a file address, without a slash at its end (phase 4b-C2); missing: none */
    mangaRoot?: string
    /** Removes a folder with everything in it; a folder that is not there is fine */
    removeFolder: (address: string) => Promise<void>
    network: () => Promise<OfflineNetwork>
    /** Hears every change of the network from now on. The returned function ends that. */
    onNetwork: (listener: (network: OfflineNetwork) => void) => () => void
    /** Whether a file is there, asked off the app's thread; missing: the device cannot say, no picture counts as saved */
    has?: (address: string) => Promise<boolean>
    /**
     * Shows the notice at the end of an episode ("finished", or "failed" once no try is left). The device does it by
     * itself, the timers of the app stand still while it is not in front. Missing: no notice (the tests).
     */
    notify?: (item: OfflineItem, outcome: "finished" | "failed") => void
    /**
     * Asks the device to call the listener of `onWake` after about so many milliseconds, also when the app sleeps by
     * then (no download runs, the system has put the process to rest); null: not needed any more.
     */
    wakeIn?: (ms: number | null) => void
    onWake?: (listener: () => void) => () => void
    /** The server's folder of saved episodes as a file address, without a slash at its end (phase 4c); missing: none */
    oldRoot?: string
    /** The text of the server's list of saved episodes, read only; null: there is none */
    oldQueue?: () => Promise<string | null>
    /** The server's folder of saved manga chapters as a file address, without a slash at its end (phase 4c-2); missing: none */
    oldMangaRoot?: string
    /** The folders in the server's manga folder, read only: name, file names, text of `registry.json` (null: none) */
    oldManga?: () => Promise<OldChapterFolder[]>
    /** Writes one line to the app's log (the take-over at the start says what it did) */
    told?: (line: string) => void
    /** The free bytes of the storage the files go to; null or missing: the device cannot say */
    freeBytes?: () => Promise<number | null>
}

type SourceRequest = { mediaId: number, provider: string, episodeNumber: number, dubbed: boolean, refresh: boolean }

export type OfflineEnvironment = {
    core: Pick<CoreEnvironment, "fetch" | "now" | "pause" | "database" | "unasked">
    device: OfflineDevice
    /** The sources of an episode from its provider, in the form of POST /onlinestream/episode-source */
    sources: (request: SourceRequest) => Promise<unknown>
    /**
     * An anime and its main episodes as the core builds them (library.ts animeWithEpisodes): how many are out, and the
     * episodes' titles and pictures. Missing: nothing is queued ahead ("Download next episodes automatically").
     */
    episodes?: (mediaId: number) => Promise<{ media: Json, episodes: Json[], out: number }>
}

type Json = Record<string, unknown>

type Subtitle = { url: string, language: string, isDefault: boolean }

/** An address with what it needs to be loaded */
type Direct = { url: string, type: string, headers: Record<string, string>, subtitles: Subtitle[] }

/** How the files of an episode are found: `direct` is the address the player had open; without it the provider is asked */
type Source = { direct?: Direct, old?: true }

type Row = { item: OfflineItem, source: Source, tries: number, retryAt: number }

/** How many episodes load at the same time; the others wait in their order */
export const AT_ONCE = 2
/** The pauses before the tries after a failure that another try may heal; after the last one the episode has failed */
export const RETRY_PAUSES_MS = [15_000, 60_000, 5 * 60_000]
/** The snapshot goes out at most this often while only the progress changes */
export const PROGRESS_EVERY_MS = 1_000
/** A playlist that does not answer for this long counts as a broken connection */
const PLAYLIST_PATIENCE_MS = 30_000
/** The longest wait of a source (Retry-After) the queue keeps to before a new try */
export const LONGEST_WAIT_MS = 30 * 60_000

const UNKNOWN_NETWORK: OfflineNetwork = { known: false, connected: true, metered: false }

type Service = {
    environment: OfflineEnvironment
    rows: Map<string, Row>
    wifiOnly: boolean
    network: OfflineNetwork
    /** The episodes that hold a place: their source is being found or their files load */
    active: Set<string>
    ends: (() => void)[]
    retryTimer: ReturnType<typeof setTimeout> | null
    progressTimer: ReturnType<typeof setTimeout> | null
    /** The time the device was asked to come back at (the next try of an episode); 0: not asked */
    wakeAt: number
}

let service: Promise<Service> | null = null
let filesRoot: string | null = null
/** The episodes taken over from the server (phase 4c): their files and pictures stay in the server's folder */
let oldRoot: string | null = null
const oldIds = new Set<string>()
const oldAssets = new Set<string>()
/** `core?move=again` came before the service began: its start takes them over again */
let oldAgain = false

/** The address of a saved picture (coverAsset, bannerAsset, episodeImageAsset) on the device; null like offlineFileAddress */
export function offlineArtworkAddress(asset: string): string | null {
    if (!filesRoot) return null
    return `${oldAssets.has(asset) && oldRoot ? oldRoot : filesRoot}/artwork/${encodeURIComponent(asset)}`
}

/**
 * The address of a saved file for the player, straight from the device's storage; null while the area is off or the
 * core has not looked at its downloads yet (the server delivers the file then).
 */
export function offlineFileAddress(id: string, file: string): string | null {
    if (!filesRoot) return null
    return `${oldIds.has(id) && oldRoot ? oldRoot : filesRoot}/episodes/${encodeURIComponent(id)}/${encodeURIComponent(file)}`
}

/** Ends the core's work on the downloads and forgets what it kept in memory (the tests; the files and rows stay) */
export async function forgetOfflineService(): Promise<void> {
    const running = service
    service = null
    filesRoot = null
    oldRoot = null
    oldIds.clear()
    oldAssets.clear()
    const s = await running?.catch(() => null)
    if (!s) return
    s.ends.forEach(end => end())
    if (s.retryTimer) clearTimeout(s.retryTimer)
    if (s.progressTimer) clearTimeout(s.progressTimer)
    if (s.wakeAt !== 0) s.environment.device.wakeIn?.(null)
}

// ---- small helpers ----

function isRecord(value: unknown): value is Json {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

const text = (value: unknown): string => typeof value === "string" ? value : ""

function withoutUndefined<T extends object>(value: T): T {
    return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T
}

function headersOf(value: unknown): Record<string, string> {
    return isRecord(value) ? Object.fromEntries(Object.entries(value).map(([name, field]) => [name, String(field)])) : {}
}

function subtitlesOf(value: unknown): Subtitle[] {
    return (Array.isArray(value) ? value : []).filter(isRecord).filter(subtitle => /^https?:\/\//i.test(text(subtitle.url)))
        .map(subtitle => ({ url: text(subtitle.url), language: text(subtitle.language), isDefault: subtitle.isDefault === true }))
}

/** The ending of an address's file when it is one of the known ones, else the fallback */
function endingOf(address: string, known: string[], fallback: string): string {
    const ending = /\.([a-z0-9]{2,4})$/i.exec(address.split(/[?#]/)[0]!)?.[1]?.toLowerCase() ?? ""
    return known.includes(ending) ? ending : fallback
}

const SUBTITLE_KINDS: Record<string, string> = { vtt: "text/vtt", srt: "application/x-subrip", ass: "text/x-ssa", ssa: "text/x-ssa" }

/** Runs work no request started (an event of the loader, a timer) so that the host sees it like a request */
function unasked(s: Service, what: string, work: () => Promise<unknown>): void {
    const run = s.environment.core.unasked
    void (run ? run(`offline: ${what}`, work) : work()).catch(() => undefined)
}

// ---- the state ----

/** Why nothing may load now, whatever waits: "" when it may */
function blockOf(s: Service): "" | "wifi" | "internet" {
    if (s.network.known && !s.network.connected) return "internet"
    // a network the device has not told about yet counts as mobile data: "Wi-Fi only" waits until it is known
    if (s.wifiOnly && (!s.network.known || s.network.metered)) return "wifi"
    return ""
}

/** Why this episode may not load now: what holds every episode, or Wi-Fi for one that loads on Wi-Fi only */
function rowBlockOf(s: Service, row: Row): "" | "wifi" | "internet" {
    const block = blockOf(s)
    if (block !== "") return block
    return row.item.wifiOnly === true && (!s.network.known || s.network.metered) ? "wifi" : ""
}

const wantsToLoad = (row: Row) => row.item.status === "queued" || row.item.status === "resolving" || row.item.status === "downloading"

function snapshotOf(s: Service): OfflineSnapshot {
    const rows = [...s.rows.values()].sort((a, b) => a.item.order - b.item.order)
    const wanting = rows.filter(wantsToLoad)
    // waiting for Wi-Fi also when only episodes that load on Wi-Fi only are left to load
    const held = wanting.map(row => rowBlockOf(s, row))
    return {
        items: rows.map(row => withoutUndefined({ ...row.item, files: { ...row.item.files } })),
        wifiOnly: s.wifiOnly,
        network: { ...s.network },
        waiting: wanting.length === 0 ? "" : blockOf(s) || (held.every(block => block === "wifi") ? "wifi" : ""),
    }
}

function tell(s: Service): void {
    if (s.progressTimer) clearTimeout(s.progressTimer)
    s.progressTimer = null
    emitCoreEvent(OFFLINE_EVENT, snapshotOf(s))
}

function tellSoon(s: Service): void {
    s.progressTimer ??= setTimeout(() => {
        s.progressTimer = null
        emitCoreEvent(OFFLINE_EVENT, snapshotOf(s))
    }, PROGRESS_EVERY_MS)
}

async function store(s: Service, row: Row): Promise<void> {
    const database = await s.environment.core.database()
    const values = {
        id: row.item.id,
        mediaId: row.item.mediaId,
        queueOrder: row.item.order,
        status: row.item.status,
        item: withoutUndefined(row.item) as Json,
        source: row.source as Json,
        tries: row.tries,
        retryAt: row.retryAt,
        changedAt: s.environment.core.now(),
    }
    await inOrder(database, () => database.insert(offlineItems).values(values).onConflictDoUpdate({ target: offlineItems.id, set: values }))
}

/** Changes an episode, writes it down and tells the screens. An episode that neither finds its source nor loads gives its place back. */
async function change(s: Service, row: Row, fields: Partial<OfflineItem>): Promise<void> {
    row.item = { ...row.item, ...fields }
    row.item.ready = row.item.status === "ready"
    if (row.item.status !== "resolving" && row.item.status !== "downloading") s.active.delete(row.item.id)
    // removed in the meantime: nothing to write
    if (s.rows.get(row.item.id) !== row) return
    await store(s, row)
    tell(s)
}

// ---- finding the files of an episode ----

class SourceRefused extends Error {
    readonly status: number
    /** The wait the source asked for (Retry-After) in milliseconds, 0 when it named none */
    readonly wait: number

    constructor(status: number, wait: number) {
        super(`the source answered ${status}`)
        this.name = "SourceRefused"
        this.status = status
        this.wait = wait
    }
}

async function playlistOf(core: Pick<CoreEnvironment, "fetch" | "now">, url: string, headers: Record<string, string>): Promise<string> {
    const patience = new AbortController()
    const timer = setTimeout(() => patience.abort(), PLAYLIST_PATIENCE_MS)
    try {
        const answer = await core.fetch(url, { method: "GET", headers, signal: patience.signal })
        if (answer.status < 200 || answer.status >= 300) throw new SourceRefused(answer.status, retryAfterMs(answer.headers.get("retry-after"), core.now()) ?? 0)
        return await answer.text()
    }
    finally {
        clearTimeout(timer)
    }
}

const PICTURE_ENDINGS = ["jpg", "jpeg", "png", "webp", "avif", "gif"]

type Picture = { field: "coverAsset" | "bannerAsset" | "episodeImageAsset", url: string, name: string }

/**
 * The pictures an episode names, with the names they are saved under in `artwork/`. Every episode has its own, so two
 * episodes of one anime that load at the same time never write the same file, and removing one takes only its own.
 */
function picturesOf(item: OfflineItem): Picture[] {
    const named: [Picture["field"], string, string | undefined][] = [["coverAsset", "cover", item.coverUrl], ["bannerAsset", "banner", item.bannerUrl], ["episodeImageAsset", "episode", item.episodeImageUrl]]
    return named.flatMap(([field, kind, url]) => url && /^https?:\/\//i.test(url) ? [{ field, url, name: `${item.id}-${kind}.${endingOf(url, PICTURE_ENDINGS, "jpg")}` }] : [])
}

/** The language of a stream's own sound as the screens name it, when it is the one that was asked for; else "" */
function soundLanguage(language: string, dubbed: boolean): string {
    const wanted = dubbed ? ["de", "ger", "deu"] : ["ja", "jp"]
    return wanted.some(start => language.toLowerCase().startsWith(start)) ? wanted[0]! : ""
}

/** The provider's source for the episode: of the wanted server when it has one, in the wanted quality when it is named */
async function providerSource(s: Service, row: Row): Promise<Direct> {
    const item = row.item
    const answer = await s.environment.sources({
        mediaId: item.mediaId,
        provider: item.provider,
        episodeNumber: Number(item.episode),
        dubbed: item.dubbed,
        // after a failure the addresses the core kept may be the reason
        refresh: row.tries > 0,
    })
    const sources = (isRecord(answer) && Array.isArray(answer.videoSources) ? answer.videoSources : []).filter(isRecord).filter(source => text(source.url) !== "")
    const ofServer = item.server === "" ? sources : sources.filter(source => text(source.server) === item.server)
    const pool = ofServer.length > 0 ? ofServer : sources
    const wanted = item.quality.toLowerCase()
    const chosen = pool.find(source => text(source.quality).toLowerCase() === wanted) ?? pool.find(source => /auto|default/i.test(text(source.quality))) ?? pool[0]
    if (!chosen) throw new CoreError(`${item.provider}: no video sources found for episode ${item.episode}`, 404)
    return { url: text(chosen.url), type: text(chosen.type), headers: headersOf(chosen.headers), subtitles: subtitlesOf(chosen.subtitles) }
}

/**
 * The loader's request for an episode and the names its files will have. The subtitles come first: they are small, and
 * the bar then runs with the picture's parts to its end.
 */
async function planOf(s: Service, row: Row): Promise<{ request: LoaderRequest, files: OfflineItem["files"], audioLanguage: string }> {
    const { core, device } = s.environment
    const item = row.item
    const source = row.source.direct ?? await providerSource(s, row)
    const folder = `${device.root}/episodes/${item.id}`
    const parts: LoaderPart[] = []
    const files: OfflineItem["files"] = {}
    const subtitles = source.subtitles.map((subtitle, index) => {
        const ending = endingOf(subtitle.url, Object.keys(SUBTITLE_KINDS), "vtt")
        const file = `subtitle-${index}.${ending}`
        parts.push({ url: subtitle.url, path: `${folder}/${file}`, weight: 0 })
        return { file, language: subtitle.language, label: subtitle.language, default: subtitle.isDefault, mime: SUBTITLE_KINDS[ending]! }
    })
    if (subtitles.length > 0) files.subtitles = subtitles

    let audioLanguage = ""
    if (source.type === "m3u8" || /\.m3u8$/i.test(source.url.split(/[?#]/)[0]!)) {
        await core.pause("offline: playlist")
        let address = source.url
        let playlist = await playlistOf(core, address, source.headers)
        let sound: { parts: LoaderPart[], ending: string } | null = null
        if (isMasterPlaylist(playlist)) {
            const master = readMaster(playlist, address)
            const variant = chooseVariant(master.variants, item.quality)
            if (!variant) throw new HlsUnavailable("the playlist names no stream")
            const rendition = chooseAudio(master, variant, item.dubbed)
            address = variant.url
            playlist = await playlistOf(core, address, source.headers)
            if (rendition) {
                const list = await playlistOf(core, rendition.url, source.headers)
                // reading a list of some hundred segments is a piece of its own (the first after the app's start took 14.7 ms with the picture's list and the request in one)
                await core.pause("offline: sound parts")
                const media = readMedia(list, rendition.url)
                sound = { parts: media.parts, ending: media.hasMap ? "m4a" : endingOf(media.parts[0]!.url, ["aac", "mp3"], "ts") }
                audioLanguage = soundLanguage(rendition.language, item.dubbed)
            }
        }
        await core.pause("offline: parts")
        const media = readMedia(playlist, address)
        await core.pause("offline: request")
        files.video = `video.${media.hasMap ? "mp4" : "ts"}`
        for (const part of media.parts) parts.push({ ...part, path: `${folder}/${files.video}` })
        if (sound) {
            files.audio = `audio.${sound.ending}`
            for (const part of sound.parts) parts.push({ ...part, path: `${folder}/${files.audio}` })
        }
    }
    else {
        files.video = `video.${endingOf(source.url, ["mp4", "mkv", "webm", "m4v", "mov"], "mp4")}`
        parts.push({ url: source.url, path: `${folder}/${files.video}` })
    }
    // the pictures last: the episode does not wait for them, and it is ready without them when their source gives none
    for (const picture of picturesOf(item)) parts.push({ url: picture.url, path: `${device.root}/artwork/${picture.name}`, weight: 0, extra: true })
    const title = [item.title, item.episode ? `Episode ${item.episode}` : ""].filter(Boolean).join(" · ") || "Download"
    return {
        files,
        audioLanguage,
        request: { id: item.id, url: parts[0]!.url, headers: source.headers, path: `${folder}/${files.video}`, title, parts, continueParts: true },
    }
}

/** What went wrong while finding the files, as the screens' failure, and whether a later try may heal it */
function planFailure(error: unknown, row: Row): { failure: OfflineFailure, again: boolean, wait?: number } {
    if (error instanceof HlsUnavailable) return { failure: "SOURCE_UNAVAILABLE", again: false }
    if (error instanceof SourceRefused) return { failure: "SOURCE_REFUSED", again: refusedAgain(row, error.status), wait: error.wait }
    // the provider has no such episode or no source, or its extension failed
    if (error instanceof CoreError) return { failure: "SOURCE_UNAVAILABLE", again: false }
    // fetch could not reach the source, or the patience ran out
    if (error instanceof TypeError || (error instanceof Error && error.name === "AbortError")) return { failure: "CONNECTION", again: true }
    return { failure: "UNKNOWN", again: false }
}

/**
 * A refusal that describes the moment is tried again (loader.ts). Any other refusal of an address the provider gave
 * gets one new try with a freshly asked source: such addresses run out. The player's own address cannot be asked anew.
 */
function refusedAgain(row: Row, status: number | null): boolean {
    return worthAnotherTry({ kind: "SOURCE_REFUSED", httpStatus: status }) || (!row.source.direct && row.tries === 0)
}

// ---- the queue ----

/** `wait`: what the source asked for with its refusal (Retry-After); the next try never comes sooner */
async function failed(s: Service, row: Row, failure: OfflineFailure, error: string, again: boolean, wait = 0): Promise<void> {
    if (again && row.tries < RETRY_PAUSES_MS.length) {
        row.retryAt = s.environment.core.now() + Math.max(RETRY_PAUSES_MS[row.tries]!, Math.min(wait, LONGEST_WAIT_MS))
        row.tries += 1
        await change(s, row, { status: "queued" })
    }
    else {
        await change(s, row, { status: "failed", failure, error })
        if (s.rows.get(row.item.id) === row) s.environment.device.notify?.(row.item, "failed")
    }
    pump(s)
}

async function finish(s: Service, row: Row, bytes: number): Promise<void> {
    const { core, device } = s.environment
    row.tries = 0
    row.retryAt = 0
    // the pictures that came with the files: from now on the screens take them from the device
    const pictures = picturesOf(row.item)
    const saved: Partial<Record<Picture["field"], string>> = {}
    for (const picture of pictures) {
        const there = device.has ? await device.has(`${device.root}/artwork/${picture.name}`).catch(() => false) : false
        if (there) saved[picture.field] = picture.name
    }
    await change(s, row, { status: "ready", progress: 1, bytes, failure: undefined, error: undefined, ...saved, metadataSaved: Object.keys(saved).length === pictures.length })
    if (s.rows.get(row.item.id) === row) device.notify?.(row.item, "finished")
    await device.loader.forget(row.item.id).catch(() => undefined)
    // the next episode's start is a piece of its own (with the end of this one it took 14.8 ms while the app was not in front)
    await core.pause("offline: next")
    pump(s)
}

/** An episode takes its turn: find its files, hand them to the loader. Paused or removed on the way, it lets go. */
async function begin(s: Service, row: Row): Promise<void> {
    const id = row.item.id
    const mine = () => s.rows.get(id) === row && row.item.status === "resolving"
    // paused or removed between getting the place and taking it
    if (s.rows.get(id) !== row || row.item.status !== "queued") {
        s.active.delete(id)
        return
    }
    try {
        await change(s, row, { status: "resolving", failure: undefined, error: undefined })
        const plan = await planOf(s, row)
        if (!mine()) return
        // handing some hundred parts to the loader is a piece of its own
        await s.environment.core.pause("offline: loader")
        if (!mine()) return
        await s.environment.device.loader.enqueue(plan.request)
        if (!mine()) {
            await s.environment.device.loader.cancel(id).catch(() => undefined)
            return
        }
        await change(s, row, { status: "downloading", files: plan.files, ...(plan.audioLanguage ? { audioLanguage: plan.audioLanguage } : {}) })
    }
    catch (error) {
        if (!mine()) return
        const { failure, again, wait } = planFailure(error, row)
        await failed(s, row, failure, (error instanceof Error ? error.message : String(error)).slice(0, 300), again, wait)
    }
}

/** Gives the free places to the waiting episodes in their order; an episode pausing before a new try is passed over */
function pump(s: Service): void {
    if (s.retryTimer) clearTimeout(s.retryTimer)
    s.retryTimer = null
    if (blockOf(s) !== "") return
    const now = s.environment.core.now()
    let nextTry = Infinity
    const waiting = [...s.rows.values()].filter(row => row.item.status === "queued" && !s.active.has(row.item.id)).sort((a, b) => a.item.order - b.item.order)
    for (const row of waiting) {
        if (s.active.size >= AT_ONCE) break
        if (rowBlockOf(s, row) !== "") continue
        if (row.retryAt > now) {
            nextTry = Math.min(nextTry, row.retryAt)
            continue
        }
        s.active.add(row.item.id)
        unasked(s, "start of a download", () => begin(s, row))
    }
    const { wakeIn } = s.environment.device
    if (nextTry !== Infinity) {
        const wait = Math.max(0, nextTry - now) + 50
        s.retryTimer = setTimeout(() => pump(s), wait)
        // no download may run during the wait; the system then puts the app to rest and the timer with it: the device comes back by itself
        if (wakeIn && s.wakeAt !== nextTry) {
            s.wakeAt = nextTry
            wakeIn(wait)
        }
    }
    else if (s.wakeAt !== 0) {
        s.wakeAt = 0
        wakeIn?.(null)
    }
}

async function onLoaderEvent(s: Service, event: LoaderEvent): Promise<void> {
    const row = s.rows.get(event.id)
    if (!row || row.item.status !== "downloading") return
    if (event.type === "progress") {
        const progress = event.fraction ?? (event.total ? event.bytes / event.total : row.item.progress)
        row.item = { ...row.item, progress: Math.min(1, Math.max(0, progress)), bytes: event.bytes }
        tellSoon(s)
    }
    else if (event.type === "done") {
        await finish(s, row, event.bytes)
    }
    else if (event.kind === "CANCELLED") {
        // the user stopped it in the system's list of tasks: it waits until the user lets it go on
        await change(s, row, { status: "paused" })
        pump(s)
    }
    else {
        const failure: OfflineFailure = event.kind === "CONNECTION" || event.kind === "STORAGE_FULL" || event.kind === "SOURCE_REFUSED" ? event.kind : "UNKNOWN"
        const again = event.kind === "SOURCE_REFUSED" ? refusedAgain(row, event.httpStatus) : worthAnotherTry(event)
        await failed(s, row, failure, event.message.slice(0, 300), again, event.retryAfterMs ?? 0)
    }
}

/** The network changed or "Wi-Fi only" did: what may not load any more goes back to waiting (its part stays), else the queue goes on */
async function networkChanged(s: Service): Promise<void> {
    for (const row of s.rows.values()) {
        if (row.item.status !== "resolving" && row.item.status !== "downloading") continue
        if (rowBlockOf(s, row) === "") continue
        await change(s, row, { status: "queued" })
        await s.environment.device.loader.cancel(row.item.id).catch(() => undefined)
    }
    tell(s)
    pump(s)
}

function rowOf(stored: { item: Json, source: Json, tries: number, retryAt: number }): Row {
    return { item: stored.item as unknown as OfflineItem, source: stored.source as Source, tries: stored.tries, retryAt: stored.retryAt }
}

async function start(environment: OfflineEnvironment): Promise<Service> {
    const database = await environment.core.database()
    const s: Service = {
        environment,
        rows: new Map((await database.select().from(offlineItems)).map((stored): [string, Row] => [stored.id, rowOf(stored)])),
        wifiOnly: (await database.select().from(offlineSettings))[0]?.wifiOnly ?? false,
        network: await environment.device.network().catch(() => UNKNOWN_NETWORK),
        active: new Set(),
        ends: [],
        retryTimer: null,
        progressTimer: null,
        wakeAt: 0,
    }
    filesRoot = environment.device.root
    oldRoot = environment.device.oldRoot ?? null
    const again = oldAgain
    oldAgain = false
    const moved = await takeOldEpisodes(s, again).catch(() => null)
    if (moved) environment.device.told?.(`move from the server${again ? " (again)" : ""}: saved episodes taken ${moved.taken}, left with the server ${moved.left}`)
    rememberOld(s)
    s.ends.push(environment.device.loader.listen(event => unasked(s, "event of the loader", () => onLoaderEvent(s, event))))
    // the wait before a new try is over, told by the device because the timer may have stood still
    if (environment.device.onWake) s.ends.push(environment.device.onWake(() => unasked(s, "wake", async () => pump(s))))
    s.ends.push(environment.device.onNetwork(network => unasked(s, "network", async () => {
        s.network = network
        await networkChanged(s)
    })))
    // what was on its way when the app ended: finished meanwhile, still held by the system, or to be continued
    for (const row of s.rows.values()) {
        if (row.item.status !== "resolving" && row.item.status !== "downloading") continue
        const status = row.item.status === "downloading" ? await environment.device.loader.status(row.item.id).catch(() => null) : null
        if (status?.state === "done") {
            await finish(s, row, status.bytes)
        }
        else if (status?.state === "running" || status?.state === "queued") {
            s.active.add(row.item.id)
        }
        else {
            await change(s, row, { status: "queued" })
        }
    }
    pump(s)
    return s
}

// ---- the episodes the server saved (phase 4c) ----

const sameEpisode = (a: OfflineItem, b: OfflineItem) => a.mediaId === b.mediaId && a.episode === b.episode && a.dubbed === b.dubbed

function rememberOld(s: Service): void {
    oldIds.clear()
    oldAssets.clear()
    for (const row of s.rows.values()) {
        if (!row.source.old) continue
        oldIds.add(row.item.id)
        for (const asset of [row.item.coverAsset, row.item.bannerAsset, row.item.episodeImageAsset]) if (asset) oldAssets.add(asset)
    }
}

/**
 * Takes the server's finished episodes over, read only: once per core.db (`offline_moves`), or again on purpose. An
 * episode the core has already (same id, or the same episode in the same audio) stays as it is, so another run adds
 * only what is new. null: it ran before; else how many were taken and how many stay with the server. A list that is
 * not readable leaves no note: the next start tries again.
 */
async function takeOldEpisodes(s: Service, again: boolean): Promise<{ taken: number, left: number } | null> {
    const database = await s.environment.core.database()
    if (!again && (await inOrder(database, () => database.select().from(offlineMoves))).length > 0) return null
    const text = await s.environment.device.oldQueue?.() ?? null
    const found = text === null ? { items: [], left: 0 } : oldEpisodes(text)
    const fresh = found.items.filter(item => !s.rows.has(item.id) && ![...s.rows.values()].some(row => sameEpisode(row.item, item)))
    let order = [...s.rows.values()].reduce((highest, row) => Math.max(highest, row.item.order), 0)
    for (const item of fresh) {
        const row: Row = { item: { ...item, order: ++order }, source: { old: true }, tries: 0, retryAt: 0 }
        s.rows.set(item.id, row)
        await store(s, row)
    }
    const note = { count: fresh.length, movedAt: s.environment.core.now() }
    await inOrder(database, () => database.insert(offlineMoves).values({ part: "episodes", ...note }).onConflictDoUpdate({ target: offlineMoves.part, set: note }))
    return { taken: fresh.length, left: found.left + found.items.length - fresh.length }
}

/** Link `core?move=again` (phase 4c): takes the server's finished episodes over again; only new ones are added */
export async function repeatOldEpisodes(): Promise<{ taken: number, left: number } | null> {
    // not begun yet: the start does it (null)
    if (!service) {
        oldAgain = true
        return null
    }
    const s = await service
    const result = await takeOldEpisodes(s, true)
    rememberOld(s)
    tell(s)
    return result
}

/** The one service of the app: begun with the first request, it goes on with what the last start left */
async function serviceOf(environment: OfflineEnvironment): Promise<Service> {
    service ??= start(environment).catch(error => {
        service = null
        throw error
    })
    const s = await service
    // the newest request's environment: its waits are the ones the host watches now
    s.environment = environment
    return s
}

// ---- the request's fields ----

const bodyOf = (body: unknown): Json => isRecord(body) ? body : {}

function mediaIdOf(body: Json): number {
    const value = body.mediaId
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) throw new CoreError("mediaId is required", 400)
    return value
}

/** One episode in one audio is one download, whoever queued it; the id is also the name of its folder */
function idOf(mediaId: number, episode: string, dubbed: boolean): string {
    return `${mediaId}-${episode}-${dubbed ? "dub" : "sub"}`.replace(/[^A-Za-z0-9.-]/g, "_")
}

type NewEpisode = Pick<OfflineItem, "mediaId" | "provider" | "episode" | "dubbed" | "quality" | "server" | "title" | "coverUrl" | "bannerUrl" | "episodeTitle" | "episodeImageUrl" | "episodeDescription" | "wifiOnly"> & { key: string }

/**
 * What the kept lists know about the anime (the title as AniList sent it, anilist_media), so that the downloads' page
 * can describe it without a network. Only what is there; an anime the lists do not hold brings nothing.
 */
async function detailsOf(s: Service, mediaId: number): Promise<Partial<OfflineItem>> {
    try {
        const database = await s.environment.core.database()
        const media = (await inOrder(database, () => database.select({ content: anilistMedia.content }).from(anilistMedia).where(eq(anilistMedia.anilistId, mediaId))))[0]?.content
        if (!isRecord(media)) return {}
        const amount = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
        const genres = (Array.isArray(media.genres) ? media.genres : []).filter((genre): genre is string => typeof genre === "string" && genre !== "")
        return withoutUndefined({
            description: text(media.description) || undefined,
            genres: genres.length > 0 ? genres : undefined,
            year: amount(media.seasonYear) ?? amount(isRecord(media.startDate) ? media.startDate.year : undefined),
            format: text(media.format) || undefined,
            totalEpisodes: amount(media.episodes),
            duration: amount(media.duration),
            score: amount(media.meanScore),
        })
    }
    catch {
        return {}
    }
}

/**
 * Puts an episode at the end of the queue. One that is already there stays as it is, unless it has failed: then it is
 * queued anew with what the request says. Returns the row and whether it was put in now.
 */
async function enqueue(s: Service, wanted: NewEpisode, source: Source): Promise<{ row: Row, added: boolean }> {
    const id = idOf(wanted.mediaId, wanted.episode, wanted.dubbed)
    const known = s.rows.get(id)
    if (known && known.item.status !== "failed") {
        // queued ahead and now wanted by the user: it loads like every other episode
        if (known.item.wifiOnly === true && wanted.wifiOnly !== true) await change(s, known, { wifiOnly: undefined })
        return { row: known, added: false }
    }
    const order = known?.item.order ?? [...s.rows.values()].reduce((highest, row) => Math.max(highest, row.item.order), 0) + 1
    const item: OfflineItem = {
        ...await detailsOf(s, wanted.mediaId),
        ...withoutUndefined(Object.fromEntries(Object.entries(wanted).map(([name, value]) => [name, value === "" ? undefined : value])) as Partial<NewEpisode>),
        id,
        key: wanted.key || id,
        status: "queued",
        ready: false,
        mediaId: wanted.mediaId,
        provider: wanted.provider,
        episode: wanted.episode,
        dubbed: wanted.dubbed,
        quality: wanted.quality,
        server: wanted.server,
        // not known before the files are there; the screens compare by `dubbed` then
        audioLanguage: "",
        progress: 0,
        bytes: 0,
        position: known?.item.position ?? 0,
        files: {},
        order,
        metadataSaved: false,
    }
    const row: Row = { item, source, tries: 0, retryAt: 0 }
    s.rows.set(id, row)
    await store(s, row)
    return { row, added: true }
}

// ---- the answers ----

/** GET /api/v1/mobile-offline/snapshot */
export async function offlineSnapshot(environment: OfflineEnvironment): Promise<OfflineSnapshot> {
    return snapshotOf(await serviceOf(environment))
}

/** POST /api/v1/mobile-offline/batch: queues the picked episodes of an anime; returns how many were new */
export async function offlineBatch(environment: OfflineEnvironment, body: unknown): Promise<number> {
    const request = bodyOf(body)
    const mediaId = mediaIdOf(request)
    const provider = text(request.provider)
    if (provider === "") throw new CoreError("provider is required", 400)
    const s = await serviceOf(environment)
    let added = 0
    for (const episode of (Array.isArray(request.episodes) ? request.episodes : []).filter(isRecord)) {
        // downloads take whole episode numbers only
        if (typeof episode.number !== "number" || !Number.isInteger(episode.number) || episode.number < 0) continue
        const result = await enqueue(s, {
            key: "",
            mediaId,
            provider,
            episode: String(episode.number),
            dubbed: request.dubbed === true,
            quality: text(request.quality) || "Auto",
            server: text(request.server),
            title: text(request.title),
            coverUrl: text(request.coverUrl),
            bannerUrl: text(request.bannerUrl),
            episodeTitle: text(episode.title),
            episodeImageUrl: text(episode.image),
            episodeDescription: text(episode.description),
        }, {})
        if (result.added) added += 1
    }
    if (added > 0) tell(s)
    pump(s)
    return added
}

/** POST /api/v1/mobile-offline/download: saves the episode the player has open, from the address it plays */
export async function offlineDownload(environment: OfflineEnvironment, body: unknown): Promise<OfflineItem> {
    const request = bodyOf(body)
    const mediaId = mediaIdOf(request)
    const url = text(request.url)
    if (!/^https?:\/\//i.test(url)) throw new CoreError("url is required", 400)
    const episode = text(request.episode)
    if (!/^\d+$/.test(episode)) throw new CoreError("episode is required", 400)
    const s = await serviceOf(environment)
    const { row, added } = await enqueue(s, {
        key: text(request.key),
        mediaId,
        provider: "",
        episode,
        dubbed: request.dubbed === true,
        quality: text(request.quality) || "Auto",
        server: "",
        title: text(request.title),
        coverUrl: text(request.coverUrl),
        bannerUrl: text(request.bannerUrl),
        episodeTitle: text(request.episodeTitle),
        episodeImageUrl: text(request.episodeImageUrl),
        episodeDescription: text(request.episodeDescription),
    }, { direct: { url, type: text(request.type), headers: headersOf(request.headers), subtitles: subtitlesOf(request.subtitles) } })
    if (added) tell(s)
    pump(s)
    return withoutUndefined({ ...row.item })
}

/** POST /api/v1/mobile-offline/action: pause, resume, retry, remove */
export async function offlineAction(environment: OfflineEnvironment, body: unknown): Promise<true> {
    const request = bodyOf(body)
    const s = await serviceOf(environment)
    const row = s.rows.get(text(request.id))
    if (!row) throw new CoreError("invalid id")
    const { loader } = s.environment.device
    const id = row.item.id
    switch (request.action) {
        case "pause":
            if (wantsToLoad(row)) {
                await change(s, row, { status: "paused" })
                // the part on disk stays for the time it goes on
                await loader.cancel(id).catch(() => undefined)
            }
            break
        case "resume":
            if (row.item.status === "paused") {
                row.retryAt = 0
                await change(s, row, { status: "queued" })
            }
            break
        case "retry":
            if (row.item.status === "failed") {
                row.tries = 0
                row.retryAt = 0
                await change(s, row, { status: "queued", failure: undefined, error: undefined })
            }
            break
        case "remove":
            await removeRow(s, row)
            break
        default:
            throw new CoreError("invalid action", 400)
    }
    pump(s)
    return true
}

/** Removes an episode: its entry, and its files unless they are the server's */
async function removeRow(s: Service, row: Row): Promise<void> {
    const { loader, root, removeFolder } = s.environment.device
    const id = row.item.id
    s.rows.delete(id)
    s.active.delete(id)
    const database = await s.environment.core.database()
    if (row.source.old) {
        // taken over from the server: only the core's entry goes, the files stay the server's (§4o, phase 4c)
        oldIds.delete(id)
        await inOrder(database, () => database.delete(offlineItems).where(eq(offlineItems.id, id)))
        tell(s)
        return
    }
    // the loader lets go of the files first
    await loader.forget(id).catch(() => undefined)
    await removeFolder(`${root}/episodes/${id}`)
    for (const picture of picturesOf(row.item)) await removeFolder(`${root}/artwork/${picture.name}`).catch(() => undefined)
    await inOrder(database, () => database.delete(offlineItems).where(eq(offlineItems.id, id)))
    tell(s)
}

/** "Delete watched episodes" (auto-delete.ts) after `row` was watched; the server's old episodes stay */
async function deleteWatched(s: Service, row: Row): Promise<void> {
    const mode = (await appSwitchesOf(s.environment.core)).deleteWatchedEpisodes
    const own = [...s.rows.values()].filter(other => !other.source.old)
    for (const id of watchedToDelete(own.map(other => other.item), row.item, mode)) {
        const other = s.rows.get(id)
        if (other) await removeRow(s, other)
    }
}

/** POST /api/v1/mobile-offline/settings */
export async function setOfflineSettings(environment: OfflineEnvironment, body: unknown): Promise<true> {
    const wifiOnly = bodyOf(body).wifiOnly === true
    const s = await serviceOf(environment)
    s.wifiOnly = wifiOnly
    const database = await s.environment.core.database()
    const values = { id: 1, wifiOnly, changedAt: s.environment.core.now() }
    await inOrder(database, () => database.insert(offlineSettings).values(values).onConflictDoUpdate({ target: offlineSettings.id, set: values }))
    await networkChanged(s)
    return true
}

/**
 * POST /api/v1/mobile-offline/position: where the user stopped watching a saved episode; never told to AniList.
 * `watched: true` (the player's 80 % or the end, sent when it stops) notes the episode as watched and runs "Delete
 * watched episodes". In incognito mode nothing is kept and nothing deleted.
 */
export async function offlinePosition(environment: OfflineEnvironment, body: unknown): Promise<true> {
    const request = bodyOf(body)
    const s = await serviceOf(environment)
    const row = s.rows.get(text(request.id))
    if (!row) throw new CoreError("invalid id")
    if (await incognitoOn(s.environment.core)) return true
    const position = typeof request.positionMs === "number" && Number.isFinite(request.positionMs) ? Math.max(0, Math.round(request.positionMs)) : 0
    const watched = request.watched === true
    row.item = { ...row.item, position, ...(watched ? { watchedAt: s.environment.core.now() } : {}) }
    await store(s, row)
    if (watched) {
        await deleteWatched(s, row)
        pump(s)
        // the next episodes, from the same provider in the same audio; an episode saved from the player has no provider
        if (row.item.provider !== "") {
            await prefetch(s, [{ mediaId: row.item.mediaId, episode: Number(row.item.episode), provider: row.item.provider, dubbed: row.item.dubbed }])
                .catch(error => s.environment.device.told?.(`download next episodes broke: ${error instanceof Error ? error.message : String(error)}`))
        }
    }
    return true
}

// ---- "Download next episodes automatically" (prefetch.ts) ----

type PrefetchCandidate = { mediaId: number, episode: number, provider: string, dubbed: boolean }

/** How many anime the start of the app looks at, the ones played last first */
const PREFETCH_ANIME = 10

const pictureOf = (value: unknown): string => isRecord(value) ? text(value.extraLarge) || text(value.large) || text(value.medium) : ""

/** Queues the next episodes of these anime when the rules of prefetch.ts allow it; returns a line for the log */
async function prefetch(s: Service, candidates: PrefetchCandidate[]): Promise<string> {
    const { core, device, episodes } = s.environment
    const switches = await appSwitchesOf(core)
    const count = switches.prefetchEpisodes
    const freeBytes = count > 0 && device.freeBytes ? await device.freeBytes().catch(() => null) : null
    const block = prefetchBlock({ count, incognito: switches.incognitoMode, network: s.network, freeBytes })
    if (block !== "" || !episodes) return `nothing ahead (${block || "no episode list"})`
    const database = await core.database()
    let added = 0
    for (const candidate of candidates) {
        const entry = await storedEntry(database, "ANIME", candidate.mediaId)
        // only what is on the "Watching" list
        if (entry?.status !== "CURRENT") continue
        const at = watchingEpisode(typeof entry.progress === "number" ? entry.progress : 0, candidate.episode)
        const saved = new Set([...s.rows.values()].filter(row => row.item.mediaId === candidate.mediaId).map(row => row.item.episode))
        // the episodes are built only when one could be wanted (that may ask the network for their details)
        if (episodesToPrefetch(at, count, Number.MAX_SAFE_INTEGER, saved).length === 0) continue
        const built = await episodes(candidate.mediaId)
        const names = isRecord(built.media.title) ? built.media.title : {}
        const title = text(names.userPreferred) || text(names.romaji) || text(names.english)
        for (const number of episodesToPrefetch(at, count, built.out, saved)) {
            const episode = built.episodes.find(other => other.episodeNumber === number) ?? {}
            const metadata = isRecord(episode.episodeMetadata) ? episode.episodeMetadata : {}
            const result = await enqueue(s, {
                key: "",
                mediaId: candidate.mediaId,
                provider: candidate.provider,
                episode: String(number),
                dubbed: candidate.dubbed,
                quality: "Auto",
                server: "",
                title,
                coverUrl: pictureOf(built.media.coverImage),
                bannerUrl: text(built.media.bannerImage),
                episodeTitle: text(episode.episodeTitle),
                episodeImageUrl: text(metadata.image),
                episodeDescription: text(metadata.summary) || text(metadata.overview),
                // also after it is queued: never on mobile data, whatever the "Wi-Fi only" setting says
                wifiOnly: true,
            }, {})
            if (result.added) added += 1
        }
    }
    if (added > 0) tell(s)
    pump(s)
    return `${added} episode(s) queued ahead`
}

/**
 * POST /api/v1/mobile-offline/prefetch: queues the next episodes of the anime being watched online (prefetch.ts).
 * `providers` is the provider picked per anime (by AniList number), `fallback` the one picked last anywhere, `dubbed`
 * the audio per anime; with `mediaId` only that anime, else the ones with a watch position, played last first. An
 * anime played from a torrent or a file has no provider here and is passed over (the downloads load from providers).
 */
export async function offlinePrefetch(environment: OfflineEnvironment, body: unknown): Promise<string> {
    const request = bodyOf(body)
    const providers = isRecord(request.providers) ? request.providers : {}
    const dubbed = isRecord(request.dubbed) ? request.dubbed : {}
    const fallback = text(request.fallback)
    const only = typeof request.mediaId === "number" ? request.mediaId : null
    const s = await serviceOf(environment)
    const database = await s.environment.core.database()
    const now = s.environment.core.now()
    const positions = (await inOrder(database, () => database.select().from(watchPositions)))
        .filter(row => row.kind === "onlinestream" && (row.expiresAt === null || row.expiresAt > now) && (only === null || row.mediaId === only))
        .sort((a, b) => b.changedAt - a.changedAt)
        .slice(0, PREFETCH_ANIME)
    const candidates = positions.map(row => ({
        mediaId: row.mediaId,
        episode: row.episodeNumber,
        provider: text(providers[String(row.mediaId)]) || fallback,
        dubbed: dubbed[String(row.mediaId)] === true,
    })).filter(candidate => candidate.provider !== "")
    return prefetch(s, candidates)
}

/**
 * POST /api/v1/mobile-offline/network: the screens' report of the network, as they give it to the server. The core
 * hears the device itself (OfflineDevice.onNetwork); the report says the same and is taken the same way.
 */
export async function offlineNetwork(environment: OfflineEnvironment, body: unknown): Promise<true> {
    const request = bodyOf(body)
    const s = await serviceOf(environment)
    const network = { known: true, connected: request.connected !== false, metered: request.metered === true }
    if (network.known !== s.network.known || network.connected !== s.network.connected || network.metered !== s.network.metered) {
        s.network = network
        await networkChanged(s)
    }
    return true
}
