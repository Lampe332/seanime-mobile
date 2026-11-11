import { buildSeaQuery, useServerMutation, useServerQuery } from "@/api/client/requests"
import {
    MobileOfflineAction_Variables,
    MobileOfflineBatch_Variables,
    MobileOfflineCacheManga_Variables,
    MobileOfflineDownload_Variables,
    MobileOfflineNetwork_Variables,
    MobileOfflinePosition_Variables,
    MobileOfflineSettings_Variables,
} from "@/api/generated/endpoint.types"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { MobileOffline_Details, MobileOffline_Item, MobileOffline_Snapshot } from "@/api/generated/types"
import { MOBILE_OFFLINE_EVENT, networkReport } from "@/api/hooks/mobile_offline.helpers"
import { serverAuthTokenAtom } from "@/main/_atoms/server-status.atoms"
import { useWebsocketMessageListener } from "@/main/_hooks/handle-websockets"
import { websocketConnectedAtom } from "@/main/websocket-provider"
import NetInfo from "@react-native-community/netinfo"
import { useQueryClient } from "@tanstack/react-query"
import { useAtomValue } from "jotai"
import { useEffect } from "react"

// Episode downloads run in the Go server (backend/internal/mobileoffline): queue, files, artwork, "Wi-Fi only".
// The app only shows them and reports the network.

const snapshotKey = [API_ENDPOINTS.MOBILE_OFFLINE.GetMobileOfflineSnapshot.key]

export function useGetMobileOfflineSnapshot() {
    return useServerQuery<MobileOffline_Snapshot>({
        endpoint: API_ENDPOINTS.MOBILE_OFFLINE.GetMobileOfflineSnapshot.endpoint,
        method: API_ENDPOINTS.MOBILE_OFFLINE.GetMobileOfflineSnapshot.methods[0],
        queryKey: snapshotKey,
        enabled: true,
    })
}

/** Keeps the snapshot query current from the server's "mobile-offline-updated" events. */
export function useMobileOfflineLiveSnapshot() {
    const queryClient = useQueryClient()
    useWebsocketMessageListener<MobileOffline_Snapshot>({
        type: MOBILE_OFFLINE_EVENT,
        onMessage: snapshot => queryClient.setQueryData(snapshotKey, snapshot),
    })
}

function useInvalidateSnapshot() {
    const queryClient = useQueryClient()
    return () => queryClient.invalidateQueries({ queryKey: snapshotKey })
}

/** Queues episodes (one, a season, the missing ones); returns how many were added. */
export function useMobileOfflineBatch() {
    const invalidate = useInvalidateSnapshot()
    return useServerMutation<number, MobileOfflineBatch_Variables>({
        endpoint: API_ENDPOINTS.MOBILE_OFFLINE.MobileOfflineBatch.endpoint,
        method: API_ENDPOINTS.MOBILE_OFFLINE.MobileOfflineBatch.methods[0],
        mutationKey: [API_ENDPOINTS.MOBILE_OFFLINE.MobileOfflineBatch.key],
        onSuccess: invalidate,
    })
}

/** Saves the episode the player has open (its provider URL, never one with the app's token). */
export function useMobileOfflineDownload() {
    const invalidate = useInvalidateSnapshot()
    return useServerMutation<MobileOffline_Item, MobileOfflineDownload_Variables>({
        endpoint: API_ENDPOINTS.MOBILE_OFFLINE.MobileOfflineDownload.endpoint,
        method: API_ENDPOINTS.MOBILE_OFFLINE.MobileOfflineDownload.methods[0],
        mutationKey: [API_ENDPOINTS.MOBILE_OFFLINE.MobileOfflineDownload.key],
        onSuccess: invalidate,
    })
}

/** action: pause, resume, retry, remove. */
export function useMobileOfflineAction() {
    const invalidate = useInvalidateSnapshot()
    return useServerMutation<boolean, MobileOfflineAction_Variables>({
        endpoint: API_ENDPOINTS.MOBILE_OFFLINE.MobileOfflineAction.endpoint,
        method: API_ENDPOINTS.MOBILE_OFFLINE.MobileOfflineAction.methods[0],
        mutationKey: [API_ENDPOINTS.MOBILE_OFFLINE.MobileOfflineAction.key],
        onSuccess: invalidate,
    })
}

export function useMobileOfflineSettings() {
    const invalidate = useInvalidateSnapshot()
    return useServerMutation<boolean, MobileOfflineSettings_Variables>({
        endpoint: API_ENDPOINTS.MOBILE_OFFLINE.MobileOfflineSettings.endpoint,
        method: API_ENDPOINTS.MOBILE_OFFLINE.MobileOfflineSettings.methods[0],
        mutationKey: [API_ENDPOINTS.MOBILE_OFFLINE.MobileOfflineSettings.key],
        onSuccess: invalidate,
    })
}

export function useMobileOfflinePosition() {
    return useServerMutation<boolean, MobileOfflinePosition_Variables>({
        endpoint: API_ENDPOINTS.MOBILE_OFFLINE.MobileOfflinePosition.endpoint,
        method: API_ENDPOINTS.MOBILE_OFFLINE.MobileOfflinePosition.methods[0],
        mutationKey: [API_ENDPOINTS.MOBILE_OFFLINE.MobileOfflinePosition.key],
    })
}

/** Saves a manga's descriptions and cover for the offline list (chapters: manga_download.hooks). */
export function useMobileOfflineCacheManga() {
    return useServerMutation<MobileOffline_Details, MobileOfflineCacheManga_Variables>({
        endpoint: API_ENDPOINTS.MOBILE_OFFLINE.MobileOfflineCacheManga.endpoint,
        method: API_ENDPOINTS.MOBILE_OFFLINE.MobileOfflineCacheManga.methods[0],
        mutationKey: [API_ENDPOINTS.MOBILE_OFFLINE.MobileOfflineCacheManga.key],
    })
}

/**
 * Reports the connection to the server whenever it changes, so "Wi-Fi only" stops downloads on mobile data. Mount once
 * at the app root (the server cannot see Android's network state itself).
 */
export function useReportNetworkToServer() {
    const password = useAtomValue(serverAuthTokenAtom)
    // A restarted server knows no network until it is told again ("Wi-Fi only" waits until then); the socket connects
    // once the server is up, and NetInfo hands a new listener the current state right away.
    const connected = useAtomValue(websocketConnectedAtom)
    useEffect(() => {
        if (!connected) return
        return NetInfo.addEventListener(state => {
            void buildSeaQuery<boolean, MobileOfflineNetwork_Variables>({
                endpoint: API_ENDPOINTS.MOBILE_OFFLINE.MobileOfflineNetwork.endpoint,
                method: API_ENDPOINTS.MOBILE_OFFLINE.MobileOfflineNetwork.methods[0],
                data: networkReport(state),
                password,
            }).catch(() => undefined)
        })
    }, [password, connected])
}
