/**
 * The design tokens of src/global.css for script: props that take a colour or number instead of a class (icons, Switch,
 * Reanimated styles) and the Building blocks screen. Sources are listed in global.css; change both together.
 */
import type { Palette, PaletteColors } from "./palette"

/**
 * The colours that never change. Those that follow the appearance settings (accent, surfaces, bottom bar: palette.ts)
 * are not here on purpose: a component takes them from useThemeColors() (appearance.ts), which returns these and the
 * current palette's in one object. A module-level object that changed behind React's back was the bug: the React
 * Compiler keeps a value read from an import for good, so such a colour stayed what it was at the first render.
 */
export const colors = {
    foreground: "rgb(209, 209, 209)",
    border: "rgba(255, 255, 255, 0.1)",
    muted: "rgba(255, 255, 255, 0.4)",
    mutedHighlight: "rgba(255, 255, 255, 0.6)",
    subtle: "rgba(255, 255, 255, 0.06)",
    subtleHighlight: "rgba(255, 255, 255, 0.08)",

    /** Text and icons on the brand fill (primary buttons: `text-white` in button.tsx) */
    onBrand: "#ffffff",

    smLine: "rgba(255, 255, 255, 0.08)",
    smLineStrong: "rgba(255, 255, 255, 0.14)",
    smText: "#ededf0",
    smTextMuted: "#b6b6bc",
    smTextSubtle: "#9c9ca3",
    smDanger: "#f2a7b6",
    smSuccess: "#6fd39a",
    smWarning: "#f0c47e",
    smScrim: "rgba(0, 0, 0, 0.72)",

    navLine: "rgba(255, 255, 255, 0.07)",
    navRailLine: "rgba(255, 255, 255, 0.06)",
    navItem: "rgba(255, 255, 255, 0.55)",
} as const

/** Every script colour: the fixed ones and the current palette's */
export type ThemeColors = typeof colors & PaletteColors

const themed = new WeakMap<Palette, ThemeColors>()

/** The script colours of a palette, one object per palette (so it can be a dependency) */
export function themeColorsOf(palette: Palette): ThemeColors {
    let all = themed.get(palette)
    if (!all) themed.set(palette, all = { ...colors, ...palette.js })
    return all
}

/** Names of the Tailwind classes that carry each colour, for the Building blocks screen. */
export const colorSwatches: { name: string, className: string, key: keyof ThemeColors }[] = [
    { name: "background", className: "bg-background", key: "background" },
    { name: "paper", className: "bg-paper", key: "paper" },
    { name: "sm-surface-sunken", className: "bg-sm-surface-sunken", key: "smSurfaceSunken" },
    { name: "sm-surface", className: "bg-sm-surface", key: "smSurface" },
    { name: "sm-surface-raised", className: "bg-sm-surface-raised", key: "smSurfaceRaised" },
    { name: "sm-surface-control", className: "bg-sm-surface-control", key: "smSurfaceControl" },
    { name: "sm-text", className: "bg-sm-text", key: "smText" },
    { name: "sm-text-muted", className: "bg-sm-text-muted", key: "smTextMuted" },
    { name: "sm-text-subtle", className: "bg-sm-text-subtle", key: "smTextSubtle" },
    { name: "sm-accent", className: "bg-sm-accent", key: "smAccent" },
    { name: "sm-accent-strong", className: "bg-sm-accent-strong", key: "smAccentStrong" },
    { name: "brand-500", className: "bg-brand-500", key: "brand500" },
    { name: "sm-success", className: "bg-sm-success", key: "smSuccess" },
    { name: "sm-warning", className: "bg-sm-warning", key: "smWarning" },
    { name: "sm-danger", className: "bg-sm-danger", key: "smDanger" },
    { name: "nav-active", className: "bg-nav-active", key: "navActive" },
]

/** dp; 1rem = 16dp as in the WebView */
export const radii = {
    smLg: 20,
    sm: 16,
    smSm: 12,
    ui: 8,
    nav: 14,
    rail: 16,
    menu: 24,
    full: 999,
} as const

export const sizes = {
    /** bottom bar height (--sm-nav-h), without the system inset */
    navBar: 76,
    navBarLandscape: 60,
    navItemMinHeight: 48,
    navIcon: 24,
    navIconDense: 22,
    /** bar entries before they shrink (UIBottomNav.kt MAX_NAV_ITEMS counts the Menu button) */
    navMaxItems: 7,
    tabletRail: 88,
    tabletRailItemWidth: 72,
    tabletRailItemHeight: 64,
    tabletRailItemHeightShort: 56,
    tabletRailTopPadding: 76,
    tabletRailMark: 40,
    tabletGutter: 24,
    touch: 44,
    row: 48,
} as const

export const spacingScale = [0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48] as const

/**
 * Cursor, selection handles and selection highlight of a text field in the accent (spread on every TextInput). uniwind
 * resolves them from the CSS variables, so they follow the accent without a re-render; Android's default was its theme
 * colour.
 */
export const accentInput = {
    cursorColorClassName: "accent-sm-accent",
    selectionHandleColorClassName: "accent-sm-accent",
    selectionColorClassName: "accent-sm-accent-line",
} as const
