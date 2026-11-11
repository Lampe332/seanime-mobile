import { type Box, boxTransform, GLIDE, type GlideLeft, glideHandoff, glidePlan, mixBox } from "@/lib/motion"
import { useIsTabletScreen } from "@/lib/use-tablet-ui"
import React from "react"
import { type LayoutChangeEvent, type StyleProp, StyleSheet, type ViewStyle } from "react-native"
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated"

/*
 * segment-glide.ts for React Native: one bubble under a switch's options (segments, pills, the bottom bar, the tablet rail)
 * is the chosen option's background. When the choice moves it glides from where it is to the new option on transform alone
 * (UI thread, so it keeps going while the page the tap opens is built); a second tap mid-glide starts from where the bubble
 * is. Options of another size are reached by scaling from the old size, past GLIDE.maxScale the bubble appears at the new
 * option instead (glidePlan). Layout changes (rotation, a label rewrapping) move it without a glide; reduced motion jumps.
 *
 * The bubble is laid out at its target (an outer view whose box changes once per choice) and moved by an inner view's
 * transform only, so no frame of the glide lays anything out.
 *
 * Until the options are measured (the first layout) the bubble has no place; the chosen option then shows the same
 * background itself (GlideStandIn), and both switch over in one UI frame, as they read the same shared value.
 *
 * A switch built anew for the choice it made (My lists rebuilds its list, the Anime | Manga switch with it) names a
 * `memory`: the new switch's bubble starts where the old one stood and glides (glideHandoff), and until then the stand-in
 * stays on the old option, so nothing jumps.
 */
type GlideState = { from: Box, to: Box }

const sameBox = (a: Box, b: Box) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5

/** Where the bubbles of remembered switches stood when they went */
const leftBubbles = new Map<string, GlideLeft>()

export type Glide = ReturnType<typeof useGlide>

/** The switch's bubble for the option `selected` (its key); options report their box with `onOptionLayout(key)` */
export function useGlide(selected: string | null, memory?: string) {
    const isTablet = useIsTabletScreen()
    const reduceMotion = useReducedMotion()
    const boxes = React.useRef(new Map<string, Box>())
    const shown = React.useRef<{ key: string, box: Box } | null>(null)
    const selectedRef = React.useRef(selected)
    const state = useSharedValue<GlideState | null>(null)
    const progress = useSharedValue(1)
    const appear = useSharedValue(1)
    // the old switch's bubble this one takes over (read once, when it is built); spent by the first placing
    const [handoff] = React.useState(() => memory ? glideHandoff(leftBubbles.get(memory), selected, Date.now()) : null)
    const placed = useSharedValue(false)

    const place = React.useCallback((key: string | null) => {
        const box = key ? boxes.current.get(key) : undefined
        if (!key || !box) {
            // nothing chosen (the Menu is open over the bar): no bubble
            if (!key && shown.current) {
                shown.current = null
                state.set(null)
            }
            return
        }
        const last = shown.current
        if (last && last.key === key && sameBox(last.box, box)) return
        const current = state.get()
        const moving = !!last && last.key !== key
        // a glide on its way starts from where the bubble is now; a switch built anew from where its old bubble stood
        const takeOver = !last && !placed.get() && !!handoff && handoff.key !== key
        const from = moving && current ? mixBox(current.from, current.to, progress.get()) : takeOver ? handoff.box : null
        const plan = moving || takeOver ? glidePlan(from, box, reduceMotion) : "jump"
        const easing = Easing.bezier(...(isTablet ? GLIDE.easeTablet : GLIDE.easePhone))
        shown.current = { key, box }
        placed.set(true)
        state.set({ from: plan === "glide" && from ? from : box, to: box })
        if (plan === "glide") {
            progress.set(0)
            progress.set(withTiming(1, { duration: GLIDE.duration, easing }))
        } else progress.set(1)
        if (plan === "appear") {
            appear.set(0)
            appear.set(withTiming(1, { duration: GLIDE.appear, easing }))
        } else appear.set(1)
    }, [isTablet, reduceMotion, state, progress, appear, handoff, placed])

    React.useEffect(() => {
        selectedRef.current = selected
        place(selected)
    }, [selected, place])

    // A remembered switch leaves its bubble where it stands (mid-glide: where it is now) for the switch built after it
    React.useEffect(() => {
        if (!memory) return
        return () => {
            const last = shown.current
            if (!last) return
            const current = state.get()
            const box = current ? mixBox(current.from, current.to, progress.get()) : last.box
            leftBubbles.set(memory, { key: last.key, box, at: Date.now() })
        }
    }, [memory, state, progress])

    const onOptionLayout = React.useCallback((key: string) => (event: LayoutChangeEvent) => {
        const { x, y, width, height } = event.nativeEvent.layout
        boxes.current.set(key, { x, y, width, height })
        if (key === selectedRef.current) place(key)
    }, [place])

    return { onOptionLayout, state, progress, appear, placed, selected, handoffKey: handoff?.key ?? null }
}

/**
 * The bubble; render it as the first child of the options' parent (it sits under them). The parent must have no border:
 * an option's layout and the bubble's absolute position both count from its padding box only without one.
 */
export function GlidePill({ glide, className, style }: { glide: Glide, className?: string, style?: StyleProp<ViewStyle> }) {
    const { state, progress, appear } = glide
    const outer = useAnimatedStyle(() => {
        const s = state.get()
        return s ? { left: s.to.x, top: s.to.y, width: s.to.width, height: s.to.height, opacity: 1 } : { left: 0, top: 0, width: 0, height: 0, opacity: 0 }
    })
    const inner = useAnimatedStyle(() => {
        const s = state.get()
        if (!s) return { opacity: 0, transform: [{ translateX: 0 }, { translateY: 0 }, { scaleX: 1 }, { scaleY: 1 }] }
        const t = boxTransform(s.to, mixBox(s.from, s.to, progress.get()))
        const a = appear.get()
        const settle = 0.96 + 0.04 * a
        return { opacity: a, transform: [{ translateX: t.translateX }, { translateY: t.translateY }, { scaleX: t.scaleX * settle }, { scaleY: t.scaleY * settle }] }
    })
    return (
        <Animated.View pointerEvents="none" style={[{ position: "absolute" }, outer]}>
            <Animated.View style={[StyleSheet.absoluteFill, style, inner]} className={className} />
        </Animated.View>
    )
}

/**
 * The bubble's background on the option `optionKey` itself until the bubble is placed (the first layout frame, or the
 * old option of a switch built anew); render it as the option's first child, with the bubble's className.
 */
export function GlideStandIn({ glide, optionKey, className }: { glide: Glide, optionKey: string, className?: string }) {
    const { state, placed, selected, handoffKey } = glide
    const style = useAnimatedStyle(() => {
        // before the first placing a switch built anew keeps the old option's background; after it, the chosen one's
        const stand = selected === null ? null : !placed.get() && handoffKey !== null ? handoffKey : selected
        return { opacity: stand === optionKey && !state.get() ? 1 : 0 }
    })
    return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, style]} className={className} />
}
