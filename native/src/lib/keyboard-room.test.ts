import { describe, expect, it } from "vitest"
import { bottomClearance, phoneSheetMaxHeight, sheetBodyMaxHeight, sheetFooterTop } from "./keyboard-room"

describe("phone sheet sizes", () => {
    it("is the screen less the bottom clearance and 16dp, without the top (cutout) inset", () => {
        expect(phoneSheetMaxHeight(823.5, 0)).toBe(807.5)
        expect(phoneSheetMaxHeight(823.5, 300)).toBe(507.5)
    })

    it("lets head, body and padding fill the sheet exactly (compact and regular head)", () => {
        const sheetMax = 807.5
        // compact: 16 top, 12 to the body; regular: 20 top, 16 to the body
        for (const [topPadding, headGap] of [[16, 12], [20, 16]]) {
            const body = sheetBodyMaxHeight({ sheetMax, topPadding, headHeight: 25, headGap, footHeight: 0 })
            expect(topPadding + 25 + headGap + body + 12).toBe(sheetMax)
        }
    })

    it("puts the footer the body gap plus .75rem under the body (compact: .75rem + .5rem)", () => {
        expect(sheetFooterTop({})).toBe(32)
        expect(sheetFooterTop({ dense: true })).toBe(28)
        expect(sheetFooterTop({ compact: true })).toBe(20)
    })

    it("keeps at least 120dp of body", () => {
        expect(sheetBodyMaxHeight({ sheetMax: 200, topPadding: 20, headHeight: 60, headGap: 16, footHeight: 60 })).toBe(120)
    })
})

describe("bottomClearance", () => {
    it("keeps the bottom inset while no keyboard is up", () => {
        expect(bottomClearance(0, 24)).toBe(24)
    })

    it("sits on the keyboard while it is up", () => {
        expect(bottomClearance(900, 24)).toBe(900)
    })

    it("never goes below the inset, even for a tiny keyboard bar", () => {
        expect(bottomClearance(10, 24)).toBe(24)
    })
})
