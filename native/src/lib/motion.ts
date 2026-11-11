/**
 * The app's motion values, from the web app's lib/motion.ts, lib/motion.css, components/shared/mobile-surface.css,
 * lib/entry-cover-transition.ts, segment-glide.ts, UIBottomNav.kt and the tour (TOUR_MOTION in tour-overlay.tsx). Only the
 * values and the pure rules live here; the moves are Reanimated animations on the UI thread (components/ui/core/animations.ts,
 * glide.tsx, swap.ts, page-transition.tsx, components/shared/cover-flight.tsx, the tour overlay).
 *
 * Rules that came with them:
 *   - Phone: only opacity and transform move. The S22 rasterises a newly opened surface for 150-200 ms and gets a frame
 *     only every 30-40 ms meanwhile, so its curve (PHONE_EASE) starts gently and the movement is not spent by then.
 *   - Tablet: the strong ease-out, mostly 220 ms.
 *   - Reduced motion: transitions finish at once (Reanimated's ReduceMotion.System); fades may still fade.
 */
export type Bezier = readonly [number, number, number, number]

/** --m-out: strong ease-out (tablet, popovers) */
export const MOTION_EASE_OUT: Bezier = [0.23, 1, 0.32, 1]
/** --m-phone: the phone's gentler curve */
export const PHONE_EASE: Bezier = [0.2, 0.6, 0.35, 1]
/** Drawer curve of the side sheets and the docked long-press menu */
export const DRAWER_EASE: Bezier = [0.32, 0.72, 0, 1]
/** The toast's success check popping in */
export const POP_EASE: Bezier = [0.34, 1.56, 0.64, 1]
/** The bottom bar's menu panel on a tablet settles on DRAWER_EASE; on a phone on PHONE_EASE (UIBottomNav.kt) */
export const MENU_EASE = { phone: PHONE_EASE, tablet: DRAWER_EASE } as const

export function enterEase(isTablet: boolean): Bezier {
    return isTablet ? MOTION_EASE_OUT : PHONE_EASE
}

export function cssBezier(curve: Bezier) {
    return `cubic-bezier(${curve.join(", ")})`
}

/** ms */
export const DURATION = {
    /** content replaced in place rises in (useSwap / usePhoneSwap) */
    swapPhone: 260,
    swapTablet: 220,
    /** a phone sheet or big dialog opening */
    sheetPhone: 320,
    /** the docked long-press menu (action sheet) */
    actionSheet: 220,
    /** popovers and menus out of what was tapped */
    popoverIn: 180,
    popoverOut: 120,
    /** the phone bar leaves as quickly as a sheet closes; it fades in over 250 ms */
    navFadeIn: 250,
    navFadeOutPhone: 160,
    /** the bar's menu panel */
    menuInPhone: 320,
    menuInTablet: 300,
    /** a press gives way, a switch flips its colour */
    press: 160,
    toggle: 180,
    rowHighlight: 200,
    /** loading placeholder gives way: content fades in, covers rise in a cascade */
    revealFade: 200,
    revealItem: 280,
    revealStep: 28,
    /** a new list item or block rises in */
    rise: 240,
    unfold: 220,
    settle: 220,
    toastCheck: 360,
    toastCheckDelay: 80,
} as const

/** Cover → page: hold for the header picture at most WAIT_MS from when the page is built, the whole hold at most MAX_WAIT_MS */
export const WAIT_MS = 250
export const MAX_WAIT_MS = 450
/** …unless the page still loads its data (first visit after a start: ~0.6 s on the S22): then the copy waits up to this */
export const LOAD_MAX_WAIT_MS = 1200

/** Lists cascade at most this many items */
export const REVEAL_MAX = 14

/** dp distances (rem × 16) */
export const DISTANCE = {
    swap: 6,
    step: 24,
    reveal: 10,
    rise: 8,
    unfold: 6,
    sideEnter: 16,
    actionSheetRise: 16,
    menuRise: 18,
} as const

/** Scales */
export const SCALE = {
    press: 0.97,
    pressCard: 0.985,
    popoverEnter: 0.95,
    popoverExit: 0.97,
    menuEnter: 0.94,
    settle: 0.96,
    pop: 0.5,
    toastCheckFrom: 0.4,
} as const

export type TourMotion = {
    travel: number, travelPerPx?: number, travelMax?: number, iris: number, travelEase: Bezier, irisEase?: Bezier,
    cardIn: number, cardDelay: number, cardOut: number, cardShift: number, bounce?: number,
    modalIn: number, part: number, stagger: number, ease: Bezier, pulse: number, wait: number,
}

