import { toast } from "sonner"
import { useMutation, useQuery } from "@tanstack/react-query"
import { APP_UPDATE_QUERY_KEY, AppUpdate, checkAppUpdate, knownAppUpdate } from "@/lib/app-updates"

export function useGetLatestUpdate(enabled: boolean) {
    return useQuery<AppUpdate | undefined>({
        queryKey: [APP_UPDATE_QUERY_KEY], queryFn: checkAppUpdate,
        initialData: knownAppUpdate, initialDataUpdatedAt: 0,
        enabled, staleTime: 60 * 60 * 1000, refetchOnWindowFocus: true, retry: false,
    })
}

export function useCheckForUpdates() {
    return useMutation<AppUpdate | undefined, Error, void>({
        mutationFn: checkAppUpdate, onError: error => toast.error(error.message),
    })
}
