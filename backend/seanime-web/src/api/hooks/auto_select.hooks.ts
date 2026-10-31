import { useServerMutation, useServerQuery } from "@/api/client/requests"
import { SaveAutoSelectProfile_Variables } from "@/api/generated/endpoint.types"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { Anime_AutoSelectProfile } from "@/api/generated/types"
import { useQueryClient } from "@tanstack/react-query"

const GET = API_ENDPOINTS.TORRENT_SEARCH.GetAutoSelectProfile
const SAVE = API_ENDPOINTS.TORRENT_SEARCH.SaveAutoSelectProfile
const DELETE = API_ENDPOINTS.TORRENT_SEARCH.DeleteAutoSelectProfile

/** The one auto-select profile; a profile that was never saved comes back empty with dbId 0. */
export function useGetAutoSelectProfile() {
    return useServerQuery<Anime_AutoSelectProfile>({
        endpoint: GET.endpoint,
        method: GET.methods[0],
        queryKey: [GET.key],
        enabled: true,
    })
}

export function useSaveAutoSelectProfile() {
    const qc = useQueryClient()
    return useServerMutation<Anime_AutoSelectProfile, SaveAutoSelectProfile_Variables>({
        endpoint: SAVE.endpoint,
        method: SAVE.methods[0],
        mutationKey: [SAVE.key],
        onSuccess: async data => {
            qc.setQueryData([GET.key], data)
        },
    })
}

export function useDeleteAutoSelectProfile() {
    const qc = useQueryClient()
    return useServerMutation<boolean>({
        endpoint: DELETE.endpoint,
        method: DELETE.methods[0],
        mutationKey: [DELETE.key],
        onSuccess: async () => {
            await qc.invalidateQueries({ queryKey: [GET.key] })
        },
    })
}
