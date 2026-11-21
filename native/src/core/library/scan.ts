// geschrieben nach: App-Typen ScanLocalFiles_Variables, Summary_ScanSummary*, AddUnknownMedia_Variables, DirectstreamPlayLocalFile_Variables, NativePlayer_PlaybackInfo (src/api/generated/types.ts, endpoint.types.ts), App-Code scan.hooks.ts, library-status.tsx (scan-progress als Zahl 0–100, scan-status als Text), library-phone.tsx (Ordner aus settings.library.libraryPath/libraryPaths), native-player.tsx (Nachricht native-player „watch“), handle-play-media.ts, öffentliche AniList-Doku (Page.media search) und docs/EIGENER-KERN.md §4p; kein Server-Quelltext

import { desc, inArray } from "drizzle-orm"
import { animeCollection } from "../anilist/anilist"
import { editListEntry, listDataOf } from "../anilist/changes"
import { askAnilist, clientFor } from "../anilist/client"
import { SEARCH_FILE_MATCH } from "../anilist/queries"
import { storedEntry } from "../anilist/store"
import { inOrder } from "../database/database"
import { localFiles, scanSummaries } from "../database/schema"
import { CoreError } from "../errors"
import { emitCoreEvent } from "../events"
import type { CoreEnvironment, CoreRequest } from "../registry"
import { ownSettingsAndLook } from "../settings/settings"
import { listEntries } from "./home"
import { animeWithEpisodes } from "./library"
import { type LocalFileRow, VIDEO_EXTENSIONS, allFiles, asLocalFile, bestMatch, episodeOfFile, fileMetadataOf, plainTitle, readName, seasonOf } from "./local-files"

/*
 * The scan of the user's library folders (area `library`, phase 5b-1, docs/EIGENER-KERN.md §4p) and what hangs on it:
 * the folders come from the settings (`library.libraryPath` and `library.libraryPaths`), the device lists them
 * (`CoreEnvironment.localFolders`), every video file is read by its name and matched against the anime of the user's
 * lists (local-files.ts, own rule). With "enhanced" (the screens' "only my lists" off) a title the lists do not know
 * is searched on AniList once; a file matched that way belongs to an anime outside the lists ("unknown media"). Files
 * that are gone leave the table; locked/ignored files keep their row when the scan is told to skip them. The scan
 * tells its progress like the server did (`scan-progress` 0–100, `scan-status` a text) and keeps a summary.
 */

type Json = Record<string, unknown>

/** One thing in a folder of the device */
export type LocalFolderEntry = { name: string, folder: boolean, size: number }
/** The device's side of the library folders: lists one folder by its path (throws when it cannot be read) */
export type LocalFolders = {
    list: (path: string) => Promise<LocalFolderEntry[]>
    /** Removes the folder only when it holds nothing at all (read again right before) → whether it was removed */
    removeEmptyFolder: (path: string) => Promise<boolean>
    /** Deletes one file (never a folder) → whether it is gone now (also when it was not there); throws when it cannot be deleted */
    removeFile: (path: string) => Promise<boolean>
}

const MAX_FILES = 20000
const MAX_DEPTH = 12
const MAX_SEARCHES = 30
const KEEP_SUMMARIES = 10

const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value)

type Found = { path: string, name: string, size: number, folders: string[] }

/** The settings' `library` part, the core's own */
export async function librarySettings(environment: CoreEnvironment): Promise<Json> {
    const settings = (await ownSettingsAndLook(await environment.database())).settings
    return isRecord(settings) && isRecord(settings.library) ? settings.library : {}
}

/** The library folders of the settings, each once, without a trailing slash */
export async function libraryFolders(environment: CoreEnvironment): Promise<string[]> {
    const library = await librarySettings(environment)
    const paths = [library.libraryPath, ...(Array.isArray(library.libraryPaths) ? library.libraryPaths : [])]
    return [...new Set(paths.filter((path): path is string => typeof path === "string" && path.trim() !== "").map(path => path.trim().replace(/\/+$/, "")))]
}

/** Every video file below the folders, one folder per piece of work */
async function walk(device: LocalFolders, roots: string[], environment: CoreEnvironment): Promise<Found[]> {
    const files: Found[] = []
    const queue = roots.map(path => ({ path, folders: [] as string[], root: true }))
    while (queue.length > 0 && files.length < MAX_FILES) {
        const folder = queue.shift()!
        await environment.pause("library scan folders")
        let entries: LocalFolderEntry[]
        try {
            entries = await device.list(folder.path)
        }
        catch (error) {
            if (folder.root) throw new CoreError(`cannot read the library folder ${folder.path}: ${error instanceof Error ? error.message : String(error)}`, 500)
            continue
        }
        for (const entry of entries) {
            if (entry.name.startsWith(".")) continue
            const path = `${folder.path}/${entry.name}`
            if (entry.folder) {
                if (folder.folders.length < MAX_DEPTH) queue.push({ path, folders: [...folder.folders, entry.name], root: false })
            }
            else if (VIDEO_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf(".") + 1).toLowerCase())) {
                files.push({ path, name: entry.name, size: entry.size, folders: folder.folders })
            }
        }
    }
    return files
}