/** The first-start tour, per device (tour-overlay.tsx TOUR_MOTION) */
export const TOUR_MOTION: { phone: TourMotion, tablet: TourMotion } = {
    phone: {
        travel: 340, iris: 320, travelEase: [0.65, 0, 0.35, 1],
        cardIn: 300, cardDelay: 120, cardOut: 140, cardShift: 18,
        modalIn: 380, part: 300, stagger: 45, ease: PHONE_EASE,
        pulse: 1600, wait: 700,
    },
    tablet: {
        travel: 240, travelPerPx: 0.17, travelMax: 380, iris: 300, travelEase: [0.77, 0, 0.175, 1], irisEase: [0.32, 0.72, 0, 1],
        cardIn: 340, cardDelay: 140, cardOut: 120, cardShift: 22, bounce: 0.2,
        modalIn: 400, part: 260, stagger: 40, ease: MOTION_EASE_OUT,
        pulse: 1500, wait: 700,
    },
}

/** Swap timing of content replaced in place, per device; a page coming in uses the same (page-transition.ts) */
export function swapTiming(isTablet: boolean) {
    return isTablet
        ? { duration: DURATION.swapTablet, ease: MOTION_EASE_OUT }
        : { duration: DURATION.swapPhone, ease: PHONE_EASE }
}

/**
 * Where a page's rise starts (page-transition.tsx). A hidden page rests where it stands (0): the cover's way back measures
 * its card while the card's page is still hidden, and a page parked 6dp low made it land 6dp under the card and jump up at
 * the end. Coming in, the page rises from DISTANCE.swap; under a cover flight it only fades.
 */
export function pageRiseFrom(focused: boolean, coverFlying: boolean) {
    return focused && !coverFlying ? DISTANCE.swap : 0
}

/**
 * A picture that was not there when its frame was drawn fades in (sea-image.tsx: 220 ms ease-out); one from the cache shows
 * at once, so a revisited screen does not fade its covers again. expo-image's `transition` prop.
 */
export const IMAGE_FADE = { duration: 220, effect: "cross-dissolve", timing: "ease-out", skipOnCacheHit: "all" } as const

/** A box in dp: a switch's option inside its switch, a cover in the window */
export type Box = { x: number, y: number, width: number, height: number }

/**
 * segment-glide.ts: the chosen option's bubble glides to the new option on transform alone, 280 ms (phone curve; tablet the
 * drawer curve). Options of another size are reached by scaling from the old one's size; past maxScale the stretched round
 * ends would show, so the bubble then appears at the new option (180 ms) instead.
 */
export const GLIDE = { duration: 280, appear: 180, maxScale: 1.33, easePhone: PHONE_EASE, easeTablet: DRAWER_EASE } as const

export type GlidePlan = "jump" | "glide" | "appear"

/** How the bubble reaches `to`: at once (first layout, nothing to come from, reduced motion), gliding, or appearing there */
export function glidePlan(from: Box | null, to: Box, reduceMotion: boolean): GlidePlan {
    if (reduceMotion || !from || to.width < 1 || to.height < 1 || from.width < 1 || from.height < 1) return "jump"
    const scaleX = from.width / to.width, scaleY = from.height / to.height
    return Math.max(scaleX, 1 / scaleX, scaleY, 1 / scaleY) <= GLIDE.maxScale ? "glide" : "appear"
}

/** Where a switch's bubble stood when its switch was built anew (My lists: Anime | Manga), at `at` ms */
export type GlideLeft = { key: string, box: Box, at: number }

/** A switch rebuilt for the choice it made takes over its old bubble within this many ms of the old one going */
export const GLIDE_HANDOFF_MS = 1000

/**
 * The bubble a switch built anew starts from: where its predecessor left it, when that was just now and on another option
 * (the choice that rebuilt it); else none, and the bubble starts at its option.
 */
export function glideHandoff(left: GlideLeft | null | undefined, selected: string | null, now: number): GlideLeft | null {
    if (!left || selected === null || left.key === selected || now - left.at > GLIDE_HANDOFF_MS) return null
    return left
}

/**
 * The transform that puts a view laid out at `base` on `box`, scaled around its centre (React Native's transform origin):
 * the bubble and the flying cover move on transform alone.
 */
