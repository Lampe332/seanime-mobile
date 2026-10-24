import { useServerMutation, useServerQuery } from "@/api/client/requests"
import { UpdateHomeItems_Variables } from "@/api/generated/endpoint.types"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { Models_HomeItem, Status } from "@/api/generated/types"
import { copyToClipboard } from "@/lib/helpers/browser"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

export function useGetStatus() {
    return useServerQuery<Status>({
        endpoint: API_ENDPOINTS.STATUS.GetStatus.endpoint,
        method: API_ENDPOINTS.STATUS.GetStatus.methods[0],
        queryKey: [API_ENDPOINTS.STATUS.GetStatus.key],
        enabled: true,
        retryDelay: 1000,
        // Fixes macOS desktop app startup issue
        retry: 6,
    })
}

export function useGetLatestLogContent() {
    const qc = useQueryClient()
    return useServerMutation<string>({
        endpoint: API_ENDPOINTS.STATUS.GetLatestLogContent.endpoint,
        method: API_ENDPOINTS.STATUS.GetLatestLogContent.methods[0],
        mutationKey: [API_ENDPOINTS.STATUS.GetLatestLogContent.key],
        onSuccess: async data => {
            if (!data) return toast.error("Couldn't fetch logs")
            try {
                await copyToClipboard(data)
                toast.success("Copied to clipboard")
            }
            catch (err: any) {
                console.error("Clipboard write error:", err)
                toast.error("Failed to copy logs: " + err.message)
            }
        },
    })
}


// Memory profiling hooks

export function useGetHomeItems() {
    return useServerQuery<Array<Models_HomeItem>>({
        endpoint: API_ENDPOINTS.STATUS.GetHomeItems.endpoint,
        method: API_ENDPOINTS.STATUS.GetHomeItems.methods[0],
        queryKey: [API_ENDPOINTS.STATUS.GetHomeItems.key],
        enabled: true,
    })
}

export function useUpdateHomeItems() {
    const qc = useQueryClient()
    return useServerMutation<null, UpdateHomeItems_Variables>({
        endpoint: API_ENDPOINTS.STATUS.UpdateHomeItems.endpoint,
        method: API_ENDPOINTS.STATUS.UpdateHomeItems.methods[0],
        mutationKey: [API_ENDPOINTS.STATUS.UpdateHomeItems.key],
        onSuccess: async () => {
            await qc.invalidateQueries({ queryKey: [API_ENDPOINTS.STATUS.GetHomeItems.key] })
            toast.success("Home screen updated")
        },
    })
}
