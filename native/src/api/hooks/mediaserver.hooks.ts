// geschrieben nach: nakama.hooks.ts und app-switches.hooks.ts; die Routen sind core/jellyfin/server-settings.ts

import { useQueryClient } from "@tanstack/react-query"
import { useServerMutation, useServerQuery } from "../client/requests"

/*
 * The media server (Jellyfin) of the settings page. Its routes are the app's own, so they have their own list here
 * instead of the generated endpoints.ts (core.test.ts reads both).
 */

export const MEDIASERVER_ENDPOINTS = {
    GetMediaServerStatus: { key: "MEDIASERVER-get-status", methods: ["GET"] as const, endpoint: "/api/v1/mediaserver/status" },
    MediaServerLogin: { key: "MEDIASERVER-login", methods: ["POST"] as const, endpoint: "/api/v1/mediaserver/login" },
    MediaServerLogout: { key: "MEDIASERVER-logout", methods: ["POST"] as const, endpoint: "/api/v1/mediaserver/logout" },
    MediaServerRefresh: { key: "MEDIASERVER-refresh", methods: ["POST"] as const, endpoint: "/api/v1/mediaserver/refresh" },
    SaveMediaServerSettings: { key: "MEDIASERVER-save-settings", methods: ["PATCH"] as const, endpoint: "/api/v1/mediaserver/settings" },
}

/** What the settings page shows (core/jellyfin/source.ts `ServerOverview`); never carries token or password */
export type MediaServerStatus = {
    signedIn: boolean
    serverName: string
    username: string
    url: string
    sendProgress: boolean
    reading: boolean
    series: number
    matched: number
    unmatched: { seriesId: string, name: string, year: number, suggestion: { anilistId: number, title: string } | null }[]
    lastReadAt: number | null
    /** "unreachable", "rejected", "failed" or empty */
    problem: string
}

export type MediaServerLogin_Variables = { url: string, username: string, password: string }

const E = MEDIASERVER_ENDPOINTS

export function useMediaServerStatus() {
    return useServerQuery<MediaServerStatus>({
        endpoint: E.GetMediaServerStatus.endpoint,
        method: E.GetMediaServerStatus.methods[0],
        queryKey: [E.GetMediaServerStatus.key],
        enabled: true,
    })
}

/** The answer of every change is the new status; it replaces the kept one */
function useKeepStatus() {
    const queryClient = useQueryClient()
    return (status: MediaServerStatus | undefined) => {
        if (status) queryClient.setQueryData([E.GetMediaServerStatus.key], status)
        else void queryClient.invalidateQueries({ queryKey: [E.GetMediaServerStatus.key] })
    }
}

export function useMediaServerLogin() {
    const keep = useKeepStatus()
    return useServerMutation<MediaServerStatus, MediaServerLogin_Variables>({
        endpoint: E.MediaServerLogin.endpoint,
        method: E.MediaServerLogin.methods[0],
        mutationKey: [E.MediaServerLogin.key],
        onSuccess: async data => keep(data),
        // the settings page shows why under the fields, in the app's language: no toast with the core's English text
        onError: async () => undefined,
    })
}

export function useMediaServerLogout() {
    const keep = useKeepStatus()
    return useServerMutation<MediaServerStatus>({
        endpoint: E.MediaServerLogout.endpoint,
        method: E.MediaServerLogout.methods[0],
        mutationKey: [E.MediaServerLogout.key],
        onSuccess: async data => keep(data),
    })
}

export function useMediaServerRefresh() {
    const keep = useKeepStatus()
    return useServerMutation<MediaServerStatus>({
        endpoint: E.MediaServerRefresh.endpoint,
        method: E.MediaServerRefresh.methods[0],
        mutationKey: [E.MediaServerRefresh.key],
        onSuccess: async data => keep(data),
        // a failed reading keeps the old series; the status then carries why
        onError: async () => keep(undefined),
    })
}

export function useSaveMediaServerSettings() {
    const keep = useKeepStatus()
    return useServerMutation<MediaServerStatus, { sendProgress: boolean }>({
        endpoint: E.SaveMediaServerSettings.endpoint,
        method: E.SaveMediaServerSettings.methods[0],
        mutationKey: [E.SaveMediaServerSettings.key],
        onSuccess: async data => keep(data),
    })
}
