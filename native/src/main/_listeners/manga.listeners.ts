import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { WSEvents } from "@/lib/server/ws-events"
import { useWebsocketMessageListener } from "@/main/_hooks/handle-websockets"
import { useQueryClient } from "@tanstack/react-query"

/** Re-fetches the manga download queries when chapters were downloaded or the queue changed, 1:1 web _listeners/manga.listeners.ts. */
export function useMangaListener() {
    const qc = useQueryClient()

    useWebsocketMessageListener<number>({
        type: WSEvents.REFRESHED_MANGA_DOWNLOAD_DATA,
        onMessage: () => {
            // not GetMangaDownloadData: the web app notes that it loops
            void qc.invalidateQueries({ queryKey: [API_ENDPOINTS.MANGA_DOWNLOAD.GetMangaDownloadsList.key] })
        },
    })

    useWebsocketMessageListener({
        type: WSEvents.CHAPTER_DOWNLOAD_QUEUE_UPDATED,
        onMessage: () => {
            (async () => {
                await qc.invalidateQueries({ queryKey: [API_ENDPOINTS.MANGA_DOWNLOAD.GetMangaDownloadData.key] })
                await qc.invalidateQueries({ queryKey: [API_ENDPOINTS.MANGA_DOWNLOAD.GetMangaDownloadQueue.key] })
                await qc.invalidateQueries({ queryKey: [API_ENDPOINTS.MANGA_DOWNLOAD.GetMangaDownloadsList.key] })
            })()
        },
    })
}
