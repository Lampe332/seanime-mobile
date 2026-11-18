import { PLURAL_CATEGORIES, pluralCategory, type PluralCategory } from "@/lib/i18n/plural"

/**
 * A language catalog (src/lib/i18n/<lang>.json, kept in step by scripts/i18n-extract.mjs): key = the English text of a
 * `t(en, de)` pair, value = its translation, "" = not translated yet (the English text shows).
 *
 * Placeholder rule: in a key, each `${…}` of the English template is {0}, {1}, … in order ("Episode ${n}" -> "Episode {0}");
 * the value uses the same {n}, in any order. tr() only sees the finished text ("Episode 5"), so a text that is no key
 * itself is matched against the template keys, anchored at both ends, the one with the most fixed text first; a key
 * without fixed text, or with two placeholders side by side, never matches (it could split a value at any point).
 *
 * Plural rule: a value may be an object with one text per plural form of the language (lib/i18n/plural.ts), e.g. Russian
 * `{ "one": "{0} серия", "few": "{0} серии", "many": "{0} серий" }`. The form follows the number in the key's first
 * placeholder that holds one, or in the placeholder named by `"count": "{1}"`.
 */
export type PluralValue = Partial<Record<PluralCategory, string>> & { count?: string }
export type CatalogValue = string | PluralValue
export type CatalogJSON = Record<string, CatalogValue>

type Template = { pattern: RegExp, order: number[], value: CatalogValue, fixed: number }

export type Catalog = {
    language: string
    exact: Map<string, CatalogValue>
    templates: Template[]
    cache: Map<string, string>
}

const PLACEHOLDER = /\{(\d+)\}/g
const CACHE_LIMIT = 2000

/** The {n} placeholders of a text, sorted and without repeats. */
export function placeholdersOf(text: string): string[] {
    return [...new Set(text.match(PLACEHOLDER) ?? [])].sort()
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** A value counts as translated when it is a non-empty text or a plural object with all its forms. */
export function isTranslated(value: CatalogValue | undefined, language: string): boolean {
    if (!value) return false
    if (typeof value === "string") return true
    return (PLURAL_CATEGORIES[language] ?? ["other"]).every(category => !!value[category])
}

/** The texts of a value: the text itself, or every form of a plural object. */
export function formsOf(value: CatalogValue): string[] {
    return typeof value === "string" ? [value] : Object.entries(value).filter(([name]) => name !== "count").map(([, text]) => text as string)
}

/** The form of a plural value for the numbers in `values` (placeholder index -> text). */
function pick(value: CatalogValue, language: string, values: Map<string, string>): string {
    if (typeof value === "string") return value
    const named = value.count?.match(/^\{(\d+)\}$/)?.[1]
    const counts = (named ? [values.get(named)] : [...values.keys()].sort().map(index => values.get(index)))
        .map(text => text?.replace(/[\s.,  ]/g, ""))
        .filter((text): text is string => !!text && /^\d+$/.test(text))
    const forms = PLURAL_CATEGORIES[language] ?? ["other"]
    const category = counts.length ? pluralCategory(language, Number(counts[0])) : forms[forms.length - 1]
    return value[category] ?? value.other ?? value[forms[forms.length - 1]] ?? ""
}

function template(key: string, value: CatalogValue): Template | undefined {
    const parts = key.split(/\{(\d+)\}/) // fixed, index, fixed, index, …, fixed
    const order: number[] = []
    let source = "^"
    let fixed = 0
    for (let i = 0; i < parts.length; i++) {
        if (i % 2 === 0) {
            if (i > 0 && i < parts.length - 1 && parts[i] === "") return undefined // {0}{1}: no border between the values
            source += escape(parts[i])
            fixed += parts[i].length
        } else {
            order.push(Number(parts[i]))
            source += "([\\s\\S]*?)"
        }
    }
    if (fixed === 0) return undefined
    return { pattern: new RegExp(source + "$"), order, value, fixed }
}

export function compileCatalog(json: CatalogJSON, language = ""): Catalog {
    const exact = new Map<string, CatalogValue>()
    const templates: Template[] = []
    for (const [key, value] of Object.entries(json)) {
        if (!isTranslated(value, language)) continue
        if (!/\{\d+\}/.test(key)) {
            exact.set(key, value)
            continue
        }
        const compiled = template(key, value)
        if (compiled) templates.push(compiled)
    }
    templates.sort((a, b) => b.fixed - a.fixed)
    return { language, exact, templates, cache: new Map() }
}

/** The translation of a finished English text, or the English text when the catalog has none. */
export function translateText(catalog: Catalog, en: string): string {
    const exact = catalog.exact.get(en)
    if (exact !== undefined) return pick(exact, catalog.language, new Map())
    const cached = catalog.cache.get(en)
    if (cached !== undefined) return cached
    let result = en
    for (const { pattern, order, value } of catalog.templates) {
        const match = pattern.exec(en)
        if (!match) continue
        const values = new Map(order.map((index, i) => [String(index), match[i + 1]]))
        result = pick(value, catalog.language, values).replace(PLACEHOLDER, (whole, index: string) => values.get(index) ?? whole)
        break
    }
    if (catalog.cache.size >= CACHE_LIMIT) catalog.cache.clear()
    catalog.cache.set(en, result)
    return result
}
