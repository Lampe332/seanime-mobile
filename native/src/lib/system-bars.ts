import { setVisibilityAsync } from "expo-navigation-bar"
import { type TurboModule, TurboModuleRegistry } from "react-native"

type StatusBarManager = TurboModule & { setHidden: (hidden: boolean) => void }

/**
 * Hides the status and navigation bar again (old app: MainActivity.hideSystemBars on resume, window focus and fullscreen
 * changes). The status bar goes straight to RN's native StatusBarManager: `StatusBar.setHidden(true)` (RN and
 * expo-status-bar) only calls it when its own record says the bar is shown, and that record stays "hidden" from the
 * start, so a bar Android had brought back (a swipe from the edge that ended on another window, a system dialog) was never
 * hidden again and stayed over the page (S22: clock and battery over the anime page).
 */
export function hideSystemBars(manager = TurboModuleRegistry.get<StatusBarManager>("StatusBarManager"), hideNavigation = setVisibilityAsync) {
    manager?.setHidden(true)
    hideNavigation("hidden").catch(() => {})
}
