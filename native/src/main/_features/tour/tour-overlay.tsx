import { cn } from "@/components/ui/core/styling"
import { Text } from "@/components/ui/text/text"
import { useTr } from "@/lib/app-language"
import { PHONE_EASE, POP_EASE, TOUR_FINALE, TOUR_MOTION, type TourMotion, tourRingDelayMs, tourSparks, tourTravelMs } from "@/lib/motion"
import { colors } from "@/lib/theme/tokens"
import { useIsTabletScreen } from "@/lib/use-tablet-ui"
import Sparkles from "lucide-react-native/icons/sparkles"
import React from "react"
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, useWindowDimensions, View } from "react-native"
import Animated, {
    cancelAnimation, Easing, FadeIn, FadeOut, Keyframe, ReduceMotion, useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay,
    withRepeat, withSequence, withSpring, withTiming,
} from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import Svg, { Path, Rect as SvgRect } from "react-native-svg"
import { tour, type TourStep, useTourState } from "./tour"
import {
    cardButtons, cardEnterFrom, cardWidth, computePopoverPosition, dimStrips, followBackIndex, irisRect, isOffScreen, mixRect, padRect, type Rect,
    resolvePlacement, sameRect, spotlightPath, type TourStepPlacement,
} from "./tour-logic"
import { findTourTarget, hasTourTarget, subscribeTourPresses, subscribeTourTargets } from "./tour-targets"

/*
 * The tour's layer (web tour-overlay.tsx) over everything, sheets included (it sits after the PortalHost): one dim layer
 * for the whole tour with a cutout over the target, the card next to it or centred, "Loading…" only after a felt wait.
 * The fixes of 2.0.32 (Desktop/…/Seanime-Tutorial-Animationen.md):
 *   F1  the card is measured before it is shown, at its own height (not the previous card's), and again when it rewraps
 *   F2  the target gone for good (≥ 0.5 s: Back closed the menu or the sheet, left the tab) → back to the latest earlier
 *       step whose target is shown, else the end; Back on a centred card closes the tour instead of leaving the screen
 *   F3  the target is looked up again whenever it was rebuilt (re-measured every 100 ms by name, not a kept element)
 *   F4  only a shown target counts (mounted, focused screen, larger than 0×0)
 *   F5  a step whose target never came gets a centred card with Next and Back
 *   F6  Back on a target step, or the target leaving, closes the cutout at once: nothing below can be tapped through
 *   T1  a target that leaves (the menu folding away) counts as gone from the moment it unmounts
 *   F7  "Loading…" only after TOUR_MOTION.wait
 * The moves (TOUR_MOTION / TOUR_FINALE per device, E5): the cutout glides from target to target (one path, drawn on the UI
 * thread), opens out of the target's centre after a centred card and closes into it before one (iris); a ring beats round a
 * target that waits for its tap; a card comes out of its target's side (tablet: on a spring), a centred card rises; its
 * content follows part by part, the progress pill moves on from the last step's place; the badge lands, the finale's check
 * draws itself and 16 sparks fly off the badge. Reduced motion: everything is simply there (the cutout jumps).
 */
const DIM = "rgba(0, 0, 0, 0.7)"
const RING = "rgba(166, 135, 244, 0.55)"
const AnimatedPath = Animated.createAnimatedComponent(Path)
const AnimatedRect = Animated.createAnimatedComponent(SvgRect)

