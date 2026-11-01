import { cn } from "@/components/ui/core/styling"
import { tr } from "@/lib/app-language"
import { PHONE_EASE, prefersReducedMotion } from "@/lib/motion"
import { IS_TABLET_UI } from "@/lib/tablet-ui"
import { useLocation } from "@tanstack/react-router"
import { useAtomValue } from "jotai/react"
import { AnimatePresence, cubicBezier, motion } from "motion/react"
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { LuSparkles } from "react-icons/lu"
import { findShown, tourAtom, TourStep, TourStepPlacement, useTour } from "./tour"
import "./tour.css"

type Rect = { top: number; left: number; width: number; height: number }

const EMPTY_RECT: Rect = { top: 0, left: 0, width: 0, height: 0 }

/** Phone: the tour's fixes for touch and Back (target lookup, card measuring, following Back); the tablet keeps the original. */
const PHONE = !IS_TABLET_UI

/**
 * The tour's moves per device (ms). A device without values (null) keeps the original fades; the phone's are measured on
 * the S22 Ultra (Desktop/Seanime-Tutorial-Animationen.md). Everything moves by opacity and transform except the spotlight's
 * cutout, which is redrawn per frame (one path of a full-screen layer, no filter) as nothing else can change its shape.
 */
type TourMotion = {
    // the spotlight gliding from one target to the next, and opening on / closing off a target
    travel: number
    iris: number
    travelEase: [number, number, number, number]
    // a popover sliding out of its target (enter starts this far into the spotlight's travel), and leaving
    cardIn: number
    cardDelay: number
    cardOut: number
    cardShift: number
    // a centred card (welcome, finale) settling in, its parts one after another
    modalIn: number
    part: number
    stagger: number
    ease: string
    // one beat of the ring around a target that waits for a tap
    pulse: number
    // "Loading…" only after this long
    wait: number
}

const TOUR_MOTION: { phone: TourMotion, tablet: TourMotion | null } = {
    phone: {
        travel: 340, iris: 320, travelEase: [.65, 0, .35, 1],
        cardIn: 300, cardDelay: 120, cardOut: 140, cardShift: 18,
        modalIn: 380, part: 300, stagger: 45, ease: PHONE_EASE,
        pulse: 1600, wait: 700,
    },
    tablet: null,
}

const MOTION = IS_TABLET_UI ? TOUR_MOTION.tablet : TOUR_MOTION.phone

function bezier(curve: string) {
    const [a, b, c, d] = curve.match(/[\d.]+/g)!.map(Number)
    return [a, b, c, d] as [number, number, number, number]
}

// rounded-rect cutout (counter-clockwise against the outer rect, for the even-odd fill)
function holePath(r: Rect, radius: number) {
    if (r.width <= 0 || r.height <= 0) return ""
    const q = Math.min(radius, r.width / 2, r.height / 2)
    const x2 = r.left + r.width, y2 = r.top + r.height
    return `M${r.left + q},${r.top} H${x2 - q} Q${x2},${r.top} ${x2},${r.top + q} V${y2 - q} Q${x2},${y2} ${x2 - q},${y2} `
        + `H${r.left + q} Q${r.left},${y2} ${r.left},${y2 - q} V${r.top + q} Q${r.left},${r.top} ${r.left + q},${r.top} Z`
}

const centerOf = (r: Rect): Rect => ({ top: r.top + r.height / 2, left: r.left + r.width / 2, width: 0, height: 0 })
const mix = (a: Rect, b: Rect, p: number): Rect => ({
    top: a.top + (b.top - a.top) * p, left: a.left + (b.left - a.left) * p,
    width: a.width + (b.width - a.width) * p, height: a.height + (b.height - a.height) * p,
})

// The Android app is used by touch: its tour buttons get 48 dp targets and the app-language labels.

// returns a viewport-relative rect with padding applied
function getElementRect(el: Element, padding: number): Rect {
    const r = el.getBoundingClientRect()
    return {
        top: r.top - padding,
        left: r.left - padding,
        width: r.width + padding * 2,
        height: r.height + padding * 2,
    }
}

type PopoverPosition = { top: number; left: number }

function computePopoverPosition(
    targetRect: Rect,
    popoverWidth: number,
    popoverHeight: number,
    placement: TourStepPlacement,
    gap: number = 12,
): PopoverPosition {
    const vw = window.innerWidth
    const vh = window.innerHeight

    let top = 0
    let left = 0

    switch (placement) {
        case "bottom":
            top = targetRect.top + targetRect.height + gap
            left = targetRect.left + targetRect.width / 2 - popoverWidth / 2
            break
        case "top":
            top = targetRect.top - popoverHeight - gap
            left = targetRect.left + targetRect.width / 2 - popoverWidth / 2
            break
        case "left":
            top = targetRect.top + targetRect.height / 2 - popoverHeight / 2
            left = targetRect.left - popoverWidth - gap
            break
        case "right":
            top = targetRect.top + targetRect.height / 2 - popoverHeight / 2
            left = targetRect.left + targetRect.width + gap
            break
    }

    // clamp to viewport
    const margin = 16
    if (left < margin) left = margin
    if (left + popoverWidth > vw - margin) left = vw - margin - popoverWidth
    if (top < margin) top = margin
    if (top + popoverHeight > vh - margin) top = vh - margin - popoverHeight

    return { top, left }
}

