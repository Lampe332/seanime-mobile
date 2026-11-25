/**
 * The colours that follow the appearance settings (accent colour, AMOLED black): one source for the CSS variables of
 * src/global.css (sent to uniwind at runtime, appearance.ts) and the script values of `colors` (tokens.ts, getters on
 * the current palette). Violet with AMOLED off is exactly the values global.css starts with.
 */

export type RGB = readonly [number, number, number]

const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const
type Step = typeof STEPS[number]

interface AccentPreset {
    /** The brand ramp: 300 is the accent text, 400 the strong accent, 500 the fill under white text */
    ramp: Record<Step, RGB>
    /** The bottom bar's active item: icon, label and the tint of its pill */
    nav: { active: RGB, label: RGB, tint: RGB }
}

const ramp = (...values: RGB[]) => Object.fromEntries(STEPS.map((step, i) => [step, values[i]])) as Record<Step, RGB>

export const ACCENT_PRESETS = {
    violet: {
        ramp: ramp([242, 240, 255], [238, 235, 255], [212, 208, 255], [199, 194, 255], [159, 146, 255], [97, 82, 223],
            [82, 67, 203], [63, 46, 178], [49, 40, 135], [35, 28, 107], [26, 20, 79]),
        nav: { active: [196, 181, 253], label: [221, 214, 254], tint: [139, 92, 246] },
    },
    blue: {
        ramp: ramp([239, 246, 255], [224, 236, 255], [196, 218, 255], [170, 201, 255], [115, 163, 255], [37, 99, 235],
            [29, 78, 216], [30, 64, 175], [30, 58, 138], [23, 42, 107], [15, 27, 74]),
        nav: { active: [147, 197, 253], label: [191, 219, 254], tint: [59, 130, 246] },
    },
    green: {
        ramp: ramp([240, 253, 244], [220, 252, 231], [187, 247, 208], [152, 233, 180], [94, 210, 135], [21, 128, 61],
            [17, 107, 50], [20, 83, 45], [18, 66, 37], [12, 48, 27], [6, 32, 17]),
        nav: { active: [134, 239, 172], label: [187, 247, 208], tint: [34, 197, 94] },
    },
    pink: {
        ramp: ramp([253, 242, 248], [252, 231, 243], [251, 207, 232], [249, 182, 218], [244, 128, 186], [199, 38, 112],
            [172, 28, 94], [140, 22, 77], [110, 20, 62], [80, 15, 46], [54, 8, 30]),
        nav: { active: [249, 168, 212], label: [251, 207, 232], tint: [236, 72, 153] },
    },
    orange: {
        ramp: ramp([255, 247, 237], [255, 237, 213], [254, 215, 170], [253, 196, 140], [251, 146, 60], [194, 65, 12],
            [168, 54, 10], [140, 45, 12], [110, 37, 14], [80, 28, 12], [52, 18, 6]),
        nav: { active: [253, 186, 116], label: [254, 215, 170], tint: [249, 115, 22] },
    },
    red: {
        ramp: ramp([254, 242, 242], [254, 226, 226], [254, 202, 202], [252, 175, 175], [248, 113, 113], [200, 38, 38],
            [175, 28, 28], [145, 25, 25], [115, 22, 22], [85, 17, 17], [55, 10, 10]),
        nav: { active: [252, 165, 165], label: [254, 202, 202], tint: [239, 68, 68] },
    },
} satisfies Record<string, AccentPreset>

export type AccentId = keyof typeof ACCENT_PRESETS
export const ACCENT_IDS = Object.keys(ACCENT_PRESETS) as AccentId[]
export const DEFAULT_ACCENT: AccentId = "violet"

export function isAccentId(value: unknown): value is AccentId {
    return typeof value === "string" && value in ACCENT_PRESETS
}

/** Page and surfaces: the app's greys, or true black for OLED screens with each surface a step darker but still apart */
const SURFACES = {
    standard: {
        background: [7, 7, 7], paper: [11, 11, 11], paperLighter: [13, 13, 13], smSurface: [20, 20, 22],
        smSurfaceRaised: [28, 28, 31], smSurfaceControl: [38, 38, 42], smSurfaceSunken: [14, 14, 16], navBar: [10, 10, 15],
    },
    amoled: {
        background: [0, 0, 0], paper: [5, 5, 5], paperLighter: [8, 8, 8], smSurface: [17, 17, 19],
        smSurfaceRaised: [25, 25, 28], smSurfaceControl: [35, 35, 39], smSurfaceSunken: [9, 9, 10], navBar: [0, 0, 0],
    },
} satisfies Record<string, Record<string, RGB>>

