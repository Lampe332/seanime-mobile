import { DISTANCE, pageRiseFrom, swapTiming } from "@/lib/motion"
import { useIsTabletScreen } from "@/lib/use-tablet-ui"
import { coverFlightRunning } from "@/components/shared/cover-flight-store"
import { PageFocusContext } from "@/components/ui/core/page-focus"
import { createPageWarmup, WARM_DATA } from "@/components/ui/core/page-warmup"
import { type TabSlotProps } from "expo-router/ui"
import React from "react"
import { type GestureResponderEvent, StyleSheet, View } from "react-native"
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withTiming } from "react-native-reanimated"
import { Screen, ScreenContainer } from "react-native-screens"
import { scheduleOnRN } from "react-native-worklets"

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
    // The fade draws the whole page as one GPU layer, only while it runs: without it Android draws the page into a fresh
    // offscreen buffer every frame of the fade; a layer kept afterwards would be re-rendered on every content change.
    // (set when the page comes in, during render: the layer is there in the fade's first frame)
    const [fading, setFading] = React.useState(() => focused && !reduceMotion)
    const [wasFocused, setWasFocused] = React.useState(focused)
    if (focused !== wasFocused) {
        setWasFocused(focused)
        setFading(focused)
    }
    const layered = fading && focused && !reduceMotion

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
        opacity.set(withTiming(1, timing, finished => {
            if (finished) scheduleOnRN(setFading, false)
        }))
    }, [focused, isTablet, reduceMotion, opacity, shift])

    const style = useAnimatedStyle(() => ({ opacity: opacity.get(), transform: [{ translateY: shift.get() }] }))
    return <Animated.View renderToHardwareTextureAndroid={layered} style={[{ flex: 1 }, style]}>{children}</Animated.View>
}

/** How long a left page keeps its native views after the switch: past the incoming page's rise (PageEnter) */
const DETACH_AFTER_SWAP_MS = 120

/*
 * A page's native views, attached to the window only while it is in front or just left. Kept attached, every visited
 * page was in Android's draw tree at opacity 0: RenderThread walked all of them each frame (4.4.0 S22 atrace: ~3050
 * views, prepareTree 21–35 ms a frame while typing in a search field). A left page lets go of its views once the
 * incoming page has risen in (react-native-screens activityState 0: its fragment is removed, React keeps the tree, the
 * state and the shadow tree's layout, so measureInWindow still answers for the cover's way back); the switch itself
 * stays as cheap as before, the detach lands after the animation. A page coming back attaches in the render that
 * focuses it, under its fade from 0. Each page has its own container, so the pages' order and their pointerEvents stay
 * those of the slot's plain views (two screens in one container could stack a left one over the page in front).
 */
function PageViews({ focused, children }: { focused: boolean, children: React.ReactNode }) {
    const isTablet = useIsTabletScreen()
    const [attached, setAttached] = React.useState(focused)
    if (focused && !attached) setAttached(true)
    React.useEffect(() => {
        if (focused || !attached) return
        const timer = setTimeout(() => setAttached(false), swapTiming(isTablet).duration + DETACH_AFTER_SWAP_MS)
        return () => clearTimeout(timer)
    }, [focused, attached, isTablet])
    return (
        <ScreenContainer enabled style={StyleSheet.absoluteFill}>
            <Screen enabled activityState={attached || focused ? 2 : 0} freezeOnBlur={false} style={StyleSheet.absoluteFill}>
                {children}
            </Screen>
        </ScreenContainer>
    )
}

/** The main pages' data loaded and two pages built ahead while the app is idle (page-warmup.ts) */
const warmup = createPageWarmup({
    now: () => Date.now(),
    after: (ms, run) => { setTimeout(run, ms) },
    idle: run => { requestIdleCallback(run, { timeout: 2000 }) },
})

/** Runs `run` once no page is coming in and no finger is on a page, nor was for a while (page-warmup.ts whenQuiet) */
export const whenPagesQuiet = warmup.whenQuiet

/** Whether the main pages' data is loaded ahead (WARM_DATA, PageWarmData in the main layout) */
export function usePageDataWarm() {
    return React.useSyncExternalStore(warmup.subscribe, () => warmup.isWarm(WARM_DATA))
}

