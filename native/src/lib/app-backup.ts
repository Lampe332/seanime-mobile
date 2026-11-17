// geschrieben nach: Auftrag „Sichern + Wiederherstellen“ (15.11.2026), core/backup/backup.ts (Format) und lib/file-transfer.ts (Dateiauswahl, Teilen); kein Server-Quelltext

import { coreMakeBackup, coreRestoreBackup } from "@/api/client/core-switch"
import { type BackupFile, type BackupSummary, type RestoreMode, backupSummary, readBackup } from "@/core"
import { isDeviceKey, withoutDeviceKeys } from "@/lib/app-backup-keys"
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

/** The app's own preferences without the device's keys (also the account sync's part) */
export function appPreferences(): Record<string, string> {
    const result: Record<string, string> = {}
    for (const key of storage.getAllKeys()) {
        if (isDeviceKey(key)) continue
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
    await writeSafetyBackup()
    const { preferences } = await coreRestoreBackup(file, mode, { preferences: appPreferences() })
    writeAppPreferences(preferences)
}

/** The current state into the safety file ("Undo last restore"); also before an import from the account */
export async function writeSafetyBackup(): Promise<void> {
    const before = await makeBackupFile()
    safetyFile().write(JSON.stringify(before))
}

/** Preferences from a backup or the account into the app's store */
export function writeAppPreferences(preferences: Record<string, string>): void {
    // the device's own keys are never written from a file (app-backup-keys.ts); the app's backups do not hold them
    for (const [key, value] of Object.entries(withoutDeviceKeys(preferences))) storage.set(key, value)
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
