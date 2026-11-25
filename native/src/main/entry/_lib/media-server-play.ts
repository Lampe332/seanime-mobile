// geschrieben nach: Seanime_Jellyfin_Plan.md §2 ("Direktwiedergabe", "Token nie in der Adresse") und dem Nakama-Zweig in handle-play-media.ts

import type { Anime_Episode, Anime_Entry } from "@/api/generated/types"

/*
 * Episodes and entries of the media server (core/jellyfin/source.ts `withServerFiles`). Their markers are not in the
 * generated types, so they are read here. A server episode always opens in the app's player: its file needs the
 * Authorization header, which no external player link can carry.
 */

type ServerMarked = { _isMediaServerEpisode?: unknown, _isMediaServerEntry?: unknown }

export function isMediaServerEpisode(episode: Anime_Episode | null | undefined): boolean {
    return (episode as ServerMarked | null | undefined)?._isMediaServerEpisode === true
}

export function isMediaServerEntry(entry: Anime_Entry | null | undefined): boolean {
    return (entry as ServerMarked | null | undefined)?._isMediaServerEntry === true
}

/** Which way a library episode starts: from the media server, from a Nakama host, or from this device */
export function playRouteOf(episode: Anime_Episode): "mediaserver" | "nakama" | "local" {
    if (isMediaServerEpisode(episode)) return "mediaserver"
    if (episode._isNakamaEpisode) return "nakama"
    return "local"
}

/** The core's reason why a server episode did not start, in the app's language (never carries the token) */
export function mediaServerPlayError(message: string, t: (english: string, german: string) => string): string {
    if (message.includes("address is missing")) return t("The media server's address is missing. Add it in the settings.", "Die Adresse des Medienservers fehlt. Trage sie in den Einstellungen ein.")
    if (message.includes("Not signed in")) return t("You are not signed in to the media server. Sign in again in the settings.", "Du bist nicht beim Medienserver angemeldet. Melde dich in den Einstellungen neu an.")
    if (message.includes("not in the media server's library")) return t("This episode is no longer on the media server. Read the server again in the settings.", "Diese Folge ist nicht mehr auf dem Medienserver. Lies den Server in den Einstellungen neu ein.")
    return t("The episode could not be started from the media server.", "Die Folge konnte nicht vom Medienserver gestartet werden.")
}
