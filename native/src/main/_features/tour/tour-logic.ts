/*
 * The tour's rules without React (web tour.tsx + tour-overlay.tsx): where a card sits next to its target, which side it
 * takes when the preferred one has no room, which step Back returns to, the cutout's shape. Everything in window dp.
 */

export type Rect = { top: number, left: number, width: number, height: number }
export type Viewport = { width: number, height: number }
export type TourStepPlacement = "top" | "bottom" | "left" | "right"

export const EMPTY_RECT: Rect = { top: 0, left: 0, width: 0, height: 0 }

/** The cards' width: 440 for a centred card, 340 next to a target (tour-overlay.tsx popoverWidth), always 32 short of the window */
export function cardWidth(isModal: boolean, viewport: Viewport, popoverWidth?: number | string) {
    const wanted = typeof popoverWidth === "number" ? popoverWidth
        : typeof popoverWidth === "string" ? parseInt(popoverWidth, 10) || 340
            : isModal ? 440 : 340
    return Math.min(wanted, viewport.width - 32)
}

/** The target's box with the spotlight padding around it */
export function padRect(r: Rect, padding: number): Rect {
    return { top: r.top - padding, left: r.left - padding, width: r.width + padding * 2, height: r.height + padding * 2 }
}

/** The card's place on its side of the target, kept 16dp inside the window */
export function computePopoverPosition(target: Rect, width: number, height: number, placement: TourStepPlacement, viewport: Viewport, gap = 12) {
    let top = 0
    let left = 0
    switch (placement) {
        case "bottom":
            top = target.top + target.height + gap
            left = target.left + target.width / 2 - width / 2
            break
        case "top":
            top = target.top - height - gap
            left = target.left + target.width / 2 - width / 2
            break
        case "left":
            top = target.top + target.height / 2 - height / 2
            left = target.left - width - gap
            break
        case "right":
            top = target.top + target.height / 2 - height / 2
            left = target.left + target.width + gap
            break
    }
    const margin = 16
    if (left < margin) left = margin
    if (left + width > viewport.width - margin) left = viewport.width - margin - width
    if (top < margin) top = margin
    if (top + height > viewport.height - margin) top = viewport.height - margin - height
    return { top, left }
}

/** The preferred side when the card fits there, else the side with the most room */
export function resolvePlacement(target: Rect, width: number, height: number, preferred: TourStepPlacement, viewport: Viewport, gap = 12): TourStepPlacement {
    const spaces: Record<TourStepPlacement, number> = {
        top: target.top - gap,
        bottom: viewport.height - (target.top + target.height + gap),
        left: target.left - gap,
        right: viewport.width - (target.left + target.width + gap),
    }
    const fits = (p: TourStepPlacement) => p === "top" || p === "bottom" ? spaces[p] >= height : spaces[p] >= width
    if (fits(preferred)) return preferred
    // sort without toSorted (Hermes has none); ties keep this order like the web's stable sort
    const order: TourStepPlacement[] = ["bottom", "top", "right", "left"]
    return [...order].sort((a, b) => spaces[b] - spaces[a])[0]
}

/** Rounded-rect cutout (counter-clockwise against the outer rect, for the even-odd fill) */
export function holePath(r: Rect, radius: number) {
    "worklet"
    if (r.width <= 0 || r.height <= 0) return ""
    const q = Math.min(radius, r.width / 2, r.height / 2)
    const x2 = r.left + r.width, y2 = r.top + r.height
    return `M${r.left + q},${r.top} H${x2 - q} Q${x2},${r.top} ${x2},${r.top + q} V${y2 - q} Q${x2},${y2} ${x2 - q},${y2} `
        + `H${r.left + q} Q${r.left},${y2} ${r.left},${y2 - q} V${r.top + q} Q${r.left},${r.top} ${r.left + q},${r.top} Z`
}

/** The dim layer: the whole window, with the cutout when there is one (also drawn per frame on the UI thread) */
export function spotlightPath(viewport: Viewport, hole: Rect | null) {
    "worklet"
    const outer = `M0,0 H${viewport.width} V${viewport.height} H0 Z`
    const cut = hole ? holePath(hole, 8) : ""
    return cut ? `${outer} ${cut}` : outer
}

