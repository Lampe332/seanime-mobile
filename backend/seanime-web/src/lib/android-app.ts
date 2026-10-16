import "@/lib/app-language"

export function getAndroidAppVersion(): string | undefined {
    if (typeof window === "undefined") return undefined
    return window.SeanimeAndroid?.getAppVersion()
}
