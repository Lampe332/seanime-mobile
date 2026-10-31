import { getServerBaseUrl } from "@/api/client/server-url"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { useHandleCurrentMediaContinuity } from "@/api/hooks/continuity.hooks"
import { useDirectstreamConvertSubs } from "@/api/hooks/directstream.hooks"
import { useCancelDiscordActivity } from "@/api/hooks/discord.hooks"
import { MediaCoreBufferingOverlay, MediaCoreErrorOverlay, MediaCoreLoadingOverlay } from "@/app/(main)/_features/media-core/media-core-overlays"
import { useNakamaWatchParty } from "@/app/(main)/_features/nakama/nakama-manager"
import { nativePlayer_initialState, nativePlayer_stateAtom } from "@/app/(main)/_features/native-player/native-player.atoms"
import { type NormalizedSkipData } from "@/app/(main)/_features/video-core/_lib/aniskip.utils"
import { vc_anime4kOption, VideoCoreAnime4K } from "@/app/(main)/_features/video-core/video-core-anime-4k"
import { Anime4KOption, VideoCoreAnime4KManager } from "@/app/(main)/_features/video-core/video-core-anime-4k-manager"
import { vc_menuOpen } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_menuSectionOpen } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_activePlayerId } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_isSwiping } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_swipeSeekTime } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_videoSize } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_realVideoSize } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_duration } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_currentTime } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_playbackRate } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_readyState } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_buffering } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_isMuted } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_volume } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_subtitleDelay } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_isFullscreen } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_seeking } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_seekingTargetProgress } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_timeRanges } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_ended } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_paused } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_globalMiniPlayerAtom, vc_miniPlayer } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_cursorBusy } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_cursorPosition } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_busy } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_videoElement } from "@/app/(main)/_features/video-core/video-core-atoms"
import { useVideoCoreVolumeBoost } from "@/app/(main)/_features/video-core/video-core-volume-boost"
import { vc_containerElement } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_previousPausedState } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_lastKnownProgress } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_skipChapter } from "@/app/(main)/_features/video-core/video-core-atoms"
import { VideoCoreAudioManager } from "@/app/(main)/_features/video-core/video-core-audio"
import { VideoCoreAudioMenu } from "@/app/(main)/_features/video-core/video-core-audio-menu"
import {
    VideoCoreCenterControls,
    VideoCoreFullscreenButton,
    VideoCoreMobileControlBar,
    VideoCorePipButton,
    VideoCoreTimestamp,
    VideoCoreVolumeButton,
} from "@/app/(main)/_features/video-core/video-core-control-bar"
import { VideoCoreDrawer } from "@/app/(main)/_features/video-core/video-core-drawer"
import { useVideoCoreSetupEvents } from "@/app/(main)/_features/video-core/video-core-events"
import { vc_fullscreenManager, VideoCoreFullscreenManager } from "@/app/(main)/_features/video-core/video-core-fullscreen"
import {
    useVideoCoreHls,
    vc_hlsAudioTracks,
    vc_hlsCurrentAudioTrack,
    vc_hlsCurrentQuality,
    vc_hlsQualityLevels,
    vc_hlsSetAudioTrack,
    vc_hlsSetQuality,
} from "@/app/(main)/_features/video-core/video-core-hls"
import { MediaCaptionsManager } from "@/app/(main)/_features/video-core/video-core-media-captions"
import { vc_mediaSessionManager, VideoCoreMediaSessionManager } from "@/app/(main)/_features/video-core/video-core-media-session"
import { vc_overlayFeedback } from "@/app/(main)/_features/video-core/video-core-overlay-display"
import { vc_overlayFeedbackTimeout } from "@/app/(main)/_features/video-core/video-core-overlay-display"
import { vc_showOverlayFeedback } from "@/app/(main)/_features/video-core/video-core-overlay-display"
import { VideoCoreOverlayDisplay } from "@/app/(main)/_features/video-core/video-core-overlay-display"
import { vc_pip } from "@/app/(main)/_features/video-core/video-core-pip"
import { vc_pipElement, vc_pipManager, VideoCorePipManager } from "@/app/(main)/_features/video-core/video-core-pip"
import {
    useVideoCorePlaylist,
    useVideoCorePlaylistSetup,
    vc_playlistState,
    VideoCorePlaylistControl,
    VideoCoreTitle,
} from "@/app/(main)/_features/video-core/video-core-playlist"
import { VideoCoreKeybindingController } from "@/app/(main)/_features/video-core/video-core-keybindings"
import { VideoCorePreviewManager } from "@/app/(main)/_features/video-core/video-core-preview"
import { VideoCoreResolutionMenu } from "@/app/(main)/_features/video-core/video-core-resolution-menu"
import { VideoCoreSettingsMenu } from "@/app/(main)/_features/video-core/video-core-settings-menu"
import { useTr } from "@/lib/app-language"
import { withAnimeTracks } from "@/app/(main)/_features/video-core/video-core-anime-tracks"
import { VideoCoreCastButton, VideoCoreCastLayer } from "@/app/(main)/_features/video-core/video-core-cast"
import { LuSkipForward } from "react-icons/lu"
import { toast } from "sonner"
import { VideoCoreSubtitleMenu, type VideoCoreSubtitleSelection } from "@/app/(main)/_features/video-core/video-core-subtitle-menu"
import { VideoCoreSubtitleManager } from "@/app/(main)/_features/video-core/video-core-subtitles"
import { vc_timeRangeElement, VideoCoreTimeRange } from "@/app/(main)/_features/video-core/video-core-time-range"
import {
    vc_autoNextAtom,
    vc_sleepTimerAtom,
    vc_autoPlayVideoAtom,
    vc_autoSkipOPEDAtom,
    vc_beautifyImageAtom,
    vc_videoFitAtom,
    vc_settings,
    vc_storedMutedAtom,
    vc_storedPlaybackRateAtom,
    vc_storedVolumeAtom,
    vc_storedVolumeBoostAtom,
    VideoCore_VideoPlaybackInfo,
    VideoCore_VideoSource,
    VideoCore_VideoSubtitleTrack,
    VideoCoreLifecycleState,
} from "@/app/(main)/_features/video-core/video-core.atoms"
import { vc_dispatchAction } from "@/app/(main)/_features/video-core/video-core.utils"
import {
    useVideoCoreBindings,
    vc_createChapterCues,
    vc_createChaptersFromAniSkip,
} from "@/app/(main)/_features/video-core/video-core.utils"
import { useServerHMACAuth, useServerStatus } from "@/app/(main)/_hooks/use-server-status"
import { __torrentSearch_selectedTorrentsAtom } from "@/app/(main)/entry/_containers/torrent-search/torrent-search-container"
import {
    __torrentSearch_selectionAtom,
    __torrentSearch_selectionEpisodeAtom,
} from "@/app/(main)/entry/_containers/torrent-search/torrent-search-drawer"
import { Button, IconButton } from "@/components/ui/button"
import { cn } from "@/components/ui/core/styling"
import { logger } from "@/lib/helpers/debug"
import { useQueryClient } from "@tanstack/react-query"
import { ErrorData } from "hls.js"
import { atom } from "jotai"
import { ScopeProvider } from "jotai-scope"
import { useAtom, useAtomValue, useSetAtom } from "jotai/react"
import React, { useMemo, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { BiExpand, BiX } from "react-icons/bi"
import { FiMinimize2 } from "react-icons/fi"
import { RemoveScrollBar } from "react-remove-scroll-bar"
import { useUnmount, useUpdateEffect } from "react-use"
import { VideoCoreScreenshotDirPrompt } from "./video-core-screenshot-prompt"

const log = logger("VIDEO CORE")

const DELAY_BEFORE_NOT_BUSY = 1_000 //ms

type ViewTransitionDocument = Document & {
    startViewTransition?: (callback: () => void) => {
        finished: Promise<void>
    }
}

function startVideoCoreMiniPlayerTransition(update: () => void) {
    if (typeof document === "undefined" || typeof window === "undefined") {
        update()
        return
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        update()
        return
    }

    const documentWithViewTransition = document as ViewTransitionDocument
    if (!documentWithViewTransition.startViewTransition) {
        update()
        return
    }

    document.documentElement.setAttribute("data-vc-miniplayer-view-transition", "")

    try {
        const transition = documentWithViewTransition.startViewTransition(() => {
            flushSync(update)
        })

        void transition.finished.finally(() => {
            document.documentElement.removeAttribute("data-vc-miniplayer-view-transition")
        }).catch(() => { })
    }
    catch {
        document.documentElement.removeAttribute("data-vc-miniplayer-view-transition")
        update()
    }
}

export const vc_subtitleManager = atom<VideoCoreSubtitleManager | null>(null)
export const vc_mediaCaptionsManager = atom<MediaCaptionsManager | null>(null)
export const vc_audioManager = atom<VideoCoreAudioManager | null>(null)
export const vc_previewManager = atom<VideoCorePreviewManager | null>(null)
export const vc_anime4kManager = atom<VideoCoreAnime4KManager | null>(null)

// Seconds until auto next starts the next episode; null while no countdown runs
const vc_nextCountdown = atom<number | null>(null)
const AUTO_NEXT_SECONDS = 5

export function VideoCoreProvider(props: { id: string, children: React.ReactNode }) {
    const { children } = props

    const [activePlayer, setActivePlayer] = useAtom(vc_activePlayerId)
    const setNativePlayerState = useSetAtom(nativePlayer_stateAtom)

    React.useLayoutEffect(() => {
        if (props.id === "native-player") return

        setActivePlayer(props.id)
        setNativePlayerState(nativePlayer_initialState)

        return () => {
            setActivePlayer(null)
        }
    }, [])

    if (activePlayer !== null && activePlayer !== props.id) return null

    return (
        <ScopeProvider
            atoms={[
                vc_videoSize,
                vc_realVideoSize,
                vc_duration,
                vc_currentTime,
                vc_playbackRate,
                vc_readyState,
                vc_buffering,
                vc_isMuted,
                vc_volume,
                vc_subtitleDelay,
                // vc_isFullscreen, expose this
                vc_seeking,
                vc_seekingTargetProgress,
                vc_timeRanges,
                vc_ended,
                vc_paused,
                vc_miniPlayer,
                vc_cursorPosition,
                vc_busy,
                vc_videoElement,
                vc_containerElement,
                vc_subtitleManager,
                vc_audioManager,
                vc_previewManager,
                vc_anime4kManager,
                vc_pipManager,
                vc_fullscreenManager,
                vc_mediaSessionManager,
                vc_pipElement,
                vc_previousPausedState,
                vc_lastKnownProgress,
                vc_skipChapter,
                vc_dispatchAction,
                vc_menuOpen,
                vc_menuSectionOpen,
                vc_showOverlayFeedback,
                vc_overlayFeedback,
                vc_overlayFeedbackTimeout,
                vc_playlistState,
                vc_timeRangeElement,
                vc_hlsQualityLevels,
                vc_hlsCurrentQuality,
                vc_hlsSetQuality,
                vc_hlsAudioTracks,
                vc_hlsCurrentAudioTrack,
                vc_hlsSetAudioTrack,
                vc_isSwiping,
                vc_swipeSeekTime,
            ]}
        >
            {children}
        </ScopeProvider>
    )
}

export type VideoCoreChapterCue = {
    startTime: number
    endTime: number
    text: string
}

interface PlayerContentProps {
    videoRef: React.MutableRefObject<HTMLVideoElement | null>
    inline: boolean
    state: VideoCoreLifecycleState
    chapterCues: VideoCoreChapterCue[] | undefined
    aniSkipData: VideoCoreProps["aniSkipData"]
    streamUrl: string | undefined
    combineRef: (instance: HTMLVideoElement | null) => void
    combineContainerRef: (instance: HTMLDivElement | null) => void
    handleContainerPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void
    handleContainerMouseEnter: () => void
    handleContainerMouseLeave: () => void
    handleClick: (e: React.MouseEvent<HTMLDivElement>) => void
    handleLoadedMetadata: (e: React.SyntheticEvent<HTMLVideoElement>) => void
    handleTimeUpdate: (e: React.SyntheticEvent<HTMLVideoElement>) => void
    handleEnded: (e: React.SyntheticEvent<HTMLVideoElement>) => void
    handlePlay: (e: React.SyntheticEvent<HTMLVideoElement>) => void
    handlePause: (e: React.SyntheticEvent<HTMLVideoElement>) => void
    handleDoubleClick: (e: React.MouseEvent<HTMLVideoElement>) => void
    handleLoadedData: (e: React.SyntheticEvent<HTMLVideoElement>) => void
    handleVolumeChange: (e: React.SyntheticEvent<HTMLVideoElement>) => void
    handleRateChange: (e: React.SyntheticEvent<HTMLVideoElement>) => void
    handleError: (e: React.SyntheticEvent<HTMLVideoElement>) => void
    handleWaiting: (e: React.SyntheticEvent<HTMLVideoElement>) => void
    handleCanPlay: (e: React.SyntheticEvent<HTMLVideoElement>) => void
    handleStalled: (e: React.SyntheticEvent<HTMLVideoElement>) => void
    /** The <video> element's own error, shown when the server reports none */
    videoError: string | null
    onRetryVideo: (() => void) | undefined
    onTerminateStream: () => void
    onVideoSourceChange: ((source: VideoCore_VideoSource) => void) | undefined
    onHlsQualityChange: ((quality: string) => void) | undefined
    onSubtitlePreferenceChange: ((selection: VideoCoreSubtitleSelection) => void) | undefined
    suppressAutoPlay: boolean
}

const PlayerContent = React.memo<PlayerContentProps>(({
    videoRef,
    inline,
    state,
    chapterCues,
    aniSkipData,
    streamUrl,
    combineRef,
    combineContainerRef,
    handleContainerPointerMove,
    handleContainerMouseEnter,
    handleContainerMouseLeave,
    handleClick,
    handleLoadedMetadata,
    handleTimeUpdate,
    handleEnded,
    handlePlay,
    handlePause,
    handleDoubleClick,
    handleLoadedData,
    handleVolumeChange,
    handleRateChange,
    handleError,
    handleWaiting,
    handleCanPlay,
    handleStalled,
    videoError,
    onRetryVideo,
    onTerminateStream,
    onVideoSourceChange,
    onHlsQualityChange,
    onSubtitlePreferenceChange,
    suppressAutoPlay,
}) => {
    const isMiniPlayer = useAtomValue(vc_miniPlayer)
    const busy = useAtomValue(vc_busy)
    const buffering = useAtomValue(vc_buffering)
    const settings = useAtomValue(vc_settings)
    const beautifyImage = useAtomValue(vc_beautifyImageAtom)
    const videoFit = useAtomValue(vc_videoFitAtom)
    const isPip = useAtomValue(vc_pip)
    const fullscreen = useAtomValue(vc_isFullscreen)
    const skipChapter = useAtomValue(vc_skipChapter)
    const [nextCountdown, setNextCountdown] = useAtom(vc_nextCountdown)
    const pipManager = useAtomValue(vc_pipManager)
    const action = useSetAtom(vc_dispatchAction)
    const [autoPlay] = useAtom(vc_autoPlayVideoAtom)
    const [muted] = useAtom(vc_storedMutedAtom)

    return (
        <>

            <MediaCoreErrorOverlay playbackError={state.playbackError ?? videoError} isMiniPlayer={isMiniPlayer} onClose={onTerminateStream}
                onRetry={state.playbackError ? undefined : onRetryVideo} />

            <div
                data-vc-element="container"
                data-vc-fullscreen={fullscreen}
                data-vc-inline={!!inline}
                data-vc-mini={isMiniPlayer}
                ref={combineContainerRef}
                className={cn(
                    "relative w-full h-full bg-black overflow-clip flex items-center justify-center",
                    (!busy && !isMiniPlayer) && "cursor-none",
                )}
                onPointerMove={handleContainerPointerMove}
                onMouseEnter={handleContainerMouseEnter}
                onMouseLeave={handleContainerMouseLeave}
            >
                {(!!state.playbackInfo?.streamUrl && !state.loadingState) ? (
                    <>
                        <VideoCoreKeybindingController
                            videoRef={videoRef}
                            active={state.active}
                            chapterCues={chapterCues ?? []}
                            introStartTime={aniSkipData?.op?.interval?.startTime}
                            introEndTime={aniSkipData?.op?.interval?.endTime}
                            endingStartTime={aniSkipData?.ed?.interval?.startTime}
                            endingEndTime={aniSkipData?.ed?.interval?.endTime}
                        />

                        <VideoCoreOverlayDisplay />

                        <MediaCoreBufferingOverlay buffering={buffering} />

                        {busy && !!skipChapter && !isMiniPlayer && nextCountdown === null && (
                            <PhoneSkipButton
                                label={skipChapter.label}
                                onSkip={() => action({ type: "seekTo", payload: { time: skipChapter.end } })}
                            />
                        )}

                        {nextCountdown !== null && !isMiniPlayer && (
                            <PhoneNextCountdown seconds={nextCountdown} onPlay={() => setNextCountdown(0)} onCancel={() => setNextCountdown(null)} />
                        )}

                        {!isMiniPlayer && <VideoCoreCastLayer />}

                        <div
                            data-vc-element="inner-container"
                            className="relative w-full h-full flex items-center justify-center"
                            onClick={handleClick}
                            onContextMenu={handleClick}
                        >
                            <video
                                data-vc-element="video"
                                data-video-core-element
                                crossOrigin="anonymous"
                                preload="auto"
                                src={streamUrl && !streamUrl.includes(".m3u8") ? streamUrl : undefined}
                                ref={combineRef}
                                tabIndex={0}
                                onLoadedMetadata={handleLoadedMetadata}
                                onTimeUpdate={handleTimeUpdate}
                                onEnded={handleEnded}
                                onPlay={handlePlay}
                                onPause={handlePause}
                                onDoubleClick={handleDoubleClick}
                                onLoadedData={handleLoadedData}
                                onVolumeChange={handleVolumeChange}
                                onRateChange={handleRateChange}
                                onError={handleError}
                                onWaiting={handleWaiting}
                                onCanPlay={handleCanPlay}
                                onStalled={handleStalled}
                                autoPlay={autoPlay && !suppressAutoPlay}
                                muted={muted}
                                playsInline
                                controls={false}
                                style={{
                                    border: "none",
                                    outline: "none",
                                    width: "100%",
                                    height: "100%",
                                    objectFit: videoFit,
                                    objectPosition: "center",
                                    filter: (settings.videoEnhancement.enabled && beautifyImage)
                                        ? `contrast(${settings.videoEnhancement.contrast}) saturate(${settings.videoEnhancement.saturation}) brightness(${settings.videoEnhancement.brightness})`
                                        : "none",
                                    imageRendering: "auto",
                                }}
                            >
                                {state.playbackInfo?.mkvMetadata?.subtitleTracks?.map(track => (
                                    <track
                                        id={track.number.toString()}
                                        key={track.number}
                                        kind="subtitles"
                                        srcLang={track.language || "eng"}
                                        label={track.name}
                                    />
                                ))}
                            </video>
                        </div>

                        {isPip && (
                            <div
                                data-vc-element="pip-overlay"
                                className="absolute top-0 left-0 w-full h-full z-[100] bg-black flex items-center justify-center"
                            >
                                <Button
                                    intent="gray-outline"
                                    size="xl"
                                    onClick={() => {
                                        pipManager?.togglePip()
                                    }}
                                >
                                    Exit PiP
                                </Button>
                            </div>
                        )}

                        <VideoCoreCenterControls />

                        <VideoCoreMobileControlBar
                            timeRange={<VideoCoreTimeRange chapterCues={chapterCues ?? []} />}
                            topLeftSection={<>
                                <VideoCorePlaylistControl />
                                <VideoCoreTitle />
                            </>}
                            topRightSection={<>
                                <VideoCoreSettingsMenu />
                                <VideoCoreResolutionMenu
                                    state={state}
                                    onVideoSourceChange={onVideoSourceChange}
                                    onHlsQualityChange={onHlsQualityChange}
                                />
                                <VideoCoreSubtitleMenu inline={inline} onPreferenceChange={onSubtitlePreferenceChange} />
                                <VideoCoreAudioMenu />
                                <VideoCoreCastButton />
                                <VideoCorePipButton />
                                <VideoCoreVolumeButton />
                            </>}
                            bottomRightSection={<VideoCoreFullscreenButton />}
                            bottomLeftSection={<VideoCoreTimestamp />}
                        />
                    </>
                ) : (
                    <MediaCoreLoadingOverlay
                        loadingState={state.loadingState}
                        isMiniPlayer={isMiniPlayer}
                        inline={inline}
                        fullscreen={fullscreen}
                        terminateButton={<LoadingFloatingButtons onTerminateStream={onTerminateStream} />}
                    />
                )}
            </div>
        </>
    )
})

PlayerContent.displayName = "PlayerContent"

const PLAYBACK_STALL_TIMEOUT_MS = 12_000

export interface VideoCoreProps {
    id: string
    state: VideoCoreLifecycleState
    aniSkipData?: NormalizedSkipData | undefined
    onTerminateStream: () => void
    onEnded?: () => void
    onCompleted?: () => void
    onPlay?: () => void
    onPause?: () => void
    onTimeUpdate?: (e: React.SyntheticEvent<HTMLVideoElement, Event>) => void
    onLoadedData?: (e: React.SyntheticEvent<HTMLVideoElement, Event>) => void
    onLoadedMetadata?: (e: React.SyntheticEvent<HTMLVideoElement, Event>) => void
    onVolumeChange?: () => void
    onFullscreenChange?: (fullscreen: boolean) => void
    onSeeking?: () => void
    onSeeked?: (time: number) => void
    onError?: (error: string) => void
    onStalled?: (reason: string) => void
    onPlaybackRateChange?: () => void
    onVideoSourceChange?: ((source: VideoCore_VideoSource) => void) | undefined
    hlsPreferredQuality?: string
    onHlsQualityChange?: (quality: string) => void
    onPlayEpisode?: (which: "previous" | "next") => void
    inlineClassName?: string
    onHlsMediaDetached?: () => void
    onHlsFatalError?: (error: ErrorData) => void
    onSubtitlePreferenceChange?: (selection: VideoCoreSubtitleSelection) => void
    onChangePlaybackType?: (type: VideoCore_VideoPlaybackInfo["streamType"]) => void
    inline?: boolean
    // Load without starting, despite the auto play setting (a page that only shows the player)
    suppressAutoPlay?: boolean
    mRef?: React.MutableRefObject<HTMLVideoElement | null>
}

export function VideoCore(props: VideoCoreProps) {
    const {
        state,
        aniSkipData,
        onTerminateStream: _onTerminateStream,
        onEnded,
        onPlay,
        onCompleted,
        onPause,
        onTimeUpdate,
        onLoadedData,
        onLoadedMetadata,
        onVolumeChange,
        onFullscreenChange,
        onSeeking,
        onSeeked,
        onError,
        onStalled,
        onPlaybackRateChange,
        // onFileUploaded,
        inline = false,
        inlineClassName,
        onVideoSourceChange,
        hlsPreferredQuality,
        onHlsQualityChange,
        onHlsMediaDetached,
        onHlsFatalError,
        onSubtitlePreferenceChange,
        onPlayEpisode,
        onChangePlaybackType,
        suppressAutoPlay = false,
        mRef,
    } = props
    const serverStatus = useServerStatus()
    const { getHMACTokenQueryParam } = useServerHMACAuth()
    const [streamType, setStreamType] = useState<VideoCore_VideoPlaybackInfo["streamType"]>(state.playbackInfo?.streamType ?? "unknown")

    // HMAC token for directstream attachment URLs (fonts)
    const [directstreamAttToken, setDirectstreamAttToken] = React.useState("")
    React.useEffect(() => {
        (async () => {
            setDirectstreamAttToken(await getHMACTokenQueryParam("/api/v1/directstream/att", "?"))
        })()
    }, [getHMACTokenQueryParam])

    const videoRef = useRef<HTMLVideoElement | null>(null)
    const containerRef = useRef<HTMLDivElement | null>(null)
    const [pluginSkipDataOverride, setPluginSkipDataOverride] = useState<NormalizedSkipData | undefined>(undefined)
    const resolvedSkipData = useMemo(() => pluginSkipDataOverride ?? aniSkipData, [pluginSkipDataOverride, aniSkipData])
    const currentSkipDataRef = useRef<NormalizedSkipData | undefined>(resolvedSkipData)
    currentSkipDataRef.current = resolvedSkipData

    const {
        dispatchTerminatedEvent,
        dispatchVideoLoadedEvent,
        dispatchVideoCompletedEvent,
        dispatchVideoErrorEvent,
        dispatchCanPlayEvent,
        dispatchTranslateTextEvent,
        dispatchTranslateSubtitleTrackEvent,
    } = useVideoCoreSetupEvents(props.id, state, onTerminateStream, setPluginSkipDataOverride, currentSkipDataRef)

    const [videoElement, setVideoElement] = useAtom(vc_videoElement)
    const setRealVideoSize = useSetAtom(vc_realVideoSize)
    useVideoCoreBindings(videoElement, state.playbackInfo)
    useVideoCorePlaylistSetup(state, onPlayEpisode)

    const { isParticipant: isWatchPartyParticipant } = useNakamaWatchParty()

    const videoCompletedRef = useRef(false)
    const currentPlaybackRef = useRef<string | null>(null)
    const stalledPlaybackRef = useRef<string | null>(null)

    const [, setContainerElement] = useAtom(vc_containerElement)

    const [subtitleManager, setSubtitleManager] = useAtom(vc_subtitleManager)
    const [mediaCaptionsManager, setMediaCaptionsManager] = useAtom(vc_mediaCaptionsManager)
    const [audioManager, setAudioManager] = useAtom(vc_audioManager)
    const [previewManager, setPreviewManager] = useAtom(vc_previewManager)
    const [anime4kManager, setAnime4kManager] = useAtom(vc_anime4kManager)
    const [pipManager, setPipManager] = useAtom(vc_pipManager)
    const setPipElement = useSetAtom(vc_pipElement)
    const [fullscreenManager, setFullscreenManager] = useAtom(vc_fullscreenManager)
    const setIsFullscreen = useSetAtom(vc_isFullscreen)
    const [mediaSessionManager, setMediaSessionManager] = useAtom(vc_mediaSessionManager)
    const action = useSetAtom(vc_dispatchAction)

    // States
    const qc = useQueryClient()
    const settings = useAtomValue(vc_settings)
    const [isMiniPlayer, setIsMiniPlayer] = useAtom(vc_miniPlayer)
    const setGlobalMiniPlayer = useSetAtom(vc_globalMiniPlayerAtom)
    React.useEffect(() => {
        setGlobalMiniPlayer(isMiniPlayer)
        return () => {
            setGlobalMiniPlayer(false)
        }
    }, [isMiniPlayer, setGlobalMiniPlayer])
    // Android picture-in-picture buttons are routed through the player actions so state stays in sync.
    React.useEffect(() => {
        if (!videoElement) return
        const onPipCommand = (event: Event) => {
            const detail = (event as CustomEvent<{ command: string, seconds?: number, video: HTMLVideoElement, handled: boolean }>).detail
            if (detail.video !== videoElement) return
            detail.handled = true
            if (detail.command === "toggle") action({ type: "togglePlay" })
            else if (detail.command === "seek") action({ type: "seek", payload: { time: detail.seconds ?? 0 } })
        }
        window.addEventListener("seanime:pip-command", onPipCommand)
        return () => window.removeEventListener("seanime:pip-command", onPipCommand)
    }, [videoElement, action])
    const [busy, setBusy] = useAtom(vc_busy)
    const [buffering, setBuffering] = useAtom(vc_buffering)
    const duration = useAtomValue(vc_duration)
    const fullscreen = useAtomValue(vc_isFullscreen)
    const showOverlayFeedback = useSetAtom(vc_showOverlayFeedback)
    const cursorBusy = useAtomValue(vc_cursorBusy)

    const setSkipChapter = useSetAtom(vc_skipChapter)

    const [autoNext] = useAtom(vc_autoNextAtom)
    const [sleepTimer, setSleepTimer] = useAtom(vc_sleepTimerAtom)
    const tr = useTr()
    const [autoPlay] = useAtom(vc_autoPlayVideoAtom)
    const [autoSkipOpeningOutro] = useAtom(vc_autoSkipOPEDAtom)
    const [volume] = useAtom(vc_storedVolumeAtom)
    const volumeBoost = useAtomValue(vc_storedVolumeBoostAtom)
    const [muted] = useAtom(vc_storedMutedAtom)
    const [playbackRate, setPlaybackRate] = useAtom(vc_storedPlaybackRateAtom)

    const { mutate: cancelDiscordActivity } = useCancelDiscordActivity()

    const { mutate: convertSubs } = useDirectstreamConvertSubs()

    const isFirstError = React.useRef(true)
    const [videoError, setVideoError] = React.useState<string | null>(null)
    const shouldDispatchTerminatedOnUnmount = React.useRef(false)
    const [activePlayer, setActivePlayer] = useAtom(vc_activePlayerId)

    React.useEffect(() => {
        setIsMiniPlayer(false)
    }, [])

    React.useEffect(() => {
        setPluginSkipDataOverride(undefined)
    }, [state.playbackInfo?.id])

    const onHistoryPop = React.useEffectEvent(() => {
        if (window.history.state?.videoCoreDrawer) {
            if (isMiniPlayer) setIsMiniPlayer(false)
        } else {
            // Back closes the player, as in other video apps; the minimize button still makes the mini player
            onTerminateStream()
        }
    })

    React.useEffect(() => {
        if (!state.active || inline) return

        window.history.pushState({ ...window.history.state, videoCoreDrawer: true }, "")
        window.addEventListener("popstate", onHistoryPop)

        return () => {
            window.removeEventListener("popstate", onHistoryPop)
            if (window.history.state?.videoCoreDrawer) {
                window.history.back()
            }
        }
    }, [state.active, inline])

    // Track if this player should dispatch terminated event on unmount
    React.useEffect(() => {
        shouldDispatchTerminatedOnUnmount.current = (activePlayer === props.id && !!state.playbackInfo)
    }, [activePlayer, props.id, state.playbackInfo?.id])

    // Call dispatchTerminatedEvent on unmount if this was the active player
    useUnmount(() => {
        if (shouldDispatchTerminatedOnUnmount.current) {
            dispatchTerminatedEvent()
            setActivePlayer(null)
        }
    })

    function onTerminateStream() {
        _onTerminateStream?.()
        dispatchTerminatedEvent()
    }

    // measure video element size using a throttled ResizeObserver
    const videoResizeObserverRef = React.useRef<ResizeObserver | null>(null)
    const videoResizeRafRef = React.useRef<number | null>(null)
    const videoResizeTargetRef = React.useRef<HTMLVideoElement | null>(null)

    React.useEffect(() => {
        videoResizeObserverRef.current = new ResizeObserver((entries) => {
            if (videoResizeRafRef.current !== null) return // already scheduled
            videoResizeRafRef.current = requestAnimationFrame(() => {
                videoResizeRafRef.current = null
                const entry = entries[0]
                if (!entry) return
                const { width: w, height: h } = entry.contentRect
                setRealVideoSize(prev => {
                    if (prev.width === w && prev.height === h) return prev
                    return { width: w, height: h }
                })
            })
        })

        return () => {
            videoResizeObserverRef.current?.disconnect()
            if (videoResizeRafRef.current !== null) {
                cancelAnimationFrame(videoResizeRafRef.current)
            }
        }
    }, [])

    // refetch continuity data when playback info changes
    React.useEffect(() => {
        qc.invalidateQueries({ queryKey: [API_ENDPOINTS.CONTINUITY.GetContinuityWatchHistory.key] })
        qc.invalidateQueries({ queryKey: [API_ENDPOINTS.CONTINUITY.GetContinuityWatchHistoryItem.key] })

    }, [state.playbackInfo?.id])

    // Re-focus the video element when playback info changes
    React.useEffect(() => {
        if (state.active && videoRef.current && !!state.playbackInfo) {
            // Small delay to ensure the video element is fully rendered
            setTimeout(() => {
                videoRef.current?.focus()
            }, 100)
        }
    }, [state.active, state.playbackInfo?.id])

    // Merge refs
    const combineRef = React.useCallback((instance: HTMLVideoElement | null) => {
        videoRef.current = instance
        if (mRef) {
            mRef.current = instance
        }
        // observe/unobserve the video element for size changes
        if (videoResizeTargetRef.current && videoResizeTargetRef.current !== instance) {
            videoResizeObserverRef.current?.unobserve(videoResizeTargetRef.current)
        }
        if (instance) {
            videoResizeObserverRef.current?.observe(instance)
        }
        videoResizeTargetRef.current = instance
        setVideoElement(instance)
    }, [mRef, setVideoElement])

    const combineContainerRef = React.useCallback((instance: HTMLDivElement | null) => {
        containerRef.current = instance
        setContainerElement(instance)
    }, [setContainerElement])

    // A replaced <video> stays referenced and keeps its decoder until its source is dropped. Phones and tablets
    // only have a few hardware decoders, so after some episodes a new stream would fail with a decode error.
    React.useEffect(() => {
        const element = videoElement
        return () => {
            if (!element || element.isConnected) return
            element.pause()
            element.removeAttribute("src")
            element.load()
        }
    }, [videoElement])

    // actions
    function togglePlay() {
        if (videoRef?.current?.paused) {
            videoRef?.current?.play().catch()
            onPlay?.()
            showOverlayFeedback({ message: "PLAY", type: "icon" })
        } else {
            videoRef?.current?.pause()
            onPause?.()
            showOverlayFeedback({ message: "PAUSE", type: "icon" })
        }
    }

    function onAudioChange() {
        log.info("Audio changed", videoRef.current?.audioTracks)
        audioManager?.syncSelectedTrack()
        action({ type: "seek", payload: { time: -1 } })
    }

    // Continuity
    const {
        watchHistory,
        waitForWatchHistory,
        shouldWaitForWatchHistory,
        getEpisodeContinuitySeekTo,
    } = useHandleCurrentMediaContinuity(state?.playbackInfo?.media?.id)

    React.useEffect(() => {
        if (watchHistory) {
            log.info("Continuity watch history", watchHistory)
        }
    }, [watchHistory])

    const hasSoughtRef = React.useRef(false)

    // Lifecycle
    useUpdateEffect(() => {
        // Wait for watch history to be ready before starting playback (only if continuity is enabled)
        if (waitForWatchHistory && shouldWaitForWatchHistory && !state.playbackInfo?.disableRestoreFromContinuity) return

        // If the playback info is null, the stream is loading or unmounted
        if (!state.playbackInfo) {
            log.info("Cleaning up")
            dispatchTerminatedEvent()
            cancelDiscordActivity()
            hasSoughtRef.current = false
            isFirstError.current = true
            setVideoError(null)
            if (videoRef.current) {
                videoRef.current.pause()
                videoRef.current.removeAttribute("src")
                videoRef.current.load()
                videoRef.current = null
            }
            setVideoElement(null)
            subtitleManager?.destroy?.()
            setSubtitleManager(null)
            mediaCaptionsManager?.destroy?.()
            setMediaCaptionsManager(null)
            previewManager?.cleanup?.()
            setPreviewManager(null)
            setAudioManager(null)
            anime4kManager?.destroy?.()
            setAnime4kManager(null)
            pipManager?.destroy?.()
            setPipManager(null)
            setPipElement(null)
            // Keep the fullscreenManager alive during buffering or transitions to next episodes (when state.active is true).
            // Only destroy and set it to null if the stream is terminated entirely
            if (!state.active && fullscreenManager) {
                fullscreenManager.exitFullscreen()
                fullscreenManager.destroy()
                setFullscreenManager(null)
            }
            if (mediaSessionManager) {
                mediaSessionManager.setVideo(null)
                mediaSessionManager.destroy()
            }
            setMediaSessionManager(null)
            currentPlaybackRef.current = null
            videoRef.current = null
        }

        // When a new playback info is received
        if (!!state.playbackInfo?.id && (!currentPlaybackRef.current || state.playbackInfo.id !== currentPlaybackRef.current)) {
            hasSoughtRef.current = false
            isFirstError.current = true
            setVideoError(null)
            log.info("New stream loaded", state.playbackInfo)
            setStreamType(state.playbackInfo.streamType)
            dispatchVideoLoadedEvent()
        }
    }, [state.playbackInfo?.id, waitForWatchHistory, shouldWaitForWatchHistory])

    // Override active player, won't apply to native-player
    React.useEffect(() => {
        if (state.playbackInfo?.id && activePlayer === props.id) {
            setActivePlayer(props.id)
        }
    }, [state.playbackInfo?.id, activePlayer])

    // Without the audioTracks API, another audio track means reloading the stream with ?audioTrack=<number>;
    // the position and play state are restored once the new stream has its metadata
    const [streamAudioTrack, setStreamAudioTrack] = React.useState<{ playbackId: string, track: number } | null>(null)
    const streamAudioTrackNumber = streamAudioTrack && streamAudioTrack.playbackId === state.playbackInfo?.id ? streamAudioTrack.track : null
    const pendingAudioSwitchRef = React.useRef<{ time: number, paused: boolean } | null>(null)

    const baseStreamUrl = state?.playbackInfo?.streamUrl?.replace?.("{{SERVER_URL}}", getServerBaseUrl())
    const streamUrl = baseStreamUrl && streamAudioTrackNumber !== null && !baseStreamUrl.includes(".m3u8")
        ? `${baseStreamUrl}${baseStreamUrl.includes("?") ? "&" : "?"}audioTrack=${streamAudioTrackNumber}`
        : baseStreamUrl

    // Initialize HLS
    useVideoCoreHls({
        videoElement: videoRef.current,
        streamUrl: streamUrl,
        streamType: streamType,
        preferredQuality: hlsPreferredQuality,
        suppressAutoPlay: suppressAutoPlay,
        onMediaDetached: onHlsMediaDetached,
        onFatalError: onHlsFatalError,
        onStalled: err => onStalled?.(`HLS stalled: ${err.error?.message || err.details}`),
    })

    React.useEffect(() => {
        if (!state.playbackInfo?.id || !streamUrl || !buffering) return
        if (!videoRef.current || videoRef.current.paused) return

        const playbackId = state.playbackInfo.id
        const startedAt = videoRef.current.currentTime
        const timeout = window.setTimeout(() => {
            const video = videoRef.current
            if (!video || video.paused || video.readyState >= 3) return
            if (Math.abs(video.currentTime - startedAt) >= 0.5) return

            const stallKey = `${playbackId}:${startedAt.toFixed(1)}`
            if (stalledPlaybackRef.current === stallKey) return
            stalledPlaybackRef.current = stallKey
            onStalled?.("Playback stalled while buffering")
        }, PLAYBACK_STALL_TIMEOUT_MS)

        return () => window.clearTimeout(timeout)
    }, [state.playbackInfo?.id, streamUrl, buffering, onStalled])

    const [anime4kOption, setAnime4kOption] = useAtom(vc_anime4kOption)

    // Get HLS audio track values
    const hlsAudioTracks = useAtomValue(vc_hlsAudioTracks)
    const hlsCurrentAudioTrack = useAtomValue(vc_hlsCurrentAudioTrack)
    const hlsSetAudioTrack = useAtomValue(vc_hlsSetAudioTrack)

    // events
    const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
        onLoadedMetadata?.(e)
        if (!videoRef.current) return
        const v = videoRef.current

        log.info("Loaded metadata", v.duration)
        log.info("Audio tracks", v.audioTracks)
        log.info("Text tracks", v.textTracks)

        setSkipChapter(null)

        // onCaptionsChange() not needed?
        onAudioChange()

        videoCompletedRef.current = false

        if (!state.playbackInfo) return // shouldn't happen
        // tracks picked for this anime before win over the global defaults
        const animeSettings = withAnimeTracks(settings, state.playbackInfo.media?.id)


        currentPlaybackRef.current = state.playbackInfo.id

        // Back to where the audio track was switched
        const pendingAudioSwitch = pendingAudioSwitchRef.current
        if (pendingAudioSwitch) {
            pendingAudioSwitchRef.current = null
            if (pendingAudioSwitch.time > 0) v.currentTime = pendingAudioSwitch.time
            // pause() also stops the element's autoplay, which would start a paused video again
            if (pendingAudioSwitch.paused) v.pause()
            else v.play().catch(() => {})
        }

        /*
         * Event or file tracks using libass renderer
         */

        /*
         * File subtitle tracks that don't use libass renderer
         */
        const nonLibassSubtitleTracks = state.playbackInfo?.subtitleTracks?.filter(t => !t.useLibassRenderer)
        if (nonLibassSubtitleTracks && nonLibassSubtitleTracks.length > 0) {
            setSubtitleManager(p => {
                if (p) p.destroy()
                return null
            })
            setMediaCaptionsManager(p => {
                if (p) p.destroy()
                return new MediaCaptionsManager({
                    videoElement: v!,
                    tracks: nonLibassSubtitleTracks,
                    translateTargetLang: serverStatus?.settings?.mediaPlayer?.vcTranslate
                        ? serverStatus?.settings?.mediaPlayer?.vcTranslateTargetLanguage
                        : null,
                    settings: animeSettings,
                    fetchAndConvertToVTT: (url?: string, content?: string) => {
                        return new Promise((resolve, reject) => {
                            convertSubs({ url: url ?? "", content: content ?? "", to: "vtt" }, {
                                onSuccess: (data) => resolve(data),
                                onError: (error) => reject(error),
                            })
                        })
                    },
                    sendTranslateRequest: (text?: string, track?: VideoCore_VideoSubtitleTrack) => {
                        if (text) {
                            dispatchTranslateTextEvent(text)
                        }
                        if (track) {
                            dispatchTranslateSubtitleTrackEvent(track)
                        }
                    },
                })
            })
        } else {
            setMediaCaptionsManager(p => {
                if (p) p.destroy()
                return null
            })
            setSubtitleManager(p => {
                if (p) p.destroy()
                return new VideoCoreSubtitleManager({
                    videoElement: v!,
                    playbackInfo: state.playbackInfo!,
                    jassubOffscreenRender: true,
                    hmacToken: directstreamAttToken,
                    translateTargetLang: serverStatus?.settings?.mediaPlayer?.vcTranslate
                        ? serverStatus?.settings?.mediaPlayer?.vcTranslateTargetLanguage
                        : null,
                    settings: animeSettings,
                    fetchAndConvertToASS: (url?: string, content?: string) => {
                        return new Promise((resolve, reject) => {
                            convertSubs({ url: url ?? "", content: content ?? "", to: "ass" }, {
                                onSuccess: (data) => resolve(data),
                                onError: (error) => reject(error),
                            })
                        })
                    },
                    sendTranslateRequest: (text?: string, track?: VideoCore_VideoSubtitleTrack) => {
                        if (text) {
                            dispatchTranslateTextEvent(text)
                        }
                        if (track) {
                            dispatchTranslateSubtitleTrackEvent(track)
                        }
                    },
                })
            })
        }

        // Initialize audio manager for HLS streams
        if (hlsAudioTracks.length > 0 && hlsSetAudioTrack) {
            setAudioManager(new VideoCoreAudioManager({
                videoElement: v!,
                playbackInfo: state.playbackInfo,
                settings: animeSettings,
                onError: (error) => {
                    log.error("Audio manager error", error)
                    onError?.(error)
                },
                hlsSetAudioTrack: hlsSetAudioTrack,
                hlsAudioTracks: hlsAudioTracks,
                hlsCurrentAudioTrack: hlsCurrentAudioTrack,
            }))
        } else if (!!state.playbackInfo?.mkvMetadata) {
            const playbackId = state.playbackInfo.id
            setAudioManager(new VideoCoreAudioManager({
                videoElement: v!,
                playbackInfo: state.playbackInfo,
                settings: animeSettings,
                onError: (error) => {
                    log.error("Audio manager error", error)
                    onError?.(error)
                },
                streamAudioTrack: streamAudioTrackNumber,
                onStreamAudioTrackChange: (track) => {
                    const video = videoRef.current
                    // A second switch while the stream reloads keeps the position of the first
                    pendingAudioSwitchRef.current ??= video ? { time: video.currentTime, paused: video.paused } : null
                    setStreamAudioTrack({ playbackId, track })
                },
            }))
        }

        // Initialize Anime4K manager
        setAnime4kManager(p => {
            if (p) p.destroy()
            return new VideoCoreAnime4KManager({
                videoElement: v!,
                settings: animeSettings,
                onFallback: (message) => {
                    showOverlayFeedback({ message, duration: 2000 })
                },
                onOptionChanged: (opt) => {
                    setAnime4kOption(opt)
                },
            })
        })

        // Initialize PIP manager
        setPipManager(p => {
            if (p) p.destroy()
            const manager = new VideoCorePipManager((element) => {
                setPipElement(element)
            })
            manager.setVideo(v!, state.playbackInfo!)
            return manager
        })

        // Initialize fullscreen manager
        setFullscreenManager(p => {
            if (p) p.destroy()
            return new VideoCoreFullscreenManager((isFullscreen: boolean) => {
                setIsFullscreen(isFullscreen)
                onFullscreenChange?.(isFullscreen)
            })
        })

        // Initialize media session manager
        setMediaSessionManager(p => {
            if (p) p.destroy()
            const manager = new VideoCoreMediaSessionManager()

            manager.on("media-play-request", () => {
                if (videoRef.current?.paused) {
                    videoRef.current.play().catch(err => {
                        log.error("Failed to play video from media session", err)
                    })
                }
            })

            manager.on("media-pause-request", () => {
                if (videoRef.current && !videoRef.current.paused) {
                    videoRef.current.pause()
                }
            })

            manager.on("media-next-request", () => playEpisodeRef.current("next"))
            manager.on("media-previous-request", () => playEpisodeRef.current("previous"))

            manager.on("media-seek-request", (event: Event) => {
                const { seekTime } = (event as CustomEvent).detail
                action({ type: "seekTo", payload: { time: seekTime } })
            })
            manager.setPlaybackInfo(state.playbackInfo!)
            manager.setVideo(v!)
            return manager
        })
    }

    function setupPreviewManager() {
        if (previewManager !== null) {
            previewManager.cleanup()
            setPreviewManager(null)
        }
        React.startTransition(() => {
            if (videoRef.current && streamUrl) {
                log.info("Initializing preview manager")
                setPreviewManager(p => {
                    if (p) p.cleanup()
                    return new VideoCorePreviewManager(videoRef.current!, streamUrl!, streamType, state.playbackInfo?.playbackType !== "onlinestream")
                })
            }
        })
    }

    // Setup preview manager when stream type changes
    React.useEffect(() => {
        if (currentPlaybackRef.current) {
            setupPreviewManager()
        }
    }, [streamType, currentPlaybackRef.current])

    const handleTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
        onTimeUpdate?.(e)
        if (!videoRef.current) return
        const v = videoRef.current

        // Video completed event
        const percent = v.currentTime / v.duration
        if (!!v.duration && !videoCompletedRef.current && percent >= 0.8) {
            videoCompletedRef.current = true
            onCompleted?.()
            dispatchVideoCompletedEvent()
        }
    }

    const { playEpisode, isGlobalPlaylistActive, hasNextEpisode, hasPreviousEpisode } = useVideoCorePlaylist()
    // the media notification's buttons outlive renders; they always reach the current playlist
    const playEpisodeRef = React.useRef(playEpisode)
    playEpisodeRef.current = playEpisode
    React.useEffect(() => {
        mediaSessionManager?.setQueue(hasNextEpisode, hasPreviousEpisode)
    }, [mediaSessionManager, hasNextEpisode, hasPreviousEpisode])
    const [nextCountdown, setNextCountdown] = useAtom(vc_nextCountdown)
    const handleEnded = (e: React.SyntheticEvent<HTMLVideoElement>) => {
        log.info("Video ended")
        subtitleManager?.pgsRenderer?.stop()
        onEnded?.()
        if (sleepTimer === "episode") {
            setSleepTimer(null)
            toast.info(tr("Sleep timer: stopped after this episode", "Sleep-Timer: nach dieser Folge gestoppt"))
            return
        }
        if (autoNext && !isWatchPartyParticipant) {
            if (props.id === "native-player" && isGlobalPlaylistActive) {
                log.info("Skipping frontend auto next for native global playlist")
                return
            }
            if (hasNextEpisode) setNextCountdown(AUTO_NEXT_SECONDS)
            else playEpisode("next")
        }
    }
    React.useEffect(() => {
        if (nextCountdown === null) return
        if (nextCountdown <= 0) {
            setNextCountdown(null)
            playEpisode("next")
            return
        }
        const timer = setTimeout(() => setNextCountdown(seconds => seconds === null ? null : seconds - 1), 1000)
        return () => clearTimeout(timer)
    }, [nextCountdown])
    // Sleep timer: pause once the time is up
    React.useEffect(() => {
        if (typeof sleepTimer !== "number") return
        const timer = setTimeout(() => {
            videoRef.current?.pause()
            setSleepTimer(null)
            toast.info(tr("Sleep timer: paused", "Sleep-Timer: pausiert"))
        }, Math.max(sleepTimer - Date.now(), 0))
        return () => clearTimeout(timer)
    }, [sleepTimer])
    // Another episode, playing on (seeking back) or closing the player ends the countdown
    React.useEffect(() => setNextCountdown(null), [state.playbackInfo?.id])
    React.useEffect(() => () => setNextCountdown(null), [])

    const [debouncedMenuOpen, setDebouncedMenuOpen] = React.useState(false)
    const menuOpen = useAtomValue(vc_menuOpen)
    React.useEffect(() => {
        if (!!menuOpen) {
            setDebouncedMenuOpen(true)
            return
        }
        let t = setTimeout(() => {
            setDebouncedMenuOpen(false)
        }, 800)
        return () => {
            clearTimeout(t)
        }
    }, [menuOpen])

    React.useEffect(() => {
        if (inline && isMiniPlayer) {
            setIsMiniPlayer(false)
        }
    }, [isMiniPlayer, inline])

    let lastClickTime = React.useRef(0)

    const handleClick = (e: React.SyntheticEvent<HTMLDivElement>) => {
        // log.info("Video clicked")
        // check if right click

        if (e.type === "click") {
            const now = Date.now()
            if (!debouncedMenuOpen) {
                togglePlay()
            }
            if (lastClickTime.current && now - lastClickTime.current < 300) {
                fullscreenManager?.toggleFullscreen()
            } else {
                setTimeout(() => {
                    setBusy(false)
                }, 100)
            }
            lastClickTime.current = now
        }

        if (e.type === "contextmenu") {
            e.preventDefault()
        }
        return

    }

    const handleDoubleClick = (e: React.SyntheticEvent<HTMLVideoElement>) => {
        // fullscreenManager?.toggleFullscreen()
    }

    const handlePlay = (e: React.SyntheticEvent<HTMLVideoElement>) => {
        // log.info("Video resumed")
        setNextCountdown(null)
        onPlay?.()
    }

    const handlePause = (e: React.SyntheticEvent<HTMLVideoElement>) => {
        // log.info("Video paused")
        subtitleManager?.pgsRenderer?.stop()
        onPause?.()
    }

    const handleLoadedData = (e: React.SyntheticEvent<HTMLVideoElement>) => {
        log.info("Loaded data")
        onLoadedData?.(e)
    }

    const handleVolumeChange = (e: React.SyntheticEvent<HTMLVideoElement>) => {
        const v = e.currentTarget
        // log.info("Volume changed", v.volume)
        onVolumeChange?.()
    }

    const handleRateChange = (e: React.SyntheticEvent<HTMLVideoElement>) => {
        const v = e.currentTarget
        log.info("Playback rate changed", v.playbackRate)
        onPlaybackRateChange?.()

        if (v.playbackRate !== playbackRate) {
            setPlaybackRate(v.playbackRate)
        }
    }

    const handleError = (e: React.SyntheticEvent<HTMLVideoElement>) => {
        log.error("Video error", e)
        if (isFirstError.current && props.id !== "native-player") {
            // Change stream type to HLS if it failed to load
            log.warning("Video player could not load the URL, switching to HLS")
            setStreamType("hls")
            isFirstError.current = false
            return
        }

        const error = `Video playback error occurred. (Code: ${(e.currentTarget.error && e.currentTarget.error.code) || "unknown"})`
        if (e.currentTarget.error?.code !== MediaError.MEDIA_ERR_ABORTED) setVideoError(error)
        onError?.(error)
        dispatchVideoErrorEvent(error)
    }

    // A stream that broke off (Wi-Fi gone, decoder hiccup) loads again where it stopped
    function retryVideo() {
        const video = videoRef.current
        if (!video) return
        const time = video.currentTime
        setVideoError(null)
        video.addEventListener("loadedmetadata", () => {
            video.currentTime = time
            video.play().catch(() => {})
        }, { once: true })
        video.load()
    }

    const handleWaiting = (e: React.SyntheticEvent<HTMLVideoElement>) => {
        setBuffering(true)
    }

    function restoreSeekTime(time: number, showMessage: boolean, paused?: boolean) {
        if (!videoRef.current) return
        if (anime4kOption === "off" || anime4kManager?.canvas !== null) {
            if (showMessage) showOverlayFeedback({ message: tr("Progress restored", "Fortschritt wiederhergestellt"), duration: 1500 })
            videoRef.current.currentTime = time
            if (paused && !videoRef.current.paused) {
                videoRef.current.pause()
            } else if (paused === false && videoRef.current.paused) {
                videoRef.current.play().catch()
            }
        } else if (anime4kOption !== ("off" as Anime4KOption)) {
            videoRef.current.pause()
            if (showMessage) showOverlayFeedback({ message: tr("Restoring progress", "Fortschritt wird wiederhergestellt"), duration: 1500 })
            anime4kManager.registerOnCanvasCreatedOnce(() => {
                if (!videoRef.current) return
                videoRef.current.currentTime = time
                if (paused && !videoRef.current.paused) {
                    videoRef.current.pause()
                } else if (paused === false && videoRef.current.paused) {
                    videoRef.current.play().catch()
                }
            })
        }
    }

    const handleCanPlay = (e: React.SyntheticEvent<HTMLVideoElement>) => {
        setBuffering(false)

        if (!hasSoughtRef.current) {
            if (!state.playbackInfo || !videoRef.current) return
            hasSoughtRef.current = true

            // Do nothing if the stream is not seekable
            if (isWatchPartyParticipant) return

            dispatchCanPlayEvent()

            // Restore previous position if available
            if (!state.playbackInfo.disableRestoreFromContinuity && !state.playbackInfo.initialState) {
                if (state.playbackInfo?.episode?.progressNumber && watchHistory?.found && watchHistory.item?.episodeNumber === state.playbackInfo?.episode?.progressNumber) {
                    const lastWatchedTime = getEpisodeContinuitySeekTo(state.playbackInfo?.episode?.progressNumber,
                        videoRef.current?.currentTime,
                        videoRef.current?.duration)
                    log.info("Watch continuity: Fetched last watched time", { lastWatchedTime })
                    if (lastWatchedTime > 0) {
                        log.info("Watch continuity: Seeking to", lastWatchedTime)
                        restoreSeekTime(lastWatchedTime, true)
                    }
                }
            }

            if (state.playbackInfo.initialState) {
                log.info("Setting initial stream state", state.playbackInfo.initialState)
                if (state.playbackInfo.initialState.currentTime) {
                    // action({ type: "seekTo", payload: { time: state.playbackInfo.initialState.currentTime } })
                    restoreSeekTime(state.playbackInfo.initialState.currentTime, false, state.playbackInfo.initialState.paused)
                }
            } else if (autoPlay && !suppressAutoPlay) {
                videoRef.current.play().catch()
            }
        }
    }

    const handleStalled = (e: React.SyntheticEvent<HTMLVideoElement>) => {
        setBuffering(true)
    }

    // external state

    // Handle volume changes
    React.useEffect(() => {
        if (videoRef.current && volume !== undefined && volume !== videoRef.current.volume) {
            videoRef.current.volume = volume
        }
    }, [volume, videoRef.current])

    // Amplify past 100%
    useVideoCoreVolumeBoost(videoElement, volumeBoost)

    // Handle mute changes
    React.useEffect(() => {
        if (videoRef.current && muted !== undefined && muted !== videoRef.current.muted) {
            videoRef.current.muted = muted
        }
    }, [muted, videoRef.current])

    // Handle playback rate changes
    React.useEffect(() => {
        if (videoRef.current && playbackRate !== undefined && playbackRate !== videoRef.current.playbackRate) {
            videoRef.current.playbackRate = playbackRate
        }
    }, [playbackRate, videoRef.current])

    // Update PIP manager
    React.useEffect(() => {
        if (pipManager && videoRef.current && state.playbackInfo) {
            pipManager.setVideo(videoRef.current, state.playbackInfo)
            if (subtitleManager) pipManager.setSubtitleManager(subtitleManager)
            if (mediaCaptionsManager) pipManager.setMediaCaptionsManager(mediaCaptionsManager)
        }
    }, [pipManager, subtitleManager, mediaCaptionsManager, videoRef.current, state.playbackInfo])

    // Update fullscreen manager
    React.useEffect(() => {
        if (fullscreenManager && containerRef.current) {
            fullscreenManager.setContainer(containerRef.current)
        }
        if (fullscreenManager && videoRef.current) {
            fullscreenManager.setVideoElement(videoRef.current)
        }
    }, [fullscreenManager, containerRef.current, videoRef.current])

    React.useEffect(() => {
        if (mediaSessionManager && videoRef.current && state.playbackInfo && state.active) {
            mediaSessionManager.setVideo(videoRef.current)
            mediaSessionManager.setPlaybackInfo(state.playbackInfo)
            mediaSessionManager.activate()
        } else if (mediaSessionManager && !state.active) {
            log.info("Video inactive, deactivating media session")
            mediaSessionManager.deactivate()
        }
    }, [mediaSessionManager, videoRef.current, state.playbackInfo, state.active, playEpisode])

    // container events
    const setNotBusyTimeout = React.useRef<NodeJS.Timeout | null>(null)
    const lastPointerPosition = React.useRef({ x: 0, y: 0 })
    const isHoveringContainer = React.useRef(false)
    const busyRef = React.useRef(busy)
    const cursorBusyRef = React.useRef(cursorBusy)

    React.useEffect(() => {
        busyRef.current = busy
    }, [busy])

    React.useEffect(() => {
        cursorBusyRef.current = cursorBusy
    }, [cursorBusy])

    React.useEffect(() => {
        return () => {
            if (setNotBusyTimeout.current) {
                clearTimeout(setNotBusyTimeout.current)
            }
        }
    }, [])

    const handleContainerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        const { x, y } = e.nativeEvent
        const dx = x - lastPointerPosition.current.x
        const dy = y - lastPointerPosition.current.y
        if (Math.abs(dx) < 15 && Math.abs(dy) < 15) return
        if (setNotBusyTimeout?.current) {
            clearTimeout(setNotBusyTimeout.current)
        }
        if (!busyRef.current) {
            busyRef.current = true
            setBusy(true)
        }
        setNotBusyTimeout.current = setTimeout(() => {
            if (!cursorBusyRef.current) {
                busyRef.current = false
                setBusy(false)
            }
        }, DELAY_BEFORE_NOT_BUSY)
        lastPointerPosition.current = { x, y }
    }

    const handleContainerMouseEnter = () => {
        // don't
        // isHoveringContainer.current = true
        // if (videoRef.current && state.active) {
        //     videoRef.current.focus()
        // }
    }

    const handleContainerMouseLeave = () => {
        isHoveringContainer.current = false
    }

    // Focus video element when window regains focus, but only if hovering
    React.useEffect(() => {
        const handleWindowFocus = () => {
            if (videoRef.current && state.active && isHoveringContainer.current) {
                videoRef.current.focus()
                setBusy(false)
            }
        }

        window.addEventListener("focus", handleWindowFocus)
        return () => {
            window.removeEventListener("focus", handleWindowFocus)
        }
    }, [state.active])

    // Exit fullscreen and clean up fullscreen manager when the entire component is unmounted
    React.useEffect(() => {
        return () => {
            setFullscreenManager(p => {
                if (p) {
                    p.exitFullscreen()
                    p.destroy()
                }
                return null
            })
        }
    }, [])

    const chapterCues = useMemo(() => {
            if (!duration || duration <= 1) return []
            // If we have MKV chapters, use them
            if (state.playbackInfo?.mkvMetadata?.chapters?.length) {
                const cues = vc_createChapterCues(state.playbackInfo.mkvMetadata.chapters, duration)
                log.info("Chapter cues from MKV", cues)
                return cues
            }

            // Otherwise, create chapters from skip data if available
            if (!!resolvedSkipData?.op?.interval && duration > 0) {
                log.info("Creating chapter cues from skip data", resolvedSkipData)
                const chapters = vc_createChaptersFromAniSkip(resolvedSkipData, duration, state?.playbackInfo?.media?.format)
                const cues = vc_createChapterCues(chapters, duration)
                log.info("Chapter cues from skip data", cues)
                return cues
            }

            return []
        },
        [
            state.playbackInfo?.mkvMetadata?.chapters,
            resolvedSkipData?.op?.interval,
            resolvedSkipData?.ed?.interval,
            duration,
            state?.playbackInfo?.media?.format,
        ])

    // Inline mode
    if (inline) {
        return (
            <ScopeProvider atoms={[__torrentSearch_selectionAtom, __torrentSearch_selectionEpisodeAtom, __torrentSearch_selectedTorrentsAtom]}>
                <VideoCoreAnime4K />
                <VideoCoreScreenshotDirPrompt />
                {fullscreen && <RemoveScrollBar />}
                {/* Keeps its place in the page while the player is fullscreen (the browser lifts the player above the
                    page), so the page underneath does not move and the player has a place to shrink back into. */}
                <div
                    data-vc-element="inline-container"
                    className={cn(
                        "relative w-full h-full",
                        inlineClassName,
                    )}
                >
                    <PlayerContent
                        inline={inline}
                        state={state}
                        videoRef={videoRef}
                        chapterCues={chapterCues}
                        aniSkipData={resolvedSkipData}
                        streamUrl={streamUrl}
                        combineRef={combineRef}
                        combineContainerRef={combineContainerRef}
                        handleContainerPointerMove={handleContainerPointerMove}
                        handleContainerMouseEnter={handleContainerMouseEnter}
                        handleContainerMouseLeave={handleContainerMouseLeave}
                        handleClick={handleClick}
                        handleLoadedMetadata={handleLoadedMetadata}
                        handleTimeUpdate={handleTimeUpdate}
                        handleEnded={handleEnded}
                        handlePlay={handlePlay}
                        handlePause={handlePause}
                        handleDoubleClick={handleDoubleClick}
                        handleLoadedData={handleLoadedData}
                        handleVolumeChange={handleVolumeChange}
                        handleRateChange={handleRateChange}
                        handleError={handleError}
                        handleWaiting={handleWaiting}
                        handleCanPlay={handleCanPlay}
                        handleStalled={handleStalled}
                        videoError={videoError}
                        onRetryVideo={streamType === "hls" ? undefined : retryVideo}
                        onTerminateStream={onTerminateStream}
                        onVideoSourceChange={onVideoSourceChange}
                        onHlsQualityChange={onHlsQualityChange}
                        onSubtitlePreferenceChange={onSubtitlePreferenceChange}
                        suppressAutoPlay={suppressAutoPlay}
                    />
                </div>
            </ScopeProvider>
        )
    }

    // Drawer mode
    return (
        <>
            <ScopeProvider atoms={[__torrentSearch_selectionAtom, __torrentSearch_selectionEpisodeAtom, __torrentSearch_selectedTorrentsAtom]}>

                <VideoCoreAnime4K />
                <VideoCoreScreenshotDirPrompt />
                {state.active && !isMiniPlayer && <RemoveScrollBar />}

                <VideoCoreDrawer
                    open={state.active}
                    onOpenChange={(v) => {
                        if (!v) {
                            onTerminateStream()
                        } else {
                            React.startTransition(() => {
                                videoRef?.current?.focus?.()
                            })
                        }
                    }}
                    borderToBorder
                    miniPlayer={isMiniPlayer}
                    contentClass={cn(
                        "p-0 m-0",
                        !isMiniPlayer && "h-full",
                    )}
                    allowOutsideInteraction={true}
                    overlayClass={cn(
                        isMiniPlayer && "hidden",
                    )}
                    hideCloseButton
                    closeClass={cn(
                        "z-[99]",
                        isMiniPlayer && "left-4",
                    )}
                    data-native-player-drawer
                    onMiniPlayerClick={() => {
                        togglePlay()
                    }}
                    onEscapeKeyDown={e => {
                        e.preventDefault()
                        // Android Back arrives as Escape (the app's back script)
                        onTerminateStream()
                    }}
                >
                    <PlayerContent
                        inline={inline}
                        state={state}
                        videoRef={videoRef}
                        chapterCues={chapterCues}
                        aniSkipData={resolvedSkipData}
                        streamUrl={streamUrl}
                        combineRef={combineRef}
                        combineContainerRef={combineContainerRef}
                        handleContainerPointerMove={handleContainerPointerMove}
                        handleContainerMouseEnter={handleContainerMouseEnter}
                        handleContainerMouseLeave={handleContainerMouseLeave}
                        handleClick={handleClick}
                        handleLoadedMetadata={handleLoadedMetadata}
                        handleTimeUpdate={handleTimeUpdate}
                        handleEnded={handleEnded}
                        handlePlay={handlePlay}
                        handlePause={handlePause}
                        handleDoubleClick={handleDoubleClick}
                        handleLoadedData={handleLoadedData}
                        handleVolumeChange={handleVolumeChange}
                        handleRateChange={handleRateChange}
                        handleError={handleError}
                        handleWaiting={handleWaiting}
                        handleCanPlay={handleCanPlay}
                        handleStalled={handleStalled}
                        videoError={videoError}
                        onRetryVideo={streamType === "hls" ? undefined : retryVideo}
                        onTerminateStream={onTerminateStream}
                        onVideoSourceChange={onVideoSourceChange}
                        onHlsQualityChange={onHlsQualityChange}
                        onSubtitlePreferenceChange={onSubtitlePreferenceChange}
                        suppressAutoPlay={suppressAutoPlay}
                    />
                </VideoCoreDrawer>

            </ScopeProvider>
        </>
    )
}

