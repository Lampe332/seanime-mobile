// geschrieben nach: Auftrag „Sichern + Wiederherstellen“ (15.11.2026), core/backup/backup.ts (Format) und lib/file-transfer.ts (Dateiauswahl, Teilen); kein Server-Quelltext

import { coreMakeBackup, coreRestoreBackup } from "@/api/client/core-switch"
import { type BackupFile, type BackupSummary, type RestoreMode, backupSummary, readBackup } from "@/core"
import { pickFiles, saveExport } from "@/lib/file-transfer"
import { storage } from "@/lib/storage"
import * as Application from "expo-application"
import { Directory, File, Paths } from "expo-file-system"

/*
 * The app's side of the backup: the preferences of its own store go in with the core's data, the file is saved in a
 * folder the user picks on the device (or handed to Android's share sheet: Drive, send), and a restore picks a file with
 * the system's document picker.
 * Before every restore the current state is written to one file in the app's own folder, so the last restore can be
 * undone. The app starts anew after a restore: its screens and caches read everything again.
 */

/** Keys of the store that belong to this device or this install, not to the user's choices */
const DEVICE_KEYS = [
    /^seanime-core-/,
    /^seanime-client-id/,
    /^seanime-mobile-airing-(announced|next|next-check|scheduled)$/,
    /^seanime-mobile-app-update/,
    /^notified-available-app-update$/,
    /^RELEASES-/,
    /^seanime-mobile-legacy-preferences-copied$/,
    /^seanime-mobile-anilist-user$/,
]

function appPreferences(): Record<string, string> {
    const result: Record<string, string> = {}
    for (const key of storage.getAllKeys()) {
        if (DEVICE_KEYS.some(pattern => pattern.test(key))) continue
        const value = storage.getString(key)
        if (value !== undefined) result[key] = value
    }
    return result
}

function safetyFile(): File {
    const folder = new Directory(Paths.document, "backups")
    if (!folder.exists) folder.create({ intermediates: true })
    return new File(folder, "before-restore.json")
}

export async function makeBackupFile(): Promise<BackupFile> {
    return coreMakeBackup({ appVersion: Application.nativeApplicationVersion ?? "", preferences: appPreferences() })
}

/** Writes a backup and opens the share sheet with it */
export async function shareBackup(fileName: string): Promise<void> {
    const file = await makeBackupFile()
    await saveExport(JSON.stringify(file), fileName, "application/json")
}

/** Where Android's folder picker opens: Downloads on the device's own storage (a folder in it can be chosen or made) */
const DOWNLOADS_FOLDER = "content://com.android.externalstorage.documents/document/primary%3ADownload"

/**
 * Saves a backup on the device: the user picks a folder with Android's folder picker (Storage Access Framework), the
 * file goes in there under `fileName` (Android adds " (1)" when that name is taken). Returns the folder's and the
 * file's name, or null when the picker was cancelled.
 */
export async function saveBackupToDevice(fileName: string): Promise<{ folder: string, file: string } | null> {
    let folder: Directory
    try {
        folder = await Directory.pickDirectoryAsync(DOWNLOADS_FOLDER)
    }
    catch (error) {
        if (error instanceof Error && /cancel/i.test(error.message)) return null
        throw error
    }
    const backup = await makeBackupFile()
    const target = folder.createFile(fileName, "application/json")
    target.write(JSON.stringify(backup))
    return { folder: folder.name, file: target.name }
}

/** Lets the user pick a backup; null when cancelled. Throws (with a readable message) when the file is no valid backup. */
export async function pickBackup(): Promise<{ file: BackupFile, summary: BackupSummary } | null> {
    const [picked] = await pickFiles({ type: ["application/json", "application/octet-stream", "text/plain"] })
    if (!picked) return null
    const file = readBackup(await new File(picked.uri).text())
    return { file, summary: backupSummary(file) }
}

/** Restores a backup: the current state goes to the safety file first, then the app starts anew */
export async function restoreBackupFile(file: BackupFile, mode: RestoreMode): Promise<void> {
    const before = await makeBackupFile()
    safetyFile().write(JSON.stringify(before))
    const { preferences } = await coreRestoreBackup(file, mode, { preferences: appPreferences() })
    for (const [key, value] of Object.entries(preferences)) storage.set(key, value)
}

export function hasSafetyBackup(): boolean {
    return safetyFile().exists
}

/** The state before the last restore, or null when there was none */
export async function lastSafetyBackup(): Promise<{ file: BackupFile, summary: BackupSummary } | null> {
    const safety = safetyFile()
    if (!safety.exists) return null
    const file = readBackup(await safety.text())
    return { file, summary: backupSummary(file) }
}
