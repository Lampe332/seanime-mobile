import { logger } from "@/lib/helpers/debug"
import { atom } from "jotai"

const log = logger("VIDEO CORE FULLSCREEN")

export type FullscreenManagerChangedEvent = CustomEvent<{ isFullscreen: boolean }>
export type FullscreenManagerDestroyedEvent = CustomEvent
export type FullscreenManagerAttemptEvent = CustomEvent<{ method: "enter" | "exit" }>

interface VideoCoreFullscreenManagerEventMap {
    "fullscreenchanged": FullscreenManagerChangedEvent
    "destroyed": FullscreenManagerDestroyedEvent
    "enterattempt": FullscreenManagerAttemptEvent
    "exitattempt": FullscreenManagerAttemptEvent
}

export const vc_fullscreenManager = atom<VideoCoreFullscreenManager | null>(null)

export type FlipRect = { left: number, top: number, width: number, height: number }
export type FlipFrame = { translate: string, scale: string, clipPath: string }

const FULL_FRAME: FlipFrame = { translate: "0px 0px", scale: "1", clipPath: "inset(0px 0px round 0px)" }
const FLIP_ENTER_MS = 340
const FLIP_EXIT_MS = 280
const FLIP_EASING = "cubic-bezier(.32, .72, 0, 1)"

/**
 * The fullscreen player drawn over its inline box: the first frame of the grow and the last of the shrink.
 * The browser forces `transform: none` on a fullscreen element, so it moves with the separate translate/scale
 * properties. The picture scales evenly (the video is never stretched) until it covers the inline box, and a clip in
 * the element's own, unscaled coordinates cuts it to that box with the box's corner radius.
 */
export function vc_fullscreenFlipFrame(inline: FlipRect, full: FlipRect, radius: number): FlipFrame {
    const scale = Math.max(inline.width / full.width, inline.height / full.height)
    const dx = inline.left + inline.width / 2 - (full.left + full.width / 2)
    const dy = inline.top + inline.height / 2 - (full.top + full.height / 2)
    const insetX = Math.max(0, (full.width - inline.width / scale) / 2)
    const insetY = Math.max(0, (full.height - inline.height / scale) / 2)
    const px = (n: number) => `${Math.round(n * 100) / 100}px`
    return {
        translate: `${px(dx)} ${px(dy)}`,
        scale: `${Math.round(scale * 10000) / 10000}`,
        clipPath: `inset(${px(insetY)} ${px(insetX)} round ${px(radius / scale)})`,
    }
}

function sameRect(a: FlipRect, b: FlipRect) {
    return Math.abs(a.left - b.left) < 2 && Math.abs(a.top - b.top) < 2 && Math.abs(a.width - b.width) < 2 && Math.abs(a.height - b.height) < 2
}

function isLandscape() {
    return window.innerWidth >= window.innerHeight
}

function nextFrames(count: number) {
    return new Promise<void>(resolve => {
        const step = () => (--count <= 0 ? resolve() : requestAnimationFrame(step))
        requestAnimationFrame(step)
    })
}

function reducedMotion() {
    return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
}

/** Corner radius of the frame the inline player sits in (the page rounds the frame, the player itself is square). */
function inlineRadius(el: HTMLElement) {
    let node = el.parentElement
    for (let i = 0; node && i < 3; i++, node = node.parentElement) {
        const radius = parseFloat(getComputedStyle(node).borderTopLeftRadius)
        if (radius > 0) return radius
    }
    return 0
}

export class VideoCoreFullscreenManager extends EventTarget {
    private containerElement: HTMLElement | null = null
    private videoElement: HTMLVideoElement | null = null
    private controller = new AbortController()
    private onFullscreenChange: (isFullscreen: boolean) => void
    /** Where the player was before fullscreen, measured on the way in for the grow. */
    private inlineBefore: { rect: FlipRect, radius: number } | null = null
    /** Orientation fullscreen started from; Android turns phones to landscape for it. */
    private enteredLandscape: boolean | null = null
    private flipAnimations: Animation[] = []
    private exiting = false
    /**
     * In-page fullscreen (the Android app): the player goes into the top layer as a popover and covers the window, and
     * the app locks landscape through OrientationBridge. The browser's own fullscreen hands the page to another Android
     * view first: a few black frames, then about a quarter second of the old layout before the page even learns it is
     * fullscreen, so the grow started late after a visible glitch (screen recordings, 31.10.). The app's window is already
     * immersive, so nothing else is lost; the page stays in the same view and the first frame is the grow's first.
     */
    private pageFullscreen = false
    // Android's Back leaves fullscreen through this (AndroidNavigation.backScript), so it shrinks like the button does.
    private backExit = () => {
        if (!this.isFullscreen) return false
        void this.exitFullscreen(true)
        return true
    }