const noteTouchDown = () => warmup.noteTouch("down")
const noteTouchEnd = (event: GestureResponderEvent) => warmup.noteTouch(event.nativeEvent.touches.length > 0 ? "down" : "up")
// a touch cancelled by the page's own views: a scroll took it over and goes on without JS touches
const noteTouchCancel = () => warmup.noteTouch("scroll")

type PageDescriptor = Parameters<NonNullable<TabSlotProps["renderFn"]>>[0]

/**
 * TabSlot's renderFn (with `detachInactiveScreens={false}`: the slot's own container stays a plain view): a visited page
 * stays mounted under the current one, invisible (opacity 0), untouchable and hidden from accessibility, and its native
 * views are taken off the window shortly after it is left (PageViews). The slot's default detached a left page in the
 * frame of the switch and drew the returning one there too (S22 gfxinfo: slow UI-thread frames on every tab change), so
 * the switch only flips the opacity and runs PageEnter; the detach waits for the animation. Pages are mounted on their
 * first visit (lazy, like the default), My lists and Discover (page-warmup.ts) before it, hidden and detached, while
 * idle; one of them not visited lets go of its views again. A touch on a page holds building ahead back.
 */
export const renderPage: NonNullable<TabSlotProps["renderFn"]> = (descriptor, { isFocused, loaded }) => (
    <PageSlot key={descriptor.route.key} descriptor={descriptor} isFocused={isFocused} loaded={!!loaded} />
)

function PageSlot({ descriptor, isFocused, loaded }: { descriptor: PageDescriptor, isFocused: boolean, loaded: boolean }) {
    const { lazy = true, unmountOnBlur } = descriptor.options
    const name = descriptor.route.name
    // a page built ahead (or let go) renders in a transition: time-sliced, a tap in between goes first
    const [warm, setWarm] = React.useState(() => warmup.isWarm(name))
    React.useEffect(() => {
        const sync = () => React.startTransition(() => setWarm(warmup.isWarm(name)))
        sync()
        return warmup.subscribe(sync)
    }, [name])
    React.useEffect(() => {
        if (!isFocused) return
        warmup.noteSwitch(name)
        warmup.start()
    }, [isFocused, name])
    if (unmountOnBlur && !isFocused) return null
    if (lazy && !loaded && !isFocused && !warm) return null
    return (
        <View
            // no zIndex: Fabric flattens this view, a zIndex then lifted the page over the nav bar (S22: bar untouchable)
            collapsable={false}
            style={[StyleSheet.absoluteFill, { opacity: isFocused ? 1 : 0 }]}
            pointerEvents={isFocused ? "auto" : "none"}
            importantForAccessibility={isFocused ? "auto" : "no-hide-descendants"}
            accessibilityElementsHidden={!isFocused}
            onTouchStart={noteTouchDown}
            onTouchEnd={noteTouchEnd}
            onTouchCancel={noteTouchCancel}
        >
            {/* a text field on a page left behind lets go of the keyboard (page-focus.ts) */}
            <PageViews focused={isFocused}>
                <PageFocusContext.Provider value={isFocused}>
                    <PageEnter focused={isFocused}>{descriptor.render()}</PageEnter>
                </PageFocusContext.Provider>
            </PageViews>
        </View>
    )
}

/**
 * An Animated.View that comes in with an `entering` animation (a sheet, a menu, a popover) and is drawn as one GPU layer
 * for those `layerMs` only: without it Android draws all its rows into a fresh offscreen buffer every frame of the fade;
 * kept afterwards the layer would be redrawn on every change inside (scrolling, typing).
 */
export function EnterLayerView({ layerMs, ...props }: React.ComponentProps<typeof Animated.View> & { layerMs: number }) {
    const [layered, setLayered] = React.useState(true)
    React.useEffect(() => {
        const timer = setTimeout(() => setLayered(false), layerMs + 32)
        return () => clearTimeout(timer)
    }, [layerMs])
    return <Animated.View {...props} renderToHardwareTextureAndroid={layered} />
}