export function TourOverlay() {
    const state = useTourState()
    const { active, steps, currentIndex, status, asModal } = state
    const step = active ? steps[currentIndex] : undefined
    const viewport = useWindowDimensions()
    const insets = useSafeAreaInsets()
    const isTablet = useIsTabletScreen()
    const reduceMotion = useReducedMotion()
    const m = isTablet ? TOUR_MOTION.tablet : TOUR_MOTION.phone

    const target = step && !asModal ? step.target : undefined
    const isSpotlight = !!target
    const isModal = !!step && !target && status === "idle"

    // the cutout: the measured target and the step it was measured for; held while the next step gets ready
    const [spot, setSpot] = React.useState<{ index: number, rect: Rect } | null>(null)
    const [targetLost, setTargetLost] = React.useState(false)
    const backAt = React.useRef(0)

    // Back: on a target step the app goes back as usual and the tour follows (below); on a centred card it closes the tour
    React.useEffect(() => {
        if (!active) return
        const sub = BackHandler.addEventListener("hardwareBackPress", () => {
            const { steps: list, currentIndex: at, asModal: modal } = tour.state()
            if (list[at]?.target && !modal) {
                // the sheet or page under the cutout is about to go: no cutout to tap through meanwhile (F6)
                backAt.current = Date.now()
                setTargetLost(true)
                return false
            }
            tour.stop()
            return true
        })
        return () => {
            sub.remove()
            // the next tour starts without this one's cutout
            setSpot(null)
            setTargetLost(false)
        }
    }, [active])

    // F2: gone for good → the latest earlier step whose target is on screen, or the end
    const followBack = React.useEffectEvent(() => {
        const { steps: list, currentIndex: at, active: on } = tour.state()
        if (!on) return
        const index = followBackIndex(list, at, hasTourTarget)
        if (index === -1) tour.stop()
        else tour.goTo(list[index].id)
    })

    // Track the target: centred first, measured, re-measured every 100 ms (scroll, rebuild, rewrap)
    React.useEffect(() => {
        if (!active || !target || status !== "idle") return
        const padding = step?.spotlightPadding ?? 8
        let alive = true
        let missingMs = 0
        let centred = false

        const update = async () => {
            const found = await findTourTarget(target)
            if (!alive) return
            if (!found) {
                setTargetLost(true)
                missingMs += 100
                if (missingMs >= 500) {
                    alive = false
                    followBack()
                }
                return
            }
            // just after Back the target may still be leaving (a closing sheet): decide once it had the time
            if (Date.now() - backAt.current < 450) return
            missingMs = 0
            if (!centred && found.scroll && isOffScreen(found.rect, viewport, insets.top, insets.bottom + 80)) {
                centred = true
                found.scroll.centre(found.rect)
                return
            }
            centred = true
            const next = padRect(found.rect, padding)
            setTargetLost(false)
            setSpot(prev => prev && prev.index === currentIndex && sameRect(prev.rect, next) ? prev : { index: currentIndex, rect: next })
        }
        void update()
        const watch = setInterval(update, 100)
        // T1/F6: an unmounted target is gone at once
        const unsubscribe = subscribeTourTargets(() => {
            if (!hasTourTarget(target)) setTargetLost(true)
        })
        return () => {
            alive = false
            clearInterval(watch)
            unsubscribe()
        }
    }, [active, target, status, currentIndex, step?.spotlightPadding, viewport, insets.top, insets.bottom])

    // advanceOnTargetClick / advanceOnSelectorClick: the element reports its tap
    React.useEffect(() => {
        const watched = step?.advanceOnSelectorClick ?? (step?.advanceOnTargetClick ? step.target : undefined)
        if (!active || !watched || status !== "idle") return
        return subscribeTourPresses(id => {
            if (id === watched) tour.next()
        })
    }, [active, step, status])

    // "Loading…" only after a wait that is felt (F7)
    const [showLoading, setShowLoading] = React.useState(false)
    React.useEffect(() => {
        if (!active || status === "idle") return
        const timer = setTimeout(() => setShowLoading(true), m.wait)
        return () => {
            clearTimeout(timer)
            setShowLoading(false)
        }
    }, [active, status, currentIndex, m.wait])

    // F1: the card's own size, measured invisibly before it is placed
    const [card, setCard] = React.useState<{ id: string, height: number } | null>(null)
    const cardId = step ? `${step.id}:${isModal ? "modal" : "spot"}` : ""
    const measured = card?.id === cardId ? card : null

    // idle: this step's own measured target; getting ready: the last cutout stays where it is (unless its target left)
    const measuredHere = spot?.index === currentIndex
    const hole = !active || !step || targetLost || !spot ? null : status !== "idle" ? spot.rect : isSpotlight && measuredHere ? spot.rect : null
    const travel = useSpotlight(hole, m, reduceMotion)
    // a target that waits for its tap: the ring beats round it once the cutout got there
    const waitsForTap = !!step && status === "idle" && !!hole && (!!step.advanceOnTargetClick || !!step.advanceOnSelectorClick)

    if (!active || !step) return null

    const width = cardWidth(isModal, viewport, step.popoverWidth)
    const passThrough = isSpotlight && status === "idle" && !targetLost && !!hole && !!step.allowTargetInteraction
    const outsideTap = () => {
        if (!step.ignoreOutsideClick) tour.stop()
    }

    let cardPosition: { top: number, left: number } | null = null
    let placement: TourStepPlacement | null = null
    if (status === "idle" && measured) {
        if (isModal) cardPosition = { top: Math.max(16, (viewport.height - measured.height) / 2), left: (viewport.width - width) / 2 }
        else if (hole && measuredHere) {
            placement = resolvePlacement(hole, width, measured.height, step.placement ?? "bottom", viewport)
            cardPosition = computePopoverPosition(hole, width, measured.height, placement, viewport)
        }
    }

    const fade = (duration: number) => FadeIn.duration(duration).reduceMotion(ReduceMotion.System)
    const moves = cardMoves(m, isTablet, reduceMotion, placement)
    return (
        <Animated.View pointerEvents="box-none" style={StyleSheet.absoluteFill} entering={fade(260)}
            exiting={FadeOut.duration(320).reduceMotion(ReduceMotion.System)}>
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <Spotlight viewport={viewport} travel={travel} />
            </View>
            {waitsForTap && hole && !reduceMotion && <TapRing key={`${currentIndex}:${hole.left}:${hole.top}`} hole={hole} m={m} />}

            {/* the taps: the dim strips take them, the cutout lets them through only where the step allows */}
            {passThrough && hole
                ? dimStrips(hole, viewport).map((strip, i) => <Pressable key={i} accessible={false} onPress={outsideTap}
                    style={{ position: "absolute", top: strip.top, left: strip.left, width: strip.width, height: strip.height }} />)
                : <Pressable accessible={false} onPress={outsideTap} style={StyleSheet.absoluteFill} />}

            {showLoading && (
                <View pointerEvents="none" style={StyleSheet.absoluteFill} className="items-center justify-center">
                    <Animated.View entering={fade(200)} className="flex-row items-center gap-3 rounded-xl border border-white/10 bg-gray-900 px-5 py-3">
                        <ActivityIndicator size="small" color={colors.brand400} />
                        <Text className="text-sm text-gray-300">Loading…</Text>
                    </Animated.View>
                </View>
            )}

            {status === "idle" && !measured && (
                // measured where it is not seen: its height places it (F1)
                <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, width, opacity: 0 }}
                    onLayout={event => setCard({ id: cardId, height: event.nativeEvent.layout.height })}>
                    <TourCard step={step} index={currentIndex} total={steps.length} isModal={isModal} moves={null} isTablet={isTablet} />
                </View>
            )}
            {!!cardPosition && (
                <Animated.View key={cardId} entering={isModal ? moves.modalIn : moves.cardIn} exiting={moves.cardOut}
                    style={{ position: "absolute", top: cardPosition.top, left: cardPosition.left, width, transformOrigin: moves.origin }}
                    // a card that rewraps after it was shown is placed again by its new height
                    onLayout={event => {
                        const height = event.nativeEvent.layout.height
                        if (Math.abs(height - (measured?.height ?? 0)) > 0.5) setCard({ id: cardId, height })
                    }}>
                    <TourCard step={step} index={currentIndex} total={steps.length} isModal={isModal} moves={moves} isTablet={isTablet} />
                </Animated.View>
            )}
        </Animated.View>
    )
}

