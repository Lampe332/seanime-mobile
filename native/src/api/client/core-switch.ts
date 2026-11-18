// geschrieben nach: docs/EIGENER-KERN.md §3 (der Schalter) und dem App-Code in src/api/client/ (buildSeaQuery, requests.ts); kein Server-Quelltext
import type { PackageEnvironment } from "@/core/account/package"
import { sqlDriverFor } from "@/api/client/core-database"
import { NEEDS_THE_SERVER } from "@/lib/server/without-server"
import { openOldData, secretStore } from "@/api/client/core-move"
import {
    ANILIST_URL,
    anilistSyncState,
    sendWaitingChanges,
    type BackupFile,
    makeBackup,
    restoreBackup,
    type RestoreMode,
    type CoreDatabase,
    type CoreEnvironment,
    CoreError,
    LONGEST_PIECE_MS,
    coreAnswerFor,
    createBlockingWatch,
    hearPlayer,
    hearPlaylist,
    playingOf,
    type PieceWhere,
    type PlayerMessage,
    type PlaylistMessage,
    playlistHearsPlayer,
    torrentHearsPlayer,
    moveFromServer,
    moveFromServerOnce,
    moveSummary,
    type LineWait,
    openCoreDatabase,
    repeatOldChapters,
    repeatOldEpisodes,
    resumeClientAtStart,
    askNakamaStatus,
    nakamaAtStart,
    type NakamaSocket,
    onCoreEvent,
} from "@/core"
import { APP_VARIANT_NAME } from "@/lib/app-variant"
import { logger } from "@/lib/helpers/debug"
import { storage } from "@/lib/storage"
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig, isAxiosError } from "axios"
import { openDatabaseAsync } from "expo-sqlite"

/*
 * The one seam between the hooks and the two things that can answer them (docs/EIGENER-KERN.md): buildSeaQuery asks here
 * first. An interface the core has code for is answered by the core without HTTP; everything else fails at once (below).
 * Since stage 8b-1 the stored area switches (MMKV `seanime-core-areas`) are no longer read: every area is on.
 */

/**
 * A request only the server could answer, while the app runs without it: failed at once, in the form of a failed
 * request to the server (the hooks show their error, the toasts its text), with status 503.
 */
export function serverOffError(method: string, endpoint: string): AxiosError<{ error: string }> {
    const config = { url: endpoint, method } as InternalAxiosRequestConfig
    return asServerError(new CoreError(`${method} ${endpoint.split("?")[0]} ${NEEDS_THE_SERVER}`, 503), config)
}

/*
 * Changing AniList from the core (docs/EIGENER-KERN.md §4f). The throw-away scratch app may only ever change the one
 * test account a link named to it (app-links.ts); until one is named it changes nothing. The other builds change the
 * account that is signed in, unless a link named one for them too.
 */
const WRITE_ACCOUNT_KEY = "seanime-core-write-account"

function onlyAccount(): number | null {
    const named = Number(storage.getString(WRITE_ACCOUNT_KEY))
    if (Number.isSafeInteger(named) && named > 0) return named
    // 0 is nobody's number: nothing can be changed
    return APP_VARIANT_NAME === "scratch" ? 0 : null
}

/** Test and scratch app only (a link): the one AniList account the core may change; null takes the name back */
export function nameCoreWriteAccount(account: number | null) {
    storage.set(WRITE_ACCOUNT_KEY, account === null ? "" : String(account))
}

/**
 * Test and scratch app only (a link): the core's requests to AniList fail as they do without a network, until switched
 * back or the app starts again. The way to try the queue of changes without touching the device's network.
 */
let anilistCut = false

export function cutCoreFromAnilist(cut: boolean) {
    anilistCut = cut
}

export function coreCutFromAnilist(): boolean {
    return anilistCut
}

/** For the sync hint (anilist-sync.tsx): changes waiting for AniList, and whether AniList answers */
export async function coreAnilistSyncState(): Promise<{ waiting: number, reachable: boolean, localAccount: boolean }> {
    return anilistSyncState(coreEnvironment())
}

