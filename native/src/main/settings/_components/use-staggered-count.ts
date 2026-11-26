import React from "react"

/**
 * How many of `total` items a long list mounts yet: `first` with the list, then `step` more per frame as a transition.
 * Fabric mounts a frame's new views in one go; 36 search hits or 134 series rows at once cost 50–80 ms on a phone (S22
 * trace). The count only grows, so a list that narrows keeps its rows and one that widens again staggers the new ones.
 */
export function useStaggeredCount(total: number, first = 8, step = 8): number {
    const [count, setCount] = React.useState(first)
    React.useEffect(() => {
        if (count >= total) return undefined
        const frame = requestAnimationFrame(() => React.startTransition(() => setCount(now => now + step)))
        return () => cancelAnimationFrame(frame)
    }, [count, step, total])
    return Math.min(count, total)
}
