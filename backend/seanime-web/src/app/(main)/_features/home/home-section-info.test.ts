import { describe, expect, it } from "vitest"
import { HOME_ITEM_IDS } from "./home-items.utils"
import { HOME_SECTION_INFO } from "./home-section-info"

describe("Customize Home section info", () => {
    it.each(HOME_ITEM_IDS)("explains %s in English and German", type => {
        const entry = HOME_SECTION_INFO[type]
        expect(entry).toBeDefined()
        for (const text of [...entry.name, ...entry.info]) expect(text.trim().length).toBeGreaterThan(0)
        expect(entry.info[0]).not.toBe(entry.info[1])
    })
    it("keeps each explanation to one or two sentences", () => {
        for (const { info } of Object.values(HOME_SECTION_INFO)) {
            for (const text of info) expect(text.replaceAll("z. B.", "zB").split(/(?<=\.)\s+/).length).toBeLessThanOrEqual(2)
        }
    })
})
