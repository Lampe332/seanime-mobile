import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { useGetAutoDownloaderItems } from "@/api/hooks/auto_downloader.hooks"
import { autoDownloaderItemsAtom } from "@/app/(main)/_atoms/autodownloader.atoms"
import { useWebsocketMessageListener } from "@/app/(main)/_hooks/handle-websockets"
import { usePathname } from "@/lib/navigation"
import { WSEvents } from "@/lib/server/ws-events"
import { useQueryClient } from "@tanstack/react-query"
import { useSetAtom } from "jotai/react"
import { useEffect } from "react"

const IS_ANDROID_APP = import.meta.env.SEA_PUBLIC_PLATFORM === "mobile"

/**
 * @description
 * - When the user is not on the main page, send a request to get auto downloader queue items
 */
export function useAutoDownloaderItemListener() {
    const pathname = usePathname()
    const setter = useSetAtom(autoDownloaderItemsAtom)
    const qc = useQueryClient()

    // Android has no Auto Downloader (the server answers 500 "feature disabled")
    const { data } = useGetAutoDownloaderItems(pathname !== "/auto-downloader" && !IS_ANDROID_APP)

    useWebsocketMessageListener<string>({
        type: WSEvents.AUTO_DOWNLOADER_ITEM_ADDED,
        onMessage: data => {
            qc.invalidateQueries({ queryKey: [API_ENDPOINTS.AUTO_DOWNLOADER.GetAutoDownloaderItems.key] })
        },
    })

    useEffect(() => {
        setter(data ?? [])
    }, [data])

    return null
}
