// geschrieben nach: Plan „Account + Sync“ (Abschnitt 6.5 Takt, 6.4 Anfragen „beim Öffnen + bei jedem Sync-Takt“) und core/account/sync.ts (SyncTrigger, isDue)

import { SYNC_INTERVAL_MS, type SyncTrigger } from "@/core/account/sync"

/*
 * When the account syncs: at the start, every 5 minutes while the app is in front, when the user leaves it and on
 * "Sync now". There is no background job. The sync engine itself skips an "interval" tick that is not due yet and
 * uploads only a changed package, so the clock may ask once a minute without network traffic.
 * Approval requests of new devices are looked for at the start, whenever the app comes to the front, on "Sync now" and
 * then every 5 minutes.
 */

export const CLOCK_TICK_MS = 60 * 1000

export type ClockDeps = {
    sync: (trigger: SyncTrigger) => Promise<unknown>
    checkRequests: () => Promise<unknown>
    now: () => number
    /** Calls `run` every `ms` until the returned function is called */
    every: (ms: number, run: () => void) => () => void
}

export type AppStateName = "active" | "background" | "inactive" | "unknown" | "extension"

export function createSyncClock(deps: ClockDeps) {
    let stopTimer: (() => void) | null = null
    let inFront = false
    let lastRequestCheck = Number.NEGATIVE_INFINITY

    const quiet = (work: Promise<unknown>) => void work.catch(() => undefined)
    const requests = () => {
        lastRequestCheck = deps.now()
        quiet(deps.checkRequests())
    }
    const tick = () => {
        quiet(deps.sync("interval"))
        if (deps.now() - lastRequestCheck >= SYNC_INTERVAL_MS) requests()
    }
    const front = () => {
        inFront = true
        stopTimer?.()
        stopTimer = deps.every(CLOCK_TICK_MS, tick)
    }

    return {
        /** App start (signed in, or right after signing in) */
        start(state: AppStateName) {
            quiet(deps.sync("start"))
            requests()
            if (state === "active") front()
        },
        appState(state: AppStateName) {
            if (state === "active" && !inFront) {
                front()
                quiet(deps.sync("interval"))
                requests()
            }
            else if (state === "background" && inFront) {
                inFront = false
                stopTimer?.()
                stopTimer = null
                quiet(deps.sync("leave"))
            }
        },
        syncNow() {
            requests()
            return deps.sync("manual")
        },
        stop() {
            inFront = false
            stopTimer?.()
            stopTimer = null
        },
    }
}

export type SyncClock = ReturnType<typeof createSyncClock>