/** A cutout on its way (t 0…1); the iris opens from / closes into `irisRect`, a point at the target's centre */
export function mixRect(a: Rect, b: Rect, t: number): Rect {
    "worklet"
    return { top: a.top + (b.top - a.top) * t, left: a.left + (b.left - a.left) * t, width: a.width + (b.width - a.width) * t, height: a.height + (b.height - a.height) * t }
}

export function irisRect(r: Rect): Rect {
    return { top: r.top + r.height / 2, left: r.left + r.width / 2, width: 0, height: 0 }
}

/** Where the card starts on its way out of the target: shifted towards the target, its origin on the edge facing it */
export function cardEnterFrom(placement: TourStepPlacement, shift: number) {
    switch (placement) {
        case "bottom": return { dx: 0, dy: -shift, origin: "50% 0%" }
        case "top": return { dx: 0, dy: shift, origin: "50% 100%" }
        case "left": return { dx: shift, dy: 0, origin: "100% 50%" }
        case "right": return { dx: -shift, dy: 0, origin: "0% 50%" }
    }
}

export const sameRect = (a: Rect | null, b: Rect | null) => a === b || (!!a && !!b
    && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5)

/**
 * The four dim strips around a cutout, which take the taps outside it; the cutout itself lets taps reach the element below
 * (web: the SVG's even-odd path with pointer-events on the painted area only)
 */
export function dimStrips(hole: Rect, viewport: Viewport): Rect[] {
    const top = Math.max(0, hole.top)
    const bottom = Math.min(viewport.height, hole.top + hole.height)
    const left = Math.max(0, hole.left)
    const right = Math.min(viewport.width, hole.left + hole.width)
    return [
        { top: 0, left: 0, width: viewport.width, height: top },
        { top: bottom, left: 0, width: viewport.width, height: Math.max(0, viewport.height - bottom) },
        { top, left: 0, width: left, height: Math.max(0, bottom - top) },
        { top, left: right, width: Math.max(0, viewport.width - right), height: Math.max(0, bottom - top) },
    ].filter(r => r.width > 0 && r.height > 0)
}

/** A step as the order of the tour sees it */
export type TourStepShape = { id: string, target?: string, disableBack?: boolean }

/** Next: the following step, or null for the end of the tour */
export function nextIndex(steps: TourStepShape[], at: number): number | null {
    return at < steps.length - 1 ? at + 1 : null
}

/** Back button: the step before, unless this step is one-way (disableBack) or the first */
export function prevIndex(steps: TourStepShape[], at: number): number | null {
    if (steps[at]?.disableBack) return null
    return at > 0 ? at - 1 : null
}

/**
 * Back mid-tour (fix F2): the target went away for good (Back closed the menu or the sheet, or left the tab). The tour
 * returns to the latest earlier step whose target is on screen; with none it ends (-1).
 */
export function followBackIndex(steps: TourStepShape[], at: number, isShown: (target: string) => boolean): number {
    for (let i = at - 1; i >= 0; i--) {
        const target = steps[i].target
        if (target && isShown(target)) return i
    }
    return -1
}

/**
 * Which buttons a card shows: a step done by tapping its target that fell back to a centred card (target never came)
 * gets Next, or it would be a dead end (fix F5); Back only where it leads somewhere.
 */
export function cardButtons(step: { hideNextButton?: boolean, disableBack?: boolean }, at: number, total: number, isModal: boolean) {
    const hideNext = !!step.hideNextButton && !isModal
    return {
        skip: at !== total - 1,
        back: at > 0 && !step.disableBack && !hideNext,
        next: !hideNext,
    }
}

/** Is a cutout centre-able on screen, or does its target first have to be scrolled into view */
export function isOffScreen(r: Rect, viewport: Viewport, insetTop: number, insetBottom: number) {
    return r.top < insetTop || r.top + r.height > viewport.height - insetBottom
}
