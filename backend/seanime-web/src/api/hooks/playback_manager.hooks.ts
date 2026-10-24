import { useServerMutation } from "@/api/client/requests"
import { PlaybackPlayVideo_Variables, PlaybackStartManualTracking_Variables } from "@/api/generated/endpoint.types"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { useServerStatus } from "@/app/(main)/_hooks/use-server-status"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

export function usePlaybackSyncCurrentProgress() {
    const serverStatus = useServerStatus()
    const queryClient = useQueryClient()

    return useServerMutation<number>({
        endpoint: API_ENDPOINTS.PLAYBACK_MANAGER.PlaybackSyncCurrentProgress.endpoint,
        method: API_ENDPOINTS.PLAYBACK_MANAGER.PlaybackSyncCurrentProgress.methods[0],
        mutationKey: [API_ENDPOINTS.PLAYBACK_MANAGER.PlaybackSyncCurrentProgress.key],
        onSuccess: async mediaId => {
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntry.key, String(mediaId)] })
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_COLLECTION.GetLibraryCollection.key] })
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANILIST.GetAnimeCollection.key] })
        },
    })
}

export function usePlaybackPlayNextEpisode(...keys: any) {
    return useServerMutation<boolean>({
        endpoint: API_ENDPOINTS.PLAYBACK_MANAGER.PlaybackPlayNextEpisode.endpoint,
        method: API_ENDPOINTS.PLAYBACK_MANAGER.PlaybackPlayNextEpisode.methods[0],
        mutationKey: [API_ENDPOINTS.PLAYBACK_MANAGER.PlaybackPlayNextEpisode.key, ...keys],
        onSuccess: async () => {

        },
    })
}

export function usePlaybackPlayVideo() {
    return useServerMutation<boolean, PlaybackPlayVideo_Variables>({
        endpoint: API_ENDPOINTS.PLAYBACK_MANAGER.PlaybackPlayVideo.endpoint,
        method: API_ENDPOINTS.PLAYBACK_MANAGER.PlaybackPlayVideo.methods[0],
        mutationKey: [API_ENDPOINTS.PLAYBACK_MANAGER.PlaybackPlayVideo.key],
        onSuccess: async () => {

        },
    })
}

export function usePlaybackStartManualTracking() {
    return useServerMutation<boolean, PlaybackStartManualTracking_Variables>({
        endpoint: API_ENDPOINTS.PLAYBACK_MANAGER.PlaybackStartManualTracking.endpoint,
        method: API_ENDPOINTS.PLAYBACK_MANAGER.PlaybackStartManualTracking.methods[0],
        mutationKey: [API_ENDPOINTS.PLAYBACK_MANAGER.PlaybackStartManualTracking.key],
        onSuccess: async () => {

        },
    })
}

export function usePlaybackCancelManualTracking({ onSuccess }: { onSuccess?: () => void }) {
    return useServerMutation<boolean>({
        endpoint: API_ENDPOINTS.PLAYBACK_MANAGER.PlaybackCancelManualTracking.endpoint,
        method: API_ENDPOINTS.PLAYBACK_MANAGER.PlaybackCancelManualTracking.methods[0],
        mutationKey: [API_ENDPOINTS.PLAYBACK_MANAGER.PlaybackCancelManualTracking.key],
        onSuccess: async () => {
            onSuccess?.()
        },
    })
}
