import { describe, expect, it } from "vitest"
import { vc_fullscreenFlipFrame } from "./video-core-fullscreen"

describe("vc_fullscreenFlipFrame", () => {
    const full = { left: 0, top: 0, width: 1280, height: 800 }

    it("scales the 16:10 screen evenly onto a 16:9 inline box and clips the letterbox", () => {
        const frame = vc_fullscreenFlipFrame({ left: 25, top: 89, width: 720, height: 405 }, full, 8)
        // 720 / 1280 covers the box; 405 / 800 would leave it uncovered
        expect(frame.scale).toBe("0.5625")
        expect(frame.translate).toBe("-255px -108.5px")
        // 405 / .5625 = 720 tall in the screen's own coordinates: 40px clipped top and bottom, nothing at the sides
        expect(frame.clipPath).toBe("inset(40px 0px round 14.22px)")
    })

    it("does not move or clip a player that already fills the screen", () => {
        expect(vc_fullscreenFlipFrame(full, full, 0)).toEqual({ translate: "0px 0px", scale: "1", clipPath: "inset(0px 0px round 0px)" })
    })
})
