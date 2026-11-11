import { toast } from "@/components/ui/toast/toast-store"
import {
    acknowledgeInstalledUpdate,
    type AppUpdate,
    checkAppUpdate,
    downloadAppUpdate,
    knownAppUpdate,
    openDownloadedApk,
    readAppDownload,
    subscribeAppDownload,
} from "@/lib/app-updates/app-updater"
import { updateNoticeOpens } from "@/lib/app-updates/update-notice"
import type { AppDownloadState } from "@/lib/app-updates/updater-state"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { useMutation, useQuery } from "@tanstack/react-query"
import React from "react"

export const APP_UPDATE_QUERY_KEY = "RELEASES-get-latest-update"

/**
 * The newest app release (GitHub). [enabled]: the caller's choice; "Look for new versions" (Settings → About,
 * `library.disableUpdateCheck`) off means the app neither checks by itself nor shows the notice — see useAutoUpdateCheck.
 */
export function useGetLatestUpdate(enabled: boolean) {
    return useQuery<AppUpdate | undefined>({
        queryKey: [APP_UPDATE_QUERY_KEY], queryFn: checkAppUpdate,
        initialData: knownAppUpdate, initialDataUpdatedAt: 0,
        enabled, staleTime: 60 * 60 * 1000, refetchOnWindowFocus: true, retry: false,
    })
}

/**
 * Whether the app looks for new versions by itself (the server setting, default on): exactly when an update it found
 * would open the notice by itself (updateNoticeOpens, the one rule for "Look for new versions").
 */
export function useAutoUpdateCheck(): boolean {
    const server = useServerStatus()
    return !!server && updateNoticeOpens("automatic", server.settings?.library?.disableUpdateCheck, true)
}

/** The manual "Check for updates" (works also when the automatic check is off). */
export function useCheckForUpdates() {
    return useMutation<AppUpdate | undefined, Error, void>({
        mutationFn: checkAppUpdate, onError: error => toast.error(error.message),
    })
}

/** Download → check → installer; the state follows from useAppDownloadState. */
export function useDownloadAppUpdate() {
    return useMutation<AppDownloadState, Error, void>({
        mutationFn: downloadAppUpdate, onError: error => toast.error(error.message),
    })
}

export function useAppDownloadState(): AppDownloadState {
    return React.useSyncExternalStore(subscribeAppDownload, readAppDownload, readAppDownload)
}

export { acknowledgeInstalledUpdate, openDownloadedApk }
