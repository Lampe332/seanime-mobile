// geschrieben nach: Befund S-scan #5 (15.11.2026), core/extensions/manage/manage.ts (`checkForUpdates`, `lastUpdateData`) und dem App-Typ ExtensionRepo_UpdateData

/*
 * Extension updates without the manual button: the core checks the installed extensions' manifests when the extension
 * list is asked with `withUpdates` (POST /extensions/all) and keeps the result for GET /extensions/updates. The app asks
 * for that check when the Extensions screen opens and at most once a day at start; the Menu's "Extensions" row shows
 * the count, the bar's or rail's entry (or the Menu button, when Extensions is in the Menu) a dot.
 */

/** At start the update check runs at most this often. */
export const UPDATE_CHECK_EVERY_MS = 24 * 60 * 60 * 1000

/** Never checked, a day gone, or a clock set back: check now. */
export function isUpdateCheckDue(lastCheckedAt: number | null | undefined, now: number): boolean {
    if (typeof lastCheckedAt !== "number" || !Number.isFinite(lastCheckedAt) || lastCheckedAt <= 0) return true
    return now - lastCheckedAt >= UPDATE_CHECK_EVERY_MS || now < lastCheckedAt
}

/** The extensions with an update the core found last (`null` = not checked yet: 0) */
export function extensionUpdateCount(updates: readonly { extensionID?: string | null }[] | null | undefined): number {
    return new Set((updates ?? []).map(update => update.extensionID).filter(Boolean)).size
}

/** Where the update mark goes: the count on the Menu row, a dot on the bar/rail entry, else on the Menu button. */
export function updateDotOn(item: { href?: string | null, isMenu?: boolean }, count: number, extensionsInBar: boolean): boolean {
    if (count <= 0) return false
    if (item.href === "/extensions") return true
    return !!item.isMenu && !extensionsInBar
}
