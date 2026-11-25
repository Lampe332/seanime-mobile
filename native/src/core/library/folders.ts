// geschrieben nach: App-Typen LibraryExplorer_FileTreeJSON/LibraryExplorer_FileTreeNodeJSON, FetchAnimeEntrySuggestions_Variables, AL_BaseAnime (src/api/generated/types.ts, endpoint.types.ts), Form der Aufzeichnung api vom 13.11.2026 (LIBRARY_EXPLORER.GetLibraryExplorerFileTree: nur Arten), App-Code library-explorer-phone.tsx/library-explorer-tree.ts (Pfade, Zähler, localFiles nach Pfad), library-phone.tsx (Vorschläge aus dem Ordnernamen, „Leere Ordner entfernen?“), library-status.tsx (auto-scan-started/-completed), settings-library.tsx (library.autoScan) und docs/EIGENER-KERN.md §4p (Phase 5b-2); kein Server-Quelltext

import { CoreError } from "../errors"
import { emitCoreEvent } from "../events"
import type { CoreEnvironment, CoreRequest } from "../registry"
import { type LocalFileRow, VIDEO_EXTENSIONS, allFiles, asLocalFile, readName } from "./local-files"
import { type LocalFolders, libraryFolders, librarySettings, scanLocalFiles, scanRunning, searchAnilist, walk } from "./scan"

/*
 * The library folders beyond the scan (area `library`, phase 5b-2, docs/EIGENER-KERN.md §4p): the file tree of the
 * explorer, removing empty folders, suggestions for a folder without an anime, the scan at the app's start when the
 * user turned "refresh the library when the app starts" on and the automatic scan (`library.autoScan`, "Refresh the
 * library automatically"): when the app comes back to the front, at most every 10 minutes, a cheap look at the folders
 * and a scan only when their files changed. No watcher that keeps running, no work in the background.
 */

type Json = Record<string, unknown>

const MAX_DEPTH = 12

const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value)
const isVideo = (name: string) => VIDEO_EXTENSIONS.has(name.slice(name.lastIndexOf(".") + 1).toLowerCase())

type TreeNode = {
    name: string, path: string, normalizedPath: string, kind: "directory" | "file", children?: TreeNode[], size?: number,
    mediaIds?: number[], localFileCount?: number, matchedLocalFileCount?: number,
}

async function devicePart(environment: CoreEnvironment): Promise<{ device: LocalFolders, roots: string[] }> {
    if (!environment.localFolders) throw new CoreError("the device's folders are not available here", 500)
    const roots = await libraryFolders(environment)
    return { device: await environment.localFolders(), roots }
}

/** A folder with its folders and video files; the counts are of the files the library has (scanned) */
async function folderNode(device: LocalFolders, path: string, name: string, depth: number, rows: Map<string, LocalFileRow>, environment: CoreEnvironment): Promise<TreeNode | null> {
    await environment.pause("library file tree")
    let entries
    try {
        entries = await device.list(path)
    }
    catch (error) {
        if (depth === 0) throw new CoreError(`cannot read the library folder ${path}: ${error instanceof Error ? error.message : String(error)}`, 500)
        return null
    }
    const children: TreeNode[] = []
    for (const entry of entries) {
        if (entry.name.startsWith(".")) continue
        const child = `${path}/${entry.name}`
        if (entry.folder) {
            if (depth >= MAX_DEPTH) continue
            const node = await folderNode(device, child, entry.name, depth + 1, rows, environment)
            if (node) children.push(node)
        }
        else if (isVideo(entry.name)) {
            const row = rows.get(child)
            children.push({
                name: entry.name, path: child, normalizedPath: child.toLowerCase(), kind: "file", size: entry.size,
                ...(row?.mediaId ? { mediaIds: [row.mediaId] } : {}), localFileCount: row ? 1 : 0, matchedLocalFileCount: row?.mediaId ? 1 : 0,
            })
        }
    }
    return withCounts({ name, path, normalizedPath: path.toLowerCase(), kind: "directory", children })
}

function withCounts(node: TreeNode): TreeNode {
    const children = node.children ?? []
    const ids = [...new Set(children.flatMap(child => child.mediaIds ?? []))]
    return {
        ...node, mediaIds: ids,
        localFileCount: children.reduce((sum, child) => sum + (child.localFileCount ?? 0), 0),
        matchedLocalFileCount: children.reduce((sum, child) => sum + (child.matchedLocalFileCount ?? 0), 0),
    }
}

