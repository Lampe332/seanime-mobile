import { describe, expect, it } from "vitest"
import { MangaReadingDirection } from "./manga-chapter-reader.atoms"
import {
    clampGestureScale,
    clampTranslate,
    DOUBLE_TAP_ZOOM,
    doubleTapScale,
    GESTURE_ZOOM_MAX,
    isDoubleTap,
    pageStepToSide,
    pinchScale,
    settleScale,
    swipePageStep,
    translateForZoom,
} from "./reader-gestures"

const LTR = MangaReadingDirection.LTR
const RTL = MangaReadingDirection.RTL

describe("swipePageStep", () => {
    it("reads on when swiping to the left in left-to-right books, goes back to the right", () => {
        expect(swipePageStep({ dx: -120, dy: 10, durationMs: 200 }, LTR, 1)).toBe("next")
        expect(swipePageStep({ dx: 120, dy: 10, durationMs: 200 }, LTR, 1)).toBe("previous")
    })
    it("mirrors in right-to-left books", () => {
        expect(swipePageStep({ dx: 120, dy: 0, durationMs: 200 }, RTL, 1)).toBe("next")
        expect(swipePageStep({ dx: -120, dy: 0, durationMs: 200 }, RTL, 1)).toBe("previous")
    })
    it("ignores short, slow, mostly vertical or zoomed swipes", () => {
        expect(swipePageStep({ dx: -30, dy: 0, durationMs: 100 }, LTR, 1)).toBeNull()
        expect(swipePageStep({ dx: -200, dy: 0, durationMs: 1200 }, LTR, 1)).toBeNull()
        expect(swipePageStep({ dx: -100, dy: 90, durationMs: 200 }, LTR, 1)).toBeNull()
        expect(swipePageStep({ dx: -200, dy: 0, durationMs: 200 }, LTR, 2)).toBeNull()
    })
})

describe("pageStepToSide", () => {
    it("matches the tap zones of both directions", () => {
        expect(pageStepToSide("next", LTR)).toBe("right")
        expect(pageStepToSide("previous", LTR)).toBe("left")
        expect(pageStepToSide("next", RTL)).toBe("left")
        expect(pageStepToSide("previous", RTL)).toBe("right")
    })
})

describe("zoom limits", () => {
    it("clamps to 1..max and survives garbage", () => {
        expect(clampGestureScale(0.4)).toBe(1)
        expect(clampGestureScale(99)).toBe(GESTURE_ZOOM_MAX)
        expect(clampGestureScale(NaN)).toBe(1)
    })
    it("scales a pinch by the finger distance", () => {
        expect(pinchScale(1, 100, 200)).toBe(2)
        expect(pinchScale(2, 100, 400)).toBe(GESTURE_ZOOM_MAX)
        expect(pinchScale(2, 100, 10)).toBe(1)
        expect(pinchScale(1.5, 0, 50)).toBe(1.5)
    })
    it("snaps a pinch that ends almost at 1", () => {
        expect(settleScale(1.04)).toBe(1)
        expect(settleScale(1.5)).toBe(1.5)
    })
    it("double tap zooms in from 1 and out again", () => {
        expect(doubleTapScale(1)).toBe(DOUBLE_TAP_ZOOM)
        expect(doubleTapScale(2.5)).toBe(1)
        expect(doubleTapScale(1.3)).toBe(1)
    })
})

describe("clampTranslate", () => {
    it("keeps zoomed content covering the viewport", () => {
        // 400 wide content, 400 viewport, scale 2: the translation may go from -400 to 0
        expect(clampTranslate(50, 0, 400, 400, 2)).toBe(0)
        expect(clampTranslate(-900, 0, 400, 400, 2)).toBe(-400)
        expect(clampTranslate(-150, 0, 400, 400, 2)).toBe(-150)
    })
    it("centers content that is smaller than the viewport", () => {
        expect(clampTranslate(30, 0, 200, 400, 1)).toBe(100)
    })
    it("takes the scroll of the viewport into account", () => {
        // scrolled 100 down: the content is visually shifted up by 100 before the transform
        expect(clampTranslate(500, 100, 800, 400, 2)).toBe(100)
        expect(clampTranslate(-5000, 100, 800, 400, 2)).toBe(400 - 1600 + 100)
    })
})

describe("translateForZoom", () => {
    it("keeps the content point under the focal point fixed", () => {
        // content x = 150 sits at viewport 150 at scale 1; zooming to 2.5 around it keeps it there
        const t = translateForZoom(0, 0, 150, 1, 2.5)
        expect(150 * 2.5 + t).toBeCloseTo(150)
        // and when already zoomed
        const t2 = translateForZoom(t, 0, 300, 2.5, 4)
        const contentX = (300 - t) / 2.5
        expect(contentX * 4 + t2).toBeCloseTo(300)
    })
    it("returns to the identity at scale 1 when zooming out around the same point", () => {
        expect(translateForZoom(-300, 0, 200, 2.5, 1)).toBeCloseTo(0)
    })
})

describe("isDoubleTap", () => {
    const a = { x: 100, y: 100, time: 1000 }
    it("needs a close second tap in time and place", () => {
        expect(isDoubleTap(null, a)).toBe(false)
        expect(isDoubleTap(a, { x: 110, y: 105, time: 1200 })).toBe(true)
        expect(isDoubleTap(a, { x: 110, y: 105, time: 1500 })).toBe(false)
        expect(isDoubleTap(a, { x: 300, y: 100, time: 1100 })).toBe(false)
    })
})
