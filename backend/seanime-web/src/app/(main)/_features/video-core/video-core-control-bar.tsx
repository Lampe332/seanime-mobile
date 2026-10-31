import { vc_menuOpen } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_isSwiping } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_duration } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_currentTime } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_isMuted } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_volume } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_isFullscreen } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_paused } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_miniPlayer } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_cursorBusy } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_fullscreenManager } from "@/app/(main)/_features/video-core/video-core-fullscreen"
import { vc_pip } from "@/app/(main)/_features/video-core/video-core-pip"
import { vc_pipManager } from "@/app/(main)/_features/video-core/video-core-pip"
import { vc_storedMutedAtom, vc_storedVolumeAtom } from "@/app/(main)/_features/video-core/video-core.atoms"
import { vc_dispatchAction } from "@/app/(main)/_features/video-core/video-core.utils"
import {
    MediaCoreCenterControlsView,
    MediaCoreMobileControlBarView,
    MediaCoreVolumeButton,
    MediaCoreNextButton,
    MediaCorePreviousButton,
    MediaCoreTimestamp,
    MediaCorePipButton,
    MediaCoreFullscreenButton,
} from "@/app/(main)/_features/media-core/media-core-control-bar"
import { useAtomValue, atom } from "jotai"
import { useAtom, useSetAtom } from "jotai/react"
import { mediaCorePreferencesAtom } from "@/app/(main)/_features/media-core/media-core-preferences"
import React from "react"

export { MediaCoreControlButtonIcon as VideoCoreControlButtonIcon } from "@/app/(main)/_features/media-core/media-core-control-bar"

export function VideoCoreMobileControlBar(props: {
    timeRange: React.ReactNode
    topLeftSection: React.ReactNode
    topRightSection: React.ReactNode
    bottomLeftSection: React.ReactNode
    bottomRightSection: React.ReactNode
}) {
    const paused = useAtomValue(vc_paused)
    const cursorBusy = useAtomValue(vc_cursorBusy)
    const isSwiping = useAtomValue(vc_isSwiping)

    return (
        <MediaCoreMobileControlBarView
            {...props}
            paused={paused}
            cursorBusy={cursorBusy}
            isSwiping={isSwiping}
        />
    )
}

export function VideoCoreCenterControls() {
    const paused = useAtomValue(vc_paused)
    const isMiniPlayer = useAtomValue(vc_miniPlayer)
    const action = useSetAtom(vc_dispatchAction)

    if (isMiniPlayer) return null

    return (
        <MediaCoreCenterControlsView
            paused={paused}
            seekBackSeconds={5}
            seekForwardSeconds={10}
            onTogglePlay={() => action({ type: "togglePlay" })}
            onSeek={seconds => action({ type: "seek", payload: { time: seconds } })}
        />
    )
}

export function VideoCoreVolumeButton() {
    const volume = useAtomValue(vc_volume)
    const muted = useAtomValue(vc_isMuted)
    const setVolume = useSetAtom(vc_storedVolumeAtom)
    const setMuted = useSetAtom(vc_storedMutedAtom)
    const isMiniPlayer = useAtomValue(vc_miniPlayer)
    // The volume panel shares the menu slot so the controls stay visible while it is open and other menus close it.
    const [menuOpen, setMenuOpen] = useAtom(vc_menuOpen)

    return (
        <MediaCoreVolumeButton
            volume={volume}
            muted={muted}
            onVolumeChange={vol => {
                setVolume(vol)
                setMuted(vol === 0)
            }}
            onMuteToggle={() => setMuted(p => {
                if (p && volume === 0) setVolume(0.1)
                return !p
            })}
            isMiniPlayer={isMiniPlayer}
            panelOpen={menuOpen === "volume"}
            onPanelOpenChange={open => setMenuOpen(open ? "volume" : null)}
        />
    )
}

export function VideoCoreNextButton({ onClick }: { onClick: () => void }) {
    const isMiniPlayer = useAtomValue(vc_miniPlayer)
    return <MediaCoreNextButton onClick={onClick} isMiniPlayer={isMiniPlayer} />
}

export function VideoCorePreviousButton({ onClick }: { onClick: () => void }) {
    const isMiniPlayer = useAtomValue(vc_miniPlayer)
    return <MediaCorePreviousButton onClick={onClick} isMiniPlayer={isMiniPlayer} />
}

const vc_timestampType = atom(
    (get) => get(mediaCorePreferencesAtom).timestampMode,
    (get, set, newValue: "elapsed" | "remaining" | ((prev: "elapsed" | "remaining") => "elapsed" | "remaining")) => {
        const current = get(mediaCorePreferencesAtom)
        const next = typeof newValue === "function" ? newValue(current.timestampMode) : newValue
        set(mediaCorePreferencesAtom, { ...current, timestampMode: next })
    }
)

export function VideoCoreTimestamp() {
    const duration = useAtomValue(vc_duration)
    const currentTime = useAtomValue(vc_currentTime)
    const [type, setType] = useAtom(vc_timestampType)

    return (
        <MediaCoreTimestamp
            currentTime={currentTime}
            duration={duration}
            timestampMode={type}
            onTimestampModeToggle={() => setType(p => p === "elapsed" ? "remaining" : "elapsed")}
        />
    )
}

export function VideoCorePipButton() {
    const pipManager = useAtomValue(vc_pipManager)
    const isPip = useAtomValue(vc_pip)
    const isMiniPlayer = useAtomValue(vc_miniPlayer)

    return <MediaCorePipButton isPip={isPip} onTogglePip={() => pipManager?.togglePip()} isMiniPlayer={isMiniPlayer} />
}

export function VideoCoreFullscreenButton() {
    const fullscreenManager = useAtomValue(vc_fullscreenManager)
    const isFullscreen = useAtomValue(vc_isFullscreen)
    const setMiniPlayer = useSetAtom(vc_miniPlayer)

    return (
        <MediaCoreFullscreenButton
            isFullscreen={isFullscreen}
            onToggleFullscreen={() => {
                setMiniPlayer(false)
                fullscreenManager?.toggleFullscreen()
            }}
        />
    )
}
