import { useAtomValue } from "jotai"
import { atomWithStorage } from "jotai/utils"

/** Language of the texts added by Seanime Mobile (downloads, calendar, offline player). English is the default. */
export type AppLanguage = "en" | "de"

const STORAGE_KEY = "seanime-mobile-language"

declare global {
    interface Window {
        SeanimeAndroid?: {
            getAppVersion(): string
            setLanguage?(language: string): void
            readClipboard?(): string
            pickFolder?(requestId: string): void
            getAiringNotifications?(): boolean
            setAiringNotifications?(enabled: boolean): void
            /** "ok", or "permission" when Android does not allow notifications */
            testAiringNotification?(): string
            /** Opens a stream of the app's server in the app's own player (FFmpeg audio); "seanime-app-player-closed" follows */
            playInAppPlayer?(url: string, title: string, positionMs: number, audioLanguage: string, subtitleLanguage: string): void
            /** Episode downloads wait for Wi-Fi (no mobile data) */
            getDownloadsWifiOnly?(): boolean
            setDownloadsWifiOnly?(enabled: boolean): void
            /** True on mobile data or another metered network */
            isMeteredNetwork?(): boolean
            /** Touch feedback (lib/feedback.ts): "tick", "long", "confirm" or "reject" */
            haptic?(kind: string): void
            /** "success"; the app keeps it silent while the phone is muted or something plays */
            playSound?(name: string): void
            hasVibrator?(): boolean
            getHaptics?(): boolean
            setHaptics?(enabled: boolean): void
            getSounds?(): boolean
            setSounds?(enabled: boolean): void
        }
        /** Casting to a TV in the Wi-Fi; answers with "seanime-cast" window events */
        SeanimeCast?: {
            discover(): void
            start(id: string, url: string, title: string, positionMs: number, artworkUrl: string): void
            /** The same video with other tracks, from where the TV is */
            switchStream(url: string): void
            /** Another video (the next episode) on the TV in use */
            load?(url: string, title: string, positionMs: number, artworkUrl: string): void
            /** play, pause, seek (to ms), skip (by ms), volume (percent) */
            control(action: string, value: number): void
            status(): void
            stop(resume: boolean): void
            /** {device, kind} JSON of the TV in use, or "" */
            current(): string
        }
        /** The app's media notification and lock-screen controls for the player */
        SeanimeMedia?: {
            update(title: string, artist: string, artworkUrl: string, playing: boolean, positionMs: number, durationMs: number): void
            clear(): void
            /** Video size for the picture-in-picture shape */
            setVideoSize?(width: number, height: number): void
            setPlaybackRate?(rate: number): void
            /** Shows next/previous episode buttons; they answer with "nexttrack"/"previoustrack" actions */
            setQueue?(hasNext: boolean, hasPrevious: boolean): void
        }
    }
}

export const appLanguageAtom = atomWithStorage<AppLanguage>(STORAGE_KEY, "en", undefined, { getOnInit: true })

/** Current language outside of React (toasts, helpers). */
export function getAppLanguage(): AppLanguage {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || "\"en\"") === "de" ? "de" : "en"
    } catch {
        return "en"
    }
}

/** Tells the native Android side (notifications, offline player) which language to use. */
export function syncAppLanguageToAndroid(language: AppLanguage = getAppLanguage()) {
    try { window.SeanimeAndroid?.setLanguage?.(language) } catch { /* Older app builds have no bridge method. */ }
}

export type Translate = (en: string, de: string) => string

/** Picks the text for the current language outside of React. */
export const tr: Translate = (en, de) => getAppLanguage() === "de" ? de : en

/** Re-renders when the language changes in the settings. */
export function useTr(): Translate {
    const language = useAtomValue(appLanguageAtom)
    return (en, de) => language === "de" ? de : en
}

// Native screens read the language from SharedPreferences, so push it once per app start.
if (typeof window !== "undefined") syncAppLanguageToAndroid()