/**
 * GET /api/v1/library/explorer/file-tree → `{ root, localFiles }`: the library folder as it is on the device now (one
 * folder: it is the root; several: under one root without a path), every file of the library by its path. No folder
 * set: no root.
 */
export async function fileTree(_request: CoreRequest, environment: CoreEnvironment): Promise<Json> {
    const { device, roots } = await devicePart(environment)
    const database = await environment.database()
    const rows = new Map((await allFiles(database)).map(row => [row.path, row]))
    const localFiles = Object.fromEntries([...rows.values()].map(row => [row.path, asLocalFile(row)]))
    if (roots.length === 0) return { localFiles }
    const nodes: TreeNode[] = []
    for (const root of roots) nodes.push((await folderNode(device, root, root.slice(root.lastIndexOf("/") + 1) || root, 0, rows, environment))!)
    const root = nodes.length === 1 ? nodes[0] : withCounts({ name: "Library", path: "", normalizedPath: "", kind: "directory", children: nodes })
    return { root, localFiles }
}

/** POST /api/v1/library/explorer/file-tree/refresh: the tree is read anew on every request, nothing is kept → true */
export async function refreshFileTree(): Promise<boolean> {
    return true
}

/** Removes the empty folders below `path` (deepest first); the folder itself only when it is not a library folder */
async function removeEmptyBelow(device: LocalFolders, path: string, depth: number, environment: CoreEnvironment): Promise<boolean> {
    await environment.pause("library empty folders")
    let entries
    try {
        entries = await device.list(path)
    }
    catch (error) {
        if (depth === 0) throw new CoreError(`cannot read the library folder ${path}: ${error instanceof Error ? error.message : String(error)}`, 500)
        return false
    }
    let left = entries.length
    for (const entry of entries) {
        // a hidden folder is something in its folder: it is not entered and keeps its folder
        if (!entry.folder || entry.name.startsWith(".") || depth >= MAX_DEPTH) continue
        if (await removeEmptyBelow(device, `${path}/${entry.name}`, depth + 1, environment)) left--
    }
    return depth > 0 && left === 0 && await device.removeEmptyFolder(path)
}

/**
 * DELETE /api/v1/library/empty-directories: every folder below the library folders that holds nothing at all (also no
 * hidden file) is removed, a folder that held only such folders too. Never a library folder itself, never a file → true
 */
export async function removeEmptyDirectories(_request: CoreRequest, environment: CoreEnvironment): Promise<boolean> {
    const { device, roots } = await devicePart(environment)
    if (roots.length === 0) throw new CoreError("no library folder is set", 400)
    for (const root of roots) await removeEmptyBelow(device, root, 0, environment)
    return true
}

/**
 * POST /api/v1/library/anime-entry/suggestions `{ dir }` → the anime AniList finds for the folder's title (the
 * screens: "Suggestions from the folder's name"); a folder without a title in its name: the title of its first file
 */
export async function folderSuggestions(request: CoreRequest, environment: CoreEnvironment): Promise<Json[]> {
    const dir = isRecord(request.body) ? request.body.dir : undefined
    if (typeof dir !== "string" || !dir.trim()) throw new CoreError("dir must be a text", 400)
    const folder = dir.trim().replace(/\/+$/, "")
    const name = folder.slice(folder.lastIndexOf("/") + 1)
    let title = readName(name).parsed.title
    if (typeof title !== "string" || !title) {
        const database = await environment.database()
        const first = (await allFiles(database)).find(row => row.path.slice(0, row.path.lastIndexOf("/")) === folder)
        title = first ? first.parsed.title : undefined
    }
    if (typeof title !== "string" || !title) return []
    return searchAnilist(environment, title)
}

let scannedAtStart = false

/**
 * The scan at the app's start (`library.refreshLibraryOnStart` on, the screens: "Refresh the library when the app starts"): once per run of the app, when the area `library` is on and a
 * folder is set; told like the server told it (`auto-scan-started`, `auto-scan-completed`, the latter also after a
 * failure so the screens stop showing it). It begins after the request that started it (a timer), as unasked work.
 */
export function scanAtStart(environment: CoreEnvironment): void {
    if (scannedAtStart || !environment.localFolders) return
    scannedAtStart = true
    const work = async () => {
        if ((await librarySettings(environment)).refreshLibraryOnStart !== true) return
        if ((await libraryFolders(environment)).length === 0) return
        emitCoreEvent("auto-scan-started", "")
        try {
            await scanLocalFiles({ path: {}, query: null, body: { enhanced: false, skipLockedFiles: true, skipIgnoredFiles: true } }, environment)
        }
        finally {
            emitCoreEvent("auto-scan-completed", "")
        }
    }
    setTimeout(() => void (environment.unasked ? environment.unasked("library scan at start", work) : work()).catch(() => undefined), 0)
}