// picks the placement with the most available space if preferred doesn't fit
function resolvePlacement(
    targetRect: Rect,
    popoverWidth: number,
    popoverHeight: number,
    preferred: TourStepPlacement,
    gap: number = 12,
): TourStepPlacement {
    const vw = window.innerWidth
    const vh = window.innerHeight

    const spaceTop = targetRect.top - gap
    const spaceBottom = vh - (targetRect.top + targetRect.height + gap)
    const spaceLeft = targetRect.left - gap
    const spaceRight = vw - (targetRect.left + targetRect.width + gap)

    const fits = (p: TourStepPlacement) => {
        switch (p) {
            case "bottom":
                return spaceBottom >= popoverHeight
            case "top":
                return spaceTop >= popoverHeight
            case "left":
                return spaceLeft >= popoverWidth
            case "right":
                return spaceRight >= popoverWidth
        }
    }

    if (fits(preferred)) return preferred

    // fallback: pick the side with most room
    const placements: TourStepPlacement[] = ["bottom", "top", "right", "left"]
    const spaces: Record<TourStepPlacement, number> = {
        bottom: spaceBottom,
        top: spaceTop,
        left: spaceLeft,
        right: spaceRight,
    }

    return placements.sort((a, b) => spaces[b] - spaces[a])[0]
}


// full-screen SVG with a transparent cutout over the target element
function SpotlightOverlay({ rect, onClick, passThrough }: { rect: Rect; onClick?: (e: React.MouseEvent) => void; passThrough?: boolean }) {
    const vw = window.innerWidth
    const vh = window.innerHeight

    const borderRadius = 8
    const r = borderRadius

    // outer rect (CW) + inner rounded-rect cutout (CCW) for even-odd fill
    const outerPath = `M0,0 H${vw} V${vh} H0 Z`
    const innerPath = rect.width > 0 && rect.height > 0
        ? [
            `M${rect.left + r},${rect.top}`,
            `H${rect.left + rect.width - r}`,
            `Q${rect.left + rect.width},${rect.top} ${rect.left + rect.width},${rect.top + r}`,
            `V${rect.top + rect.height - r}`,
            `Q${rect.left + rect.width},${rect.top + rect.height} ${rect.left + rect.width - r},${rect.top + rect.height}`,
            `H${rect.left + r}`,
            `Q${rect.left},${rect.top + rect.height} ${rect.left},${rect.top + rect.height - r}`,
            `V${rect.top + r}`,
            `Q${rect.left},${rect.top} ${rect.left + r},${rect.top} Z`,
        ].join(" ")
        : ""

    return (
        <svg
            // with passThrough only the dimmed area catches taps, the cutout lets them reach the element below
            className={cn("fixed inset-0 z-[1000000]", passThrough ? "pointer-events-none" : "pointer-events-auto")}
            width={vw}
            height={vh}
            style={{ width: vw, height: vh }}
            onClick={onClick}
        >
            <defs>
                <filter id="tour-spotlight-glow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="3" result="blur" />
                    <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                    </feMerge>
                </filter>
            </defs>
            <motion.path
                d={outerPath + " " + innerPath}
                fillRule="evenodd"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                fill="rgba(0, 0, 0, 0.7)"
                style={passThrough ? { pointerEvents: "visiblePainted" } : undefined}
            />
            {/* subtle glow border around the spotlight */}
            {rect.width > 0 && (
                <motion.rect
                    x={rect.left}
                    y={rect.top}
                    width={rect.width}
                    height={rect.height}
                    rx={borderRadius}
                    ry={borderRadius}
                    fill="none"
                    stroke="rgba(166, 135, 244, 0.4)"
                    strokeWidth={2}
                    filter="url(#tour-spotlight-glow)"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.4, delay: 0.1 }}
                />
            )}
        </svg>
    )
}

const sameRect = (a: Rect | null, b: Rect | null) => a === b || (!!a && !!b
    && Math.abs(a.top - b.top) < .5 && Math.abs(a.left - b.left) < .5 && Math.abs(a.width - b.width) < .5 && Math.abs(a.height - b.height) < .5)

/**
 * The spotlight where the device has tour motion: one dim layer for the whole tour instead of one per step. Its cutout glides
 * from one target to the next, opens on a target out of its centre after a centred card and closes back into it before
 * one, and a ring beats around a small target while the step waits for a tap. The glide's clock starts with its first
 * drawn frame and moves on by the frame (a late frame skips nothing), and a new target mid-way glides on from where the
 * cutout is.
 * `rect`: the target, null for no cutout, undefined to stay put (the next step is getting ready).
 * Reduced motion: the cutout moves at once, the ring only fades in and out.
 */
