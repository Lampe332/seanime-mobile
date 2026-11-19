import { Text } from "@/components/ui/text/text"
import { useTr } from "@/lib/app-language"
import { __torrentSearch_selectionAtom, __torrentSearch_selectionEpisodeAtom } from "@/main/entry/_containers/torrent-search/torrent-search.atoms"
import { __torrentStream_autoSelectFileAtom, useTorrentSearchSelectedStreamEpisode } from "@/main/entry/_containers/torrent-stream/torrent-stream.atoms"
import { useAtomValue, useSetAtom } from "jotai"
import React from "react"
import { ActivityIndicator, View } from "react-native"
import { player_torrentStateAtom } from "./player.atoms"
import { streamStateLines } from "./torrent-stream-state"

/**
 * The player's loading screen: the spinner with the core's step text, and for a torrent stream its stage and numbers
 * (torrent-stream-state.ts). Mid-stream (`midStream`, the buffer ran empty) only one small line under the spinner.
 * Re-reads the clock every second so a state that stopped coming is dropped.
 */
export function PlayerLoading({ loadingState, torrent, midStream }: { loadingState: string | null, torrent: boolean, midStream: boolean }) {
    const t = useTr()
    const heard = useAtomValue(player_torrentStateAtom)
    const [now, setNow] = React.useState(() => Date.now())
    React.useEffect(() => {
        if (!torrent) return
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(timer)
    }, [torrent])
    // the clock of the last render or the state's own arrival, whichever is later (a fresh state renders at once)
    const lines = torrent ? streamStateLines(heard, Math.max(now, heard?.at ?? 0), midStream, t) : null

    return (
        <View pointerEvents="none" className="absolute inset-0 items-center justify-center gap-3">
            <ActivityIndicator color="#fff" size="large" />
            {lines && midStream ? (
                <Text className="px-8 text-center text-[13px] text-white/70" style={{ fontVariant: ["tabular-nums"] }}>
                    {`${lines.stage} · ${lines.detail}`}
                </Text>
            ) : lines ? (
                <View className="items-center gap-1 px-8">
                    <Text className="text-center text-[15px] text-white/80">{lines.stage}</Text>
                    <Text className="text-center text-[13px] text-white/60" style={{ fontVariant: ["tabular-nums"] }}>{lines.detail}</Text>
                </View>
            ) : loadingState ? (
                <Text className="px-8 text-center text-[15px] text-white/80">{loadingState}</Text>
            ) : null}
        </View>
    )
}

/**
 * "Pick another torrent" after a torrent nobody shares: the torrent sheet of the episode opens again (the anime page under
 * the player has it, torrent-search-phone.tsx). Null when the episode is not known.
 */
export function usePickAnotherTorrent(): ((close: () => void) => void) | null {
    const { torrentSearchStreamEpisode: episode } = useTorrentSearchSelectedStreamEpisode()
    const autoFile = useAtomValue(__torrentStream_autoSelectFileAtom)
    const setSelection = useSetAtom(__torrentSearch_selectionAtom)
    const setSelectionEpisode = useSetAtom(__torrentSearch_selectionEpisodeAtom)
    if (!episode) return null
    return close => {
        close()
        setSelectionEpisode(episode.episodeNumber)
        setSelection(autoFile ? "torrentstream-select" : "torrentstream-select-file")
    }
}