type Travel = { from: Rect, to: Rect }

/**
 * The cutout's way, on the UI thread: from where it is to the new target (a longer way takes a tablet longer, tourTravelMs),
 * out of the target's centre when there was none (iris open), into its centre when it goes (iris close). A new target
 * mid-way starts from where the cutout is.
 */
function useSpotlight(hole: Rect | null, m: TourMotion, reduceMotion: boolean) {
    const travel = useSharedValue<Travel | null>(null)
    const progress = useSharedValue(1)
    const last = React.useRef<Rect | null>(null)

    React.useEffect(() => {
        const current = travel.get()
        const now = current ? mixRect(current.from, current.to, progress.get()) : null
        const shown = last.current
        if (hole && shown && sameRect(shown, hole)) return
        last.current = hole
        const irisEase = Easing.bezier(...(m.irisEase ?? m.travelEase))
        if (!hole) {
            // iris close: into the centre of where it is
            if (!now || now.width <= 0) return
            travel.set({ from: now, to: irisRect(now) })
            progress.set(0)
            progress.set(withTiming(1, { duration: reduceMotion ? 0 : m.iris, easing: irisEase }))
            return
        }
        const opening = !now || now.width <= 0
        const from = opening ? irisRect(hole) : now
        travel.set({ from, to: hole })
        progress.set(0)
        progress.set(withTiming(1, {
            duration: reduceMotion ? 0 : opening ? m.iris : tourTravelMs(m, from, hole),
            easing: opening ? irisEase : Easing.bezier(...m.travelEase),
        }))
    }, [hole, m, reduceMotion, travel, progress])

    return { travel, progress }
}