function MotionSpotlight({ rect, stepKey, pulse, passThrough, onClick, m }: {
    rect: Rect | null | undefined
    stepKey: number
    pulse: boolean
    passThrough?: boolean
    onClick?: (e: React.MouseEvent) => void
    m: TourMotion
}) {
    const pathRef = useRef<SVGPathElement>(null)
    const ringRef = useRef<SVGRectElement>(null)
    const pulseRef = useRef<HTMLDivElement>(null)
    const drawn = useRef<Rect | null>(null)
    const glide = useRef<{ from: Rect; to: Rect; end: Rect | null; duration: number; elapsed: number; last: number; raf: number } | null>(null)
    const lastKey = useRef(stepKey)
    // where the cutout came to rest (the beating ring's place)
    const [rest, setRest] = useState<Rect | null>(null)

    const draw = useCallback((r: Rect | null) => {
        drawn.current = r
        const outer = `M0,0 H${window.innerWidth} V${window.innerHeight} H0 Z`
        pathRef.current?.setAttribute("d", r ? `${outer} ${holePath(r, 8)}` : outer)
        const ring = ringRef.current
        if (!ring) return
        ring.setAttribute("opacity", r && r.width > 2 ? "1" : "0")
        if (!r) return
        const q = Math.min(8, r.width / 2, r.height / 2)
        ring.setAttribute("x", String(r.left))
        ring.setAttribute("y", String(r.top))
        ring.setAttribute("width", String(r.width))
        ring.setAttribute("height", String(r.height))
        ring.setAttribute("rx", String(q))
    }, [])

    const run = useCallback((from: Rect, to: Rect, end: Rect | null, duration: number) => {
        if (glide.current) cancelAnimationFrame(glide.current.raf)
        const ease = cubicBezier(...m.travelEase)
        const g = { from, to, end, duration, elapsed: 0, last: -1, raf: 0 }
        const frame = (now: number) => {
            // the clock moves on by the frame, at most 34 ms per frame: a frame late behind a new card's raster or a menu's
            // build does not skip part of the way (the glide takes a little longer instead); the first frame already moves
            g.elapsed += g.last < 0 ? 8 : Math.min(now - g.last, 34)
            g.last = now
            const p = Math.min(1, g.elapsed / g.duration)
            if (p < 1) {
                draw(mix(g.from, g.to, ease(p)))
                g.raf = requestAnimationFrame(frame)
                return
            }
            glide.current = null
            draw(g.end)
            setRest(g.end)
        }
        g.raf = requestAnimationFrame(frame)
        glide.current = g
        setRest(null)
    }, [draw, m])

    // full dim from the first frame, redrawn when the screen turns
    useLayoutEffect(() => {
        draw(null)
        const onResize = () => !glide.current && draw(drawn.current)
        window.addEventListener("resize", onResize)
        return () => {
            window.removeEventListener("resize", onResize)
            if (glide.current) cancelAnimationFrame(glide.current.raf)
        }
    }, [draw])

    const key = rect === undefined ? "hold" : rect ? `${rect.left},${rect.top},${rect.width},${rect.height}` : "none"
    useLayoutEffect(() => {
        if (rect === undefined) return
        const newStep = lastKey.current !== stepKey
        const g = glide.current
        if (!newStep && g) {
            // the same target measured again mid-way (a scroll settling): glide on to where it is now
            if (rect && g.end) {
                g.to = rect
                g.end = rect
            }
            // the screen changed under a glide: close from where it is
            else if (!rect && g.end && drawn.current) run(drawn.current, centerOf(drawn.current), null, m.iris)
            // closing, and a target came after all (the step Back returned to): open on it from where the cutout is
            else if (rect && !g.end && drawn.current) run(drawn.current, rect, rect, m.iris)
            return
        }
        // a glide under way hands over from where the cutout is now
        const from = drawn.current
        // a new step's first render still has the previous target: it counts as new until its own target is measured
        if (sameRect(from, rect)) return
        lastKey.current = stepKey
        // the same target measured again (scrolled, resized) follows at once; opening and closing always play
        if (prefersReducedMotion() || (!newStep && !g && !!from && !!rect)) {
            if (g) cancelAnimationFrame(g.raf)
            glide.current = null
            draw(rect)
            setRest(rect)
            return
        }
        if (!from && rect) run(centerOf(rect), rect, rect, m.iris)
        else if (from && !rect) run(from, centerOf(from), null, m.iris)
        else if (from && rect) run(from, rect, rect, m.travel)
    }, [key, stepKey])

    // the beat: the ring grows ~9px outwards and fades, then waits; reduced motion only fades it. It stops with the tap
    // that ends the step (the cutout holds then), so the tap reads as taken.
    const beat = pulse && rect !== undefined && !!rest && rest.width * rest.height < 40000
    useLayoutEffect(() => {
        const el = pulseRef.current
        if (!beat || !el || !rest || typeof el.animate !== "function") return
        const grow = `scale(${((rest.width + 18) / rest.width).toFixed(3)}, ${((rest.height + 18) / rest.height).toFixed(3)})`
        const run = el.animate(prefersReducedMotion()
            ? [{ opacity: 0, offset: 0 }, { opacity: .8, offset: .3 }, { opacity: 0, offset: .7 }, { opacity: 0, offset: 1 }]
            : [
                { opacity: 0, transform: "none", offset: 0 },
                { opacity: .9, transform: "none", offset: .08, easing: "cubic-bezier(.2, .6, .35, 1)" },
                { opacity: 0, transform: grow, offset: .7 },
                { opacity: 0, transform: grow, offset: 1 },
            ], { duration: m.pulse, iterations: Infinity })
        return () => run.cancel()
    }, [beat, rest])

    return (
        <>
            <motion.svg
                // with passThrough only the dimmed area catches taps, the cutout lets them reach the element below
                className={cn("fixed inset-0 z-[1000000] w-full h-full", passThrough ? "pointer-events-none" : "pointer-events-auto")}
                onClick={onClick}
                // fades in with the tour; it leaves with the whole tour (TourOverlay), not on its own quicker curve
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: .26, ease: "easeOut" }}
            >
                <path ref={pathRef} fillRule="evenodd" fill="rgba(0, 0, 0, 0.7)" style={passThrough ? { pointerEvents: "visiblePainted" } : undefined} />
                <rect ref={ringRef} fill="none" stroke="rgba(166, 135, 244, 0.55)" strokeWidth={2} opacity={0} />
            </motion.svg>
            {beat && rest && <div ref={pulseRef} className="tour-pulse" style={{ left: rest.left, top: rest.top, width: rest.width, height: rest.height, opacity: 0 }} />}
        </>
    )
}