/** The backup of the app's data (settings → Back up): the core's part, with the app's preferences handed in */
export async function coreMakeBackup(app: { appVersion: string, preferences: Record<string, string> }): Promise<BackupFile> {
    await watch.afterCallersTurn()
    watch.enter("making a backup")
    try {
        return await makeBackup(coreEnvironment(), app)
    }
    finally {
        watch.leave()
    }
}

/** Puts a backup into the core (settings → Restore); returns the preferences the app writes into its store */
export async function coreRestoreBackup(file: BackupFile, mode: RestoreMode, current: { preferences: Record<string, string> }): Promise<{ preferences: Record<string, string> }> {
    await watch.afterCallersTurn()
    watch.enter("restoring a backup")
    try {
        return await restoreBackup(coreEnvironment(), file, mode, current)
    }
    finally {
        watch.leave()
    }
}

/** The core's side of the account sync (core/account/package.ts): the same database, secrets and extensions as the backup */
export function corePackageEnvironment(): PackageEnvironment {
    return coreEnvironment()
}

/**
 * Sends the changes that wait for AniList now (app start, network back, app in front, "Send now"). One run at a time
 * (changes.ts); nothing is sent twice. Measured like a request; a failure stays in the queue and in the log.
 */
export async function coreSendWaitingChanges(): Promise<void> {
    await watch.afterCallersTurn()
    watch.enter("sending the changes that waited")
    try {
        await sendWaitingChanges(coreEnvironment())
    }
    catch {
        logger("Core").warning("the changes for AniList could not be sent")
    }
    finally {
        watch.leave()
    }
}

/*
 * The core runs on this thread, the one the screens' logic runs on (docs/EIGENER-KERN.md §4b). The watch sees every
 * piece of time the core held it without a break and warns only when one is longer than the plan allows.
 */
/** Where a long piece ran, for the log line: the waits around it and its sections of 0.5 ms or more */
function pieceWhere(where: PieceWhere): string {
    const sections = where.sections.filter(section => section.milliseconds >= 0.5).map(section => `${section.name} ${section.milliseconds.toFixed(1)}`)
    return `after ${where.from}, until ${where.until}${where.sections.length > 1 ? `; ${sections.join(", ")}` : ""}`
}

/** The longest piece per request since the last `takeLongestPieces` (for the check link, §4m) */
const longestPieces = new Map<string, { milliseconds: number, where: PieceWhere }>()

/** The longest pieces per request since the last call, longest first, as log text; starts counting anew */
export function takeLongestPieces(count: number): string[] {
    const lines = [...longestPieces.entries()].sort((a, b) => b[1].milliseconds - a[1].milliseconds).slice(0, count)
        .map(([what, { milliseconds, where }]) => `${what} ${milliseconds.toFixed(1)} ms (${pieceWhere(where)})`)
    longestPieces.clear()
    return lines
}

/** Whether the app is in front (AppState "active"); set by the app's root (client-providers.tsx), true until then */
let appInFront = () => true

export function connectAppFront(inFront: () => boolean) {
    appInFront = inFront
}

const watch = createBlockingWatch({
    now: () => performance.now(),
    onPiece: (milliseconds, what, where) => {
        const known = longestPieces.get(what)
        if (!known || known.milliseconds < milliseconds) longestPieces.set(what, { milliseconds, where })
        if (milliseconds <= LONGEST_PIECE_MS) return
        logger("Core").warning(`${what} held the app's thread for ${milliseconds.toFixed(1)} ms in one piece, more than the ${LONGEST_PIECE_MS} ms allowed (${pieceWhere(where)})`)
    },
    free: () => new Promise<void>(resolve => setTimeout(resolve, 0)),
    // React Native's timers stand still while the app is not in front: the pauses of long work do not wait there (4b-C1K)
    inFront: () => appInFront(),
})

/** The file of the core's own database, in the app's own data (docs/EIGENER-KERN.md §4a) */
const DATABASE_NAME = "core.db"

