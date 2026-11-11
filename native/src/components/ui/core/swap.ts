import { DISTANCE, swapTiming } from "@/lib/motion"
import { useIsTabletScreen } from "@/lib/use-tablet-ui"
import React from "react"
import { Easing, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated"

/**
 * Content replaced in place (useSwap / usePhoneSwap): when `swapKey` changes (a genre, a list status) the new content rises
 * 6dp and fades in, 260 ms on the phone curve, 220 ms on the tablet's ease-out. While `dimmed` (the next content is still
 * loading, the old one stays) it dims to .5 in 200 ms. `onMount` lets content built anew for the change (a remounted list)
 * rise as it comes. One animated style, shareable by many views (every cell of a grid). Reduced motion: no rise, no dim fade.
 */
export function useSwapStyle(swapKey: string | number, { dimmed = false, onMount = false }: { dimmed?: boolean, onMount?: boolean } = {}) {
    const isTablet = useIsTabletScreen()
    const reduceMotion = useReducedMotion()
    const opacity = useSharedValue(onMount && !reduceMotion ? 0 : 1)
    const shift = useSharedValue(onMount && !reduceMotion ? DISTANCE.swap : 0)
    const settled = React.useRef<string | number | null>(onMount ? null : swapKey)

    React.useEffect(() => {
        if (dimmed) {
            opacity.set(withTiming(0.5, { duration: 200, reduceMotion: ReduceMotion.System }))
            return
        }
        if (settled.current === swapKey) {
            opacity.set(withTiming(1, { duration: 200, reduceMotion: ReduceMotion.System }))
            return
        }
        settled.current = swapKey
        if (reduceMotion) {
            opacity.set(1)
            shift.set(0)
            return
        }
        const { duration, ease } = swapTiming(isTablet)
        const timing = { duration, easing: Easing.bezier(...ease) }
        opacity.set(0)
        shift.set(DISTANCE.swap)
        opacity.set(withTiming(1, timing))
        shift.set(withTiming(0, timing))
    }, [swapKey, dimmed, isTablet, reduceMotion, opacity, shift])

    return useAnimatedStyle(() => ({ opacity: opacity.get(), transform: [{ translateY: shift.get() }] }))
}
