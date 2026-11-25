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

export type PresetId = keyof typeof ACCENT_PRESETS
/** A preset, or the user's own colour as "custom:#rrggbb" (the same stored key, so it syncs like a preset) */
export type AccentId = PresetId | `custom:#${string}`
export const ACCENT_IDS = Object.keys(ACCENT_PRESETS) as PresetId[]
export const DEFAULT_ACCENT: AccentId = "violet"

const CUSTOM = /^custom:(#[0-9a-f]{6})$/i

export function isPresetId(value: unknown): value is PresetId {
    return typeof value === "string" && Object.hasOwn(ACCENT_PRESETS, value)
}

export function isAccentId(value: unknown): value is AccentId {
    return isPresetId(value) || (typeof value === "string" && CUSTOM.test(value))
}

/** "#rrggbb" (also "rrggbb" and the short "#rgb") as a colour, or null when it is not one */
export function parseHexColor(text: string): RGB | null {
    const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(text.trim())
    if (!m) return null
    const h = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1]
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

export const toHex = (c: RGB) => "#" + c.map(v => v.toString(16).padStart(2, "0")).join("")

/** The accent id of an own colour */
export function customAccent(color: RGB): AccentId {
    return `custom:${toHex(color)}` as AccentId
}

/** The own colour of an accent id, or null for a preset */
export function customColor(accent: unknown): RGB | null {
    const m = typeof accent === "string" ? CUSTOM.exec(accent) : null
    return m ? parseHexColor(m[1]) : null
}

/** Hue in degrees, saturation and value 0–1 */
export function rgbToHsv([r, g, b]: RGB): [number, number, number] {
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    return [max === min ? 0 : toHsl([r, g, b])[0], max === 0 ? 0 : (max - min) / max, max / 255]
}

export function hsvToRgb(h: number, s: number, v: number): RGB {
    const f = (n: number) => {
        const k = (n + h / 60) % 6
        return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))))
    }
    return [f(5), f(3), f(1)]
}

