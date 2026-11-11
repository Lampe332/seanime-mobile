import { readStoredJSON, storage } from "@/lib/storage"
import * as Application from "expo-application"
import { Directory, File, Paths } from "expo-file-system"
import * as IntentLauncher from "expo-intent-launcher"
import { Platform } from "react-native"
import { compareVersions, parseReleases, RELEASES_URL, REPOSITORY, selectUpdate, type Update } from "./app-release-policy"
import { AppDownloadState, checkDownload, hasReleaseDigest, interruptedDownload, MISSING_DIGEST, publicState, reconcile, UpdateTransaction } from "./updater-state"

/*
 * In-app updater (AppUpdater.kt + UpdateInstaller.kt): only stable universal APKs of this app's own GitHub repository
 * (public API, no token), downloaded into the app's files folder, checked against GitHub's size and SHA-256, then
 * handed to Android's package installer. The update counts as installed only when the package metadata shows it
 * (updater-state.ts). Android itself refuses an APK with another signature or a lower versionCode.
 */
export type AppUpdate = {
    type: string
    current_version?: string
    release?: { version: string, tag_name: string, name: string, body: string, html_url: string, released: boolean }
}

const KNOWN_KEY = "seanime-mobile-app-update-known"
const TX_KEY = "seanime-mobile-app-update"
const APK_MIME = "application/vnd.android.package-archive"
const FLAG_GRANT_READ_URI_PERMISSION = 1

export const currentVersion = () => Application.nativeApplicationVersion ?? "0.0.0"
const installedCode = () => Number(Application.nativeBuildVersion ?? 0) || 0

function readTx(): UpdateTransaction {
    return readStoredJSON<UpdateTransaction>(TX_KEY, { status: "idle" })
}

const listeners = new Set<() => void>()
let snapshot: AppDownloadState = publicState(readTx(), currentVersion())

function writeTx(tx: UpdateTransaction) {
    storage.set(TX_KEY, JSON.stringify(tx))
    snapshot = publicState(tx, currentVersion())
    listeners.forEach(listener => listener())
}

/** For useSyncExternalStore: the download/install state, kept across app restarts. */
export function subscribeAppDownload(listener: () => void) {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

export function readAppDownload(): AppDownloadState {
    return snapshot
}

const updateFolder = () => new Directory(Paths.document, "app-update")
const apkFile = (fileName: string) => new File(updateFolder(), fileName)

async function fetchUpdate(): Promise<Update | null> {
    const res = await fetch(RELEASES_URL, { headers: { Accept: "application/vnd.github+json", "User-Agent": "Seanime-Mobile-Updater" } })
    if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`)
    return selectUpdate(currentVersion(), parseReleases(await res.json()))
}

/** Asks GitHub; the answer is remembered, so the notice can show it right after a restart. */
export async function checkAppUpdate(): Promise<AppUpdate> {
    if (Platform.OS !== "android") throw new Error("App updater unavailable")
    const update = await fetchUpdate()
    const data: AppUpdate = { type: "app", current_version: currentVersion() }
    if (update) {
        data.release = {
            version: update.version, tag_name: update.release.tag, name: `Seanime Mobile ${update.version}`, body: update.release.body,
            html_url: `https://github.com/${REPOSITORY}/releases/tag/${update.release.tag}`, released: true,
        }
    }
    storage.set(KNOWN_KEY, JSON.stringify(data))
    return data
}

/** The last answer, while it still is about this app version and offers something newer. */
export function knownAppUpdate(): AppUpdate | undefined {
    const data = readStoredJSON<AppUpdate | null>(KNOWN_KEY, null)
    if (!data || data.current_version !== currentVersion()) return undefined
    return data.release && compareVersions(data.release.version, currentVersion()) > 0 ? data : undefined
}

/** At the app start: an update that Android installed meanwhile completes; an installer that never came back fails. */
export function reconcileAppUpdate() {
    if (Platform.OS !== "android") return
    const saved = readTx()
    // a download of this process is still running (the app root mounted again); anything else saved as running was cut off
    const before = downloadRequest ? saved : interruptedDownload(saved)
    const after = reconcile(before, installedCode(), currentVersion(), Date.now())
    if (after.status === "installed" && before.status !== "installed") {
        try {
            const folder = updateFolder()
            if (folder.exists) folder.delete()
        }
        catch {
            // the files folder is cleaned up next time
        }
    }
    writeTx(after)
}

