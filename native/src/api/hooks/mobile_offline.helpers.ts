import type { MobileOffline_Failure, MobileOffline_Item } from "@/api/generated/types"
import { offlineArtworkAddress, offlineFileAddress } from "@/core"
import type { Translate } from "@/lib/app-language"
import { logger } from "@/lib/helpers/debug"

/** WebSocket event with the whole download snapshot (backend/internal/mobileoffline). */
export const MOBILE_OFFLINE_EVENT = "mobile-offline-updated"

/** The part of a NetInfo state the server needs (structural, so this file loads without the native module). */
export type NetworkLike = { isConnected: boolean | null, details?: { isConnectionExpensive?: boolean } | null }

/**
 * What the app reports to POST /mobile-offline/network. An unknown connection (isConnected null, at startup) counts as
 * connected; "metered" is Android's isActiveNetworkMetered (NetInfo: isConnectionExpensive), as in the old app.
 */
export function networkReport(state: NetworkLike): { connected: boolean, metered: boolean } {
    return { connected: state.isConnected !== false, metered: state.details?.isConnectionExpensive === true }
}

const ownFilesTold = new Set<string>()

/**
 * URL of a saved file of an episode (video, separate audio track or subtitle) for the player. An episode of the core's
 * own downloads (area `offline`, docs/EIGENER-KERN.md §4o) is the file itself in the app's storage: mpv reads it
 * without the server in between.
 */
export function offlineFileUrl(id: string, file: string): string {
    const own = offlineFileAddress(id, file)
    if (own) {
        if (!ownFilesTold.has(own)) {
            ownFilesTold.add(own)
            logger("CoreOffline").info(`saved file for the player, straight from the app's storage: ${own}`)
        }
        return own
    }
    // only the app's own files; an episode the old server saved is not there
    return ""
}

/**
 * URL of saved artwork (coverAsset, bannerAsset, episodeImageAsset), or the online URL while it is not saved yet. A
 * picture of the core's own downloads (area `offline`) is the file itself in the app's storage.
 */
export function offlineArtworkUrl(asset: string | undefined, fallback?: string): string | undefined {
    if (asset) return offlineArtworkAddress(asset) ?? (fallback || undefined)
    return fallback || undefined
}

/** Episodes still on their way (queued, resolving, downloading, paused, failed). */
export function pendingItems(items: MobileOffline_Item[] | undefined): MobileOffline_Item[] {
    return (items ?? []).filter(item => item.status !== "ready")
}

export function offlineFailureText(failure: MobileOffline_Failure | undefined, tr: Translate): string {
    switch (failure) {
        case "SOURCE_REFUSED":
            return tr("The source link expired or was refused. Retry, or download from another server.",
                "Der Quell-Link ist abgelaufen oder wurde abgelehnt. Erneut versuchen oder von einem anderen Server laden.")
        case "CONNECTION":
            return tr("The connection dropped. Retry when you are online.", "Die Verbindung ist abgebrochen. Mit Internet erneut versuchen.")
        case "STORAGE_FULL":
            return tr("The phone's storage is full. Free up space, then retry.", "Der Speicher des Handys ist voll. Platz schaffen, dann erneut versuchen.")
        case "SOURCE_UNAVAILABLE":
            return tr("Source unavailable. Try again or pick another provider.", "Quelle nicht verfügbar. Erneut versuchen oder einen anderen Anbieter wählen.")
        default:
            return tr("Unknown error. Retry, or download from another server.", "Unbekannter Fehler. Erneut versuchen oder von einem anderen Server laden.")
    }
}

/** What the queue waits for, as text; "" when it does not wait. */
export function offlineWaitingText(waiting: string, tr: Translate): string {
    if (waiting === "wifi") return tr("Waiting for Wi-Fi", "Wartet auf WLAN")
    if (waiting === "internet") return tr("Waiting for internet", "Wartet auf Internet")
    return ""
}
