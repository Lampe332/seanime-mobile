import { VideoCoreChapterCue } from "@/app/(main)/_features/video-core/video-core"
import { vc_subtitleManager } from "@/app/(main)/_features/video-core/video-core"
import { vc_mediaCaptionsManager } from "@/app/(main)/_features/video-core/video-core"
import { vc_audioManager } from "@/app/(main)/_features/video-core/video-core"
import { vc_videoElement } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_isMuted } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_volume } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_isFullscreen } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_miniPlayer } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_fullscreenManager } from "@/app/(main)/_features/video-core/video-core-fullscreen"
import { useVideoCoreOverlayFeedback } from "@/app/(main)/_features/video-core/video-core-overlay-display"
import { vc_pip } from "@/app/(main)/_features/video-core/video-core-pip"
import { vc_pipManager } from "@/app/(main)/_features/video-core/video-core-pip"
import { useVideoCorePlaylist } from "@/app/(main)/_features/video-core/video-core-playlist"
import {
    vc_keybindingsAtom,
    vc_storedMutedAtom,
    vc_storedVolumeAtom,
    vc_storedVolumeBoostAtom,
} from "@/app/(main)/_features/video-core/video-core.atoms"
import { vc_dispatchAction } from "@/app/(main)/_features/video-core/video-core.utils"
import { logger } from "@/lib/helpers/debug"
import { useAtom, useAtomValue } from "jotai"
import { useSetAtom } from "jotai/react"
import React, { useCallback, useEffect, useRef } from "react"
import { useVideoCoreScreenshot } from "./video-core-screenshot"
import { clampVolumeBoost, formatVolumeBoost, VOLUME_BOOST_STEP } from "@/app/(main)/_features/media-core/media-core-volume-boost"

function isEditableKeyboardTarget(target: EventTarget | null) {
    if (!(target instanceof Element)) return false
    if (target instanceof HTMLElement && target.isContentEditable) return true

    return !!target.closest("input, textarea, select, [contenteditable='true'], [role='textbox']")
}

