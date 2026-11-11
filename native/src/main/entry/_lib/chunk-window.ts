/*
 * Long episode lists inside the anime page's scroll view (onlinestream-page.tsx): the rows come in chunks and only the
 * chunks near the screen are drawn, the others are spacers of the same height (windowed-rows.tsx). A FlashList cannot
 * window there – it would sit in the page's ScrollView without a height of its own and draw every row.
 */

export type ChunkSize = { height: number, rows: number }

/** The height of an average row: from the chunks drawn so far, `fallback` before any */
export function rowEstimate(measured: Iterable<ChunkSize>, fallback: number): number {
    let height = 0
    let rows = 0
    for (const chunk of measured) {
        height += chunk.height
        rows += chunk.rows
    }
    return rows > 0 ? height / rows : fallback
}

/**
 * First and last chunk to draw: those reaching into `from`..`to` (dp from the list's top; may be negative or past
 * the end). Always at least one chunk while there are any.
 */
export function chunkRange(heights: readonly number[], from: number, to: number): [number, number] {
    if (!heights.length) return [0, -1]
    let first = -1
    let last = -1
    let top = 0
    for (let i = 0; i < heights.length; i++) {
        const bottom = top + heights[i]
        if (bottom > from && top < to) {
            if (first < 0) first = i
            last = i
        }
        top = bottom
    }
    if (first < 0) {
        // the list lies wholly above or below the window: keep the chunk nearest to it
        const nearest = to <= 0 ? 0 : heights.length - 1
        return [nearest, nearest]
    }
    return [first, last]
}

/**
 * The chunks to draw next (r19): all of `want` plus what was drawn before, as long as it stays within `keep`. Scrolling
 * back and forth then finds the chunks still drawn instead of building them and their images again; only those that
 * left the far `keep` window give way to spacers.
 */
export function holdRange(prev: readonly [number, number], want: readonly [number, number], keep: readonly [number, number]): [number, number] {
    if (want[1] < want[0]) return [want[0], want[1]]
    if (prev[1] < prev[0]) return [want[0], want[1]]
    return [Math.max(keep[0], Math.min(prev[0], want[0])), Math.min(keep[1], Math.max(prev[1], want[1]))]
}
