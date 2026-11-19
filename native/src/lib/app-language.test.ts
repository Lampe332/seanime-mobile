import { createStore } from "jotai"
import { afterEach, describe, expect, it } from "vitest"
import { APP_LANGUAGES, type AppLanguage, appLanguageAtom, asAppLanguage, getAppLanguage, languageForLocale, plural, tr, translate } from "./app-language"
import es from "./i18n/es.json"
import { storage } from "./storage"

const KEY = "seanime-mobile-language"

afterEach(() => storage.remove(KEY))

describe("languageForLocale", () => {
    it("takes the device language when the app has it", () => {
        expect(languageForLocale("es-MX")).toBe("es")
        expect(languageForLocale("es_ES")).toBe("es")
        expect(languageForLocale("de-AT")).toBe("de")
        expect(languageForLocale("ru-RU")).toBe("ru")
        expect(languageForLocale("fr-CA")).toBe("fr")
        expect(languageForLocale("ja-JP")).toBe("ja")
        expect(languageForLocale("pt-BR")).toBe("pt-BR")
        expect(languageForLocale("pt-PT")).toBe("pt-BR")
    })

    it("takes simplified Chinese only for the simplified script", () => {
        expect(languageForLocale("zh-Hans-CN")).toBe("zh-Hans")
        expect(languageForLocale("zh-CN")).toBe("zh-Hans")
        expect(languageForLocale("zh-SG")).toBe("zh-Hans")
        expect(languageForLocale("zh-Hant-TW")).toBe("en")
        expect(languageForLocale("zh-TW")).toBe("en")
    })

    it("falls back to English", () => {
        expect(languageForLocale("it-IT")).toBe("en")
        expect(languageForLocale("")).toBe("en")
        expect(languageForLocale(undefined)).toBe("en")
    })
})

describe("translate", () => {
    it("keeps English and German inline", () => {
        for (const language of ["en", "de"] as const) {
            expect(translate(language, "Cancel", "Abbrechen")).toBe(language === "en" ? "Cancel" : "Abbrechen")
        }
    })

    it("reads the catalog for the other languages and falls back to English", () => {
        expect(translate("es", "Cancel", "Abbrechen")).toBe(es["Cancel" as keyof typeof es] || "Cancel")
        expect(translate("es", "A text no catalog has yet", "Ein Text, den noch kein Katalog hat")).toBe("A text no catalog has yet")
    })

    it("keeps a genre apart from the same word as a button action, and never shows the context", () => {
        expect(translate("zh-Hans", "[genre] Action", "Action")).toBe("动作")
        expect(translate("zh-Hans", "Action", "Aktion")).toBe("操作")
        expect(translate("ja", "[genre] Action", "Action")).toBe("アクション")
        expect(translate("en", "[genre] Action", "Action")).toBe("Action")
        expect(translate("es", "[genre] Not in any catalog", "x")).toBe("Not in any catalog")
    })

    it("names every language in itself", () => {
        expect(APP_LANGUAGES.map(language => language.label)).toEqual(
            ["English", "Deutsch", "Español", "Русский", "简体中文", "Português (Brasil)", "Français", "日本語"])
        expect(asAppLanguage("zh-Hans")).toBe("zh-Hans")
        expect(asAppLanguage("klingon")).toBeUndefined()
    })
})

describe("stored language", () => {
    it("keeps the chosen language and tr() follows it", () => {
        const store = createStore()
        store.set(appLanguageAtom, "es")
        expect(storage.getString(KEY)).toBe(JSON.stringify("es"))
        expect(getAppLanguage()).toBe("es")
        expect(tr("Cancel", "Abbrechen")).toBe(es["Cancel" as keyof typeof es] || "Cancel")
        store.set(appLanguageAtom, "de")
        expect(getAppLanguage()).toBe("de")
        expect(tr("Cancel", "Abbrechen")).toBe("Abbrechen")
    })

    it("ignores a stored value that is no app language", () => {
        storage.set(KEY, JSON.stringify("xx"))
        expect(asAppLanguage(getAppLanguage())).toBeDefined()
        expect(getAppLanguage()).not.toBe("xx")
    })
})

describe("plural", () => {
    // C2 of the device test: a playlist with one episode showed "1 episodes"
    const episodes = (language: AppLanguage, n: number) => plural((en, de) => translate(language, en, de), n, ["1 episode", "{0} episodes"], ["1 Episode", "{0} Episoden"])

    it("counts episodes in the form of each language", () => {
        expect([1, 2].map(n => episodes("en", n))).toEqual(["1 episode", "2 episodes"])
        expect([1, 2].map(n => episodes("de", n))).toEqual(["1 Episode", "2 Episoden"])
        expect([1, 3, 5, 21].map(n => episodes("ru", n))).toEqual(["1 серия", "3 серии", "5 серий", "21 серия"])
        expect([1, 2].map(n => episodes("fr", n))).toEqual(["1 épisode", "2 épisodes"])
    })
})
