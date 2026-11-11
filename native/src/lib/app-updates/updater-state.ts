import { compareVersions } from "./app-release-policy"
import { installed } from "./update-install-policy"

/** What the update notice reads (the web app's AppDownloadState, lib/app-updates.ts). */
export type AppDownloadStatus =
    "idle" | "downloading" | "verifying" | "complete" | "permission" | "confirmation" | "preparing" | "installing" | "failed" | "installed" | "error"

export type AppDownloadState = {
    status: AppDownloadStatus
    verified?: boolean, version?: string, fileName?: string, location?: string, bytes?: number, total?: number, sha256?: string, error?: string, message?: string
}

/** The durable update transaction (AppUpdater.kt + UpdateInstaller.kt prefs "app_updater"). */
export type UpdateTransaction = {
    status: AppDownloadStatus
    version?: string
    fileName?: string
    /** expected bytes and "sha256:…" digest from the release asset (GitHub) */
    size?: number
    digest?: string
    /** the downloaded file, checked */
    sha256?: string
    bytes?: number
    total?: number
    /** installed versionCode when the installer opened, and when */
    fromCode?: number
    installStarted?: number
    successUnread?: boolean
    error?: string
}

/** An installer that did not come back within this time counts as cancelled (UpdateInstaller.reconcile). */
export const INSTALL_TIMEOUT_MS = 30 * 60 * 1000

/**
 * Only the installed package metadata completes an update: a higher versionCode than when the installer opened, with
 * the release's versionName. The APK's own versionCode is not readable without native code, so the target is "higher
 * than before" (see docs/NATIVE-UMBAU.md §9).
 */
export function reconcile(tx: UpdateTransaction, actualCode: number, actualVersion: string, now: number): UpdateTransaction {
    const before = tx.fromCode ?? -1
    if (before > 0 && installed(before, before + 1, actualCode) && !!tx.version && actualVersion === tx.version) {
        if (tx.status === "installed") return tx
        return { status: "installed", version: actualVersion, successUnread: true }
    }
    if ((tx.status === "installing" || tx.status === "confirmation") && now - (tx.installStarted ?? 0) > INSTALL_TIMEOUT_MS) {
        return { ...tx, status: "failed", error: "Installation interrupted or cancelled. Retry to install the verified APK." }
    }
    return tx
}

/**
 * A download that no request of this process runs: the app was ended while it downloaded or checked the file. Saved as
 * "downloading"/"verifying", it would block every later tap ("Update" returns the stale state), so it becomes an error
 * the notice offers to retry.
 */
export function interruptedDownload(tx: UpdateTransaction): UpdateTransaction {
    if (tx.status !== "downloading" && tx.status !== "verifying") return tx
    return { ...tx, status: "error", error: "Download interrupted. Try again." }
}

/** The state the notice shows; a finished or outdated transaction shows as idle. */
export function publicState(tx: UpdateTransaction, currentVersion: string): AppDownloadState {
    if (tx.status === "installed") return tx.successUnread ? { status: "installed", version: tx.version } : { status: "idle" }
    if (tx.status === "idle" || !tx.version || compareVersions(tx.version, currentVersion) <= 0) return { status: "idle" }
    return {
        status: tx.status,
        verified: !!tx.sha256,
        version: tx.version,
        fileName: tx.fileName,
        bytes: tx.bytes,
        total: tx.total,
        sha256: tx.sha256,
        error: tx.error,
    }
}

export const MISSING_DIGEST = "GitHub gave no checksum for this APK, so it is not installed. Try again later."
export const DIGEST_MISMATCH = "APK checksum mismatch: the download was deleted and nothing was installed."

/** GitHub's own SHA-256 of a release asset ("sha256:<64 hex>"); without it the updater installs nothing. */
export function hasReleaseDigest(digest: string | undefined): boolean {
    return /^sha256:[0-9a-f]{64}$/i.test(digest ?? "")
}

/** A finished download is used only when it is complete and matches the expected size and GitHub's digest. */
export function checkDownload(size: number, digestHex: string, expectedSize: number, expectedDigest: string): string | null {
    if (!hasReleaseDigest(expectedDigest)) return MISSING_DIGEST
    if (size <= 0 || (expectedSize > 0 && size !== expectedSize)) return `Incomplete APK: ${size} / ${expectedSize} bytes`
    if (expectedDigest.toLowerCase() !== `sha256:${digestHex.toLowerCase()}`) return DIGEST_MISMATCH
    return null
}
