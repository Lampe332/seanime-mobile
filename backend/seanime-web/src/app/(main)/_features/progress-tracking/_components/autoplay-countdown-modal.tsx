import { AutoplayState } from "@/app/(main)/_features/autoplay/autoplay"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { logger } from "@/lib/helpers/debug"
import { BiSolidSkipNextCircle } from "react-icons/bi"

interface AutoplayCountdownModalProps {
    autoplayState: AutoplayState
    onCancel: () => void
    onPlayNow?: () => void
}

export function AutoplayCountdownModal({
    autoplayState,
    onCancel,
    onPlayNow,
}: AutoplayCountdownModalProps) {

    const { isActive, countdown, nextEpisode, streamingType } = autoplayState

    const handleClose = () => {
        logger("AutoplayCountdownModal").info("User cancelled autoplay")
        onCancel()
    }

    const handlePlayNow = () => {
        logger("AutoplayCountdownModal").info("User requested immediate play")
        onPlayNow?.()
    }

    const getStreamingTypeLabel = () => {
        switch (streamingType) {
            case "local":
                return "Local File"
            case "torrent":
                return "Torrent Stream"
            case "debrid":
                return "Debrid Stream"
            default:
                return "Unknown"
        }
    }

    const getNextEpisodeInfo = () => {
        if (nextEpisode) {
            return {
                title: nextEpisode.displayTitle,
                episodeTitle: nextEpisode.episodeTitle,
                image: nextEpisode.episodeMetadata?.image || nextEpisode.baseAnime?.coverImage?.large,
            }
        }

        return {
            title: "Next Episode",
            episodeTitle: null,
            image: null,
        }
    }

    if (!isActive) return null

    const episodeInfo = getNextEpisodeInfo()

    return (
        <Modal
            open={isActive}
            onOpenChange={(open) => {
                if (!open) handleClose()
            }}
            titleClass="text-center"
            hideCloseButton
            title="Playing next episode in"
            contentClass="!space-y-4 relative max-w-xl border-transparent !rounded-3xl"
            closeClass="!text-[--red]"
        >
            <div className="text-center space-y-4">
                <div className="rounded-[--radius-md] text-center">
                    <h3 className="text-5xl font-bold">{countdown}</h3>
                </div>

                {/*                fill*/}




                <div className="flex gap-2 pt-2">
                    <Button
                        intent="gray-basic"
                        onClick={handleClose}
                        className="flex-1"
                        size="sm"
                    >
                        Cancel
                    </Button>

                    {onPlayNow && (
                        <Button
                            intent="primary"
                            onClick={handlePlayNow}
                            className="flex-1"
                            size="sm"
                            leftIcon={<BiSolidSkipNextCircle />}
                        >
                            Play Now
                        </Button>
                    )}
                </div>
            </div>
        </Modal>
    )
}
