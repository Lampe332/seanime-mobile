import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

// S22 10.11.: short sheets were 24dp taller than 2.0.32 under their last block – 8dp padding at the body's end and the
// empty View of a dialog written inside the body (its content goes to the portal) taking a body gap.
describe("sheet body end", () => {
    const source = readFileSync(join(__dirname, "sheet.tsx"), "utf8")

    it("takes every dialog root out of the layout", () => {
        const roots = source.match(/<DialogPrimitive\.Root [^>]*>/g) ?? []
        expect(roots.length).toBe(2)
        for (const root of roots) expect(root).toContain("style={OUT_OF_FLOW}")
        expect(source).toMatch(/const OUT_OF_FLOW = \{ display: "none" \}/)
    })

    it("ends the scrolling body with its last block (the sheet's 12dp padding follows)", () => {
        const container = source.match(/contentContainerClassName=\{([^}]*)\}/)?.[1] ?? ""
        expect(container).not.toMatch(/\bpb-/)
    })
})

// A search hit's row in a sheet: its glow asks useSheetScroll for the body's scroll, so the provider has to sit inside the
// portal (a context from outside never reaches the PortalHost at the app root) and around the measured content view
describe("sheet row scroll", () => {
    const source = readFileSync(join(__dirname, "sheet.tsx"), "utf8")
    const sheet = source.slice(source.indexOf("export function Sheet("), source.indexOf("export function Dialog("))

    it("provides the scroll inside the portal, in the body's content view", () => {
        const portal = sheet.indexOf("<DialogPrimitive.Portal>")
        const content = sheet.indexOf("<View ref={bodyContentRef}")
        const provider = sheet.indexOf("<SheetScrollContext.Provider value={scrollTo}>")
        expect(portal).toBeGreaterThan(-1)
        expect(content).toBeGreaterThan(portal)
        expect(provider).toBeGreaterThan(content)
        expect(provider).toBeLessThan(sheet.indexOf("</Animated.ScrollView>"))
    })

    it("measures the row against the content view and scrolls the body", () => {
        expect(sheet).toMatch(/row\.current\.measureLayout\(content,/)
        expect(sheet).toMatch(/bodyRef\.current\?\.scrollTo\(/)
        expect(sheet).toMatch(/<Animated\.ScrollView\s+ref=\{bodyRef\}/)
    })
})
