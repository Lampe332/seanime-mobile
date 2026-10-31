import { GradientBackground } from "@/components/shared/gradient-background"
import { LuffyError } from "@/components/shared/luffy-error"
import { cn } from "@/components/ui/core/styling"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { Button } from "@/components/ui/button"
import { playerErrorText, playerLoadingText } from "@/app/(main)/_features/media-core/media-core-texts"
import { useTr } from "@/lib/app-language"
import React from "react"
import { ImSpinner2 } from "react-icons/im"
import { PiSpinnerDuotone } from "react-icons/pi"

export function MediaCoreBufferingOverlay(props: { buffering: boolean }) {
    if (!props.buffering) return null
    return (
        <div
            data-vc-element="buffering-indicator"
            className="absolute inset-0 flex items-center justify-center z-[50] pointer-events-none"
        >
            <div className="bg-black/20 backdrop-blur-sm rounded-full p-4">
                <PiSpinnerDuotone className="size-12 text-white animate-spin" />
            </div>
        </div>
    )
}

export function MediaCoreErrorOverlay(props: {
    playbackError: string | null
    isMiniPlayer: boolean
    onClose?: () => void
    /** Loads the video again where it stopped */
    onRetry?: () => void
}) {
    const { playbackError, isMiniPlayer, onClose, onRetry } = props
    const t = useTr()
    if (!playbackError) return null
    const title = t("Playback error", "Wiedergabefehler")

    return (
        <div
            data-vc-element="playback-error-container"
            className="h-full w-full bg-black/100 flex items-center justify-center z-[20] absolute p-4"
        >
            <div className="text-white text-center" data-vc-element="playback-error-content">
                {!isMiniPlayer ? (
                    <LuffyError title={title} imageContainerClass="size-[3.5rem] lg:size-[8rem]" />
                ) : (
                    <h1 data-vc-element="playback-error-title" className={cn("text-2xl font-bold", isMiniPlayer && "text-lg")}>
                        {title}
                    </h1>
                )}
                <p
                    data-vc-element="playback-error-message"
                    className={cn("text-base text-white/50 max-w-xl mx-auto mt-2", isMiniPlayer && "text-sm max-w-lg")}
                >
                    {playerErrorText(playbackError, t)}
                </p>
                {(onRetry || onClose) && (
                    <div className="mt-6 flex flex-wrap justify-center gap-2">
                        {onRetry && <Button intent="white" size={isMiniPlayer ? "sm" : "md"} className={cn(!isMiniPlayer && "min-h-11")} onClick={onRetry}>
                            {t("Try again", "Erneut versuchen")}
                        </Button>}
                        {onClose && <Button intent="warning-subtle" size={isMiniPlayer ? "sm" : "md"} className={cn(!isMiniPlayer && "min-h-11")} onClick={onClose}>
                            {t("Close player", "Player schließen")}
                        </Button>}
                    </div>
                )}
            </div>
        </div>
    )
}

export function MediaCoreLoadingOverlay(props: {
    loadingState: string | null
    isMiniPlayer: boolean
    inline: boolean
    fullscreen: boolean
    terminateButton?: React.ReactNode
}) {
    const { loadingState, isMiniPlayer, inline, fullscreen, terminateButton } = props
    const t = useTr()
    if (!loadingState) return null

    return (
        <div
            data-vc-element="loading-overlay"
            className="w-full h-full absolute inset-0 z-[20] flex justify-center items-center flex-col space-y-4 bg-black rounded-md"
        >
            {(!inline || fullscreen) && terminateButton}
            
            <LoadingSpinner
                title={playerLoadingText(loadingState, t)}
                spinner={<ImSpinner2 className="size-20 text-white animate-spin" />}
                containerClass="z-[1]"
            />
            
            {!isMiniPlayer && !inline && (
                <div className="opacity-50 absolute inset-0 z-[0] overflow-hidden" data-vc-element="loading-overlay-gradient">
                    <GradientBackground duration={10} breathingRange={5} />
                </div>
            )}
        </div>
    )
}
