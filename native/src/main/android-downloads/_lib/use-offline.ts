import type { MobileOffline_Item } from "@/api/generated/types"
import { useGetMobileOfflineSnapshot } from "@/api/hooks/mobile_offline.hooks"
import { nativePlayer_initialState, nativePlayer_stateAtom } from "@/main/_features/native-player/native-player.atoms"
import { player_miniAtom, player_offlineItemAtom } from "@/main/_features/player/player.atoms"
import { useSetAtom } from "jotai"
import React from "react"
import { canPlayOffline } from "./offline-playback"

/** Opens a saved episode in the app's player (full size); a server stream that was open makes room for it. */
export function usePlayOffline() {
    const setOffline = useSetAtom(player_offlineItemAtom)
    const setMini = useSetAtom(player_miniAtom)
    const setNativePlayer = useSetAtom(nativePlayer_stateAtom)
    return React.useCallback((item: MobileOffline_Item) => {
        if (!canPlayOffline(item)) return
        setNativePlayer(nativePlayer_initialState)
        setMini(false)
        setOffline(item)
    }, [setOffline, setMini, setNativePlayer])
}

/** The episodes of one anime in the offline library, by number ("On this device" on the anime page). */
export function useOfflineEpisodes(mediaId: number | undefined): MobileOffline_Item[] {
    const { data } = useGetMobileOfflineSnapshot()
    return React.useMemo(() => {
        if (!mediaId) return []
        return (data?.items ?? []).filter(item => item.mediaId === mediaId).sort((a, b) => (Number(a.episode) || 0) - (Number(b.episode) || 0))
    }, [data?.items, mediaId])
}
