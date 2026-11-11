import { BAR_GROW, barGrowDelay, DISTANCE, DRAWER_EASE, DURATION, LEVEL_PANEL, MOTION_EASE_OUT, PHONE_EASE, SCALE } from "@/lib/motion"
import {
    Easing,
    type EntryAnimationsValues,
    type ExitAnimationsValues,
    FadeIn,
    FadeOut,
    Keyframe,
    type LayoutAnimation,
    ReduceMotion,
    type SharedValue,
    withTiming,
} from "react-native-reanimated"

/*
 * Enter/exit animations of the overlay building blocks, with the web app's values (lib/motion.ts). Opacity and transform
 * only. Every one follows the system's reduced-motion setting (ReduceMotion.System: they end at once).
 */
const phoneEase = Easing.bezier(...PHONE_EASE)
const outEase = Easing.bezier(...MOTION_EASE_OUT)
const drawerEase = Easing.bezier(...DRAWER_EASE)

/** The dimmed backdrop under sheets and dialogs */
export const scrimIn = FadeIn.duration(DURATION.revealFade).reduceMotion(ReduceMotion.System)
export const scrimOut = FadeOut.duration(DURATION.popoverOut + 40).reduceMotion(ReduceMotion.System)

/** Phone bottom sheet: rises 2rem from the bottom edge on the phone curve in 320 ms (motion.css), leaves quicker (160 ms) */
export const sheetInPhone = new Keyframe({
    0: { opacity: 0, transform: [{ translateY: 32 }] },
    100: { opacity: 1, transform: [{ translateY: 0 }], easing: phoneEase },
}).duration(DURATION.sheetPhone).reduceMotion(ReduceMotion.System)

export const sheetOutPhone = new Keyframe({
    0: { opacity: 1, transform: [{ translateY: 0 }] },
    100: { opacity: 0, transform: [{ translateY: 24 }], easing: outEase },
}).duration(160).reduceMotion(ReduceMotion.System)

/** Tablet side sheet: 2rem in from the right edge on the drawer curve in 260 ms (tablet.css), out in 170 ms */
export const sheetInSide = new Keyframe({
    0: { opacity: 0, transform: [{ translateX: 32 }] },
    100: { opacity: 1, transform: [{ translateX: 0 }], easing: drawerEase },
}).duration(260).reduceMotion(ReduceMotion.System)

export const sheetOutSide = new Keyframe({
    0: { opacity: 1, transform: [{ translateX: 0 }] },
    100: { opacity: 0, transform: [{ translateX: 32 }], easing: outEase },
}).duration(170).reduceMotion(ReduceMotion.System)

/** Dialog: zooms in from 95 % with a fade (the modal's zoom-in-95, 200 ms) */
export const dialogIn = new Keyframe({
    0: { opacity: 0, transform: [{ scale: SCALE.popoverEnter }] },
    100: { opacity: 1, transform: [{ scale: 1 }], easing: outEase },
}).duration(200).reduceMotion(ReduceMotion.System)

export const dialogOut = new Keyframe({
    0: { opacity: 1, transform: [{ scale: 1 }] },
    100: { opacity: 0, transform: [{ scale: SCALE.popoverEnter }], easing: outEase },
}).duration(160).reduceMotion(ReduceMotion.System)

/** A phone's long-press menu, docked above the bar: rises 1rem in 220 ms on the sheet curve (mobile-surface.css `[data-phone-menu]`) */
export const actionSheetIn = new Keyframe({
    0: { opacity: 0, transform: [{ translateY: 16 }] },
    100: { opacity: 1, transform: [{ translateY: 0 }], easing: phoneEase },
}).duration(220).reduceMotion(ReduceMotion.System)

/** The same on a tablet, on the sheet curve of `[data-phone-menu]` itself (motion.css slows only phones) */
export const actionSheetInTablet = new Keyframe({
    0: { opacity: 0, transform: [{ translateY: 16 }] },
    100: { opacity: 1, transform: [{ translateY: 0 }], easing: drawerEase },
}).duration(220).reduceMotion(ReduceMotion.System)

/** Popovers and menus open out of what was tapped from 95 % in 180 ms and settle back to 97 % in 120 ms (mobile-surface.css) */
export const popoverIn = new Keyframe({
    0: { opacity: 0, transform: [{ scale: SCALE.popoverEnter }] },
    100: { opacity: 1, transform: [{ scale: 1 }], easing: outEase },
}).duration(DURATION.popoverIn).reduceMotion(ReduceMotion.System)

export const popoverOut = new Keyframe({
    0: { opacity: 1, transform: [{ scale: 1 }] },
    100: { opacity: 0, transform: [{ scale: SCALE.popoverExit }], easing: outEase },
}).duration(DURATION.popoverOut).reduceMotion(ReduceMotion.System)