export function VideoCoreKeybindingController(props: {
    active: boolean
    videoRef: React.RefObject<HTMLVideoElement | null>,
    chapterCues: VideoCoreChapterCue[],
    introEndTime: number | undefined,
    introStartTime: number | undefined
    endingEndTime: number | undefined,
    endingStartTime: number | undefined
}) {
    const {
        active,
        chapterCues,
        introEndTime,
        introStartTime,
        endingEndTime,
        endingStartTime,
    } = props

    const [keybindings] = useAtom(vc_keybindingsAtom)
    const fullscreen = useAtomValue(vc_isFullscreen)
    const isMiniPlayer = useAtomValue(vc_miniPlayer)
    const pip = useAtomValue(vc_pip)
    const volume = useAtomValue(vc_volume)
    const setMiniPlayer = useSetAtom(vc_miniPlayer)
    const setVolume = useSetAtom(vc_storedVolumeAtom)
    const [volumeBoost, setVolumeBoost] = useAtom(vc_storedVolumeBoostAtom)
    const muted = useAtomValue(vc_isMuted)
    const setMuted = useSetAtom(vc_storedMutedAtom)
    const videoElement = useAtomValue(vc_videoElement)
    const { showOverlayFeedback } = useVideoCoreOverlayFeedback()

    const action = useSetAtom(vc_dispatchAction)

    const subtitleManager = useAtomValue(vc_subtitleManager)
    const mediaCaptionsManager = useAtomValue(vc_mediaCaptionsManager)
    const audioManager = useAtomValue(vc_audioManager)
    const fullscreenManager = useAtomValue(vc_fullscreenManager)
    const pipManager = useAtomValue(vc_pipManager)

    const { playEpisode, hasNextEpisode, hasPreviousEpisode } = useVideoCorePlaylist()

    // Rate limiting for seeking operations
    const lastSeekTime = useRef(0)
    const SEEK_THROTTLE_MS = 100 // Minimum time between seek operations

    function seek(seconds: number) {
        const isPaused = videoElement?.paused
        if (!isPaused) {
            videoElement?.pause()
        }
        action({ type: "seek", payload: { time: seconds, flashTime: true } })
        if (!isPaused) {
            videoElement?.play()?.catch()
        }
    }

    function seekTo(to: number) {
        const isPaused = videoElement?.paused
        if (!isPaused) {
            videoElement?.pause()
        }
        action({ type: "seekTo", payload: { time: to, flashTime: true } })
        if (!isPaused) {
            videoElement?.play()?.catch()
        }
    }

    const { takeScreenshot } = useVideoCoreScreenshot()

    //
    // Keyboard shortcuts
    //

    const handleKeyboardShortcuts = useCallback(async (e: KeyboardEvent) => {
            // Don't handle player shortcuts while typing.
            if (
                e.defaultPrevented ||
                isEditableKeyboardTarget(e.target) ||
                isEditableKeyboardTarget(document.activeElement)
            ) {
                return
            }

            // Shift + volume keys, adjust volume boost
            if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && videoElement && active
                && (e.code === keybindings.volumeUp.key || e.code === keybindings.volumeDown.key)) {
                e.preventDefault()
                const direction = e.code === keybindings.volumeUp.key ? 1 : -1
                const next = clampVolumeBoost(volumeBoost + direction * VOLUME_BOOST_STEP)
                setVolumeBoost(next)
                showOverlayFeedback({ message: `Volume Boost: ${formatVolumeBoost(next)}` })
                return
            }

            // Ignore combinations with modifier keys
            if (e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) {
                return
            }

            if (!videoElement || !active) {
                return
            }

            const video = videoElement

            if (isMiniPlayer) {
                if (e.code === keybindings.fullscreen.key) {
                    e.preventDefault()
                    setMiniPlayer(false)
                    window.requestAnimationFrame(() => {
                        window.requestAnimationFrame(() => {
                            handleToggleFullscreen()
                        })
                    })
                }
                return
            }

            if (e.code === "Space" || e.code === "Enter") {
                e.preventDefault()
                if (video.paused) {
                    await video.play()
                    showOverlayFeedback({ message: "PLAY", type: "icon" })
                } else {
                    video.pause()
                    showOverlayFeedback({ message: "PAUSE", type: "icon" })
                }
                return
            }

            // Home, go to beginning
            if (e.code === "Home") {
                e.preventDefault()
                seekTo(0)
                showOverlayFeedback({ message: "Beginning" })
                return
            }

            // End, go to end
            if (e.code === "End") {
                e.preventDefault()
                seekTo(video.duration)
                showOverlayFeedback({ message: "End" })
                return
            }

            // Escape - Exit fullscreen
            if (e.code === "Escape" && fullscreen) {
                e.preventDefault()
                fullscreenManager?.exitFullscreen()
                return
            }

            // Number keys 0-9, seek to percentage (0%, 10%, 20%, ..., 90%)
            if (e.code.startsWith("Digit") && e.code.length === 6) {
                e.preventDefault()
                const digit = parseInt(e.code.slice(-1))
                const percentage = digit * 10
                const seekTime = Math.max(0, Math.min(video.duration, (video.duration * percentage) / 100))
                seekTo(seekTime)
                return
            }

            // frame-by-frame seeking, assuming 24fps
            if (e.code === "Comma") {
                e.preventDefault()
                seek(-1 / 24)
                showOverlayFeedback({ message: "Previous Frame" })
                return
            }

            if (e.code === "Period") {
                e.preventDefault()
                seek(1 / 24)
                showOverlayFeedback({ message: "Next Frame" })
                return
            }

            // Helper function to check if seeking is rate limited
            const canSeek = () => {
                const now = Date.now()
                if (now - lastSeekTime.current < SEEK_THROTTLE_MS) {
                    return false
                }
                lastSeekTime.current = now
                return true
            }

            // Check which shortcut was pressed
            if (e.code === keybindings.seekForward.key) {
                e.preventDefault()
                if (!canSeek()) return

                if (props.introEndTime && props.introStartTime && video.currentTime < props.introEndTime && video.currentTime >= props.introStartTime) {
                    seekTo(props.introEndTime)
                    showOverlayFeedback({ message: "Skipped Opening" })
                    return
                }
                if (props.endingEndTime && props.endingStartTime && video.currentTime < props.endingEndTime && video.currentTime >= props.endingStartTime) {
                    seekTo(props.endingEndTime)
                    showOverlayFeedback({ message: "Skipped Ending" })
                    return
                }
                seek(keybindings.seekForward.value)
                video.dispatchEvent(new Event("seeked"))
            } else if (e.code === keybindings.seekBackward.key) {
                e.preventDefault()
                if (!canSeek()) return
                seek(-keybindings.seekBackward.value)
                video.dispatchEvent(new Event("seeked"))
            } else if (e.code === keybindings.seekForwardFine.key) {
                e.preventDefault()
                video.dispatchEvent(new Event("seeking"))
                seek(keybindings.seekForwardFine.value)
                video.dispatchEvent(new Event("seeked"))
            } else if (e.code === keybindings.seekBackwardFine.key) {
                e.preventDefault()
                video.dispatchEvent(new Event("seeking"))
                seek(-keybindings.seekBackwardFine.value)
                video.dispatchEvent(new Event("seeked"))
            } else if (e.code === keybindings.nextChapter.key) {
                e.preventDefault()
                handleNextChapter()
            } else if (e.code === keybindings.previousChapter.key) {
                e.preventDefault()
                handlePreviousChapter()
            } else if (e.code === keybindings.volumeUp.key) {
                e.preventDefault()
                const newVolume = Math.min(1, volume + keybindings.volumeUp.value / 100)
                setVolume(newVolume)
            } else if (e.code === keybindings.volumeDown.key) {
                e.preventDefault()
                const newVolume = Math.max(0, volume - keybindings.volumeDown.value / 100)
                setVolume(newVolume)
            } else if (e.code === keybindings.mute.key) {
                e.preventDefault()
                setMuted(!muted)
            } else if (e.code === keybindings.cycleSubtitles.key) {
                e.preventDefault()
                handleCycleSubtitles()
            } else if (e.code === keybindings.cycleAudio.key) {
                e.preventDefault()
                handleCycleAudio()
            } else if (e.code === keybindings.nextEpisode.key) {
                e.preventDefault()
                handleNextEpisode()
            } else if (e.code === keybindings.previousEpisode.key) {
                e.preventDefault()
                handlePreviousEpisode()
            } else if (e.code === keybindings.fullscreen.key) {
                e.preventDefault()
                handleToggleFullscreen()
            } else if (e.code === keybindings.pictureInPicture.key) {
                e.preventDefault()
                handleTogglePictureInPicture()
            } else if (e.code === keybindings.takeScreenshot.key) {
                e.preventDefault()
                takeScreenshot()
            } else if (e.code === keybindings.increaseSpeed.key) {
                e.preventDefault()
                const newRate = Math.min(8, video.playbackRate + keybindings.increaseSpeed.value)
                video.playbackRate = newRate
                showOverlayFeedback({ message: `Speed: ${newRate.toFixed(2)}x` })
            } else if (e.code === keybindings.decreaseSpeed.key) {
                e.preventDefault()
                const newRate = Math.max(0.20, video.playbackRate - keybindings.decreaseSpeed.value)
                video.playbackRate = newRate
                showOverlayFeedback({ message: `Speed: ${newRate.toFixed(2)}x` })
            }
        },
        [keybindings, volume, volumeBoost, muted, seek, active, fullscreen, pip, showOverlayFeedback, introEndTime, introStartTime,
            videoElement, isMiniPlayer, setMiniPlayer])

    // Keyboard shortcut handlers
    const handleNextChapter = useCallback(() => {
        if (!videoElement || !chapterCues) return

        const currentTime = videoElement.currentTime

        // Sort chapters by start time to ensure proper order
        const sortedChapters = [...chapterCues].sort((a, b) => a.startTime - b.startTime)

        // Find the next chapter (with a small buffer to avoid edge cases)
        const nextChapter = sortedChapters.find(chapter => chapter.startTime > currentTime + 1)
        if (nextChapter) {
            seekTo(nextChapter.startTime)
            // Try to get chapter name from video track cues
            const chapterName = nextChapter.text
            showOverlayFeedback({ message: chapterName ? `Chapter: ${chapterName}` : `Chapter ${sortedChapters.indexOf(nextChapter) + 1}` })
        } else {
            // If no next chapter, go to the end
            const lastChapter = sortedChapters[sortedChapters.length - 1]
            if (lastChapter && lastChapter.endTime) {
                seekTo(lastChapter.endTime)
                showOverlayFeedback({ message: "End of chapters" })
            }
        }
    }, [chapterCues, seekTo, showOverlayFeedback])

    const handlePreviousChapter = useCallback(() => {
        if (!videoElement || !chapterCues) return

        const currentTime = videoElement.currentTime

        // Sort chapters by start time to ensure proper order
        const sortedChapters = [...chapterCues].sort((a, b) => a.startTime - b.startTime)

        // Find the current chapter first
        const currentChapterIndex = sortedChapters.findIndex((chapter, index) => {
            const nextChapter = sortedChapters[index + 1]
            return chapter.startTime <= currentTime && (!nextChapter || currentTime < nextChapter.startTime)
        })

        if (currentChapterIndex > 0) {
            // Go to previous chapter
            const previousChapter = sortedChapters[currentChapterIndex - 1]
            seekTo(previousChapter.startTime)
            const chapterName = previousChapter.text
            showOverlayFeedback({ message: chapterName ? `Chapter: ${chapterName}` : `Chapter ${currentChapterIndex}` })
        } else if (currentChapterIndex === 0) {
            // Already in first chapter, go to the beginning
            seekTo(0)
            const firstChapter = sortedChapters[0]
            const chapterName = firstChapter.text
            showOverlayFeedback({ message: chapterName ? `Chapter: ${chapterName}` : "Chapter 1" })
        } else {
            // If we can't determine current chapter, just go to the beginning
            seekTo(0)
            showOverlayFeedback({ message: "Beginning" })
        }
    }, [chapterCues, seekTo, showOverlayFeedback])


    const handleCycleSubtitles = useCallback(() => {
        if (!videoElement) return
        // TODO: make it work when both types are combined
        let found = false
        if (subtitleManager) {
            // Cycle to next track or disable if we're at the end
            const nextTrackNumber = subtitleManager.getNextTrackNumber(subtitleManager.getSelectedTrackNumberOrNull())

            // Enable next track if available
            if (nextTrackNumber > -1) {
                subtitleManager?.selectTrack(nextTrackNumber)
                const trackName = subtitleManager.getTrack(nextTrackNumber)?.label || `Track ${nextTrackNumber}`
                showOverlayFeedback({ message: `Subtitles: ${trackName}` })
                found = true
            }
        }
        if (mediaCaptionsManager) {
            const currentTrackIdx = mediaCaptionsManager.getSelectedTrackIndexOrNull() ?? -1
            const nextTrackIdx = currentTrackIdx + 1
            const nextTrack = mediaCaptionsManager.getTrack(nextTrackIdx)

            // Enable next track if available
            if (nextTrack) {
                mediaCaptionsManager?.selectTrack(nextTrackIdx)
                const trackName = mediaCaptionsManager.getTrack(nextTrackIdx)?.label || `Track ${nextTrackIdx}`
                showOverlayFeedback({ message: `Subtitles: ${trackName}` })
                found = true
            }
        }

        if (!found) {
            showOverlayFeedback({ message: "Subtitles: Off" })
            subtitleManager?.setNoTrack()
            mediaCaptionsManager?.setNoTrack()
        }
    }, [subtitleManager, mediaCaptionsManager])

    const handleCycleAudio = useCallback(() => {
        if (!videoElement || !audioManager) return

        // HLS stream
        if (audioManager.isHlsStream()) {
            const currentTrackNumber = audioManager.getSelectedTrackNumberOrNull()
            if (currentTrackNumber === null) {
                showOverlayFeedback({ message: "No additional audio tracks" })
                return
            }
            const audioTracks = audioManager.getHlsAudioTracks()

            const nextTrackNumber = (currentTrackNumber + 1) % (audioTracks.length)

            const nextTrack = audioTracks.find(n => n.id === nextTrackNumber)
            if (nextTrack) {
                const trackName = nextTrack.name || nextTrack.language || `Track ${nextTrack.id + 1}`
                showOverlayFeedback({ message: `Audio: ${trackName}` })
                audioManager.selectTrack(nextTrackNumber)
            }

            return
        }

        const audioTracks = videoElement.audioTracks
        if (!audioTracks || audioTracks.length <= 1) {
            showOverlayFeedback({ message: "No additional audio tracks" })
            return
        }

        // Find currently enabled track
        let currentTrackIndex = -1
        for (let i = 0; i < audioTracks.length; i++) {
            if (audioTracks[i].enabled) {
                currentTrackIndex = i
                break
            }
        }

        // Cycle to next track
        const nextIndex = (currentTrackIndex + 1) % audioTracks.length

        // Disable all tracks first
        for (let i = 0; i < audioTracks.length; i++) {
            audioTracks[i].enabled = false
        }

        // Enable next track
        audioTracks[nextIndex].enabled = true
        audioTracks.dispatchEvent?.(new Event("change"))
        audioManager.syncSelectedTrack()

        const trackName = audioTracks[nextIndex].label || audioTracks[nextIndex].language || `Track ${nextIndex + 1}`
        showOverlayFeedback({ message: `Audio: ${trackName}` })
    }, [audioManager])

    const log = logger("VideoCoreKeybindings")

    const handleNextEpisode = useCallback(() => {
        if (!hasNextEpisode) {
            showOverlayFeedback({ message: "No next episode" })
            log.info("No next episode available")
            return
        }

        log.info("Playing next episode")
        playEpisode("next")
    }, [hasNextEpisode, playEpisode, showOverlayFeedback])

    const handlePreviousEpisode = useCallback(() => {
        if (!hasPreviousEpisode) {
            showOverlayFeedback({ message: "No previous episode" })
            log.info("No previous episode available")
            return
        }

        log.info("Playing previous episode")
        playEpisode("previous")
    }, [hasPreviousEpisode, playEpisode, showOverlayFeedback])

    const handleToggleFullscreen = useCallback(() => {
        fullscreenManager?.toggleFullscreen()

        React.startTransition(() => {
            setTimeout(() => {
                videoElement?.focus()
            }, 100)
        })
    }, [fullscreenManager])

    const handleTogglePictureInPicture = useCallback(() => {
        pipManager?.enterPip()

        React.startTransition(() => {
            setTimeout(() => {
                videoElement?.focus()
            }, 100)
        })
    }, [pip, pipManager])

    // Add keyboard event listeners
    useEffect(() => {
        if (!active || !videoElement) return

        document.addEventListener("keydown", handleKeyboardShortcuts)

        return () => {
            document.removeEventListener("keydown", handleKeyboardShortcuts)
        }
    }, [handleKeyboardShortcuts, active, videoElement])

    // Handle fullscreen state changes to ensure video gets focused
    useEffect(() => {
        if (!active || !videoElement) return

        const handleFullscreenChange = () => {
            // Small delay to ensure fullscreen transition is complete
            setTimeout(() => {
                if (document.fullscreenElement && videoElement) {
                    videoElement.focus()
                }
            }, 100)
        }

        document.addEventListener("fullscreenchange", handleFullscreenChange)

        return () => {
            document.removeEventListener("fullscreenchange", handleFullscreenChange)
        }
    }, [active, videoElement])

    return null
}
