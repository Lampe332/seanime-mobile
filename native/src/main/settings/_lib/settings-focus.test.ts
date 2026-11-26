import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { focusFromHit, isFocusedRow, revealsInSheet, ROW_GLOW, rowSettled, sheetFocusNonce } from "@/main/settings/_lib/settings-focus"
import { SETTINGS_SECTIONS } from "@/main/settings/_lib/settings-phone"
import { buildSearchDocs, searchSettings } from "@/main/settings/_lib/settings-search"
import { SETTINGS_SEARCH_INDEX } from "@/main/settings/_lib/settings-search-index"
import { describe, expect, it } from "vitest"

const sections = SETTINGS_SECTIONS.map(id => ({ id, title: [id, id] as const, summary: [id, id] as const }))
const docs = buildSearchDocs(SETTINGS_SEARCH_INDEX, sections, english => english)
const settingsDir = join(__dirname, "..")
const sources = ["_screens", "_components"].flatMap(dir =>
    readdirSync(join(settingsDir, dir)).filter(name => name.endsWith(".tsx")).map(name => readFileSync(join(settingsDir, dir, name), "utf8")))

describe("a search hit on a row inside a sheet", () => {
    const hit = searchSettings(docs, "Multiple subtitle tracks")[0]
    const focus = focusFromHit(hit, null)

    it("carries the sheet into the page's focus", () => {
        expect(hit.title).toBe("Multiple subtitle tracks")
        expect(focus).toMatchObject({ section: "torrents", group: "Auto-select", sheet: "Auto-select profile", nonce: 1 })
        expect(focusFromHit(hit, focus).nonce).toBe(2)
    })

    it("opens its sheet from the group's control, no other sheet", () => {
        expect(sheetFocusNonce(focus, "Auto-select profile", "Auto-select")).toBe(1)
        expect(sheetFocusNonce(focus, "Custom accent", "Auto-select")).toBeNull()
        expect(sheetFocusNonce(focus, "Auto-select profile", "Downloads")).toBeNull()
        expect(sheetFocusNonce(null, "Auto-select profile", "Auto-select")).toBeNull()
    })

    it("marks its row in the sheet (no group title there) and has the sheet scroll to it", () => {
        expect(isFocusedRow(focus, "Multiple subtitle tracks", undefined)).toBe(true)
        expect(isFocusedRow(focus, "Multiple audio tracks", undefined)).toBe(false)
        expect(revealsInSheet(focus, true)).toBe(true)
        expect(revealsInSheet(focus, false)).toBe(false)
        expect(revealsInSheet({ ...focus, sheet: undefined }, true)).toBe(false)
    })

    // The sheet's body renders in the @rn-primitives portal at the app root, outside the page's focus provider: without
    // the carry, its rows read no focus, the sheet stayed on its top and nothing glowed (phone and tablet, e02a5575)
    it("hands the page's focus into the portal of every sheet the index names", () => {
        const sheets = new Set(SETTINGS_SEARCH_INDEX.flatMap(entry => entry.sheet ? [entry.sheet[0]] : []))
        expect(sheets.size).toBeGreaterThan(0)
        for (const sheet of sheets) {
            const source = sources.find(text => text.includes(`<Sheet title={t("${sheet}"`))
            expect(source, sheet).toBeDefined()
            const body = source!.slice(source!.indexOf(`<Sheet title={t("${sheet}"`))
            const carry = body.indexOf("<SheetFocusCarry value={focus}>")
            expect(carry, sheet).toBeGreaterThan(-1)
            expect(carry, sheet).toBeLessThan(body.indexOf("</Sheet>"))
        }
    })

    it("names the sheet's row as the index does", () => {
        const source = sources.find(text => text.includes(`<Sheet title={t("Auto-select profile"`))!
        expect(source).toContain(`t("Multiple subtitle tracks", "Mehrere Untertitel-Spuren")`)
    })
})

describe("search hit glow", () => {
    it("waits until the row stands still in sight", () => {
        expect(rowSettled(undefined, 300, 56, 800)).toBe(false)
        expect(rowSettled(900, 300, 56, 800)).toBe(false)
        expect(rowSettled(300, 300, 56, 800)).toBe(true)
        expect(rowSettled(1200, 1200, 56, 800)).toBe(false)
        expect(rowSettled(-80, -80, 56, 800)).toBe(false)
    })
    it("stays lit about 1.5 s and gives up waiting before 2 s", () => {
        expect(ROW_GLOW.fadeInMs + ROW_GLOW.holdMs).toBeGreaterThanOrEqual(1200)
        expect(ROW_GLOW.pollMs * ROW_GLOW.maxPolls).toBeLessThan(2000)
    })
})
