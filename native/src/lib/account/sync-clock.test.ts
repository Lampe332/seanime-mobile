// geschrieben nach: lib/account/sync-clock.ts und Plan „Account + Sync“ 6.5 (Start, 5 Min im Vordergrund, Verlassen, Sync now); Zeiten erfunden

import { describe, expect, it } from "vitest"
import type { SyncTrigger } from "@/core/account/sync"
import { CLOCK_TICK_MS, createSyncClock } from "./sync-clock"

function harness() {
    let now = Date.parse("2026-11-18T10:00:00.000Z")
    const syncs: SyncTrigger[] = []
    let requestChecks = 0
    let timer: { ms: number, run: () => void } | null = null
    const clock = createSyncClock({
        sync: async trigger => void syncs.push(trigger),
        checkRequests: async () => void requestChecks++,
        now: () => now,
        every: (ms, run) => {
            timer = { ms, run }
            return () => {
                timer = null
            }
        },
    })
    const minutes = (count: number) => {
        for (let i = 0; i < count; i++) {
            now += CLOCK_TICK_MS
            timer?.run()
        }
    }
    return { clock, syncs, requests: () => requestChecks, timer: () => timer, minutes }
}

describe("sync clock", () => {
    it("syncs at the start and looks for approval requests", () => {
        const h = harness()
        h.clock.start("active")
        expect(h.syncs).toEqual(["start"])
        expect(h.requests()).toBe(1)
        expect(h.timer()?.ms).toBe(CLOCK_TICK_MS)
    })

    it("asks the engine every minute in front (it skips ticks not due) and checks requests every 5 minutes", () => {
        const h = harness()
        h.clock.start("active")
        h.minutes(10)
        expect(h.syncs.filter(trigger => trigger === "interval")).toHaveLength(10)
        expect(h.requests()).toBe(3)
    })

    it("syncs on leaving, stops the timer in the background, and checks requests on coming back", () => {
        const h = harness()
        h.clock.start("active")
        h.clock.appState("background")
        expect(h.syncs.at(-1)).toBe("leave")
        expect(h.timer()).toBeNull()
        h.minutes(30)
        expect(h.syncs).toEqual(["start", "leave"])
        h.clock.appState("active")
        expect(h.syncs.at(-1)).toBe("interval")
        expect(h.requests()).toBe(2)
        expect(h.timer()).not.toBeNull()
    })

    it("ignores the short 'inactive' state and a second 'active'", () => {
        const h = harness()
        h.clock.start("active")
        h.clock.appState("inactive")
        h.clock.appState("active")
        expect(h.syncs).toEqual(["start"])
    })

    it("starts without a timer when the app starts in the background", () => {
        const h = harness()
        h.clock.start("background")
        expect(h.timer()).toBeNull()
        h.clock.appState("background")
        expect(h.syncs).toEqual(["start"])
    })

    it("Sync now runs a manual sync and checks requests", async () => {
        const h = harness()
        h.clock.start("active")
        await h.clock.syncNow()
        expect(h.syncs.at(-1)).toBe("manual")
        expect(h.requests()).toBe(2)
    })

    it("a failing sync or request check does not stop the clock", () => {
        let ticks = 0
        let run: (() => void) | null = null
        const clock = createSyncClock({
            sync: async () => {
                ticks++
                throw new Error("offline")
            },
            checkRequests: async () => {
                throw new Error("offline")
            },
            now: () => 0,
            every: (_ms, next) => {
                run = next
                return () => undefined
            },
        })
        clock.start("active")
        run!()
        run!()
        expect(ticks).toBe(3)
    })
})
