import { describe, expect, it } from "vitest"
import { pickRandom } from "./random-pick"

describe("pickRandom", () => {
    it("maps the random number onto the list", () => {
        expect(pickRandom([1, 2, 3, 4], () => 0)).toBe(1)
        expect(pickRandom([1, 2, 3, 4], () => 0.5)).toBe(3)
        expect(pickRandom([1, 2, 3, 4], () => 0.9999)).toBe(4)
    })
    it("stays inside the list for out-of-range sources", () => {
        expect(pickRandom([1, 2], () => 1)).toBe(2)
        expect(pickRandom([1, 2], () => -0.5)).toBe(1)
    })
    it("never repeats the previous pick while another title is left", () => {
        for (const r of [0, 0.3, 0.6, 0.99]) expect(pickRandom([7, 8, 9], () => r, 8)).not.toBe(8)
        expect(pickRandom([7, 8], () => 0, 7)).toBe(8)
        // one title or a previous one no longer in the list: the whole list
        expect(pickRandom([7], () => 0, 7)).toBe(7)
        expect(pickRandom([7, 8], () => 0, 5)).toBe(7)
    })
    it("is null for an empty list", () => {
        expect(pickRandom([], () => 0.5)).toBeNull()
    })
})
