import React from "react"
import "./motion.css"
import { IS_TABLET_UI } from "./tablet-ui"

/**
 * The app's shared moves in script (the rest lives in motion.css). Both only ever animate opacity and transform, run on
 * the Web Animations API (off the main thread once started), never hold content back (no hidden start state outside the
 * running animation) and step aside for reduced motion.
 *   useSwap    a panel whose content is replaced in place (a tab's list, Anime/Manga) rises in once per change
 *   useReveal  on a loading placeholder: when it gives way to the real content, that content fades in and its first
 *              visible covers rise in a quick cascade; content that is simply there again (a cached revisit) does not
 */
export const MOTION_EASE_OUT = "cubic-bezier(.23, 1, .32, 1)"
/** The phone's gentler curve: its first frames come late, so the movement must not be spent by then (motion.css). */
export const PHONE_EASE = "cubic-bezier(.2, .6, .35, 1)"
/** What a newly appearing surface enters on: the strong ease-out on a tablet, PHONE_EASE on a phone (--m-enter in CSS). */
export const ENTER_EASE = IS_TABLET_UI ? MOTION_EASE_OUT : PHONE_EASE

/** Lists whose items cascade in when they replace a loading placeholder. */
export const REVEAL_LISTS = ".ps-grid, .ps-row, .ps-features, .ps-list, .mml-grid, .mdl-grid, .mex-list, [data-media-card-grid], [data-media-card-lazy-grid], [data-continue-watching-container]"
const REVEAL_MAX = 14
const REVEAL_STEP_MS = 28

export function prefersReducedMotion() {
    return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
}

/**
 * Animates `ref`'s element whenever `key` changes after the first render (not while `enabled` is false); a change mid-way
 * starts the new one at once.
 */
export function useSwap<T extends HTMLElement>(ref: React.RefObject<T | null>, key: unknown, enabled = true) {
    const first = React.useRef(true)
    const running = React.useRef<Animation | null>(null)
    React.useLayoutEffect(() => {
        if (first.current) {
            first.current = false
            return
        }
        const el = ref.current
        if (!enabled || !el || prefersReducedMotion() || typeof el.animate !== "function") return
        running.current?.cancel()
        running.current = el.animate([
            { opacity: 0, transform: "translateY(.375rem)" },
            { opacity: 1, transform: "none" },
        ], { duration: IS_TABLET_UI ? 220 : 260, easing: ENTER_EASE })
    }, [key])
}

/**
 * Phone: content replaced in place rises in once `shown` (an identity of what is shown, null while nothing settled is)
 * changes from one shown content to another; the first content (useReveal's job) and the tablet do not move.
 */
export function usePhoneSwap<T extends HTMLElement>(ref: React.RefObject<T | null>, shown: string | null) {
    const last = React.useRef<string | null>(null)
    React.useLayoutEffect(() => {
        if (!shown) return
        const before = last.current
        last.current = shown
        const el = ref.current
        if (!before || before === shown || IS_TABLET_UI || !el || prefersReducedMotion() || typeof el.animate !== "function") return
        el.animate([
            { opacity: 0, transform: "translateY(.375rem)" },
            { opacity: 1, transform: "none" },
        ], { duration: 260, easing: PHONE_EASE })
    }, [shown])
}

/**
 * Phone: stepping through pages of one kind (the next or previous week or month) slides the new page in from the side it
 * comes from; `step` grows forwards and shrinks backwards. Children marked data-motion-still (the pager itself) stay.
 */
export function usePhoneStep<T extends HTMLElement>(ref: React.RefObject<T | null>, step: number) {
    const last = React.useRef(step)
    React.useLayoutEffect(() => {
        const before = last.current
        last.current = step
        const el = ref.current
        if (before === step || IS_TABLET_UI || !el || prefersReducedMotion() || typeof el.animate !== "function") return
        const from = step > before ? "1.5rem" : "-1.5rem"
        for (const child of Array.from(el.children)) {
            if (child.hasAttribute("data-motion-still")) continue
            child.animate([
                { opacity: 0, transform: `translateX(${from})` },
                { opacity: 1, transform: "none" },
            ], { duration: 260, easing: PHONE_EASE })
        }
    }, [step])
}

const lastViews = new Map<string, string>()

/**
 * Phone: a view that its screen mounts in place of another of the same `group` (My lists remounts its list per type, the
 * stats replace it) rises in; the first view and one shown again after leaving the screen stay still.
 */
export function usePhoneViewSwap(group: string, view: string, ...refs: React.RefObject<HTMLElement | null>[]) {
    React.useLayoutEffect(() => {
        const before = lastViews.get(group)
        lastViews.set(group, view)
        if (!before || before === view || IS_TABLET_UI || prefersReducedMotion()) return
        for (const ref of refs) {
            ref.current?.animate?.([
                { opacity: 0, transform: "translateY(.375rem)" },
                { opacity: 1, transform: "none" },
            ], { duration: 260, easing: PHONE_EASE })
        }
    }, [view])
}

/**
 * For a loading placeholder: returns its ref. When the placeholder unmounts, whatever replaced it in the same parent fades
 * in, and the first covers of new lists in view rise in one after another. Lists that were already there are left alone.
 */
export function useReveal<T extends HTMLElement>() {
    const ref = React.useRef<T>(null)
    React.useLayoutEffect(() => {
        const parent = ref.current?.parentElement
        if (!parent) return
        return () => {
            // Runs before React inserts the content that replaces the placeholder: remember what was there already.
            const children = new Set(Array.from(parent.children))
            const lists = new Set(Array.from(parent.querySelectorAll(REVEAL_LISTS)))
            requestAnimationFrame(() => reveal(parent, children, lists))
        }
    }, [])
    return ref
}

function reveal(scope: HTMLElement, oldChildren: Set<Element>, oldLists: Set<Element>) {
    if (!scope.isConnected || prefersReducedMotion() || typeof scope.animate !== "function") return
    for (const child of Array.from(scope.children)) {
        // A page frame (PageWrapper) fades in on its own; a second fade on top of it only made the page appear later
        if (oldChildren.has(child) || !(child instanceof HTMLElement) || child.hasAttribute("data-page-wrapper") || child.querySelector("[data-page-wrapper]")) continue
        child.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "ease-out" })
    }
    const width = window.innerWidth, height = window.innerHeight
    let order = 0
    for (const list of Array.from(scope.querySelectorAll<HTMLElement>(REVEAL_LISTS))) {
        if (oldLists.has(list) || order >= REVEAL_MAX) continue
        for (const item of Array.from(list.children)) {
            if (order >= REVEAL_MAX) break
            if (!(item instanceof HTMLElement)) continue
            const box = item.getBoundingClientRect()
            if (box.width < 1 || box.bottom < 0 || box.top > height || box.right < 0 || box.left > width) continue
            item.animate([
                { opacity: 0, transform: "translateY(.625rem)" },
                { opacity: 1, transform: "none" },
            ], { duration: 280, delay: order * REVEAL_STEP_MS, easing: ENTER_EASE, fill: "backwards" })
            order++
        }
    }
}
