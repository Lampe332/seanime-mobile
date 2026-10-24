import { usePlaybackCancelManualTracking, usePlaybackStartManualTracking, usePlaybackSyncCurrentProgress } from "@/api/hooks/playback_manager.hooks"
import { PhoneSheet } from "@/app/(main)/_features/phone-screen/phone-screen"
import { useWebsocketMessageListener } from "@/app/(main)/_hooks/handle-websockets"
import { SeaImage } from "@/components/shared/sea-image"
import { Button, IconButton } from "@/components/ui/button"
import { cn } from "@/components/ui/core/styling"
import { openTab } from "@/lib/helpers/browser"
import { useTr } from "@/lib/app-language"
import { WSEvents } from "@/lib/server/ws-events"
import { atom, useAtomValue } from "jotai"
import { useAtom } from "jotai/react"
import React from "react"
import { PiPopcornFill } from "react-icons/pi"
import { PlaybackManager_PlaybackState } from "./_lib/playback-manager.types"

type ManualProgressTrackingProps = {
    asSidebarButton?: boolean
}

const __mpt_isWatchingAtom = atom<boolean>(false)
const __mpt_showModalAtom = atom<boolean>(false)
export const __mpt_currentExternalPlayerLinkAtom = atom<string | null>(null)

export function ManualProgressTrackingButton(props: ManualProgressTrackingProps) {

    const {
        asSidebarButton,
        ...rest
    } = props

    const [isWatching, setIsWatching] = useAtom(__mpt_isWatchingAtom)
    const [showModal, setShowModal] = useAtom(__mpt_showModalAtom)

    return (
        <>
            {isWatching && (
                <>
                    {asSidebarButton ? (
                        <IconButton
                            data-manual-progress-tracking-button
                            intent="primary-subtle"
                            className={cn("animate-pulse")}
                            icon={<PiPopcornFill />}
                            onClick={() => setShowModal(true)}
                        />
                    ) : (
                        <Button
                            data-manual-progress-tracking-button
                            intent="primary"
                            className={cn("animate-pulse")}
                            leftIcon={<PiPopcornFill />}
                            onClick={() => setShowModal(true)}
                        >
                            Currently watching
                        </Button>)}
                </>
            )}
        </>
    )
}

export function ManualProgressTracking() {

    const [isWatching, setIsWatching] = useAtom(__mpt_isWatchingAtom)
    const stateRef = React.useRef<PlaybackManager_PlaybackState | null>(null)
    const [state, setState] = React.useState<PlaybackManager_PlaybackState | null>(null)
    const [showModal, setShowModal] = useAtom(__mpt_showModalAtom)
    const currentExternalPlayerLink = useAtomValue(__mpt_currentExternalPlayerLinkAtom)

    // Playback state
    useWebsocketMessageListener<PlaybackManager_PlaybackState | null>({
        type: WSEvents.PLAYBACK_MANAGER_MANUAL_TRACKING_PLAYBACK_STATE,
        onMessage: data => {
            if (!isWatching) {
                setIsWatching(true)
            }
            setState(data)
        },
    })

    React.useEffect(() => {
        if (stateRef.current === null) {
            setShowModal(true)
        }
        stateRef.current = state
    }, [state])

    useWebsocketMessageListener({
        type: WSEvents.PLAYBACK_MANAGER_MANUAL_TRACKING_STOPPED,
        onMessage: () => {
            setIsWatching(false)
            setShowModal(false)
            setState(null)
        },
    })

    const { mutate: syncProgress, isPending: isSyncing } = usePlaybackSyncCurrentProgress()

    const { mutate: startManualTracking, isPending: isStarting } = usePlaybackStartManualTracking()

    // Get the server to stop reporting the progress
    const { mutate: cancelManualTracking, isPending: isCanceling } = usePlaybackCancelManualTracking({
        onSuccess: () => {
            setShowModal(false)
            setState(null)
            setIsWatching(false)
        },
    })

    const t = useTr()
    const busy = isSyncing || isStarting || isCanceling

    // Phones: a sheet with the episode, "watched" as the one action and the way back to the player
    return (
        <PhoneSheet title={t("Playing in your player", "Läuft in deinem Player")} open={showModal && isWatching} onOpenChange={v => setShowModal(v)}
            data-manual-progress-tracking-modal
            footer={<>
                <button type="button" className="ps-secondary" disabled={busy} onClick={() => cancelManualTracking()} data-mpt-stop>{t("Stop tracking", "Nicht mehr verfolgen")}</button>
                <button type="button" className="ps-primary" disabled={busy || !state} onClick={() => syncProgress()} data-mpt-sync>
                    {state ? t(`Episode ${state.episodeNumber} watched`, `Folge ${state.episodeNumber} gesehen`) : t("Mark watched", "Als gesehen markieren")}
                </button>
            </>}>
            {state && <div className="ps-list" data-manual-progress-tracking-modal-content>
                <div className="ps-list-row">
                    <span className="ps-list-cover">{!!state.mediaCoverImage && <SeaImage src={state.mediaCoverImage} alt="" fill sizes="3rem" className="object-cover" />}</span>
                    <span className="ps-list-text">
                        <span className="ps-list-title">{state.mediaTitle}</span>
                        <span className="ps-list-meta">{t(`Episode ${state.episodeNumber}`, `Folge ${state.episodeNumber}`)}{state.mediaTotalEpisodes > 0 ? ` / ${state.mediaTotalEpisodes}` : ""}</span>
                    </span>
                </div>
            </div>}
            <p className="ps-sheet-note">{t("When you have watched it, mark it here and your AniList progress moves on.",
                "Wenn du sie gesehen hast, markiere sie hier, dann geht dein AniList-Fortschritt weiter.")}</p>
            {!!currentExternalPlayerLink && <button type="button" className="ps-text-action" onClick={() => openTab(currentExternalPlayerLink)} data-mpt-reopen>
                {t("Open the player again", "Player wieder öffnen")}</button>}
        </PhoneSheet>
    )
}
