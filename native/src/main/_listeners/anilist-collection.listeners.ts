import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { WSEvents } from "@/lib/server/ws-events"
import { useWebsocketMessageListener } from "@/main/_hooks/handle-websockets"
import { useQueryClient } from "@tanstack/react-query"

/** Re-fetches the AniList collection queries after the server refreshed them, 1:1 web _listeners/anilist-collection.listeners.ts. */
export function useAnimeCollectionListener() {
    const qc = useQueryClient()

    useWebsocketMessageListener({
        type: WSEvents.REFRESHED_ANILIST_ANIME_COLLECTION,
        onMessage: () => {
            (async () => {
                await qc.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_COLLECTION.GetLibraryCollection.key] })
                await qc.invalidateQueries({ queryKey: [API_ENDPOINTS.ANILIST.GetAnimeCollection.key] })
                await qc.invalidateQueries({ queryKey: [API_ENDPOINTS.ANILIST.GetRawAnimeCollection.key] })
                await qc.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntry.key] })
                await qc.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_ENTRIES.GetMissingEpisodes.key] })
                await qc.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_COLLECTION.GetAnimeCollectionSchedule.key] })
                await qc.invalidateQueries({ queryKey: [API_ENDPOINTS.LIBRARY_EXPLORER.GetLibraryExplorerFileTree.key] })
            })()
        },
    })

    useWebsocketMessageListener({
        type: WSEvents.REFRESHED_ANILIST_MANGA_COLLECTION,
        onMessage: () => {
            (async () => {
                await qc.invalidateQueries({ queryKey: [API_ENDPOINTS.MANGA.GetRawAnilistMangaCollection.key] })
                await qc.invalidateQueries({ queryKey: [API_ENDPOINTS.MANGA.GetMangaCollection.key] })
                await qc.invalidateQueries({ queryKey: [API_ENDPOINTS.MANGA.GetMangaEntry.key] })
            })()
        },
    })
}
