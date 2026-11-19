import type { NativePlayer_PlaybackInfo } from "@/api/generated/types"
import { useGetAnimeEntry } from "@/api/hooks/anime_entries.hooks"
import { useTorrentstreamKeep } from "@/api/hooks/torrentstream.hooks"
import { toast } from "@/components/ui/toast/toast-store"
import { useTr } from "@/lib/app-language"
import { successFeedback } from "@/lib/feedback"
import { askForDownloadNotices } from "@/main/android-downloads/_lib/download-notifications"
import { getDefaultDestination } from "@/main/entry/_containers/torrent-search/_lib/torrent-search-phone"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import React from "react"
import { keepFailureText, type KeepState, keepsTorrentStream } from "./keep-stream"

/**
 * "Keep in library" for the player menu (keep-stream.ts): while a torrent stream plays, the episode's torrent goes into
 * the torrent client and its files into the folder the download sheet would choose (next to the anime's files, else a
 * folder named after it in the library). `onKeep` is undefined while no torrent stream plays: the row is not there.
 */
export function useKeepStream(info: NativePlayer_PlaybackInfo | null, offline: boolean, online: boolean) {
    const t = useTr()
    const playing = keepsTorrentStream(info, offline, online)
    const { data: entry } = useGetAnimeEntry(playing ? info?.media?.id : null)
    const library = useServerStatus()?.settings?.library
    const libraryPath = library?.libraryPath || library?.libraryPaths?.[0] || ""
    // the state belongs to one stream: another episode starts at "idle"
    const [state, setState] = React.useState<{ id: string, state: KeepState }>({ id: "", state: "idle" })
    const id = info?.id ?? ""
    const current: KeepState = state.id === id ? state.state : "idle"
    const { mutate } = useTorrentstreamKeep(error => {
        // a failed keep can be tried again; the stream was never touched
        setState(previous => previous.id === id ? { id, state: "idle" } : previous)
        toast.error(keepFailureText(String(error.response?.data?.error ?? error.message ?? ""), t))
    })

    const keep = () => {
        if (current !== "idle" || !info) return
        const destination = getDefaultDestination({ localFiles: entry?.localFiles ?? [], media: entry?.media ?? info.media }, libraryPath)
        if (!destination) {
            toast.error(keepFailureText("the destination must be a folder on the phone", t))
            return
        }
        setState({ id, state: "keeping" })
        mutate({ destination }, {
            onSuccess: () => {
                setState(previous => previous.id === id ? { id, state: "kept" } : previous)
                successFeedback()
                toast.success(t("Kept in library. It keeps loading in Downloads.", "In die Bibliothek übernommen. Es lädt unter Downloads weiter."))
                void askForDownloadNotices().catch(() => undefined)
            },
        })
    }

    return { onKeep: playing ? keep : undefined, keepState: current }
}
