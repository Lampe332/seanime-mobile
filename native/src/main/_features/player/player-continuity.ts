import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { Nullish } from "@/api/generated/types"
import { useHandleCurrentMediaContinuity } from "@/api/hooks/continuity.hooks"
import { useQueryClient } from "@tanstack/react-query"
import React from "react"

/**
 * Where a playback starts from the server's watch continuity, as the web player does it:
 * - every new playback id asks the server again (video-core.tsx invalidates GetContinuityWatchHistory and
 *   GetContinuityWatchHistoryItem on `playbackInfo.id`), for server and online streams alike. The native player only
 *   did it when the server's native-player state changed, so an online episode reopened after × started from the
 *   cached answer of an earlier opening (0:00, docs/NATIVE-UMBAU.md §9 09.11.2026);
 * - the position is the server's item for this episode (returned at 5–90 % watched, continuity/history.go) through the
 *   web's getEpisodeContinuitySeekTo.
 * The web seeks once the video can play, by when the new answer is in. mpv takes the start position when the file is
 * opened (loadfile start=…), so the native player hands over the source only once the answer asked for this playback
 * has arrived (or failed). After that the source stays, whatever the query does later.
 */
export type ContinuityStartState = {
    /** continuity is on and the playback belongs to an anime (otherwise nothing is waited for, as in the web) */
    enabled: boolean
    /** the refetch this playback asked for has settled (done, failed or replaced by a newer one) */
    refreshed: boolean
    /** the watch history item is being fetched (a newer refetch that replaced this playback's one) */
    fetching: boolean
}

/** Whether the start position of this playback is known. */
export function continuityStartReady(s: ContinuityStartState): boolean {
    if (!s.enabled) return true
    return s.refreshed && !s.fetching
}

/**
 * useHandleCurrentMediaContinuity for the native player: `waitForWatchHistory` holds until the watch history asked for
 * this `playbackId` is in, once per playback.
 */
export function usePlayerContinuity(playbackId: Nullish<string>, mediaId: Nullish<number>) {
    const qc = useQueryClient()
    const continuity = useHandleCurrentMediaContinuity(mediaId)
    const [refreshedFor, setRefreshedFor] = React.useState<string | null>(null)
    React.useEffect(() => {
        if (!playbackId) return
        let alive = true
        // resolves when the refetch has settled; a refetch it was cancelled by is still running (fetching) then
        void Promise.all([
            qc.invalidateQueries({ queryKey: [API_ENDPOINTS.CONTINUITY.GetContinuityWatchHistory.key] }),
            qc.invalidateQueries({ queryKey: [API_ENDPOINTS.CONTINUITY.GetContinuityWatchHistoryItem.key] }),
        ]).catch(() => undefined).then(() => {
            if (alive) setRefreshedFor(playbackId)
        })
        return () => {
            alive = false
        }
    }, [playbackId, qc])

    const readyNow = continuityStartReady({
        enabled: !!continuity.shouldWaitForWatchHistory && !!mediaId,
        refreshed: !!playbackId && refreshedFor === playbackId,
        fetching: continuity.watchHistoryFetching,
    })
    // once started, a later refetch (native-player state changes) does not take the source away
    const [startedFor, setStartedFor] = React.useState<string | null>(null)
    if (readyNow && playbackId && startedFor !== playbackId) setStartedFor(playbackId)
    const ready = readyNow || (!!playbackId && startedFor === playbackId)

    return { ...continuity, waitForWatchHistory: !ready }
}
