import { describe, expect, it } from "vitest"
import { cardMenuFrame } from "./card-menu-layout"

describe("cardMenuFrame", () => {
    it("docks the phone sheet .75rem above the bar with 1rem sides", () => {
        // S22 384dp wide, 64dp bar, 16dp gesture inset
        expect(cardMenuFrame(384, null, 16, 64)).toEqual({ left: 16, width: 352, bottom: 92 })
        // wide phone: capped at 32rem and centred
        expect(cardMenuFrame(800, null, 0, 64)).toEqual({ left: 144, width: 512, bottom: 76 })
    })

    it("floats the tablet sheet beside the rail, 1rem above the bottom edge (tablet.css)", () => {
        // 1280dp: room 104…1264 (1160dp) → 512 wide from 104 + 324
        expect(cardMenuFrame(1280, { width: 88 }, 0, 0)).toEqual({ left: 428, width: 512, bottom: 16 })
    })
})
