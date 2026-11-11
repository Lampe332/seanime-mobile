import { WSEvents } from "@/lib/server/ws-events"
import { useWebsocketMessageListener } from "@/main/_hooks/handle-websockets"
import { useQueryClient } from "@tanstack/react-query"

/** The server names queries that changed (scan, settings, playback …); 1:1 web _listeners/invalidate-queries.listeners.ts. */
export function useInvalidateQueriesListener() {
    const qc = useQueryClient()

    useWebsocketMessageListener<string[]>({
        type: WSEvents.INVALIDATE_QUERIES,
        onMessage: async data => {
            await Promise.all((data ?? []).map(queryKey => qc.invalidateQueries({ queryKey: [queryKey] })))
        },
    })
}
