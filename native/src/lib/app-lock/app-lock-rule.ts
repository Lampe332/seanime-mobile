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

/** The app behind the cover (client-providers.tsx): nothing in it for the screen reader while locked (Android and iOS) */
export function appContentAccessibility(locked: boolean) {
    return locked
        ? { importantForAccessibility: "no-hide-descendants", accessibilityElementsHidden: true } as const
        : { importantForAccessibility: "auto", accessibilityElementsHidden: false } as const
}
