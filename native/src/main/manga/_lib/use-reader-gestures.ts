import {
    clampGestureScale,
    clampTranslate,
    doubleTapScale,
    isDoubleTap,
    type PageStep,
    pinchScale,
    settleScale,
    swipePageStep,
    TAP_MAX_MOVE,
    translateForZoom,
} from "@/main/manga/_lib/reader-gestures"
import React from "react"
import type { GestureResponderEvent, GestureResponderHandlers, NativeTouchEvent } from "react-native"
import { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated"

/*
 * Touch gestures of the paged reader (use-reader-gestures.ts), on the responder system instead of DOM pointer events, with
 * the same rules from reader-gestures.ts: a one-finger swipe turns the page, pinch and double tap zoom, a finger drags the
 * zoomed page. A tap waits 280ms for a second one, so a double tap never turns the page first; the tap zones keep working
 * while zoomed. When the scroll view takes a touch over (a vertical scroll of a tall page), it is neither tap nor swipe.
 */

type GestureOptions = {
    direction: string
    /** the Zoom setting of the reader sheet is not 1: the page scrolls itself, so swipes do not turn pages */
    settingZoomed: boolean
    onSwipe: (step: PageStep) => void
    /** a tap that is not part of a double tap, at x within the reader */
    onTap: (x: number) => void
}

/** The reader box (its place on the screen and size) and its content, measured by the reader; the scroll offsets while it scrolls. */
export type GestureFrame = { left: number, top: number, width: number, height: number, contentWidth: number, contentHeight: number, scrollX: number, scrollY: number }

type Point = { x: number, y: number }

/** What one touch sequence remembers between its events */
type TouchState = {
    start: (Point & { time: number }) | null
    last: Map<string, Point>
    moved: boolean
    pinching: boolean
    pinchStart: { distance: number, scale: number }
    lastFocal: Point
    previousTap: (Point & { time: number }) | null
    tapTimer: ReturnType<typeof setTimeout> | undefined
}

const ANIMATE_MS = 180

export function useReaderGestures(options: GestureOptions) {
    const optionsRef = React.useRef(options)
    React.useEffect(() => {
        optionsRef.current = options
    })
    const frame = React.useRef<GestureFrame>({ left: 0, top: 0, width: 0, height: 0, contentWidth: 0, contentHeight: 0, scrollX: 0, scrollY: 0 })
    const state = React.useRef({ scale: 1, x: 0, y: 0 })
    const touch = React.useRef<TouchState>({
        start: null, last: new Map(), moved: false, pinching: false, pinchStart: { distance: 1, scale: 1 }, lastFocal: { x: 0, y: 0 }, previousTap: null, tapTimer: undefined,
    })
    const [zoomed, setZoomed] = React.useState(false)

    const scale = useSharedValue(1)
    const tx = useSharedValue(0)
    const ty = useSharedValue(0)
    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: tx.get() }, { translateY: ty.get() }, { scale: scale.get() }],
    }))

    const apply = React.useCallback((animate: boolean) => {
        const { scale: s, x, y } = state.current
        const timing = { duration: ANIMATE_MS, easing: Easing.out(Easing.quad) }
        scale.set(animate ? withTiming(s, timing) : s)
        tx.set(animate ? withTiming(x, timing) : x)
        ty.set(animate ? withTiming(y, timing) : y)
    }, [scale, tx, ty])

    /** back to the page as laid out (page or chapter change) */
    const reset = React.useCallback(() => {
        state.current = { scale: 1, x: 0, y: 0 }
        apply(false)
        setZoomed(false)
    }, [apply])

    /** the reader reports its box, content size and scroll offsets */
    const updateFrame = React.useCallback((patch: Partial<GestureFrame>) => {
        Object.assign(frame.current, patch)
    }, [])

    React.useEffect(() => () => {
        const timer = touch.current.tapTimer
        if (timer) clearTimeout(timer)
    }, [])

    const handlers = React.useMemo<GestureResponderHandlers>(() => {
        const g = () => touch.current
        // A touch's place in the reader box (the web's clientX - box.left): its screen position less the box's;
        // locationX would be relative to whichever page or button the finger is on
        const at = (t: { pageX: number, pageY: number }) => ({ x: t.pageX - frame.current.left, y: t.pageY - frame.current.top })
        const points = (touches: readonly NativeTouchEvent[]) => new Map(touches.map(t => [String(t.identifier), at(t)]))
        const fit = () => {
            const f = frame.current
            const s = state.current
            s.x = clampTranslate(s.x, f.scrollX, f.contentWidth, f.width, s.scale)
            s.y = clampTranslate(s.y, f.scrollY, f.contentHeight, f.height, s.scale)
        }
        const zoomAround = (fx: number, fy: number, newScale: number) => {
            const s = state.current
            const f = frame.current
            s.x = translateForZoom(s.x, f.scrollX, fx, s.scale, newScale)
            s.y = translateForZoom(s.y, f.scrollY, fy, s.scale, newScale)
            s.scale = newScale
            fit()
        }
        const finishZoomState = (animate: boolean) => {
            if (state.current.scale === 1) state.current = { scale: 1, x: 0, y: 0 }
            apply(animate)
            setZoomed(state.current.scale > 1)
        }
        const clearTapTimer = () => {
            if (g().tapTimer) clearTimeout(g().tapTimer)
            g().tapTimer = undefined
        }
        const startPinch = (touches: Map<string, Point>) => {
            const [a, b] = [...touches.values()]
            const t = g()
            t.pinching = true
            t.moved = true
            clearTapTimer()
            t.previousTap = null
            t.pinchStart = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale: state.current.scale }
            t.lastFocal = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        }

        const onGrant = (event: GestureResponderEvent) => {
            const t = g()
            const touches = points(event.nativeEvent.touches)
            t.last = touches
            if (touches.size >= 2) startPinch(touches)
            else {
                const first = [...touches.values()][0] ?? at(event.nativeEvent)
                t.start = { ...first, time: event.nativeEvent.timestamp }
                t.moved = false
                t.pinching = false
            }
        }
        const onMove = (event: GestureResponderEvent) => {
            const t = g()
            const touches = points(event.nativeEvent.touches)
            const s = state.current
            if (touches.size >= 2 && !t.pinching) startPinch(touches)
            if (t.pinching && touches.size >= 2) {
                const [a, b] = [...touches.values()]
                const focal = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
                zoomAround(focal.x, focal.y, pinchScale(t.pinchStart.scale, t.pinchStart.distance, Math.hypot(a.x - b.x, a.y - b.y)))
                // the fingers moving together drag the page
                s.x += focal.x - t.lastFocal.x
                s.y += focal.y - t.lastFocal.y
                t.lastFocal = focal
                fit()
                apply(false)
                setZoomed(s.scale > 1)
                t.last = touches
                return
            }
            const [id, current] = [...touches.entries()][0] ?? []
            if (!current) return
            if (t.start && Math.hypot(current.x - t.start.x, current.y - t.start.y) > TAP_MAX_MOVE) t.moved = true
            // zoomed: the finger drags the page (also the one left over from a pinch)
            const previous = id ? t.last.get(id) : undefined
            if (s.scale > 1 && previous) {
                s.x += current.x - previous.x
                s.y += current.y - previous.y
                fit()
                apply(false)
            }
            t.last = touches
        }
        const onRelease = (event: GestureResponderEvent) => {
            const t = g()
            const remaining = event.nativeEvent.touches.length
            if (t.pinching) {
                if (remaining === 0) {
                    t.pinching = false
                    state.current.scale = settleScale(state.current.scale)
                    finishZoomState(true)
                }
                // one finger staying carries on dragging, never as a tap or swipe
                t.start = null
                return
            }
            const began = t.start
            t.start = null
            if (!began || remaining > 0) return
            const opts = optionsRef.current
            const end = at(event.nativeEvent)
            if (t.moved) {
                const step = opts.settingZoomed ? null : swipePageStep(
                    { dx: end.x - began.x, dy: end.y - began.y, durationMs: event.nativeEvent.timestamp - began.time },
                    opts.direction,
                    state.current.scale,
                )
                if (step) opts.onSwipe(step)
                return
            }
            const tap = { x: end.x, y: end.y, time: event.nativeEvent.timestamp }
            if (isDoubleTap(t.previousTap, tap)) {
                clearTapTimer()
                t.previousTap = null
                const target = clampGestureScale(doubleTapScale(state.current.scale))
                if (target === 1) state.current = { scale: 1, x: 0, y: 0 }
                else zoomAround(tap.x, tap.y, target)
                finishZoomState(true)
                return
            }
            t.previousTap = tap
            clearTapTimer()
            t.tapTimer = setTimeout(() => {
                g().tapTimer = undefined
                g().previousTap = null
                optionsRef.current.onTap(tap.x)
            }, 280)
        }
        const onTerminate = () => {
            // the scroll view took the touch over; no tap, no swipe
            g().pinching = false
            g().start = null
            finishZoomState(false)
        }

        return {
            onStartShouldSetResponder: () => true,
            onMoveShouldSetResponder: () => true,
            // while zoomed the page keeps the touch; otherwise a vertical drag may go to the scroll view
            onResponderTerminationRequest: () => state.current.scale === 1 && !g().pinching,
            onResponderGrant: onGrant,
            onResponderStart: onGrant,
            onResponderMove: onMove,
            onResponderRelease: onRelease,
            onResponderEnd: (event: GestureResponderEvent) => { if (event.nativeEvent.touches.length > 0) onRelease(event) },
            onResponderTerminate: onTerminate,
        }
    }, [apply])

    return { zoomed, reset, handlers, animatedStyle, updateFrame }
}
