import { HlsAudioTrack } from "@/app/(main)/_features/video-core/video-core-hls"
import { VideoCore_VideoPlaybackInfo, VideoCoreSettings } from "@/app/(main)/_features/video-core/video-core.atoms"
import { tr } from "@/lib/app-language"
import { logger } from "@/lib/helpers/debug"
import { isTrackLanguageMatch } from "@/lib/helpers/language"
import { toast } from "sonner"

const audioLog = logger("AUDIO")

// Matroska audio codecs that browsers may lack a decoder for, with the type canPlayType understands
const UNDECODABLE_AUDIO_CODECS: Record<string, { mime: string, name: string } | undefined> = {
    "A_AC3": { mime: "audio/mp4; codecs=\"ac-3\"", name: "AC-3" },
    "A_EAC3": { mime: "audio/mp4; codecs=\"ec-3\"", name: "E-AC-3" },
    "A_DTS": { mime: "audio/mp4; codecs=\"dtsc\"", name: "DTS" },
    "A_TRUEHD": { mime: "audio/mp4; codecs=\"mlpa\"", name: "TrueHD" },
}

export type AudioManagerTrackChangedEvent = CustomEvent<{ trackNumber: number }>
export type AudioManagerHlsTrackChangedEvent = CustomEvent<{ trackId: number }>
export type AudioManagerErrorEvent = CustomEvent<{ error: string }>

interface VideoCoreAudioManagerEventMap {
    "trackchanged": AudioManagerTrackChangedEvent
    "hlstrackchanged": AudioManagerHlsTrackChangedEvent
    "error": AudioManagerErrorEvent
}

export class VideoCoreAudioManager extends EventTarget {
    private videoElement: HTMLVideoElement
    private settings: VideoCoreSettings
    // Playback info
    private playbackInfo: VideoCore_VideoPlaybackInfo
    // HLS-specific
    private readonly hlsSetAudioTrack: ((trackId: number) => void) | null = null
    private readonly hlsAudioTracks: HlsAudioTrack[] = []
    private hlsCurrentAudioTrack: number = -1
    // Without the audioTracks API: the audio track the server streams (null = the browser's own pick),
    // and how to ask for another one
    private streamAudioTrack: number | null = null
    private readonly onStreamAudioTrackChange: ((trackNumber: number) => void) | null = null

    constructor({
        videoElement,
        settings,
        playbackInfo,
        onError,
        hlsSetAudioTrack,
        hlsAudioTracks,
        hlsCurrentAudioTrack,
        streamAudioTrack,
        onStreamAudioTrackChange,
    }: {
        videoElement: HTMLVideoElement
        settings: VideoCoreSettings
        playbackInfo: VideoCore_VideoPlaybackInfo
        onError: (error: string) => void
        hlsSetAudioTrack?: ((trackId: number) => void) | null
        hlsAudioTracks?: HlsAudioTrack[]
        hlsCurrentAudioTrack?: number
        streamAudioTrack?: number | null
        onStreamAudioTrackChange?: (trackNumber: number) => void
    }) {
        super()
        this.videoElement = videoElement
        this.settings = settings
        this.playbackInfo = playbackInfo
        this.hlsSetAudioTrack = hlsSetAudioTrack || null
        this.hlsAudioTracks = hlsAudioTracks || []
        this.hlsCurrentAudioTrack = hlsCurrentAudioTrack ?? -1
        this.streamAudioTrack = streamAudioTrack ?? null
        this.onStreamAudioTrackChange = onStreamAudioTrackChange || null

        // Check if we're dealing with HLS audio tracks
        const isHls = this.hlsSetAudioTrack !== null && this.hlsAudioTracks.length > 0

        if (!isHls && this.videoElement.audioTracks) {
            // MKV audio track handling
            // Check that audio tracks are loaded
            if (this.videoElement.audioTracks.length <= 0) {
                // Dispatch error event
                const errorMessage = "The player does not support this audio codec. Please try another file or use an external player."
                const errorEvent: AudioManagerErrorEvent = new CustomEvent("error", { detail: { error: errorMessage } })
                this.dispatchEvent(errorEvent)
                onError(errorMessage)
                return
            }
            audioLog.info("Audio tracks", this.videoElement.audioTracks)
        } else if (!isHls) {
            // Without the audioTracks API (Android WebView) the browser plays the first audio track it can decode.
            // When there is none, the video runs silently; say why instead.
            const tracks = this.playbackInfo.mkvMetadata?.audioTracks ?? []
            const codecs = tracks.map(track => UNDECODABLE_AUDIO_CODECS[track.codecID])
            if (tracks.length > 0 && tracks.every(track => !this.canDecode(track.codecID))) {
                const names = [...new Set(codecs.map(codec => codec!.name))].join(", ")
                const action = this.appPlayerAction(this.settings.preferredAudioLanguage.split(",")[0]?.trim())
                toast.warning(action
                    ? tr(`No sound: the player here cannot play ${names} audio. The app player can.`,
                        `Kein Ton: Der Player hier kann ${names}-Ton nicht abspielen. Der App-Player kann es.`)
                    : tr(`No sound: this device cannot play ${names} audio. Use a release with AAC, Opus or FLAC audio.`,
                        `Kein Ton: Dieses Gerät kann ${names}-Ton nicht abspielen. Nimm eine Version mit AAC-, Opus- oder FLAC-Ton.`),
                    { action, duration: 15000 })
            }
        }

        // Select the default track
        this._selectDefaultTrack()
    }

