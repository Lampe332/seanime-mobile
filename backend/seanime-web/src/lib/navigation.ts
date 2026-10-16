import { useIsSimulatedUser } from "@/app/(main)/_hooks/use-server-status"
import { preloadMediaEntry } from "@/lib/entry-preloader"
import { __navigationPreloadModeAtom, isNavigationPreloadingEnabled } from "@/lib/navigation-preload-settings"
import { useLocation, useNavigate } from "@tanstack/react-router"
import { useAtomValue } from "jotai/react"
import { useMemo } from "react"

function parseHref(href: string) {
    // if href is empty or just "?", split handles it.
    const [pathname, searchString] = href.split("?")
    const searchParams: Record<string, any> = {}

    if (searchString) {
        const urlSearchParams = new URLSearchParams(searchString)
        urlSearchParams.forEach((value, key) => {
            const numValue = Number(value)
            const isNumeric = !isNaN(numValue) && value.trim() !== ""
            searchParams[key] = isNumeric ? numValue : value
        })
    }

    return { pathname, searchParams }
}

export function useRouter() {
    const navigate = useNavigate()
    const location = useLocation()
    const navigationPreloadMode = useAtomValue(__navigationPreloadModeAtom)
    const isSimulatedUser = useIsSimulatedUser()

    const handleNavigation = (
        href: string,
        method: "push" | "replace",
        options?: { resetScroll?: boolean; scroll?: boolean },
    ) => {
        const { pathname, searchParams } = parseHref(href)

        // if pathname is empty (href starts with "?"), use current location pathname
        const targetPath = pathname || location.pathname

        // default to true (scroll to top) if neither is specified
        const shouldScroll = options?.resetScroll ?? options?.scroll ?? true

        if (isNavigationPreloadingEnabled(navigationPreloadMode, isSimulatedUser)) {
            preloadMediaEntry(href)
        }

        navigate({
            to: targetPath,
            search: () => searchParams,
            replace: method === "replace",
        }).then(() => {
            if (shouldScroll) {
                window.scrollTo(0, 0)
            }
        })
    }

    return {
        push: (href: string, options?: { resetScroll?: boolean; scroll?: boolean }) =>
            handleNavigation(href, "push", options),

        replace: (href: string, options?: { resetScroll?: boolean; scroll?: boolean }) =>
            handleNavigation(href, "replace", options),

        back: () => window.history.back(),
        forward: () => window.history.forward(),
        refresh: () => window.location.reload(),
    }
}

export function usePathname() {
    const location = useLocation()
    return location.pathname
}

export function useSearchParams() {
    const location = useLocation()

    return useMemo(() => {
        const params = new URLSearchParams()

        Object.entries(location.search).forEach(([key, value]) => {
            if (value === undefined || value === null) return
            params.set(key, String(value))
        })

        return params
    }, [location.search])
}
