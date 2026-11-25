import { describe, expect, it } from "vitest"
import { activeJumpIndex, chipRowOffset, pickerListMaxHeight, settingsColumnMaxWidth } from "./settings-page-layout"

describe("the settings column", () => {
    it("keeps the phone at 640 and lets a tablet fill up to 960", () => {
        expect(settingsColumnMaxWidth(false)).toBe(640)
        expect(settingsColumnMaxWidth(true)).toBe(960)
    })
})

describe("the active jump chip", () => {
    const tops = [0, 400, 900, 1500]
    const at = (scrollY: number) => activeJumpIndex({ tops, scrollY, viewportHeight: 600, contentHeight: 1800 })

    it("is the first group at the top of the page", () => {
        expect(at(0)).toBe(0)
        expect(at(300)).toBe(0)
    })

    it("is the group whose top passed the line under the top edge", () => {
        expect(at(380)).toBe(1)
        expect(at(396)).toBe(1)
        expect(at(899)).toBe(2)
    })

    it("is the last group once the rows reach their end", () => {
        expect(at(1200)).toBe(3)
    })

    it("is none without groups", () => {
        expect(activeJumpIndex({ tops: [], scrollY: 0, viewportHeight: 600, contentHeight: 600 })).toBe(-1)
    })
})

describe("the sheet of all options", () => {
    it("keeps the whole sheet within 85 % of the screen", () => {
        // S22: 780dp tall, a note and the reset button: 663 - 193
        expect(pickerListMaxHeight({ windowHeight: 780, hasNote: true, hasFooter: true })).toBe(470)
        expect(pickerListMaxHeight({ windowHeight: 780, hasNote: false, hasFooter: false })).toBe(590)
    })

    it("leaves room for a few options on a very short window", () => {
        expect(pickerListMaxHeight({ windowHeight: 300, hasNote: true, hasFooter: true })).toBe(160)
    })
})

describe("the chip row", () => {
    it("centres the active chip within its scroll range", () => {
        expect(chipRowOffset({ chipX: 400, chipWidth: 100, rowWidth: 300, contentWidth: 1000 })).toBe(300)
        expect(chipRowOffset({ chipX: 20, chipWidth: 100, rowWidth: 300, contentWidth: 1000 })).toBe(0)
        expect(chipRowOffset({ chipX: 900, chipWidth: 100, rowWidth: 300, contentWidth: 1000 })).toBe(700)
        expect(chipRowOffset({ chipX: 100, chipWidth: 80, rowWidth: 400, contentWidth: 300 })).toBe(0)
    })
})