/** The bar's menu panel unfolds from the menu button: 18dp below and 94 % (UIBottomNav.kt seanime-menu-in) */
export function menuIn(isTablet: boolean) {
    return new Keyframe({
        0: { opacity: 0, transform: [{ translateY: DISTANCE.menuRise }, { scale: SCALE.menuEnter }] },
        100: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }], easing: isTablet ? drawerEase : phoneEase },
    }).duration(isTablet ? DURATION.menuInTablet : DURATION.menuInPhone).reduceMotion(ReduceMotion.System)
}

export const menuOut = new Keyframe({
    0: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] },
    100: { opacity: 0, transform: [{ translateY: 8 }, { scale: 0.98 }], easing: outEase },
}).duration(160).reduceMotion(ReduceMotion.System)

/*
 * A toast moves like sonner 2.0.7's (styles.css): it comes down from one toast height above and fades in with the CSS
 * transition `transform 400ms, opacity 400ms` (timing `ease`). Removed, the front one runs the same way back up, but it
 * is taken away after 200 ms (TIME_BEFORE_UNMOUNT), about 80% of the way; one behind the front fades in 200 ms and
 * sinks 40% of its height (500 ms) until then.
 */
const sonnerEase = Easing.bezier(0.25, 0.1, 0.25, 1)
const TOAST_MOVE = { duration: 400, easing: sonnerEase, reduceMotion: ReduceMotion.System }
const TOAST_GONE = 200

export function toastIn(values: EntryAnimationsValues): LayoutAnimation {
    "worklet"
    return {
        initialValues: { opacity: 0, transform: [{ translateY: -values.targetHeight }] },
        animations: { opacity: withTiming(1, TOAST_MOVE), transform: [{ translateY: withTiming(0, TOAST_MOVE) }] },
    }
}

/** `front` tells at removal whether the toast was the one in front of the stack */
export function toastOut(front: SharedValue<boolean>) {
    return (values: ExitAnimationsValues): LayoutAnimation => {
        "worklet"
        const isFront = front.get()
        const fade = { duration: TOAST_GONE, easing: sonnerEase, reduceMotion: ReduceMotion.System }
        return {
            initialValues: { opacity: 1, transform: [{ translateY: 0 }] },
            animations: isFront
                ? { opacity: withTiming(0.2, fade), transform: [{ translateY: withTiming(-0.8 * values.currentHeight, fade) }] }
                // 200 of the 500 ms `ease` towards 40%: about a quarter of its height
                : { opacity: withTiming(0, fade), transform: [{ translateY: withTiming(0.25 * values.currentHeight, fade) }] },
        }
    }
}

/** The stack moving when a toast comes or goes (sonner's 400 ms transform/opacity transition) */
export const TOAST_STACK_MOVE = TOAST_MOVE

/** Content replaced in place (a new sort order) rises in 6dp instead of jumping in one frame (usePhoneSwap) */
export function swapIn(isTablet: boolean) {
    return new Keyframe({
        0: { opacity: 0, transform: [{ translateY: 6 }] },
        100: { opacity: 1, transform: [{ translateY: 0 }], easing: isTablet ? outEase : phoneEase },
    }).duration(isTablet ? DURATION.swapTablet : DURATION.swapPhone).reduceMotion(ReduceMotion.System)
}

/** A statistics bar grows from its start (m-grow), the first five 30 ms apart; give the bar `transformOrigin: "left"` */
export function barGrow(isTablet: boolean, index: number) {
    const { duration, ease } = isTablet ? BAR_GROW.tablet : BAR_GROW.phone
    return new Keyframe({
        0: { transform: [{ scaleX: 0 }] },
        100: { transform: [{ scaleX: 1 }], easing: Easing.bezier(...ease) },
    }).duration(duration).delay(barGrowDelay(index)).reduceMotion(ReduceMotion.System)
}

/** The player's brightness / volume panel slides in 16dp from its side of the screen and fades out */
export function levelPanelIn(isTablet: boolean, fromRight: boolean) {
    return new Keyframe({
        0: { opacity: 0, transform: [{ translateX: fromRight ? LEVEL_PANEL.shift : -LEVEL_PANEL.shift }] },
        100: { opacity: 1, transform: [{ translateX: 0 }], easing: isTablet ? outEase : phoneEase },
    }).duration(LEVEL_PANEL.in).reduceMotion(ReduceMotion.System)
}

export const levelPanelOut = FadeOut.duration(LEVEL_PANEL.out).reduceMotion(ReduceMotion.System)

/** The next or previous week / month slides in 24dp from its side (usePhoneStep, the calendar); the pager row stays. */
export function stepIn(isTablet: boolean, forward: boolean) {
    const from = forward ? DISTANCE.step : -DISTANCE.step
    return new Keyframe({
        0: { opacity: 0, transform: [{ translateX: from }] },
        100: { opacity: 1, transform: [{ translateX: 0 }], easing: isTablet ? outEase : phoneEase },
    }).duration(isTablet ? DURATION.swapTablet : DURATION.swapPhone).reduceMotion(ReduceMotion.System)
}
