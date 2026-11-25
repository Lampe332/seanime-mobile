import { buildSearchDocs, normalizeSearch, searchSettings, type SettingsSearchEntry, type SettingsSearchSection } from "@/main/settings/_lib/settings-search"
import { SETTINGS_SEARCH_INDEX } from "@/main/settings/_lib/settings-search-index"
import { describe, expect, it } from "vitest"

const SECTIONS: SettingsSearchSection[] = [
    { id: "ui", title: ["Appearance", "Darstellung"], summary: ["Theme and lists", "Design und Listen"] },
    { id: "playback", title: ["Playback", "Wiedergabe"], summary: ["Player and subtitles", "Player und Untertitel"] },
]

const ENTRIES: SettingsSearchEntry[] = [
    { section: "ui", group: ["Sorting", "Sortierung"], note: ["How lists are ordered", "Wie Listen geordnet sind"] },
    { section: "ui", group: ["Sorting", "Sortierung"], label: ["Sort by progress", "Nach Fortschritt sortieren"], note: ["Started shows first", "Begonnene Serien zuerst"] },
    { section: "ui", group: ["Sorting", "Sortierung"], label: ["Café mode", "Café-Modus"], note: ["Dims the player list", "Dunkelt die Player-Liste ab"] },
    { section: "playback", group: ["Player", "Player"], label: ["Skip intro", "Intro überspringen"], note: ["Jumps over the opening", "Springt über das Opening"], alt: [["Skip intro (off)", "Intro überspringen (aus)"]] },
    { section: "playback", group: ["Player", "Player"], label: ["Large buttons", "Große Tasten"] },
    { section: "playback", label: ["Next episode", "Nächste Folge"], note: ["Starts the next episode by itself", "Startet die nächste Folge von selbst"] },
]

const de = buildSearchDocs(ENTRIES, SECTIONS, (_en, german) => german)
const en = buildSearchDocs(ENTRIES, SECTIONS, english => english)
const titles = (query: string, docs = de, limit?: number) => searchSettings(docs, query, limit).map(doc => doc.title)

describe("normalizeSearch", () => {
    it("ignores case, accents and punctuation", () => {
        expect(normalizeSearch("  Café-Modus  ")).toBe("cafe modus")
        expect(normalizeSearch("ÜBERSPRINGEN")).toBe("uberspringen")
        expect(normalizeSearch("Große Tasten!")).toBe("grosse tasten")
        expect(normalizeSearch("Appearance › Sorting")).toBe("appearance sorting")
        expect(normalizeSearch(" .,- ")).toBe("")
    })
})

describe("buildSearchDocs", () => {
    it("makes one document per area, group and row in the language shown", () => {
        expect(de.map(doc => doc.kind)).toEqual(["section", "section", "group", "row", "row", "row", "row", "row"])
        const row = de.find(doc => doc.title === "Nach Fortschritt sortieren")
        expect(row).toMatchObject({ section: "ui", path: "Darstellung › Sortierung", note: "Begonnene Serien zuerst", group: "Sortierung" })
        expect(en.find(doc => doc.title === "Sort by progress")?.path).toBe("Appearance › Sorting")
    })

    it("hands the page every name a row can show and leaves the group out where there is none", () => {
        expect(de.find(doc => doc.title === "Intro überspringen")?.labels).toEqual(["Intro überspringen", "Intro überspringen (aus)"])
        const loose = de.find(doc => doc.title === "Nächste Folge")
        expect(loose?.path).toBe("Wiedergabe")
        expect(loose?.group).toBeUndefined()
    })
})

describe("searchSettings", () => {
    it("finds nothing for an empty query", () => {
        expect(titles("")).toEqual([])
        expect(titles("   ")).toEqual([])
        expect(titles("?!")).toEqual([])
    })

    it("finds whatever the case or accents", () => {
        expect(titles("UBERSPRINGEN")).toEqual(["Intro überspringen"])
        expect(titles("cafe")).toEqual(["Café-Modus"])
        expect(titles("grosse")).toEqual(["Große Tasten"])
        expect(titles("große")).toEqual(["Große Tasten"])
    })

    it("finds by the English text in another language", () => {
        expect(titles("skip")).toEqual(["Intro überspringen"])
        expect(titles("appearance")[0]).toBe("Darstellung")
        expect(titles("opening")).toEqual(["Intro überspringen"])
    })

    it("finds a row by its other name", () => {
        expect(titles("aus")).toContain("Intro überspringen")
    })

    it("ranks the name before the note, the group and the area", () => {
        // "player": the group "Player" is absent as a document here, so: note of Café mode, then rows of the group
        expect(titles("player")).toEqual(["Wiedergabe", "Café-Modus", "Intro überspringen", "Große Tasten"])
        // name (start of a word) before note
        expect(titles("folge")).toEqual(["Nächste Folge"])
        expect(titles("list", en)).toEqual(["Appearance", "Sorting", "Café mode"])
    })

    it("ranks a whole name before its start, a word's start and the inside of a word", () => {
        const docs = buildSearchDocs([
            { section: "ui", label: ["Resort", "Resort"] },
            { section: "ui", label: ["Auto sort", "Auto sort"] },
            { section: "ui", label: ["Sorting", "Sorting"] },
            { section: "ui", label: ["Sort", "Sort"] },
        ], [], english => english)
        expect(docs).toEqual([])
        const withArea = buildSearchDocs([
            { section: "ui", label: ["Resort", "Resort"] },
            { section: "ui", label: ["Auto sort", "Auto sort"] },
            { section: "ui", label: ["Sorting", "Sorting"] },
            { section: "ui", label: ["Sort", "Sort"] },
        ], SECTIONS, english => english)
        expect(titles("sort", withArea)).toEqual(["Sort", "Sorting", "Auto sort", "Resort"])
    })

    it("puts areas before groups before rows on the same score, then keeps the settings' order", () => {
        expect(titles("sort")).toEqual(["Sortierung", "Nach Fortschritt sortieren", "Café-Modus"])
        expect(titles("darstellung")).toEqual(["Darstellung", "Sortierung", "Nach Fortschritt sortieren", "Café-Modus"])
    })

    it("needs every word and takes the whole query as one name", () => {
        expect(titles("intro wiedergabe")).toEqual(["Intro überspringen"])
        expect(titles("intro darstellung")).toEqual([])
        expect(titles("nachste folge")).toEqual(["Nächste Folge"])
    })

    it("stops at the limit", () => {
        expect(titles("e", de, 2)).toHaveLength(2)
    })

    it("finds real settings in the stored index", () => {
        const sections = [...new Set(SETTINGS_SEARCH_INDEX.map(entry => entry.section))]
            .map(id => ({ id, title: [id, id] as const, summary: ["", ""] as const }))
        const docs = buildSearchDocs(SETTINGS_SEARCH_INDEX, sections, (_en, german) => german)
        const row = SETTINGS_SEARCH_INDEX.find(entry => entry.label && entry.group)!
        const hit = searchSettings(docs, row.label![1].toUpperCase())[0]
        expect(hit.title).toBe(row.label![1])
        expect(searchSettings(docs, row.label![0]).some(doc => doc.labels?.includes(row.label![1]))).toBe(true)
    })
})
