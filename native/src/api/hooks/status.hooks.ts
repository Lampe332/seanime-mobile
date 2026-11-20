import { useServerMutation, useServerQuery } from "@/api/client/requests"
import { UpdateHomeItems_Variables } from "@/api/generated/endpoint.types"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { Models_HomeItem, Status } from "@/api/generated/types"
import { copyToClipboard } from "@/lib/helpers/browser"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "@/components/ui/toast/toast-store"
import { tr } from "@/lib/app-language"
import { homeItemsSaveOptions } from "./home-items-sync"

export function useGetStatus() {
    return useServerQuery<Status>({
        endpoint: API_ENDPOINTS.STATUS.GetStatus.endpoint,
        method: API_ENDPOINTS.STATUS.GetStatus.methods[0],
        queryKey: [API_ENDPOINTS.STATUS.GetStatus.key],
        enabled: true,
        retryDelay: 1000,
        // the server may still be starting when the WebView loads
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
            if (!data) return toast.error(tr("Couldn't fetch logs", "Logs konnten nicht geladen werden"))
            try {
                await copyToClipboard(data)
                toast.success(tr("Copied to clipboard", "In die Zwischenablage kopiert"))
            }
            catch (err: any) {
                console.error("Clipboard write error:", err)
                toast.error(tr(`Failed to copy logs: ${err.message}`, `Logs konnten nicht kopiert werden: ${err.message}`))
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

/**
 * Saves Home's sections. The change shows at once and needs no toast (home-items-sync.ts); a failed save brings the
 * previous list back with one error toast.
 */
export function useUpdateHomeItems() {
    const qc = useQueryClient()
    return useServerMutation<null, UpdateHomeItems_Variables>({
        endpoint: API_ENDPOINTS.STATUS.UpdateHomeItems.endpoint,
        method: API_ENDPOINTS.STATUS.UpdateHomeItems.methods[0],
        ...homeItemsSaveOptions(qc, () => toast.error(tr("Your change could not be saved. Home is back as it was.",
            "Deine Änderung konnte nicht gespeichert werden. Die Startseite ist wieder wie vorher."), { id: "home-items-save" })),
    })
}