let database: Promise<CoreDatabase> | null = null

/** Opening the file and every statement run on expo-sqlite's thread (core-database.ts): real waits for the watch */
const openFile = watch.waiting((name: string) => openDatabaseAsync(name), "database file")

/**
 * The move of the server's data into the core's database (docs/EIGENER-KERN.md §4c): once per database, or again when
 * asked for. Whatever happens in it, the database stays usable. The log line carries counts and names of fields only.
 */
async function moveIn(opened: CoreDatabase, again: boolean) {
    const source = openOldData()
    try {
        const environment = {
            database: opened,
            old: { rows: watch.waiting(source.old.rows, "server rows"), cacheFile: watch.waiting(source.old.cacheFile, "server cache file") },
            secrets: { read: watch.waiting(secretStore.read, "secret read"), write: watch.waiting(secretStore.write, "secret write") },
            now: Date.now,
        }
        const results = again ? await moveFromServer(environment) : await moveFromServerOnce(environment)
        if (results) logger("Core").info(`move from the server${again ? " (again)" : ""}: ${moveSummary(results)}`)
    }
    catch {
        logger("Core").warning("the move from the server could not run")
    }
    finally {
        await source.close().catch(() => undefined)
    }
}

/**
 * Opened on first use, so an app with every area off never creates the file. A failed opening is tried again. A
 * database that has not seen the move yet gets it before anything reads from it.
 */
function ownDatabase(): Promise<CoreDatabase> {
    database ??= (async () => {
        // waiting in the database's line for another request's statement is a wait too (5a-2b, §4p)
        const opened = await openCoreDatabase(watch.waiting(sqlDriverFor(await openFile(DATABASE_NAME)), "sql"), Date.now, watch.waiting(<T>(pending: Promise<T>) => pending, "database line") as LineWait)
        await moveIn(opened, false)
        return opened
    })().catch(error => {
        database = null
        throw error
    })
    return database
}

/**
 * Waiting for the database through the watch: once it is open, the wait ends at once, and without it the piece stayed
 * open over everything the caller ran next in the same tick (the link switching an area reads every query again) and
 * counted it as the core's (39 ms in 2b, docs/EIGENER-KERN.md §4f).
 */
const openedDatabase = watch.waiting(ownDatabase, "database open")

/** An area was switched on: the database is opened now (and the move runs if it has not yet), not at the first request. */
export async function prepareCore(): Promise<void> {
    watch.enter("first use of the core")
    try {
        await openedDatabase()
    }
    catch {
        logger("Core").warning("the core's database could not be opened")
    }
    finally {
        watch.leave()
    }
}

/** Test and scratch app only (a link, app-links.ts): runs the move again. Parts the core has data for are kept. */
export async function repeatCoreMove(): Promise<void> {
    watch.enter("move from the server")
    try {
        await moveIn(await ownDatabase(), true)
        // the server's saved episodes (phase 4c): only new ones are added; null: the downloads' start does it
        const episodes = await repeatOldEpisodes().catch(() => undefined)
        logger("Core").info(`move from the server (again): saved episodes ${episodes === undefined ? "failed" : episodes === null ? "at the start of the downloads" : `taken ${episodes.taken}, left with the server ${episodes.left}`}`)
        // the server's saved manga chapters (phase 4c-2), the same way
        const chapters = await repeatOldChapters().catch(() => undefined)
        logger("Core").info(`move from the server (again): saved manga chapters ${chapters === undefined ? "failed" : chapters === null ? "at the start of the manga downloads" : `taken ${chapters.taken}, left with the server ${chapters.left}`}`)
    }
    catch {
        logger("Core").warning("the core's database could not be opened")
    }
    finally {
        watch.leave()
    }
}

let appBuild = ""

/** The app's version and build, for the core's own status (core/start/start.ts, phase 5a-1) */
export function connectAppBuild(build: string) {
    appBuild = build
}

