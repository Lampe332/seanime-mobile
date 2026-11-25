import type { MobileOffline_Item } from "@/api/generated/types"
import { atomWithStorage } from "@/lib/storage"
import { atom } from "jotai"
import { SEEK_BACK_SECONDS, SEEK_FORWARD_SECONDS, type SleepPick, type TrackMemory } from "./player-logic"
import { ANIME4K_DEFAULT_MODE, type Anime4kMode } from "./player-anime4k"
import type { HeardStreamState } from "./torrent-stream-state"

/**
 * The player is small (r22): it plays in the box of its anime page while that page is on screen, else in the mini player
 * (player-chrome playerView); false = fullscreen. Set by the bottom-right button and Back; a new stream decides it on start.
 */
export const player_miniAtom = atom(false)

/** The sleep timer's picked minutes with the end they set (player-logic sleepTimerChoice); the menu marks that option. */
export const player_sleepPickAtom = atom<SleepPick | null>(null)

/** Audio/subtitle language picked per anime (AniList id → language or "off"), kept across app starts. */
/** The player fills the screen (not box or mini): the root layout hides the status bar then, whatever the setting says. */
export const player_fullscreenAtom = atom(false)

/** Seconds of the back / forward buttons and double taps (settings → Playback), only on this device. */
export const player_seekBackAtom = atomWithStorage<number>("sea-player-seek-back-seconds", SEEK_BACK_SECONDS)
export const player_seekForwardAtom = atomWithStorage<number>("sea-player-seek-forward-seconds", SEEK_FORWARD_SECONDS)

/** Anime4K upscaling (settings → Playback), only on this device: it depends on the phone's GPU and battery. */
export const player_anime4kAtom = atomWithStorage<Anime4kMode>("sea-player-anime4k", ANIME4K_DEFAULT_MODE)

export const player_trackMemoryAtom =atomWithStorage<TrackMemory>("sea-player-track-memory", {})

/**
 * A cast session is running (set by useCastEventsBridge in lib/cast/use-cast.ts from the cast controller). Picture in
 * picture checks it (never PiP during cast, PiPManager.kt).
 */
export const player_castingAtom = atom(false)

/** The saved episode the player plays from the offline library (Downloads, "On this device"); null for server streams. */
export const player_offlineItemAtom = atom<MobileOffline_Item | null>(null)

/** The torrent stream's last state (`torrentstream-state`, heard in native-player.tsx); null: none or the player closed */
export const player_torrentStateAtom = atom<HeardStreamState | null>(null)
