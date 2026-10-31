import React from "react"

const WIDE_QUERY = "(min-width: 1024px)"

/** The Android app (its bridge is there from the page's first script), on a phone or a tablet of any width. */
const IN_ANDROID_APP = typeof window !== "undefined" && !!window.SeanimeAndroid

/**
 * True for the desktop panels: a browser from Tailwind's lg up. The Android app (phones and tablets) and narrow browsers
 * show Nakama as sheets with bigger touch targets instead.
 */
export function useWideScreen() {
    return React.useSyncExternalStore(
        (onChange) => {
            if (IN_ANDROID_APP) return () => {}
            const query = window.matchMedia(WIDE_QUERY)
            query.addEventListener("change", onChange)
            return () => query.removeEventListener("change", onChange)
        },
        () => !IN_ANDROID_APP && window.matchMedia(WIDE_QUERY).matches,
        () => true,
    )
}
