/**
 * Tablet layout: a screen whose smaller side is 600dp or more (the Android sw600dp rule, MainActivity's
 * `smallestScreenWidthDp < 600` gate) shows the phone screens laid out for a tablet: navigation rail on the left instead of
 * the bottom bar, wider content. Decided from the screen, not the window, so a split-screen window keeps the tablet rules;
 * below 600dp of window width it falls back to the phone bar (tablet.css only applied its rail from `min-width: 600px`).
 *
 * The web app decided once per page load and reloaded the page when a foldable changed class. The native app re-renders
 * instead: use-tablet-ui.ts follows React Native's dimension changes. This file holds the pure rules (tested).
 */
export const TABLET_MIN_SIDE_DP = 600

/** Phone width the tablet layout lays out against, so every breakpoint picks the phone layout. */
export const PHONE_LAYOUT_WIDTH = 430

/** Width from which the tablet layout shows a list and its open item side by side (app/tablet.css 720px). */
export const TWO_PANES_MIN_WIDTH = 720

/** Width from which entry pages show two columns and side sheets (app/tablet.css 1000px). */
export const WIDE_MIN_WIDTH = 1000

/** Height below which the rail drops the app mark and gets shorter items (tablet.css `max-height: 640px`). */
export const SHORT_RAIL_MAX_HEIGHT = 640

export type Size = { width: number, height: number }

/** Whether the device's screen is a tablet screen (smaller side ≥ 600dp). */
export function isTabletScreen(screen: Size) {
    return Math.min(screen.width, screen.height) >= TABLET_MIN_SIDE_DP
}

/** Whether the window shows the rail: a tablet screen in a window at least 600dp wide. */
export function showsRail(isTablet: boolean, window: Size) {
    return isTablet && window.width >= TABLET_MIN_SIDE_DP
}

/** Viewport width for layout breakpoints. The tablet layout always reports a phone width. */
export function layoutWidth<T extends number | null | undefined>(isTablet: boolean, width: T): T {
    return (isTablet && typeof width === "number" ? Math.min(width, PHONE_LAYOUT_WIDTH) : width) as T
}

/** Whether the tablet layout has room for two panes in this window (a split-screen window may not); always false on phones. */
export function hasTwoPanes(isTablet: boolean, window: Size) {
    return isTablet && window.width >= TWO_PANES_MIN_WIDTH
}

/**
 * Space above each part of a wide entry page's left column (from WIDE_MIN_WIDTH; below it the phone's 1rem gap of
 * `.mobile-anime-header-inner` stays). tablet.css gives the identity `margin-bottom: 1rem`; the anime page dissolves its header
 * into the page grid (`display: contents`, no row gap: progress and About touch, the actions get `margin-top: 1rem`), the manga
 * page keeps the header with its 1rem gap (identity → progress = margin + gap).
 */
export function entryColumnGaps(kind: "anime" | "manga") {
    return kind === "anime"
        ? { progress: 16, link: 0, about: 0, actions: 16 }
        : { progress: 32, link: 16, about: 16, actions: 16 }
}

/**
 * Widest a column of rows (text on the left, a switch or value on the right) gets on a tablet: the settings pane's cap
 * (52rem, settings-phone.tsx). Wider, a switch ends up ~700dp from its label (Downloads, r16).
 */
export const TABLET_READING_WIDTH = 832

/** The style that keeps a page's rows at the reading width next to the rail; nothing on phones. */
export function readingColumn(rail: boolean) {
    return rail ? { width: "100%" as const, maxWidth: TABLET_READING_WIDTH } : undefined
}

/** The Anime | Manga segment next to the rail (tablet.css `.pl-switch`, 26rem). */
export const TABLET_SEGMENT_WIDTH = 416

/** Widest the search field gets when it stands beside the segment (r16). */
export const TABLET_SEARCH_MAX_WIDTH = 480

/** Narrowest search field worth putting beside the segment; below it the field keeps its own row. */
export const TABLET_SEARCH_MIN_WIDTH = 320

/**
 * Whether My lists and Search put the search field beside Anime | Manga instead of under it (r16, Nick 10.11.): only
 * next to the rail and when segment, a labelled stats button (≤ 120dp) and a usable field fit in the content width.
 * Pixel Tablet landscape (1172dp of content) yes; portrait (692dp) and phones keep the stacked rows.
 */
export function searchBesideTabs(rail: boolean, contentWidth: number) {
    return rail && contentWidth >= TABLET_SEGMENT_WIDTH + 120 + 8 + 12 + TABLET_SEARCH_MIN_WIDTH
}

/** A short window (landscape split screen): compact rail without the app mark. */
export function isShortRail(window: Size) {
    return window.height <= SHORT_RAIL_MAX_HEIGHT
}
