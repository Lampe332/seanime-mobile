// geschrieben nach: Aufzeichnungen EXTENSIONS.GetAllExtensions, ListExtensionData, SetExternalExtensionDisabled (2026-11-13, Felder und Reihenfolge), dem Format des Erweiterungs-Ordners eines Servers (eine Datei `<id>.json` je Erweiterung: Manifest mit Code; `cache/extension-settings.cache`) und docs/EIGENER-KERN.md §4l; kein Server-Quelltext

import type { ExtensionBrowser } from "../browser/cloudflare"
import { type ExtensionManifest, manifestFromText } from "../fetch-manifest"
import type { HelperFetch, HelperLogLevel } from "../helpers/helpers"
import type { SandboxEngine } from "../sandbox/sandbox"

/*
 * The installed extensions are the files of the server's own extensions folder, in its format: one `<id>.json` per
 * extension, the manifest with the extension's code in `payload`. The core reads them there, so the server finds
 * everything unchanged when the area is switched off again. It writes there only to install, update, edit or uninstall
 * (install.ts), in the same format, and switches extensions off in the server's file cache (`writeDisabled`).
 */

/** The server's extensions folder (`files/extensions/` of the app). The app hands it in; tests hand in a folder of their own. */
export type ExtensionFolder = {
    /** The names of the files in the folder; [] when there is no folder */
    names: () => Promise<string[]>
    /** A file's text, null when there is none */
    read: (name: string) => Promise<string | null>
    write: (name: string, text: string) => Promise<void>
    remove: (name: string) => Promise<void>
    /** Size and time of the last change of a file (`<bytes>.<ms>`), null when there is none: a write from outside the core changes it */
    stamp: (name: string) => Promise<string | null>
}

/** What the extensions' part of the core needs from the app */
export type ExtensionPlace = {
    folder: ExtensionFolder
    /** A file of the server's file cache (`files/cache/<bucket>.cache`); null when there is none */
    serverCache: (bucket: string) => Promise<string | null>
    /** Size and time of the last change of a file of the server's file cache, as `ExtensionFolder.stamp`; null when there is none */
    serverCacheStamp: (bucket: string) => Promise<string | null>
    /** Writes a file of the server's file cache; only `extension-settings` (switching an extension off), in its format */
    writeServerCache: (bucket: string, text: string) => Promise<void>
    /** The numbers the server gave custom sources (its table `custom_source_identifiers`), read only, by extension */
    customSourceNumbers: () => Promise<Record<string, number>>
    /**
     * The server's online-stream mappings (its table `onlinestream_mappings`), read only; null: its database is not
     * there. Left out: there is nothing to take over (§4m).
     */
    serverMappings?: () => Promise<{ provider: string, mediaId: number, animeId: string }[] | null>
    /** The server's manga mappings (its table `manga_mappings`), read only, like `serverMappings` (§4n) */
    serverMangaMappings?: () => Promise<{ provider: string, mediaId: number, mangaId: string }[] | null>
    /** The sandbox engine (device: the native module) */
    engine: () => Promise<SandboxEngine>
    /** The network as the extensions' `fetch` uses it */
    fetch: HelperFetch
    browser?: ExtensionBrowser
    log?: (id: string, level: HelperLogLevel, text: string) => void
    /** Waiting for work another request started (a read of the folder, a sandbox being opened), seen by the watch as a wait */
    join?: <T>(pending: Promise<T>) => Promise<T>
    /** Between the steps of long work (`BlockingWatch.pause`): checking every manifest of the folder (3f-4: 12–33 ms in one piece) */
    pause?: (part?: string) => Promise<void>
}

/**
 * The place with every file and database access seen by the watch of the app's thread as a wait (`BlockingWatch.waiting`).
 * Unseen, a piece of the core stayed open while the file was read on another thread (or while a request waited for a read another one started), and whatever the screens ran in
 * that time counted as the core's (docs/EIGENER-KERN.md §4l: lists 8–21 ms, switching off 54.7 ms). What such a
 * function does on the calling thread before it waits (checking that a file is there, a write) still counts.
 */
