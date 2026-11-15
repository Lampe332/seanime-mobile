// geschrieben nach: docs/EIGENER-KERN.md §4l (Erweiterungs-Verwaltung: Ordner und Datei-Cache des Servers im Dateien-Ordner der App) und der Doku von expo-file-system (Directory, File, Paths; seit 3f-4 die Funktionen aus `expo-file-system/legacy`); kein Server-Quelltext
import { openOldData } from "@/api/client/core-move"
import { extensionTools } from "@/api/client/core-sandbox"
import { type ExtensionPlace, type createBlockingWatch, openExtensionSandboxes, placeWithWaits } from "@/core"
import { logger } from "@/lib/helpers/debug"
import { documentDirectory, getInfoAsync, makeDirectoryAsync, readAsStringAsync, readDirectoryAsync, deleteAsync, writeAsStringAsync } from "expo-file-system/legacy"

/*
 * The device side of the extensions' management (core/extensions/manage/): the server keeps its extensions in the
 * app's own files folder, `extensions/<id>.json`, and its file cache in `cache/<bucket>.cache`. Of the cache only
 * `extension-settings` is written (switching off); the folder by installing, updating, editing or uninstalling.
 */

type Watch = ReturnType<typeof createBlockingWatch>

let place: ExtensionPlace | null = null

/** How many extension sandboxes are open now; 0 before the extensions were first needed (test link core?memory=report) */
export function openSandboxCount(): number {
    return place ? openExtensionSandboxes(place) : 0
}

/*
 * Every access goes through the module's own thread (its async functions), so that each one is a real wait for the
 * watch. The newer `File`/`Directory` objects check `exists`, list a folder, read size and time and write on the
 * calling thread (3f-4: 13–38 ms before "file names", 14 ms before "file write", 9 ms before "file stamp" on the
 * tablet, docs/EIGENER-KERN.md §4m).
 */
function under(...parts: string[]): string {
    return `${documentDirectory ?? ""}${parts.join("/")}`
}

const EXTENSIONS = "extensions"

/** `<bytes>.<ms>` of a file, null when there is none (§4l: the key of what getSettings() gave); the same form as before 3f-4 */
async function stampOf(uri: string): Promise<string | null> {
    const info = await getInfoAsync(uri)
    return info.exists && !info.isDirectory ? `${info.size}.${Math.round(info.modificationTime * 1000)}` : null
}

async function textOf(uri: string): Promise<string | null> {
    const info = await getInfoAsync(uri)
    return info.exists && !info.isDirectory ? readAsStringAsync(uri) : null
}

async function writeIn(folder: string, name: string, text: string): Promise<void> {
    await makeDirectoryAsync(under(folder), { intermediates: true })
    await writeAsStringAsync(under(folder, name), text)
}

/** One place for the app's whole run, so that the open sandboxes and what the extensions told are kept between requests */
export function extensionPlaceFor(watch: Watch): ExtensionPlace {
    if (place) return place
    const tools = extensionTools(watch)
    // every file and database access is a wait for the watch: the files are read on expo-file-system's thread
    place = placeWithWaits({
        folder: {
            names: async () => {
                const folder = await getInfoAsync(under(EXTENSIONS))
                if (!folder.exists) return []
                // only files are extensions; each name is asked about on the module's thread too
                const names = await readDirectoryAsync(under(EXTENSIONS))
                const kinds = await Promise.all(names.map(name => getInfoAsync(under(EXTENSIONS, name))))
                return names.filter((_name, index) => kinds[index]!.exists && !kinds[index]!.isDirectory)
            },
            read: name => textOf(under(EXTENSIONS, name)),
            write: (name, text) => writeIn(EXTENSIONS, name, text),
            remove: name => deleteAsync(under(EXTENSIONS, name), { idempotent: true }),
            stamp: name => stampOf(under(EXTENSIONS, name)),
        },
        serverCache: bucket => textOf(under("cache", `${bucket}.cache`)),
        serverCacheStamp: bucket => stampOf(under("cache", `${bucket}.cache`)),
        writeServerCache: async (bucket, text) => {
            // the one file of the cache the core writes: which extensions are switched off (§4l)
            if (bucket !== "extension-settings") throw new Error(`the core does not write the server's cache ${bucket}`)
            await writeIn("cache", `${bucket}.cache`, text)
        },
        customSourceNumbers: async () => {
            const { old, close } = openOldData()
            try {
                const rows = await old.rows("custom_source_identifiers") ?? []
                return Object.fromEntries(rows.map(row => [String(row.extension_id), Number(row.value)]))
            }
            finally {
                await close()
            }
        },
        serverMappings: async () => {
            // read once (§4m): the server's database as a copy in memory, the server's own file is not touched
            const { old, close } = openOldData()
            try {
                const rows = await old.rows("onlinestream_mappings")
                return rows && rows.map(row => ({ provider: String(row.provider ?? ""), mediaId: Number(row.media_id), animeId: String(row.anime_id ?? "") }))
            }
            finally {
                await close()
            }
        },
        serverMangaMappings: async () => {
            // read once (§4n), like the online-stream mappings
            const { old, close } = openOldData()
            try {
                const rows = await old.rows("manga_mappings")
                return rows && rows.map(row => ({ provider: String(row.provider ?? ""), mediaId: Number(row.media_id), mangaId: String(row.manga_id ?? "") }))
            }
            finally {
                await close()
            }
        },
        engine: tools.engine,
        fetch: tools.fetch,
        browser: tools.browser,
        pause: watch.pause,
        log: (id, level, text) => logger("Extension").info(`${id} ${level}: ${text.slice(0, 300)}`),
    }, watch.waiting)
    return place
}
