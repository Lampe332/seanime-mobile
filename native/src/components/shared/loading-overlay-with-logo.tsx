import { Text } from "@/components/ui/text/text"
import { Image } from "expo-image"
import React from "react"
import { View } from "react-native"
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated"

/*
 * loading-overlay-with-logo.tsx: the logo (100dp) and a spaced word over the page while the server starts. Tailwind's
 * animate-pulse (opacity 1 → .5 → 1 over 2 s, cubic-bezier(.4,0,.6,1)) on both.
 */
export function LoadingOverlayWithLogo({ title }: { title?: string }) {
    const pulse = useSharedValue(1)
    React.useEffect(() => {
        pulse.set(withRepeat(withTiming(0.5, { duration: 1000, easing: Easing.bezier(0.4, 0, 0.6, 1), reduceMotion: ReduceMotion.System }), -1, true))
    }, [pulse])
    const style = useAnimatedStyle(() => ({ opacity: pulse.get() }))

    return (
        <View className="flex-1 items-center justify-center bg-background">
            <Animated.View style={style} className="items-center">
                <Image
                    source={require("../../../assets/images/seanime-logo.png")}
                    style={{ width: 100, height: 100 }}
                    contentFit="contain"
                    accessibilityLabel="Loading..."
                />
                <Text className="mt-2 text-lg text-muted">{title ?? "S e a n i m e"}</Text>
            </Animated.View>
        </View>
    )
}
