import type { Translate } from "@/lib/app-language"

/**
 * The server's Nakama messages in the app's language and in words a phone user can act on; others as they come
 * (web misc-events.listeners.ts phoneToastText, fix cbddc39: the host's toasts in the app's language).
 */
export function phoneToastText(message: string, t: Translate) {
    switch (message) {
        case "Sending stream to player...":
            return t("Sending stream to player…", "Stream wird an den Player gesendet …")
        case "Failed to connect to Nakama host after multiple attempts.":
            return t("Can't reach the Nakama host. The app keeps trying once a minute.",
                "Der Nakama-Host ist nicht erreichbar. Die App versucht es jede Minute weiter.")
    }
    return message
}
