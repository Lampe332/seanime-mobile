/**
 * Plural forms of the catalog languages, for whole numbers (the app only counts whole things). Own rules instead of
 * Intl.PluralRules: Hermes on Android does not have it. The rules follow CLDR for integers; Spanish, French and
 * Portuguese also have a "many" form for round millions ("1 millón de"), which never comes up in the app and falls
 * back to "other". English and German stay inline (`n === 1 ? … : …`), so they are not here.
 */
export type PluralCategory = "one" | "few" | "many" | "other"

/** The forms a plural catalog value needs in each language (scripts/i18n-extract.mjs checks the same list). */
export const PLURAL_CATEGORIES: Record<string, PluralCategory[]> = {
    "es": ["one", "other"],
    "ru": ["one", "few", "many"],
    "zh-Hans": ["other"],
    "pt-BR": ["one", "other"],
    "fr": ["one", "other"],
    "ja": ["other"],
}

export function pluralCategory(language: string, count: number): PluralCategory {
    const n = Math.abs(Math.trunc(count))
    switch (language) {
        case "ru": {
            const last = n % 10
            const lastTwo = n % 100
            if (last === 1 && lastTwo !== 11) return "one"
            if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return "few"
            return "many"
        }
        case "fr":
        case "pt-BR":
            return n <= 1 ? "one" : "other"
        case "zh-Hans":
        case "ja":
            return "other"
        default:
            return n === 1 ? "one" : "other"
    }
}
