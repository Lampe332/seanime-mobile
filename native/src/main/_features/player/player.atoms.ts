import type { MobileOffline_Item } from "@/api/generated/types"
import { atomWithStorage } from "@/lib/storage"
import { atom } from "jotai"
import type { TrackMemory } from "./player-logic"

/**
 * The player is small (r22): it plays in the box of its anime page while that page is on screen, else in the mini player
 * (player-chrome playerView); false = fullscreen. Set by the bottom-right button and Back; a new stream decides it on start.
 */
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
