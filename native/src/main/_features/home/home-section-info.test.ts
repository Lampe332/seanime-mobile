import type { Translate } from "@/lib/app-language"
import { describe, expect, it } from "vitest"
import { HOME_ITEM_IDS, HOME_ITEMS } from "./home-items.utils"
import { HOME_OPTION_LABELS, HOME_SECTION_INFO, homeOptionLabel } from "./home-section-info"

const german: Translate = (_en, de) => de

describe("Customize Home section info", () => {
    it.each(HOME_ITEM_IDS)("explains %s in English and German", type => {
        const entry = HOME_SECTION_INFO[type]
        expect(entry).toBeDefined()
        for (const text of [...entry.name, ...entry.summary, ...entry.info, ...(entry.needs ?? [])]) expect(text.trim().length).toBeGreaterThan(0)
        expect(entry.info[0]).not.toBe(entry.info[1])
        expect(entry.summary[0]).not.toBe(entry.summary[1])
    })
    it("keeps each explanation to one or two sentences and each summary to one short line", () => {
        for (const { info, summary } of Object.values(HOME_SECTION_INFO)) {
            for (const text of info) expect(text.replaceAll("z. B.", "zB").split(/(?<=\.)\s+/).length).toBeLessThanOrEqual(2)
            for (const text of summary) {
                expect(text.length, text).toBeLessThanOrEqual(70)
                expect(text, text).not.toMatch(/\.$/)
            }
        }
    })
})

describe("option labels", () => {
    // the genres are named by Discover's genreLabel
    const labels = Object.values(HOME_ITEMS).flatMap(schema => (schema.options ?? []).flatMap(option => [
        option.label,
        ...(option.name === "genres" ? [] : (option.options ?? []).map((choice: { label: string }) => choice.label)),
    ]))
    it.each([...new Set(labels)])("translates %s", label => {
        expect(HOME_OPTION_LABELS[label], label).toBeDefined()
        expect(homeOptionLabel(german, label).trim().length).toBeGreaterThan(0)
    })
    it("keeps an unknown label as it is", () => {
        expect(homeOptionLabel(german, "Something new")).toBe("Something new")
        expect(homeOptionLabel(german, "Rereading")).toBe("Lese ich erneut")
    })
})
