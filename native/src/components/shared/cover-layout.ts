/*
 * The sizes of the phone kit's covers (phone-screen.css + tablet.css) as numbers. Android's font size zooms the text, not
 * the lengths (`--ps-text-zoom`): covers grow with it, so large text gets fewer, wider cards instead of squeezed titles.
 */

/** "Card size" (settings → Appearance, per device): a factor on every cover poster (grids, rows, cover cards). Normal is the kit's size. */
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
 * A row's card (`normal`) at the card size: small and large scale it by `factor`, normal stays as is. A larger card is
 * never wider than 70 % of the screen nor the screen less 5rem (the next card peeks in), but never below normal.
 */
export function scaleRowWidth(normal: number, windowWidth: number, factor = 1) {
    const cap = Math.max(normal, Math.min(windowWidth * 0.7, windowWidth - 80))
    return Math.round(Math.min(normal * factor, cap))
}

/** Home and library rows (media-card-row.tsx): min(39vw, 10rem), scaled by the card size. */
export function rowCardWidth(windowWidth: number, factor = 1) {
    return scaleRowWidth(Math.min(windowWidth * 0.39, 160), windowWidth, factor)
}

/**
 * `.ps-row > *` on Discover: min(36vw, 8.75rem × zoom), at least 7rem × zoom, at most the screen less its gutters and
 * 3rem (the next cover peeks in); tablet 9.5rem. `factor` is the card size.
 */
export function rowCoverWidth(windowWidth: number, rail: boolean, zoom: number, factor = 1) {
    const normal = rail ? 152 : Math.min(windowWidth - 32 - 48, Math.max(Math.min(windowWidth * 0.36, 140 * zoom), 112 * zoom))
    return scaleRowWidth(normal, windowWidth, factor)
}

/** A row starts on the page gutter and keeps its cards a gutter apart: snapped, nothing of the card before shows. */
export const ROW_GUTTER = 16
export const ROW_GAP = 16
/** How much of the next card a row shows, as a share of a card: always a clear hint, never a half-cut card. */
export const ROW_PEEK_MIN = 0.25
export const ROW_PEEK_MAX = 0.5

/**
 * A row card's width in a row `viewport` wide (gutter left, cards to the right edge): whole cards plus a peek of the next
 * one between ROW_PEEK_MIN and ROW_PEEK_MAX of a card. Of every count of whole cards, the one whose width comes closest
 * to `desired` (the card size's width) wins; an unmeasured row keeps `desired`.
 */
export function fitRowWidth(desired: number, viewport: number, gutter = ROW_GUTTER, gap = ROW_GAP) {
    const room = viewport - gutter
    if (desired <= 0 || room <= gap) return Math.max(0, Math.round(desired))
    const want = Math.round(desired)
    let best = want, miss = Infinity
    for (let whole = 1; whole <= 12; whole++) {
        const cards = room - whole * gap
        // whole dp only: the widest that still peeks ROW_PEEK_MIN, the narrowest that peeks at most ROW_PEEK_MAX
        const lo = Math.ceil(cards / (whole + ROW_PEEK_MAX)), hi = Math.floor(cards / (whole + ROW_PEEK_MIN))
        if (hi <= 0) break
        if (lo > hi) continue
        const width = Math.min(Math.max(want, lo), hi)
        if (Math.abs(width - want) < miss) [best, miss] = [width, Math.abs(width - want)]
    }
    return best
}

/**
 * A snapping row on whole device pixels. Android takes `snapToInterval` as `(int)(dp × density)`: a step of 177dp at 3.5
 * is 619.5px, snaps every 619px and drifts half a pixel per card (the card before shows on the left after a few swipes).
 * So the step is rounded to whole pixels (the card gives up less than a pixel) and the interval sent is nudged a quarter
 * pixel up, so the cut lands on that pixel. `step` is the layout distance card to card, `snapInterval` goes to the list.
 */
export function snapRow(width: number, density: number, gap = ROW_GAP) {
    if (!(density > 0) || width <= 0) return { width: Math.max(0, width), step: Math.max(0, width) + gap, snapInterval: Math.max(0, width) + gap }
    const px = Math.max(1, Math.round((width + gap) * density))
    const step = px / density
    return { width: step - gap, step, snapInterval: (px + 0.25) / density }
}

/** The card a row stands on (`offset`, dp) with cards `step` apart: where to put it back when the step changes. */
export function snappedOffset(offset: number, oldStep: number, newStep: number) {
    if (!(offset > 0) || !(oldStep > 0) || !(newStep > 0)) return 0
    return Math.round(offset / oldStep) * newStep
}

/**
 * Room after the last card (dp, less than one step), so the end of the row is a snap position too. Without it the row
 * stops flush right and a strip of the card before shows on the left. 0 for a row that does not scroll.
 */
export function rowEndPad(count: number, step: number, viewport: number, density: number, inset = ROW_GUTTER, gap = ROW_GAP) {
    if (count <= 0 || !(step > 0) || !(viewport > 0) || !(density > 0)) return 0
    // the content: gutter, the cards a gap apart, gutter
    const overflow = Math.round((2 * inset + count * step - gap - viewport) * density)
    if (overflow <= 0) return 0
    const px = Math.max(1, Math.round(step * density))
    return (Math.ceil(overflow / px) * px - overflow) / density
}

/**
 * Where a row of `count` cards goes when its step changes from `oldStep` to `newStep` (the card size setting): on the
 * same card in the new raster, but never past the new end of the row (which rowEndPad makes a card position too), so the
 * row can tell when it got there.
 */
export function rowRestoreOffset(offset: number, oldStep: number, newStep: number, count: number, viewport: number, density: number,
    inset = ROW_GUTTER, gap = ROW_GAP) {
    const target = snappedOffset(offset, oldStep, newStep)
    if (target <= 0 || !(viewport > 0)) return target
    const end = 2 * inset + count * newStep - gap + rowEndPad(count, newStep, viewport, density, inset, gap) - viewport
    return Math.max(0, Math.min(target, end))
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
