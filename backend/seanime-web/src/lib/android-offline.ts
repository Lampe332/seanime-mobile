/** Android-only capabilities. Desktop and ordinary web clients keep their existing behavior. */
declare global {
    interface Window {
        SeanimeOffline?: {
            open(token: string): void
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
export function downloadOnAndroid(payload: unknown) {
    if (!window.SeanimeOffline || !window.__seanimeOfflineToken) return false
    window.SeanimeOffline.download(window.__seanimeOfflineToken, JSON.stringify(payload))
    return true
}
