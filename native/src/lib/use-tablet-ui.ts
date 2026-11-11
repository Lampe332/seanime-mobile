import { hasTwoPanes, isShortRail, isTabletScreen, showsRail } from "@/lib/tablet-ui"
import { Dimensions, useWindowDimensions } from "react-native"
import React from "react"

function subscribe(onChange: () => void) {
    const sub = Dimensions.addEventListener("change", onChange)
    return () => sub.remove()
}

function readScreen() {
    const screen = Dimensions.get("screen")
    return isTabletScreen(screen)
}

/** Whether the device's screen is a tablet screen; follows a foldable opening or closing. */
export function useIsTabletScreen() {
    return React.useSyncExternalStore(subscribe, readScreen, readScreen)
}

/** The layout of the current window: rail or bottom bar, two panes, compact rail. */
export function useTabletLayout() {
    const isTablet = useIsTabletScreen()
    const window = useWindowDimensions()
    return {
        isTablet,
        rail: showsRail(isTablet, window),
        twoPanes: hasTwoPanes(isTablet, window),
        shortRail: isShortRail(window),
        window,
    }
}
