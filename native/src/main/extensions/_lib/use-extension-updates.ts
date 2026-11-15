// geschrieben nach: extension-updates.ts, extensions.hooks.ts (useGetAllExtensions, useGetExtensionUpdateData) und collection-loaders.ts

import { useServerQuery } from "@/api/client/requests"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import type { GetAllExtensions_Variables } from "@/api/generated/endpoint.types"
import type { ExtensionRepo_AllExtensions } from "@/api/generated/types"
import { useGetExtensionUpdateData } from "@/api/hooks/extensions.hooks"
import { MENU_ENTRIES } from "@/lib/nav/nav-items"
import { atomWithStorage } from "@/lib/storage"
import { useQueryClient } from "@tanstack/react-query"
import { useAtom } from "jotai"
import React from "react"
import { extensionUpdateCount, isUpdateCheckDue } from "./extension-updates"

const EXTENSIONS_READY = MENU_ENTRIES.some(entry => entry.id === "extensions" && entry.ready)

/** When the start's update check last answered (ms) */
const lastUpdateCheckAtom = atomWithStorage<number>("sea-extensions-last-update-check", 0)

/** The core found these to have a newer version on the web (GET /extensions/updates) */
export function useExtensionUpdateCount(): number {
    const { data } = useGetExtensionUpdateData()
    return extensionUpdateCount(data)
}

/** After a check (start or the Extensions screen) the count is read again from the core. */
export function useRefreshExtensionUpdateCount() {
    const queryClient = useQueryClient()
    return React.useCallback(() => void queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.EXTENSIONS.GetExtensionUpdateData.key] }), [queryClient])
}

/** Mounted once in the main layout: at most one update check a day at start (rules in extension-updates.ts). */
export function useDailyExtensionUpdateCheck() {
    const [lastCheckedAt, setLastCheckedAt] = useAtom(lastUpdateCheckAtom)
    // decided once per start, so the answer's new time does not end the query that brought it
    const [due] = React.useState(() => EXTENSIONS_READY && isUpdateCheckDue(lastCheckedAt, Date.now()))
    const refreshCount = useRefreshExtensionUpdateCount()
    const { isSuccess, dataUpdatedAt } = useServerQuery<ExtensionRepo_AllExtensions, GetAllExtensions_Variables>({
        endpoint: API_ENDPOINTS.EXTENSIONS.GetAllExtensions.endpoint,
        method: API_ENDPOINTS.EXTENSIONS.GetAllExtensions.methods[0],
        // the Extensions screen's key with updates: its list is this answer when it opens soon after
        queryKey: [API_ENDPOINTS.EXTENSIONS.GetAllExtensions.key, true],
        data: { withUpdates: true },
        enabled: due,
        muteError: true,
        staleTime: Infinity,
    })
    React.useEffect(() => {
        if (!due || !isSuccess) return
        setLastCheckedAt(Date.now())
        refreshCount()
    }, [due, isSuccess, dataUpdatedAt, setLastCheckedAt, refreshCount])
}
