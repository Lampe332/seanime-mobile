/** Tablet edition: an Android build that keeps the phone UI on tablet screens (SEA_PUBLIC_EDITION=tablet). */
export const IS_TABLET_EDITION = import.meta.env.SEA_PUBLIC_PLATFORM === "mobile" && import.meta.env.SEA_PUBLIC_EDITION === "tablet"

/** Phone width the tablet edition lays out against, so every breakpoint picks the phone layout. */
const PHONE_LAYOUT_WIDTH = 430

/** Viewport width for layout breakpoints. The tablet edition always reports a phone width. */
export function layoutWidth<T extends number | null | undefined>(width: T): T {
    return (IS_TABLET_EDITION && typeof width === "number" ? Math.min(width, PHONE_LAYOUT_WIDTH) : width) as T
}
