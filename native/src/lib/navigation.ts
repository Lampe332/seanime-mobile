import { useIsSimulatedUser } from "@/main/_hooks/use-server-status"
import { preloadMediaEntry } from "@/lib/entry-preloader"
import { __navigationPreloadModeAtom, isNavigationPreloadingEnabled } from "@/lib/navigation-preload-settings"
import { type Href, useGlobalSearchParams, usePathname as useRouterPathname, useRouter as useExpoRouter } from "expo-router"
import { useAtomValue } from "jotai/react"
import { useMemo } from "react"

/**
 * The web app's router wrapper (TanStack Router) on Expo Router, with the same push/replace/back API and the same entry
 * preloading. Paths keep the web app's shape ("/entry?id=1"); Expo Router parses the query into the screen's params.
 * The web version scrolled the window to the top after a push: every native screen starts at its own top.
 */
export function useRouter() {
    const router = useExpoRouter()
    const pathname = useRouterPathname()
    const navigationPreloadMode = useAtomValue(__navigationPreloadModeAtom)
    const isSimulatedUser = useIsSimulatedUser()

    const handleNavigation = (href: string, method: "push" | "replace") => {
        // if href starts with "?", it targets the current screen
        const target = href.startsWith("?") ? pathname + href : href

        if (isNavigationPreloadingEnabled(navigationPreloadMode, isSimulatedUser)) {
            preloadMediaEntry(target)
        }

        // Paths come from the web app's string routes; Expo Router checks them at runtime (unknown → its not-found screen)
        const route = target as Href
        if (method === "replace") router.replace(route)
        else router.push(route)
    }

    return {
        push: (href: string, _options?: { resetScroll?: boolean; scroll?: boolean }) => handleNavigation(href, "push"),
        replace: (href: string, _options?: { resetScroll?: boolean; scroll?: boolean }) => handleNavigation(href, "replace"),
        back: () => router.back(),
        canGoBack: () => router.canGoBack(),
    }
}

export function usePathname() {
    return useRouterPathname()
}

export function useSearchParams() {
    const search = useGlobalSearchParams()

    return useMemo(() => {
        const params = new Map<string, string>()
        Object.entries(search).forEach(([key, value]) => {
            if (value === undefined || value === null) return
            params.set(key, Array.isArray(value) ? value.join(",") : String(value))
        })
        return params
    }, [search])
}
