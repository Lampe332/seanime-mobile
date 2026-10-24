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

export class VideoCoreFullscreenManager extends EventTarget {
    private containerElement: HTMLElement | null = null
    private videoElement: HTMLVideoElement | null = null
    private controller = new AbortController()
    private onFullscreenChange: (isFullscreen: boolean) => void

    constructor(onFullscreenChange: (isFullscreen: boolean) => void) {
        super()
        this.onFullscreenChange = onFullscreenChange
        this.attachDocumentListeners()
    }

    public get isFullscreen(): boolean {
        return !!(
            document.fullscreenElement ||
            (document as any).webkitFullscreenElement
        )
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

    async toggleFullscreen() {
        if (this.isFullscreen) {
            await this.exitFullscreen()
        } else {
            await this.enterFullscreen()
        }
    }

    async exitFullscreen() {
        const attemptEvent: FullscreenManagerAttemptEvent = new CustomEvent("exitattempt", { detail: { method: "exit" } })
        this.dispatchEvent(attemptEvent)

        try {
            if (document.exitFullscreen) {
                await document.exitFullscreen()
            } else if ((document as any).webkitExitFullscreen) {
                await (document as any).webkitExitFullscreen()
            }
            log.info("Exited fullscreen")
            this._focusVideo()
        }
        catch (error) {
            log.error("Failed to exit fullscreen", error)
        }
    }

    async enterFullscreen() {
        const attemptEvent: FullscreenManagerAttemptEvent = new CustomEvent("enterattempt", { detail: { method: "enter" } })
        this.dispatchEvent(attemptEvent)

        if (!this.containerElement) {
            log.warning("Container element not set")
            return
        }

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
            log.error("Failed to enter fullscreen", error)
        }
    }

    destroy() {
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

    private handleFullscreenChange = () => {
        const isFullscreen = this.isFullscreen
        log.info("Fullscreen state changed:", isFullscreen)

        const event: FullscreenManagerChangedEvent = new CustomEvent("fullscreenchanged", { detail: { isFullscreen } })
        this.dispatchEvent(event)

        this.onFullscreenChange(isFullscreen)
    }
}
