import { atomWithStorage, readStoredJSON } from "@/lib/storage"
import { useAtomValue } from "jotai"

/** Language of the texts added by Seanime Mobile (downloads, calendar, offline player). English is the default. */
export type AppLanguage = "en" | "de"

const STORAGE_KEY = "seanime-mobile-language"

// The web version also declared the WebView bridges (SeanimeAndroid, SeanimeCast, SeanimeMedia) here. The native app has
// no bridges: each of those functions comes back as a TypeScript module with its library (docs/NATIVE-UMBAU.md 5, E3/E4).

export const appLanguageAtom = atomWithStorage<AppLanguage>(STORAGE_KEY, "en")

/** Current language outside of React (toasts, helpers). */
export function getAppLanguage(): AppLanguage {
    return readStoredJSON<string>(STORAGE_KEY, "en") === "de" ? "de" : "en"
}

export type Translate = (en: string, de: string) => string

/** Picks the text for the current language outside of React. */
export const tr: Translate = (en, de) => getAppLanguage() === "de" ? de : en

/** Re-renders when the language changes in the settings. */
export function useTr(): Translate {
    const language = useAtomValue(appLanguageAtom)
    return (en, de) => language === "de" ? de : en
}

// The server service's notification reads the language from the same SharedPreferences as before (AppLanguage.kt);
// the root layout pushes it through SeanimeServer.setLanguage whenever appLanguageAtom changes.
