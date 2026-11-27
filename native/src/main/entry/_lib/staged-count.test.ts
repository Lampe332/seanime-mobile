import { describe, expect, it } from "vitest"
import { FIRST_ROWS, nextStagedCount, ROW_STEP } from "./staged-count"

describe("nextStagedCount", () => {
    it("grows by a step per frame up to the total", () => {
        const seen = [FIRST_ROWS]
        while (seen[seen.length - 1] < 28) seen.push(nextStagedCount(seen[seen.length - 1], 28, ROW_STEP))
        expect(seen).toEqual([10, 18, 26, 28])
    })
    it("always moves on and never passes the total", () => {
        expect(nextStagedCount(3, 10, 0)).toBe(4)
        expect(nextStagedCount(9, 10, 8)).toBe(10)
        expect(nextStagedCount(10, 10, 8)).toBe(10)
    })
    it("first stage covers a phone screen of rows", () => {
        expect(FIRST_ROWS).toBeGreaterThanOrEqual(8)
        expect(ROW_STEP).toBeGreaterThan(0)
    })
})
