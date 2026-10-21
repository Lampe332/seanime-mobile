import { useAtomValue } from "jotai"
import { atomWithStorage } from "jotai/utils"

/** Language of the texts added by Seanime Mobile (downloads, calendar, offline player). English is the default. */
export type AppLanguage = "en" | "de"

const STORAGE_KEY = "seanime-mobile-language"

declare global {
    interface Window {
        SeanimeAndroid?: { getAppVersion(): string, setLanguage?(language: string): void, readClipboard?(): string, pickFolder?(requestId: string): void }
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
