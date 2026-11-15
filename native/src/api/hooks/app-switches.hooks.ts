// geschrieben nach: continuity.hooks.ts (Form der Abfragen) und den Kern-Routen core/settings/incognito.ts, core/playback/playback.ts (History)

import { useServerMutation, useServerQuery } from "@/api/client/requests"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import type { AL_BaseAnime } from "@/api/generated/types"
import { useQueryClient } from "@tanstack/react-query"

/** The app's own switches (core/settings/incognito.ts) */
export type AppSwitches = { incognitoMode: boolean, deleteWatchedEpisodes: "" | "watched" | "keep-one", prefetchEpisodes: 0 | 1 | 2 | 3 }

const SWITCHES = API_ENDPOINTS.APP_SWITCHES

export function useAppSwitches() {
    return useServerQuery<AppSwitches>({
        endpoint: SWITCHES.GetAppSwitches.endpoint,
        method: SWITCHES.GetAppSwitches.methods[0],
        queryKey: [SWITCHES.GetAppSwitches.key],
        enabled: true,
    })
}

/** Incognito mode as shown: off until the switches are read */
export function useIncognito(): boolean {
    return useAppSwitches().data?.incognitoMode === true
}

/** Changes switches; the cache takes the answer, so every screen follows at once */
export function useSetAppSwitches() {
    const qc = useQueryClient()
    return useServerMutation<AppSwitches, Partial<AppSwitches>>({
        endpoint: SWITCHES.PatchAppSwitches.endpoint,
        method: SWITCHES.PatchAppSwitches.methods[0],
        mutationKey: [SWITCHES.PatchAppSwitches.key],
        onSuccess: data => {
            if (data) qc.setQueryData([SWITCHES.GetAppSwitches.key], data)
        },
    })
}

const HISTORY = API_ENDPOINTS.CONTINUITY

/** The titles of the history by AniList number (anime and manga), as the core keeps them */
export function useHistoryMedia(ids: number[]) {
    return useServerQuery<Record<string, AL_BaseAnime>, { ids: number[] }>({
        endpoint: HISTORY.GetHistoryMedia.endpoint,
        method: HISTORY.GetHistoryMedia.methods[0],
        queryKey: [HISTORY.GetHistoryMedia.key, ids.join(",")],
        data: { ids },
        enabled: ids.length > 0,
    })
}

function useRefreshHistory() {
    const qc = useQueryClient()
    return () => {
        void qc.invalidateQueries({ queryKey: [HISTORY.GetContinuityWatchHistory.key] })
        void qc.invalidateQueries({ queryKey: [HISTORY.GetContinuityWatchHistoryItem.key] })
    }
}

/** Takes one anime out of the watch history (never AniList) */
export function useRemoveWatchHistoryItem() {
    const refresh = useRefreshHistory()
    return useServerMutation<boolean, { mediaId: number }>({
        endpoint: HISTORY.DeleteContinuityWatchHistoryItem.endpoint,
        method: HISTORY.DeleteContinuityWatchHistoryItem.methods[0],
        mutationKey: [HISTORY.DeleteContinuityWatchHistoryItem.key],
        onSuccess: refresh,
    })
}

/** "Clear history" of the anime (never AniList) */
export function useClearWatchHistory() {
    const refresh = useRefreshHistory()
    return useServerMutation<boolean>({
        endpoint: HISTORY.ClearContinuityWatchHistory.endpoint,
        method: HISTORY.ClearContinuityWatchHistory.methods[0],
        mutationKey: [HISTORY.ClearContinuityWatchHistory.key],
        onSuccess: refresh,
    })
}
