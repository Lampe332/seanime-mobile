import type { Translate } from "@/lib/app-language"

/**
 * "Keep in library" (4.2.0): the running torrent stream's torrent goes into the app's torrent client, its files into the
 * anime's folder in the library (core/torrent/client.ts keepTorrentStream). The row sits in the player menu's "More"
 * group (player-menu.tsx), which places itself for phones, tablets and landscape (player-menu-logic.ts).
 */

export type KeepState = "idle" | "keeping" | "kept"

/** Whether a torrent stream plays: the core's stream ("watch" with streamType torrent) has its address, nothing offline or online */
export function keepsTorrentStream(info: { streamType?: string | null, streamUrl?: string | null } | null, offline: boolean, online: boolean): boolean {
    return !offline && !online && info?.streamType === "torrent" && !!info.streamUrl
}

/** The menu row: null while no torrent stream plays (the row is not there), else its words and whether it can be tapped */
export function keepRowOf(torrentPlaying: boolean, state: KeepState, t: Translate): { label: string, disabled: boolean } | null {
    if (!torrentPlaying) return null
    if (state === "kept") return { label: t("Kept in library", "In die Bibliothek übernommen"), disabled: true }
    if (state === "keeping") return { label: t("Moving to library …", "Wird in die Bibliothek verschoben …"), disabled: true }
    return { label: t("Keep in library", "In Bibliothek behalten"), disabled: false }
}

/** The error after a failed keep: what went wrong in the user's words, and that the stream goes on */
export function keepFailureText(reason: string, t: Translate): string {
    const goesOn = t("The stream goes on.", "Der Stream läuft weiter.")
    // the core's own words with the numbers (torrent-notice.ts spaceText, already in the app's language)
    if (/not enough free space|nicht genug freier speicher/i.test(reason)) return `${reason} ${goesOn}`
    if (/no space left/i.test(reason)) {
        return `${t("Not enough free storage to keep this episode.", "Nicht genug freier Speicher, um diese Folge zu behalten.")} ${goesOn}`
    }
    if (/no torrent stream is running/i.test(reason)) return t("The stream has already ended.", "Der Stream ist schon beendet.")
    if (/destination must be a folder/i.test(reason)) {
        return t("Set a library folder in Settings first.", "Lege zuerst in den Einstellungen einen Bibliotheksordner fest.")
    }
    return `${t("This episode could not be kept.", "Diese Folge konnte nicht behalten werden.")} ${goesOn}${reason ? ` (${reason})` : ""}`
}
