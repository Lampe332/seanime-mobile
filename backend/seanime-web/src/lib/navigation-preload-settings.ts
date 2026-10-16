import { atomWithStorage } from "jotai/utils"

export type NavigationPreloadMode = "disable" | "default" | "faster" | "viewport"

const NAVIGATION_PRELOAD_MODE_KEY = "sea-ui-settings-navigation-preload-mode"
const DEFAULT_NAVIGATION_PRELOAD_MODE: NavigationPreloadMode = "default"

export function getActualNavigationPreloadMode(mode: NavigationPreloadMode, isSimulatedUser = false): NavigationPreloadMode {
    return isSimulatedUser ? "disable" : mode
}

export function isNavigationPreloadingEnabled(mode: NavigationPreloadMode, isSimulatedUser = false) {
    return getActualNavigationPreloadMode(mode, isSimulatedUser) !== "disable"
}

export function getNavigationRoutePreload(mode: NavigationPreloadMode, isSimulatedUser = false): false | "intent" | "viewport" {
    switch (getActualNavigationPreloadMode(mode, isSimulatedUser)) {
        case "disable":
            return false
        case "viewport":
            return "viewport"
        default:
            return "intent"
    }
}

export function getNavigationPreloadDelay(mode: NavigationPreloadMode, isSimulatedUser = false) {
    return getActualNavigationPreloadMode(mode, isSimulatedUser) === "faster" ? 0 : undefined
}

export function getNavigationWarmDelay(mode: NavigationPreloadMode, isSimulatedUser = false) {
    return getActualNavigationPreloadMode(mode, isSimulatedUser) === "faster" ? 100 : 350
}

export function shouldWarmEntryOnIntent(_mode: NavigationPreloadMode, isSimulatedUser = false) {
    const mode = getActualNavigationPreloadMode(_mode, isSimulatedUser)
    return mode === "default" || mode === "faster"
}

export function shouldWarmEntryOnViewport(mode: NavigationPreloadMode, isSimulatedUser = false) {
    return getActualNavigationPreloadMode(mode, isSimulatedUser) === "viewport"
}

export const __navigationPreloadModeAtom = atomWithStorage<NavigationPreloadMode>(
    NAVIGATION_PRELOAD_MODE_KEY,
    DEFAULT_NAVIGATION_PRELOAD_MODE,
    undefined,
    { getOnInit: true },
)
