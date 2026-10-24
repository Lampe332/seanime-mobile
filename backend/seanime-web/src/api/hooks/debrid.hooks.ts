import { SeaError, useServerMutation, useServerQuery } from "@/api/client/requests"
import { DebridAddTorrents_Variables, DebridCancelStream_Variables, DebridGetTorrentFilePreviews_Variables, DebridStartStream_Variables, SaveDebridSettings_Variables } from "@/api/generated/endpoint.types"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { DebridClient_FilePreview, Models_DebridSettings } from "@/api/generated/types"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

export function useSaveDebridSettings() {
    const qc = useQueryClient()
    return useServerMutation<Models_DebridSettings, SaveDebridSettings_Variables>({
        endpoint: API_ENDPOINTS.DEBRID.SaveDebridSettings.endpoint,
        method: API_ENDPOINTS.DEBRID.SaveDebridSettings.methods[0],
        mutationKey: [API_ENDPOINTS.DEBRID.SaveDebridSettings.key],
        onSuccess: async () => {
            await qc.invalidateQueries({ queryKey: [API_ENDPOINTS.STATUS.GetStatus.key] })
        },
    })
}

export function useDebridAddTorrents(onSuccess: () => void) {
    const qc = useQueryClient()
    return useServerMutation<boolean, DebridAddTorrents_Variables>({
        endpoint: API_ENDPOINTS.DEBRID.DebridAddTorrents.endpoint,
        method: API_ENDPOINTS.DEBRID.DebridAddTorrents.methods[0],
        mutationKey: [API_ENDPOINTS.DEBRID.DebridAddTorrents.key],
        onSuccess: async () => {
            onSuccess()
            toast.success("Torrent added")
            await qc.invalidateQueries({ queryKey: [API_ENDPOINTS.DEBRID.DebridGetTorrents.key] })
        },
    })
}

export function useDebridGetTorrentFilePreviews(variables: Partial<DebridGetTorrentFilePreviews_Variables>, enabled: boolean) {
    return useServerQuery<Array<DebridClient_FilePreview>, DebridGetTorrentFilePreviews_Variables>({
        endpoint: API_ENDPOINTS.DEBRID.DebridGetTorrentFilePreviews.endpoint,
        method: API_ENDPOINTS.DEBRID.DebridGetTorrentFilePreviews.methods[0],
        queryKey: [API_ENDPOINTS.DEBRID.DebridGetTorrentFilePreviews.key, variables?.torrent?.infoHash],
        data: variables as DebridGetTorrentFilePreviews_Variables,
        enabled: enabled,
        gcTime: 0,
    })
}

/** onError replaces the default error toast (the phone words it itself) */
export function useDebridStartStream(onError?: (error: SeaError) => void) {
    return useServerMutation<boolean, DebridStartStream_Variables>({
        endpoint: API_ENDPOINTS.DEBRID.DebridStartStream.endpoint,
        method: API_ENDPOINTS.DEBRID.DebridStartStream.methods[0],
        mutationKey: [API_ENDPOINTS.DEBRID.DebridStartStream.key],
        onSuccess: async () => {
        },
        ...(onError ? { onError } : {}),
    })
}

export function useDebridCancelStream() {
    return useServerMutation<boolean, DebridCancelStream_Variables>({
        endpoint: API_ENDPOINTS.DEBRID.DebridCancelStream.endpoint,
        method: API_ENDPOINTS.DEBRID.DebridCancelStream.methods[0],
        mutationKey: [API_ENDPOINTS.DEBRID.DebridCancelStream.key],
        onSuccess: async () => {
            toast.success("Stream cancelled")
        },
    })
}
