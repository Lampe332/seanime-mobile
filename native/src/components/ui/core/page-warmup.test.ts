import { describe, expect, it } from "vitest"
import { createPageWarmup, WARM_DATA, WARM_GAP_MS, WARM_HOLD_MS, WARM_QUIET_MS, WARM_SCROLL_QUIET_MS, WARM_START_MS } from "./page-warmup"

function fakeClock() {
    let time = 0
    let tasks: { at: number, run: () => void }[] = []
    const clock = {
        now: () => time,
        after: (ms: number, run: () => void) => { tasks.push({ at: time + ms, run }) },
        idle: (run: () => void) => { tasks.push({ at: time, run }) },
    }
    const advance = (ms: number) => {
        const end = time + ms
        for (;;) {
            const due = tasks.filter(task => task.at <= end).sort((a, b) => a.at - b.at)[0]
            if (!due) break
            tasks = tasks.filter(task => task !== due)
            time = Math.max(time, due.at)
            due.run()
        }
        time = end
    }
    return { clock, advance }
}

describe("page warmup", () => {
    it("builds one page per slot after the start, each once", () => {
        const { clock, advance } = fakeClock()
        const warmup = createPageWarmup(clock, ["a", "b"])
        let notified = 0
        warmup.subscribe(() => notified++)
        warmup.start()
        warmup.start()
        advance(WARM_START_MS - 1)
        expect(warmup.isWarm("a")).toBe(false)
        advance(1)
        expect(warmup.isWarm("a")).toBe(true)
        expect(warmup.isWarm("b")).toBe(false)
        advance(WARM_GAP_MS)
        expect(warmup.isWarm("b")).toBe(true)
        advance(60_000)
        expect(notified).toBe(2)
    })

    it("waits after a page switch", () => {
        const { clock, advance } = fakeClock()
        const warmup = createPageWarmup(clock, ["a"])
        warmup.start()
        advance(WARM_START_MS - 100)
        warmup.noteSwitch()
        advance(100)
        expect(warmup.isWarm("a")).toBe(false)
        advance(WARM_QUIET_MS - 100)
        expect(warmup.isWarm("a")).toBe(true)
    })

    it("waits while a finger is down and after a scroll", () => {
        const { clock, advance } = fakeClock()
        const warmup = createPageWarmup(clock, ["a"])
        warmup.start()
        advance(WARM_START_MS - 10)
        warmup.noteTouch("down")
        advance(10_000)
        expect(warmup.isWarm("a")).toBe(false)
        warmup.noteTouch("scroll")
        advance(WARM_SCROLL_QUIET_MS - 1)
        expect(warmup.isWarm("a")).toBe(false)
        advance(WARM_QUIET_MS)
        expect(warmup.isWarm("a")).toBe(true)
    })

    it("lets go of a page not visited, keeps a visited one and the data", () => {
        const { clock, advance } = fakeClock()
        const warmup = createPageWarmup(clock, [WARM_DATA, "a", "b"])
        warmup.start()
        advance(WARM_START_MS + WARM_GAP_MS * 2)
        expect([WARM_DATA, "a", "b"].every(warmup.isWarm)).toBe(true)
        warmup.noteSwitch("b")
        advance(WARM_HOLD_MS + WARM_QUIET_MS)
        expect(warmup.isWarm(WARM_DATA)).toBe(true)
        expect(warmup.isWarm("a")).toBe(false)
        expect(warmup.isWarm("b")).toBe(true)
    })

    it("skips a page visited before its turn", () => {
        const { clock, advance } = fakeClock()
        const warmup = createPageWarmup(clock, ["a"])
        warmup.noteSwitch("a")
        warmup.start()
        advance(60_000)
        expect(warmup.isWarm("a")).toBe(false)
    })

    it("does nothing before start", () => {
        const { clock, advance } = fakeClock()
        const warmup = createPageWarmup(clock, ["a"])
        advance(60_000)
        expect(warmup.isWarm("a")).toBe(false)
    })
})
