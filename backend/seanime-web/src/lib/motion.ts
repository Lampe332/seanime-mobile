import React from "react"
import "./motion.css"

/**
 * The app's shared moves in script (the rest lives in motion.css). Both only ever animate opacity and transform, run on
 * the Web Animations API (off the main thread once started), never hold content back (no hidden start state outside the
 * running animation) and step aside for reduced motion.
 *   useSwap    a panel whose content is replaced in place (a tab's list, Anime/Manga) rises in once per change
 *   useReveal  on a loading placeholder: when it gives way to the real content, that content fades in and its first
 *              visible covers rise in a quick cascade; content that is simply there again (a cached revisit) does not
 */
export const MOTION_EASE_OUT = "cubic-bezier(.23, 1, .32, 1)"

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
        ], { duration: 220, easing: MOTION_EASE_OUT })
    }, [key])
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
            ], { duration: 280, delay: order * REVEAL_STEP_MS, easing: MOTION_EASE_OUT, fill: "backwards" })
            order++
        }
    }
}
