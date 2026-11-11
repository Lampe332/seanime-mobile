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
