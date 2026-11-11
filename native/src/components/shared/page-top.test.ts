import { describe, expect, it } from "vitest"
import { PAGE_TOP_GAP, pageTop } from "./page-top"

describe("pageTop", () => {
    it("starts right under the camera cutout plus the small gap (S22: 97 px cutout at 3.75 px/dp)", () => {
        const cutout = 97 / 3.75
        expect(pageTop(cutout)).toBeCloseTo(cutout + PAGE_TOP_GAP)
        // no 56dp navbar or 80dp strip kept free any more
        expect(pageTop(cutout)).toBeLessThan(56)
    })

    it("follows the status bar when Android shows it", () => {
        expect(pageTop(36)).toBe(36 + PAGE_TOP_GAP)
    })

    it("keeps only the gap without inset (tablet without cutout) and never goes above the edge", () => {
        expect(pageTop(0)).toBe(PAGE_TOP_GAP)
        expect(pageTop(-5)).toBe(PAGE_TOP_GAP)
        expect(pageTop(Number.NaN)).toBe(PAGE_TOP_GAP)
    })

    it("is never less than the inset, so a head never starts under the camera", () => {
        for (const inset of [0, 12, 24, 25.9, 48]) expect(pageTop(inset)).toBeGreaterThanOrEqual(inset)
    })

    it("keeps the gap small", () => {
        expect(PAGE_TOP_GAP).toBeGreaterThan(0)
        expect(PAGE_TOP_GAP).toBeLessThanOrEqual(8)
    })
})