function ModalOverlay({ onClick }: { onClick?: (e: React.MouseEvent) => void }) {
    return (
        <motion.div
            className="fixed inset-0 z-[1000000] bg-black/70 pointer-events-auto"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            onClick={onClick}
        />
    )
}

interface TourCardProps {
    step: TourStep
    currentIndex: number
    totalSteps: number
    style: React.CSSProperties
    onNext: () => void
    onPrev: () => void
    onStop: () => void
    isModal?: boolean
    // devices with tour motion: the card's moves, its parts' delays and the badge
    moves?: CardMoves
}

type CardMoves = {
    m: TourMotion
    reduce: boolean
    motionProps: Pick<React.ComponentProps<typeof motion.div>, "initial" | "animate" | "exit" | "transition">
    origin?: string
    // when the card's first part starts settling in
    partsAt: number
}

/**
 * How a card arrives and leaves where the device has tour motion: a centred card rises and grows into place with presence;
 * a popover slides out of its target (from the side it sits on, scaling from that edge) once the spotlight is almost there,
 * and sinks back towards it, quicker, when its step ends. Reduced motion: fades only.
 */
function cardMoves(m: TourMotion, isModal: boolean, placement: TourStepPlacement): CardMoves {
    const reduce = prefersReducedMotion()
    const ease = bezier(m.ease)
    if (reduce) return {
        m, reduce, partsAt: 0, motionProps: {
            initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0, transition: { duration: m.cardOut / 1000 } },
            transition: { duration: .2, ease: "easeOut" },
        },
    }
    if (isModal) return {
        m, reduce, partsAt: 90, motionProps: {
            initial: { opacity: 0, transform: "translateY(28px) scale(0.9)" },
            animate: { opacity: 1, transform: "translateY(0px) scale(1)", transitionEnd: { transform: "none" } },
            exit: { opacity: 0, transform: ["translateY(0px) scale(1)", "translateY(0px) scale(0.96)"], transition: { duration: m.cardOut / 1000, ease } },
            transition: { duration: m.modalIn / 1000, ease },
        },
    }
    const s = m.cardShift
    const [dx, dy] = placement === "bottom" ? [0, -s] : placement === "top" ? [0, s] : placement === "left" ? [s, 0] : [-s, 0]
    return {
        m, reduce, partsAt: m.cardDelay + 60,
        origin: placement === "bottom" ? "50% 0%" : placement === "top" ? "50% 100%" : placement === "left" ? "100% 50%" : "0% 50%",
        motionProps: {
            initial: { opacity: 0, transform: `translate(${dx}px, ${dy}px) scale(0.94)` },
            animate: { opacity: 1, transform: "translate(0px, 0px) scale(1)", transitionEnd: { transform: "none" } },
            exit: {
                opacity: 0, transform: ["translate(0px, 0px) scale(1)", `translate(${dx / 2}px, ${dy / 2}px) scale(0.97)`],
                transition: { duration: m.cardOut / 1000, ease },
            },
            transition: { duration: m.cardIn / 1000, delay: m.cardDelay / 1000, ease },
        },
    }
}

/**
 * The badge above a welcome or finale card: it lands with a slight overshoot; on the finale a check mark draws itself in
 * it and sparks fly out of it once (opacity and transform, gone after 0.9 s). Reduced motion: the badge fades in, drawn.
 */
function TourHero({ kind, moves }: { kind: "intro" | "celebrate"; moves: CardMoves }) {
    const ref = useRef<HTMLDivElement>(null)
    useLayoutEffect(() => {
        const host = ref.current
        if (kind !== "celebrate" || moves.reduce || !host || typeof host.animate !== "function") return
        const sparks = Array.from(host.querySelectorAll<HTMLElement>(".tour-spark"))
        const runs = sparks.map((spark, i) => {
            const angle = (i / sparks.length) * Math.PI * 2 - Math.PI / 2 + (i % 2 ? .2 : 0)
            // out of the badge's edge on a wide oval (the card's top edge is 3.25rem above the badge's centre)
            const [rx, ry] = i % 2 ? [62, 38] : [88, 50]
            const end = `translate(${Math.round(Math.cos(angle) * rx)}px, ${Math.round(Math.sin(angle) * ry)}px) scale(0.4)`
            return spark.animate([
                { opacity: 1, transform: "translate(0px, 0px) scale(1)", offset: 0, easing: "cubic-bezier(.2, .6, .35, 1)" },
                { opacity: 1, offset: .55 },
                { opacity: 0, transform: end, offset: 1 },
            ], { duration: 620, delay: moves.partsAt + 200 + (i % 3) * 25 })
        })
        return () => runs.forEach(run => run.cancel())
    }, [kind, moves])
    return (
        <div ref={ref} className="tour-hero" data-kind={kind}>
            <div className="tour-badge" style={{ animationDelay: `${moves.partsAt}ms` }}>
                {kind === "celebrate"
                    ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path className="tour-check" pathLength={1} d="M5 12.5l4.5 4.5L19 7.5" style={{ animationDelay: `${moves.partsAt + 220}ms` }} />
                    </svg>
                    : <LuSparkles aria-hidden />}
            </div>
            {kind === "celebrate" && !moves.reduce && Array.from({ length: 16 }, (_, i) => <span key={i} className="tour-spark" aria-hidden />)}
        </div>
    )
}

