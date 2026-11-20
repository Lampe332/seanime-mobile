import { describe, expect, it } from "vitest"
import appJson from "../../app.json"
import { androidLanguageStep } from "./android-app-language"
import { isDeviceKey } from "./app-backup-keys"
import { APP_LANGUAGES } from "./app-language"

describe("androidLanguageStep", () => {
    it("takes a language picked in Android's settings", () => {
        expect(androidLanguageStep({ android: "ja", stored: "de", synced: "de" })).toEqual({ kind: "adopt", language: "ja" })
        expect(androidLanguageStep({ android: "zh-Hans", stored: undefined, synced: "" })).toEqual({ kind: "adopt", language: "zh-Hans" })
        expect(androidLanguageStep({ android: "pt-BR", stored: "en", synced: "en" })).toEqual({ kind: "adopt", language: "pt-BR" })
    })

    it("follows the phone again when Android's setting went back to the system language", () => {
        expect(androidLanguageStep({ android: "", stored: "fr", synced: "fr" })).toEqual({ kind: "adopt", language: undefined })
    })

    it("gives a language picked in the app to Android", () => {
        expect(androidLanguageStep({ android: "de", stored: "es", synced: "de" })).toEqual({ kind: "push", tags: "es" })
        expect(androidLanguageStep({ android: "", stored: "ru", synced: "" })).toEqual({ kind: "push", tags: "ru" })
    })

    it("keeps an app choice from before 4.3.0 instead of Android's empty setting", () => {
        expect(androidLanguageStep({ android: "", stored: "de", synced: undefined })).toEqual({ kind: "push", tags: "de" })
    })

    it("takes Android's language at the first sync when the app has none of its own", () => {
        expect(androidLanguageStep({ android: "es", stored: undefined, synced: undefined })).toEqual({ kind: "adopt", language: "es" })
    })

    it("does nothing while both agree, also for a region Android added", () => {
        expect(androidLanguageStep({ android: "de", stored: "de", synced: "de" })).toEqual({ kind: "none" })
        expect(androidLanguageStep({ android: "es-ES", stored: "es", synced: "es-ES" })).toEqual({ kind: "none" })
        expect(androidLanguageStep({ android: "", stored: undefined, synced: "" })).toEqual({ kind: "none" })
        expect(androidLanguageStep({ android: "", stored: undefined, synced: undefined })).toEqual({ kind: "none" })
        expect(androidLanguageStep({ android: "ja", stored: "ja", synced: undefined })).toEqual({ kind: "none" })
    })

    it("pushes the app's tags for every language, which Android's list knows", () => {
        for (const { value } of APP_LANGUAGES) {
            const other = value === "en" ? "de" : "en"
            expect(androidLanguageStep({ android: other, stored: value, synced: other })).toEqual({ kind: "push", tags: value })
            expect(androidLanguageStep({ android: value, stored: other, synced: other })).toEqual({ kind: "adopt", language: value })
        }
    })
})

describe("synced tags", () => {
    it("stay on this device: Android's setting belongs to the phone, not to a backup or the account", () => {
        expect(isDeviceKey("seanime-mobile-language-android")).toBe(true)
    })
})

describe("locales_config", () => {
    it("lists the app's languages in Android's settings (plugins/with-app-languages.js)", () => {
        const plugin = appJson.expo.plugins.find(entry => Array.isArray(entry) && entry[0] === "./plugins/with-app-languages")
        expect(plugin).toBeDefined()
        expect((plugin as [string, { languages: string[] }])[1].languages).toEqual(APP_LANGUAGES.map(language => language.value))
    })
})
