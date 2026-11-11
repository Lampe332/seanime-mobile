import { DISTANCE, pageRiseFrom, swapTiming } from "@/lib/motion"
import { useIsTabletScreen } from "@/lib/use-tablet-ui"
import { coverFlightRunning } from "@/components/shared/cover-flight-store"
import { type TabSlotProps } from "expo-router/ui"
import React from "react"
import { StyleSheet, View } from "react-native"
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withTiming } from "react-native-reanimated"

/*
 * A page coming in (page-wrapper.tsx + page-transition.ts): it rises 6dp and fades in, 260 ms on the phone curve, 220 ms on the
 * tablet's ease-out. Every main screen is a tab of one navigator (app/(main)/_layout.tsx), so this wraps each tab's screen
 * once: one animation per page, never one inside another (2.0.32's Home started six at once).
 * The page is faded out the moment it leaves (it is hidden then), so it is never drawn at full strength for a frame before
 * it comes in; it rests where it stands and starts its rise only when it comes in (pageRiseFrom): the cover's way back
 * measures its card while the card's page is still hidden. While a cover flies into the page (or back to its cover) the
 * page only fades: the flight measures the header cover where the page will stand. Reduced motion: the page is simply there.
 */
function PageEnter({ focused, children }: { focused: boolean, children: React.ReactNode }) {
    const isTablet = useIsTabletScreen()
    const reduceMotion = useReducedMotion()
    const opacity = useSharedValue(reduceMotion ? 1 : 0)
    const shift = useSharedValue(reduceMotion ? 0 : DISTANCE.swap)

    React.useEffect(() => {
        if (reduceMotion) {
            opacity.set(1)
            shift.set(0)
            return
        }
        if (!focused) {
            opacity.set(0)
            shift.set(pageRiseFrom(false, false))
            return
        }
        const { duration, ease } = swapTiming(isTablet)
        const timing = { duration, easing: Easing.bezier(...ease) }
        const from = pageRiseFrom(true, coverFlightRunning())
        shift.set(from ? withSequence(withTiming(from, { duration: 0 }), withTiming(0, timing)) : 0)
        opacity.set(withTiming(1, timing))
    }, [focused, isTablet, reduceMotion, opacity, shift])

    const style = useAnimatedStyle(() => ({ opacity: opacity.get(), transform: [{ translateY: shift.get() }] }))
    return <Animated.View style={[{ flex: 1 }, style]}>{children}</Animated.View>
}

/**
 * TabSlot's renderFn (with `detachInactiveScreens={false}`): a visited page stays attached and laid out under the current
 * one, only invisible (opacity 0), untouchable and hidden from accessibility. The default slot detached a left page's
 * native views (react-native-screens activityState 0) and attached them again on the way back: Android measured, laid
 * out and drew the whole page on the UI thread in the frame of the switch (S22 gfxinfo: slow UI-thread frames on every
 * tab change). Now a switch only flips the opacity and runs PageEnter. Pages are still mounted on their first visit only
 * (lazy, like the default).
 */
export const renderPage: NonNullable<TabSlotProps["renderFn"]> = (descriptor, { isFocused, loaded }) => {
    const { lazy = true, unmountOnBlur } = descriptor.options
    if (unmountOnBlur && !isFocused) return null
    if (lazy && !loaded && !isFocused) return null
    return (
        <View
            key={descriptor.route.key}
            // no zIndex: Fabric flattens this view, a zIndex then lifted the page over the nav bar (S22: bar untouchable)
            collapsable={false}
            style={[StyleSheet.absoluteFill, { opacity: isFocused ? 1 : 0 }]}
            pointerEvents={isFocused ? "auto" : "none"}
            importantForAccessibility={isFocused ? "auto" : "no-hide-descendants"}
            accessibilityElementsHidden={!isFocused}
        >
            <PageEnter focused={isFocused}>{descriptor.render()}</PageEnter>
        </View>
    )
}
