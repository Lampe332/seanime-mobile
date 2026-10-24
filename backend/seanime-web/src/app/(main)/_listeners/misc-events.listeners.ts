import { useWebsocketMessageListener } from "@/app/(main)/_hooks/handle-websockets"
import { tr } from "@/lib/app-language"
import { WSEvents } from "@/lib/server/ws-events"
import { toast } from "sonner"

/** The server's Nakama messages in the phone's language and in words a phone user can act on; others as they come. */
export function phoneToastText(message: string) {
    switch (message) {
        case "Sending stream to player...":
            return tr("Sending stream to player…", "Stream wird an den Player gesendet …")
        case "Failed to connect to Nakama host after multiple attempts.":
            return tr("Can't reach the Nakama host. The app keeps trying once a minute.",
                "Der Nakama-Host ist nicht erreichbar. Die App versucht es jede Minute weiter.")
    }
    return message
}

export function useMiscEventListeners() {

    useWebsocketMessageListener<string>({
        type: WSEvents.INFO_TOAST, onMessage: data => {
            if (!!data) {
                toast.info(phoneToastText(data))
            }
        },
    })

    useWebsocketMessageListener<string>({
        type: WSEvents.SUCCESS_TOAST, onMessage: data => {
            if (!!data) {
                toast.success(data)
            }
        },
    })

    useWebsocketMessageListener<string>({
        type: WSEvents.WARNING_TOAST, onMessage: data => {
            if (!!data) {
                toast.warning(data)
            }
        },
    })

    useWebsocketMessageListener<string>({
        type: WSEvents.ERROR_TOAST, onMessage: data => {
            if (!!data) {
                toast.error(phoneToastText(data))
            }
        },
    })

    useWebsocketMessageListener<string>({
        type: WSEvents.CONSOLE_LOG, onMessage: data => {
            console.log(data)
        },
    })

    useWebsocketMessageListener<string>({
        type: WSEvents.CONSOLE_WARN, onMessage: data => {
            console.warn(data)
        },
    })

}