const hex = (c: RGB) => "#" + c.map(v => v.toString(16).padStart(2, "0")).join("")
const rgb = (c: RGB) => `rgb(${c.join(", ")})`
const rgba = (c: RGB, a: number) => `rgba(${c.join(", ")}, ${a})`
/** For uniwind: culori reads #rrggbbaa (createVarGetter turns every colour into hex anyway) */
const hexA = (c: RGB, a: number) => hex(c) + Math.round(a * 255).toString(16).padStart(2, "0")

export function buildPalette(accent: AccentId, amoled: boolean) {
    const { ramp: r, nav } = ACCENT_PRESETS[accent]
    const s = amoled ? SURFACES.amoled : SURFACES.standard
    const css: Record<string, string> = {
        "--color-brand": hex(r[500]),
        "--color-background": hex(s.background),
        "--color-paper": hex(s.paper),
        "--color-paper-lighter": hex(s.paperLighter),
        "--color-sm-surface": hex(s.smSurface),
        "--color-sm-surface-raised": hex(s.smSurfaceRaised),
        "--color-sm-surface-control": hex(s.smSurfaceControl),
        "--color-sm-surface-sunken": hex(s.smSurfaceSunken),
        "--color-sm-accent": hex(r[300]),
        "--color-sm-accent-strong": hex(r[400]),
        "--color-sm-accent-soft": hexA(r[400], 0.18),
        "--color-sm-accent-softer": hexA(r[400], 0.08),
        "--color-sm-accent-line": hexA(r[300], 0.55),
        "--color-nav-bar": hexA(s.navBar, 0.985),
        "--color-nav-active": hex(nav.active),
        "--color-nav-active-label": hex(nav.label),
        "--color-nav-active-bg": hexA(nav.tint, 0.18),
        "--color-nav-active-pressed": hexA(nav.tint, 0.28),
        "--color-menu-border": hexA(nav.tint, 0.22),
    }
    for (const step of STEPS) css[`--color-brand-${step}`] = hex(r[step])
    const js = {
        background: hex(s.background),
        paper: rgb(s.paper),
        paperLighter: rgb(s.paperLighter),
        brand300: rgb(r[300]),
        brand400: rgb(r[400]),
        brand500: rgb(r[500]),
        smSurface: hex(s.smSurface),
        smSurfaceRaised: hex(s.smSurfaceRaised),
        smSurfaceControl: hex(s.smSurfaceControl),
        smSurfaceSunken: hex(s.smSurfaceSunken),
        smAccent: rgb(r[300]),
        smAccentStrong: rgb(r[400]),
        smAccentSoft: rgba(r[400], 0.18),
        smAccentSofter: rgba(r[400], 0.08),
        /** The strong accent fully clear (a border that fades out into the accent fill) */
        smAccentClear: rgba(r[400], 0),
        smAccentLine: rgba(r[300], 0.55),
        navBar: rgba(s.navBar, 0.96),
        navActive: hex(nav.active),
        navActiveLabel: hex(nav.label),
        navActiveBg: rgba(nav.tint, 0.18),
        menuBorder: rgba(nav.tint, 0.22),
    }
    return { css, js, swatch: hex(r[400]), surfaces: s, ramp: r, nav }
}

export type Palette = ReturnType<typeof buildPalette>
export type PaletteColors = Palette["js"]

/** WCAG 2 contrast ratio of two opaque colours */
export function contrastRatio(a: RGB, b: RGB): number {
    const lum = (c: RGB) => {
        const [R, G, B] = c.map(v => {
            const x = v / 255
            return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * R + 0.7152 * G + 0.0722 * B
    }
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
}

/* The palette in use. appearance.ts swaps it; tokens.ts reads it through getters; useThemeColors re-renders on a swap. */
let current: Palette = buildPalette(DEFAULT_ACCENT, false)
let version = 0
const listeners = new Set<() => void>()

export function currentPalette(): Palette {
    return current
}

export function setCurrentPalette(next: Palette) {
    current = next
    version++
    listeners.forEach(listener => listener())
}

export function subscribePalette(listener: () => void) {
    listeners.add(listener)
    return () => void listeners.delete(listener)
}

export function paletteVersion() {
    return version
}
