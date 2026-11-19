import { useServerMutation, useServerQuery } from "@/api/client/requests"
import {
    DeleteMediaMetadataParent_Variables,
    PopulateFillerData_Variables,
    RemoveFillerData_Variables,
    SaveMediaMetadataParent_Variables,
} from "@/api/generated/endpoint.types"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { Models_MediaMetadataParent } from "@/api/generated/types"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "@/components/ui/toast/toast-store"
import { tr } from "@/lib/app-language"

export function usePopulateFillerData() {
    const queryClient = useQueryClient()

    return useServerMutation<true, PopulateFillerData_Variables>({
        endpoint: API_ENDPOINTS.METADATA.PopulateFillerData.endpoint,
        method: API_ENDPOINTS.METADATA.PopulateFillerData.methods[0],
        mutationKey: [API_ENDPOINTS.METADATA.PopulateFillerData.key],
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntry.key] })
            toast.success(tr("Filler data fetched", "Filler-Daten geladen"))
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME.GetAnimeEpisodeCollection.key] })
        },
    })
}

export function useRemoveFillerData() {
    const queryClient = useQueryClient()

    return useServerMutation<boolean, RemoveFillerData_Variables>({
        endpoint: API_ENDPOINTS.METADATA.RemoveFillerData.endpoint,
        method: API_ENDPOINTS.METADATA.RemoveFillerData.methods[0],
        mutationKey: [API_ENDPOINTS.METADATA.RemoveFillerData.key],
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntry.key] })
            toast.success(tr("Filler data removed", "Filler-Daten entfernt"))
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME.GetAnimeEpisodeCollection.key] })
        },
    })
}

export function useGetMediaMetadataParent(id: number) {
    return useServerQuery<Models_MediaMetadataParent>({
        endpoint: API_ENDPOINTS.METADATA.GetMediaMetadataParent.endpoint.replace("{id}", String(id)),
        method: API_ENDPOINTS.METADATA.GetMediaMetadataParent.methods[0],
        queryKey: [API_ENDPOINTS.METADATA.GetMediaMetadataParent.key, String(id)],
        enabled: true,
    })
}

export function useSaveMediaMetadataParent() {
    const queryClient = useQueryClient()
    return useServerMutation<Models_MediaMetadataParent, SaveMediaMetadataParent_Variables>({
        endpoint: API_ENDPOINTS.METADATA.SaveMediaMetadataParent.endpoint,
        method: API_ENDPOINTS.METADATA.SaveMediaMetadataParent.methods[0],
        mutationKey: [API_ENDPOINTS.METADATA.SaveMediaMetadataParent.key],
        onSuccess: async () => {
            queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.METADATA.GetMediaMetadataParent.key] })
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntry.key] })
            toast.success(tr("Metadata updated", "Metadaten aktualisiert"))
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME.GetAnimeEpisodeCollection.key] })
        },
    })
}

export function useDeleteMediaMetadataParent() {
    const queryClient = useQueryClient()
    return useServerMutation<boolean, DeleteMediaMetadataParent_Variables>({
        endpoint: API_ENDPOINTS.METADATA.DeleteMediaMetadataParent.endpoint,
        method: API_ENDPOINTS.METADATA.DeleteMediaMetadataParent.methods[0],
        mutationKey: [API_ENDPOINTS.METADATA.DeleteMediaMetadataParent.key],
        onSuccess: async () => {
            queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.METADATA.GetMediaMetadataParent.key] })
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntry.key] })
            toast.success(tr("Metadata removed", "Metadaten entfernt"))
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME.GetAnimeEpisodeCollection.key] })
        },
    })
}