function Spotlight({ viewport, travel }: { viewport: { width: number, height: number }, travel: ReturnType<typeof useSpotlight> }) {
    const { travel: way, progress } = travel
    const pathProps = useAnimatedProps(() => {
        const w = way.get()
        return { d: spotlightPath(viewport, w ? mixRect(w.from, w.to, progress.get()) : null) }
    })
    const ringProps = useAnimatedProps(() => {
        const w = way.get()
        const r = w ? mixRect(w.from, w.to, progress.get()) : { top: 0, left: 0, width: 0, height: 0 }
        return {
            x: r.left, y: r.top, width: Math.max(0, r.width), height: Math.max(0, r.height),
            rx: Math.max(0, Math.min(8, r.width / 2, r.height / 2)), strokeOpacity: r.width > 2 ? 1 : 0,
        }
    })
    return (
        <Svg width={viewport.width} height={viewport.height}>
            <AnimatedPath animatedProps={pathProps} fillRule="evenodd" fill={DIM} />
            <AnimatedRect animatedProps={ringProps} fill="none" stroke={RING} strokeWidth={2} />
        </Svg>
    )
}

/** The ring round a target that waits for its tap: it grows ~9dp out while it fades, rests, again (TOUR_MOTION.pulse) */
function TapRing({ hole, m }: { hole: Rect, m: TourMotion }) {
    const beat = useSharedValue(0)
    // hidden until the cutout is there (else a still ring stands round the target while the cutout opens)
    const shown = useSharedValue(0)
    React.useEffect(() => {
        const grow = Math.round(m.pulse * 0.55)
        const delay = tourRingDelayMs(m)
        shown.set(withDelay(delay, withTiming(1, { duration: 0 })))
        beat.set(withDelay(delay, withRepeat(withSequence(
            withTiming(1, { duration: grow, easing: Easing.bezier(...PHONE_EASE) }),
            withTiming(0, { duration: 0 }),
            withTiming(0, { duration: m.pulse - grow }),
        ), -1)))
        return () => {
            cancelAnimation(beat)
            cancelAnimation(shown)
        }
    }, [beat, shown, m])
    const style = useAnimatedStyle(() => {
        const b = beat.get()
        const out = TOUR_FINALE.ringGrow * 2 * b
        return {
            opacity: shown.get() * 0.9 * (1 - b),
            transform: [{ scaleX: (hole.width + out) / Math.max(1, hole.width) }, { scaleY: (hole.height + out) / Math.max(1, hole.height) }],
        }
    })
    return (
        <Animated.View pointerEvents="none" style={[{ position: "absolute", top: hole.top, left: hole.left, width: hole.width, height: hole.height,
            borderRadius: Math.min(8, hole.width / 2, hole.height / 2), borderWidth: 2, borderColor: RING }, style]} />
    )
}

type CardMoves = ReturnType<typeof cardMoves>

/**
 * The card's moves (web cardMoves): next to its target it comes out of the target's side (translate cardShift + scale .94,
 * cardDelay into the spotlight's flight; tablet on a spring with a little bounce), a centred card rises with presence
 * (28dp + scale .9); out it goes quicker back towards its target. Reduced motion: the card is simply there.
 */
