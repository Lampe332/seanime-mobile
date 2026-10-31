import { SeaError, useServerMutation, useServerQuery } from "@/api/client/requests"
import { TorrentClientAction_Variables, TorrentClientDownload_Variables, TorrentClientGetFiles_Variables } from "@/api/generated/endpoint.types"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { HibikeTorrent_AnimeTorrent, Nullish, TorrentClient_Torrent } from "@/api/generated/types"
import { useQueryClient } from "@tanstack/react-query"
import React from "react"
import { toast } from "sonner"
import { tr } from "@/lib/app-language"
import { successFeedback } from "@/lib/feedback"

export function useGetActiveTorrentList(enabled: boolean, category: string, sort: string) {
    const query = React.useMemo(() => {
        if (!category && !sort) return ""
        let q = "?"
        if (category) q += `category=${category}&`
        if (sort) q += `sort=${sort}`
        return q
    }, [category, sort])
    return useServerQuery<Array<TorrentClient_Torrent>>({
        endpoint: API_ENDPOINTS.TORRENT_CLIENT.GetActiveTorrentList.endpoint + query,
        method: API_ENDPOINTS.TORRENT_CLIENT.GetActiveTorrentList.methods[0],
        queryKey: [API_ENDPOINTS.TORRENT_CLIENT.GetActiveTorrentList.key, category, sort],
        refetchInterval: 1500,
        gcTime: 0,
        enabled: enabled,
    })
}

export function useTorrentClientAction(onSuccess?: (variables: TorrentClientAction_Variables) => void) {
    const queryClient = useQueryClient()

    return useServerMutation<boolean, TorrentClientAction_Variables>({
        endpoint: API_ENDPOINTS.TORRENT_CLIENT.TorrentClientAction.endpoint,
        method: API_ENDPOINTS.TORRENT_CLIENT.TorrentClientAction.methods[0],
        mutationKey: [API_ENDPOINTS.TORRENT_CLIENT.TorrentClientAction.key],
        onSuccess: async (data, variables) => {
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.TORRENT_CLIENT.GetActiveTorrentList.key] })

            if (variables.action === "set-limits") {
                await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.STATUS.GetStatus.key] })
                toast.success("Global speed limits updated")
            } else if (variables.action === "move-storage") {
                toast.success("Torrent files moved successfully")
            } else if (variables.action === "rename") {
                toast.success("Torrent renamed")
            } else if (variables.action === "add-magnet") {
                toast.success("Magnet link added")
            } else if (variables.action === "reannounce") {
                toast.success("Reannounced to trackers")
            } else if (variables.action === "add-tracker") {
                toast.success("Tracker added")
            } else if (variables.action === "remove-tracker") {
                toast.success("Tracker removed")
            }

            onSuccess?.(variables)
        },
    })
}

/** onError replaces the default error toast (the phone words it itself) */
export function useTorrentClientDownload(onSuccess?: () => void, onError?: (error: SeaError) => void) {
    return useServerMutation<boolean, TorrentClientDownload_Variables>({
        endpoint: API_ENDPOINTS.TORRENT_CLIENT.TorrentClientDownload.endpoint,
        method: API_ENDPOINTS.TORRENT_CLIENT.TorrentClientDownload.methods[0],
        mutationKey: [API_ENDPOINTS.TORRENT_CLIENT.TorrentClientDownload.key],
        onSuccess: async () => {
            toast.success(tr("Download started", "Download gestartet"))
            successFeedback()
            onSuccess?.()
        },
        ...(onError ? { onError } : {}),
    })
}

export function useTorrentClientGetFiles({ torrent, provider }: { torrent: Nullish<HibikeTorrent_AnimeTorrent>, provider: Nullish<string> }) {
    return useServerQuery<Array<string>, TorrentClientGetFiles_Variables>({
        endpoint: API_ENDPOINTS.TORRENT_CLIENT.TorrentClientGetFiles.endpoint,
        method: API_ENDPOINTS.TORRENT_CLIENT.TorrentClientGetFiles.methods[0],
        queryKey: [API_ENDPOINTS.TORRENT_CLIENT.TorrentClientGetFiles.key, torrent, provider],
        enabled: !!torrent && !!provider,
        data: {
            torrent: torrent!,
            provider: provider!,
        },
    })
}
