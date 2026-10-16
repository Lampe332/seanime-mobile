import { useIsSimulatedUser } from "@/app/(main)/_hooks/use-server-status"
import { cn } from "@/components/ui/core/styling"
import { preloadMediaEntry } from "@/lib/entry-preloader"
import {
    __navigationPreloadModeAtom,
    getNavigationPreloadDelay,
    getNavigationRoutePreload,
    getNavigationWarmDelay,
    isNavigationPreloadingEnabled,
    shouldWarmEntryOnIntent,
    shouldWarmEntryOnViewport,
} from "@/lib/navigation-preload-settings"
import { Link } from "@tanstack/react-router"
import { useAtomValue } from "jotai/react"
import React from "react"

type SeaLinkProps = React.ComponentPropsWithRef<"a"> & {
    href: string | undefined
    resetScroll?: boolean
    bypassEntryPreloadBudget?: boolean
    warmEntryOnViewport?: boolean
}

export const SeaLink = React.forwardRef<HTMLAnchorElement, SeaLinkProps>((props, ref) => {
    const {
        href,
        children,
        className,
        onClick,
        onFocus,
        onMouseDown,
        onMouseEnter,
        onMouseLeave,
        onTouchStart,
        resetScroll = true,
        bypassEntryPreloadBudget = false,
        warmEntryOnViewport = false,
        ...rest
    } = props

    // const navigate = useNavigate()

    const isExternal = href?.startsWith("http") || href?.startsWith("mailto")
    const isSimulatedUser = useIsSimulatedUser()
    const navigationPreloadMode = useAtomValue(__navigationPreloadModeAtom)
    const preload = getNavigationRoutePreload(navigationPreloadMode, isSimulatedUser)
    const preloadDelay = getNavigationPreloadDelay(navigationPreloadMode, isSimulatedUser)
    const preloadingEnabled = isNavigationPreloadingEnabled(navigationPreloadMode, isSimulatedUser)
    const linkRef = React.useRef<HTMLAnchorElement | null>(null)

    const hoverPreloadTimer = React.useRef<number | undefined>(undefined)

    const warmEntry = React.useCallback(() => {
        if (!preloadingEnabled) return
        preloadMediaEntry(href, { bypassBudget: bypassEntryPreloadBudget })
    }, [bypassEntryPreloadBudget, preloadingEnabled, href])

    const setRefs = React.useCallback((node: HTMLAnchorElement | null) => {
        linkRef.current = node

        if (typeof ref === "function") {
            ref(node)
            return
        }

        if (ref) {
            ref.current = node
        }
    }, [ref])

    const clearHoverPreload = React.useCallback(() => {
        if (!hoverPreloadTimer.current) return
        window.clearTimeout(hoverPreloadTimer.current)
        hoverPreloadTimer.current = undefined
    }, [])

    React.useEffect(() => clearHoverPreload, [clearHoverPreload])

    React.useEffect(() => {
        const shouldObserveViewport = shouldWarmEntryOnViewport(navigationPreloadMode,
            isSimulatedUser) || (warmEntryOnViewport && shouldWarmEntryOnIntent(
            navigationPreloadMode,
            isSimulatedUser,
        ))
        if (!shouldObserveViewport) return
        if (!href || isExternal) return
        if (typeof IntersectionObserver === "undefined") return

        const node = linkRef.current
        if (!node) return

        const observer = new IntersectionObserver((entries) => {
            if (!entries.some(entry => entry.isIntersecting)) return

            observer.disconnect()
            warmEntry()
        }, {
            rootMargin: "120px 0px",
        })

        observer.observe(node)
        return () => observer.disconnect()
    }, [href, isExternal, isSimulatedUser, navigationPreloadMode, warmEntry, warmEntryOnViewport])

    const handleMouseEnter = React.useCallback((event: React.MouseEvent<HTMLAnchorElement>) => {
        if (!shouldWarmEntryOnIntent(navigationPreloadMode, isSimulatedUser)) {
            onMouseEnter?.(event)
            return
        }

        clearHoverPreload()
        hoverPreloadTimer.current = window.setTimeout(() => {
            hoverPreloadTimer.current = undefined
            warmEntry()
        }, getNavigationWarmDelay(navigationPreloadMode, isSimulatedUser))
        onMouseEnter?.(event)
    }, [clearHoverPreload, isSimulatedUser, navigationPreloadMode, onMouseEnter, warmEntry])

    const handleMouseLeave = React.useCallback((event: React.MouseEvent<HTMLAnchorElement>) => {
        clearHoverPreload()
        onMouseLeave?.(event)
    }, [clearHoverPreload, onMouseLeave])

    const handleFocus = React.useCallback((event: React.FocusEvent<HTMLAnchorElement>) => {
        if (shouldWarmEntryOnIntent(navigationPreloadMode, isSimulatedUser)) {
            warmEntry()
        }
        onFocus?.(event)
    }, [isSimulatedUser, navigationPreloadMode, onFocus, warmEntry])

    const handleTouchStart = React.useCallback((event: React.TouchEvent<HTMLAnchorElement>) => {
        warmEntry()
        onTouchStart?.(event)
    }, [warmEntry, onTouchStart])

    const handleMouseDown = React.useCallback((event: React.MouseEvent<HTMLAnchorElement>) => {
        clearHoverPreload()
        warmEntry()
        onMouseDown?.(event)
    }, [clearHoverPreload, warmEntry, onMouseDown])

    if (!href || isExternal) {
        return (
            <a
                ref={ref}
                href={href}
                className={cn("cursor-pointer", className)}
                onClick={onClick}
                onFocus={onFocus}
                onMouseDown={onMouseDown}
                onMouseEnter={onMouseEnter}
                onMouseLeave={onMouseLeave}
                onTouchStart={onTouchStart}
                {...rest}
            >
                {children}
            </a>
        )
    }

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

    return (
        <Link
            ref={setRefs}
            to={pathname}
            search={Object.keys(searchParams).length > 0 ? () => searchParams : undefined}
            preload={preload}
            preloadDelay={preload === "intent" ? preloadDelay : undefined}
            className={cn("cursor-pointer", className)}
            resetScroll={resetScroll}
            onClick={onClick}
            onFocus={handleFocus}
            onMouseDown={handleMouseDown}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onTouchStart={handleTouchStart}
            {...rest}
        >
            {children}
        </Link>
    )

    // return (
    //     <a
    //         ref={ref}
    //         href={href}
    //         className={cn("cursor-pointer", className)}
    //         {...rest}
    //         onClick={(e) => {
    //             if (e.metaKey || e.altKey || e.ctrlKey || e.shiftKey || e.button !== 0) {
    //                 if (onClick) onClick(e)
    //                 return
    //             }
    //
    //             e.preventDefault()
    //
    //             if (onClick) onClick(e)
    //
    //             navigate({
    //                 to: pathname,
    //                 search: () => searchParams,
    //                 replace: false,
    //             }).then(() => {
    //                 if (resetScroll) window.scrollTo(0, 0)
    //             })
    //         }}
    //     >
    //         {children}
    //     </a>
    // )
})
