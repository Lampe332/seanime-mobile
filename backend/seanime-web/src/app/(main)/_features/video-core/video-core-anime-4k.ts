import { vc_anime4kManager } from "@/app/(main)/_features/video-core/video-core"
import type { Anime4KOption } from "@/app/(main)/_features/video-core/video-core-anime-4k-manager"
import { vc_realVideoSize } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_seeking } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_paused } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_miniPlayer } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_videoElement } from "@/app/(main)/_features/video-core/video-core-atoms"
import { vc_pip } from "@/app/(main)/_features/video-core/video-core-pip"
import { logger } from "@/lib/helpers/debug"
import { useAtomValue } from "jotai"
import { useAtom } from "jotai/react"
import { atomWithStorage } from "jotai/utils"
import React from "react"

const log = logger("VIDEO CORE ANIME 4K")

export const vc_anime4kOption = atomWithStorage<Anime4KOption>("sea-video-core-anime4k", "off", undefined, { getOnInit: true })

export const VideoCoreAnime4K = () => {
    const realVideoSize = useAtomValue(vc_realVideoSize)
    const seeking = useAtomValue(vc_seeking)
    const isMiniPlayer = useAtomValue(vc_miniPlayer)
    const isPip = useAtomValue(vc_pip)
    const video = useAtomValue(vc_videoElement)
    const paused = useAtomValue(vc_paused)

    const manager = useAtomValue(vc_anime4kManager)
    const [selectedOption] = useAtom(vc_anime4kOption)

    const resizeCanvas = React.useEffectEvent(() => {
        if (!video || !manager) return

        const rect = video.getBoundingClientRect()
        if (!rect.width || !rect.height) return

        manager.resize(rect.width, rect.height)
    })

    // Update manager with real video size
    React.useEffect(() => {
        resizeCanvas()
    }, [manager, video])

    // Handle option changes
    React.useEffect(() => {
        if (video && manager) {
            // log.info("Setting Anime4K option", selectedOption)
            manager.setOption(selectedOption, {
                isMiniPlayer,
                isPip,
                seeking,
            })
        }
    }, [video, manager, selectedOption, isMiniPlayer, isPip, seeking])

    // Handle option changes
    // React.useLayoutEffect(() => {
    //     resizeCanvas()
    // }, [realVideoSize.width, realVideoSize.height])

    React.useEffect(() => {
        if (!video || !manager) return

        let resizeFrame = 0

        const handleResize = () => {
            if (resizeFrame) {
                cancelAnimationFrame(resizeFrame)
            }

            resizeFrame = requestAnimationFrame(() => {
                resizeFrame = 0
                resizeCanvas()
            })
        }

        window.addEventListener("resize", handleResize)

        return () => {
            window.removeEventListener("resize", handleResize)
            if (resizeFrame) {
                cancelAnimationFrame(resizeFrame)
            }
        }
    }, [manager, video])

    return null
}

export const anime4kOptions: { value: Anime4KOption; label: string; description: string; performance: "light" | "medium" | "heavy" }[] = [
    { value: "off", label: "Off", description: "Disabled", performance: "light" },
    { value: "mode-a", label: "Mode A", description: "Removes compression artifacts then upscales", performance: "light" },
    { value: "mode-b", label: "Mode B", description: "Gentle artifact removal then upscales", performance: "light" },
    { value: "mode-c", label: "Mode C", description: "Upscales with denoising then upscales again", performance: "light" },
    { value: "mode-aa", label: "Mode A+A", description: "Enhanced restoration for better quality", performance: "medium" },
    { value: "mode-bb", label: "Mode B+B", description: "Double soft restoration", performance: "medium" },
    { value: "mode-ca", label: "Mode C+A", description: "Denoising + restoration hybrid", performance: "medium" },
    { value: "cnn-2x-medium", label: "CNN 2x M", description: "Balanced speed and quality", performance: "medium" },
    { value: "cnn-2x-very-large", label: "CNN 2x VL", description: "High quality neural network", performance: "heavy" },
    { value: "denoise-cnn-2x-very-large", label: "Denoise CNN 2x VL", description: "Removes noise while upscaling", performance: "heavy" },
    { value: "cnn-2x-ultra-large", label: "CNN 2x UL", description: "Maximum CNN quality", performance: "heavy" },
    { value: "gan-3x-large", label: "GAN 3x L", description: "Generative adversarial network for perceptual quality", performance: "heavy" },
    { value: "gan-4x-ultra-large", label: "GAN 4x UL", description: "Maximum upscaling with GAN technology", performance: "heavy" },
]

export const getAnime4KOptionByValue = (value: Anime4KOption) => {
    return anime4kOptions.find(option => option.value === value)
}