/** WCAG 2 relative luminance */
export function luminance(c: RGB): number {
    const [R, G, B] = c.map(v => {
        const x = v / 255
        return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * R + 0.7152 * G + 0.0722 * B
}

/** A hue at a lightness (0 black, 1 white), as vivid as `chroma` says (0 grey, 1 the full colour) */
function tone(hue: number, chroma: number, lightness: number): RGB {
    const grey = lightness * 255
    const vivid = fromHsl(hue, 1, lightness)
    return [0, 1, 2].map(i => Math.round(grey + (vivid[i] - grey) * chroma)) as [number, number, number]
}

/** The tone of a hue that has the luminance `target` */
function toneAt(hue: number, chroma: number, target: number): RGB {
    let lo = 0, hi = 1
    for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2
        if (luminance(tone(hue, chroma, mid)) < target) lo = mid
        else hi = mid
    }
    return tone(hue, chroma, (lo + hi) / 2)
}

const DARK_STEPS = [500, 600, 700, 800, 900, 950] as const

/**
 * A whole accent from any colour. Its hue and saturation are kept; the brightness of each step is set by what the step
 * has to carry, so every own colour reads like a preset: the fills under white text (500 and darker) get exactly the
 * luminance of violet's, the light steps (accent text and icons on the dark surfaces) violet's lightness and never less
 * than its luminance, and the strong accent stays below the brightest preset so the white switch knob still shows.
 */
function customPreset(color: RGB): AccentPreset & { chroma: number } {
    const [hue, chroma] = rgbToHsv(color)
    const violet = ACCENT_PRESETS.violet
    const light = (reference: RGB, cap?: number) => {
        const natural = tone(hue, chroma, toHsl(reference)[2])
        const y = luminance(natural)
        if (y < luminance(reference)) return toneAt(hue, chroma, luminance(reference))
        return cap !== undefined && y > cap ? toneAt(hue, chroma, cap) : natural
    }
    const steps = {} as Record<Step, RGB>
    for (const step of [50, 100, 200, 300] as const) steps[step] = light(violet.ramp[step])
    steps[400] = light(violet.ramp[400], luminance(ACCENT_PRESETS.green.ramp[400]))
    for (const step of DARK_STEPS) steps[step] = toneAt(hue, chroma, luminance(violet.ramp[step]))
    return {
        ramp: steps,
        nav: { active: light(violet.nav.active), label: light(violet.nav.label), tint: tone(hue, chroma, 0.6) },
        chroma,
    }
}

function resolveAccent(accent: AccentId): AccentPreset & { chroma: number } {
    if (isPresetId(accent)) return { ...ACCENT_PRESETS[accent], chroma: 1 }
    return customPreset(customColor(accent) ?? ACCENT_PRESETS.violet.ramp[400])
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

const hex = toHex
const rgb = (c: RGB) => `rgb(${c.join(", ")})`
const rgba = (c: RGB, a: number) => `rgba(${c.join(", ")}, ${a})`
/** For uniwind: culori reads #rrggbbaa (createVarGetter turns every colour into hex anyway) */
const hexA = (c: RGB, a: number) => hex(c) + Math.round(a * 255).toString(16).padStart(2, "0")

export function buildPalette(accent: AccentId, amoled: boolean) {
    const { ramp: r, nav, chroma } = resolveAccent(accent)
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
    return { css, js, swatch: hex(r[400]), surfaces: s, ramp: r, nav, amoled, chroma }
}

export type Palette = ReturnType<typeof buildPalette>
export type PaletteColors = Palette["js"]

/** WCAG 2 contrast ratio of two opaque colours */
export function contrastRatio(a: RGB, b: RGB): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
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

/* Accent tints drawn in script (gradients, glows), in the compact form they were written in: rgba(97,82,223,0.16) */
const tight = (c: RGB, a: number | string) => `rgba(${c.join(",")},${a})`

/** The accent fill (500) at an alpha */
export function accentRgba(alpha: number, palette: Palette) {
    return tight(palette.ramp[500], alpha)
}

/** A stop of a page glow: the accent's alpha and its offset in dp from the top */
export type GlowStop = readonly [alpha: number, at: number]

/**
 * The accent glow down from the top of a page; `clearAt` closes it with a clear stop. AMOLED black keeps the page true
 * black: no glow (undefined, so the style property drops out).
 */
export function accentGlow(stops: readonly GlowStop[], clearAt: number | undefined, palette: Palette): string | undefined {
    if (palette.amoled) return undefined
    const parts = stops.map(([alpha, at]) => `${accentRgba(alpha, palette)} ${at}px`)
    if (clearAt !== undefined) parts.push(`rgba(0,0,0,0) ${clearAt}px`)
    return `linear-gradient(180deg, ${parts.join(", ")})`
}

/** The page ground where the glow has `alpha`: background and accent mixed (just the background with AMOLED black) */
export function glowGround(alpha: number, palette: Palette): RGB {
    const bg = palette.surfaces.background
    if (palette.amoled) return bg
    const a = palette.ramp[500]
    return [0, 1, 2].map(i => Math.round(bg[i] + (a[i] - bg[i]) * alpha)) as [number, number, number]
}

/** A fade from clear to the ground under the glow at `alpha` (a banner that ends in the page) */
export function glowGroundFade(alpha: number, palette: Palette) {
    const g = glowGround(alpha, palette)
    return `linear-gradient(180deg, ${tight(g, 0)} 55%, rgb(${g.join(",")}) 100%)`
}

function toHsl([r, g, b]: RGB): [number, number, number] {
    const [R, G, B] = [r / 255, g / 255, b / 255]
    const max = Math.max(R, G, B), min = Math.min(R, G, B), l = (max + min) / 2
    if (max === min) return [0, 0, l]
    const d = max - min
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4
    return [h * 60, s, l]
}

function fromHsl(h: number, s: number, l: number): RGB {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    const channel = (t: number) => {
        const x = (t % 1 + 1) % 1
        const v = x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p
        return Math.round(v * 255)
    }
    return [channel(h / 360 + 1 / 3), channel(h / 360), channel(h / 360 - 1 / 3)]
}

const VIOLET_HUE = toHsl(ACCENT_PRESETS.violet.ramp[500])[0]

/**
 * A colour drawn for the violet accent, turned to the current accent's hue (its lightness kept, its saturation scaled by
 * how vivid the accent is: an own grey accent gives grey). Violet returns it unchanged.
 */
export function accentShift(c: RGB, palette: Palette): RGB {
    const delta = toHsl(palette.ramp[500])[0] - VIOLET_HUE
    if (Math.abs(delta) < 1e-9 && palette.chroma === 1) return c
    const [h, s, l] = toHsl(c)
    return fromHsl((h + delta + 360) % 360, s * palette.chroma, l)
}

/** `accentShift` as #rrggbb (text colours) */
export function accentShiftHex(c: RGB, palette: Palette) {
    return hex(accentShift(c, palette))
}

/** `accentShift` as a compact rgba() (borders, rings) */
export function accentShiftRgba(c: RGB, alpha: number, palette: Palette) {
    return tight(accentShift(c, palette), alpha)
}

/** The accent text of the ramp (300) as #rrggbb, for surfaces that take no rgb() (the home screen widget) */
export function accentTextHex(palette: Palette) {
    return hex(palette.ramp[300])
}

/**
 * The "More" menu panel: a dark accent tint at the top that runs into near-black. AMOLED black keeps it neutral (raised
 * surface into black).
 */
export function menuPanelBackground(palette: Palette) {
    if (palette.amoled) {
        const s = palette.surfaces
        return `linear-gradient(180deg, ${tight(s.smSurface, 0.99)}, ${tight(s.background, 0.99)})`
    }
    return `linear-gradient(180deg, ${accentShiftRgba([22, 20, 38], 0.99, palette)}, ${accentShiftRgba([9, 9, 14], 0.99, palette)})`
}

/** The menu's current row: the accent wash of the row, the gradient and glow of its icon tile, the tile's border */
export function menuRowHighlight(palette: Palette) {
    const { ramp: r, nav } = palette
    return {
        row: `linear-gradient(90deg, ${tight(r[500], "0.30")}, ${tight(nav.tint, "0.06")})`,
        tile: `linear-gradient(135deg, ${hex(r[500])}, ${hex(nav.tint)})`,
        glow: `0 0 16px ${tight(r[500], "0.65")}`,
        border: tight(nav.active, "0.45"),
    }
}
