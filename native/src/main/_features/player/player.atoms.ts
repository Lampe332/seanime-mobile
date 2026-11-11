import type { MobileOffline_Item } from "@/api/generated/types"
import { atomWithStorage } from "@/lib/storage"
import { atom } from "jotai"
import type { TrackMemory } from "./player-logic"

/** Mini player: the video keeps playing in a small card above the bar while the app is used (web vc_miniPlayer). */
export const player_miniAtom = atom(false)

/** Audio/subtitle language picked per anime (AniList id → language or "off"), kept across app starts. */
export const player_trackMemoryAtom = atomWithStorage<TrackMemory>("sea-player-track-memory", {})

/**
 * A cast session is running (set by useCastEventsBridge in lib/cast/use-cast.ts from the cast controller). Picture in
 * picture checks it (never PiP during cast, PiPManager.kt).
 */
export const player_castingAtom = atom(false)

/** The saved episode the player plays from the offline library (Downloads, "On this device"); null for server streams. */
export const player_offlineItemAtom = atom<MobileOffline_Item | null>(null)
