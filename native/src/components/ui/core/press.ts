import { DURATION, MOTION_EASE_OUT, SCALE } from "@/lib/motion"
import { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated"

const PRESS_EASING = Easing.bezier(...MOTION_EASE_OUT)

/**
 * A press gives way (motion.css: `transform: scale(.97)` over 160 ms on the strong ease-out) and springs back the same
 * way. Transform only, so the phone's compositor does it without a new raster. Reduced motion: no scale.
 */
export function usePressScale(scale: number = SCALE.press) {
    const value = useSharedValue(1)
    const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: value.get() }] }))
    const config = { duration: DURATION.press, easing: PRESS_EASING, reduceMotion: ReduceMotion.System }
    return {
        animatedStyle,
        pressIn: () => {
            value.set(withTiming(scale, config))
        },
        pressOut: () => {
            value.set(withTiming(1, config))
        },
    }
}