export function placeWithWaits(place: ExtensionPlace, waiting: <Args extends unknown[], Result>(wait: (...args: Args) => Promise<Result>, name?: string) => (...args: Args) => Promise<Result>): ExtensionPlace {
    const { folder } = place
    return {
        ...place,
        folder: {
            names: waiting(folder.names, "file names"),
            read: waiting(folder.read, "file read"),
            write: waiting(folder.write, "file write"),
            remove: waiting(folder.remove, "file remove"),
            stamp: waiting(folder.stamp, "file stamp"),
        },
        serverCache: waiting(place.serverCache, "serverCache"),
        serverCacheStamp: waiting(place.serverCacheStamp, "serverCacheStamp"),
        writeServerCache: waiting(place.writeServerCache, "writeServerCache"),
        customSourceNumbers: waiting(place.customSourceNumbers, "customSourceNumbers"),
        serverMappings: place.serverMappings ? waiting(place.serverMappings, "serverMappings") : undefined,
        serverMangaMappings: place.serverMangaMappings ? waiting(place.serverMangaMappings, "serverMangaMappings") : undefined,
        join: waiting(<T>(pending: Promise<T>) => pending, "join") as <T>(pending: Promise<T>) => Promise<T>,
    }
}

/** An extension that could not be used, as the server lists it */
export type InvalidExtension = {
    id: string
    path: string
    extension: ExtensionManifest
    reason: string
    code: "invalid_manifest" | "invalid_payload" | "user_config_error"
}

export type InstalledExtensions = {
    /** Valid and not switched off, by file name (the server's built-in local manga source left with the server) */
    extensions: ExtensionManifest[]
    disabled: ExtensionManifest[]
    invalid: InvalidExtension[]
    /** File name of each valid extension, by id */
    files: Map<string, string>
}

/** The file of an extension in the folder */
export function fileOf(id: string): string {
    return `${id}.json`
}

type SettingsCache = Record<string, { value?: { disabledExtensionIds?: Record<string, unknown> }, updated_at?: string }>

/**
 * Switches an extension off or on as the server does: in its file cache `extension-settings`,
 * `{ "1": { value: { disabledExtensionIds: { "<id>": true } }, updated_at } }`; switched on means the id is left out
 * (recording SetExternalExtensionDisabled: `{}` after off and on again). Other entries of the file stay as they are.
 */
export async function writeDisabled(place: ExtensionPlace, id: string, disabled: boolean, now: number): Promise<void> {
    let cache: SettingsCache = {}
    const text = await place.serverCache("extension-settings")
    if (text) {
        try {
            const parsed: unknown = JSON.parse(text)
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) cache = parsed as SettingsCache
        }
        catch {
            // a broken file is written new
        }
    }
    const entry = cache["1"] ?? {}
    const ids = { ...entry.value?.disabledExtensionIds }
    if (disabled) ids[id] = true
    else delete ids[id]
    cache["1"] = { ...entry, value: { ...entry.value, disabledExtensionIds: ids }, updated_at: new Date(now).toISOString() }
    await place.writeServerCache("extension-settings", JSON.stringify(cache))
}

/** The ids the user switched off, from the server's file cache (`extension-settings`): `{ "1": { value: { disabledExtensionIds } } }` */
export async function disabledIds(place: ExtensionPlace): Promise<Set<string>> {
    const text = await place.serverCache("extension-settings")
    if (!text) return new Set()
    try {
        const entries = Object.values(JSON.parse(text) as Record<string, { value?: { disabledExtensionIds?: Record<string, unknown> } }>)
        const ids = entries[0]?.value?.disabledExtensionIds ?? {}
        return new Set(Object.entries(ids).filter(([, off]) => off === true).map(([id]) => id))
    }
    catch {
        return new Set()
    }
}

