import { useServerQuery } from "@/api/client/requests"
import { GetContinuityWatchHistoryItem_Variables } from "@/api/generated/endpoint.types"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { Continuity_WatchHistory, Continuity_WatchHistoryItemResponse, Nullish } from "@/api/generated/types"
import { useServerStatus } from "@/app/(main)/_hooks/use-server-status"
import { logger } from "@/lib/helpers/debug"

function useGetContinuityWatchHistoryItem(mediaId: Nullish<number | string>) {
    const serverStatus = useServerStatus()
    return useServerQuery<Continuity_WatchHistoryItemResponse, GetContinuityWatchHistoryItem_Variables>({
        endpoint: API_ENDPOINTS.CONTINUITY.GetContinuityWatchHistoryItem.endpoint.replace("{id}", String(mediaId)),
        method: API_ENDPOINTS.CONTINUITY.GetContinuityWatchHistoryItem.methods[0],
        queryKey: [API_ENDPOINTS.CONTINUITY.GetContinuityWatchHistoryItem.key, String(mediaId)],
        enabled: serverStatus?.settings?.library?.enableWatchContinuity && !!mediaId,
    })
}

export function useGetContinuityWatchHistory() {
    return useServerQuery<Continuity_WatchHistory>({
        endpoint: API_ENDPOINTS.CONTINUITY.GetContinuityWatchHistory.endpoint,
        method: API_ENDPOINTS.CONTINUITY.GetContinuityWatchHistory.methods[0],
        queryKey: [API_ENDPOINTS.CONTINUITY.GetContinuityWatchHistory.key],
        enabled: true,
    })
}

/** The history item of this episode when it was started (5 %) and not finished (90 %). */
function partlyWatchedItem(history: Nullish<Continuity_WatchHistory>, mediaId: number, progressNumber: number) {
    const item = history?.[mediaId]
    if (!item?.currentTime || !item.duration || item.episodeNumber !== progressNumber) return null
    const ratio = item.currentTime / item.duration
    return ratio >= 0.05 && ratio < 0.9 ? item : null
}

export function getEpisodePercentageComplete(history: Nullish<Continuity_WatchHistory>, mediaId: number, progressNumber: number) {
    const item = partlyWatchedItem(history, mediaId, progressNumber)
    return item ? Math.round(item.currentTime / item.duration * 100) : 0
}

export function getEpisodeMinutesRemaining(history: Nullish<Continuity_WatchHistory>, mediaId: number, progressNumber: number) {
    const item = partlyWatchedItem(history, mediaId, progressNumber)
    return item ? Math.round((item.duration - item.currentTime) / 60) : 0
}

export function useHandleCurrentMediaContinuity(mediaId: Nullish<number | string>) {
    const serverStatus = useServerStatus()

    const { data: watchHistory, isLoading: watchHistoryLoading } = useGetContinuityWatchHistoryItem(mediaId)

    const waitForWatchHistory = watchHistoryLoading && serverStatus?.settings?.library?.enableWatchContinuity

    function getEpisodeContinuitySeekTo(episodeNumber: Nullish<number>, playerCurrentTime: Nullish<number>, playerDuration: Nullish<number>) {
        if (!serverStatus?.settings?.library?.enableWatchContinuity || !mediaId || !watchHistory || !playerDuration || !episodeNumber) return 0
        const item = watchHistory?.item
        if (!item || !item.currentTime || !item.duration || item.episodeNumber !== episodeNumber) return 0
        if (!(item.currentTime > 0 && item.currentTime < playerDuration) || item.currentTime / item.duration > 0.9) return 0
        logger("CONTINUITY").info("Found last watched time", {
            currentTime: item.currentTime,
            duration: item.duration,
            episodeNumber: item.episodeNumber,
        })
        return item.currentTime
    }

    return {
        watchHistory,
        waitForWatchHistory,
        shouldWaitForWatchHistory: serverStatus?.settings?.library?.enableWatchContinuity,
        getEpisodeContinuitySeekTo,
    }
}
