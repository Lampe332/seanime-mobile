/**
 * Touch feedback through the Android app (Feedback.kt), kept for moments that deserve it: a switch, a long press, a jump,
 * an error. The app follows Android's touch-feedback setting and the switches in Settings → App → Feedback; outside the
 * app these do nothing.
 */
export type HapticKind = "tick" | "long" | "confirm" | "reject"

export function haptic(kind: HapticKind) {
    try { window.SeanimeAndroid?.haptic?.(kind) } catch { /* Older app builds have no bridge method. */ }
}

// Every switch of the app (settings, sheets, the reader, Home's sections) ticks when it is flipped.
if (typeof document !== "undefined") {
    document.addEventListener("click", event => {
        if ((event.target as Element | null)?.closest?.("[role=\"switch\"]:not(:disabled)")) haptic("tick")
    }, true)
}

/** A finished action the user waited for (download queued, episode marked as watched, watch party joined): a confirming tick and the quiet success sound. */
export function successFeedback() {
    haptic("confirm")
    try { window.SeanimeAndroid?.playSound?.("success") } catch { /* Older app builds have no bridge method. */ }
}
