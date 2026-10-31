import { VideoCore_VideoPlaybackInfo } from "@/app/(main)/_features/video-core/video-core.atoms"
import { logger } from "@/lib/helpers/debug"
import { atom } from "jotai"

const log = logger("VIDEO CORE MEDIA SESSION")

export const vc_mediaSessionManager = atom<VideoCoreMediaSessionManager | null>(null)

const actions = ["play", "pause", "seekforward", "seekbackward", "seekto"] as const

export class VideoCoreMediaSessionManager {
    private video: HTMLVideoElement | null = null
    private playbackInfo: VideoCore_VideoPlaybackInfo | null = null
    private isActive = false
    private controller = new AbortController()
    private eventTarget = new EventTarget()
    private lastNativeSync = 0
    private hasNext = false
    private hasPrevious = false

    constructor() {
        if (!this.checkSupport()) return
    }

    setVideo(video: HTMLVideoElement | null) {
        this.video = video
        if (this.video && this.isActive) {
            this.setupVideoListeners()
            this.updatePlaybackState()
        }
    }

    setPlaybackInfo(playbackInfo: VideoCore_VideoPlaybackInfo | null) {
        this.playbackInfo = playbackInfo
        if (this.isActive) {
            this.updateMetadata()
        }
    }

    /** Next/previous episode buttons in the app's media notification */
    setQueue(hasNext: boolean, hasPrevious: boolean) {
        this.hasNext = hasNext
        this.hasPrevious = hasPrevious
        if (this.isActive) window.SeanimeMedia?.setQueue?.(hasNext, hasPrevious)
    }

    activate() {
        if (!this.checkSupport() || this.isActive) return

        this.isActive = true
        this.setupActionHandlers()
        // controls of the Android app's media notification and lock screen
        window.addEventListener("seanime-media-action", e => this.handleAction((e as CustomEvent<MediaSessionActionDetails>).detail),
            { signal: this.controller.signal })
        this.updateMetadata()
        window.SeanimeMedia?.setQueue?.(this.hasNext, this.hasPrevious)

        if (this.video) {
            this.setupVideoListeners()
            this.updatePlaybackState()
        }
    }

    deactivate() {
        if (!this.isActive) return

        this.isActive = false

        if ("mediaSession" in navigator) {
            navigator.mediaSession.playbackState = "none"
        }
        window.SeanimeMedia?.clear()

        this.onDisconnect()
        this.controller.abort()
        this.controller = new AbortController()
    }

    on(type: string, handler: EventListener) {
        this.eventTarget.addEventListener(type, handler)
    }

    off(type: string, handler: EventListener) {
        this.eventTarget.removeEventListener(type, handler)
    }

    destroy() {
        this.deactivate()
        this.video = null
        this.playbackInfo = null
    }

    // The Android WebView has no navigator.mediaSession; the app's bridge stands in for it there
    private checkSupport(): boolean {
        return "mediaSession" in navigator || !!window.SeanimeMedia
    }

    private dispatch(type: string, detail?: any) {
        this.eventTarget.dispatchEvent(new CustomEvent(type, { detail }))
    }

    private onDisconnect() {
        if (!("mediaSession" in navigator)) return

        // console.warn("Media session disconnected")

        for (const action of actions) {
            navigator.mediaSession.setActionHandler(action, null)
        }

        navigator.mediaSession.metadata = new MediaMetadata({
            title: "",
            artist: "",
            artwork: [],
        })

        if ("setPositionState" in navigator.mediaSession) {
            navigator.mediaSession.setPositionState()
        }
    }

    private updateMetadata() {
        if (!this.isActive) return

        if ("mediaSession" in navigator) navigator.mediaSession.metadata = this.createMetadata()
        this.syncNative()
    }

    private updatePlaybackState() {
        if (!this.isActive || !this.video) return

        if ("mediaSession" in navigator) navigator.mediaSession.playbackState = this.video.paused ? "paused" : "playing"
        this.syncNative()
    }

    private describe() {
        const episode = this.playbackInfo?.episode
        const anime = episode?.baseAnime
        return {
            title: episode?.displayTitle || "Seanime",
            artist: anime?.title?.userPreferred || anime?.title?.romaji || anime?.title?.english || "Video Player",
            imageUrl: episode?.episodeMetadata?.image || anime?.coverImage?.large || anime?.coverImage?.medium || "",
        }
    }

    private createMetadata(): MediaMetadata | null {
        if (!this.playbackInfo) return null

        const { title, artist, imageUrl } = this.describe()
        const artwork: MediaImage[] = []
        if (imageUrl) {
            artwork.push({ src: imageUrl, sizes: "512x512", type: "image/webp" })
        }

        return new MediaMetadata({ title, artist, artwork })
    }

    // The Android WebView shows no system media controls for a page; the app does (notification, lock screen, headset)
    private syncNative() {
        const native = window.SeanimeMedia
        if (!native || !this.isActive || !this.video || !this.playbackInfo) return
        this.lastNativeSync = Date.now()
        const { title, artist, imageUrl } = this.describe()
        native.update(title, artist, imageUrl, !this.video.paused, (this.video.currentTime || 0) * 1000, (this.video.duration || 0) * 1000)
        native.setPlaybackRate?.(this.video.playbackRate || 1)
        // the picture-in-picture window takes the video's shape
        if (this.video.videoWidth && this.video.videoHeight) native.setVideoSize?.(this.video.videoWidth, this.video.videoHeight)
    }

    private setupActionHandlers() {
        if (!("mediaSession" in navigator)) return

        const handleAction = this.handleAction.bind(this)
        for (const action of actions) {
            navigator.mediaSession.setActionHandler(action, handleAction)
        }
    }

    private handleAction(details: MediaSessionActionDetails) {
        switch (details.action) {
            case "play":
                this.dispatch("media-play-request")
                break
            case "pause":
                this.dispatch("media-pause-request")
                break
            case "nexttrack":
                this.dispatch("media-next-request")
                break
            case "previoustrack":
                this.dispatch("media-previous-request")
                break
            case "seekto":
            case "seekforward":
            case "seekbackward":
                let seekTime: number
                if (details.seekTime !== undefined) {
                    seekTime = details.seekTime
                } else {
                    const currentTime = this.video?.currentTime || 0
                    const offset = details.seekOffset || (details.action === "seekforward" ? 10 : -10)
                    seekTime = currentTime + offset
                }
                this.dispatch("media-seek-request", { seekTime })
                break
        }
    }

    private setupVideoListeners() {
        if (!this.video) return

        const options = { signal: this.controller.signal }

        this.video.addEventListener("play", this.updatePlaybackState.bind(this), options)
        this.video.addEventListener("pause", this.updatePlaybackState.bind(this), options)
        this.video.addEventListener("timeupdate", this.handleTimeUpdate.bind(this), options)
        this.video.addEventListener("loadedmetadata", this.updatePlaybackState.bind(this), options)
        this.video.addEventListener("seeked", this.syncNative.bind(this), options)
        this.video.addEventListener("ratechange", this.syncNative.bind(this), options)
        this.video.addEventListener("resize", this.syncNative.bind(this), options)
    }

    private handleTimeUpdate() {
        if (!this.isActive || !this.video) return
        // Android extrapolates the position while playing; an occasional update corrects drift
        if (Date.now() - this.lastNativeSync > 15_000) this.syncNative()
        if (!("mediaSession" in navigator)) return

        if ("setPositionState" in navigator.mediaSession) {
            navigator.mediaSession.setPositionState({
                duration: this.video.duration || 0,
                playbackRate: this.video.playbackRate || 1,
                position: this.video.currentTime || 0,
            })
        }
    }
}