const TourCard = React.forwardRef<HTMLDivElement, TourCardProps>(
    ({ step, currentIndex, totalSteps, style, onNext, onPrev, onStop, isModal, moves }, ref) => {
        const isFirstStep = currentIndex === 0
        const isLastStep = currentIndex === totalSteps - 1
        // phone: a step done by tapping its target that fell back to a centred card (target not found) gets Next, or it would be a dead end
        const hideNext = step.hideNextButton && !(PHONE && isModal)
        const showBack = !isFirstStep && !step.disableBack && !hideNext
        // devices with tour motion: the badge, title, text and buttons settle in one after another
        // (after the badge, when there is one)
        let partIndex = moves && step.hero ? 1 : 0
        const part = () => moves
            ? { className: "tour-part", style: { animationDelay: `${moves.partsAt + moves.m.stagger * partIndex++}ms` } }
            : {}

        const content = (
            <motion.div
                ref={ref}
                data-tour-card
                className={cn(
                    "z-[1000001] pointer-events-auto",
                    "rounded-xl border bg-[--paper] shadow-2xl",
                    "flex flex-col overflow-hidden",
                )}
                style={{
                    ...style,
                    maxWidth: "calc(100vw - 32px)",
                    ...(isModal ? {} : { position: "fixed" as const }),
                    ...(moves?.origin ? { transformOrigin: moves.origin } : {}),
                }}
                {...(moves ? moves.motionProps : {
                    initial: { opacity: 0, scale: 0.95, y: 8 },
                    animate: { opacity: 1, scale: 1, y: 0 },
                    exit: { opacity: 0, scale: 0.95, y: 8 },
                    transition: { duration: 0.25, ease: [0.23, 1, 0.32, 1] },
                })}
            >
                {step.image && (
                    <div className="w-full overflow-hidden rounded-t-xl">
                        {step.image}
                    </div>
                )}

                {moves && step.hero && <TourHero kind={step.hero} moves={moves} />}

                <div className="p-4 flex flex-col gap-3">
                    {step.title && (
                        <div className="font-semibold text-base text-gray-100 leading-snug" data-tour-title {...part()}>
                            {step.title}
                        </div>
                    )}

                    <div className="text-sm text-[--muted] leading-relaxed" {...part()}>
                        {step.content}
                    </div>

                    {!step.hideControls && (
                        <div className={cn("flex items-center justify-between pt-1 gap-3", "flex-wrap gap-y-1", moves && "tour-part")}
                            style={moves ? part().style : undefined}>
                            {totalSteps > 1 && (
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                    {Array.from({ length: totalSteps }).map((_, i) => (
                                        <span
                                            key={i}
                                            className={cn(
                                                "inline-block rounded-full transition-all duration-300",
                                                i === currentIndex
                                                    ? "w-5 h-1.5 bg-brand-400"
                                                    : i < currentIndex
                                                        ? "w-1.5 h-1.5 bg-brand-400/50"
                                                        : "w-1.5 h-1.5 bg-gray-700",
                                                // the pill moves on from the previous step's place
                                                moves && i === currentIndex && i > 0 && "tour-dot-on",
                                            )}
                                            style={moves && i === currentIndex ? { animationDelay: `${moves.partsAt + 120}ms` } : undefined}
                                        />
                                    ))}
                                </div>
                            )}

                            <div className="flex items-center gap-2 ml-auto">
                                {!isLastStep && (
                                    <button
                                        onClick={onStop}
                                        data-tour-skip
                                        className={cn(
                                            "text-xs text-gray-500 hover:text-gray-300 transition-colors",
                                            "px-2 py-1 rounded-md hover:bg-gray-800",
                                            "min-h-12 min-w-12 px-3 text-sm text-gray-400 rounded-full",
                                        )}
                                    >
                                        {tr("Skip", "Überspringen")}
                                    </button>
                                )}

                                {showBack && (
                                    <button
                                        onClick={onPrev}
                                        data-tour-back
                                        className={cn(
                                            "text-sm font-medium text-gray-400 hover:text-gray-200 transition-colors",
                                            "px-3 py-1.5 rounded-lg hover:bg-gray-800",
                                            "min-h-12 min-w-12 rounded-full",
                                        )}
                                    >
                                        {step.prevLabel ?? tr("Back", "Zurück")}
                                    </button>
                                )}

                                {!hideNext && <button
                                    onClick={onNext}
                                    data-tour-next
                                    className={cn(
                                        "text-sm font-semibold rounded-lg px-4 py-1.5 transition-all",
                                        "bg-brand-500 hover:bg-brand-600 text-white",
                                        "min-h-12 px-5 rounded-full",
                                    )}
                                >
                                    {step.nextLabel ?? (isLastStep ? tr("Done", "Fertig") : tr("Next", "Weiter"))}
                                </button>}
                            </div>
                        </div>
                    )}
                </div>
            </motion.div>
        )

        // modal mode: wrap in a fixed centering container so framer-motion's
        // transform doesn't conflict with CSS centering
        if (isModal) {
            return (
                <div className="fixed inset-0 z-[1000001] flex items-center justify-center pointer-events-none px-4">
                    {content}
                </div>
            )
        }

        return content
    },
)

