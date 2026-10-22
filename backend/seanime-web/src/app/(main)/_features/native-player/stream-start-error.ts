import { nativePlayer_stateAtom } from "@/app/(main)/_features/native-player/native-player.atoms"
import { Translate } from "@/lib/app-language"
import { toast } from "sonner"
import type { createStore } from "jotai"

/**
 * Why a torrent or debrid stream could not start, in words a phone user can act on. The server's reasons are technical;
 * the one met most is a torrent nobody shares, which ends after the server waited a minute for its file list. Phones pick
 * the episode's file themselves, so a torrent without it (another season, a movie) ends with "could not find episode".
 */
export function streamStartError(reason: string, t: Translate) {
    if (/timeout waiting for torrent info/i.test(reason)) {
        return t("Nobody is sharing this torrent right now. Choose one with more seeders.",
            "Diesen Torrent teilt gerade niemand. Wähle einen mit mehr Seedern.")
    }
    const episode = reason.match(/could not find episode (\d+) in torrent/i)
    if (episode) {
        return t(`This torrent has no episode ${episode[1]}. Choose another one.`, `In diesem Torrent fehlt Folge ${episode[1]}. Wähle einen anderen.`)
    }
    if (/could not select episode from torrents/i.test(reason)) {
        return t("No torrent with this episode was found. Turn off \"Pick the best torrent\" to choose one yourself.",
            "Kein Torrent mit dieser Folge gefunden. Schalte „Besten Torrent wählen“ aus, um selbst einen auszusuchen.")
    }
    if (/no files found in the torrent/i.test(reason)) {
        return t("This torrent has no video to play. Choose another one.", "Dieser Torrent enthält kein Video. Wähle einen anderen.")
    }
    return reason
}

/**
 * The phone's message for a stream start that failed. Nothing when the player is already closed: the user left with Back
 * while it was loading, and a message a minute later would only confuse.
 */
export function toastStreamStartError(error: { response?: { data?: { error?: unknown } }, message?: string }, t: Translate,
    store: ReturnType<typeof createStore>) {
    if (!store.get(nativePlayer_stateAtom).active) return
    toast.error(streamStartError(String(error.response?.data?.error ?? error.message ?? ""), t))
}
