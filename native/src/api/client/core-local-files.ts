// geschrieben nach: docs/EIGENER-KERN.md §4p (Phase 5b-1/5b-2: Geräte-Seite der Bibliotheks-Ordner), Muster core-offline.ts/core-extensions.ts (Funktionen aus `expo-file-system/legacy`, Warten über die Wache), Doku von expo-file-system (readDirectoryAsync, getInfoAsync, deleteAsync); kein Server-Quelltext
import type { BlockingWatch, LocalFolderEntry, LocalFolders } from "@/core"
import { File } from "expo-file-system"
import { deleteAsync, getInfoAsync, readDirectoryAsync } from "expo-file-system/legacy"

/*
 * The device's side of the core's library folders (library/scan.ts, library/folders.ts): one folder of the user's
 * library listed by its path (e.g. /storage/emulated/0/Movies), names and sizes only, an empty folder removed, and one
 * file deleted when the user deletes it (4.3.1; the core checks it is a library file first). Nothing here writes or
 * moves a file. Reading and deleting in another app's folders needs the "all files" access the app already asks for
 * (AndroidManifest MANAGE_EXTERNAL_STORAGE).
 *
 * Only the module's async functions: they run on the module's thread and are waits of the watch. The newer
 * Directory/File (`list()`, `size`) ran on the screens' thread: 9.5 ms "library scan folders" on the tablet (5b-1).
 */

const addressOf = (path: string) => "file://" + path.split("/").map(part => encodeURIComponent(part)).join("/")

async function list(path: string): Promise<LocalFolderEntry[]> {
    const address = addressOf(path)
    const folder = await getInfoAsync(address)
    if (!folder.exists || !folder.isDirectory) throw new Error("the folder is not there or cannot be read")
    const names = await readDirectoryAsync(address)
    return Promise.all(names.map(async name => {
        const info = await getInfoAsync(`${address}/${encodeURIComponent(name)}`)
        return info.exists && info.isDirectory
            ? { name, folder: true, size: 0 }
            : { name, folder: false, size: info.exists ? info.size ?? 0 : 0 }
    }))
}

async function removeEmptyFolder(path: string): Promise<boolean> {
    const address = addressOf(path)
    const folder = await getInfoAsync(address)
    if (!folder.exists || !folder.isDirectory) return false
    // read again right before: a folder that holds anything (also a hidden file) stays
    if ((await readDirectoryAsync(address)).length > 0) return false
    await deleteAsync(address, { idempotent: true })
    return true
}

async function removeFile(path: string): Promise<boolean> {
    const address = addressOf(path)
    const file = await getInfoAsync(address)
    if (!file.exists) return true
    // a folder is never deleted here
    if (file.isDirectory) return false
    // Not the legacy deleteAsync: it checks write access on "<file>/..", which Android does not resolve for a file, so
    // every library file outside the app's own storage was "isn't deletable" (4.3.1 device test). File#delete checks
    // the file itself; one file, so being on the screens' thread for it is fine.
    new File(address).delete()
    return !(await getInfoAsync(address)).exists
}

export function localFoldersFor(watch: BlockingWatch): LocalFolders {
    return {
        list: watch.waiting(list, "folder list"),
        removeEmptyFolder: watch.waiting(removeEmptyFolder, "folder remove"),
        removeFile: watch.waiting(removeFile, "file remove"),
    }
}