/** The anime AniList finds for a title (own small selection, SEARCH_FILE_MATCH); none when AniList cannot be asked */
export async function searchAnilist(environment: CoreEnvironment, title: string): Promise<Json[]> {
    try {
        const answer = await askAnilist(clientFor(environment), SEARCH_FILE_MATCH, { search: title })
        const media = isRecord(answer.Page) && Array.isArray(answer.Page.media) ? answer.Page.media : []
        return media.filter(isRecord)
    }
    catch {
        return []
    }
}

function tell(progress: number, status: string) {
    emitCoreEvent("scan-progress", progress)
    emitCoreEvent("scan-status", status)
}

let scanning = false

/** POST /api/v1/library/scan → every file the library has now (`Anime_LocalFile[]`) */
export async function scanLocalFiles(request: CoreRequest, environment: CoreEnvironment): Promise<Json[]> {
    if (scanning) throw new CoreError("a scan is already running", 409)
    scanning = true
    try {
        return await scan(isRecord(request.body) ? request.body : {}, environment)
    }
    finally {
        scanning = false
    }
}

async function scan(options: Json, environment: CoreEnvironment): Promise<Json[]> {
    if (!environment.localFolders) throw new CoreError("the device's folders are not available here", 500)
    const roots = await libraryFolders(environment)
    if (roots.length === 0) throw new CoreError("no library folder is set", 400)
    const enhanced = options.enhanced === true
    const skipLocked = options.skipLockedFiles !== false
    const skipIgnored = options.skipIgnoredFiles !== false
    tell(0, "Retrieving local files...")
    const found = await walk(await environment.localFolders(), roots, environment)
    tell(20, `Found ${found.length} video files`)

    const database = await environment.database()
    const kept = new Map((await allFiles(database)).map(row => [row.path, row]))
    const entries = await listEntries(environment)
    const candidates = entries.map(item => item.media)
    const inLists = new Set(candidates.map(media => media.id as number))
    const searched = new Map<string, Json[]>()
    const media = new Map<number, Json>(candidates.map(item => [item.id as number, item]))
    const rows: LocalFileRow[] = []
    const logs = new Map<string, string[]>()
    const near = new Map<string, Json[]>()
    tell(30, "Matching local files...")
    for (const file of found) {
        // before every file: a file matched against every anime in the lists is a few ms on the tablet, 20 of them were
        // 42 ms (5b-2); the pause lets the thread go only once the piece ran long enough
        await environment.pause("library scan match")
        const old = kept.get(file.path)
        if (old && ((skipLocked && old.locked) || (skipIgnored && old.ignored))) {
            rows.push({ ...old, size: file.size })
            logs.set(file.path, [old.locked ? "Locked, kept as it was" : "Ignored, kept as it was"])
            continue
        }
        const { parsed, kinds } = readName(file.name)
        const folders = file.folders.map(folder => readName(folder).parsed)
        const folderTitle = [...folders].reverse().find(folder => typeof folder.title === "string")?.title as string | undefined
        const title = typeof parsed.title === "string" ? parsed.title : folderTitle ?? ""
        const season = Number(parsed.season) || Number([...folders].reverse().find(folder => folder.season)?.season) || 0
        const others: Json[] = []
        let match = title ? bestMatch(title, season, candidates, others) : null
        let how = "in your lists"
        if (!match && title && enhanced) {
            const key = seasonOf(plainTitle(title)).base
            let results = searched.get(key)
            if (!results && searched.size < MAX_SEARCHES) {
                results = await searchAnilist(environment, title)
                await environment.pause("library scan match")
                searched.set(key, results)
            }
            match = bestMatch(title, season, results ?? [], others)
            how = "on AniList"
        }
        if (match) media.set(match.media.id as number, match.media)
        const meta = fileMetadataOf(parsed, kinds, match?.media ?? null)
        rows.push({
            path: file.path, name: file.name, mediaId: match ? match.media.id as number : 0, episode: meta.episode,
            anidbEpisode: meta.anidbEpisode, type: meta.type, locked: false, ignored: false, size: file.size, parsed, folders,
            changedAt: environment.now(),
        })
        near.set(file.path, others)
        logs.set(file.path, [match
            ? `Matched "${title}" ${how} (score ${match.score.toFixed(2)}), ${meta.type} ${meta.anidbEpisode}`
            : title ? `No anime fits "${title}"` : "No title in the file's name or folders"])
    }

    tell(70, "Saving local files...")
    await inOrder(database, () => database.delete(localFiles))
    for (let at = 0; at < rows.length; at += 50) {
        await environment.pause("library scan save")
        await inOrder(database, () => database.insert(localFiles).values(rows.slice(at, at + 50)))
    }
    await keepSummary(environment, rows, media, inLists, logs)
    tell(100, "Scan completed")
    return rows.map(asLocalFile)
}

