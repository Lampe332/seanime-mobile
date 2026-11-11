import { describe, expect, it } from "vitest"
import { moveInBar } from "@/lib/nav/nav-items"
import { readNavItems, resetNavigation, saveNavItems, subscribeNavItems } from "@/lib/nav/nav-store"

describe("nav store", () => {
    it("hands out a new list after every save and reset (the editor's arrows on the S22 saved without showing it)", () => {
        let calls = 0
        const stop = subscribeNavItems(() => calls++)
        const before = readNavItems()
        expect(readNavItems()).toBe(before) // same snapshot while nothing changed
        const ids = before.map(it => it.id)

        saveNavItems(moveInBar(before, before[0].id, 1))
        expect(calls).toBe(1)
        const moved = readNavItems()
        expect(moved).not.toBe(before)
        expect(moved.map(it => it.id).slice(0, 2)).toEqual([ids[1], ids[0]])

        resetNavigation()
        expect(calls).toBe(2)
        expect(readNavItems().map(it => it.id)).toEqual(ids)

        stop()
        saveNavItems(before)
        expect(calls).toBe(2)
        resetNavigation()
    })
})
