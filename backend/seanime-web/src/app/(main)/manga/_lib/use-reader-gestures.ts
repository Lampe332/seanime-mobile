import {
    clampGestureScale,
    clampTranslate,
    doubleTapScale,
    isDoubleTap,
    PageStep,
    pinchScale,
    settleScale,
    swipePageStep,
    TAP_MAX_MOVE,
    translateForZoom,
} from "@/app/(main)/manga/_lib/reader-gestures"
import React from "react"

type GestureOptions = {
    /** The scrolling box the fingers touch */
    containerRef: React.RefObject<HTMLElement | null>
    /** The page content inside it; zoomed and moved with a transform */
    contentRef: React.RefObject<HTMLElement | null>
    direction: string
    /** The Zoom setting of the reader sheet is not 1: the box scrolls natively, so swipes do not turn pages */
    settingZoomed: boolean
    onSwipe: (step: PageStep) => void
    /** A tap that is not part of a double tap (touch only; the mouse keeps its click) */
    onTap: (clientX: number) => void
}

const ANIMATE = "transform 180ms ease-out"
/** Elements inside the pages that handle their own taps */
const OWN_TAP_TARGETS = "#retry-button, #retry-icon, #retry-container button"

/**
 * Touch gestures for the paged reader with pointer events: one-finger swipe turns the page, pinch and double tap zoom,
 * a finger drags the page while zoomed. The mouse is left alone (it has click zones and the wheel).
 * Taps are handled here too, because a double tap must not first turn the page: a tap waits a moment for a second tap,
 * zoomed or not (the tap zones keep working while zoomed).
 */
