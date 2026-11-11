import { describe, expect, it } from "vitest"
import { bottomPad, controlSizes, topPad } from "./control-sizes"

describe("controlSizes", () => {
    it("uses the portrait values below 560dp", () => {
        expect(controlSizes(384)).toMatchObject({ button: 44, icon: 20, play: 60, seek: 48, centerGap: 20, padX: 6, padTop: 4, padBottom: 2, timeText: 12, track: 3, thumb: 12 })
    })

    it("uses media-core-controls.css's 560px tier on a landscape phone", () => {
        expect(controlSizes(560)).toMatchObject({ button: 44, icon: 22, play: 76, seek: 60, centerGap: 40, padX: 14, padTop: 10, padBottom: 6, timeText: 14, track: 4, thumb: 14 })
        expect(controlSizes(999)).toMatchObject({ padX: 14, timeText: 14 })
    })

    it("uses media-core-controls.css's 1000px tier on a tablet", () => {
        expect(controlSizes(1280)).toEqual({
            button: 48, icon: 24, play: 88, playIcon: 38, seek: 68, centerGap: 64, padX: 24, padTop: 14, padBottom: 8, timeText: 15, titleText: 15, track: 5, thumb: 16,
        })
    })
})

describe("bottomPad", () => {
    it("keeps at least 1.25rem under the tablet's time bar", () => {
        expect(bottomPad(1280, true, 0)).toBe(28)
        expect(bottomPad(1280, false, 48)).toBe(56)
    })

    it("keeps media-core-controls.css's max(1.25rem, inset) under the bar on a phone filling the screen", () => {
        // upright: --vc-pad-b .125rem + 1.25rem; landscape (560px tier): .375rem + 1.25rem
        expect(bottomPad(384, true, 0)).toBe(22)
        expect(bottomPad(823, true, 0)).toBe(26)
        expect(bottomPad(823, true, 48)).toBe(54)
    })

    it("sits on the system inset while the phone player does not fill the screen", () => {
        expect(bottomPad(384, false, 40)).toBe(42)
    })
})

describe("topPad", () => {
    it("is only --vc-pad-t while the player fills the screen (env top 0 in the old WebView)", () => {
        expect(topPad(823, true, 30)).toBe(10)
        expect(topPad(384, true, 30)).toBe(4)
        expect(topPad(1280, true, 0)).toBe(14)
    })

    it("stays under the system inset otherwise", () => {
        expect(topPad(384, false, 30)).toBe(34)
    })
})
