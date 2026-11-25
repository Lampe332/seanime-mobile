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
    setCurrentPalette,
    subscribePalette,
} from "./palette"
import { themeColorsOf } from "./tokens"

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

/** The stored choice as a palette, for renders outside the app (the home screen widget runs without the root layout) */
export function storedPalette() {
    const accent = readStoredJSON<unknown>(ACCENT_KEY, DEFAULT_ACCENT)
    return buildPalette(isAccentId(accent) ? accent : DEFAULT_ACCENT, readStoredJSON<unknown>(AMOLED_KEY, false) === true)
}

/** In the root layout: applies a change from the settings or from a sync before the next frame */
export function useAppearanceSync() {
    const accent = useAtomValue(accentColorAtom)
    const amoled = useAtomValue(amoledAtom)
    useLayoutEffect(() => applyAppearance(accent, amoled), [accent, amoled])
}

/**
 * Every script colour, for props and styles that take a colour instead of a class: `const colors = useThemeColors()`.
 * The component renders again when the palette changes and gets a new object, so nothing that depends on a colour can
 * be kept from an earlier render (theme-subscription.test.ts holds every file to it).
 */
export function useThemeColors() {
    return themeColorsOf(usePalette())
}

/**
 * The whole current palette (for accentGlow, navHighlight … of palette.ts), rendering again when it changes.
 * The palette has to be the store's snapshot itself: React Compiler keeps a plain `currentPalette()` call for the
 * life of the component (no reactive input), so mounted screens stayed on the colour the app started with.
 */
export function usePalette() {
    return useSyncExternalStore(subscribePalette, currentPalette, currentPalette)
}
