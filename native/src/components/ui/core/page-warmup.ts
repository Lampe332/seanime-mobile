/*
 * The main pages' first visit built the whole page in the frame of the tap (S22 4.4 gfxinfo: My lists 99th 81 ms,
 * Discover 53 % janky). While the app is idle after the start, page-transition.tsx loads the data of the other main pages
 * ahead (WARM_DATA: their queries, reads only, no views): My lists' 99th fell to 25 ms. Building My lists and Discover
 * ahead, hidden, built no views at all (S22 atrace 27.11.: 0 in the idle time, 543–715 on the tap) and was taken out;
 * Discover stages its rows instead (discover-phone.tsx). Nothing runs while a page comes in or a finger is on the screen,
 * nor for a while after (a scroll goes on after the finger: its start cancels the JS touch, so a cancel waits longer).
 */
export const WARM_DATA = "page-data"
export const WARM_PAGES = [WARM_DATA] as const
/** after the start: past Home's first loads and its carousels' first frames */
export const WARM_START_MS = 2500
/** between two steps */
export const WARM_GAP_MS = 700
/** nothing is loaded this soon after a page switch or a touch */
export const WARM_QUIET_MS = 1200
/** after a touch taken over by a scroll (touchcancel): the drag and its fling */
export const WARM_SCROLL_QUIET_MS = 3000

export type WarmupClock = {
    now: () => number
    after: (ms: number, run: () => void) => void
    idle: (run: () => void) => void
}

export type TouchPhase = "down" | "up" | "scroll"

export function createPageWarmup(clock: WarmupClock, pages: readonly string[] = WARM_PAGES) {
    const warm = new Set<string>()
    const listeners = new Set<() => void>()
    let started = false
    let touching = false
    let quietUntil = -Infinity

    const notify = () => listeners.forEach(listener => listener())
    const hush = (ms: number) => { quietUntil = Math.max(quietUntil, clock.now() + ms) }

    /** runs `run` once no page is coming in and no finger is down, nor was for the quiet time, in an idle slot; the returned
     * function cancels it */
    const whenQuiet = (run: () => void) => {
        let live = true
        const attempt = () => {
            if (!live) return
            if (touching) return clock.after(WARM_QUIET_MS, attempt)
            const wait = quietUntil - clock.now()
            if (wait > 0) return clock.after(wait, attempt)
            clock.idle(() => {
                if (!live) return
                if (touching || clock.now() < quietUntil) attempt()
                else run()
            })
        }
        attempt()
        return () => { live = false }
    }

    const step = (index: number) => {
        if (index >= pages.length) return
        whenQuiet(() => {
            warm.add(pages[index])
            notify()
            clock.after(WARM_GAP_MS, () => step(index + 1))
        })
    }

    return {
        isWarm: (name: string) => warm.has(name),
        subscribe: (listener: () => void) => {
            listeners.add(listener)
            return () => { listeners.delete(listener) }
        },
        /** a page came to the front: loading ahead waits */
        noteSwitch: () => hush(WARM_QUIET_MS),
        /** a touch on a page: loading ahead waits while it lasts and for a while after */
        noteTouch: (phase: TouchPhase) => {
            touching = phase === "down"
            hush(phase === "scroll" ? WARM_SCROLL_QUIET_MS : WARM_QUIET_MS)
        },
        whenQuiet,
        /** once, when the first page is in front */
        start: () => {
            if (started) return
            started = true
            clock.after(WARM_START_MS, () => step(0))
        },
    }
}
