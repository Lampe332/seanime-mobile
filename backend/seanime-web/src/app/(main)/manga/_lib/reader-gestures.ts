import { MangaReadingDirection } from "@/app/(main)/manga/_lib/manga-chapter-reader.atoms"

/** Pure math of the page reader's touch gestures (swipe, pinch, double tap). The pointer wiring lives in use-reader-gestures.ts. */

/** Zoom range of the pinch gesture; 1 is the page as laid out. (The Zoom setting in the reader sheet is separate.) */
export const GESTURE_ZOOM_MIN = 1
export const GESTURE_ZOOM_MAX = 4
/** Scale a double tap zooms to */
export const DOUBLE_TAP_ZOOM = 2.5
/** Below this a finished pinch snaps back to 1 */
const GESTURE_ZOOM_SNAP = 1.08

export const SWIPE_MIN_DISTANCE = 56
export const SWIPE_MAX_DURATION_MS = 700
/** A swipe must be clearly more horizontal than vertical */
const SWIPE_HORIZONTAL_RATIO = 1.5

export const TAP_MAX_MOVE = 12
export const DOUBLE_TAP_MAX_GAP_MS = 280
export const DOUBLE_TAP_MAX_DISTANCE = 40

export type PageStep = "next" | "previous"

/**
 * Which way a finished one-finger swipe turns the page (null when it is no swipe or the page is zoomed).
 * Swiping toward the left edge reads on in left-to-right books; right-to-left books read on swiping to the right.
 */
export function swipePageStep(
    swipe: { dx: number, dy: number, durationMs: number },
    direction: string,
    scale: number,
): PageStep | null {
    if (scale > 1) return null
    const { dx, dy, durationMs } = swipe
    if (durationMs > SWIPE_MAX_DURATION_MS) return null
    if (Math.abs(dx) < SWIPE_MIN_DISTANCE) return null
    if (Math.abs(dx) < Math.abs(dy) * SWIPE_HORIZONTAL_RATIO) return null
    const towardLeft = dx < 0
    return (direction === MangaReadingDirection.RTL ? !towardLeft : towardLeft) ? "next" : "previous"
}

/** The tap-zone side ("left" or "right") that turns the page the given way; the same names the reader's onPaginate takes. */
export function pageStepToSide(step: PageStep, direction: string): "left" | "right" {
    const next = step === "next"
    return (direction === MangaReadingDirection.RTL ? !next : next) ? "right" : "left"
}

export function clampGestureScale(scale: number) {
    if (!Number.isFinite(scale)) return GESTURE_ZOOM_MIN
    return Math.min(GESTURE_ZOOM_MAX, Math.max(GESTURE_ZOOM_MIN, scale))
}

/** The scale after a pinch: the start scale times how far the fingers moved apart. */
export function pinchScale(startScale: number, startDistance: number, distance: number) {
    if (!(startDistance > 0)) return clampGestureScale(startScale)
    return clampGestureScale(startScale * (distance / startDistance))
}

/** A finished pinch that stays almost at 1 snaps back to exactly 1. */
export function settleScale(scale: number) {
    return scale < GESTURE_ZOOM_SNAP ? GESTURE_ZOOM_MIN : scale
}

/**
 * Limits one axis of the translation of the zoomed content (transform-origin top left, scaled by `scale`).
 * `scroll` is how far the viewport is scrolled over the content; content smaller than the viewport is centered.
 */
export function clampTranslate(translate: number, scroll: number, contentSize: number, viewportSize: number, scale: number) {
    const lowest = viewportSize - contentSize * scale + scroll
    const highest = scroll
    if (lowest >= highest) return (lowest + highest) / 2
    return Math.min(highest, Math.max(lowest, translate))
}

/** The translation that keeps the content point under `focal` (viewport coordinates) in place while the scale changes. */
export function translateForZoom(translate: number, scroll: number, focal: number, oldScale: number, newScale: number) {
    return focal + scroll - (focal + scroll - translate) * (newScale / oldScale)
}

/** Where a double tap goes: back to 1 when zoomed, else to DOUBLE_TAP_ZOOM. */
export function doubleTapScale(scale: number) {
    return scale > 1 ? GESTURE_ZOOM_MIN : DOUBLE_TAP_ZOOM
}

/** Whether a tap follows the previous one closely enough in time and place to be a double tap. */
export function isDoubleTap(
    previous: { x: number, y: number, time: number } | null,
    tap: { x: number, y: number, time: number },
) {
    if (!previous) return false
    if (tap.time - previous.time > DOUBLE_TAP_MAX_GAP_MS) return false
    return Math.hypot(tap.x - previous.x, tap.y - previous.y) <= DOUBLE_TAP_MAX_DISTANCE
}
