import { useTr } from "@/lib/app-language"
import { haptic } from "@/lib/feedback"
import { prefersReducedMotion } from "@/lib/motion"
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
    // The indicator on its way out (let go short of the trigger, or the refresh is done): where it leaves from
    const [leaving, setLeaving] = React.useState<{ from: number, spin: boolean } | null>(null)
    const refreshingRef = React.useRef(false)
    const ref = React.useRef<HTMLDivElement>(null)

    React.useEffect(() => {
        if (!PULL_ROUTES.includes(pathname)) return
        let start: { x: number, y: number } | null = null
        let distance = 0

        const reset = (leaveFrom = distance) => {
            start = null
            distance = 0
            setPull(0)
            if (leaveFrom > 0) setLeaving({ from: leaveFrom, spin: false })
        }
        const onCancel = () => reset()
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
            reset(pulled ? 0 : distance)
            if (!pulled) return
            refreshingRef.current = true
            setRefreshing(true)
            queryClient.refetchQueries({ type: "active" }).finally(() => {
                refreshingRef.current = false
                setRefreshing(false)
                setLeaving({ from: TRIGGER, spin: true })
            })
        }

        window.addEventListener("touchstart", onStart, { passive: true })
        window.addEventListener("touchmove", onMove, { passive: true })
        window.addEventListener("touchend", onEnd)
        window.addEventListener("touchcancel", onCancel)
        return () => {
            window.removeEventListener("touchstart", onStart)
            window.removeEventListener("touchmove", onMove)
            window.removeEventListener("touchend", onEnd)
            window.removeEventListener("touchcancel", onCancel)
            setPull(0)
        }
    }, [pathname])

    // Leaving: it fades out while rising and shrinking back under the top edge instead of vanishing in one frame, then
    // unmounts (the fill holds it hidden until then). A new pull takes it over where it is.
    React.useLayoutEffect(() => {
        const el = ref.current
        if (!leaving || pull || refreshing) return
        if (!el || typeof el.animate !== "function") return setLeaving(null)
        const y = leaving.from - 40 + 8
        const out = el.animate([
            { opacity: Math.min(leaving.from / TRIGGER, 1), transform: `translate(-50%, ${y}px)` },
            { opacity: 0, transform: prefersReducedMotion() ? `translate(-50%, ${y}px)` : "translate(-50%, -32px) scale(.8)" },
        ], { duration: 180, easing: "ease-out", fill: "forwards" })
        out.onfinish = () => setLeaving(current => current === leaving ? null : current)
        return () => out.cancel()
    }, [leaving, pull, refreshing])

    if (!pull && !refreshing && !leaving) return null

    const offset = refreshing ? TRIGGER : pull || leaving?.from || 0
    const spinning = refreshing || (!pull && !!leaving?.spin)
    return (
        <div
            ref={ref}
            data-pull-to-refresh
            role="status"
            aria-label={refreshing ? t("Refreshing", "Wird aktualisiert") : t("Pull to refresh", "Zum Aktualisieren ziehen")}
            className="pointer-events-none fixed left-1/2 top-0 z-[60] flex size-10 items-center justify-center rounded-full bg-[--sm-surface-control,#27272a] text-white shadow-lg"
            style={{
                transform: `translate(-50%, ${offset - 40 + 8}px)`, opacity: Math.min(offset / TRIGGER, 1),
                // Let go past the trigger, it settles back to where it spins instead of jumping there
                transition: refreshing ? "transform 160ms var(--m-out)" : undefined,
            }}
        >
            <LuRefreshCw className={spinning ? "animate-spin text-lg" : "text-lg"}
                style={spinning ? undefined : { transform: `rotate(${offset * 3}deg)`, color: offset >= TRIGGER ? "var(--sm-accent, #fff)" : undefined }} />
        </div>
    )
}
