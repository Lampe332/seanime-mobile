import { useServerMutation } from "../client/requests"
import { DirectstreamConvertSubs_Variables, DirectstreamPlayLocalFile_Variables } from "../generated/endpoint.types"
import { API_ENDPOINTS } from "../generated/endpoints"

export function useDirectstreamPlayLocalFile() {
    return useServerMutation<null, DirectstreamPlayLocalFile_Variables>({
        endpoint: API_ENDPOINTS.DIRECTSTREAM.DirectstreamPlayLocalFile.endpoint,
        method: API_ENDPOINTS.DIRECTSTREAM.DirectstreamPlayLocalFile.methods[0],
        mutationKey: [API_ENDPOINTS.DIRECTSTREAM.DirectstreamPlayLocalFile.key],
        onSuccess: async () => {

        },
    })
}

export function useDirectstreamConvertSubs() {
    return useServerMutation<string, DirectstreamConvertSubs_Variables>({
        endpoint: API_ENDPOINTS.DIRECTSTREAM.DirectstreamConvertSubs.endpoint,
        method: API_ENDPOINTS.DIRECTSTREAM.DirectstreamConvertSubs.methods[0],
        mutationKey: [API_ENDPOINTS.DIRECTSTREAM.DirectstreamConvertSubs.key],
        onSuccess: async (data) => {
        },
    })
}
