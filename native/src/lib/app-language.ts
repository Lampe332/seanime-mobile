import { compileCatalog, type Catalog, type CatalogJSON, translateText } from "@/lib/i18n/catalog"
import { atomWithStorage, readStoredJSON } from "@/lib/storage"
import { useAtomValue } from "jotai"

/**
 * Languages of the app's texts, each named in itself for the picker. English and German are the inline pairs of
 * `t(en, de)`; the others come from the catalogs in lib/i18n (scripts/i18n-extract.mjs), English where a text has none.
 */
export const APP_LANGUAGES = [
    { value: "en", label: "English" },
    { value: "de", label: "Deutsch" },
    { value: "es", label: "Español" },
    { value: "ru", label: "Русский" },
    { value: "zh-Hans", label: "简体中文" },
    { value: "pt-BR", label: "Português (Brasil)" },
    { value: "fr", label: "Français" },
    { value: "ja", label: "日本語" },
] as const

export type AppLanguage = typeof APP_LANGUAGES[number]["value"]

const STORAGE_KEY = "seanime-mobile-language"
/** The stored choice's key, for the sync with Android's "App languages" setting (android-app-language-run.ts) */
export const APP_LANGUAGE_KEY = STORAGE_KEY

/**
 * The catalogs (together ~1.3 MB), each read the first time its language shows a text: Metro bundles all of them, but a
 * `require` inside a function runs its module only when called, so only the chosen one is built in memory. A language
 * picked later loads its catalog then.
 */
export const CATALOG_LOADERS: Partial<Record<AppLanguage, () => CatalogJSON>> = {
    es: () => require("./i18n/es.json"),
    ru: () => require("./i18n/ru.json"),
    "zh-Hans": () => require("./i18n/zh-Hans.json"),
    "pt-BR": () => require("./i18n/pt-BR.json"),
    fr: () => require("./i18n/fr.json"),
    ja: () => require("./i18n/ja.json"),
}
const compiled = new Map<AppLanguage, Catalog>()

export function asAppLanguage(value: unknown): AppLanguage | undefined {
    return APP_LANGUAGES.find(language => language.value === value)?.value
}

/**
 * The app language for a device locale ("es-MX", "zh-Hans-CN", "pt_PT"): its language when the app has it, else English.
 * Chinese only in simplified script (zh-Hans, or a mainland/Singapore region without a script); Portuguese of any region
 * reads the Brazilian catalog.
 */
export function languageForLocale(locale: string | undefined): AppLanguage {
    const parts = (locale ?? "").replace(/_/g, "-").split("-")
    const language = parts[0]?.toLowerCase()
    if (language === "zh") {
        const rest = parts.slice(1).map(part => part.toLowerCase())
        if (rest.includes("hans")) return "zh-Hans"
        if (rest.includes("hant")) return "en"
        return rest.some(part => part === "cn" || part === "sg") ? "zh-Hans" : "en"
    }
    if (language === "pt") return "pt-BR"
    return asAppLanguage(language) ?? "en"
}

function deviceLocale(): string | undefined {
    try {
        return Intl.DateTimeFormat().resolvedOptions().locale
    }
    catch {
        return undefined
    }
}

/** Without a stored choice the app follows the device language (when it has it); a stored choice always wins. */
const DEVICE_LANGUAGE = languageForLocale(deviceLocale())

export const appLanguageAtom = atomWithStorage<AppLanguage>(STORAGE_KEY, DEVICE_LANGUAGE)

/** Current language outside of React (toasts, helpers). */
export function getAppLanguage(): AppLanguage {
    return asAppLanguage(readStoredJSON<unknown>(STORAGE_KEY, undefined)) ?? DEVICE_LANGUAGE
}

export type Translate = (en: string, de: string) => string

/**
 * A context in front of an English text, `"[genre] Action"` or `"[tab] Downloads"`: the catalogs get a key of its own for a
 * word that means something else elsewhere (the genre Action is no button action), English shows the text without it.
 */
const CONTEXT = /^\[[a-z]+\] /

export function withoutContext(en: string): string {
    return en.startsWith("[") ? en.replace(CONTEXT, "") : en
}

/** The text of a `t(en, de)` pair in a language: German and English inline, the others from their catalog. */
export function translate(language: AppLanguage, en: string, de: string): string {
    if (language === "de") return de
    if (language === "en") return withoutContext(en)
    let catalog = compiled.get(language)
    if (!catalog) {
        const load = CATALOG_LOADERS[language]
        if (!load) return withoutContext(en)
        catalog = compileCatalog(load(), language)
        compiled.set(language, catalog)
    }
    return withoutContext(translateText(catalog, en))
}

/**
 * A counted text in the app language: en and de are [one, other] whole texts with {0} for the number
 * (["1 file", "{0} files"]). t() gets the finished English text ("5 files"), so a catalog picks its own plural form
 * for the number (lib/i18n/plural.ts), e.g. Russian 1 / 2-4 / 5+. `shown` is the number as written ("1,234", "2.5").
 */
export function plural(t: Translate, n: number, en: [string, string], de: [string, string], shown = String(n)) {
    const [enText, deText] = shown === "1" ? [en[0], de[0]] : [en[1], de[1]]
    return t(enText.replace("{0}", shown), deText.replace("{0}", shown))
}

/** Picks the text for the current language outside of React. */
export const tr: Translate = (en, de) => translate(getAppLanguage(), en, de)

/** Re-renders when the language changes in the settings. */
export function useTr(): Translate {
    const language = asAppLanguage(useAtomValue(appLanguageAtom)) ?? "en"
    return (en, de) => translate(language, en, de)
}

// Notifications get their texts from here too: the download notices (LoaderWays.kt) show the title and text the JavaScript
// hands them, so they follow the app language without a language list of their own on the Kotlin side.
