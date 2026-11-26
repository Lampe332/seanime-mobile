import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { accentGlow, accentRgba, accentShift, accentShiftHex, accentShiftRgba, accentTextHex, ACCENT_IDS, ACCENT_PRESETS, buildPalette, contrastRatio, customAccent, customColor, isAccentId, luminance, parseHexColor, glowGroundFade, menuPanelBackground, menuRowHighlight, type RGB } from "./palette"

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
            const { surfaces: s, soft } = buildPalette(id, amoled)
            for (const ground of [s.background, s.smSurface, s.smSurfaceRaised, s.smSurfaceControl]) {
                expect(contrastRatio(ramp[300], ground)).toBeGreaterThanOrEqual(4.5)
                expect(contrastRatio(ramp[400], ground)).toBeGreaterThanOrEqual(4.5)
                // accent text on the soft accent fill (chips, selected rows)
                expect(contrastRatio(ramp[300], blend(ramp[400], soft, ground))).toBeGreaterThanOrEqual(4.5)
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

describe("accent tints drawn in script", () => {
    const violet = buildPalette("violet", false)
    const blue = buildPalette("blue", false)
    const phone = [[0.16, 0], [0.11, 56], [0.055, 261], [0.01, 476]] as const
    const tablet = [[0.16, 0], [0.13, 74], [0.102, 147], [0.078, 221], [0.058, 294], [0.04, 368], [0.026, 442], [0.014, 515], [0.0064, 589], [0.0016, 662], [0, 736]] as const

    it("violet gives exactly the strings the screens had written in", () => {
        expect(accentGlow(phone, 568, violet)).toBe("linear-gradient(180deg, rgba(97,82,223,0.16) 0px, rgba(97,82,223,0.11) 56px, rgba(97,82,223,0.055) 261px, rgba(97,82,223,0.01) 476px, rgba(0,0,0,0) 568px)")
        expect(accentGlow(tablet, undefined, violet)).toBe("linear-gradient(180deg, rgba(97,82,223,0.16) 0px, rgba(97,82,223,0.13) 74px, rgba(97,82,223,0.102) 147px, rgba(97,82,223,0.078) 221px, rgba(97,82,223,0.058) 294px, rgba(97,82,223,0.04) 368px, rgba(97,82,223,0.026) 442px, rgba(97,82,223,0.014) 515px, rgba(97,82,223,0.0064) 589px, rgba(97,82,223,0.0016) 662px, rgba(97,82,223,0) 736px)")
        expect(accentGlow([[0.14, 0], [0.05, 246], [0, 448]], undefined, violet)).toBe("linear-gradient(180deg, rgba(97,82,223,0.14) 0px, rgba(97,82,223,0.05) 246px, rgba(97,82,223,0) 448px)")
        const head = 110
        expect(accentGlow([[0.16, 0], [0.11, head], [0.085, head + 115], [0.055, head + 256], [0.028, head + 397], [0.01, head + 525]], head + 640, violet))
            .toBe(`linear-gradient(180deg, rgba(97,82,223,0.16) 0px, rgba(97,82,223,0.11) ${head}px, rgba(97,82,223,0.085) ${head + 115}px, rgba(97,82,223,0.055) ${head + 256}px, rgba(97,82,223,0.028) ${head + 397}px, rgba(97,82,223,0.01) ${head + 525}px, rgba(0,0,0,0) ${head + 640}px)`)
        expect(glowGroundFade(0.11, violet)).toBe("linear-gradient(180deg, rgba(17,15,31,0) 55%, rgb(17,15,31) 100%)")
        expect(menuRowHighlight(violet)).toEqual({
            row: "linear-gradient(90deg, rgba(97,82,223,0.30), rgba(139,92,246,0.06))",
            tile: "linear-gradient(135deg, #6152df, #8b5cf6)",
            glow: "0 0 16px rgba(97,82,223,0.65)",
            border: "rgba(196,181,253,0.45)",
        })
        expect(accentRgba(0.65, violet)).toBe("rgba(97,82,223,0.65)")
    })

    it("another accent carries its own 500", () => {
        const blue500 = ACCENT_PRESETS.blue.ramp[500].join(",")
        expect(accentGlow(phone, 568, blue)).toContain(`rgba(${blue500},0.16) 0px`)
        expect(accentGlow(phone, 568, blue)).not.toContain("97,82,223")
        const nav = menuRowHighlight(blue)
        expect(nav.row).toContain(`rgba(${blue500},0.30)`)
        expect(nav.glow).toBe(`0 0 16px rgba(${blue500},0.65)`)
        expect(nav.tile).toBe("linear-gradient(135deg, #2563eb, #3b82f6)")
        expect(accentRgba(0.5, blue)).toBe(`rgba(${blue500},0.5)`)
    })

    it("AMOLED black has no page glow and its fades end in black; the menu highlight stays", () => {
        for (const id of ACCENT_IDS) {
            const amoled = buildPalette(id, true)
            expect(accentGlow(phone, 568, amoled)).toBeUndefined()
            expect(accentGlow(tablet, undefined, amoled)).toBeUndefined()
            expect(glowGroundFade(0.11, amoled)).toBe("linear-gradient(180deg, rgba(0,0,0,0) 55%, rgb(0,0,0) 100%)")
            expect(menuRowHighlight(amoled)).toEqual(menuRowHighlight(buildPalette(id, false)))
        }
    })
})

describe("colours drawn for violet follow the accent", () => {
    const violet = buildPalette("violet", false)

    it("keeps every violet value exactly as before", () => {
        expect(menuPanelBackground(violet)).toBe("linear-gradient(180deg, rgba(22,20,38,0.99), rgba(9,9,14,0.99))")
        expect(accentShiftHex([237, 233, 254], violet)).toBe("#ede9fe")
        expect(accentShiftRgba([166, 135, 244], 0.55, violet)).toBe("rgba(166,135,244,0.55)")
        expect(accentTextHex(violet)).toBe("#c7c2ff")
        expect(accentShift([1, 2, 3], violet)).toEqual([1, 2, 3])
    })

    it("turns them to the hue of every other accent, keeping their lightness", () => {
        const hueOf = ([r, g, b]: RGB) => {
            const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
            const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
            return h * 60
        }
        for (const id of ACCENT_IDS.filter(id => id !== "violet")) {
            const palette = buildPalette(id, false)
            const ring = accentShift([166, 135, 244], palette)
            const turn = hueOf(ACCENT_PRESETS[id].ramp[500]) - hueOf(ACCENT_PRESETS.violet.ramp[500])
            const diff = Math.abs(((hueOf(ring) - hueOf([166, 135, 244]) - turn + 720) % 360 + 180) % 360 - 180)
            expect(diff).toBeLessThan(4)
            expect(Math.max(...ring) + Math.min(...ring)).toBeCloseTo(244 + 135, -1)
            expect(menuPanelBackground(palette)).not.toContain("22,20,38")
            expect(accentTextHex(palette)).not.toBe("#c7c2ff")
        }
    })

    it("keeps the menu panel neutral with AMOLED black", () => {
        for (const id of ACCENT_IDS) {
            expect(menuPanelBackground(buildPalette(id, true))).toBe("linear-gradient(180deg, rgba(17,17,19,0.99), rgba(0,0,0,0.99))")
        }
    })
})

describe("an own accent colour", () => {
    const OWN = ["#ffff00", "#000080", "#00ff00", "#ff0000", "#00ffff", "#ffffff", "#000000", "#808080", "#3a2f1e"]
    const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const
    const own = (hex: string) => customAccent(parseHexColor(hex)!)

    it("is stored as custom:#rrggbb in the accent key", () => {
        expect(own("#FFAA00")).toBe("custom:#ffaa00")
        expect(own("fa0")).toBe("custom:#ffaa00")
        expect(customColor("custom:#ffaa00")).toEqual([255, 170, 0])
        expect(customColor("violet")).toBeNull()
        expect(isAccentId("custom:#12AB34")).toBe(true)
        for (const id of ACCENT_IDS) expect(isAccentId(id)).toBe(true)
        for (const bad of ["custom:red", "custom:#12345", "custom:#1234567", "#123456", "toString", "", 7, null]) expect(isAccentId(bad)).toBe(false)
        for (const bad of ["", "#12", "#12345", "#gggggg", "rgb(1,2,3)"]) expect(parseHexColor(bad)).toBeNull()
    })

    it.each(OWN)("%s: a whole ramp and every variable and script colour of a preset", hex => {
        const violet = buildPalette("violet", false)
        for (const amoled of [false, true]) {
            const palette = buildPalette(own(hex), amoled)
            expect(Object.keys(palette.css).sort()).toEqual(Object.keys(violet.css).sort())
            expect(Object.keys(palette.js).sort()).toEqual(Object.keys(violet.js).sort())
            for (const value of [...Object.values(palette.css), ...Object.values(palette.js)]) expect(value).not.toMatch(/NaN|undefined/)
            for (const step of STEPS) {
                expect(palette.ramp[step]).toHaveLength(3)
                for (const v of palette.ramp[step]) expect(Number.isInteger(v) && v >= 0 && v <= 255).toBe(true)
            }
            // lighter towards 50, darker towards 950
            for (let i = 1; i < STEPS.length; i++) expect(luminance(palette.ramp[STEPS[i]])).toBeLessThanOrEqual(luminance(palette.ramp[STEPS[i - 1]]) + 0.002)
        }
    })

    it.each(OWN)("%s: text meets WCAG AA (4.5:1) on and beside the accent", hex => {
        for (const amoled of [false, true]) {
            const { ramp, nav, surfaces: s, soft } = buildPalette(own(hex), amoled)
            expect(contrastRatio(WHITE, ramp[500])).toBeGreaterThanOrEqual(4.5)
            expect(contrastRatio(WHITE, ramp[600])).toBeGreaterThanOrEqual(4.5)
            for (const ground of [s.background, s.smSurface, s.smSurfaceRaised, s.smSurfaceControl]) {
                expect(contrastRatio(ramp[300], ground)).toBeGreaterThanOrEqual(4.5)
                expect(contrastRatio(ramp[400], ground)).toBeGreaterThanOrEqual(4.5)
                expect(contrastRatio(ramp[300], blend(ramp[400], soft, ground))).toBeGreaterThanOrEqual(4.5)
            }
            expect(contrastRatio(nav.active, blend(nav.tint, 0.18, s.navBar))).toBeGreaterThanOrEqual(4.5)
            expect(contrastRatio(nav.label, blend(nav.tint, 0.18, s.navBar))).toBeGreaterThanOrEqual(4.5)
            // the white knob of a switch still shows on the strong accent
            expect(contrastRatio(WHITE, ramp[400])).toBeGreaterThan(1.3)
        }
    })

    it("keeps the hue of the colour, and a grey stays grey", () => {
        const [r, g, b] = buildPalette(own("#ff0000"), false).ramp[500]
        expect(r).toBeGreaterThan(g)
        expect(g).toBe(b)
        for (const step of STEPS) {
            const [x, y, z] = buildPalette(own("#808080"), false).ramp[step]
            expect([y, z]).toEqual([x, x])
        }
    })
})

describe("an on switch and the chosen tab stay clear with any own colour", () => {
    const own = (hex: string) => customAccent(parseHexColor(hex)!)
    /** the three colourless picks the device tests showed, and pale and vivid colours around them */
    const COLOURLESS = ["#808080", "#ffffff", "#000000"]
    const OTHERS = ["#8a8090", "#b0a090", "#c8b4ff", "#ffff00", "#00ff00", "#ff0000", "#000080", "#3a2f1e"]

    it.each([...COLOURLESS, ...OTHERS])("%s: the on track stands off the off track and the row it sits on", hex => {
        for (const amoled of [false, true]) {
            const { ramp, surfaces: s } = buildPalette(own(hex), amoled)
            // WCAG 1.4.11 (3:1 for controls)
            expect(contrastRatio(ramp[400], s.smSurfaceControl)).toBeGreaterThanOrEqual(3)
            expect(contrastRatio(ramp[400], s.smSurfaceRaised)).toBeGreaterThanOrEqual(3)
        }
    })

    it.each(COLOURLESS)("%s: a monochrome accent: white knob at 3:1 on its track, the chosen tab clearly off the others", hex => {
        for (const amoled of [false, true]) {
            const palette = buildPalette(own(hex), amoled)
            const { ramp, surfaces: s, soft } = palette
            expect(palette.mono).toBe(true)
            expect(contrastRatio(WHITE, ramp[400])).toBeGreaterThanOrEqual(3)
            // without a hue, the chosen tab's wash alone has to set it off an unchosen tab (raised surface)
            for (const ground of [s.background, s.smSurface]) {
                expect(contrastRatio(blend(ramp[400], soft, ground), s.smSurfaceRaised)).toBeGreaterThanOrEqual(1.35)
            }
            // the light accent text and nav icon stay near the pick: neutral, bright
            const [r, g, b] = palette.ramp[300]
            expect([g, b]).toEqual([r, r])
            expect(luminance(palette.ramp[300])).toBeGreaterThan(0.6)
        }
    })

    it("eases pale colours towards that and leaves vivid ones and the presets as they were", () => {
        const knob = (hex: string) => contrastRatio(WHITE, buildPalette(own(hex), false).ramp[400])
        expect(knob("#8a8090")).toBeGreaterThanOrEqual(3)
        expect(knob("#b0a090")).toBeGreaterThan(knob("#c8b4ff") - 0.01)
        expect(buildPalette(own("#c8b4ff"), false).mono).toBe(false)
        for (const id of ACCENT_IDS) {
            const palette = buildPalette(id, false)
            expect(palette.mono).toBe(false)
            expect(palette.soft).toBe(0.18)
            expect(palette.ramp[400]).toEqual(ACCENT_PRESETS[id].ramp[400])
        }
    })
})
