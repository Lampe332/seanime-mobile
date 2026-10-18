import { useServerMutation, useServerQuery } from "@/api/client/requests"
import { InstallLatestUpdate_Variables } from "@/api/generated/endpoint.types"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { Status, Updater_Update } from "@/api/generated/types"
import { useSetServerStatus } from "@/app/(main)/_hooks/use-server-status"
import { toast } from "sonner"
import { useMutation, useQuery } from "@tanstack/react-query"
import { checkAppUpdate, IS_MOBILE_APP, knownAppUpdate } from "@/lib/app-updates"

export function useGetLatestUpdate(enabled: boolean) {
    if (IS_MOBILE_APP) return useQuery<Updater_Update | undefined>({
        queryKey: [API_ENDPOINTS.RELEASES.GetLatestUpdate.key], queryFn: checkAppUpdate,
        initialData: knownAppUpdate, initialDataUpdatedAt: 0,
        enabled, staleTime: 60 * 60 * 1000, refetchInterval: 60 * 60 * 1000, retry: false,
    })
    return useServerQuery<Updater_Update>({
        endpoint: API_ENDPOINTS.RELEASES.GetLatestUpdate.endpoint,
        method: API_ENDPOINTS.RELEASES.GetLatestUpdate.methods[0],
        queryKey: [API_ENDPOINTS.RELEASES.GetLatestUpdate.key],
        enabled: enabled,
    })
}

export function useInstallLatestUpdate() {
    const setServerStatus = useSetServerStatus()
    return useServerMutation<Status, InstallLatestUpdate_Variables>({
        endpoint: API_ENDPOINTS.RELEASES.InstallLatestUpdate.endpoint,
        method: API_ENDPOINTS.RELEASES.InstallLatestUpdate.methods[0],
        mutationKey: [API_ENDPOINTS.RELEASES.InstallLatestUpdate.key],
        onSuccess: async (data) => {
            if (data) {
                setServerStatus(data)
            }
            toast.info("Installing update...")
        },
    })
}

export function useGetChangelog(before: string, after: string, enabled: boolean) {
    return useServerQuery<{ version: string, lines: string[] }[]>({
        endpoint: API_ENDPOINTS.RELEASES.GetChangelog.endpoint + `?before=${before}&after=${after}`,
        method: API_ENDPOINTS.RELEASES.GetChangelog.methods[0],
        queryKey: [API_ENDPOINTS.RELEASES.GetChangelog.key],
        enabled: enabled,
    })
}

export function useCheckForUpdates() {
    if (IS_MOBILE_APP) return useMutation<Updater_Update | undefined, Error, void>({
        mutationFn: checkAppUpdate, onError: error => toast.error(error.message),
    })
    return useServerMutation<Updater_Update>({
        endpoint: API_ENDPOINTS.RELEASES.CheckForUpdates.endpoint,
        method: API_ENDPOINTS.RELEASES.CheckForUpdates.methods[0],
        mutationKey: [API_ENDPOINTS.RELEASES.CheckForUpdates.key],
        onSuccess: async () => {
        },
    })
}
