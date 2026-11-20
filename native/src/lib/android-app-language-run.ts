/*
 * The app language in step with Android's "App languages" setting (android-app-language.ts). index.ts imports this
 * early, so a language picked in Android's settings is the app's before the first screen; useAndroidAppLanguage keeps it
 * in step afterwards: a pick in the app goes to Android, a pick in Android's settings while the app was in the background
 * comes in when it is in front again.
 */
import React from "react"
import { AppState, Platform } from "react-native"
import DeviceFacts from "../../modules/core-download"
import { androidLanguageStep } from "./android-app-language"
import { APP_LANGUAGE_KEY, type AppLanguage, asAppLanguage } from "./app-language"
import { readStoredJSON, storage, writeStoredValues } from "./storage"

/** The tags the app and Android agreed on last; a key of this device (app-backup-keys.ts) */
export const ANDROID_LANGUAGE_SYNCED_KEY = "seanime-mobile-language-android"

export function syncAndroidAppLanguage(): void {
    if (Platform.OS !== "android") return
    let android: string | null
    try {
        android = DeviceFacts.appLocales()
    }
    catch {
        return
    }
    // below Android 13 there is no such setting
    if (android === null) return
    // Android's settings set one language; of a longer list ("de,en") the first is the app's
    android = android.split(",")[0] ?? ""
    const step = androidLanguageStep({
        android,
        stored: asAppLanguage(readStoredJSON<unknown>(APP_LANGUAGE_KEY, undefined)),
        synced: storage.getString(ANDROID_LANGUAGE_SYNCED_KEY),
    })
    if (step.kind === "push") {
        try {
            if (!DeviceFacts.setAppLocales(step.tags)) return
        }
        catch {
            return
        }
        storage.set(ANDROID_LANGUAGE_SYNCED_KEY, step.tags)
        return
    }
    if (step.kind === "adopt") {
        if (step.language) writeStoredValues({ [APP_LANGUAGE_KEY]: JSON.stringify(step.language) }, [])
        else writeStoredValues({}, [APP_LANGUAGE_KEY])
    }
    storage.set(ANDROID_LANGUAGE_SYNCED_KEY, android)
}

/** Mounted once (AppServices): syncs after each change of the app language and when the app comes to the front */
export function useAndroidAppLanguage(language: AppLanguage) {
    React.useEffect(() => {
        syncAndroidAppLanguage()
    }, [language])

    React.useEffect(() => {
        if (Platform.OS !== "android") return
        const subscription = AppState.addEventListener("change", state => {
            if (state === "active") syncAndroidAppLanguage()
        })
        return () => subscription.remove()
    }, [])
}

syncAndroidAppLanguage()
