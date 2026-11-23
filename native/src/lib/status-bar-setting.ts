import { atomWithStorage } from "@/lib/storage"

/**
 * Show the status bar (clock, battery) outside the player (settings → Appearance), only on this device. Off = the old
 * app's full screen. The fullscreen player always hides it (app/_layout.tsx).
 */
export const showStatusBarAtom = atomWithStorage<boolean>("sea-ui-settings-show-status-bar", false)
