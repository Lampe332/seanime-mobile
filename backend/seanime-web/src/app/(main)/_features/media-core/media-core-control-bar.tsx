import "@/app/(main)/_features/media-core/media-core-controls.css"
import "@/components/shared/mobile-surface.css"
import { SeaImage as Image } from "@/components/shared/sea-image"
import { cn } from "@/components/ui/core/styling"
import { tr } from "@/lib/app-language"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import React from "react"
import { LuMaximize, LuMinimize, LuSkipBack, LuSkipForward, LuVolume, LuVolume1, LuVolume2, LuVolumeOff } from "react-icons/lu"
import { TbPictureInPicture, TbPictureInPictureOff } from "react-icons/tb"

export function formatTime(seconds: number) {
    const sign = seconds < 0 ? "-" : ""
    const absSeconds = Math.abs(seconds)
    const hours = Math.floor(absSeconds / 3600)
    const minutes = Math.floor((absSeconds % 3600) / 60)
    const secs = Math.floor(absSeconds % 60)

    if (hours > 0) {
        return `${sign}${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
    }
    return `${sign}${minutes}:${secs.toString().padStart(2, "0")}`
}

const CHAPTER_GAP = 3

export interface MediaCoreMobileControlBarViewProps {
    paused: boolean
    cursorBusy: boolean
    isSwiping: boolean
    timeRange: React.ReactNode
    topLeftSection?: React.ReactNode
    topRightSection?: React.ReactNode
    bottomLeftSection?: React.ReactNode
    bottomRightSection?: React.ReactNode
}

/** Top and bottom bars of the Android player; sizes and spacing come from media-core-controls.css. */
export function MediaCoreMobileControlBarView(props: MediaCoreMobileControlBarViewProps) {
    const {
        paused,
        cursorBusy,
        isSwiping,
        timeRange,
        topLeftSection,
        topRightSection,
        bottomLeftSection,
        bottomRightSection,
    } = props

    const [isSwipingDebounced, setIsSwipingDebounced] = React.useState(false)
    const sieT = React.useRef<ReturnType<typeof setTimeout> | null>(null)
    React.useEffect(() => {
        if (isSwiping) {
            setIsSwipingDebounced(true)
        } else {
            sieT.current = setTimeout(() => {
                setIsSwipingDebounced(false)
            }, 200)
        }
        return () => {
            if (sieT.current) clearTimeout(sieT.current)
        }
    }, [isSwiping])

    const bottomSectionTranslateY = (paused || cursorBusy) ? 0 : 300

    return (
        <>
            {/*Top Section*/}
            <div
                data-vc-element="mobile-control-bar-top-section"
                className="vc-mobile-control-bar-top-section vc-bar vc-bar--top"
                style={{
                    transform: `translateY(${-bottomSectionTranslateY}px)`,
                }}
            >
                <div data-vc-element="mobile-control-bar-top-content" className="vc-bar-row">
                    {topLeftSection}
                    <div className="flex flex-1" />
                    {topRightSection}
                </div>
            </div>

            {/*Bottom Section*/}
            <div
                data-vc-element="mobile-control-bar-bottom-section"
                className={cn(
                    "vc-mobile-control-bar-bottom-section vc-bar vc-bar--bottom",
                    isSwiping && "vc-bar--swiping",
                )}
                style={{
                    transform: isSwiping ? "translateY(0px)" : `translateY(${bottomSectionTranslateY}px)`,
                }}
            >
                <div
                    data-vc-element="mobile-control-bar-bottom-content"
                    className={cn(
                        "vc-bar-row",
                        (isSwiping || isSwipingDebounced) && "hidden",
                    )}
                >
                    {bottomLeftSection}
                    <div className="flex flex-1" />
                    {bottomRightSection}
                </div>
                {timeRange}
            </div>
        </>
    )
}

export interface MediaCoreControlButtonIconProps {
    icons: [string, React.ElementType][]
    state: string
    className?: string
    iconClass?: string
    onClick: () => void
    onWheel?: (e: React.WheelEvent<HTMLButtonElement>) => void
    children?: React.ReactNode
}

export function MediaCoreControlButtonIcon(props: MediaCoreControlButtonIconProps) {
    const { icons, state, className, iconClass, onClick, onWheel, children } = props

    return (
        <button
            role="button"
            data-vc-element="control-button"
            data-vc-state={state}
            className={cn("vc-control-button focus:outline-none", className)}
            onClick={onClick}
            onWheel={onWheel}
        >
            <AnimatePresence>
                {icons.map(n => {
                    const [iconState, Icon] = n
                    if (state !== iconState) return null
                    return (
                        <motion.span
                            key={iconState}
                            data-vc-element="control-button-icon"
                            data-vc-state={iconState}
                            className="block"
                            initial={{ opacity: 0, y: 10, position: "relative" }}
                            animate={{ opacity: 1, y: 0, position: "relative" }}
                            exit={{ opacity: 0, y: 10, position: "absolute" }}
                            transition={{ duration: 0.15 }}
                        >
                            <Icon className={cn("vc-control-button-icon", iconClass)} />
                        </motion.span>
                    )
                })}
            </AnimatePresence>
            {children}
        </button>
    )
}

export interface MediaCoreVolumeButtonProps {
    volume: number
    muted: boolean
    onVolumeChange: (vol: number) => void
    onMuteToggle: () => void
    isMiniPlayer: boolean
    /** Tapping the icon opens a volume slider next to it. */
    panelOpen: boolean
    onPanelOpenChange: (open: boolean) => void
}

const VOLUME_PANEL_IDLE_MS = 3500
const EASE_OUT = [0.23, 1, 0.32, 1] as const
// Closed, only the round end under the speaker (about one button of the 13rem pill) is left; open, the whole pill.
const VOLUME_PANEL_CLOSED = "inset(0% 0% 0% 79% round 999px)"
const VOLUME_PANEL_OPEN = "inset(0% 0% 0% 0% round 999px)"

export function MediaCoreVolumeButton(props: MediaCoreVolumeButtonProps) {
    const { volume, muted, onVolumeChange, onMuteToggle, panelOpen, onPanelOpenChange } = props
    const reduceMotion = useReducedMotion()
    const [isSliding, setIsSliding] = React.useState(false)
    const rootRef = React.useRef<HTMLDivElement>(null)
    const idleTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

    // Close the panel after a few idle seconds or on a tap outside it.
    const keepPanelOpen = React.useCallback(() => {
        if (idleTimer.current) clearTimeout(idleTimer.current)
        idleTimer.current = setTimeout(() => onPanelOpenChange(false), VOLUME_PANEL_IDLE_MS)
    }, [onPanelOpenChange])
    React.useEffect(() => {
        if (!panelOpen) return
        keepPanelOpen()
        const onOutside = (e: PointerEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) onPanelOpenChange(false)
        }
        document.addEventListener("pointerdown", onOutside, true)
        return () => {
            document.removeEventListener("pointerdown", onOutside, true)
            if (idleTimer.current) clearTimeout(idleTimer.current)
        }
    }, [panelOpen, keepPanelOpen, onPanelOpenChange])

    function linearToVolume(linear: number): number {
        return Math.pow(linear, 2)
    }

    function volumeToLinear(vol: number): number {
        return Math.pow(vol, 1 / 2)
    }

    function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        setIsSliding(true)
    }

    function handleSetVolume(e: React.PointerEvent<HTMLDivElement>) {
        const rect = e.currentTarget.getBoundingClientRect()
        const x = e.clientX - rect.left
        const width = e.currentTarget.clientWidth
        const linearPosition = Math.max(0, Math.min(1, x / width))
        // Touch is imprecise: snap the first few percent of the slider to silence.
        onVolumeChange(linearPosition < 0.04 ? 0 : linearToVolume(linearPosition))
        keepPanelOpen()
    }

    function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
        if (isSliding) {
            e.stopPropagation()
            e.currentTarget.releasePointerCapture(e.pointerId)
            setIsSliding(false)
            handleSetVolume(e)
        }
    }

    function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
        if (isSliding) {
            e.stopPropagation()
            handleSetVolume(e)
        }
    }

    function handleWheel(e: React.WheelEvent<HTMLButtonElement>) {
        e.stopPropagation()
        const delta = -e.deltaY / 1000
        onVolumeChange(Math.max(0, Math.min(1, volume + delta)))
    }

    return (
        // Fixed anchor width: the icon swap animation briefly renders two icons and would shift the slider mid-drag.
        <div ref={rootRef} data-vc-element="control-volume" className="vc-control-volume group/vc-control-volume">
            <MediaCoreControlButtonIcon
                icons={[
                    ["low", LuVolume],
                    ["mid", LuVolume1],
                    ["high", LuVolume2],
                    ["muted", LuVolumeOff],
                ]}
                state={
                    muted ? "muted" :
                        volume >= 0.5 ? "high" :
                            volume > 0.1 ? "mid" :
                                "low"
                }
                onClick={() => onPanelOpenChange(!panelOpen)}
                onWheel={handleWheel}
            />
            <AnimatePresence>{panelOpen && (
                <motion.div
                    key="panel"
                    data-vc-element="control-volume-mobile-panel"
                    data-vc-gesture-ignore
                    className="vc-control-volume-mobile-panel vc-volume-panel"
                    // Grows out of the speaker: the pill opens leftwards from the icon's end, slides down from it and fades in.
                    initial={reduceMotion ? { opacity: 0 } : { opacity: 0, clipPath: VOLUME_PANEL_CLOSED, transform: "translateY(-6px)" }}
                    animate={reduceMotion ? { opacity: 1 } : { opacity: 1, clipPath: VOLUME_PANEL_OPEN, transform: "translateY(0px)" }}
                    exit={reduceMotion
                        ? { opacity: 0, pointerEvents: "none", transition: { duration: 0.12 } }
                        : { opacity: 0, clipPath: VOLUME_PANEL_CLOSED, transform: "translateY(-4px)", pointerEvents: "none", transition: { duration: 0.15, ease: EASE_OUT } }}
                    transition={{ duration: 0.22, ease: EASE_OUT }}
                    onClick={e => e.stopPropagation()}
                    onPointerDown={e => e.stopPropagation()}
                >
                    <button
                        type="button"
                        aria-label={muted ? tr("Unmute", "Ton an") : tr("Mute", "Stumm")}
                        className="flex-none flex items-center justify-center w-11 h-11 text-xl text-white/90"
                        onClick={() => {
                            onMuteToggle()
                            keepPanelOpen()
                        }}
                    >
                        {muted || volume === 0 ? <LuVolumeOff /> : volume >= 0.5 ? <LuVolume2 /> : volume > 0.1 ? <LuVolume1 /> : <LuVolume />}
                    </button>
                    <div
                        role="slider"
                        aria-label={tr("Volume", "Lautstärke")}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round((muted ? 0 : volumeToLinear(volume)) * 100)}
                        data-vc-element="control-volume-mobile-slider"
                        className="relative flex flex-1 h-full items-center cursor-pointer touch-none"
                        onPointerDown={e => {
                            handlePointerDown(e)
                            handleSetVolume(e)
                        }}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        onPointerCancel={handlePointerUp}
                    >
                        <div className="vc-volume-panel-track" />
                        <div className="vc-volume-panel-fill" style={{ width: `${(muted ? 0 : volumeToLinear(volume)) * 100}%` }} />
                        <div className="vc-volume-panel-thumb" style={{ left: `${(muted ? 0 : volumeToLinear(volume)) * 100}%` }} />
                    </div>
                </motion.div>
            )}</AnimatePresence>
        </div>
    )
}

export function MediaCoreNextButton(props: { onClick: () => void; isMiniPlayer: boolean }) {
    if (props.isMiniPlayer) return null
    return <MediaCoreControlButtonIcon icons={[["default", LuSkipForward]]} state="default" iconClass="fill-current" onClick={props.onClick} />
}

export function MediaCorePreviousButton(props: { onClick: () => void; isMiniPlayer: boolean }) {
    if (props.isMiniPlayer) return null
    return <MediaCoreControlButtonIcon icons={[["default", LuSkipBack]]} state="default" iconClass="fill-current" onClick={props.onClick} />
}

// Material "replay" / "forward" arrows; the seconds sit inside the ring
const CENTER_SEEK_BACK_PATH = "M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"
const CENTER_SEEK_FORWARD_PATH = "M18 13c0 3.31-2.69 6-6 6s-6-2.69-6-6 2.69-6 6-6v4l5-5-5-5v4c-4.42 0-8 3.58-8 8s3.58 8 8 8 8-3.58 8-8h-2z"

export interface MediaCoreCenterControlsViewProps {
    paused: boolean
    seekBackSeconds: number
    seekForwardSeconds: number
    onTogglePlay: () => void
    onSeek: (seconds: number) => void
}

/**
 * Centre of the Android player: back, play/pause, forward. VideoControlInjector.kt shows and hides it together with the
 * bars by toggling `__seanime-visible` on this id; `data-seanime-mobile-control` tells its tap handling these are buttons.
 */
export function MediaCoreCenterControlsView(props: MediaCoreCenterControlsViewProps) {
    const { paused, seekBackSeconds, seekForwardSeconds, onTogglePlay, onSeek } = props

    return (
        <div id="__seanime-mobile-controls" data-vc-element="center-controls" className="vc-center">
            <MediaCoreCenterSeekButton seconds={-seekBackSeconds} onSeek={onSeek} />
            <button
                type="button"
                data-seanime-mobile-control
                data-vc-element="center-play"
                aria-label={paused ? tr("Play", "Abspielen") : tr("Pause", "Pause")}
                className="vc-center-button vc-center-button--play"
                onClick={e => {
                    e.stopPropagation()
                    onTogglePlay()
                }}
            >
                {/* A new key per state: the new symbol settles in instead of snapping over the old one. */}
                <svg key={paused ? "play" : "pause"} className="vc-center-play-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    {paused
                        ? <path d="M8.5 5.65v12.7a1 1 0 0 0 1.53.85l10.16-6.35a1 1 0 0 0 0-1.7L10.03 4.8a1 1 0 0 0-1.53.85z" />
                        : <><rect x="6" y="5" width="4.25" height="14" rx="1.25" /><rect x="13.75" y="5" width="4.25" height="14" rx="1.25" /></>}
                </svg>
            </button>
            <MediaCoreCenterSeekButton seconds={seekForwardSeconds} onSeek={onSeek} />
        </div>
    )
}

function MediaCoreCenterSeekButton({ seconds, onSeek }: { seconds: number, onSeek: (seconds: number) => void }) {
    // every tap gets a new key, which restarts the short turn of the arrow
    const [taps, setTaps] = React.useState(0)
    const back = seconds < 0

    return (
        <button
            type="button"
            data-seanime-mobile-control
            data-vc-element={back ? "center-seek-back" : "center-seek-forward"}
            aria-label={back ? tr(`Back ${-seconds} seconds`, `${-seconds} Sekunden zurück`) : tr(`Forward ${seconds} seconds`, `${seconds} Sekunden vor`)}
            className="vc-center-button"
            onClick={e => {
                e.stopPropagation()
                onSeek(seconds)
                setTaps(n => n + 1)
            }}
        >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path
                    key={taps}
                    d={back ? CENTER_SEEK_BACK_PATH : CENTER_SEEK_FORWARD_PATH}
                    className={cn(taps > 0 && (back ? "vc-center-turn-back" : "vc-center-turn-forward"))}
                />
                <text x="12" y="15.4" textAnchor="middle" className="vc-center-seek-number">{Math.abs(seconds)}</text>
            </svg>
        </button>
    )
}

export interface MediaCoreTimestampProps {
    currentTime: number
    duration: number
    timestampMode: "elapsed" | "remaining"
    onTimestampModeToggle: () => void
}

export function MediaCoreTimestamp(props: MediaCoreTimestampProps) {
    const { currentTime, duration, timestampMode, onTimestampModeToggle } = props

    if (duration <= 1 || isNaN(duration)) return null

    const timeToShow = timestampMode === "remaining"
        ? Math.max(0, duration - currentTime)
        : currentTime

    return (
        <p
            data-vc-element="timestamp"
            data-vc-timestamp-type={timestampMode}
            className="vc-timestamp cursor-pointer"
            onClick={onTimestampModeToggle}
        >
            <span>
                {timestampMode === "remaining" ? "-" : ""}
                {formatTime(Math.max(0, Math.min(duration, timeToShow)))}
            </span>
            <span className="vc-timestamp-total">/ {formatTime(duration)}</span>
        </p>
    )
}

export function MediaCorePipButton(props: {
    isPip: boolean
    onTogglePip: () => void
    isMiniPlayer: boolean
}) {
    if (props.isMiniPlayer) return null
    return (
        <MediaCoreControlButtonIcon
            icons={[
                ["default", TbPictureInPicture],
                ["pip", TbPictureInPictureOff],
            ]}
            state={props.isPip ? "pip" : "default"}
            onClick={props.onTogglePip}
        />
    )
}

export function MediaCoreFullscreenButton(props: {
    isFullscreen: boolean
    onToggleFullscreen: () => void
}) {
    return (
        <MediaCoreControlButtonIcon
            icons={[
                ["default", LuMaximize],
                ["fullscreen", LuMinimize],
            ]}
            state={props.isFullscreen ? "fullscreen" : "default"}
            onClick={props.onToggleFullscreen}
        />
    )
}

/* -------------------------------------------------------------------------------------------------
 * TimeRange / Timeline View
 * -----------------------------------------------------------------------------------------------*/

type MediaCoreTimeRangeChapter = {
    width: number
    percentageOffset: number
    label: string | null
    start: number
    end: number
}

export interface MediaCoreTimeRangeViewProps {
    seeking: boolean
    progressPercentage: number
    bufferedPercentage: number
    seekingTargetProgress: number
    chapters: MediaCoreTimeRangeChapter[]
    highlightChapters?: boolean
    skipChapters?: MediaCoreTimeRangeChapter[]
    showPreview: boolean
    showThumbnail: boolean
    previewWidth: number
    previewX: number
    tooltipX: number
    chapterLabel: string | null
    targetTime: number
    previewThumbnailUrl: string | null
    timeRangeRef: React.Ref<HTMLDivElement>
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void
    onPointerLeave: (e: React.PointerEvent<HTMLDivElement>) => void
    onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => void
    duration: number
}

export function MediaCoreTimeRangeView(props: MediaCoreTimeRangeViewProps) {
    const {
        seeking,
        progressPercentage,
        bufferedPercentage,
        seekingTargetProgress,
        chapters,
        highlightChapters = true,
        skipChapters = [],
        showPreview,
        showThumbnail,
        previewWidth,
        previewX,
        tooltipX,
        chapterLabel,
        targetTime,
        previewThumbnailUrl,
        timeRangeRef,
        onPointerDown,
        onPointerUp,
        onPointerMove,
        onPointerLeave,
        onPointerCancel,
        duration,
    } = props

    return (
        <div
            ref={timeRangeRef}
            data-vc-element="time-range"
            data-vc-seeking-target-state={seeking}
            className="vc-time-range relative group/vc-time-range z-[2] flex cursor-pointer outline-none touch-none select-none [contain:layout_style] text-white"
            role="slider"
            tabIndex={0}
            aria-valuemin={0}
            aria-valuenow={progressPercentage}
            aria-valuetext={`${Math.round(progressPercentage)}%`}
            aria-orientation="horizontal"
            aria-label={tr("Playback time", "Wiedergabezeit")}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerLeave}
            onPointerCancel={onPointerCancel}
            onPointerMove={onPointerMove}
        >
            {showThumbnail && (
                <div
                    data-vc-element="preview-thumbnail"
                    className="absolute left-0 bottom-full aspect-video overflow-hidden rounded-md bg-black border border-white/50 pointer-events-none will-change-transform [contain:layout_paint_style]"
                    style={{
                        width: previewWidth,
                        transform: `translate3d(${previewX - previewWidth / 2}px, -64%, 0)`,
                    }}
                >
                    {!!previewThumbnailUrl && (
                        <Image
                            data-vc-element="preview-thumbnail-image"
                            src={previewThumbnailUrl}
                            alt="Preview"
                            fill
                            sizes={`${previewWidth}px`}
                            className="object-cover rounded-md"
                            decoding="async"
                            loading="lazy"
                        />
                    )}
                </div>
            )}

            {showPreview && (
                <div
                    data-vc-element="preview-tooltip"
                    className="absolute left-0 bottom-full mb-3 px-2 py-1 bg-black/70 text-white text-center text-sm rounded-md will-change-transform whitespace-nowrap z-20 pointer-events-none"
                    style={{
                        transform: `translate3d(${tooltipX}px, 0, 0) translateX(-50%)`,
                    }}
                >
                    {chapterLabel && <p data-vc-element="preview-tooltip-chapter" className="text-xs font-medium max-w-2xl truncate">{chapterLabel}</p>}
                    <p data-vc-element="preview-tooltip-time">{formatTime(targetTime)}</p>
                    <div
                        data-vc-element="preview-tooltip-arrow"
                        className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-black/70"
                    />
                </div>
            )}

            {chapters.map((chapter, i) => (
                <MediaCoreTimeRangeSegment
                    key={i}
                    idx={i}
                    progressPercentage={progressPercentage}
                    bufferedPercentage={bufferedPercentage}
                    chapter={chapter}
                    duration={duration}
                    seekingTargetProgress={seekingTargetProgress}
                    highlighted={highlightChapters && skipChapters.includes(chapter)}
                />
            ))}

            <div
                data-vc-element="time-range-thumb"
                className="vc-time-thumb"
                style={{ left: `${duration > 1 ? Math.max(0, Math.min(100, progressPercentage)) : 0}%` }}
            />
        </div>
    )
}

function MediaCoreTimeRangeSegment(props: {
    idx: number
    progressPercentage: number
    bufferedPercentage: number
    chapter: {
        width: number
        percentageOffset: number
        label: string | null
        start: number
        end: number
    }
    duration: number
    seekingTargetProgress: number
    highlighted: boolean
}) {
    const { idx, chapter, progressPercentage, bufferedPercentage, duration, seekingTargetProgress, highlighted } = props
    const focused = !!seekingTargetProgress && chapter.percentageOffset <= seekingTargetProgress && chapter.percentageOffset + chapter.width >= seekingTargetProgress

    function getChapterBarPosition(chapter: any, percentage: number) {
        const ret = (percentage - chapter.percentageOffset) * (100 / chapter.width)
        return (ret <= 0 ? -CHAPTER_GAP : ret >= 100 ? 100 : ret) - 100
    }

    return (
        <div
            data-vc-element="time-range-segment"
            data-vc-chapter-label={chapter.label}
            data-vc-focused-state={focused}
            data-vc-seeking-target-state={!!seekingTargetProgress}
            className="relative w-full h-full flex items-center"
            style={{
                width: `${chapter.width}%`,
            }}
        >
            <div
                data-vc-element="time-range-chapter"
                className={cn(
                    "vc-time-chapter relative transition-transform transform-gpu origin-center will-change-transform flex items-center justify-center overflow-hidden rounded-lg",
                    focused && "scale-y-[1.75]",
                )}
                style={{
                    width: idx > 0 ? `calc(100% - ${CHAPTER_GAP / 2}px)` : `100%`,
                    marginLeft: idx > 0 ? `${CHAPTER_GAP}px` : `0px`,
                }}
            >
                <div
                    data-vc-element="time-range-chapter-bar"
                    data-vc-for="progress"
                    className="vc-time-progress absolute w-full h-full left-0 transform-gpu z-[10]"
                    style={{
                        "--tw-translate-x": duration > 1 ? `${getChapterBarPosition(chapter, progressPercentage)}%` : "-100%",
                    } as React.CSSProperties}
                />
                <div
                    data-vc-element="time-range-chapter-bar"
                    data-vc-for="seeking-target"
                    className="bg-white/30 absolute w-full h-full left-0 transform-gpu z-[9]"
                    style={{
                        "--tw-translate-x": duration > 1 ? `${getChapterBarPosition(chapter, seekingTargetProgress)}%` : "-100%",
                    } as React.CSSProperties}
                />
                <div
                    data-vc-element="time-range-chapter-bar"
                    data-vc-for="buffer"
                    className="bg-white/25 absolute w-full h-full left-0 transform-gpu z-[8]"
                    style={{
                        "--tw-translate-x": duration > 1 ? `${getChapterBarPosition(chapter, bufferedPercentage)}%` : "-100%",
                    } as React.CSSProperties}
                />
                <div
                    data-vc-element="time-range-chapter-bar"
                    data-vc-for="main"
                    data-vc-highlighted-state={highlighted}
                    className={cn(
                        "bg-white/25 absolute left-0 w-full h-full z-[1]",
                        highlighted && "bg-amber-200/55",
                    )}
                />
            </div>
        </div>
    )
}