export function boxTransform(base: Box, box: Box) {
    "worklet"
    return {
        translateX: box.x + box.width / 2 - (base.x + base.width / 2),
        translateY: box.y + box.height / 2 - (base.y + base.height / 2),
        scaleX: base.width > 0 ? box.width / base.width : 1,
        scaleY: base.height > 0 ? box.height / base.height : 1,
    }
}

/** A box on the way from `a` to `b` (t 0…1): the glide and the cover flight interpolate the box, the transform follows */
export function mixBox(a: Box, b: Box, t: number): Box {
    "worklet"
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, width: a.width + (b.width - a.width) * t, height: a.height + (b.height - a.height) * t }
}

/**
 * Cover → page (entry-cover-transition.ts/.css): the tapped cover flies into the page header's cover, 420 ms on a gentle start
 * on the phone, 340 ms on the drawer curve on a tablet. With no header picture in time it fades out where it is (120 ms).
 * The way back (page → cover, Back) flies the same way.
 */
export const COVER_FLIGHT = {
    phone: { duration: 420, ease: [0.5, 0, 0.2, 1] as Bezier },
    tablet: { duration: 340, ease: DRAWER_EASE },
    miss: 120,
    /** a cover smaller than this, or not on screen, does not fly */
    minWidth: 24,
} as const

/** Can this cover fly: big enough and at least partly on screen (also sideways: a card scrolled out of its row) */
export function coverOnScreen(box: Box, window: { width: number, height: number }) {
    return box.width >= COVER_FLIGHT.minWidth && box.height > 0 && box.y + box.height > 0 && box.y < window.height
        && box.x + box.width > 0 && box.x < window.width
}

/**
 * Does the flying copy leave out its ground (cover-flight.tsx)? On the way back it starts on the header's cover, which is
 * still there under it: until its own picture shows (a frame after the copy appears, even from the cache) or it starts to
 * move, the ground would cover that cover with an empty box for a frame. The way in keeps it (a dimmed card's ground).
 */
export function coverGroundWaits(direction: "in" | "out" | undefined, pictureShown: boolean, moving: boolean) {
    return direction === "out" && !pictureShown && !moving
}

/**
 * A picture in the flying box keeps its own aspect: the box (laid out at `base`, now at `box`) clips, and a picture laid out
 * at `layer` (centred in the box) is counter-scaled so it grows evenly and still covers the box (contentFit cover). So a
 * wide picture (a banner, an episode still) narrows into the portrait cover instead of being squeezed into it.
 */
export function coverLayerScale(base: Box, box: Box, layer: { width: number, height: number }) {
    "worklet"
    if (base.width <= 0 || base.height <= 0 || box.width <= 0 || box.height <= 0 || layer.width <= 0 || layer.height <= 0) return { scaleX: 1, scaleY: 1 }
    const scaleX = box.width / base.width, scaleY = box.height / base.height
    const even = Math.max(box.width / layer.width, box.height / layer.height)
    return { scaleX: even / scaleX, scaleY: even / scaleY }
}

/** Pictures of another shape than the cover they fly to (a banner, an episode still) cross-fade into it on the way */
export function coverShapesDiffer(a: Box, b: Box) {
    if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) return false
    const ratio = (a.width / a.height) / (b.width / b.height)
    return Math.max(ratio, 1 / ratio) > 1.3
}

/**
 * The opacity of the flying pictures at `t`: the start's picture (`base`, shown at `from` like its card, e.g. a dimmed .5)
 * and, cross-fading, the landing place's picture (`top`, reaching `to`). The start's picture fades on a curve, so the two
 * never dip into a darker frame halfway. Without a cross-fade the one picture goes from `from` to `to`.
 */
export function coverLayerOpacity(t: number, from: number, to: number, crossfade: boolean) {
    "worklet"
    if (!crossfade) return { base: from + (to - from) * t, top: 0 }
    return { base: from * (1 - t * t), top: to * t }
}

/**
 * Has the flight waited long enough for the header's picture: the phone gives a built page WAIT_MS from when it was built
 * (a heavy page used the whole wait up before it could show its cover), the tablet counts from the tap (its picture was
 * fetched there); MAX_WAIT_MS from the tap caps the whole hold on both. A page that still loads its data (not built yet)
 * holds the copy up to LOAD_MAX_WAIT_MS, and once built late it still gets WAIT_MS: on a first visit the data took longer
 * than MAX_WAIT_MS, so the cover never flew there (S22 + tablet, 06.11.).
 */