function LoadingFloatingButtons(props: { onTerminateStream: () => void }) {
    const fullscreen = useAtomValue(vc_isFullscreen)
    const [isMiniPlayer, setIsMiniPlayer] = useAtom(vc_miniPlayer)
    const fullscreenManager = useAtomValue(vc_fullscreenManager)

    return (
        <div
            data-vc-element="loading-floating-buttons-container"
            data-vc-for="loading"
            className={cn(
                "absolute top-8 w-full z-[100]",
                isMiniPlayer && "top-0",
            )}
        >
            {fullscreen ? (
                <IconButton
                    data-vc-element="floating-button-exit-fullscreen"
                    data-vc-for="loading"
                    icon={<FiMinimize2 className="text-2xl" />}
                    intent="gray-basic"
                    className="rounded-full absolute top-0 flex-none right-4 z-[999]"
                    onClick={() => fullscreenManager?.exitFullscreen()}
                />
            ) : !isMiniPlayer ? (
                <IconButton
                    data-vc-element="floating-button-miniplayer"
                    data-vc-for="loading"
                    icon={<FiMinimize2 className="text-2xl" />}
                    intent="gray-basic"
                    className="rounded-full absolute top-0 flex-none right-4 z-[999]"
                    onClick={() => startVideoCoreMiniPlayerTransition(() => setIsMiniPlayer(true))}
                />
            ) : (
                <>
                    <IconButton
                        data-vc-element="floating-button-expand"
                        data-vc-for="loading"
                        type="button"
                        intent="gray"
                        size="sm"
                        className="rounded-full text-xl flex-none absolute z-[999] right-4 top-4 pointer-events-auto bg-black/30 hover:bg-black/40"
                        icon={<BiExpand />}
                        onClick={() => setIsMiniPlayer(false)}
                    />
                    <IconButton
                        data-vc-element="floating-button-terminate"
                        data-vc-for="loading"
                        type="button"
                        intent="alert-subtle"
                        size="sm"
                        className="rounded-full text-xl flex-none absolute z-[999] left-4 top-4 pointer-events-auto"
                        icon={<BiX />}
                        onClick={props.onTerminateStream}
                    />
                </>
            )}
        </div>
    )
}

