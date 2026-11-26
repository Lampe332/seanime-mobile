/*
 * Layout arithmetic of a settings page (settings-page.tsx): how wide its column gets, which jump chip is active for the
 * scroll position, and where the chip row scrolls so the active chip stays in view.
 */

/** The phone's column: at the reading width (832) a switch sat ~750dp from its label */
export const SETTINGS_COLUMN_WIDTH = 640
/** A tablet's column fills its room up to this width and is centred beyond it (Pixel Tablet: "rechts ist noch Platz") */
export const SETTINGS_WIDE_COLUMN_WIDTH = 960

export function settingsColumnMaxWidth(tablet: boolean): number {
    return tablet ? SETTINGS_WIDE_COLUMN_WIDTH : SETTINGS_COLUMN_WIDTH
}

/** A group counts as the current one once its top is this far under the top edge of the rows (a jump puts it 4dp under) */
export const JUMP_ACTIVE_LINE = 32

/**
 * How close to the end of the rows counts as the end: the offset a fling settles on is a fraction of a pixel short of
 * the content's end on a 3.5x screen (S22: "Matching" stayed unlit at the bottom)
 */
export const JUMP_END_SLACK = 2

/**
 * The index of the group shown at the top: the last one whose top passed the line. At the end of the rows the last group
 * is current, also when it is too short to reach the top. `tops` are content offsets in the order of the chips.
 */
export function activeJumpIndex({ tops, scrollY, viewportHeight, contentHeight, line = JUMP_ACTIVE_LINE }: {
    tops: readonly number[]
    scrollY: number
    viewportHeight: number
    contentHeight: number
    line?: number
}): number {
    if (tops.length === 0) return -1
    if (scrollY > 0 && viewportHeight > 0 && scrollY + viewportHeight >= contentHeight - JUMP_END_SLACK) return tops.length - 1
    let active = 0
    for (let i = 0; i < tops.length; i++) {
        if (tops[i] <= scrollY + line) active = i
        else break
    }
    return active
}

/** What a scroll event of the rows says about them; every event carries the sizes of that moment, not of the last layout */
export interface JumpScrollEvent {
    contentOffset: { y: number }
    layoutMeasurement: { height: number }
    contentSize: { height: number }
}

/**
 * The rows' scroll state for activeJumpIndex from a scroll, drag-end or momentum-end event. The page reads it at each of
 * them: onScroll is throttled, so its last event can come before a fling settles at the end.
 */
export function jumpScrollMetrics(event: JumpScrollEvent): { scrollY: number, viewportHeight: number, contentHeight: number } {
    return { scrollY: event.contentOffset.y, viewportHeight: event.layoutMeasurement.height, contentHeight: event.contentSize.height }
}

/**
 * The chip lit after a search jump: the hit's group, which the jump puts a third down (under the line the previous group
 * still holds), or none when the group has no chip. It stays lit until the next drag.
 */
export function focusChipId(chipIds: readonly string[], group: string | undefined): string | null {
    return group !== undefined && chipIds.includes(group) ? group : null
}

/**
 * The room the rows keep on the right while the tablet's mini player card floats over the page's bottom right: the card
 * covered the values at the right end of the rows (Pixel Tablet). `maxWidth` is the centred column's, none for the pane.
 */
export function miniCardRightPad({ frameX, frameWidth, maxWidth, windowWidth, card }: {
    frameX: number
    frameWidth: number
    maxWidth?: number
    windowWidth: number
    card: { right: number, width: number } | null
}): number {
    if (!card || frameWidth <= 0) return 0
    const columnRight = frameX + frameWidth - (maxWidth === undefined ? 0 : Math.max(0, (frameWidth - maxWidth) / 2))
    const overlap = columnRight - (windowWidth - card.right - card.width)
    return overlap > 0 ? Math.round(overlap + 16) : 0
}

/** The sheet of all options is as tall as its options, at most this share of the screen; past it its options scroll */
export const PICKER_MAX_SHARE = 0.85

/**
 * The most the options may take: the share less the sheet's own parts (sheet.tsx: 20dp on top, the 25dp title, about two
 * lines of note, 16dp to the body, the reset button's ~76dp foot, 12dp under it). The tablet's side sheet runs the full
 * height and already bounds its body to that room: there the options take no bound of their own (undefined), else they
 * ended ~290px above its bottom.
 */
export function pickerListMaxHeight({ windowHeight, hasNote, hasFooter, sideSheet = false }: {
    windowHeight: number
    hasNote: boolean
    hasFooter: boolean
    sideSheet?: boolean
}): number | undefined {
    if (sideSheet) return undefined
    const chrome = 20 + 25 + (hasNote ? 44 : 0) + 16 + (hasFooter ? 76 : 0) + 12
    return Math.max(160, Math.round(windowHeight * PICKER_MAX_SHARE - chrome))
}

/** The chip row's offset that centres a chip, kept within the row's scroll range */
export function chipRowOffset({ chipX, chipWidth, rowWidth, contentWidth }: {
    chipX: number
    chipWidth: number
    rowWidth: number
    contentWidth: number
}): number {
    const max = Math.max(0, contentWidth - rowWidth)
    return Math.min(max, Math.max(0, chipX + chipWidth / 2 - rowWidth / 2))
}
