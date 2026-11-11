import React from "react"
import type { Rect } from "./tour-logic"

/*
 * What the web tour found with CSS selectors (`document.querySelectorAll` + `findShown`): elements that take part in the
 * tour register under a name. A target counts as shown while it is mounted and measures more than 0×0 in the window; an
 * unmounted one (the menu closed, the sheet went) is gone at once, so the cutout never stands over what comes next (fix F6).
 * Taps on a target are reported by the element itself (the web listened for clicks in the capture phase).
 */

/** The names the setup tour (mobile-tutorial.tsx) points at */
export const TOUR_TARGETS = {
    menu: "nav-menu",
    menuExtensions: "menu-extensions",
    marketplaceTab: "extensions-marketplace-tab",
    changeRepo: "marketplace-change-repo",
    repoSheet: "marketplace-repo-sheet",
    repoSave: "marketplace-repo-save",
    typeChip: (type: string) => `marketplace-type:${type}`,
    install: (type: string) => `marketplace-install:${type}`,
} as const

/** A mounted view: every host view's instance can measure itself in the window */
type Measurable = { measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => void }
type Entry = { node: Measurable, data?: string, scroll?: TourScrollHost }

/** A scroll view that can bring a target into the middle of the window (the web's `scrollIntoView({ block: "center" })`) */
export type TourScrollHost = { centre: (rect: Rect) => void }

const targets = new Map<string, Set<Entry>>()
const changeListeners = new Set<() => void>()
const pressListeners = new Set<(id: string) => void>()

function changed() {
    changeListeners.forEach(listener => listener())
}

/** Called when a target is added or removed */
export function subscribeTourTargets(listener: () => void) {
    changeListeners.add(listener)
    return () => void changeListeners.delete(listener)
}

/** Called when a target is tapped */
export function subscribeTourPresses(listener: (id: string) => void) {
    pressListeners.add(listener)
    return () => void pressListeners.delete(listener)
}

/** The element registered as `id` was tapped (advanceOnTargetClick / advanceOnSelectorClick) */
export function pressTourTarget(id: string) {
    pressListeners.forEach(listener => listener(id))
}

export function registerTourTarget(id: string, entry: Entry) {
    let set = targets.get(id)
    if (!set) targets.set(id, set = new Set())
    set.add(entry)
    changed()
    return () => {
        set.delete(entry)
        if (!set.size) targets.delete(id)
        changed()
    }
}

/** The scroll view a target sits in; PhoneScreen provides it */
export const TourScrollContext = React.createContext<TourScrollHost | undefined>(undefined)

/**
 * A callback ref that registers its view as the target `id` while mounted (null: no target). `data` tells the step text
 * which variant is on screen (e.g. "add" when the repository button reads "Add repository").
 */
export function useTourTarget(id: string | null, data?: string) {
    const scroll = React.useContext(TourScrollContext)
    return React.useCallback((node: Measurable | null) => {
        if (!node || !id) return
        return registerTourTarget(id, { node, data, scroll })
    }, [id, data, scroll])
}

function measure(entry: Entry) {
    return new Promise<Rect | null>(resolve => {
        try {
            entry.node.measureInWindow((x, y, width, height) => resolve(width > 0 && height > 0 ? { left: x, top: y, width, height } : null))
        } catch {
            resolve(null)
        }
    })
}

/** The shown element of target `id` highest on screen (the first in a list, as `findShown` took the first in the page), or null */
export async function findTourTarget(id: string): Promise<{ rect: Rect, data?: string, scroll?: TourScrollHost } | null> {
    const entries = [...(targets.get(id) ?? [])]
    const rects = await Promise.all(entries.map(measure))
    let best: { rect: Rect, data?: string, scroll?: TourScrollHost } | null = null
    rects.forEach((rect, i) => {
        if (rect && (!best || rect.top < best.rect.top)) best = { rect, data: entries[i].data, scroll: entries[i].scroll }
    })
    return best
}

/** Whether target `id` is mounted (synchronous: Back's follow-up decides with it at once) */
export function hasTourTarget(id: string) {
    return !!targets.get(id)?.size
}

/** The variant of the first registered element of target `id` */
export function tourTargetData(id: string) {
    const first = targets.get(id)?.values().next().value
    return first?.data
}

/** Waits until target `id` is shown, or null after `timeout` ms (web waitForElement, with a 100 ms check instead of a MutationObserver) */
export function waitForTourTarget(id: string, timeout: number, isCancelled: () => boolean) {
    return new Promise<Rect | null>(resolve => {
        const started = Date.now()
        const check = async () => {
            if (isCancelled()) return resolve(null)
            const found = await findTourTarget(id)
            if (found) return resolve(found.rect)
            if (Date.now() - started >= timeout) return resolve(null)
            setTimeout(check, 100)
        }
        void check()
    })
}

/** Waits until target `id` is gone (a closing sheet), at most `timeout` ms (tourHelpers.waitForSelectorGone) */
export function waitForTourTargetGone(id: string, timeout = 15000) {
    return new Promise<void>(resolve => {
        const started = Date.now()
        const check = () => {
            if (!hasTourTarget(id) || Date.now() - started > timeout) return resolve()
            setTimeout(check, 150)
        }
        check()
    })
}