    constructor(onFullscreenChange: (isFullscreen: boolean) => void) {
        super()
        this.onFullscreenChange = onFullscreenChange
        this.attachDocumentListeners()
        ;(window as any).__seanimeExitFullscreen = this.backExit
    }

    public get isFullscreen(): boolean {
        return this.pageFullscreen || !!this.fullscreenElement
    }

    /** The element that is fullscreen in either way. */
    private get fullscreenTarget(): Element | null {
        return this.pageFullscreen ? this.containerElement : this.fullscreenElement
    }

    private get canUsePageFullscreen() {
        return !!(window as any).OrientationBridge?.setVideoFullscreen && typeof this.containerElement?.showPopover === "function"
    }

    private get fullscreenElement(): Element | null {
        return document.fullscreenElement || (document as any).webkitFullscreenElement || null
    }

    addEventListener<K extends keyof VideoCoreFullscreenManagerEventMap>(
        type: K,
        listener: (this: VideoCoreFullscreenManager, ev: VideoCoreFullscreenManagerEventMap[K]) => any,
        options?: boolean | AddEventListenerOptions,
    ): void

    addEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
    ): void

    addEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
    ): void {
        super.addEventListener(type, listener, options)
    }

    removeEventListener<K extends keyof VideoCoreFullscreenManagerEventMap>(
        type: K,
        listener: (this: VideoCoreFullscreenManager, ev: VideoCoreFullscreenManagerEventMap[K]) => any,
        options?: boolean | EventListenerOptions,
    ): void

    removeEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | EventListenerOptions,
    ): void

    removeEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | EventListenerOptions,
    ): void {
        super.removeEventListener(type, listener, options)
    }

    setContainer(containerElement: HTMLElement) {
        this.containerElement = containerElement
    }

    setVideoElement(videoElement: HTMLVideoElement) {
        this.videoElement = videoElement
    }

    /** The player's own button and double tap: fullscreen grows out of the inline player and shrinks back into it. */
    async toggleFullscreen() {
        if (this.isFullscreen) {
            await this.exitFullscreen(true)
        } else {
            await this.enterFullscreen()
        }
    }

    /** `animate`: shrink back into the inline player first (user actions); cleanup and remote calls leave at once. */
    async exitFullscreen(animate = false) {
        const attemptEvent: FullscreenManagerAttemptEvent = new CustomEvent("exitattempt", { detail: { method: "exit" } })
        this.dispatchEvent(attemptEvent)
        // A second tap while it shrinks changes nothing; a plain exit (cleanup) still goes through at once.
        if (this.exiting && animate) return
        this.exiting = true

        try {
            if (animate) await this.playExit().catch(() => undefined)
            if (!this.isFullscreen) return
            if (this.pageFullscreen) {
                this.leavePageFullscreen()
                return
            }
            if (document.exitFullscreen) {
                await document.exitFullscreen()
            } else if ((document as any).webkitExitFullscreen) {
                await (document as any).webkitExitFullscreen()
            }
            log.info("Exited fullscreen")
            this._focusVideo()
        }
        catch (error) {
            this.cancelFlip()
            log.error("Failed to exit fullscreen", error)
        }
        finally {
            this.exiting = false
        }
    }

    async enterFullscreen() {
        const attemptEvent: FullscreenManagerAttemptEvent = new CustomEvent("enterattempt", { detail: { method: "enter" } })
        this.dispatchEvent(attemptEvent)

        if (!this.containerElement) {
            log.warning("Container element not set")
            return
        }

        if (this.isFullscreen) return
        this.enteredLandscape = isLandscape()
        this.inlineBefore = this.measureInline(this.containerElement)
        if (this.canUsePageFullscreen && this.enterPageFullscreen(this.containerElement)) return
        try {
            if (this.containerElement.requestFullscreen) {
                await this.containerElement.requestFullscreen()
            } else if ((this.containerElement as any).webkitRequestFullscreen) {
                await (this.containerElement as any).webkitRequestFullscreen()
            }
            log.info("Entered fullscreen")
            this._focusVideo()
        }
        catch (error) {
            this.inlineBefore = null
            log.error("Failed to enter fullscreen", error)
        }
    }

    private enterPageFullscreen(el: HTMLElement) {
        try {
            el.setAttribute("popover", "manual")
            el.setAttribute("data-vc-page-fullscreen", "")
            el.showPopover()
        }
        catch (error) {
            el.removeAttribute("popover")
            el.removeAttribute("data-vc-page-fullscreen")
            log.warning("In-page fullscreen not possible, using the browser's", error)
            return false
        }
        this.pageFullscreen = true
        ;(window as any).OrientationBridge?.setVideoFullscreen(true)
        log.info("Entered fullscreen (in page)")
        // Same order as the browser's fullscreenchange: the grow is set before this frame is drawn.
        this.handleFullscreenChange()
        this._focusVideo()
        return true
    }

    private leavePageFullscreen() {
        const el = this.containerElement
        this.pageFullscreen = false
        if (el) {
            try {
                if (el.matches(":popover-open")) el.hidePopover()
            }
            catch {
            }
            el.removeAttribute("popover")
            el.removeAttribute("data-vc-page-fullscreen")
        }
        ;(window as any).OrientationBridge?.setVideoFullscreen(false)
        log.info("Exited fullscreen (in page)")
        this.handleFullscreenChange()
        this._focusVideo()
    }

    destroy() {
        if (this.pageFullscreen) this.leavePageFullscreen()
        this.cancelFlip()
        if ((window as any).__seanimeExitFullscreen === this.backExit) delete (window as any).__seanimeExitFullscreen
        this.controller.abort()
        this.containerElement = null
        this.videoElement = null

        const event: FullscreenManagerDestroyedEvent = new CustomEvent("destroyed")
        this.dispatchEvent(event)
    }

    private _focusVideo(): void {
        if (this.videoElement) {
            setTimeout(() => {
                this.videoElement?.focus()
            }, 100)
        }
    }

    private attachDocumentListeners() {
        for (const type of ["fullscreenchange", "webkitfullscreenchange"]) {
            document.addEventListener(type, this.handleFullscreenChange, { signal: this.controller.signal })
        }
    }

    private measureInline(el: HTMLElement) {
        if (this.isFullscreen || reducedMotion()) return null
        // An Android phone held upright turns to landscape for fullscreen: the system's rotation is the transition.
        if (!isLandscape() && (window as any).OrientationBridge) return null
        const r = el.getBoundingClientRect()
        if (r.width < 1 || r.height < 1) return null
        return { rect: { left: r.left, top: r.top, width: r.width, height: r.height }, radius: inlineRadius(el) }
    }

    /** The fullscreen element's own box; offsets ignore the translate/scale of a running transition. */
    private fullRect(el: HTMLElement): FlipRect {
        return { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight }
    }

    private playEnter() {
        const el = this.containerElement
        const before = this.inlineBefore
        this.inlineBefore = null
        if (!el || !before || this.fullscreenTarget !== el || reducedMotion()) return
        const full = this.fullRect(el)
        if (full.width < 1 || full.height < 1 || sameRect(before.rect, full)) return
        const landscape = isLandscape()
        // A turn of the screen mid-way would leave the frames pointing at the old layout; it ends the grow instead.
        window.addEventListener("resize", () => {
            if (isLandscape() !== landscape) this.cancelFlip()
        }, { once: true, signal: this.controller.signal })
        void this.animateFlip(el, vc_fullscreenFlipFrame(before.rect, full, before.radius), FULL_FRAME, 0, 1, FLIP_ENTER_MS, "none").catch(() => undefined)
    }

    private async playExit() {
        const el = this.containerElement
        if (!el || this.fullscreenTarget !== el || reducedMotion()) return
        // Leaving turns an Android phone back upright when fullscreen turned it; that rotation is the transition then.
        if (this.enteredLandscape === false || (this.enteredLandscape !== null && this.enteredLandscape !== isLandscape())) return
        // The player's frame stays in the page while the player is fullscreen, so it marks where the player lands.
        const slot = el.parentElement?.getBoundingClientRect()
        const full = this.fullRect(el)
        if (!slot || slot.width < 1 || slot.height < 1 || full.width < 1 || sameRect(slot, full)) return
        // From wherever a running grow is, so a quick second tap turns it around instead of jumping.
        const style = getComputedStyle(el)
        const from: FlipFrame = {
            translate: style.translate && style.translate !== "none" ? style.translate : FULL_FRAME.translate,
            scale: style.scale && style.scale !== "none" ? style.scale : FULL_FRAME.scale,
            clipPath: style.clipPath && style.clipPath !== "none" ? style.clipPath : FULL_FRAME.clipPath,
        }
        let backdrop = 1
        try {
            backdrop = parseFloat(getComputedStyle(el, "::backdrop").opacity)
            if (isNaN(backdrop)) backdrop = 1
        }
        catch {
        }
        // Under the opaque black backdrop the browser stops drawing the page. Shrinking straight away showed the
        // page beside the player black/empty for a frame until it was drawn again; a backdrop that is not quite
        // opaque for a few frames lets it be drawn first, with nothing visible changing.
        if (backdrop > .98 && from.scale === FULL_FRAME.scale) {
            try {
                this.flipAnimations.push(el.animate([{ opacity: .98 }, { opacity: .98 }], { duration: 1000, fill: "forwards", pseudoElement: "::backdrop" }))
                backdrop = .98
                await nextFrames(3)
                if (this.fullscreenTarget !== el) return
            }
            catch {
            }
        }
        const to = vc_fullscreenFlipFrame({ left: slot.left, top: slot.top, width: slot.width, height: slot.height }, full, inlineRadius(el))
        // Holds the last frame until the browser has left fullscreen; the fullscreenchange handler then removes it.
        await this.animateFlip(el, from, to, backdrop, 0, FLIP_EXIT_MS, "forwards")
    }

    private animateFlip(el: HTMLElement, from: FlipFrame, to: FlipFrame, backdropFrom: number, backdropTo: number, duration: number,
        fill: FillMode,
    ) {
        this.cancelFlip()
        const timing: KeyframeAnimationOptions = { duration, easing: FLIP_EASING, fill }
        const box = el.animate([{ ...from }, { ...to }], timing)
        this.flipAnimations = [box]
        try {
            // The page dims behind the growing player instead of turning black at once.
            this.flipAnimations.push(el.animate([{ opacity: backdropFrom }, { opacity: backdropTo }], { ...timing, pseudoElement: "::backdrop" }))
        }
        catch {
        }
        // Only the picture travels: the controls are laid out for the size the player ends at, so scaled they would
        // jump in size at the end. Growing, they fade in over the second half; shrinking, they are gone by 40 %.
        // (A keyframe list without an end runs to the controls' own opacity, so hidden controls stay hidden.)
        const grow = backdropTo > backdropFrom
        this.fadeControls(el, grow ? [{ opacity: 0, offset: 0 }, { opacity: 0, offset: .5 }] : [{ opacity: 0, offset: .4 }, { opacity: 0, offset: 1 }],
            { duration, easing: "linear", fill })
        return box.finished
    }

    private fadeControls(el: HTMLElement, keyframes: Keyframe[], timing: KeyframeAnimationOptions, track = true) {
        el.querySelectorAll<HTMLElement>(".vc-bar, .vc-center, .vc-phone-skip").forEach(control => {
            const animation = control.animate(keyframes, timing)
            if (track) this.flipAnimations.push(animation)
        })
    }

    private cancelFlip() {
        for (const animation of this.flipAnimations) animation.cancel()
        this.flipAnimations = []
    }

    private handleFullscreenChange = () => {
        const isFullscreen = this.isFullscreen
        log.info("Fullscreen state changed:", isFullscreen)
        // Runs before the frame that shows the new state, so the first painted frame already belongs to the transition.
        if (isFullscreen) {
            this.playEnter()
        } else {
            this.inlineBefore = null
            const shrunk = this.flipAnimations.length > 0
            this.cancelFlip()
            // The controls left during the shrink; back in the page they fade in at their inline size.
            if (shrunk && this.containerElement) this.fadeControls(this.containerElement, [{ opacity: 0, offset: 0 }], { duration: 180, easing: "ease-out" }, false)
        }

        const event: FullscreenManagerChangedEvent = new CustomEvent("fullscreenchanged", { detail: { isFullscreen } })
        this.dispatchEvent(event)

        this.onFullscreenChange(isFullscreen)
    }
}
