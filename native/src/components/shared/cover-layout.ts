/*
 * The sizes of the phone kit's covers (phone-screen.css + tablet.css) as numbers. Android's font size zooms the text, not
 * the lengths (`--ps-text-zoom`): covers grow with it, so large text gets fewer, wider cards instead of squeezed titles.
 */

/** "Card size" (settings → Appearance, per device): a factor on the grid's least card width. Normal is the kit's size. */
export type CardSize = "small" | "normal" | "large"
export const CARD_SIZE_FACTORS: Record<CardSize, number> = { small: 0.7, normal: 1, large: 1.3 }
export const cardSizeFactor = (size: CardSize | undefined) => CARD_SIZE_FACTORS[size ?? "normal"] ?? 1

/**
 * Columns of cells at least `min` × `factor` wide, `gap` apart. A larger card size never drops below two columns where the
 * normal size fits two (a phone keeps a grid, not one cover per row).
 */
export function coverColumns(contentWidth: number, min: number, gap: number, factor = 1) {
    const fit = (cell: number) => Math.max(1, Math.floor((contentWidth + gap) / (cell + gap)))
    return Math.max(fit(min * factor), Math.min(2, fit(min)))
}

/**
 * `.ps-grid`: `repeat(auto-fill, minmax(max(100px, 78px × zoom), 1fr))`, 12dp apart; tablet 8.75rem and 16dp. `factor`
 * is the card size (CARD_SIZE_FACTORS).
 */
export function gridLayout(contentWidth: number, rail: boolean, zoom: number, factor = 1) {
    const min = rail ? 140 : Math.max(100, 78 * zoom)
    const gap = rail ? 16 : 12
    const columns = coverColumns(contentWidth, min, gap, factor)
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

/**
 * Width the grid's cards take when they do not fill one row (fewer results than columns): the end-of-list note centres
 * under them instead of under the empty cells. A full row (or none) takes the content width.
 */
export function gridRowWidth(count: number, grid: { columns: number, gap: number, width: number }, contentWidth: number) {
    if (count <= 0 || count >= grid.columns) return contentWidth
    return count * grid.width + (count - 1) * grid.gap
}

/** Rows of a list (cover, title, time) side by side next to the rail: one column per 440dp, at most two; phones one. */
export const LIST_COLUMN_MIN = 440
export const LIST_COLUMN_GAP = 12
export function listColumns(contentWidth: number, rail: boolean) {
    if (!rail) return 1
    return Math.max(1, Math.min(2, Math.floor((contentWidth + LIST_COLUMN_GAP) / (LIST_COLUMN_MIN + LIST_COLUMN_GAP))))
}