TourCard.displayName = "TourCard"

// delayed: devices with tour motion show it only for a wait that is felt (tour.css .tour-loading), without AnimatePresence
function TourLoadingIndicator({ delayed }: { delayed?: boolean }) {
    return (
        <motion.div
            className={cn("fixed inset-0 z-[1000002] flex items-center justify-center pointer-events-none", delayed && "tour-loading")}
            initial={delayed ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
        >
            <div className="flex items-center gap-3 rounded-xl bg-gray-900 border border-[rgba(255,255,255,0.1)] px-5 py-3 shadow-xl">
                <svg
                    className="animate-spin h-4 w-4 text-brand-400"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                >
                    <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                    />
                    <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                </svg>
                <span className="text-sm text-gray-300">Loading…</span>
            </div>
        </motion.div>
    )
}

export function TourOverlay() {
    const tourState = useAtomValue(tourAtom)
    const { active, currentStep, currentIndex, totalSteps, status, next, prev, stop, goTo } = useTour()
    const stateRef = useRef(tourState)
    stateRef.current = tourState

    const cardRef = useRef<HTMLDivElement>(null)

    const [targetRect, setTargetRect] = useState<Rect>(EMPTY_RECT)
    const [cardSize, setCardSize] = useState({ width: 0, height: 0 })

    const isSpotlightStep = !!currentStep?.target
    const isModalStep = !currentStep?.target && active && status === "idle"
    const isLoading = active && status !== "idle"

    // measure the card so we can position it
    useLayoutEffect(() => {
        if (!cardRef.current) return
        const { width, height } = cardRef.current.getBoundingClientRect()
        setCardSize((prev) => {
            if (prev.width === width && prev.height === height) return prev
            return { width, height }
        })
    }, [currentStep?.id, status])

    // phone: measured as each card mounts (before it is painted, by its layout size), so a card is placed by its own height,
    // not by the previous card's, which was still leaving when the effect above measured
    // and again when its text wraps differently after mounting
    const cardObserver = useRef<ResizeObserver | null>(null)
    const measureCard = useCallback((el: HTMLDivElement | null) => {
        if (!el) return
        cardRef.current = el
        const measure = () => {
            const width = el.offsetWidth, height = el.offsetHeight
            setCardSize((prev) => prev.width === width && prev.height === height ? prev : { width, height })
        }
        measure()
        cardObserver.current?.disconnect()
        cardObserver.current = new ResizeObserver(measure)
        cardObserver.current.observe(el)
    }, [])
    useEffect(() => () => cardObserver.current?.disconnect(), [])

    // phone: when the target is gone for good (Back closed the menu or the sheet, or left the tab), return to the latest
    // earlier step whose target is on screen, or end the tour if there is none
    const followBack = useRef(() => {})
    followBack.current = () => {
        const { steps, currentIndex: at, active: on } = stateRef.current
        if (!on) return
        for (let i = at - 1; i >= 0; i--) {
            const target = steps[i].target
            if (target && findShown(target)) return goTo(steps[i].id)
        }
        stop()
    }

    const backAt = useRef(0)

    // phone: Back on a centred card (welcome, finale, a step whose target never came) closes the tour instead of leaving the
    // screen behind it; on a spotlight step the app goes back as usual and the tour follows (below)
    useEffect(() => {
        if (!PHONE || !active) return
        const onBack = (e: Event) => {
            const { steps, currentIndex: at } = stateRef.current
            if (steps[at]?.target) {
                // the sheet or page under the cutout is about to go: no cutout to tap through meanwhile
                backAt.current = Date.now()
                setTargetLost(true)
                return
            }
            e.preventDefault()
            stop()
        }
        window.addEventListener("seanime:android-back", onBack)
        return () => window.removeEventListener("seanime:android-back", onBack)
    }, [active, stop])

    // phone: the step the target rect was measured for (a new step's first render still has the previous one)
    const rectStep = useRef(-1)
    // phone: the target went away (Back closed the menu): no cutout to tap through while the tour decides where to go
    const [targetLost, setTargetLost] = useState(false)

    // phone: track the target like below, but look it up as shown (the closed menu keeps hidden rows), find it again when the
    // page rebuilt it (the menu reopened) and follow Back when it is gone for good
    useEffect(() => {
        if (!PHONE) return
        if (!active || !currentStep?.target || status !== "idle") {
            setTargetRect(EMPTY_RECT)
            return
        }

        const selector = currentStep.target
        const padding = currentStep.spotlightPadding ?? 8
        let el = findShown(selector)
        setTargetLost(false)

        const update = () => {
            const box = el?.isConnected && el.matches(selector) ? getElementRect(el, padding) : null
            // a removed or hidden target keeps its last place (the watch below handles it)
            if (!box || box.width <= padding * 2 || box.height <= padding * 2) return
            rectStep.current = currentIndex
            setTargetRect(box)
        }
        // centred first, measured after
        el?.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" })
        update()
        const rescroll = setTimeout(() => {
            if (el?.isConnected) el.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" })
            update()
        }, 350)

        let rafId = 0
        const onLayout = () => {
            cancelAnimationFrame(rafId)
            rafId = requestAnimationFrame(update)
        }
        window.addEventListener("scroll", onLayout, true)
        window.addEventListener("resize", onLayout)
        const ro = new ResizeObserver(onLayout)
        if (el) ro.observe(el)

        let missingMs = 0
        const watch = setInterval(() => {
            // gone, hidden, or no longer matching (a closing sheet is still in the page for its exit, but no longer "open")
            const box = el?.isConnected && el.matches(selector) ? el.getBoundingClientRect() : null
            if (box && box.width > 0 && box.height > 0) {
                // just after Back the target may still be leaving (a closing sheet): decide once it had the time
                if (Date.now() - backAt.current < 450) return
                if (missingMs) update()
                missingMs = 0
                setTargetLost(false)
                return
            }
            const again = findShown(selector)
            if (again) {
                el = again
                ro.disconnect()
                ro.observe(again)
                missingMs = 0
                setTargetLost(false)
                update()
                return
            }
            setTargetLost(true)
            missingMs += 100
            if (missingMs >= 500) {
                clearInterval(watch)
                followBack.current()
            }
        }, 100)

        return () => {
            clearTimeout(rescroll)
            clearInterval(watch)
            cancelAnimationFrame(rafId)
            window.removeEventListener("scroll", onLayout, true)
            window.removeEventListener("resize", onLayout)
            ro.disconnect()
        }
    }, [active, currentStep?.target, currentStep?.spotlightPadding, status, currentIndex])

    // track the target element's rect (scroll + resize)
    useEffect(() => {
        if (PHONE) return
        if (!active || !currentStep?.target || status !== "idle") {
            setTargetRect(EMPTY_RECT)
            return
        }

        const el = document.querySelector(currentStep.target)
        if (!el) {
            setTargetRect(EMPTY_RECT)
            return
        }

        const padding = currentStep.spotlightPadding ?? 8

        const update = () => {
            setTargetRect(getElementRect(el, padding))
        }

        update()

        // scroll the element into view
        // center it so the popover card has room above or below; repeat once in case a re-render
        // (e.g. a filtered list shrinking) moved it after the first scroll
        el.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" })
        const rescroll = setTimeout(() => {
            if (el.isConnected) el.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" })
            update()
        }, 350)

        // re-measure on scroll/resize via RAF throttle
        let rafId = 0
        const onLayout = () => {
            cancelAnimationFrame(rafId)
            rafId = requestAnimationFrame(update)
        }

        window.addEventListener("scroll", onLayout, true)
        window.addEventListener("resize", onLayout)

        const ro = new ResizeObserver(onLayout)
        ro.observe(el)

        return () => {
            clearTimeout(rescroll)
            cancelAnimationFrame(rafId)
            window.removeEventListener("scroll", onLayout, true)
            window.removeEventListener("resize", onLayout)
            ro.disconnect()
        }
    }, [active, currentStep?.target, currentStep?.spotlightPadding, status, currentIndex])

    // prevent background scroll while tour is active
    useEffect(() => {
        if (!active) return
        const original = document.body.style.overflow
        document.body.style.overflow = "hidden"
        return () => {
            document.body.style.overflow = original
        }
    }, [active])

    // advanceOnTargetClick / advanceOnSelectorClick
    // listen on the document in the capture phase and match by selector, so it still works when the
    // element is re-rendered (e.g. the Android floating menu rebuilds its rows) or stops propagation
    useEffect(() => {
        const selector = currentStep?.advanceOnSelectorClick
            ?? (currentStep?.advanceOnTargetClick ? currentStep.target : undefined)
        if (!active || !selector || status !== "idle") return

        const handler = (e: MouseEvent) => {
            if ((e.target as Element | null)?.closest?.(selector)) next()
        }
        document.addEventListener("click", handler, true)
        return () => document.removeEventListener("click", handler, true)
    }, [active, currentStep?.advanceOnSelectorClick, currentStep?.advanceOnTargetClick, currentStep?.target, status, next])

    // popover positioning
    const popoverWidth = typeof currentStep?.popoverWidth === "number"
        ? currentStep.popoverWidth
        : typeof currentStep?.popoverWidth === "string"
            ? parseInt(currentStep.popoverWidth, 10) || 340
            : isModalStep
                ? 440
                : 340

    const resolvedPlacement = useMemo(() => {
        if (!isSpotlightStep || targetRect === EMPTY_RECT) return "bottom" as TourStepPlacement
        return resolvePlacement(
            targetRect,
            popoverWidth,
            cardSize.height || 200,
            currentStep?.placement ?? "bottom",
        )
    }, [isSpotlightStep, targetRect, popoverWidth, cardSize.height, currentStep?.placement])

    const popoverPos = useMemo(() => {
        if (!isSpotlightStep || targetRect === EMPTY_RECT) return { top: 0, left: 0 }
        return computePopoverPosition(
            targetRect,
            popoverWidth,
            cardSize.height || 200,
            resolvedPlacement,
        )
    }, [isSpotlightStep, targetRect, popoverWidth, cardSize.height, resolvedPlacement])

    // devices with tour motion: the page the step was shown on. When the tap that ends a step opens another screen, the
    // cutout closes into its target while that screen loads instead of standing over unrelated content, and opens again
    // on the next target
    const { pathname } = useLocation()
    const shownOn = useRef(pathname)
    useEffect(() => {
        if (status === "idle") shownOn.current = pathname
    }, [status, pathname])

    // devices with tour motion: how this step's card moves (once per step, so its badge's sparks fly once)
    const cardMotion = useMemo(() => MOTION && currentStep ? cardMoves(MOTION, isModalStep, resolvedPlacement) : undefined,
        [currentStep, isModalStep, resolvedPlacement])

    const handleOverlayClick = useCallback((e: React.MouseEvent) => {
        if (currentStep?.ignoreOutsideClick) return
        // don't close if clicking inside the spotlight hole
        if (isSpotlightStep && targetRect.width > 0) {
            const x = e.clientX
            const y = e.clientY
            if (
                x >= targetRect.left &&
                x <= targetRect.left + targetRect.width &&
                y >= targetRect.top &&
                y <= targetRect.top + targetRect.height
            ) {
                return
            }
        }
        stop()
    }, [isSpotlightStep, targetRect, stop, currentStep?.ignoreOutsideClick])

    if (MOTION) {
        // the cutout stays where it is while the next step gets ready, and while its target is still being measured
        const spotRect = status !== "idle"
            ? (pathname !== shownOn.current ? null : undefined)
            : isSpotlightStep ? (targetLost ? null : targetRect.width > 0 && rectStep.current === currentIndex ? targetRect : undefined) : null
        const moves = cardMotion
        return (
            <AnimatePresence>
                {active && (
                    <motion.div
                        key="tour-container"
                        // its own top layer: while it fades out (opacity < 1) it stays above the page instead of dropping
                        // under the app's raised layers
                        className="tour-overlay-root tour-m fixed inset-0 z-[1000000] pointer-events-none"
                        style={{ "--tour-part": `${MOTION.part}ms`, "--tour-ease": MOTION.ease, "--tour-wait": `${MOTION.wait}ms` } as React.CSSProperties}
                        // Skip, Done and Back leave together: the dim, the card and the ring fade out
                        exit={{ opacity: 0, transition: { duration: .32, ease: "easeInOut" } }}
                    >
                        {/* fades in late (tour.css) and goes at once: an exit would first show it at full opacity */}
                        {isLoading && <TourLoadingIndicator key="tour-loading" delayed />}

                        <MotionSpotlight
                            rect={spotRect}
                            stepKey={currentIndex}
                            pulse={!!currentStep?.target && (!!currentStep.advanceOnTargetClick || !!currentStep.advanceOnSelectorClick)}
                            onClick={handleOverlayClick}
                            passThrough={isSpotlightStep && status === "idle" && !targetLost && currentStep?.allowTargetInteraction}
                            m={MOTION}
                        />

                        <AnimatePresence mode="wait">
                            {status === "idle" && currentStep && (
                                <TourCard
                                    key={`card-${currentStep.id}`}
                                    ref={measureCard}
                                    step={currentStep}
                                    currentIndex={currentIndex}
                                    totalSteps={totalSteps}
                                    onNext={next}
                                    onPrev={prev}
                                    onStop={stop}
                                    isModal={isModalStep}
                                    moves={moves}
                                    style={
                                        isModalStep
                                            ? { width: popoverWidth }
                                            : {
                                                top: popoverPos.top,
                                                left: popoverPos.left,
                                                width: popoverWidth,
                                            }
                                    }
                                />
                            )}
                        </AnimatePresence>
                    </motion.div>
                )}
            </AnimatePresence>
        )
    }

    if (!active) return null

    return (
        <AnimatePresence mode="wait">
            {active && (
                <div key="tour-container" className="tour-overlay-root">
                    <AnimatePresence>
                        {isLoading && <TourLoadingIndicator key="tour-loading" />}
                    </AnimatePresence>

                    <AnimatePresence mode="wait">
                        {status === "idle" && (
                            isSpotlightStep ? (
                                <SpotlightOverlay
                                    key={`spotlight-${currentIndex}`}
                                    rect={targetRect}
                                    onClick={handleOverlayClick}
                                    passThrough={currentStep?.allowTargetInteraction}
                                />
                            ) : (
                                <ModalOverlay
                                    key={`modal-overlay-${currentIndex}`}
                                    onClick={handleOverlayClick}
                                />
                            )
                        )}
                    </AnimatePresence>

                    <AnimatePresence mode="wait">
                        {status === "idle" && currentStep && (
                            <TourCard
                                key={`card-${currentStep.id}`}
                                ref={cardRef}
                                step={currentStep}
                                currentIndex={currentIndex}
                                totalSteps={totalSteps}
                                onNext={next}
                                onPrev={prev}
                                onStop={stop}
                                isModal={isModalStep}
                                style={
                                    isModalStep
                                        ? { width: popoverWidth }
                                        : {
                                            top: popoverPos.top,
                                            left: popoverPos.left,
                                            width: popoverWidth,
                                        }
                                }
                            />
                        )}
                    </AnimatePresence>
                </div>
            )}
        </AnimatePresence>
    )
}
