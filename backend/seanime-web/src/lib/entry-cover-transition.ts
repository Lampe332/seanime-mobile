import "./entry-cover-transition.css"

/**
 * Cover → page: tapping an anime or manga cover anywhere (Home, lists, search, discover, schedule …) opens its page out
 * of that cover. A view transition keeps the old screen while the page renders; the tapped cover flies to the cover in
 * the page's header while the page fades in. It waits for the header cover's picture (at most WAIT_MS), so it never
 * flies into an empty frame; a page that is still loading after that just fades in, and the old cover fades with it.
 * Any link works: the tap is held back, then given to the link again inside the transition.
 */
const ENTRY_PATHS = ["/entry", "/manga/entry"]
const COVER_NAME = "entry-cover"
// The screen stands frozen on the old page while this waits, so it gives up soon and the page just fades in (a tablet
// waiting 600 ms for a picture still loading stood still for ~830 ms). The wait counts from when the page is built: a
// heavy one (a manga with 300 chapters, ~325 ms on a phone) had used it all up before it could show its cover. MAX_WAIT_MS
// caps the whole hold.
const WAIT_MS = 250
const MAX_WAIT_MS = 450

type ViewTransitionDocument = Document & { startViewTransition?: (update: () => Promise<void> | void) => { finished: Promise<void> } }

let replaying = false

export function installEntryCoverTransition() {
    if (typeof document === "undefined" || !(document as ViewTransitionDocument).startViewTransition) return
    document.addEventListener("click", onClick, true)
}

function onClick(event: MouseEvent) {
    if (replaying || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const target = event.target as Element | null
    const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null
    if (!anchor || (anchor.target && anchor.target !== "_self")) return
    // Buttons inside a card (play, menu) keep their own tap.
    const button = target!.closest("button, [role='button']")
    if (button && anchor.contains(button)) return
    const url = new URL(anchor.href, location.href)
    if (url.origin !== location.origin || !ENTRY_PATHS.includes(url.pathname) || !url.searchParams.get("id")) return
    if (url.pathname === location.pathname && url.search === location.search) return
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return
    if (document.documentElement.hasAttribute("data-vc-miniplayer-view-transition")) return
    const cover = anchor.querySelector("img")
    if (!cover || !cover.complete || !cover.naturalWidth) return
    const rect = cover.getBoundingClientRect()
    if (rect.width < 24 || rect.bottom < 0 || rect.top > window.innerHeight) return

    event.preventDefault()
    event.stopPropagation()
    const html = document.documentElement
    html.setAttribute("data-entry-cover-transition", "")
    cover.style.setProperty("view-transition-name", COVER_NAME)
    let pageCover: HTMLElement | null = null
    const transition = (document as ViewTransitionDocument).startViewTransition!(async () => {
        cover.style.removeProperty("view-transition-name")
        replaying = true
        try {
            anchor.click()
        }
        finally {
            replaying = false
        }
        pageCover = await waitForPageCover(url.pathname)
        pageCover?.style.setProperty("view-transition-name", COVER_NAME)
    })
    transition.finished.finally(() => {
        html.removeAttribute("data-entry-cover-transition")
        html.removeAttribute("data-entry-cover-miss")
        pageCover?.style.removeProperty("view-transition-name")
    }).catch(() => undefined)
}

/**
 * The page header's cover once its picture is there; null when it is not within WAIT_MS of the page being built (or
 * MAX_WAIT_MS in all). Then the old cover has nowhere to fly: entry-cover-transition.css lets it fade out quickly where it
 * is instead of standing over the new page.
 */
function waitForPageCover(pathname: string): Promise<HTMLElement | null> {
    const started = performance.now()
    let built = 0
    return new Promise(resolve => {
        const look = () => {
            const now = performance.now()
            const header = location.pathname === pathname ? document.querySelector<HTMLElement>(".mobile-anime-cover") : null
            if (header && !built) built = now
            const img = header?.querySelector("img")
            if (img && img.complete && img.naturalWidth > 0) return resolve(img)
            if ((built && now - built > WAIT_MS) || now - started > MAX_WAIT_MS) {
                document.documentElement.setAttribute("data-entry-cover-miss", "")
                return resolve(null)
            }
            setTimeout(look, 16)
        }
        look()
    })
}
