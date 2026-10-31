import "./segment-glide.css"

/**
 * One sliding bubble for every segmented switch of the app (Sub/Dub, the anime page's sources, Anime/Manga, Downloads,
 * Week/Month, reader options, the bottom bar and tablet rail). The switches keep drawing their chosen option themselves; when the choice moves, a
 * copy of the chosen bubble glides from the old option to the new one inside the switch and is removed when it lands.
 * Nothing waits for it: the bubble lives only for the glide, so resizing or turning the screen never leaves one behind.
 */
export const SEGMENT_GLIDE_SWITCHES = ".ps-segment, .mobile-source-segment, .mdl-tabs, .msc-tabs, .reader-settings-segment, [data-mobile-anime] .UI-StaticTabs__root"
// The app's bottom bar / tablet rail (UIBottomNav.kt) marks its page with data-active; its pill glides the same way.
const GLIDE_SWITCHES = `${SEGMENT_GLIDE_SWITCHES}, #__seanime_bottom_nav`
const CHOSEN_ATTRIBUTES = ["aria-selected", "aria-pressed", "data-current", "data-active"]
const GLIDE_MS = 280
const GLIDE_EASING = "cubic-bezier(.32, .72, 0, 1)"

type Box = { left: number, top: number, width: number, height: number }

let installed = false

export function installSegmentGlide() {
    if (installed || typeof MutationObserver === "undefined" || typeof document === "undefined") return
    installed = true
    new MutationObserver(records => {
        const moves = new Map<HTMLElement, { from?: HTMLElement, to?: HTMLElement }>()
        for (const record of records) {
            const option = record.target as HTMLElement
            const switcher = option.parentElement
            if (!switcher || !switcher.matches(GLIDE_SWITCHES)) continue
            const chosen = option.getAttribute(record.attributeName!) === "true"
            if (chosen === (record.oldValue === "true")) continue
            const move = moves.get(switcher) ?? {}
            if (chosen) move.to = option
            else move.from = option
            moves.set(switcher, move)
        }
        moves.forEach(({ from, to }, switcher) => {
            if (from && to && from.isConnected && to.isConnected) glide(switcher, from, to)
        })
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: CHOSEN_ATTRIBUTES, attributeOldValue: true })
}

function boxOf(el: HTMLElement): Box {
    return { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight }
}

function glide(switcher: HTMLElement, from: HTMLElement, to: HTMLElement) {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return
    // A second tap while it glides starts from where the bubble is, not from the old option.
    const running = switcher.querySelector<HTMLElement>(":scope > [data-segment-glide]")
    let start = boxOf(from)
    if (running) {
        const moved = new DOMMatrixReadOnly(getComputedStyle(running).transform)
        const rect = running.getBoundingClientRect()
        start = { left: running.offsetLeft + moved.m41, top: running.offsetTop + moved.m42, width: rect.width, height: rect.height }
        running.remove()
    }
    switcher.querySelectorAll(":scope > [data-segment-glide-target]").forEach(option => option.removeAttribute("data-segment-glide-target"))

    const end = boxOf(to)
    if (end.width < 1 || end.height < 1 || to.offsetParent !== switcher) return
    const look = getComputedStyle(to)
    const bubble = document.createElement("span")
    bubble.setAttribute("data-segment-glide", "")
    bubble.setAttribute("aria-hidden", "true")
    Object.assign(bubble.style, {
        left: `${end.left}px`, top: `${end.top}px`, width: `${end.width}px`, height: `${end.height}px`,
        padding: look.padding, borderRadius: look.borderRadius, backgroundColor: look.backgroundColor, backgroundClip: look.backgroundClip,
    })
    switcher.append(bubble)
    // The new option hides its own bubble until the travelling one arrives.
    to.setAttribute("data-segment-glide-target", "")
    const animation = bubble.animate([
        { transform: `translate(${start.left - end.left}px, ${start.top - end.top}px)`, width: `${start.width}px`, height: `${start.height}px` },
        { transform: "translate(0px, 0px)", width: `${end.width}px`, height: `${end.height}px` },
    ], { duration: GLIDE_MS, easing: GLIDE_EASING })
    const land = () => {
        if (!bubble.isConnected) return
        bubble.remove()
        to.removeAttribute("data-segment-glide-target")
    }
    animation.finished.then(land, land)
}
