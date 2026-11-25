import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { ACCENT_IDS, ACCENT_PRESETS, buildPalette, contrastRatio, type RGB } from "./palette"

const WHITE: RGB = [255, 255, 255]
const blend = (top: RGB, alpha: number, under: RGB): RGB => top.map((v, i) => Math.round(v * alpha + under[i] * (1 - alpha))) as unknown as RGB

/** The @theme values of global.css as #rrggbb(aa), to hold the default palette to them */
function globalCssVars(): Record<string, string> {
    const css = readFileSync(join(__dirname, "../../global.css"), "utf8")
    const out: Record<string, string> = {}
    const h = (n: number) => n.toString(16).padStart(2, "0")
    for (const [, name, value] of css.matchAll(/(--color-[\w-]+):\s*([^;]+);/g)) {
        const rgb = value.match(/^rgb\((\d+) (\d+) (\d+)(?: \/ ([\d.]+))?\)$/)
        out[name] = rgb
            ? "#" + [rgb[1], rgb[2], rgb[3]].map(v => h(Number(v))).join("") + (rgb[4] ? h(Math.round(Number(rgb[4]) * 255)) : "")
            : value.trim().toLowerCase()
    }
    return out
}

describe("palette", () => {
    it("violet without AMOLED is exactly the start values of global.css", () => {
        const start = globalCssVars()
        for (const [name, value] of Object.entries(buildPalette("violet", false).css)) expect([name, value]).toEqual([name, start[name]])
    })

    it("violet without AMOLED keeps the script colours tokens.ts had", () => {
        expect(buildPalette("violet", false).js).toMatchObject({
            background: "#070707", paper: "rgb(11, 11, 11)", paperLighter: "rgb(13, 13, 13)",
            brand300: "rgb(199, 194, 255)", brand400: "rgb(159, 146, 255)", brand500: "rgb(97, 82, 223)",
            smSurface: "#141416", smSurfaceRaised: "#1c1c1f", smSurfaceControl: "#26262a", smSurfaceSunken: "#0e0e10",
            smAccent: "rgb(199, 194, 255)", smAccentStrong: "rgb(159, 146, 255)", smAccentSoft: "rgba(159, 146, 255, 0.18)",
            smAccentSofter: "rgba(159, 146, 255, 0.08)", smAccentLine: "rgba(199, 194, 255, 0.55)", navBar: "rgba(10, 10, 15, 0.96)",
            navActive: "#c4b5fd", navActiveLabel: "#ddd6fe", navActiveBg: "rgba(139, 92, 246, 0.18)", menuBorder: "rgba(139, 92, 246, 0.22)",
        })
    })

    it.each(ACCENT_IDS)("%s: text meets WCAG AA (4.5:1) on and beside the accent", id => {
        const { ramp, nav } = ACCENT_PRESETS[id]
        expect(contrastRatio(WHITE, ramp[500])).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(WHITE, ramp[600])).toBeGreaterThanOrEqual(4.5)
        for (const amoled of [false, true]) {
            const { surfaces: s } = buildPalette(id, amoled)
            for (const ground of [s.background, s.smSurface, s.smSurfaceRaised, s.smSurfaceControl]) {
                expect(contrastRatio(ramp[300], ground)).toBeGreaterThanOrEqual(4.5)
                expect(contrastRatio(ramp[400], ground)).toBeGreaterThanOrEqual(4.5)
                // accent text on the soft accent fill (chips, selected rows)
                expect(contrastRatio(ramp[300], blend(ramp[400], 0.18, ground))).toBeGreaterThanOrEqual(4.5)
            }
            const bar = s.navBar
            expect(contrastRatio(nav.active, blend(nav.tint, 0.18, bar))).toBeGreaterThanOrEqual(4.5)
            expect(contrastRatio(nav.label, blend(nav.tint, 0.18, bar))).toBeGreaterThanOrEqual(4.5)
        }
    })

    it("AMOLED is true black with each surface still a step apart", () => {
        const { surfaces: s, css } = buildPalette("blue", true)
        expect(css["--color-background"]).toBe("#000000")
        const steps = [s.background, s.smSurfaceSunken, s.smSurface, s.smSurfaceRaised, s.smSurfaceControl]
        for (let i = 1; i < steps.length; i++) expect(contrastRatio(steps[i], steps[i - 1])).toBeGreaterThan(1.05)
        const standard = buildPalette("blue", false).surfaces
        for (const key of Object.keys(s) as (keyof typeof s)[]) expect(contrastRatio(s[key], [0, 0, 0])).toBeLessThanOrEqual(contrastRatio(standard[key], [0, 0, 0]))
    })

    it("every preset sets every variable the default sets", () => {
        const names = Object.keys(buildPalette("violet", false).css).sort()
        for (const id of ACCENT_IDS) expect(Object.keys(buildPalette(id, true).css).sort()).toEqual(names)
    })
})