/** Tests: the next run of the app scans at its start again */
export function forgetScanAtStart(): void {
    scannedAtStart = false
}

let refreshing: Promise<void> | null = null
let refreshAgain = false

/** Scans, told like the scan at the start, once more while a download finished during it */
async function scanWhileAsked(environment: CoreEnvironment): Promise<void> {
    do {
        refreshAgain = false
        emitCoreEvent("auto-scan-started", "")
        try {
            await scanLocalFiles({ path: {}, query: null, body: { enhanced: false, skipLockedFiles: true, skipIgnoredFiles: true } }, environment)
        }
        catch {
            // a scan the user started runs already (409) or the folders cannot be read: the next scan finds the files
        }
        finally {
            emitCoreEvent("auto-scan-completed", "")
        }
    } while (refreshAgain)
}

const plainFolder = (path: string) => (path.startsWith("file://") ? decodeURIComponent(path.slice("file://".length)) : path).replace(/\/+$/, "")

/**
 * 4.2.0: after a torrent of the client finished (torrent/client.ts), the library reads its folders again, so the
 * episode is in the app at once and not only after the next start. Only for a folder inside a library folder; told like
 * the scan at the start. One that finishes during the scan brings one scan more after it. Unasked work, after the call.
 */
export function refreshAfterDownload(environment: CoreEnvironment, folder: string): Promise<void> {
    if (!environment.localFolders) return Promise.resolve()
    if (refreshing) {
        refreshAgain = true
        return refreshing
    }
    const work = async () => {
        const inside = plainFolder(folder)
        const roots = (await libraryFolders(environment)).map(plainFolder)
        if (!roots.some(root => inside === root || inside.startsWith(`${root}/`))) return
        await scanWhileAsked(environment)
    }
    const run = environment.unasked ? environment.unasked("library scan after a torrent download", work) : work()
    refreshing = run.then(() => undefined, () => undefined).finally(() => {
        refreshing = null
    })
    return refreshing
}

/** "Refresh the library automatically": the folders are looked at no more often than this */
export const AUTO_SCAN_EVERY_MS = 10 * 60_000
let lookedAt: number | null = null

/**
 * POST /api/v1/library/auto-scan (the app's own, client-providers.tsx: the app came back to the front). With
 * `library.autoScan` on and a folder set, at most every 10 minutes: the folders' video files (path and size) are compared
 * with the library's files; only a difference brings a scan, told like the scan at the start (so the screens say so only
 * then). Shares `refreshing` with the scan after a download and never starts beside a running scan (no 409 for the user's
 * scan). → whether it scanned
 */
export function scanWhenBack(environment: CoreEnvironment): Promise<{ scanned: boolean }> {
    if (!environment.localFolders || refreshing || scanRunning()) return Promise.resolve({ scanned: false })
    let scanned = false
    const look = async () => {
        if ((await librarySettings(environment)).autoScan !== true) return
        const now = environment.now()
        if (lookedAt !== null && now - lookedAt < AUTO_SCAN_EVERY_MS) return
        const roots = await libraryFolders(environment)
        if (roots.length === 0) return
        lookedAt = now
        let found: Awaited<ReturnType<typeof walk>>
        try {
            found = await walk(await environment.localFolders!(), roots, environment)
        }
        catch {
            return // a folder cannot be read now: the next look tries again
        }
        const database = await environment.database()
        const kept = new Set((await allFiles(database)).map(row => `${row.size} ${row.path}`))
        const same = found.length === kept.size && found.every(file => kept.has(`${file.size} ${file.path}`))
        if ((same && !refreshAgain) || scanRunning()) return
        scanned = true
        await scanWhileAsked(environment)
    }
    const work = async () => {
        await look()
        // a download that finished meanwhile waited for this look (refreshAfterDownload): its scan comes now
        if (refreshAgain && (await libraryFolders(environment)).length > 0) {
            scanned = true
            await scanWhileAsked(environment)
        }
    }
    const run = environment.unasked ? environment.unasked("library scan when the app is back", work) : work()
    const done = run.then(() => undefined, () => undefined).finally(() => {
        refreshing = null
    })
    refreshing = done
    return done.then(() => ({ scanned }))
}

/** Tests: the next return to the front looks at the folders again */
export function forgetLookAtFolders(): void {
    lookedAt = null
}
