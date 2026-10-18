import type { Updater_Update } from "@/api/generated/types"

export const IS_MOBILE_APP = import.meta.env.SEA_PUBLIC_PLATFORM === "mobile"
declare global {
    interface Window {
        AppUpdater?: { checkForUpdates?(requestId: string): void, downloadUpdate?(requestId: string): void, getKnownUpdate?(): string, getDownloadState?(): string, openDownloadedApk?(): void }
    }
}
let nextRequest = 0

function nativeRequest<T>(eventName: string, method: "checkForUpdates" | "downloadUpdate", timeout: number): Promise<T> {
    const bridge = window.AppUpdater
    if (!bridge?.[method]) return Promise.reject(new Error("App updater unavailable"))
    const requestId = `${Date.now()}-${++nextRequest}`
    return new Promise((resolve, reject) => {
        const finish = (error?: string, result?: T) => {
            clearTimeout(timer)
            window.removeEventListener(eventName, onResult)
            if (error) reject(new Error(error))
            else resolve(result!)
        }
        const onResult = (event: Event) => {
            const data = (event as CustomEvent).detail
            if (data?.requestId !== requestId) return
            finish(data.error, data)
        }
        const timer = setTimeout(() => finish("App update request timed out"), timeout)
        window.addEventListener(eventName, onResult)
        try { bridge[method]!(requestId) } catch (error) { finish(String(error)) }
    })
}

export async function checkAppUpdate(): Promise<Updater_Update> {
    // Builds without the app bridge never fall back to desktop release feeds.
    if (!window.AppUpdater?.checkForUpdates) throw new Error("App updater unavailable")
    return (await nativeRequest<{ update: Updater_Update }>("seanime-app-update", "checkForUpdates", 60_000)).update
}

export type AppDownloadState = {
    status: "idle" | "downloading" | "complete" | "error"
    version?: string, fileName?: string, location?: string, bytes?: number, total?: number, sha256?: string, error?: string, message?: string
}
let downloadRequest: Promise<AppDownloadState> | undefined
export function readAppDownload(): AppDownloadState {
    try { return JSON.parse(window.AppUpdater?.getDownloadState?.() || '{"status":"idle"}') as AppDownloadState }
    catch { return { status: "error", error: "Download status unavailable" } }
}
export function downloadAppUpdate(): Promise<AppDownloadState> {
    if (downloadRequest) return downloadRequest
    downloadRequest = nativeRequest<{ state: AppDownloadState }>("seanime-app-download", "downloadUpdate", 60_000)
        .then(result => result.state).finally(() => { downloadRequest = undefined })
    return downloadRequest
}

export function knownAppUpdate(): Updater_Update | undefined {
    try { return (JSON.parse(window.AppUpdater?.getKnownUpdate?.() || "null") as Updater_Update | null) || undefined }
    catch { return undefined }
}
