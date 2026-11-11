import { useServerMutation } from "@/api/client/requests"
import { VideoCoreSaveScreenshot_Variables } from "@/api/generated/endpoint.types"
import { API_ENDPOINTS } from "@/api/generated/endpoints"

export function useVideoCoreSaveScreenshot() {
    return useServerMutation<boolean, VideoCoreSaveScreenshot_Variables>({
        endpoint: API_ENDPOINTS.VIDEOCORE.VideoCoreSaveScreenshot.endpoint,
        method: API_ENDPOINTS.VIDEOCORE.VideoCoreSaveScreenshot.methods[0],
        mutationKey: [API_ENDPOINTS.VIDEOCORE.VideoCoreSaveScreenshot.key],
    })
}
