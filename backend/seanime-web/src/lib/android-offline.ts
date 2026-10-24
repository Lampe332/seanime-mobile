import "@/lib/app-language"
/** The native download and offline-player bridge (OfflineBridge.kt). */
declare global {
    interface Window {
        SeanimeOffline?: {
            download(token: string, payload: string): void
            snapshot(token: string): string
            action(token: string, id: string, action: string): void
            batch(token: string, payload: string): string
            cacheManga(token: string, payload: string): string
        }
        __seanimeOfflineToken?: string
    }
}
export function openAndroidDownloads(kind?: unknown) {
    document.querySelectorAll("video").forEach(video => video.pause())
    window.dispatchEvent(new CustomEvent("seanime-open-downloads", { detail: { kind: kind === "manga" ? "manga" : "anime" } }))
}
/** Fired after this app queued a download, so offline lists that do not poll while idle look again. */
export const OFFLINE_CHANGED_EVENT = "seanime:offline-changed"
export const notifyOfflineChanged = () => window.dispatchEvent(new Event(OFFLINE_CHANGED_EVENT))
export function downloadOnAndroid(payload: unknown) {
    if (!window.SeanimeOffline || !window.__seanimeOfflineToken) return false
    window.SeanimeOffline.download(window.__seanimeOfflineToken, JSON.stringify(payload))
    notifyOfflineChanged()
    return true
}
