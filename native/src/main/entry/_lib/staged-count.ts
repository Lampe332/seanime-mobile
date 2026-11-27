import React from "react"

/*
 * Long parts of the anime page come in stages (P2, S22: a tab switch built the whole list in the frame of the tap): the
 * first frame builds `first` items, the rows on screen; every next frame `step` more, until all are there.
 */

/** Rows built in the frame of the tap (more than fit on a tablet's right column) */
export const FIRST_ROWS = 10
/** Rows added per frame after that */
export const ROW_STEP = 8

/** The count one frame later */
export function nextStagedCount(count: number, total: number, step: number): number {
    return Math.min(total, count + Math.max(1, step))
}

/** How many of `total` items to build now: `first` at once, `step` more per frame while `active`; a new `key` starts over */
export function useStagedCount(total: number, { first, step, active = true, key }: { first: number, step: number, active?: boolean, key?: unknown }): number {
    const [stage, setStage] = React.useState({ key, count: first })
    const fresh = Object.is(stage.key, key)
    if (!fresh) setStage({ key, count: first })
    const count = fresh ? stage.count : first
    const done = count >= total
    React.useEffect(() => {
        if (!active || done) return
        const frame = requestAnimationFrame(() => setStage(prev => Object.is(prev.key, key)
            ? { key, count: nextStagedCount(prev.count, total, step) }
            : prev))
        return () => cancelAnimationFrame(frame)
    }, [active, done, count, total, step, key])
    return Math.min(count, total)
}