function coreEnvironment(): CoreEnvironment {
    return {
        fetch: watch.waiting(async (url, init) => {
            if (anilistCut && url === ANILIST_URL) throw new TypeError("AniList is cut off from the core (test switch)")
            const response = await fetch(url, init)
            // reading the body is a wait of its own: the answer's text comes from the network's thread
            return { status: response.status, headers: response.headers, text: watch.waiting(() => response.text(), "network read") }
        }, "network"),
        secret: watch.waiting(secretStore.read, "secret read"),
        keepSecret: watch.waiting((name: string, value: string | null) => (value === null ? secretStore.forget!(name) : secretStore.write(name, value)), "secret write"),
        appBuild: () => appBuild,
        // the waits of the database are its statements, wrapped where it is opened
        database: ownDatabase,
        now: Date.now,
        pause: watch.pause,
        mark: watch.mark,
        onlyAccount,
        // loaded on first use: the sandbox module and the hidden browser are not part of every request
        extensions: async () => (await import("@/api/client/core-extensions")).extensionPlaceFor(watch),
        // loaded on first use: the loader's module and the network state are not part of every request
        offline: async () => (await import("@/api/client/core-offline")).offlineDeviceFor(watch),
        // loaded on first use (§4p, 5b-1): the device's library folders, read only
        localFolders: async () => (await import("@/api/client/core-local-files")).localFoldersFor(watch),
        // loaded on first use (§4q, 6b-2): the torrent module and its session are not part of every request
        torrent: async () => (await import("@/api/client/core-torrent")).torrentDeviceFor(watch),
        // loaded on first use (§4r, 7c-1): the search for TVs, the multicast lock held only while it listens
        cast: async () => (await import("@/api/client/core-cast")).castSearcherFor(watch),
        // loaded on first use (§4r, 7b): the outlet into the Wi-Fi, open only while a TV plays something of the device
        castOutlet: async () => (await import("@/api/client/core-cast")).castOutletFor(watch),
        // phase 7e: React Native's WebSocket takes headers (the Nakama host reads its token from one)
        nakamaSocket: (url, headers) => new (WebSocket as unknown as new (url: string, protocols: null, options: { headers: Record<string, string> }) => NakamaSocket)(url, null, { headers }),
        // read once (§4p, 5a-4): the server's database as a copy in memory, the server's own file is not touched
        serverPlaylists: watch.waiting(async () => {
            const { old, close } = openOldData()
            try {
                return await old.rows("playlists")
            }
            finally {
                await close()
            }
        }, "server database"),
        unasked: async (what, work) => {
            watch.enter(what)
            try {
                return await work()
            }
            finally {
                watch.leave()
            }
        },
    }
}

/**
 * The hooks read a failed request as an axios error with the server's `{ error }` body (SeaError): the toast text, the
 * "feature disabled" and the login checks all look at `error.response`. A failure in the core gets the same form.
 */
function asServerError(error: unknown, config: InternalAxiosRequestConfig): AxiosError<{ error: string }> {
    const status = error instanceof CoreError ? error.status : 500
    const message = error instanceof Error ? error.message : String(error)
    const response: AxiosResponse<{ error: string }> = { data: { error: message }, status, statusText: "", headers: {}, config }
    return new AxiosError(message, AxiosError.ERR_BAD_RESPONSE, config, undefined, response)
}

/**
 * null: the server answers this request. Otherwise a function that asks the core and returns what the server would
 * have put under "data", or rejects like a failed request to the server.
 */
