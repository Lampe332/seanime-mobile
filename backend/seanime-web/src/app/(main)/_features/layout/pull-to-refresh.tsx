import { useTr } from "@/lib/app-language"
import { haptic } from "@/lib/feedback"
import { usePathname } from "@/lib/navigation"
import { useQueryClient } from "@tanstack/react-query"
import React from "react"
import { LuRefreshCw } from "react-icons/lu"

/** Pages whose data changes while the app is open; pulling down at their top loads it again */
const PULL_ROUTES = ["/", "/discover", "/schedule", "/lists", "/manga", "/android-downloads"]
const TRIGGER = 64
const MAX_PULL = 96

/** Pull-to-refresh for touch screens: a pull down from the top of the page refetches what the page shows. */
export function PullToRefresh() {
    const t = useTr()
    const pathname = usePathname()
    const queryClient = useQueryClient()
    const [pull, setPull] = React.useState(0)
    const [refreshing, setRefreshing] = React.useState(false)
    const refreshingRef = React.useRef(false)

    React.useEffect(() => {
        if (!PULL_ROUTES.includes(pathname)) return
        let start: { x: number, y: number } | null = null
        let distance = 0

        const reset = () => {
            start = null
            distance = 0
            setPull(0)
        }
        const onStart = (e: TouchEvent) => {
            if (window.scrollY > 0 || e.touches.length !== 1 || refreshingRef.current) return
            // sheets, the player and text fields keep their own gestures
            if ((e.target as Element | null)?.closest("[role=\"dialog\"], [data-vc-element=\"container\"], input, textarea, select")) return
            start = { x: e.touches[0].clientX, y: e.touches[0].clientY }
        }
        const onMove = (e: TouchEvent) => {
            if (!start) return
            const dx = e.touches[0].clientX - start.x
            const dy = e.touches[0].clientY - start.y
            // a sideways swipe (carousels) or scrolling down is no pull
            if (dy <= 0 || Math.abs(dx) > dy || window.scrollY > 0) return reset()
            const before = distance
            distance = Math.min(dy * .5, MAX_PULL)
            // a tick where letting go starts the refresh
            if (before < TRIGGER && distance >= TRIGGER) haptic("tick")
            setPull(distance)
        }
        const onEnd = () => {
            if (!start) return
            const pulled = distance >= TRIGGER
            reset()
            if (!pulled) return
            refreshingRef.current = true
            setRefreshing(true)
            queryClient.refetchQueries({ type: "active" }).finally(() => {
                refreshingRef.current = false
                setRefreshing(false)
            })
        }

        window.addEventListener("touchstart", onStart, { passive: true })
        window.addEventListener("touchmove", onMove, { passive: true })
        window.addEventListener("touchend", onEnd)
        window.addEventListener("touchcancel", reset)
        return () => {
            window.removeEventListener("touchstart", onStart)
            window.removeEventListener("touchmove", onMove)
            window.removeEventListener("touchend", onEnd)
            window.removeEventListener("touchcancel", reset)
            setPull(0)
        }
    }, [pathname])

    if (!pull && !refreshing) return null

    const offset = refreshing ? TRIGGER : pull
    return (
        <div
            data-pull-to-refresh
            role="status"
            aria-label={refreshing ? t("Refreshing", "Wird aktualisiert") : t("Pull to refresh", "Zum Aktualisieren ziehen")}
            className="pointer-events-none fixed left-1/2 top-0 z-[60] flex size-10 items-center justify-center rounded-full bg-[--sm-surface-control,#27272a] text-white shadow-lg"
            style={{ transform: `translate(-50%, ${offset - 40 + 8}px)`, opacity: Math.min(offset / TRIGGER, 1) }}
        >
            <LuRefreshCw className={refreshing ? "animate-spin text-lg" : "text-lg"}
                style={refreshing ? undefined : { transform: `rotate(${pull * 3}deg)`, color: pull >= TRIGGER ? "var(--sm-accent, #fff)" : undefined }} />
        </div>
    )
}
