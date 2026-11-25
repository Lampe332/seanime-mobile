import { describe, expect, it } from "vitest"
import { CARD_SIZE_FACTORS, cardSizeFactor, coverColumns, gridLayout, gridRowWidth, listColumns, rowCardWidth, rowCoverWidth, scaleRowWidth } from "./cover-layout"

const CARD_GAP = 12

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

describe("tablet grid and list widths", () => {
    it("centres the end note under a row the results do not fill", () => {
        // 1153dp next to the rail: 7 columns of ~151dp; 6 results take 6 cards and 5 gaps
        const grid = gridLayout(1153, true, 1)
        expect(grid.columns).toBe(7)
        expect(gridRowWidth(6, grid, 1153)).toBeCloseTo(6 * grid.width + 5 * 16)
        expect(gridRowWidth(7, grid, 1153)).toBe(1153)
        expect(gridRowWidth(30, grid, 1153)).toBe(1153)
        expect(gridRowWidth(0, grid, 1153)).toBe(1153)
    })

    it("puts list rows in two columns only next to the rail and when both fit", () => {
        expect(listColumns(1150, false)).toBe(1)
        expect(listColumns(1150, true)).toBe(2)
        expect(listColumns(892, true)).toBe(2)
        expect(listColumns(891, true)).toBe(1)
        expect(listColumns(700, true)).toBe(1)
        expect(listColumns(4000, true)).toBe(2)
    })
})

describe("card size", () => {
    it("gives small cards more columns and large ones fewer, normal unchanged", () => {
        // S22 (379dp) and a 360dp phone (328dp): small 4, normal 3, large 2
        for (const width of [379, 328]) {
            expect(gridLayout(width, false, 1, CARD_SIZE_FACTORS.small).columns).toBe(4)
            expect(gridLayout(width, false, 1, CARD_SIZE_FACTORS.normal)).toEqual(gridLayout(width, false, 1))
            expect(gridLayout(width, false, 1).columns).toBe(3)
            expect(gridLayout(width, false, 1, CARD_SIZE_FACTORS.large).columns).toBe(2)
        }
        // tablet beside the rail: 7 normally, 10 small, 5 large
        expect(gridLayout(1144, true, 1, CARD_SIZE_FACTORS.small).columns).toBe(10)
        expect(gridLayout(1144, true, 1, CARD_SIZE_FACTORS.large).columns).toBe(5)
    })

    it("keeps two columns on a phone with large cards and large text, never more than normal allows", () => {
        // 200 % text: 156dp → 203dp cells would fit one; the floor keeps two
        expect(gridLayout(379, false, 2, CARD_SIZE_FACTORS.large).columns).toBe(2)
        // a width that fits one normal card stays at one, and an unmeasured grid at one
        expect(coverColumns(150, 100, 12, 1.3)).toBe(1)
        expect(gridLayout(0, false, 1, CARD_SIZE_FACTORS.small)).toMatchObject({ columns: 1, width: 0 })
    })

    it("keeps every row card at its old width with the normal size", () => {
        for (const width of [300, 360, 411, 600, 1280]) {
            expect(rowCardWidth(width)).toBe(Math.round(Math.min(width * 0.39, 160)))
            expect(rowCardWidth(width, CARD_SIZE_FACTORS.normal)).toBe(Math.round(Math.min(width * 0.39, 160)))
            for (const zoom of [1, 1.1, 2, 3]) {
                const old = Math.round(Math.min(width - 32 - 48, Math.max(Math.min(width * 0.36, 140 * zoom), 112 * zoom)))
                expect(rowCoverWidth(width, false, zoom, CARD_SIZE_FACTORS.normal)).toBe(old)
            }
        }
        expect(rowCoverWidth(1280, true, 1, CARD_SIZE_FACTORS.normal)).toBe(152)
    })

    it("makes row cards smaller with small and larger with large, so a row shows more or fewer", () => {
        // 411dp phone: 160 normal → 112 small, 208 large; Discover 140 → 98, 182; tablet 152 → 106, 198
        expect([rowCardWidth(411, 0.7), rowCardWidth(411, 1), rowCardWidth(411, 1.3)]).toEqual([112, 160, 208])
        expect([rowCoverWidth(411, false, 1, 0.7), rowCoverWidth(411, false, 1), rowCoverWidth(411, false, 1, 1.3)]).toEqual([98, 140, 182])
        expect([rowCoverWidth(1280, true, 1, 0.7), rowCoverWidth(1280, true, 1, 1.3)]).toEqual([106, 198])
        for (const width of [320, 360, 411]) {
            const visible = (card: number) => (width - 16 + CARD_GAP) / (card + CARD_GAP)
            expect(visible(rowCardWidth(width, 0.7))).toBeGreaterThan(visible(rowCardWidth(width)))
            expect(visible(rowCardWidth(width, 1.3))).toBeLessThan(visible(rowCardWidth(width)))
        }
    })

    it("never makes a large row card wider than 70 % of the screen, nor shrinks normal for it", () => {
        // 200 % text on 360dp: 224 normal, large capped at 252 (70 %) instead of 291
        expect(rowCoverWidth(360, false, 2, 1.3)).toBe(252)
        // 300 % text on 300dp: normal 220 already fills the screen less 5rem; large keeps it
        expect(rowCoverWidth(300, false, 3, 1.3)).toBe(220)
        for (const width of [280, 320, 360, 411, 800]) {
            expect(rowCardWidth(width, 1.3)).toBeLessThanOrEqual(Math.round(width * 0.7))
            expect(scaleRowWidth(width, width, 1.3)).toBe(width)
            expect(scaleRowWidth(100, width, 9)).toBeLessThanOrEqual(Math.max(100, Math.round(width * 0.7)))
        }
    })

    it("reads an unknown stored size as normal", () => {
        expect(cardSizeFactor(undefined)).toBe(1)
        expect(cardSizeFactor("huge" as never)).toBe(1)
    })
})
