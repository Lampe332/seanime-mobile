import { toast } from "@/components/ui/toast/toast-store"
import { useTr } from "@/lib/app-language"
import { WSEvents } from "@/lib/server/ws-events"
import { useWebsocketMessageListener } from "@/main/_hooks/handle-websockets"
import { phoneToastText } from "./phone-toast-text"

/**
 * The server's own toasts and console lines (web _listeners/misc-events.listeners.ts), once in the main layout. The
 * Nakama host's messages come in the app's language (phone-toast-text.ts).
 */
export function useMiscEventListeners() {
    const t = useTr()

    useWebsocketMessageListener<string>({
        type: WSEvents.INFO_TOAST, onMessage: data => {
            if (data) toast.info(phoneToastText(data, t))
        },
    })
    useWebsocketMessageListener<string>({
        type: WSEvents.SUCCESS_TOAST, onMessage: data => {
            if (data) toast.success(data)
        },
    })
    useWebsocketMessageListener<string>({
        type: WSEvents.WARNING_TOAST, onMessage: data => {
            if (data) toast.warning(data)
        },
    })
    useWebsocketMessageListener<string>({
        type: WSEvents.ERROR_TOAST, onMessage: data => {
            if (data) toast.error(phoneToastText(data, t))
        },
    })
    useWebsocketMessageListener<string>({
        type: WSEvents.CONSOLE_LOG, onMessage: data => console.log(data),
    })
    useWebsocketMessageListener<string>({
        type: WSEvents.CONSOLE_WARN, onMessage: data => console.warn(data),
    })
}