/** Auto next: the next episode starts after a short countdown, which can be skipped or cancelled. Sits where the skip action does. */
function PhoneNextCountdown({ seconds, onPlay, onCancel }: { seconds: number, onPlay: () => void, onCancel: () => void }) {
    const t = useTr()
    const stop = (e: React.SyntheticEvent) => e.stopPropagation()
    return (
        <div data-vc-element="next-countdown" className="vc-phone-skip vc-phone-next" onPointerDown={stop} onPointerMove={stop}>
            <p aria-live="polite">{t(`Next episode in ${seconds} s`, `Nächste Folge in ${seconds} s`)}</p>
            <div>
                <button type="button" onClick={e => {
                    stop(e)
                    onCancel()
                }}>{t("Cancel", "Abbrechen")}</button>
                <button type="button" onClick={e => {
                    stop(e)
                    onPlay()
                }}>{t("Play now", "Jetzt abspielen")}<LuSkipForward aria-hidden /></button>
            </div>
        </div>
    )
}

/** Android phone: a solid, thumb-sized skip action at the bottom right, above the time bar. */
export function PhoneSkipButton({ label, onSkip }: { label: string, onSkip: () => void }) {
    const t = useTr()
    const text = ({
        "Opening": t("Skip opening", "Opening überspringen"),
        "Ending": t("Skip ending", "Ending überspringen"),
        "Recap": t("Skip recap", "Rückblick überspringen"),
    } as Record<string, string>)[label] ?? `${t("Skip", "Überspringen:")} ${label}`
    return (
        <div data-vc-element="skip-oped-button-container" data-vc-for="chapter" className="vc-phone-skip native-player-hide-on-fullscreen">
            <button
                type="button"
                onClick={e => {
                    e.stopPropagation()
                    onSkip()
                }}
                onPointerDown={e => e.stopPropagation()}
                onPointerMove={e => e.stopPropagation()}
            >
                {text}<LuSkipForward aria-hidden />
            </button>
        </div>
    )
}