/** A manifest as far as it could be read, for the list of invalid ones */
function partialManifest(text: string, file: string): ExtensionManifest {
    let source: Record<string, unknown> = {}
    try {
        const parsed: unknown = JSON.parse(text)
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) source = parsed as Record<string, unknown>
    }
    catch {
        // the text is no JSON: only the file name is known
    }
    const field = (name: string) => (typeof source[name] === "string" ? source[name] : "")
    return {
        id: field("id") || file.replace(/\.json$/, ""),
        name: field("name"),
        version: field("version"),
        manifestURI: field("manifestURI"),
        language: field("language"),
        type: field("type"),
        description: field("description"),
        author: field("author"),
        icon: field("icon"),
        website: field("website"),
        readme: field("readme"),
        lang: field("lang"),
        payload: "",
    }
}

const reading = new WeakMap<ExtensionPlace, Promise<InstalledExtensions>>()

/**
 * Reads the folder: every `.json` file is one extension, checked as a fetched manifest is. Requests that come while a
 * read runs share it (the extensions page asks for five lists at once); a read that starts later sees every write.
 */
export function readInstalled(place: ExtensionPlace): Promise<InstalledExtensions> {
    const running = reading.get(place)
    // joined, the read is a wait: else the piece of the request that joins stays open until the other one's files are read
    if (running) return place.join ? place.join(running) : running
    const read = readFolder(place).finally(() => {
        if (reading.get(place) === read) reading.delete(place)
    })
    reading.set(place, read)
    return read
}

/** After a write: a read still running may have missed it, the next request reads again */
export function forgetRead(place: ExtensionPlace): void {
    reading.delete(place)
}

/**
 * The checked manifest of each file, by folder and file name, with the text it was checked from. Parsing a manifest
 * with a large bundled script is one step that cannot be cut (3g: 12.7–18.0 ms on the S22 for every list and search);
 * a file whose text is the same as last time is not parsed again.
 */
const checked = new WeakMap<ExtensionPlace["folder"], Map<string, { text: string, manifest: ExtensionManifest }>>()

async function manifestOf(place: ExtensionPlace, name: string, text: string): Promise<ExtensionManifest> {
    let known = checked.get(place.folder)
    if (!known) checked.set(place.folder, known = new Map())
    const last = known.get(name)
    if (last && last.text === text) return { ...last.manifest }
    known.delete(name)
    const manifest = await manifestFromText(text, null)
    known.set(name, { text, manifest })
    return { ...manifest }
}

async function readFolder(place: ExtensionPlace): Promise<InstalledExtensions> {
    const names = (await place.folder.names()).filter(name => name.endsWith(".json")).sort()
    // a file that is gone is forgotten
    const known = checked.get(place.folder)
    for (const name of known?.keys() ?? []) if (!names.includes(name)) known?.delete(name)
    // the files are read at once, then checked in the order of their names
    const [off, texts] = await Promise.all([disabledIds(place), Promise.all(names.map(name => place.folder.read(name)))])
    const result: InstalledExtensions = { extensions: [], disabled: [], invalid: [], files: new Map() }
    const seen = new Set<string>()
    for (const [index, name] of names.entries()) {
        const text = texts[index]
        if (text === null) continue
        // each manifest carries the extension's whole code: parsed one after another, the thread is let go between them
        await place.pause?.("manifests")
        let manifest: ExtensionManifest
        try {
            manifest = await manifestOf(place, name, text)
        }
        catch (error) {
            const extension = partialManifest(text, name)
            result.invalid.push({ id: extension.id, path: `extensions/${name}`, extension, reason: error instanceof Error ? error.message : String(error), code: "invalid_manifest" })
            continue
        }
        if (seen.has(manifest.id)) {
            result.invalid.push({ id: manifest.id, path: `extensions/${name}`, extension: withoutCode(manifest), reason: "an extension with this ID is already installed", code: "invalid_manifest" })
            continue
        }
        seen.add(manifest.id)
        result.files.set(manifest.id, name)
        if (off.has(manifest.id)) result.disabled.push(manifest)
        else result.extensions.push(manifest)
    }
    return result
}

/** As the lists show an extension: everything but its code (recordings: `payload` is "") */
export function withoutCode(manifest: ExtensionManifest): ExtensionManifest {
    return { ...manifest, payload: "" }
}
