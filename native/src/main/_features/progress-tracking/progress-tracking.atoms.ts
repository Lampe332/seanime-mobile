import { atom } from "jotai"

/*
 * From manual-progress-tracking.tsx: the external player link that is playing, kept for the manual progress tracking
 * button (its UI comes with the player, E3).
 */
export const __mpt_currentExternalPlayerLinkAtom = atom<string | null>(null)
