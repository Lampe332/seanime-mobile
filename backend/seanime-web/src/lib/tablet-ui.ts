import React from "react"

/**
 * Tablet layout: the Android app on a screen whose smaller side is 600 CSS px or more (the Android sw600dp rule) shows the
 * phone screens laid out for a tablet (app/tablet.css under html[data-layout="tablet"]). Decided at page load from the
 * screen, not the window, so a split-screen window keeps the tablet rules (they fall back to the phone bar below 600px).
 * The native side uses the same rule (UIBottomNav.kt, UIDiscoverPatch.kt, VideoControlInjector.kt).
 */
export const IS_TABLET_UI = import.meta.env.SEA_PUBLIC_PLATFORM === "mobile" && typeof window !== "undefined" && isTabletScreen()

function isTabletScreen() {
    return Math.min(window.screen.width, window.screen.height) >= 600
}

/**
 * A screen that changes between phone and tablet size while the app runs (a foldable opened or closed) reloads the page,
 * so the web app and the native injections (run on every page load) decide again; the route stays. The activity handles
 * size changes itself, so nothing else reloads it. A playing video is not cut off: the reload waits until it pauses.
 */
export function reloadOnScreenClassChange() {
    if (import.meta.env.SEA_PUBLIC_PLATFORM !== "mobile") return
    const check = () => {
        if (isTabletScreen() === IS_TABLET_UI) return
        if (Array.from(document.querySelectorAll("video")).some(video => !video.paused && !video.ended)) return
        window.location.reload()
    }
    // the screen size can follow the resize event, so look again a moment later
    window.addEventListener("resize", () => { check(); window.setTimeout(check, 500) })
    // media events do not bubble; capturing on the document sees every video's pause
    document.addEventListener("pause", check, true)
}

/** Phone width the tablet layout lays out against, so every breakpoint picks the phone layout. */
const PHONE_LAYOUT_WIDTH = 430

/** Viewport width for layout breakpoints. The tablet layout always reports a phone width. */
export function layoutWidth<T extends number | null | undefined>(width: T): T {
    return (IS_TABLET_UI && typeof width === "number" ? Math.min(width, PHONE_LAYOUT_WIDTH) : width) as T
}

/** Width from which the tablet layout shows a list and its open item side by side (matches app/tablet.css). */
const TWO_PANES = "(min-width: 720px)"

/** Whether the tablet layout has room for two panes right now (a split-screen window may not); always false on phones. */
export function useTabletTwoPanes() {
    return React.useSyncExternalStore(
        onChange => {
            if (!IS_TABLET_UI) return () => {}
            const query = window.matchMedia(TWO_PANES)
            query.addEventListener("change", onChange)
            return () => query.removeEventListener("change", onChange)
        },
        () => IS_TABLET_UI && window.matchMedia(TWO_PANES).matches,
        () => false,
    )
}
