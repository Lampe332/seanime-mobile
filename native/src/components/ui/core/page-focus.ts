import React from "react"

/*
 * Every main screen stays mounted under the one in front (renderPage, page-transition.tsx). A text field that kept the
 * focus there kept the keyboard too: Android brought it back up on the next page at a tap, a swipe or a sheet closing,
 * with the old text in its suggestions, the letters went into the hidden field, and the first swipe only closed the
 * keyboard instead of scrolling (4.2.0 E, Pixel Tablet: "Nyaa" from the extension search on Settings and the anime page).
 * So a field lets go of the focus when its page is left. Each field lets go of its own focus only: a field the next page
 * focuses as it comes in (Search opened by the magnifier) keeps it.
 */

/** Whether the page a component sits on is the one in front; true off a page (a sheet in the portal, the player) */
export const PageFocusContext = React.createContext(true)

type Blurrable = { blur(): void } | null | undefined

/** Blurs the field when its page is no longer in front (RN's blur() acts only on the field that has the focus) */
export function releaseIfLeft(pageInFront: boolean, field: Blurrable) {
    if (!pageInFront) field?.blur()
}

/** A text field on a page lets go of the focus (and the keyboard) once the page is left */
export function useReleaseFocusOnLeave(ref: React.RefObject<Blurrable>) {
    const inFront = React.useContext(PageFocusContext)
    React.useEffect(() => releaseIfLeft(inFront, ref.current), [inFront, ref])
}