export function useReaderGestures(options: GestureOptions) {
    const { containerRef, contentRef } = options
    const optionsRef = React.useRef(options)
    optionsRef.current = options

    const state = React.useRef({ scale: 1, x: 0, y: 0 })
    const [zoomed, setZoomed] = React.useState(false)
    const lastTouchAt = React.useRef(0)

    const apply = React.useCallback((animate: boolean) => {
        const content = contentRef.current
        if (!content) return
        const { scale, x, y } = state.current
        content.style.transition = animate ? ANIMATE : "none"
        content.style.transformOrigin = "0 0"
        content.style.transform = scale === 1 ? "" : `translate(${x}px, ${y}px) scale(${scale})`
    }, [contentRef])

    /** Back to the page as laid out (page change, chapter change) */
    const reset = React.useCallback(() => {
        state.current = { scale: 1, x: 0, y: 0 }
        apply(false)
        setZoomed(false)
    }, [apply])

    React.useEffect(() => () => reset(), [reset])

    React.useEffect(() => {
        const container = containerRef.current
        if (!container) return

        const pointers = new Map<number, { x: number, y: number }>()
        let start: { x: number, y: number, time: number } | null = null
        let moved = false
        let pinching = false
        let pinchStart = { distance: 1, scale: 1 }
        let lastFocal = { x: 0, y: 0 }
        let previousTap: { x: number, y: number, time: number } | null = null
        let tapTimer: ReturnType<typeof setTimeout> | undefined

        const rect = () => container.getBoundingClientRect()
        const content = () => contentRef.current

        const fit = () => {
            const el = content()
            const s = state.current
            if (!el) return
            s.x = clampTranslate(s.x, container.scrollLeft, el.offsetWidth, container.clientWidth, s.scale)
            s.y = clampTranslate(s.y, container.scrollTop, el.offsetHeight, container.clientHeight, s.scale)
        }

        const zoomAround = (clientX: number, clientY: number, newScale: number) => {
            const s = state.current
            const box = rect()
            const fx = clientX - box.left
            const fy = clientY - box.top
            s.x = translateForZoom(s.x, container.scrollLeft, fx, s.scale, newScale)
            s.y = translateForZoom(s.y, container.scrollTop, fy, s.scale, newScale)
            s.scale = newScale
            fit()
        }

        const finishZoomState = (animate: boolean) => {
            if (state.current.scale === 1) state.current = { scale: 1, x: 0, y: 0 }
            apply(animate)
            setZoomed(state.current.scale > 1)
        }

        const clearTapTimer = () => {
            if (tapTimer) clearTimeout(tapTimer)
            tapTimer = undefined
        }

        const onDown = (event: PointerEvent) => {
            if (event.pointerType === "mouse") return
            if ((event.target as HTMLElement | null)?.closest?.(OWN_TAP_TARGETS)) return
            lastTouchAt.current = Date.now()
            pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
            if (pointers.size === 1) {
                start = { x: event.clientX, y: event.clientY, time: event.timeStamp }
                moved = false
                pinching = false
            } else if (pointers.size === 2) {
                const [a, b] = [...pointers.values()]
                pinching = true
                moved = true
                clearTapTimer()
                previousTap = null
                pinchStart = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale: state.current.scale }
                lastFocal = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
            }
        }

        const onMove = (event: PointerEvent) => {
            const previous = pointers.get(event.pointerId)
            if (!previous) return
            const current = { x: event.clientX, y: event.clientY }
            pointers.set(event.pointerId, current)
            const s = state.current

            if (pinching && pointers.size >= 2) {
                const [a, b] = [...pointers.values()]
                const focal = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
                zoomAround(focal.x, focal.y, pinchScale(pinchStart.scale, pinchStart.distance, Math.hypot(a.x - b.x, a.y - b.y)))
                // the fingers moving together drag the page
                s.x += focal.x - lastFocal.x
                s.y += focal.y - lastFocal.y
                lastFocal = focal
                fit()
                apply(false)
                setZoomed(s.scale > 1)
                return
            }

            if (start && Math.hypot(current.x - start.x, current.y - start.y) > TAP_MAX_MOVE) moved = true
            // zoomed: the finger drags the page (also the one left over from a pinch)
            if (s.scale > 1) {
                s.x += current.x - previous.x
                s.y += current.y - previous.y
                fit()
                apply(false)
            }
        }

        const onUp = (event: PointerEvent) => {
            if (!pointers.has(event.pointerId)) return
            pointers.delete(event.pointerId)
            lastTouchAt.current = Date.now()

            if (pinching) {
                if (pointers.size === 0) {
                    pinching = false
                    state.current.scale = settleScale(state.current.scale)
                    finishZoomState(true)
                    start = null
                } else if (pointers.size === 1) {
                    // one finger stays: it carries on dragging, never as a tap or swipe
                    start = null
                }
                return
            }

            const began = start
            start = null
            if (!began || pointers.size > 0) return
            const opts = optionsRef.current
            const s = state.current

            if (moved) {
                const step = opts.settingZoomed ? null : swipePageStep(
                    { dx: event.clientX - began.x, dy: event.clientY - began.y, durationMs: event.timeStamp - began.time },
                    opts.direction,
                    s.scale,
                )
                if (step) opts.onSwipe(step)
                return
            }

            // a tap
            const tap = { x: event.clientX, y: event.clientY, time: event.timeStamp }
            if (isDoubleTap(previousTap, tap)) {
                clearTapTimer()
                previousTap = null
                const target = clampGestureScale(doubleTapScale(s.scale))
                if (target === 1) state.current = { scale: 1, x: 0, y: 0 }
                else zoomAround(tap.x, tap.y, target)
                finishZoomState(true)
                return
            }
            previousTap = tap
            clearTapTimer()
            tapTimer = setTimeout(() => {
                tapTimer = undefined
                previousTap = null
                optionsRef.current.onTap(tap.x)
            }, 280)
        }

        const onCancel = (event: PointerEvent) => {
            pointers.delete(event.pointerId)
            if (pointers.size === 0) {
                pinching = false
                start = null
                // the browser took the touch over (a vertical scroll); no tap, no swipe
                finishZoomState(false)
            }
        }

        container.addEventListener("pointerdown", onDown)
        container.addEventListener("pointermove", onMove)
        container.addEventListener("pointerup", onUp)
        container.addEventListener("pointercancel", onCancel)
        return () => {
            clearTapTimer()
            container.removeEventListener("pointerdown", onDown)
            container.removeEventListener("pointermove", onMove)
            container.removeEventListener("pointerup", onUp)
            container.removeEventListener("pointercancel", onCancel)
        }
    }, [containerRef, contentRef, apply])

    /** True for the click the browser sends after a touch the gestures already handled */
    const shouldIgnoreClick = React.useCallback(() => Date.now() - lastTouchAt.current < 800, [])

    return { zoomed, reset, shouldIgnoreClick }
}
