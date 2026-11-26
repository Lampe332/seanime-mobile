/*
 * When the app lock (settings → App → App lock) covers the app: at a cold start, and when the app comes back after more
 * than a minute away. Pure, so the traps below are tested (app-lock-rule.test.ts):
 * - The device lock's own prompt sends the app to "background" on Android (the screen PIN is an activity of its own).
 *   That trip is not leaving the app: while a prompt is open "hidden" is ignored, so unlocking cannot lock again.
 * - Picture in picture puts the app in "background" while its video still plays on top: that is still using the app.
 *   The minute starts only when the picture closes while the app is away.
 * - A device whose lock was removed after the switch was turned on unlocks without a prompt (lib/device-lock.ts
 *   confirmWithDeviceLock answers true, device-lock.test.ts).
 */

/** How long the app may stay in the background before it locks */
export const APP_LOCK_AFTER_MS = 60_000

export type AppLockState = {
    locked: boolean
    /** When the app went away; null while it is in front, plays in picture in picture or shows the device lock's prompt */
    hiddenSince: number | null
    pictureInPicture: boolean
    prompting: boolean
}

export type AppLockEvent =
    | { type: "hidden", now: number }
    | { type: "shown", now: number, enabled: boolean }
    | { type: "pictureInPicture", active: boolean, now: number, appActive: boolean }
    | { type: "prompt", open: boolean, now: number, appActive: boolean }
    | { type: "unlock" }

/** The state at a cold start: locked when the switch is on */
export function initialAppLockState(enabled: boolean): AppLockState {
    return { locked: enabled, hiddenSince: null, pictureInPicture: false, prompting: false }
}

export function appLockReducer(state: AppLockState, event: AppLockEvent): AppLockState {
    switch (event.type) {
        case "hidden":
            if (state.prompting || state.pictureInPicture || state.hiddenSince !== null) return state
            return { ...state, hiddenSince: event.now }
        case "shown": {
            const away = state.hiddenSince !== null && !state.pictureInPicture && event.now - state.hiddenSince > APP_LOCK_AFTER_MS
            return { ...state, locked: state.locked || (event.enabled && away), hiddenSince: null }
        }
        case "pictureInPicture":
            // closing the picture while the app is away starts the minute; opening or expanding it is using the app
            return { ...state, pictureInPicture: event.active, hiddenSince: !event.active && !event.appActive ? event.now : null }
        case "prompt":
            if (event.open) return { ...state, prompting: true }
            // a prompt that ends while the app is away (the user left during it): the minute starts now
            return { ...state, prompting: false, hiddenSince: event.appActive ? null : event.now }
        case "unlock":
            return { ...state, locked: false }
    }
}

/**
 * Whether the recent apps screen may show no picture of the app (modules/app-lock-recents): for as long as the switch is
 * on, not only while locked, because the picture is taken as the app leaves, a minute before the cover comes up.
 */
export function appLockHidesRecents(enabled: boolean, locked: boolean): boolean {
    return enabled || locked
}

/**
 * The app behind the cover (client-providers.tsx): nothing in it for accessibility services while locked.
 * - Android: "no-hide-descendants" only marks views unimportant; a service asking for those too (uiautomator dump's
 *   default, many automation tools) still read the whole page through the opaque cover. `display: none` makes the views
 *   INVISIBLE (Fabric SurfaceMountingManager: displayType 0), which takes them out of the tree, while they stay mounted
 *   (useTraitHiddenOnAndroid is off), so the player, pages and their state are kept.
 * - iOS: display none would unmount the native views there (Fabric's Hidden trait); hidden elements plus the cover's
 *   accessibilityViewIsModal keep VoiceOver on the cover.
 * - collapsable false: the wrapper is always a native view, so locking does not reparent the whole app into a new one
 *   (a plain flex view is flattened away while unlocked).
 */
export function appContentAccessibility(locked: boolean, os: string) {
    return locked
        ? {
            importantForAccessibility: "no-hide-descendants",
            accessibilityElementsHidden: true,
            collapsable: false,
            style: { flex: 1, display: os === "android" ? "none" : "flex" },
        } as const
        : { importantForAccessibility: "auto", accessibilityElementsHidden: false, collapsable: false, style: { flex: 1, display: "flex" } } as const
}
