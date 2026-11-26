import type { SettingsSectionId } from "@/main/settings/_lib/settings-phone"

/*
 * Search over all settings: the index (settings-search-index.ts, generated from the pages' source and held current by
 * settings-search-index.test.ts) becomes one document per area, group and row in the app language; a query finds them by
 * row name, note, group title and area name, whatever the case or accents, and by the English text in every language.
 */

/** A text as the pages write it: t("English", "Deutsch") */
export type Pair = readonly [en: string, de: string]

/**
 * The states a page shows a row under (`{condition && <Row />}`), named "Component:condition" as the source writes them.
 * The index notes them on the rows; a hit is offered only while each holds. A condition missing here is not checked.
 */
export const SEARCH_CONDITIONS = [
    "SettingsUISection:!tablet",
    "BannerGroup:!!shown",
    "SettingsAppSection:hideSpoilers",
    "SettingsAppSection:adult",
    "SettingsAppSection:!cacheDisabled",
    "StreamingGroup:enabled",
    "StreamingGroup:autoSelect",
    "DebridGroup:enabled",
    "DebridGroup:autoSelect",
] as const
export type SearchCondition = typeof SEARCH_CONDITIONS[number]
export type SearchConditions = Readonly<Record<SearchCondition, boolean>>

/** One group (no `label`) or one row of an area, as the source names it */
export type SettingsSearchEntry = {
    section: SettingsSectionId
    group?: Pair
    label?: Pair
    note?: Pair
    /** the row's other names (a label that depends on a state) */
    alt?: readonly Pair[]
    /** shown only while these hold */
    when?: readonly SearchCondition[]
}

export type SettingsSearchSection = { id: SettingsSectionId, title: Pair, summary: Pair }

export type SettingsSearchDoc = {
    id: string
    kind: "section" | "group" | "row"
    section: SettingsSectionId
    title: string
    /** "Appearance › Sorting"; an area has none */
    path: string
    note: string
    /** the group's title and the row's names as the page shows them: what the page jumps to */
    group?: string
    labels?: string[]
    when?: readonly SearchCondition[]
    /** normalised, the English text included */
    fields: { title: string, note: string, group: string, section: string }
}

type TranslatePair = (en: string, de: string) => string

const MARKS = /[̀-ͯ]/g
const SEPARATORS = /[\s\-_.,;:!?()[\]{}'"`´’‘“”„›‹»«&/\\+*#@%|<>=~^•·…]+/g

/** Lower case, no accents (é → e, ü → u, ß → ss), punctuation as one space */
export function normalizeSearch(text: string): string {
    return text.toLowerCase().normalize("NFD").replace(MARKS, "").replace(/ß/g, "ss").replace(SEPARATORS, " ").trim()
}

export const SEARCH_PATH_SEPARATOR = " › "

export function buildSearchDocs(entries: readonly SettingsSearchEntry[], sections: readonly SettingsSearchSection[], t: TranslatePair): SettingsSearchDoc[] {
    const shown = (pair: Pair | undefined) => pair ? t(pair[0], pair[1]) : ""
    // What the user reads plus the English original, so an English word also finds the row in another language
    const field = (...pairs: (Pair | undefined)[]) => {
        const parts: string[] = []
        for (const pair of pairs) {
            if (!pair) continue
            for (const text of [shown(pair), pair[0]]) {
                const normal = normalizeSearch(text)
                if (normal && !parts.includes(normal)) parts.push(normal)
            }
        }
        return parts.join(" ")
    }
    const byId = new Map(sections.map(section => [section.id, section]))
    const docs: SettingsSearchDoc[] = sections.map(section => ({
        id: section.id,
        kind: "section",
        section: section.id,
        title: shown(section.title),
        path: "",
        note: shown(section.summary),
        fields: { title: field(section.title), note: field(section.summary), group: "", section: "" },
    }))
    for (const entry of entries) {
        const section = byId.get(entry.section)
        if (!section) continue
        const sectionTitle = shown(section.title)
        const group = entry.group ? shown(entry.group) : undefined
        if (!entry.label) {
            if (!entry.group || !group) continue
            docs.push({
                id: searchEntryId(entry),
                kind: "group",
                section: entry.section,
                title: group,
                path: sectionTitle,
                note: shown(entry.note),
                group,
                ...(entry.when ? { when: entry.when } : null),
                fields: { title: field(entry.group), note: field(entry.note), group: "", section: field(section.title) },
            })
            continue
        }
        const names = [entry.label, ...(entry.alt ?? [])]
        docs.push({
            id: searchEntryId(entry),
            kind: "row",
            section: entry.section,
            title: shown(entry.label),
            path: group ? sectionTitle + SEARCH_PATH_SEPARATOR + group : sectionTitle,
            note: shown(entry.note),
            group,
            labels: names.map(shown),
            ...(entry.when ? { when: entry.when } : null),
            fields: { title: field(...names), note: field(entry.note), group: field(entry.group), section: field(section.title) },
        })
    }
    return docs
}

/** Stable across languages: area, the group's and the row's English name */
export function searchEntryId(entry: SettingsSearchEntry): string {
    return [entry.section, entry.group?.[0] ?? "", entry.label?.[0] ?? ""].join("/")
}

const NO_MATCH = 99
const KIND_ORDER = { section: 0, group: 1, row: 2 } as const

/**
 * How well one word fits a document, lower is better: the name (0 whole, 1 its start, 2 the start of one of its words),
 * then the note (5), the group's title (7) and the area's name (8). A word only fits at the start of a word ("lock" finds
 * "App lock", never "Clock").
 */
function wordScore(fields: SettingsSearchDoc["fields"], word: string): number {
    const title = fields.title
    if (title === word) return 0
    if (title.startsWith(word)) return 1
    if (title.includes(" " + word)) return 2
    if (atWordStart(fields.note, word)) return 5
    if (atWordStart(fields.group, word)) return 7
    if (atWordStart(fields.section, word)) return 8
    return NO_MATCH
}

const atWordStart = (text: string, word: string) => text.startsWith(word) || text.includes(" " + word)

/** Whether the page shows the document's row right now */
const isShown = (doc: SettingsSearchDoc, conditions: SearchConditions | undefined) =>
    !conditions || !doc.when || doc.when.every(condition => conditions[condition])

export const SEARCH_RESULT_LIMIT = 30

/**
 * The documents that hold every word of the query, best first: by the weakest word's score, then areas before groups
 * before rows, then the order of the settings themselves. An empty query finds nothing (the list of areas shows instead).
 * With `conditions`, a row the page does not show right now is left out.
 */
export function searchSettings(docs: readonly SettingsSearchDoc[], query: string, limit = SEARCH_RESULT_LIMIT, conditions?: SearchConditions): SettingsSearchDoc[] {
    const normal = normalizeSearch(query)
    if (!normal) return []
    const words = normal.split(" ")
    const hits: { doc: SettingsSearchDoc, score: number, order: number }[] = []
    docs.forEach((doc, order) => {
        if (!isShown(doc, conditions)) return
        // the whole query as typed ranks as one word when it fits the name ("next episode")
        let score = words.length > 1 ? wordScore(doc.fields, normal) : NO_MATCH
        if (score > 2) {
            score = 0
            for (const word of words) {
                const one = wordScore(doc.fields, word)
                if (one === NO_MATCH) return
                if (one > score) score = one
            }
        }
        hits.push({ doc, score, order })
    })
    hits.sort((a, b) => a.score - b.score || KIND_ORDER[a.doc.kind] - KIND_ORDER[b.doc.kind] || a.order - b.order)
    return hits.slice(0, limit).map(hit => hit.doc)
}
