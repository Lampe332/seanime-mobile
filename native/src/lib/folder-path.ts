import type { Translate } from "@/lib/app-language"

/*
 * The system folder picker (expo-file-system Directory.pickDirectoryAsync) answers with a SAF tree URI; the Go server
 * reads plain paths. Same translation as the old app (MainActivity.primaryStoragePath), plus:
 * - the user's own storage: /storage/emulated/<user>, not always 0 (the tablet runs the app as user 10, where
 *   /storage/emulated/0 does not exist for the app)
 * - SD cards and USB drives: "1A2B-3C4D:Anime" → /storage/1A2B-3C4D/Anime
 * - "home:" (the picker's "Documents" entry on newer Android) → <storage>/Documents
 * Anything else (Downloads provider, cloud apps) has no path the server could read.
 */

const EXTERNAL_STORAGE_AUTHORITY = "com.android.externalstorage.documents"

/** The Android user the app runs as, read from its own files folder (file:///data/user/10/<package>/files/). */
export function androidUserId(documentUri: string | null | undefined) {
    const match = /\/data\/user\/(\d+)\//.exec(documentUri ?? "")
    return match ? Number(match[1]) : 0
}

/** content://…externalstorage.documents/tree/primary%3AAnime%2FSub → /storage/emulated/0/Anime/Sub; null without a path. */
export function treeUriToPath(uri: string, userId = 0): string | null {
    const match = /^content:\/\/([^/]+)\/tree\/([^/?#]+)/.exec(uri.trim())
    if (!match || match[1] !== EXTERNAL_STORAGE_AUTHORITY) return null
    let documentId: string
    try {
        documentId = decodeURIComponent(match[2])
    }
    catch {
        return null
    }
    const colon = documentId.indexOf(":")
    if (colon <= 0) return null
    const volume = documentId.slice(0, colon)
    const relative = documentId.slice(colon + 1).split("/").filter(Boolean)
    if (relative.some(part => part === "." || part === "..")) return null
    const storage = `/storage/emulated/${userId}`
    const base = volume === "primary" ? storage
        : volume === "home" ? `${storage}/Documents`
            : /^[A-Za-z0-9-]+$/.test(volume) ? `/storage/${volume}` : null
    if (!base) return null
    return relative.length ? `${base}/${relative.join("/")}` : base
}

export type FolderPickProblem = "cancelled" | "not-local" | "permission" | "missing" | "unreadable" | "unavailable"

/**
 * What the server said about a picked folder (POST /api/v1/mobile-storage/access), as the problem to show; null = fine.
 * needsAllFiles: Android 11+ (before that the read permission is enough and the server's write probe means nothing).
 */
export function accessProblem(access: { exists: boolean, readable: boolean, allFilesAccess: boolean } | null | undefined,
    needsAllFiles = true): FolderPickProblem | null {
    if (!access) return "unavailable"
    if (needsAllFiles && !access.allFilesAccess) return "permission"
    if (!access.exists) return "missing"
    if (!access.readable) return "unreadable"
    return null
}

/** The toast for a problem, or null when the user just cancelled (web folderPickProblem). */
export function folderPickProblemText(problem: FolderPickProblem, t: Translate): string | null {
    switch (problem) {
        case "cancelled":
            return null
        case "not-local":
            return t("Please choose a folder on the internal storage or SD card.", "Bitte einen Ordner im internen Speicher oder auf der SD-Karte wählen.")
        case "permission":
            return t("Allow \"All files access\" for Seanime, then choose the folder again.", "Erlaube Seanime den Zugriff auf alle Dateien und wähle den Ordner dann erneut.")
        case "missing":
            return t("This folder was not found.", "Dieser Ordner wurde nicht gefunden.")
        case "unreadable":
            return t("Seanime cannot read this folder.", "Seanime kann diesen Ordner nicht lesen.")
        default:
            return t("The folder picker is not available.", "Die Ordnerauswahl ist nicht verfügbar.")
    }
}
