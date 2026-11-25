import { atomWithStorage, readStoredJSON } from "@/lib/storage"
import { useAtomValue } from "jotai"
import { useLayoutEffect, useSyncExternalStore } from "react"
import { Uniwind } from "uniwind"
import {
    type AccentId,
    buildPalette,
    currentPalette,
    DEFAULT_ACCENT,
    isAccentId,
    paletteVersion,
    setCurrentPalette,
    subscribePalette,
} from "./palette"

/**
 * Accent colour (settings → Appearance), a matter of taste: carried by the account's sync. AMOLED black depends on the
 * screen: only on this device (app-backup-keys.ts SYNC_DEVICE_KEYS).
 */
const ACCENT_KEY = "sea-ui-settings-accent"
const AMOLED_KEY = "sea-ui-settings-amoled"
export const accentColorAtom = atomWithStorage<AccentId>(ACCENT_KEY, DEFAULT_ACCENT)
export const amoledAtom = atomWithStorage<boolean>(AMOLED_KEY, false)

/**
 * Swaps the palette: the CSS variables go to uniwind (every class that reads them resolves again, config.native.ts
 * updateCSSVariables notifies the styles), the script colours of tokens.ts follow through their getters and every
 * useThemeColors() renders again. Nothing remounts.
 */
export function applyAppearance(accent: unknown, amoled: unknown) {
    const next = buildPalette(isAccentId(accent) ? accent : DEFAULT_ACCENT, amoled === true)
    const prev = currentPalette()
    if (JSON.stringify(prev.css) === JSON.stringify(next.css)) return
    for (const theme of Uniwind.themes) Uniwind.updateCSSVariables(theme, next.css)
    setCurrentPalette(next)
}

/** Before the first frame (app/_layout.tsx at import): the stored choice, so violet never flashes */
export function applyStoredAppearance() {
    applyAppearance(readStoredJSON<unknown>(ACCENT_KEY, DEFAULT_ACCENT), readStoredJSON<unknown>(AMOLED_KEY, false))
}

/** In the root layout: applies a change from the settings or from a sync before the next frame */
export function useAppearanceSync() {
    const accent = useAtomValue(accentColorAtom)
    const amoled = useAtomValue(amoledAtom)
    useLayoutEffect(() => applyAppearance(accent, amoled), [accent, amoled])
}

/**
 * For components that pass a themed colour of `colors` (tokens.ts) as a prop or style: renders them again when the
 * palette changes. Returns the current script colours.
 */
export function useThemeColors() {
    return usePalette().js
}

/** The whole current palette (for accentGlow, navHighlight … of palette.ts), rendering again when it changes */
export function usePalette() {
    useSyncExternalStore(subscribePalette, paletteVersion, paletteVersion)
    return currentPalette()
}
