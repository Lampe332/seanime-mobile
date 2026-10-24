import { usePlayNext } from "@/app/(main)/_atoms/playback.atoms"
import React from "react"

/** Plays the next episode when "Continue" opened this anime; the request is meant for one media only. */
export function usePlayNextVideoOnMount({ mediaId, onPlay }: { mediaId: number, onPlay: () => void }, enabled: boolean = true) {
    const { playNext, resetPlayNext } = usePlayNext()

    React.useEffect(() => {
        if (!enabled || playNext !== mediaId) return
        const t = setTimeout(() => {
            resetPlayNext()
            onPlay()
        }, 500)
        return () => clearTimeout(t)
    }, [playNext, mediaId, onPlay, enabled])
}
