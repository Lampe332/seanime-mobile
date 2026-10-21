// window.SeanimeAndroid is declared in app-language.ts.

/** Error codes of `pickAndroidFolder()`; the native side reports the first three. */
export type AndroidFolderPickError = "cancelled" | "not-primary" | "permission" | "unavailable" | "timeout"

const EVENT_NAME = "seanime-folder-picked"
const TIMEOUT = 10 * 60_000
let nextRequest = 0

/** True when the Android app can open the system folder picker. */
export function canPickAndroidFolder(): boolean {
    return typeof window !== "undefined" && typeof window.SeanimeAndroid?.pickFolder === "function"
}

/**
 * Opens the Android folder picker and resolves with a plain path on shared storage (e.g. `/storage/emulated/0/Anime`).
 * Rejects with `Error(code)`, code being an `AndroidFolderPickError`. Without "All files access" the app opens that
 * permission screen instead and rejects with "permission".
 */
export function pickAndroidFolder(): Promise<string> {
    const bridge = window.SeanimeAndroid
    if (!bridge?.pickFolder) return Promise.reject(new Error("unavailable"))
    const requestId = `folder-${Date.now()}-${++nextRequest}`
    return new Promise((resolve, reject) => {
        const finish = (error?: string, path?: string) => {
            clearTimeout(timer)
            window.removeEventListener(EVENT_NAME, onResult)
            if (error || !path) reject(new Error(error || "unavailable"))
            else resolve(path)
        }
        const onResult = (event: Event) => {
            const data = (event as CustomEvent).detail
            if (data?.requestId !== requestId) return
            finish(data.error, data.path)
        }
        const timer = setTimeout(() => finish("timeout"), TIMEOUT)
        window.addEventListener(EVENT_NAME, onResult)
        try { bridge.pickFolder!(requestId) } catch { finish("unavailable") }
    })
}
