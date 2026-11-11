import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { toast } from "@/components/ui/toast/toast-store"
import { WSEvents } from "@/lib/server/ws-events"
import { isLoginModalOpenAtom } from "@/main/_atoms/server-status.atoms"
import { useWebsocketMessageListener } from "@/main/_hooks/handle-websockets"
import { useQueryClient } from "@tanstack/react-query"
import { useSetAtom } from "jotai"

/** The server lost the AniList login: refetch the status (now logged out) and offer the login, 1:1 web _listeners/auth.listeners.ts. */
export function useAuthEventListeners() {
    const qc = useQueryClient()
    const setLoginModalOpen = useSetAtom(isLoginModalOpenAtom)

    useWebsocketMessageListener<string>({
        type: WSEvents.SERVER_LOGGED_OUT_ANILIST,
        onMessage: async message => {
            await qc.invalidateQueries({ queryKey: [API_ENDPOINTS.STATUS.GetStatus.key] })
            if (message) toast.warning(message)
            setTimeout(() => setLoginModalOpen(true), 1000)
        },
    })
}
