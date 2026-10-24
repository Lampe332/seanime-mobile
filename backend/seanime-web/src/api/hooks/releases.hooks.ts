import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { Updater_Update } from "@/api/generated/types"
import { toast } from "sonner"
import { useMutation, useQuery } from "@tanstack/react-query"
import { checkAppUpdate, knownAppUpdate } from "@/lib/app-updates"

export function useGetLatestUpdate(enabled: boolean) {
    return useQuery<Updater_Update | undefined>({
        queryKey: [API_ENDPOINTS.RELEASES.GetLatestUpdate.key], queryFn: checkAppUpdate,
        initialData: knownAppUpdate, initialDataUpdatedAt: 0,
        enabled, staleTime: 60 * 60 * 1000, refetchOnWindowFocus: true, retry: false,
    })
}

export function useCheckForUpdates() {
    return useMutation<Updater_Update | undefined, Error, void>({
        mutationFn: checkAppUpdate, onError: error => toast.error(error.message),
    })
}
