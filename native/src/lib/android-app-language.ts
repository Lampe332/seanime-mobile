import { type AppLanguage, languageForLocale } from "@/lib/app-language"

/**
 * The app's language and Android's own setting for it ("App languages", Android 13 and later) kept in step. Android keeps
 * its setting apart from the app's store, so the app remembers the tags both last agreed on (`synced`): when Android's
 * differ from them, the user picked a language in Android's settings and the app takes it; otherwise the app's choice
 * goes to Android.
 */
export type AndroidLanguageState = {
    /** Android's setting as language tags, "" while the app follows the phone */
    android: string
    /** The language picked in the app (stored), undefined while it follows the phone */
    stored: AppLanguage | undefined
    /** The tags both agreed on last, undefined before the first sync (an update from 4.2.0, a new install) */
    synced: string | undefined
}

export type AndroidLanguageStep =
    /** Take Android's language into the app, undefined: follow the phone again */
    | { kind: "adopt", language: AppLanguage | undefined }
    /** Give the app's choice to Android, "": follow the phone */
    | { kind: "push", tags: string }
    | { kind: "none" }

export function androidLanguageStep({ android, stored, synced }: AndroidLanguageState): AndroidLanguageStep {
    // before the first sync only a language set in Android while the app has none of its own counts as Android's choice:
    // a choice the app had before 4.3.0 must not be lost to Android's empty setting
    const changedInAndroid = synced === undefined ? stored === undefined && android !== "" : android !== synced
    if (changedInAndroid) return { kind: "adopt", language: android === "" ? undefined : languageForLocale(android) }
    const same = stored === undefined ? android === "" : android !== "" && languageForLocale(android) === stored
    return same ? { kind: "none" } : { kind: "push", tags: stored ?? "" }
}
