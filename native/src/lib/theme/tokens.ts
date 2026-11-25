/**
 * The design tokens of src/global.css for script: props that take a colour or number instead of a class (icons, Switch,
 * Reanimated styles) and the Building blocks screen. Sources are listed in global.css; change both together.
 */
import { currentPalette } from "./palette"

const live = () => currentPalette().js

/**
 * Fields with a getter follow the appearance settings (palette.ts). A component that reads them calls useThemeColors()
 * (appearance.ts) so it renders again when the accent or AMOLED changes.
 */
export const colors = {
    get background() { return live().background },
    foreground: "rgb(209, 209, 209)",
    get paper() { return live().paper },
    get paperLighter() { return live().paperLighter },
    border: "rgba(255, 255, 255, 0.1)",
    muted: "rgba(255, 255, 255, 0.4)",
    mutedHighlight: "rgba(255, 255, 255, 0.6)",
    subtle: "rgba(255, 255, 255, 0.06)",
    subtleHighlight: "rgba(255, 255, 255, 0.08)",

    get brand300() { return live().brand300 },
    get brand400() { return live().brand400 },
    get brand500() { return live().brand500 },
    /** Text and icons on the brand fill (primary buttons: `text-white` in button.tsx) */
    onBrand: "#ffffff",

    get smSurface() { return live().smSurface },
    get smSurfaceRaised() { return live().smSurfaceRaised },
    get smSurfaceControl() { return live().smSurfaceControl },
    get smSurfaceSunken() { return live().smSurfaceSunken },
    smLine: "rgba(255, 255, 255, 0.08)",
    smLineStrong: "rgba(255, 255, 255, 0.14)",
    smText: "#ededf0",
    smTextMuted: "#b6b6bc",
    smTextSubtle: "#9c9ca3",
    smDanger: "#f2a7b6",
    smSuccess: "#6fd39a",
    smWarning: "#f0c47e",
    smScrim: "rgba(0, 0, 0, 0.72)",
    get smAccent() { return live().smAccent },
    get smAccentStrong() { return live().smAccentStrong },
    get smAccentSoft() { return live().smAccentSoft },
    get smAccentSofter() { return live().smAccentSofter },
    get smAccentLine() { return live().smAccentLine },

    get navBar() { return live().navBar },
    navLine: "rgba(255, 255, 255, 0.07)",
    navRailLine: "rgba(255, 255, 255, 0.06)",
    navItem: "rgba(255, 255, 255, 0.55)",
    get navActive() { return live().navActive },
    get navActiveLabel() { return live().navActiveLabel },
    get navActiveBg() { return live().navActiveBg },
    get menuBorder() { return live().menuBorder },
} as const

/** Names of the Tailwind classes that carry each colour, for the Building blocks screen. */
export const colorSwatches: { name: string, className: string, value: string }[] = [
    { name: "background", className: "bg-background", get value() { return colors.background } },
    { name: "paper", className: "bg-paper", get value() { return colors.paper } },
    { name: "sm-surface-sunken", className: "bg-sm-surface-sunken", get value() { return colors.smSurfaceSunken } },
    { name: "sm-surface", className: "bg-sm-surface", get value() { return colors.smSurface } },
    { name: "sm-surface-raised", className: "bg-sm-surface-raised", get value() { return colors.smSurfaceRaised } },
    { name: "sm-surface-control", className: "bg-sm-surface-control", get value() { return colors.smSurfaceControl } },
    { name: "sm-text", className: "bg-sm-text", get value() { return colors.smText } },
    { name: "sm-text-muted", className: "bg-sm-text-muted", get value() { return colors.smTextMuted } },
    { name: "sm-text-subtle", className: "bg-sm-text-subtle", get value() { return colors.smTextSubtle } },
    { name: "sm-accent", className: "bg-sm-accent", get value() { return colors.smAccent } },
    { name: "sm-accent-strong", className: "bg-sm-accent-strong", get value() { return colors.smAccentStrong } },
    { name: "brand-500", className: "bg-brand-500", get value() { return colors.brand500 } },
    { name: "sm-success", className: "bg-sm-success", get value() { return colors.smSuccess } },
    { name: "sm-warning", className: "bg-sm-warning", get value() { return colors.smWarning } },
    { name: "sm-danger", className: "bg-sm-danger", get value() { return colors.smDanger } },
    { name: "nav-active", className: "bg-nav-active", get value() { return colors.navActive } },
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
