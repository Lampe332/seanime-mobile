import "./segment-glide.css"
import { IS_TABLET_UI } from "./tablet-ui"

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
        const replaced = new Map<string, number>()
        for (const record of records) {
            if (record.type === "childList") {
                record.removedNodes.forEach(node => rememberChoices(node, replaced))
                continue
            }
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
        replaced.forEach((index, label) => {
            const switcher = document.querySelector<HTMLElement>(`:is(${SEGMENT_GLIDE_SWITCHES})[aria-label="${CSS.escape(label)}"]`)
            const chosen = switcher ? chosenIndex(switcher) : -1
            const from = switcher?.children[index]
            if (switcher && chosen >= 0 && chosen !== index && from instanceof HTMLElement) glide(switcher, from, switcher.children[chosen] as HTMLElement)
        })
    }).observe(document.body, {
        subtree: true, attributes: true, attributeFilter: CHOSEN_ATTRIBUTES, attributeOldValue: true,
        // Phone: a switch marked data-glide-rebuilt that its screen builds anew with the choice (My lists remounts its list,
        // switch and all, per type) glides from the option chosen in the switch it replaced. The tablet keeps its behaviour.
        childList: !IS_TABLET_UI,
    })
}

function chosenIndex(switcher: Element) {
    return Array.from(switcher.children).findIndex(option => CHOSEN_ATTRIBUTES.some(name => option.getAttribute(name) === "true"))
}

/** Notes, by label, which option was chosen in each switch marked data-glide-rebuilt inside a removed node. */
function rememberChoices(node: Node, into: Map<string, number>) {
    if (!(node instanceof Element)) return
    const switches = node.matches("[data-glide-rebuilt]") ? [node] : Array.from(node.querySelectorAll("[data-glide-rebuilt]"))
    for (const switcher of switches) {
        const label = switcher.getAttribute("aria-label")
        const index = chosenIndex(switcher)
        if (label && index >= 0) into.set(label, index)
    }
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
    const first: Keyframe = { transform: `translate(${start.left - end.left}px, ${start.top - end.top}px)` }
    const last: Keyframe = { transform: "translate(0px, 0px)" }
    // On a phone a bubble of the same size glides on transform alone: that runs on the compositor and keeps going while
    // the page the tap opens is built (~100 ms there, the bottom bar's pill used to jump to the end).
    if (IS_TABLET_UI || Math.abs(start.width - end.width) > .5 || Math.abs(start.height - end.height) > .5) {
        Object.assign(first, { width: `${start.width}px`, height: `${start.height}px` })
        Object.assign(last, { width: `${end.width}px`, height: `${end.height}px` })
    }
    const animation = bubble.animate([first, last], { duration: GLIDE_MS, easing: GLIDE_EASING })
    const land = () => {
        if (!bubble.isConnected) return
        bubble.remove()
        to.removeAttribute("data-segment-glide-target")
    }
    animation.finished.then(land, land)
}