function cardMoves(m: TourMotion, isTablet: boolean, reduceMotion: boolean, placement: TourStepPlacement | null) {
    const from = placement ? cardEnterFrom(placement, m.cardShift) : { dx: 0, dy: 0, origin: "50% 50%" }
    const instant = FadeIn.duration(0)
    if (reduceMotion) return { cardIn: instant, modalIn: instant, cardOut: FadeOut.duration(0), origin: from.origin, contentDelay: 0, reduce: true }
    const ease = Easing.bezier(...m.ease)
    const spring = isTablet && m.bounce !== undefined
    const move = (to: number, duration: number, delay: number) => {
        "worklet"
        return spring
            ? withDelay(delay, withSpring(to, { duration, dampingRatio: 1 - (m.bounce ?? 0) }))
            : withDelay(delay, withTiming(to, { duration, easing: ease }))
    }
    const enter = (dx: number, dy: number, scale: number, duration: number, delay: number, fadeMs: number) => () => {
        "worklet"
        return {
            initialValues: { opacity: 0, transform: [{ translateX: dx }, { translateY: dy }, { scale }] },
            animations: {
                opacity: withDelay(delay, withTiming(1, { duration: fadeMs, easing: ease })),
                transform: [{ translateX: move(0, duration, delay) }, { translateY: move(0, duration, delay) }, { scale: move(1, duration, delay) }],
            },
        }
    }
    const cardOut = new Keyframe({
        0: { opacity: 1, transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }] },
        100: { opacity: 0, transform: [{ translateX: from.dx / 2 }, { translateY: from.dy / 2 }, { scale: 0.97 }], easing: Easing.in(Easing.quad) },
    }).duration(m.cardOut)
    return {
        cardIn: enter(from.dx, from.dy, 0.94, m.cardIn, m.cardDelay, spring ? Math.round(m.cardIn * 0.6) : m.cardIn),
        modalIn: enter(0, 28, 0.9, m.modalIn, 0, spring ? 240 : m.modalIn),
        cardOut,
        origin: from.origin,
        contentDelay: placement ? m.cardDelay : 0,
        reduce: false,
    }
}

/** A part of a card's content rising 10dp in turn after the one before (tour-rise) */
function rise(m: TourMotion, delay: number) {
    return new Keyframe({
        0: { opacity: 0, transform: [{ translateY: TOUR_FINALE.contentRise }] },
        100: { opacity: 1, transform: [{ translateY: 0 }], easing: Easing.bezier(...m.ease) },
    }).duration(m.part).delay(delay)
}

function TourCard({ step, index, total, isModal, moves, isTablet }: {
    step: TourStep, index: number, total: number, isModal: boolean, isTablet: boolean
    /** null: the invisible copy the card is measured with (no moves) */
    moves: CardMoves | null
}) {
    const t = useTr()
    const m = isTablet ? TOUR_MOTION.tablet : TOUR_MOTION.phone
    const buttons = cardButtons(step, index, total, isModal)
    const last = index === total - 1
    const animate = !!moves && !moves.reduce
    // badge, title, text, buttons one after the other
    const part = (order: number) => animate ? rise(m, moves.contentDelay + order * m.stagger) : undefined
    const first = step.hero ? 1 : 0
    return (
        <View accessibilityViewIsModal className="overflow-hidden rounded-xl border border-white/10 bg-paper"
            style={{ boxShadow: "0 25px 50px rgba(0,0,0,0.5)" }}>
            {!!step.hero && <TourHero kind={step.hero} animate={animate} isTablet={isTablet} delay={moves?.contentDelay ?? 0} />}
            <View className="gap-3 p-4">
                {!!step.title && <Animated.View entering={part(first)}>
                    <Text accessibilityRole="header" className="text-base font-semibold leading-snug text-gray-100">{step.title}</Text>
                </Animated.View>}
                <Animated.View entering={part(first + 1)}>{step.content}</Animated.View>
                {!step.hideControls && (
                    <Animated.View entering={part(first + 2)} className="flex-row flex-wrap items-center justify-between gap-x-3 gap-y-1 pt-1">
                        {total > 1 && (
                            <View accessibilityLabel={t(`Step ${index + 1} of ${total}`, `Schritt ${index + 1} von ${total}`)} className="flex-row items-center gap-1.5">
                                {Array.from({ length: total }, (_, i) => i === index
                                    // the pill moves on from the last step's place
                                    ? <Animated.View key={i} entering={animate && index > 0 ? pillIn(m, moves.contentDelay) : undefined} className="h-1.5 w-5 rounded-full bg-brand-400" />
                                    : <View key={i} className={cn("h-1.5 w-1.5 rounded-full", i < index ? "bg-brand-400/50" : "bg-gray-700")} />)}
                            </View>
                        )}
                        <View className="ml-auto flex-row items-center gap-2">
                            {buttons.skip && (
                                <Pressable accessibilityRole="button" onPress={tour.stop} className="min-h-12 min-w-12 items-center justify-center rounded-full px-3 active:bg-gray-800">
                                    <Text className="text-sm text-gray-400">{t("Skip", "Überspringen")}</Text>
                                </Pressable>
                            )}
                            {buttons.back && (
                                <Pressable accessibilityRole="button" onPress={tour.prev} className="min-h-12 min-w-12 items-center justify-center rounded-full px-3 active:bg-gray-800">
                                    <Text className="text-sm font-medium text-gray-400">{step.prevLabel ?? t("Back", "Zurück")}</Text>
                                </Pressable>
                            )}
                            {buttons.next && (
                                <Pressable accessibilityRole="button" onPress={tour.next} className="min-h-12 items-center justify-center rounded-full bg-brand-500 px-5 active:bg-brand-600">
                                    <Text className="text-sm font-semibold text-white">{step.nextLabel ?? (last ? t("Done", "Fertig") : t("Next", "Weiter"))}</Text>
                                </Pressable>
                            )}
                        </View>
                    </Animated.View>
                )}
            </View>
        </View>
    )
}

