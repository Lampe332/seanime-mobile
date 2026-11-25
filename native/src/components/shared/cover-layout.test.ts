import { describe, expect, it } from "vitest"
import { CARD_SIZE_FACTORS, cardSizeFactor, coverColumns, fitRowWidth, gridLayout, gridRowWidth, listColumns, ROW_GAP, ROW_GUTTER, ROW_PEEK_MAX, ROW_PEEK_MIN, rowCardWidth, rowEndPad, rowCoverWidth, scaleRowWidth, snappedOffset, snapRow } from "./cover-layout"

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

    describe("fitRowWidth (rows snap to whole cards plus a clear peek)", () => {
        /** whole cards and the share of the next one a row `viewport` wide shows at `width` */
        const view = (width: number, viewport: number) => {
            const room = viewport - ROW_GUTTER
            const whole = Math.floor(room / (width + ROW_GAP))
            return { whole, peek: (room - whole * (width + ROW_GAP)) / width }
        }
        const sizes = [CARD_SIZE_FACTORS.small, CARD_SIZE_FACTORS.normal, CARD_SIZE_FACTORS.large]

        it("shows at least one whole card and a peek between a quarter and a half at every size and screen", () => {
            for (const viewport of [280, 320, 360, 393, 411, 480, 600, 800, 1024, 1280]) {
                for (const factor of sizes) {
                    for (const desired of [rowCardWidth(viewport, factor), rowCoverWidth(viewport, false, 1, factor), rowCoverWidth(viewport, false, 2, factor)]) {
                        const { whole, peek } = view(fitRowWidth(desired, viewport), viewport)
                        expect(whole).toBeGreaterThanOrEqual(1)
                        expect(peek).toBeGreaterThanOrEqual(ROW_PEEK_MIN - 0.02)
                        expect(peek).toBeLessThanOrEqual(ROW_PEEK_MAX + 0.02)
                    }
                }
            }
        })

        it("keeps the normal size close to its old width and orders small < normal < large", () => {
            // 411dp phone: normal 160 stays 160 (two cards and a quarter); large 1½ cards, small 3¼
            expect(fitRowWidth(rowCardWidth(411), 411)).toBe(160)
            expect(view(fitRowWidth(rowCardWidth(411, 1.3), 411), 411).whole).toBe(1)
            expect(view(fitRowWidth(rowCardWidth(411, 0.7), 411), 411).whole).toBe(3)
            for (const viewport of [320, 360, 393, 411]) {
                const normal = rowCardWidth(viewport)
                expect(Math.abs(fitRowWidth(normal, viewport) - normal)).toBeLessThanOrEqual(normal * 0.1)
                const [small, mid, large] = sizes.map(factor => fitRowWidth(rowCardWidth(viewport, factor), viewport))
                expect(small).toBeLessThan(mid)
                expect(large).toBeGreaterThan(mid)
            }
        })

        it("leaves an unmeasured row at the wanted width", () => {
            expect(fitRowWidth(160, 0)).toBe(160)
            expect(fitRowWidth(0, 411)).toBe(0)
        })
    })

    it("reads an unknown stored size as normal", () => {
        expect(cardSizeFactor(undefined)).toBe(1)
        expect(cardSizeFactor("huge" as never)).toBe(1)
    })
})

describe("snapping rows on device pixels", () => {
    // ReactHorizontalScrollViewManager.setSnapToInterval: (snapToInterval: Float × density).toInt()
    const androidSnapPx = (interval: number, density: number) => Math.trunc(Math.fround(Math.fround(interval) * Math.fround(density)))
    const densities = [2.625, 3, 3.5]
    const sizes = Object.values(CARD_SIZE_FACTORS)
    const rows = (window: number, factor: number) => ({
        home: fitRowWidth(rowCardWidth(window, factor), window),
        discover: fitRowWidth(rowCoverWidth(window, false, 1, factor), window),
    })

    it("snaps every card to the gutter, ten swipes on, at every density and card size", () => {
        for (const window of [360, 393, 411, 412])
            for (const density of densities)
                for (const factor of sizes)
                    for (const desired of Object.values(rows(window, factor))) {
                        const { width, step, snapInterval } = snapRow(desired, density)
                        const intervalPx = androidSnapPx(snapInterval, density)
                        expect(Math.abs(step * density - Math.round(step * density))).toBeLessThan(1e-9)
                        expect(Math.abs(width - desired)).toBeLessThan(1 / density)
                        const start = Math.round(ROW_GUTTER * density)
                        for (let n = 0; n <= 10; n++) {
                            // the card's laid-out left edge (Yoga rounds to pixels) less the n-th snap's scroll offset
                            expect(Math.round((ROW_GUTTER + n * step) * density) - n * intervalPx).toBe(start)
                        }
                    }
    })

    it("shows the drift the plain dp interval had (Discover, large, S22 Ultra)", () => {
        const width = rows(411, CARD_SIZE_FACTORS.large).discover
        const intervalPx = androidSnapPx(width + ROW_GAP, 3.5)
        expect(Math.round((ROW_GUTTER + 10 * (width + ROW_GAP)) * 3.5) - 10 * intervalPx).not.toBe(Math.round(ROW_GUTTER * 3.5))
    })

    it("leaves an unknown density or an empty row as it was", () => {
        expect(snapRow(160, 0)).toEqual({ width: 160, step: 160 + ROW_GAP, snapInterval: 160 + ROW_GAP })
        expect(snapRow(0, 3).width).toBe(0)
    })

    it("puts a row back on the card it stood on when the card size changes", () => {
        expect(snappedOffset(0, 177, 120)).toBe(0)
        expect(snappedOffset(177 * 3, 177, 120)).toBe(360)
        expect(snappedOffset(177 * 3 + 60, 177, 120)).toBe(360)
        expect(snappedOffset(177 * 3 + 100, 177, 120)).toBe(480)
        expect(snappedOffset(500, 0, 120)).toBe(0)
    })

    it("ends a row on a card: the last scroll position is a whole number of steps", () => {
        for (const density of [2, 2.625, 3, 3.5]) {
            // a real viewport is a whole number of device pixels
            for (const viewport of [720, 1080, 1440, 2560].map(px => px / density)) {
                for (const desired of [112, 160, 269]) {
                    const { step } = snapRow(fitRowWidth(desired, viewport), density)
                    for (const count of [1, 2, 5, 13, 40]) {
                        const pad = rowEndPad(count, step, viewport, density)
                        const end = Math.round((2 * ROW_GUTTER + count * step - ROW_GAP + pad - viewport) * density)
                        expect(pad).toBeGreaterThanOrEqual(0)
                        expect(pad).toBeLessThan(step)
                        // a row that fits does not scroll and gets no room; any other ends on a step
                        if (end <= 0) expect(pad).toBe(0)
                        else expect(end % Math.round(step * density)).toBe(0)
                    }
                }
            }
        }
        expect(rowEndPad(0, 176, 411, 3)).toBe(0)
        expect(rowEndPad(5, 176, 0, 3)).toBe(0)
    })
})
