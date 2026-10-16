declare global {
    interface Window {
        SeanimeAndroid?: { getAppVersion(): string }
    }
}

export function getAndroidAppVersion(): string | undefined {
    if (typeof window === "undefined") return undefined
    return window.SeanimeAndroid?.getAppVersion()
}