async function keepSummary(environment: CoreEnvironment, rows: LocalFileRow[], media: Map<number, Json>, inLists: Set<number>, logs: Map<string, string[]>) {
    const database = await environment.database()
    const fileOf = (row: LocalFileRow, at: number) => ({
        id: `file-${at}`,
        localFile: asLocalFile(row),
        logs: (logs.get(row.path) ?? []).map((message, n) => ({ id: `log-${at}-${n}`, filePath: row.path, level: row.mediaId ? "info" : "warning", message })),
    })
    const groups = new Map<number, Json[]>()
    const unmatched: Json[] = []
    rows.forEach((row, at) => {
        if (row.mediaId > 0) groups.set(row.mediaId, [...(groups.get(row.mediaId) ?? []), fileOf(row, at)])
        else unmatched.push(fileOf(row, at))
    })
    const now = environment.now()
    const summary = {
        id: `scan-${now}`,
        groups: [...groups].map(([mediaId, files]) => {
            const item = media.get(mediaId) ?? {}
            const title = isRecord(item.title) ? item.title : {}
            const cover = isRecord(item.coverImage) ? item.coverImage : {}
            return {
                id: `group-${mediaId}`, files, mediaId, mediaTitle: String(title.userPreferred ?? title.romaji ?? ""),
                mediaImage: String(cover.large ?? cover.medium ?? ""), mediaIsInCollection: inLists.has(mediaId),
            }
        }),
        unmatchedFiles: unmatched,
    }
    await inOrder(database, () => database.insert(scanSummaries).values({ content: summary, createdAt: now }))
    const old = (await inOrder(database, () => database.select({ id: scanSummaries.id }).from(scanSummaries).orderBy(desc(scanSummaries.id)))).slice(KEEP_SUMMARIES)
    if (old.length) await inOrder(database, () => database.delete(scanSummaries).where(inArray(scanSummaries.id, old.map(row => row.id))))
}

/** GET /api/v1/library/scan-summaries: the kept summaries, newest first */
export async function scanSummaryList(_request: CoreRequest, environment: CoreEnvironment): Promise<Json[]> {
    const database = await environment.database()
    const rows = await inOrder(database, () => database.select().from(scanSummaries).orderBy(desc(scanSummaries.id)))
    return rows.map(row => ({ createdAt: new Date(row.createdAt).toISOString(), scanSummary: row.content }))
}

/** POST /api/v1/library/unknown-media: the anime go to the user's "planning" list (AniList area, §4f) → the anime lists */
export async function addUnknownMedia(request: CoreRequest, environment: CoreEnvironment): Promise<unknown> {
    const ids: unknown[] = isRecord(request.body) && Array.isArray(request.body.mediaIds) ? request.body.mediaIds : []
    if (!ids.every(id => typeof id === "number" && Number.isInteger(id) && id > 0)) throw new CoreError("mediaIds must be AniList numbers", 400)
    for (const mediaId of ids) {
        await editListEntry({ path: {}, query: null, body: { mediaId, status: "PLANNING", score: 0, progress: 0, type: "anime" } }, environment)
    }
    return animeCollection({ path: {}, query: null, body: null }, environment)
}

const MIME: Record<string, string> = { mkv: "video/x-matroska", mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", avi: "video/x-msvideo", mov: "video/quicktime" }

/** The file address the player opens (every part of the path escaped) */
export function fileAddress(path: string): string {
    return "file://" + path.split("/").map(part => encodeURIComponent(part)).join("/")
}

/**
 * POST /api/v1/directstream/play/localfile and /api/v1/playback-manager/play: the player of the app opens the file
 * itself (`file://`), told like the server told it (`native-player` "watch"); progress and history are the playback
 * area's (5a-2) → null
 */
export async function playLocalFile(request: CoreRequest, environment: CoreEnvironment): Promise<null> {
    const path = isRecord(request.body) ? request.body.path : undefined
    if (typeof path !== "string" || !path) throw new CoreError("path must be a text", 400)
    const database = await environment.database()
    const [row] = await inOrder(database, () => database.select().from(localFiles).where(inArray(localFiles.path, [path])))
    if (!row) throw new CoreError("the file is not in the library", 404)
    if (!row.mediaId) throw new CoreError("the file belongs to no anime yet", 400)
    const built = await animeWithEpisodes(environment, row.mediaId)
    const entry = await storedEntry(database, "ANIME", row.mediaId)
    const extension = row.name.slice(row.name.lastIndexOf(".") + 1).toLowerCase()
    const info = {
        id: `core-local-${environment.now()}`,
        streamType: "localfile",
        streamPath: row.path,
        mimeType: MIME[extension] ?? "video/*",
        streamUrl: fileAddress(row.path),
        contentLength: row.size,
        ...(entry ? { entryListData: listDataOf(entry) } : {}),
        episode: episodeOfFile(row, built.media, built.episodes),
        media: built.media,
        isNakamaWatchParty: false,
    }
    emitCoreEvent("native-player", { type: "watch", payload: info })
    return null
}
