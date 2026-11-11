/**
 * Pure rules of the touch feedback (Feedback.kt companion), kept apart from the native calls so they can be tested.
 * The values are expo-haptics' AndroidHaptics strings (View.performHapticFeedback constants on the native side).
 */
export type HapticKind = "tick" | "long" | "confirm" | "reject"

export type AndroidHapticType = "clock-tick" | "long-press" | "confirm" | "reject" | "virtual-key"

/** Android 11 (API 30) brought CONFIRM and REJECT. */
const ANDROID_R = 30

/** The haptic for a kind, or null for an unknown kind; [sdk] guards the API 30 ones. */
export function hapticType(kind: string, sdk: number): AndroidHapticType | null {
    switch (kind) {
        case "tick":
            return "clock-tick"
        case "long":
            return "long-press"
        case "confirm":
            return sdk >= ANDROID_R ? "confirm" : "virtual-key"
        case "reject":
            return sdk >= ANDROID_R ? "reject" : "long-press"
        default:
            return null
    }
}

/** AudioManager.RINGER_MODE_* */
export const RINGER_MODE_SILENT = 0
export const RINGER_MODE_VIBRATE = 1
export const RINGER_MODE_NORMAL = 2

/** Sounds only when the ringer is on and nothing else (the player, music) is audible. */
export function soundAllowed(enabled: boolean, ringerMode: number, musicActive: boolean): boolean {
    return enabled && ringerMode === RINGER_MODE_NORMAL && !musicActive
}