/** The visible "Update" tap authorizes download and installation; repeated taps share one request. */
let downloadRequest: Promise<AppDownloadState> | undefined

export function downloadAppUpdate(): Promise<AppDownloadState> {
    if (!downloadRequest) {
        downloadRequest = runDownload().finally(() => {
            downloadRequest = undefined
        })
    }
    return downloadRequest
}

async function runDownload(): Promise<AppDownloadState> {
    if (Platform.OS !== "android") throw new Error("App updater unavailable")
    const previous = readTx()
    if (previous.status === "installing" || previous.status === "downloading") return readAppDownload()
    const update = await fetchUpdate()
    if (!update) throw new Error("No newer app APK is available")
    if (previous.status === "complete" && previous.version === update.version && previous.fileName && apkFile(previous.fileName).exists) {
        await openDownloadedApk()
        return readAppDownload()
    }
    // no download without GitHub's own checksum of the asset: nothing could prove the APK is the released one
    if (!hasReleaseDigest(update.asset.digest)) {
        writeTx({ status: "error", version: update.version, fileName: update.asset.name, error: MISSING_DIGEST })
        throw new Error(MISSING_DIGEST)
    }
    const folder = updateFolder()
    if (folder.exists) folder.delete()
    folder.create({ intermediates: true })
    const file = apkFile(update.asset.name)
    const tx: UpdateTransaction = {
        status: "downloading", version: update.version, fileName: update.asset.name, size: update.asset.size, digest: update.asset.digest,
        bytes: 0, total: update.asset.size,
    }
    writeTx(tx)
    let lastReport = 0
    try {
        await File.createDownloadTask(update.asset.url, file, {
            onProgress: ({ bytesWritten, totalBytes }) => {
                const now = Date.now()
                if (now - lastReport < 500) return
                lastReport = now
                writeTx({ ...tx, bytes: bytesWritten, total: totalBytes > 0 ? totalBytes : tx.total })
            },
        }).downloadAsync()
        writeTx({ ...tx, status: "verifying", bytes: file.size, total: file.size })
        const digest = await file.digest("SHA-256")
        const problem = checkDownload(file.size, digest, update.asset.size, update.asset.digest)
        if (problem) throw new Error(problem)
        writeTx({ ...tx, status: "complete", sha256: digest, bytes: file.size, total: file.size })
    }
    catch (error) {
        try {
            if (file.exists) file.delete()
        }
        catch {
            // removed with the next download
        }
        const message = error instanceof Error ? error.message : "Download failed"
        writeTx({ ...tx, status: "error", error: message })
        throw new Error(message)
    }
    await openDownloadedApk()
    return readAppDownload()
}

/** Opens Android's installer for the checked APK (also "Retry" after a cancelled installation). */
export async function openDownloadedApk() {
    const tx = readTx()
    if (!tx.fileName || !tx.sha256 || !tx.version) return
    const file = apkFile(tx.fileName)
    // the APK must still be the one that was checked
    if (!file.exists || (await file.digest("SHA-256")) !== tx.sha256) {
        writeTx({ status: "failed", version: tx.version, error: "Verified APK missing. Download again." })
        return
    }
    if (compareVersions(tx.version, currentVersion()) <= 0) {
        writeTx({ status: "idle" })
        return
    }
    // saved before the installer opens: Android ends this process as soon as it replaces the package
    const installing: UpdateTransaction = { ...tx, status: "installing", fromCode: installedCode(), installStarted: Date.now(), error: undefined }
    writeTx(installing)
    try {
        await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
            data: file.contentUri, type: APK_MIME, flags: FLAG_GRANT_READ_URI_PERMISSION,
        })
    }
    catch (error) {
        writeTx({ ...installing, status: "failed", error: error instanceof Error ? error.message : "Cannot open the installer" })
        return
    }
    // back from the installer without the process being replaced: cancelled or failed
    const after = reconcile(readTx(), installedCode(), currentVersion(), Date.now())
    writeTx(after.status === "installing"
        ? { ...after, status: "failed", error: "Installation cancelled. You can retry the verified APK." }
        : after)
}

/** The notice confirmed the installed update. */
export function acknowledgeInstalledUpdate() {
    const tx = readTx()
    if (tx.status === "installed") writeTx({ ...tx, successUnread: false })
}
