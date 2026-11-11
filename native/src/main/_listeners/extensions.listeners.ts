import { API_ENDPOINTS } from "@/api/generated/endpoints"
import type { ExtensionRepo_UpdateData } from "@/api/generated/types"
import { WSEvents } from "@/lib/server/ws-events"
import { useWebsocketMessageListener } from "@/main/_hooks/handle-websockets"
import { useQueryClient } from "@tanstack/react-query"

/**
 * Re-fetches the extension queries when the server reloads its extensions (install, update, remove), 1:1 web
 * _listeners/extensions.listeners.ts. The install/uninstall hooks leave the refetch to this listener.
 */
export function useExtensionListener() {
    const qc = useQueryClient()

    useWebsocketMessageListener<number>({
        type: WSEvents.EXTENSIONS_RELOADED,
        onMessage: () => {
            (async () => {
                await qc.invalidateQueries({ queryKey: [API_ENDPOINTS.EXTENSIONS.ListAnimeTorrentProviderExtensions.key] })
                await qc.invalidateQueries({ queryKey: [API_ENDPOINTS.EXTENSIONS.ListMangaProviderExtensions.key] })
                await qc.invalidateQueries({ queryKey: [API_ENDPOINTS.EXTENSIONS.ListOnlinestreamProviderExtensions.key] })
                await qc.invalidateQueries({ queryKey: [API_ENDPOINTS.EXTENSIONS.ListExtensionData.key] })
                await qc.invalidateQueries({ queryKey: [API_ENDPOINTS.EXTENSIONS.GetAllExtensions.key] })
                await qc.invalidateQueries({ queryKey: [API_ENDPOINTS.EXTENSIONS.GetExtensionUserConfig.key] })
                await qc.invalidateQueries({ queryKey: [API_ENDPOINTS.EXTENSIONS.GetExtensionUpdateData.key] })
                await qc.invalidateQueries({ queryKey: [API_ENDPOINTS.EXTENSIONS.ListDevelopmentModeExtensions.key] })
                // installing/removing an extension can lock or unlock content (status.contentLocked)
                await qc.invalidateQueries({ queryKey: [API_ENDPOINTS.STATUS.GetStatus.key] })
            })()
        },
    })

    useWebsocketMessageListener<number>({
        type: WSEvents.PLUGIN_UNLOADED,
        onMessage: () => {
            void qc.invalidateQueries({ queryKey: [API_ENDPOINTS.EXTENSIONS.ListDevelopmentModeExtensions.key] })
        },
    })

    useWebsocketMessageListener<ExtensionRepo_UpdateData[]>({
        type: WSEvents.EXTENSION_UPDATES_FOUND,
        onMessage: async () => {
            await qc.invalidateQueries({ queryKey: [API_ENDPOINTS.EXTENSIONS.GetExtensionUpdateData.key] })
            await qc.invalidateQueries({ queryKey: [API_ENDPOINTS.EXTENSIONS.GetAllExtensions.key] })
        },
    })
}
