import { describe, expect, it } from "vitest"
import { gridLayout, rowCoverWidth } from "./cover-layout"

describe("cover layout", () => {
    it("fits three result columns on a phone and more 8.75rem columns on a tablet", () => {
        // S22: 411dp less 2 × 16dp gutter
        expect(gridLayout(379, false, 1)).toMatchObject({ columns: 3, gap: 12, rowGap: 16 })
        expect(gridLayout(379, false, 1).width).toBeCloseTo((379 - 24) / 3)
        // 200 % text: 156dp columns → two
        expect(gridLayout(379, false, 2).columns).toBe(2)
        // tablet beside the rail: 1280 - 88 - 48
        expect(gridLayout(1144, true, 1)).toMatchObject({ columns: 7, gap: 16, rowGap: 20 })
        expect(gridLayout(0, false, 1)).toMatchObject({ columns: 1, width: 0 })
    })

    it("sizes row covers like 36vw capped by the text zoom, and 9.5rem on a tablet", () => {
        expect(rowCoverWidth(411, false, 1)).toBe(140)
        expect(rowCoverWidth(411, false, 1.1)).toBe(148)
        expect(rowCoverWidth(360, false, 1)).toBe(130)
        // large text: at least 7rem × zoom, never wider than the screen less 5rem
        expect(rowCoverWidth(360, false, 2)).toBe(224)
        expect(rowCoverWidth(300, false, 3)).toBe(220)
        expect(rowCoverWidth(1280, true, 1)).toBe(152)
    })
})
