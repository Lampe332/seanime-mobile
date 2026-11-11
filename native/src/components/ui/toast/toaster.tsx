import { TOAST_STACK_MOVE, toastIn, toastOut } from "@/components/ui/core/animations"
import { getToasts, stackedToast, subscribeToasts, toast, toasterFrame, type ToastItem, type ToastType, VISIBLE_TOASTS } from "@/components/ui/toast/toast-store"
import { haptic } from "@/lib/feedback"
import { DURATION, POP_EASE, SCALE } from "@/lib/motion"
import { colors } from "@/lib/theme/tokens"
import React from "react"
import { Pressable, Text, useWindowDimensions, View } from "react-native"
import Animated, { Easing, Keyframe, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated"
import Svg, { Path } from "react-native-svg"

/*
 * The app's toasts as 2.0.32 drew them: sonner 2.0.7 (`<Toaster position="top-right" visibleToasts={4} theme="dark">`,
 * toaster.tsx) with `.sm-toast` (mobile-surface.css). The raised control surface, 16dp corners, the floating shadow,
 * 12/16dp padding and 12dp between icon and text; the type shows only in the colour of sonner's filled icon (20dp in its
 * 16dp box, -3/+4dp margins). The text is sonner's own face (system-ui = Roboto on Android): title 14/21 medium, a
 * description 14/19.6 in the muted colour. A success's check pops in once (360 ms, 80 ms late). Newer toasts stack
 * over older ones (stackedToast). A tap closes one; each leaves after its duration.
 */
const ICON_COLOR: Record<ToastType, string> = {
    default: colors.smTextMuted,
    success: colors.smSuccess,
    error: colors.smDanger,
    warning: colors.smWarning,
    info: colors.smAccent,
}

/** sonner's icons (SuccessIcon, ErrorIcon, WarningIcon, InfoIcon): 20dp, filled, the mark cut out */
const ICON: Record<Exclude<ToastType, "default">, { viewBox: string, d: string }> = {
    success: { viewBox: "0 0 20 20", d: "M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" },
    error: { viewBox: "0 0 20 20", d: "M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" },
    warning: { viewBox: "0 0 24 24", d: "M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z" },
    info: { viewBox: "0 0 20 20", d: "M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" },
}

/** sonner's face: `font-family: ui-sans-serif, system-ui, …` on the toaster */
const TITLE_STYLE = { fontFamily: "sans-serif", fontSize: 14, lineHeight: 21, fontWeight: "500", color: colors.smText } as const
const DESCRIPTION_STYLE = { fontFamily: "sans-serif", fontSize: 14, lineHeight: 19.6, color: colors.smTextMuted } as const
/** `[data-button]` (dark theme: --normal-text on --normal-bg) with `.sm-toast`'s 44dp pill */
const BUTTON_LABEL_STYLE = { fontFamily: "sans-serif", fontSize: 13, fontWeight: "600", color: "#000000" } as const

const checkPop = new Keyframe({
    0: { opacity: 0, transform: [{ scale: SCALE.toastCheckFrom }] },
    100: { opacity: 1, transform: [{ scale: 1 }], easing: Easing.bezier(...POP_EASE) },
}).duration(DURATION.toastCheck).delay(DURATION.toastCheckDelay).reduceMotion(ReduceMotion.System)

function ToastIcon({ type }: { type: ToastType }) {
    if (type === "default") return null
    const { viewBox, d } = ICON[type]
    const icon = (
        <Svg width={20} height={20} viewBox={viewBox} style={{ marginLeft: -1 }}>
            <Path fill={ICON_COLOR[type]} fillRule="evenodd" clipRule="evenodd" d={d} />
        </Svg>
    )
    return (
        // `[data-icon]`: a 16dp box the 20dp icon spills out of
        <View style={{ width: 16, height: 16, marginLeft: -3, marginRight: 4, flexDirection: "row", alignItems: "center" }}>
            {type === "success" ? <Animated.View entering={checkPop}>{icon}</Animated.View> : icon}
        </View>
    )
}

function ToastRow({ item, index, frontHeight, onFrontHeight }: { item: ToastItem, index: number, frontHeight: number, onFrontHeight: (height: number) => void }) {
    React.useEffect(() => {
        const timer = setTimeout(() => toast.dismiss(item.id), item.duration)
        return () => clearTimeout(timer)
    }, [item.id, item.duration, item.createdAt])

    const place = useSharedValue(index)
    const shown = useSharedValue(stackedToast(index).contentOpacity)
    const front = useSharedValue(index === 0)
    React.useEffect(() => {
        place.set(withTiming(index, TOAST_STACK_MOVE))
        shown.set(withTiming(stackedToast(index).contentOpacity, TOAST_STACK_MOVE))
        front.set(index === 0)
    }, [index, place, shown, front])
    const exiting = React.useMemo(() => toastOut(front), [front])
    const boxStyle = useAnimatedStyle(() => {
        const { translateY, scale } = stackedToast(place.get())
        return { transform: [{ translateY }, { scale }] }
    })
    const contentStyle = useAnimatedStyle(() => ({ opacity: shown.get() }))

    return (
        <Animated.View entering={toastIn} exiting={exiting} pointerEvents={index === 0 ? "auto" : "none"}
            style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: VISIBLE_TOASTS - index }}>
            <Animated.View
                onLayout={index === 0 ? event => onFrontHeight(event.nativeEvent.layout.height) : undefined}
                style={[boxStyle, index > 0 && frontHeight > 0 ? { height: frontHeight } : null]}
                className="rounded-surface bg-sm-surface-control shadow-float"
            >
                <Pressable accessibilityRole="alert" accessibilityLiveRegion="polite" onPress={() => toast.dismiss(item.id)}>
                    <Animated.View style={contentStyle} className="flex-row items-center gap-3 px-4 py-3">
                        <ToastIcon type={item.type} />
                        <View className="min-w-0 flex-1 gap-0.5">
                            <Text style={TITLE_STYLE}>{item.title}</Text>
                            {!!item.description && <Text style={DESCRIPTION_STYLE}>{item.description}</Text>}
                        </View>
                        {!!item.action && (
                            <Pressable
                                accessibilityRole="button"
                                onPress={() => {
                                    item.action?.onClick()
                                    toast.dismiss(item.id)
                                }}
                                className="min-h-11 items-center justify-center rounded-full bg-[#fcfcfc] px-3.5"
                            >
                                <Text style={BUTTON_LABEL_STYLE}>{item.action.label}</Text>
                            </Pressable>
                        )}
                    </Animated.View>
                </Pressable>
            </Animated.View>
        </Animated.View>
    )
}

export function Toaster() {
    const toasts = React.useSyncExternalStore(subscribeToasts, getToasts, getToasts)
    const { width } = useWindowDimensions()
    const visible = toasts.slice(-VISIBLE_TOASTS)
    const [frontHeight, setFrontHeight] = React.useState(0)
    // a new error toast gets the "reject" haptic (toaster.tsx of the web app)
    const seen = React.useRef(new Set<string | number>())
    React.useEffect(() => {
        if (toasts.some(item => item.type === "error" && !seen.current.has(item.id))) haptic("reject")
        seen.current = new Set(toasts.map(item => item.id))
    }, [toasts])
    if (visible.length === 0) return null
    return (
        <View pointerEvents="box-none" style={{ position: "absolute", ...toasterFrame(width) }}>
            {visible.map((item, i) => (
                <ToastRow key={item.id} item={item} index={visible.length - 1 - i} frontHeight={frontHeight} onFrontHeight={setFrontHeight} />
            ))}
        </View>
    )
}
