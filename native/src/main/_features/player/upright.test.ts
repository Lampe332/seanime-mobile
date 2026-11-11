import { describe, expect, it } from "vitest"
import { heldUpright, orientationDegrees } from "./upright"

const deg = (tilt: number) => {
    // a phone standing at `tilt`° clockwise from upright, gravity in the screen plane (values in g, Android signs)
    const r = tilt * Math.PI / 180
    return orientationDegrees(-Math.sin(r), Math.cos(r), 0)
}

describe("upright after fullscreen (OrientationEventListener rules)", () => {
    it("reads upright, sideways and upside down", () => {
        expect(orientationDegrees(0, 1, 0)).toBe(0)
        expect(orientationDegrees(1, 0, 0)).toBe(270)
        expect(orientationDegrees(-1, 0, 0)).toBe(90)
        expect(orientationDegrees(0, -1, 0)).toBe(180)
    })

    it("decides nothing while the phone lies flat", () => {
        expect(orientationDegrees(0, 0, 1)).toBeNull()
        expect(orientationDegrees(0.2, 0.3, 0.93)).toBeNull()
        expect(heldUpright(null)).toBe(false)
    })

    it("counts 0° ± 30° as upright, from 31° to 329° not", () => {
        expect(heldUpright(deg(0))).toBe(true)
        expect(heldUpright(deg(30))).toBe(true)
        expect(heldUpright(deg(-30))).toBe(true)
        expect(heldUpright(deg(31))).toBe(false)
        expect(heldUpright(deg(-31))).toBe(false)
        expect(heldUpright(deg(90))).toBe(false)
        expect(heldUpright(deg(180))).toBe(false)
    })

    it("reads a tilted but standing phone (more than ~27° off flat)", () => {
        expect(heldUpright(orientationDegrees(0, 0.6, 0.8))).toBe(true)
    })
})
