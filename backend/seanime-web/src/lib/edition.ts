import React from "react"

/** Tablet edition: an Android build that keeps the phone UI on tablet screens (SEA_PUBLIC_EDITION=tablet). */
export const IS_TABLET_EDITION = import.meta.env.SEA_PUBLIC_PLATFORM === "mobile" && import.meta.env.SEA_PUBLIC_EDITION === "tablet"

/** Phone width the tablet edition lays out against, so every breakpoint picks the phone layout. */
const PHONE_LAYOUT_WIDTH = 430

/** Viewport width for layout breakpoints. The tablet edition always reports a phone width. */
export function layoutWidth<T extends number | null | undefined>(width: T): T {
    return (IS_TABLET_EDITION && typeof width === "number" ? Math.min(width, PHONE_LAYOUT_WIDTH) : width) as T
}

/** Width from which the tablet edition shows a list and its open item side by side (matches app/tablet.css). */
const TWO_PANES = "(min-width: 720px)"

/** Whether the tablet edition has room for two panes right now (a split-screen window may not); always false on phones. */
export function useTabletTwoPanes() {
    return React.useSyncExternalStore(
        onChange => {
            if (!IS_TABLET_EDITION) return () => {}
            const query = window.matchMedia(TWO_PANES)
            query.addEventListener("change", onChange)
            return () => query.removeEventListener("change", onChange)
        },
        () => IS_TABLET_EDITION && window.matchMedia(TWO_PANES).matches,
        () => false,
    )
}
