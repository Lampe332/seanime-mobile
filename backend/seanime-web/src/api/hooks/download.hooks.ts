import { useServerMutation } from "@/api/client/requests"
import { DownloadTorrentFile_Variables } from "@/api/generated/endpoint.types"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { toast } from "sonner"

export function useDownloadTorrentFile(onSuccess?: () => void) {
    return useServerMutation<boolean, DownloadTorrentFile_Variables>({
        endpoint: API_ENDPOINTS.DOWNLOAD.DownloadTorrentFile.endpoint,
        method: API_ENDPOINTS.DOWNLOAD.DownloadTorrentFile.methods[0],
        mutationKey: [API_ENDPOINTS.DOWNLOAD.DownloadTorrentFile.key],
        onSuccess: async () => {
            toast.success("Files downloaded")
            onSuccess?.()
        },
    })
}
