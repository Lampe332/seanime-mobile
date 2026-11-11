/**
 * How far from the bottom edge a sheet or dialog stays. The app draws edge to edge, so Android no longer shrinks the window
 * for the keyboard (the old WebView did): while the keyboard is up the sheet sits on it, else above the bottom inset.
 * Device run 06.11. (S22): a text sheet stayed behind the keyboard and the field was typed blind.
 */
export function bottomClearance(keyboardHeight: number, insetBottom: number): number {
    return keyboardHeight > 0 ? Math.max(keyboardHeight, insetBottom) : insetBottom
}

/**
 * A phone sheet's tallest size: `max-height: calc(100svh - 16px)` above its 8px bottom margin (phone-screen.css `.ps-sheet`,
 * mobile-anime.css `.mobile-anime-dialog`). 2.0.32 draws over the camera cutout, so the top inset is not taken off
 * (S22: a long sheet started 35dp lower than 2.0.32's – the cutout's 27dp plus 8dp the compact head did not use).
 */
export function phoneSheetMaxHeight(windowHeight: number, bottom: number): number {
    return windowHeight - bottom - 16
}

/**
 * Room above a sheet's pinned footer. 2.0.32 has its actions as the body's last grid item (`.ps-sheet-actions` in
 * `.ps-sheet-body`, `.mex-sheet-actions` in `.mex-sheet-body`): the body gap (1.25rem, 1rem when dense) plus their own
 * .75rem padding. The entry page's compact sheets have `.mobile-download-footer` (.75rem gap + .5rem padding).
 * The body itself ends with its last block; the sheet's 12dp padding follows (S22 10.11.: 8dp more below every body).
 */
export function sheetFooterTop({ compact, dense }: { compact?: boolean, dense?: boolean }): number {
    return compact ? 20 : (dense ? 16 : 20) + 12
}

/**
 * The scrolling body's own max height in a sheet of `sheetMax`: less the sheet's top padding, its 12dp bottom padding,
 * the head, the gap under the head and a pinned footer, at least 120dp.
 */
export function sheetBodyMaxHeight({ sheetMax, topPadding, headHeight, headGap, footHeight }: {
    sheetMax: number, topPadding: number, headHeight: number, headGap: number, footHeight: number
}): number {
    return Math.max(120, sheetMax - topPadding - 12 - headHeight - headGap - footHeight)
}