function pillIn(m: TourMotion, delay: number) {
    return new Keyframe({
        0: { transform: [{ translateX: -TOUR_FINALE.pillShift }] },
        100: { transform: [{ translateX: 0 }], easing: Easing.bezier(...m.ease) },
    }).duration(m.part).delay(delay)
}

const CHECK_PATH = "M20 6 9 17l-5-5"
const CHECK_LENGTH = 24
const BADGE = 56
const SPARK = 6

/**
 * The badge (TourHero): it lands with a little overshoot (welcome and finale); the finale's check then draws itself and 16
 * sparks fly off the badge's rim on an oval (wider than tall, so none is cut off at the card's edge). Without moves the
 * badge, the drawn check and no sparks are simply there.
 */
function TourHero({ kind, animate, isTablet, delay }: { kind: NonNullable<TourStep["hero"]>, animate: boolean, isTablet: boolean, delay: number }) {
    const f = isTablet ? TOUR_FINALE.tablet : TOUR_FINALE.phone
    const celebrate = kind === "celebrate"
    const drawn = useSharedValue(animate && celebrate ? CHECK_LENGTH : 0)
    React.useEffect(() => {
        if (!animate || !celebrate) return
        drawn.set(withDelay(delay + f.checkDelay, withTiming(0, { duration: f.check, easing: Easing.out(Easing.cubic) })))
    }, [animate, celebrate, delay, f.checkDelay, f.check, drawn])
    const checkProps = useAnimatedProps(() => ({ strokeDashoffset: drawn.get() }))
    const land = animate ? new Keyframe({
        0: { opacity: 0, transform: [{ scale: 0.6 }] },
        100: { opacity: 1, transform: [{ scale: 1 }], easing: Easing.bezier(...POP_EASE) },
    }).duration(f.badge).delay(delay) : undefined
    const sparks = animate && celebrate ? tourSparks(TOUR_FINALE.sparkCount, BADGE / 2 + 8, BADGE / 2 + 2, 22) : []

    return (
        <View className="items-center pt-5">
            <Animated.View entering={land} style={{ width: BADGE, height: BADGE }} className="items-center justify-center rounded-full bg-brand-500">
                {celebrate
                    ? <Svg width={28} height={28} viewBox="0 0 24 24">
                        <AnimatedPath d={CHECK_PATH} stroke="#ffffff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none"
                            strokeDasharray={CHECK_LENGTH} animatedProps={checkProps} />
                    </Svg>
                    : <Sparkles size={26} color="#ffffff" />}
            </Animated.View>
            {sparks.length > 0 && (
                <View pointerEvents="none" style={{ position: "absolute", top: 20 + BADGE / 2, left: "50%" }}>
                    {sparks.map((s, i) => (
                        <Animated.View key={i}
                            entering={new Keyframe({
                                0: { opacity: 0, transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }] },
                                8: { opacity: 1, transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }] },
                                100: { opacity: 0, transform: [{ translateX: s.toX - s.fromX }, { translateY: s.toY - s.fromY }, { scale: 0.4 }], easing: Easing.out(Easing.cubic) },
                            }).duration(f.sparks).delay(delay + f.sparksDelay + s.delay)}
                            // where each ends: gone (the move above leaves it there)
                            style={{ position: "absolute", left: s.fromX - SPARK / 2, top: s.fromY - SPARK / 2, width: SPARK, height: SPARK, borderRadius: SPARK / 2, opacity: 0,
                                backgroundColor: i % 2 ? "#c4b5fd" : "#fde68a" }} />
                    ))}
                </View>
            )}
        </View>
    )
}
