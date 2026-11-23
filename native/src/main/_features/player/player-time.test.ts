import { describe, expect, it } from "vitest"
import { activeSkipSegment } from "./player-logic"
import { createPlayerTimeStore } from "./player-time"

describe("createPlayerTimeStore", () => {
    it("starts at zero and keeps position and buffered apart", () => {
        const store = createPlayerTimeStore()
        expect(store.get()).toEqual({ position: 0, buffered: 0 })
        store.set({ position: 12 })
        store.set({ buffered: 30 })
        expect(store.get()).toEqual({ position: 12, buffered: 30 })
    })

    it("tells the listeners about a change only", () => {
        const store = createPlayerTimeStore()
        let calls = 0
        const stop = store.subscribe(() => calls++)
        store.set({ position: 5, buffered: 9 })
        store.set({ position: 5, buffered: 9 })
        expect(calls).toBe(1)
        stop()
        store.set({ position: 6 })
        expect(calls).toBe(1)
    })

    it("resets silently while rendering and tells the listeners on notify", () => {
        const store = createPlayerTimeStore()
        store.set({ position: 100, buffered: 120 })
        let calls = 0
        store.subscribe(() => calls++)
        store.set({ position: 0, buffered: 0 }, true)
        expect(calls).toBe(0)
        expect(store.get()).toEqual({ position: 0, buffered: 0 })
        store.notify()
        expect(calls).toBe(1)
    })

    it("a skip segment selected from the time stays the same object between ticks", () => {
        const store = createPlayerTimeStore()
        const segments = [{ start: 60, end: 150, label: "Opening" }] as Parameters<typeof activeSkipSegment>[0]
        const select = () => activeSkipSegment(segments, store.get().position)
        store.set({ position: 70 })
        const first = select()
        store.set({ position: 70.5 })
        expect(select()).toBe(first)
        store.set({ position: 151 })
        expect(select()).toBeNull()
    })
})
