/**
 * The design tokens of src/global.css for script: props that take a colour or number instead of a class (icons, Switch,
 * Reanimated styles) and the Building blocks screen. Sources are listed in global.css; change both together.
 */
export const colors = {
    background: "#070707",
    foreground: "rgb(209, 209, 209)",
    paper: "rgb(11, 11, 11)",
    paperLighter: "rgb(13, 13, 13)",
    border: "rgba(255, 255, 255, 0.1)",
    muted: "rgba(255, 255, 255, 0.4)",
    mutedHighlight: "rgba(255, 255, 255, 0.6)",
    subtle: "rgba(255, 255, 255, 0.06)",
    subtleHighlight: "rgba(255, 255, 255, 0.08)",

    brand300: "rgb(199, 194, 255)",
    brand400: "rgb(159, 146, 255)",
    brand500: "rgb(97, 82, 223)",

    smSurface: "#141416",
    smSurfaceRaised: "#1c1c1f",
    smSurfaceControl: "#26262a",
    smSurfaceSunken: "#0e0e10",
    smLine: "rgba(255, 255, 255, 0.08)",
    smLineStrong: "rgba(255, 255, 255, 0.14)",
    smText: "#ededf0",
    smTextMuted: "#b6b6bc",
    smTextSubtle: "#9c9ca3",
    smDanger: "#f2a7b6",
    smSuccess: "#6fd39a",
    smWarning: "#f0c47e",
    smScrim: "rgba(0, 0, 0, 0.72)",
    smAccent: "rgb(199, 194, 255)",
    smAccentStrong: "rgb(159, 146, 255)",
    smAccentSoft: "rgba(159, 146, 255, 0.18)",
    smAccentSofter: "rgba(159, 146, 255, 0.08)",
    smAccentLine: "rgba(199, 194, 255, 0.55)",

    navBar: "rgba(10, 10, 15, 0.96)",
    navLine: "rgba(255, 255, 255, 0.07)",
    navRailLine: "rgba(255, 255, 255, 0.06)",
    navItem: "rgba(255, 255, 255, 0.55)",
    navActive: "#c4b5fd",
    navActiveLabel: "#ddd6fe",
    navActiveBg: "rgba(139, 92, 246, 0.18)",
    menuBorder: "rgba(139, 92, 246, 0.22)",
} as const

/** Names of the Tailwind classes that carry each colour, for the Building blocks screen. */
export const colorSwatches: { name: string, className: string, value: string }[] = [
    { name: "background", className: "bg-background", value: colors.background },
    { name: "paper", className: "bg-paper", value: colors.paper },
    { name: "sm-surface-sunken", className: "bg-sm-surface-sunken", value: colors.smSurfaceSunken },
    { name: "sm-surface", className: "bg-sm-surface", value: colors.smSurface },
    { name: "sm-surface-raised", className: "bg-sm-surface-raised", value: colors.smSurfaceRaised },
    { name: "sm-surface-control", className: "bg-sm-surface-control", value: colors.smSurfaceControl },
    { name: "sm-text", className: "bg-sm-text", value: colors.smText },
    { name: "sm-text-muted", className: "bg-sm-text-muted", value: colors.smTextMuted },
    { name: "sm-text-subtle", className: "bg-sm-text-subtle", value: colors.smTextSubtle },
    { name: "sm-accent", className: "bg-sm-accent", value: colors.smAccent },
    { name: "sm-accent-strong", className: "bg-sm-accent-strong", value: colors.smAccentStrong },
    { name: "brand-500", className: "bg-brand-500", value: colors.brand500 },
    { name: "sm-success", className: "bg-sm-success", value: colors.smSuccess },
    { name: "sm-warning", className: "bg-sm-warning", value: colors.smWarning },
    { name: "sm-danger", className: "bg-sm-danger", value: colors.smDanger },
    { name: "nav-active", className: "bg-nav-active", value: colors.navActive },
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