export function coverWaitOver(now: number, tappedAt: number, builtAt: number | null, isTablet: boolean) {
    if (builtAt === null) return now - tappedAt > LOAD_MAX_WAIT_MS
    if (now - tappedAt > Math.max(MAX_WAIT_MS, builtAt - tappedAt + WAIT_MS)) return true
    return !isTablet && now - builtAt > WAIT_MS
}

/**
 * Sheet → sheet: a sheet opening while another closes (or within this many ms of it) shows its scrim at once, so the two
 * fading scrims never add up to a lighter frame (the page flashing through between two sheets).
 */
export const SCRIM_HANDOFF_MS = 200

export function scrimAtOnce(openScrims: number, msSinceLastClose: number) {
    return openScrims > 0 || msSinceLastClose < SCRIM_HANDOFF_MS
}

/** My lists' statistics: each bar grows from its start (m-grow), the rows 30 ms apart, at most the first five staggered */
export const BAR_GROW = { phone: { duration: 320, ease: PHONE_EASE }, tablet: { duration: 300, ease: MOTION_EASE_OUT }, step: 30, staggered: 5 } as const

export function barGrowDelay(index: number) {
    return Math.min(Math.max(0, index), BAR_GROW.staggered - 1) * BAR_GROW.step
}

/** The player's brightness / volume panel slides in from its side; its level glides to each new value */
export const LEVEL_PANEL = { in: 200, out: 140, shift: DISTANCE.sideEnter, level: 120 } as const

/**
 * Home's "Upcoming episodes" carousel moves on by itself (upcoming-episodes.tsx `autoScroll`: embla autoplay, delay 5000):
 * every 5 s one card further, from the last place back to the first; a touch restarts the wait. The theme setting
 * "disable carousel auto scroll" turns it off.
 */
export const CAROUSEL_AUTOPLAY_MS = 5000

/** The next place of an autoplaying carousel with `places` snap places (align start: the last place shows the last card) */
export function nextCarouselPlace(current: number, places: number) {
    return places < 2 || current + 1 >= places ? 0 : current + 1
}

/**
 * The tour's spotlight travels from target to target: on the phone always `travel` ms, on a tablet longer for a longer way
 * (by the edge that moves the most), up to travelMax.
 */
export function tourTravelMs(m: TourMotion, from: { top: number, left: number, width: number, height: number }, to: { top: number, left: number, width: number, height: number }) {
    if (!m.travelPerPx) return m.travel
    const edges = [
        Math.abs(to.left - from.left), Math.abs(to.top - from.top),
        Math.abs(to.left + to.width - (from.left + from.width)), Math.abs(to.top + to.height - (from.top + from.height)),
    ]
    return Math.round(Math.min(m.travelMax ?? Infinity, m.travel + m.travelPerPx * Math.max(...edges)))
}

/**
 * The tap ring shows only once the cutout got to its target: after the longest iris or travel. Shown at once, it stood as a
 * still frame round the target while the cutout was still opening (S22, 06.11.).
 */
export function tourRingDelayMs(m: TourMotion) {
    return Math.max(m.iris, m.travelMax ?? m.travel)
}

/** The tour's finale and the moves inside its cards (tour.css, TourHero) */
export const TOUR_FINALE = {
    phone: { badge: 420, check: 360, checkDelay: 220, sparks: 620, sparksDelay: 290 },
    tablet: { badge: 380, check: 320, checkDelay: 220, sparks: 620, sparksDelay: 290 },
    sparkCount: 16,
    sparkStagger: 25,
    /** the tap ring grows this far out while it fades */
    ringGrow: 9,
    /** a card's content rises this far, the progress pill comes this far from the previous step's place */
    contentRise: 10,
    pillShift: 12,
} as const

/**
 * The finale's sparks: `count` points on an oval around the badge (wider than tall, so none is cut off at the card's edge),
 * each flying `distance` further out from the badge's rim, 25 ms apart round the oval.
 */
export function tourSparks(count: number, radiusX: number, radiusY: number, distance: number) {
    return Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2 - Math.PI / 2
        const cos = Math.cos(angle), sin = Math.sin(angle)
        return {
            fromX: cos * radiusX, fromY: sin * radiusY,
            toX: cos * (radiusX + distance), toY: sin * (radiusY + distance * 0.6),
            delay: i * TOUR_FINALE.sparkStagger,
        }
    })
}