export function coreRequestFor<T>(
    method: string,
    endpoint: string,
): ((data: unknown, params: unknown) => Promise<T>) | null {
    const answer = coreAnswerFor(method, endpoint)
    if (!answer) return null
    return async (data, params) => {
        const started = Date.now()
        const what = `${method} ${endpoint.split("?")[0]}`
        try {
            await watch.afterCallersTurn()
            watch.enter(what)
            const environment = coreEnvironment()
            watch.mark("core")
            const result = await answer({ body: data, query: params }, environment)
            // from here the core is done: the rest of the piece is the return through its calls and the log line (8-ms round 2)
            watch.mark("answered")
            logger("Core").info(`${what} answered by the core, no HTTP (${Date.now() - started} ms)`)
            // phase 6f: the first answer of a run brings the torrent client's downloads back (once, only with `torrent` on)
            resumeClientAtStart(environment)
            // phase 7e: the first answer of a run connects to the Nakama host when one is set up (once)
            nakamaAtStart(environment)
            return result as T
        }
        catch (error) {
            // the server failed, not the core: the hooks get the server's own error (retry while it starts, login check)
            if (isAxiosError(error)) throw error
            logger("Core").warning(`${what} failed in the core (${Date.now() - started} ms)`)
            throw asServerError(error, { url: endpoint, method } as InternalAxiosRequestConfig)
        }
        finally {
            // the core's last piece ends here; what follows is the hook's own work
            watch.leave()
        }
    }
}

/**
 * The player's videocore message, heard by the core instead of the server (area `playback`, core/playback/playback.ts).
 * Runs after the caller's turn, measured like a request; a failure is logged and never reaches the player.
 */
export function coreHearPlayer(message: PlayerMessage): void {
    const what = `videocore ${message.type}`
    void (async () => {
        await watch.afterCallersTurn()
        watch.enter(what)
        try {
            const environment = coreEnvironment()
            // what plays, asked before closing forgets it
            const id = typeof message.payload === "object" && message.payload !== null ? (message.payload as { id?: unknown }).id : undefined
            const playing = typeof id === "string" ? playingOf(id) : undefined
            const done = await hearPlayer(message, environment)
            if (done) logger("Core").info(`${what} heard by the core: ${done}`)
            // "Download next episodes automatically": once the position is kept (pause, 80 %, closing), the core may queue the next ones
            if (playing && (message.type === "video-paused" || message.type === "video-completed" || message.type === "video-terminated")) {
                void import("@/api/client/core-prefetch").then(module => module.requestPrefetch(playing.mediaId, playing.episodeNumber)).catch(() => undefined)
            }
            const playlist = await playlistHearsPlayer(message, environment)
            if (playlist) logger("Core").info(`${what} heard by the core: ${playlist}`)
            const torrent = await torrentHearsPlayer(message, environment)
            if (torrent) logger("Core").info(`${what} heard by the core: ${torrent}`)
        }
        catch (error) {
            logger("Core").warning(`${what} failed in the core (${error instanceof Error ? error.message : String(error)})`)
        }
        finally {
            watch.leave()
        }
    })()
}

/**
 * The screens' message on the `playlist` channel, heard by the core instead of the server (area `playback`,
 * core/playback/playlists.ts). Runs after the caller's turn, measured like a request; a failure is logged only.
 */
export function coreHearPlaylist(message: PlaylistMessage): void {
    const what = `playlist ${message.type}`
    void (async () => {
        await watch.afterCallersTurn()
        watch.enter(what)
        try {
            const done = await hearPlaylist(message, coreEnvironment())
            logger("Core").info(`${what} heard by the core${done ? `: ${done}` : ""}`)
        }
        catch (error) {
            logger("Core").warning(`${what} failed in the core (${error instanceof Error ? error.message : String(error)})`)
        }
        finally {
            watch.leave()
        }
    })()
}

/*
 * Nakama as a guest (phase 7e, core/nakama/guest.ts): the screens ask for the status here instead of the server's socket;
 * the answer comes as the core event `nakama-status`. The connection's changes go into the log (never a password).
 */
export function coreAskNakamaStatus(): void {
    askNakamaStatus()
}

onCoreEvent(event => {
    if (event.type === "nakama-host-connected") logger("Core").info("Nakama: connected to the host as a guest")
    else if (event.type === "nakama-host-disconnected") logger("Core").info("Nakama: disconnected from the host")
    else if (event.type === "nakama-error") logger("Core").warning(`Nakama: ${String((event.payload as { message?: unknown } | null)?.message ?? "error")}`)
})
