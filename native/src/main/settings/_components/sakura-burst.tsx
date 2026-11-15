import { Text } from "@/components/ui/text/text"
import { MOTION_EASE_OUT } from "@/lib/motion"
import { type Petal, SAKURA_MS, sakuraPetals } from "@/main/settings/_lib/version-taps"
import { Portal } from "@rn-primitives/portal"
import React from "react"
import { StyleSheet, useWindowDimensions, View } from "react-native"
import Animated, {
    Easing,
    interpolate,
    ReduceMotion,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withDelay,
    withSequence,
    withTiming,
} from "react-native-reanimated"

// geschrieben nach: Android's build-number easter egg (Settings → About phone), own design

/*
 * The About page's secret (version-taps.ts): sakura petals fall over the whole window for under five seconds, each on the
 * UI thread with transform and opacity only, and a line stands in the middle. The layer takes no touches. With the
 * system's reduced motion only the line fades in and out, no petals.
 */
const easeOut = Easing.bezier(...MOTION_EASE_OUT)

export function SakuraBurst({ message, onDone }: { message: string, onDone: () => void }) {
    const reduceMotion = useReducedMotion()
    const { width, height } = useWindowDimensions()
    const [petals] = React.useState(() => sakuraPetals(width))
    React.useEffect(() => {
        const timer = setTimeout(onDone, SAKURA_MS)
        return () => clearTimeout(timer)
    }, [onDone])
    return <Portal name="sakura-burst">
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {!reduceMotion && petals.map((petal, i) => <FallingPetal key={i} petal={petal} fall={height} />)}
            <SecretLine message={message} still={reduceMotion} />
        </View>
    </Portal>
}

function FallingPetal({ petal, fall }: { petal: Petal, fall: number }) {
    const progress = useSharedValue(0)
    React.useEffect(() => {
        // falling leaves keep one speed: linear
        progress.set(withDelay(petal.delay, withTiming(1, { duration: petal.duration, easing: Easing.linear })))
    }, [petal, progress])
    const style = useAnimatedStyle(() => {
        const p = progress.get()
        return {
            opacity: interpolate(p, [0, 0.06, 0.78, 1], [0, 1, 1, 0]),
            transform: [
                { translateX: petal.drift * p + petal.sway * Math.sin(p * petal.turns * 2 * Math.PI) },
                { translateY: -petal.size * 2 + p * (fall + petal.size * 4) },
                { rotate: `${petal.rotate + petal.spin * p}deg` },
            ],
        }
    })
    const r = petal.size
    return <Animated.View style={[{
        position: "absolute",
        top: 0,
        left: petal.x,
        width: petal.size,
        height: Math.round(petal.size * 1.3),
        backgroundColor: petal.color,
        borderTopLeftRadius: r,
        borderBottomRightRadius: r,
        borderTopRightRadius: r * 0.25,
        borderBottomLeftRadius: r * 0.25,
    }, style]} />
}

/** In 220ms on the app's ease-out (a small rise from 0.96), held, out in 400ms before the petals have gone. */
function SecretLine({ message, still }: { message: string, still: boolean }) {
    const shown = useSharedValue(0)
    React.useEffect(() => {
        // an opacity fade is fine with reduced motion, so it never ends at once
        const timing = (to: number, duration: number) => withTiming(to, { duration, easing: easeOut, reduceMotion: ReduceMotion.Never })
        shown.set(withSequence(timing(1, 220), withDelay(SAKURA_MS - 220 - 400 - 180, timing(0, 400))))
    }, [shown])
    const style = useAnimatedStyle(() => ({
        opacity: shown.get(),
        transform: [{ scale: still ? 1 : interpolate(shown.get(), [0, 1], [0.96, 1]) }],
    }))
    return <View style={StyleSheet.absoluteFill} className="items-center justify-center px-8">
        <Animated.View style={[style, { borderWidth: 1, borderColor: "rgba(242, 155, 187, 0.5)",
            elevation: 12, shadowColor: "#000", shadowOpacity: 0.45, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } }]}
            className="max-w-[360px] rounded-surface bg-sm-surface-raised px-5 py-3.5">
            <Text accessibilityLiveRegion="polite" className="text-center text-base font-semibold leading-[22px]">{message}</Text>
        </Animated.View>
    </View>
}