    public get isHLS() {
        return this.hlsSetAudioTrack !== null && this.hlsAudioTracks.length > 0
    }

    addEventListener<K extends keyof VideoCoreAudioManagerEventMap>(
        type: K,
        listener: (this: VideoCoreAudioManager, ev: VideoCoreAudioManagerEventMap[K]) => any,
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

    removeEventListener<K extends keyof VideoCoreAudioManagerEventMap>(
        type: K,
        listener: (this: VideoCoreAudioManager, ev: VideoCoreAudioManagerEventMap[K]) => any,
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

    _selectDefaultTrack() {
        // Check if we're dealing with HLS
        if (this.isHlsStream()) {
            this.__selectDefaultHlsTrack()
            return
        }

        // The stream was already reloaded for a chosen track; keep it
        if (!this.videoElement.audioTracks && this.streamAudioTrack !== null) return

        // Event based track selection
        this.__selectDefaultEventTrack()
    }

    __selectDefaultEventTrack() {
        // Event based track selection
        // Split preferred languages by comma and trim whitespace
        const preferredLanguages = this.settings.preferredAudioLanguage
            .split(",")
            .map(lang => lang.trim())
            .filter(lang => lang.length > 0)

        // Try each preferred language in order
        for (const preferredLang of preferredLanguages) {
            const foundTracks = this.playbackInfo.mkvMetadata?.audioTracks?.filter?.(t => (
                isTrackLanguageMatch({
                    language: t.language,
                    label: t.name,
                }, preferredLang)
            ))
            if (foundTracks?.length) {
                // Find default track
                const defaultIndex = foundTracks.findIndex(t => t.default)
                this.selectTrack(foundTracks[defaultIndex >= 0 ? defaultIndex : 0].number)
                return
            }
        }

        // No preferred tracks found, look for default or forced tracks
        const defaultOrForcedTracks = this.playbackInfo.mkvMetadata?.audioTracks?.filter?.(t => t.default || t.forced)
        if (defaultOrForcedTracks?.length) {
            // Prioritize default tracks over forced tracks
            const defaultIndex = defaultOrForcedTracks.findIndex(t => t.default)
            this.selectTrack(defaultOrForcedTracks[defaultIndex >= 0 ? defaultIndex : 0].number)
            return
        }
    }

    selectTrack(trackNumber: number) {
        // If it's an HLS stream, select the track from the HLS API
        if (this.hlsSetAudioTrack) {
            audioLog.info("Selecting HLS audio track", trackNumber)
            this.hlsSetAudioTrack(trackNumber)
            // The HLS track change will be handled by the external `onHlsTrackChange` which dispatches the event
            return
        }

        // MKV audio track selection
        if (!this.videoElement.audioTracks) {
            this.selectStreamTrack(trackNumber)
            return
        }

        let trackChanged = false
        for (let i = 0; i < this.videoElement.audioTracks.length; i++) {
            const track = this.videoElement.audioTracks[i]
            const shouldEnable = this.getNativeTrackNumber(track, i) === trackNumber
            if (track.enabled !== shouldEnable) {
                track.enabled = shouldEnable
                trackChanged = true
            }
        }

        if (trackChanged && this.videoElement.audioTracks.dispatchEvent) {
            this.videoElement.audioTracks.dispatchEvent(new Event("change"))
        }

        const event: AudioManagerTrackChangedEvent = new CustomEvent("trackchanged", { detail: { trackNumber } })
        this.dispatchEvent(event)
    }

    getSelectedTrackNumberOrNull(): number | null {
        // Check if we're dealing with HLS
        if (this.hlsSetAudioTrack) {
            return this.hlsCurrentAudioTrack
        }

        // MKV audio track
        if (!this.videoElement.audioTracks) {
            return this.streamAudioTrack ?? this.playbackInfo.mkvMetadata?.audioTracks?.find(t => this.canDecode(t.codecID))?.number ?? null
        }

        for (let i = 0; i < this.videoElement.audioTracks.length; i++) {
            const track = this.videoElement.audioTracks[i]
            if (track.enabled) {
                return this.getNativeTrackNumber(track, i)
            }
        }

        return null
    }

    __selectDefaultHlsTrack() {
        if (!this.hlsSetAudioTrack || !this.isHlsStream()) return

        // Split preferred languages by comma and trim whitespace
        const preferredLanguages = this.settings.preferredAudioLanguage
            .split(",")
            .map(lang => lang.trim())
            .filter(lang => lang.length > 0)

        // Try each preferred language in order
        for (const preferredLang of preferredLanguages) {
            const foundTrack = this.hlsAudioTracks.find(t => (
                isTrackLanguageMatch({
                    language: t.language,
                    label: t.name,
                }, preferredLang)
            ))
            if (foundTrack) {
                audioLog.info("Selecting preferred HLS audio track", foundTrack)
                this.hlsSetAudioTrack(foundTrack.id)
                return
            }
        }

        // No preferred track found, look for default track
        const defaultTrack = this.hlsAudioTracks.find(t => t.default)
        if (defaultTrack) {
            audioLog.info("Selecting default HLS audio track", defaultTrack)
            this.hlsSetAudioTrack(defaultTrack.id)
            return
        }

        // Otherwise, select the first track
        if (this.hlsAudioTracks.length > 0) {
            audioLog.info("Selecting first HLS audio track", this.hlsAudioTracks[0])
            this.hlsSetAudioTrack(this.hlsAudioTracks[0].id)
        }
    }

    // Without the audioTracks API the browser plays the first track it can decode. Another track needs the stream
    // reloaded with only that track left as audio (the server hides the others).
    private selectStreamTrack(trackNumber: number) {
        const track = this.playbackInfo.mkvMetadata?.audioTracks?.find(t => t.number === trackNumber)
        if (!track || trackNumber === this.getSelectedTrackNumberOrNull()) return
        if (!this.canDecode(track.codecID)) {
            // with no playable track at all, the "No sound" notice already says it
            if (this.playbackInfo.mkvMetadata?.audioTracks?.every(t => !this.canDecode(t.codecID))) return
            const name = UNDECODABLE_AUDIO_CODECS[track.codecID]?.name ?? track.codecID
            toast.warning(tr(`This device cannot play ${name} audio, so this track stays off.`,
                `Dieses Gerät kann ${name}-Ton nicht abspielen, die Spur bleibt aus.`), { action: this.appPlayerAction(track.language), duration: 10000 })
            return
        }
        if (!this.onStreamAudioTrackChange) return

        audioLog.info("Reloading the stream for audio track", trackNumber)
        this.streamAudioTrack = trackNumber
        this.onStreamAudioTrackChange(trackNumber)
        const event: AudioManagerTrackChangedEvent = new CustomEvent("trackchanged", { detail: { trackNumber } })
        this.dispatchEvent(event)
    }

    // The Android app's own player decodes these with FFmpeg: it takes over the stream, this player continues where it stopped
    private appPlayerAction(language?: string) {
        const android = window.SeanimeAndroid
        if (!android?.playInAppPlayer) return undefined
        return {
            label: tr("Play in the app player", "Im App-Player abspielen"),
            onClick: () => {
                const video = this.videoElement
                const url = new URL(video.currentSrc, window.location.href)
                // the app player picks the track itself, it needs all of them
                url.searchParams.delete("audioTrack")
                const episode = this.playbackInfo.episode
                const title = [episode?.baseAnime?.title?.userPreferred, episode?.displayTitle].filter(Boolean).join(" · ") || "Seanime"
                video.pause()
                window.addEventListener("seanime-app-player-closed", e => {
                    const positionMs = (e as CustomEvent<{ positionMs: number }>).detail?.positionMs ?? 0
                    if (positionMs > 0) video.currentTime = positionMs / 1000
                }, { once: true })
                const subtitleLanguage = this.settings.preferredSubtitleLanguage.split(",")[0]?.trim() ?? ""
                android.playInAppPlayer!(url.toString(), title, Math.round(video.currentTime * 1000), language ?? "", subtitleLanguage)
            },
        }
    }

    private canDecode(codecID: string) {
        const codec = UNDECODABLE_AUDIO_CODECS[codecID]
        return !codec || !!this.videoElement.canPlayType(codec.mime)
    }

    syncSelectedTrack() {
        const trackNumber = this.getSelectedTrackNumberOrNull()
        if (trackNumber === null) return

        const event: AudioManagerTrackChangedEvent = new CustomEvent("trackchanged", { detail: { trackNumber } })
        this.dispatchEvent(event)
    }

    private trackIdsMatchMetadata() {
        const metadataTracks = this.playbackInfo.mkvMetadata?.audioTracks ?? []
        if (!this.videoElement.audioTracks || metadataTracks.length !== this.videoElement.audioTracks.length) return false

        const metadataNumbers = new Set(metadataTracks.map(track => Number(track.number)))
        for (let i = 0; i < this.videoElement.audioTracks.length; i++) {
            const id = Number(this.videoElement.audioTracks[i].id)
            if (!Number.isFinite(id) || !metadataNumbers.has(id)) return false
        }
        return true
    }

    private getNativeTrackNumber(track: AudioTrack, index: number) {
        const metadataTracks = this.playbackInfo.mkvMetadata?.audioTracks ?? []
        const id = Number(track.id)

        if (this.trackIdsMatchMetadata() && Number.isFinite(id)) {
            return id
        }

        if (metadataTracks[index]) {
            return Number(metadataTracks[index].number)
        }

        if (Number.isFinite(id)) {
            return id
        }

        return index
    }

    getHlsAudioTracks() {
        return this.hlsAudioTracks
    }

    // Update the current HLS audio track (called externally when track changes)
    onHlsTrackChange(trackId: number) {
        this.hlsCurrentAudioTrack = trackId

        const event: AudioManagerHlsTrackChangedEvent = new CustomEvent("hlstrackchanged", { detail: { trackId } })
        this.dispatchEvent(event)
    }

    isHlsStream() {
        return this.hlsSetAudioTrack !== null && this.hlsAudioTracks.length > 0
    }
}
