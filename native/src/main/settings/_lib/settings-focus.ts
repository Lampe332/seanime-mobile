import type { SettingsSearchDoc } from "@/main/settings/_lib/settings-search"

/**
 * What a search hit opens the page on: the group by its title and the row by its names, all as the page shows them. A
 * new `nonce` runs the jump again (the same hit tapped twice on a tablet).
 */
export type SettingsPageFocus = { group?: string, labels?: readonly string[], sheet?: string, nonce: number }

/** The focus a tapped hit opens its area on; the nonce counts up so the same hit runs again */
export function focusFromHit(hit: SettingsSearchDoc, previous: { nonce: number } | null): SettingsPageFocus & { section: SettingsSearchDoc["section"] } {
    return { section: hit.section, group: hit.group, labels: hit.labels, ...(hit.sheet ? { sheet: hit.sheet } : null), nonce: (previous?.nonce ?? 0) + 1 }
}

/** The hit's row is this one: its label, and its group when both sides know one (two groups may hold a row of one name) */
export function isFocusedRow(focus: SettingsPageFocus | null | undefined, label: string, group: string | undefined): boolean {
    if (!focus?.labels?.includes(label)) return false
    return focus.group === undefined || group === undefined || focus.group === group
}

/** The hit's nonce when its row stands in this sheet, so the sheet's control opens it; else null */
export function sheetFocusNonce(focus: SettingsPageFocus | null | undefined, sheet: string, group: string | undefined): number | null {
    if (!focus || focus.sheet !== sheet) return null
    if (focus.group !== undefined && group !== undefined && focus.group !== group) return null
    return focus.nonce
}

/** A row of a sheet is scrolled by the sheet's body; the page only scrolls rows of its own */
export function revealsInSheet(focus: SettingsPageFocus, inSheet: boolean): boolean {
    return !!focus.sheet && inSheet
}

/** How the glow runs: lit until the row has been in sight a while, then out; Reduce Motion keeps the tint, without the fades */
export const ROW_GLOW = { fadeInMs: 220, holdMs: 1100, fadeOutMs: 500, pollMs: 90, maxPolls: 18 } as const

/** The row stands still in the window (the page's or the sheet's scroll is done) and some of it is in sight */
export function rowSettled(previousY: number | undefined, y: number, height: number, windowHeight: number) {
    return previousY !== undefined && Math.abs(y - previousY) < 1 && height > 0 && y + height > 0 && y < windowHeight
}
