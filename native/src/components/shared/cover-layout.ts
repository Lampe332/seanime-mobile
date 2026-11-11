/*
 * The sizes of the phone kit's covers (phone-screen.css + tablet.css) as numbers. Android's font size zooms the text, not
 * the lengths (`--ps-text-zoom`): covers grow with it, so large text gets fewer, wider cards instead of squeezed titles.
 */

/** `.ps-grid`: `repeat(auto-fill, minmax(max(100px, 78px × zoom), 1fr))`, 12dp apart; tablet 8.75rem and 16dp. */
export function gridLayout(contentWidth: number, rail: boolean, zoom: number) {
    const min = rail ? 140 : Math.max(100, 78 * zoom)
    const gap = rail ? 16 : 12
    const columns = Math.max(1, Math.floor((contentWidth + gap) / (min + gap)))
    return { columns, gap, rowGap: rail ? 20 : 16, width: Math.max(0, (contentWidth - gap * (columns - 1)) / columns) }
}

/**
 * `.ps-row > *` on Discover: min(36vw, 8.75rem × zoom), at least 7rem × zoom, at most the screen less its gutters and
 * 3rem (the next cover peeks in); tablet 9.5rem.
 */
export function rowCoverWidth(windowWidth: number, rail: boolean, zoom: number) {
    if (rail) return 152
    return Math.round(Math.min(windowWidth - 32 - 48, Math.max(Math.min(windowWidth * 0.36, 140 * zoom), 112 * zoom)))
}
