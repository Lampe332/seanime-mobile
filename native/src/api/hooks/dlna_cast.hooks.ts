import { useServerMutation, useServerQuery } from "@/api/client/requests"
import {
    DlnaCastControl_Variables,
    DlnaCastLoad_Variables,
    DlnaCastStart_Variables,
    DlnaCastStop_Variables,
    DlnaCastSwitchStream_Variables,
} from "@/api/generated/endpoint.types"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { DlnaCast_Current } from "@/api/generated/types"
import { DLNA_CAST_EVENT, DlnaCastEvent } from "@/api/hooks/dlna_cast.helpers"
import { useWebsocketMessageListener } from "@/main/_hooks/handle-websockets"

// DLNA casting runs in the Go server (backend/internal/dlnacast). Every call returns at once; the results arrive as
// "dlna-cast" events (useDlnaCastEvents). Google Cast is a separate library (react-native-google-cast).

export function useDlnaCastDiscover() {
    return useServerMutation<boolean>({
        endpoint: API_ENDPOINTS.DLNA_CAST.DlnaCastDiscover.endpoint,
        method: API_ENDPOINTS.DLNA_CAST.DlnaCastDiscover.methods[0],
        mutationKey: [API_ENDPOINTS.DLNA_CAST.DlnaCastDiscover.key],
    })
}

/** url: a stream of this server (127.0.0.1), see castStreamUrl for the tracks. */
export function useDlnaCastStart() {
    return useServerMutation<boolean, DlnaCastStart_Variables>({
        endpoint: API_ENDPOINTS.DLNA_CAST.DlnaCastStart.endpoint,
        method: API_ENDPOINTS.DLNA_CAST.DlnaCastStart.methods[0],
        mutationKey: [API_ENDPOINTS.DLNA_CAST.DlnaCastStart.key],
    })
}

export function useDlnaCastSwitchStream() {
    return useServerMutation<boolean, DlnaCastSwitchStream_Variables>({
        endpoint: API_ENDPOINTS.DLNA_CAST.DlnaCastSwitchStream.endpoint,
        method: API_ENDPOINTS.DLNA_CAST.DlnaCastSwitchStream.methods[0],
        mutationKey: [API_ENDPOINTS.DLNA_CAST.DlnaCastSwitchStream.key],
    })
}

export function useDlnaCastLoad() {
    return useServerMutation<boolean, DlnaCastLoad_Variables>({
        endpoint: API_ENDPOINTS.DLNA_CAST.DlnaCastLoad.endpoint,
        method: API_ENDPOINTS.DLNA_CAST.DlnaCastLoad.methods[0],
        mutationKey: [API_ENDPOINTS.DLNA_CAST.DlnaCastLoad.key],
    })
}

/** action: play, pause, seek (value = ms), skip (value = ±ms), volume (value = percent). */
export function useDlnaCastControl() {
    return useServerMutation<boolean, DlnaCastControl_Variables>({
        endpoint: API_ENDPOINTS.DLNA_CAST.DlnaCastControl.endpoint,
        method: API_ENDPOINTS.DLNA_CAST.DlnaCastControl.methods[0],
        mutationKey: [API_ENDPOINTS.DLNA_CAST.DlnaCastControl.key],
    })
}

export function useDlnaCastStatus() {
    return useServerMutation<boolean>({
        endpoint: API_ENDPOINTS.DLNA_CAST.DlnaCastStatus.endpoint,
        method: API_ENDPOINTS.DLNA_CAST.DlnaCastStatus.methods[0],
        mutationKey: [API_ENDPOINTS.DLNA_CAST.DlnaCastStatus.key],
    })
}

export function useDlnaCastStop() {
    return useServerMutation<boolean, DlnaCastStop_Variables>({
        endpoint: API_ENDPOINTS.DLNA_CAST.DlnaCastStop.endpoint,
        method: API_ENDPOINTS.DLNA_CAST.DlnaCastStop.methods[0],
        mutationKey: [API_ENDPOINTS.DLNA_CAST.DlnaCastStop.key],
    })
}

/** The TV in use (null when nothing casts), e.g. after the app restarted while casting. */
export function useGetDlnaCastCurrent(enabled: boolean = true) {
    return useServerQuery<DlnaCast_Current | null>({
        endpoint: API_ENDPOINTS.DLNA_CAST.DlnaCastCurrent.endpoint,
        method: API_ENDPOINTS.DLNA_CAST.DlnaCastCurrent.methods[0],
        queryKey: [API_ENDPOINTS.DLNA_CAST.DlnaCastCurrent.key],
        enabled,
    })
}

export function useDlnaCastEvents(onEvent: (event: DlnaCastEvent) => void, deps: any[] = []) {
    useWebsocketMessageListener<DlnaCastEvent>({ type: DLNA_CAST_EVENT, onMessage: onEvent, deps })
}
