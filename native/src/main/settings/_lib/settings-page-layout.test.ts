import { describe, expect, it } from "vitest"
import { activeJumpIndex, chipRowOffset, focusChipId, jumpLayoutFromWindow, jumpScrollMetrics, miniCardRightPad, pickerListMaxHeight, settingsColumnMaxWidth } from "./settings-page-layout"

describe("the settings column", () => {
    it("keeps the phone at 640 and lets a tablet fill up to 960", () => {
        expect(settingsColumnMaxWidth(false)).toBe(640)
        expect(settingsColumnMaxWidth(true)).toBe(960)
    })
})

describe("the jump layout after a rotation", () => {
    // Torrents & debrid in portrait after the jump to "Auto-select" in landscape: the rows went back to their top
    const portrait = jumpLayoutFromWindow({
        frameY: 220,
        contentY: 220,
        targetYs: { providers: 220, streaming: 520, autoSelect: 980, downloads: 1260, debrid: 1610 },
    })

    it("reads the offset from the content's top, not from the last scroll event", () => {
        expect(portrait.scrollY).toBe(0)
        expect(portrait.tops).toEqual({ providers: 0, streaming: 300, autoSelect: 760, downloads: 1040, debrid: 1390 })
        expect(jumpLayoutFromWindow({ frameY: 220, contentY: -540.4, targetYs: { a: -540.4 } })).toEqual({ scrollY: 760.4, tops: { a: 0 } })
    })

    it("lights the group at the top again instead of the last one", () => {
        const tops = Object.values(portrait.tops)
        const sizes = { viewportHeight: 1900, contentHeight: 2300 }
        // the landscape offset kept the end rule on: "Debrid" lit at the top of the page
        expect(activeJumpIndex({ tops, scrollY: 500, ...sizes })).toBe(4)
        expect(activeJumpIndex({ tops, scrollY: portrait.scrollY, ...sizes })).toBe(0)
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

    it("is the last group where a fling settles a fraction short of the end", () => {
        // S22 (3.5x): the offset ends 1.7dp short of content - viewport; "Matching" / "Debrid" stayed unlit
        expect(at(1198.3)).toBe(3)
        expect(at(1190)).toBe(2)
    })

    it("lights the last chip from the momentum-end event, with that moment's sizes", () => {
        // the throttled onScroll's last event came at 1130; the fling's end reports where it settled
        const tabs = [0, 500, 1100, 1700]
        const throttled = jumpScrollMetrics({ contentOffset: { y: 1130 }, layoutMeasurement: { height: 700 }, contentSize: { height: 2000 } })
        const settled = jumpScrollMetrics({ contentOffset: { y: 1299.6 }, layoutMeasurement: { height: 700 }, contentSize: { height: 2000 } })
        expect(activeJumpIndex({ tops: tabs, ...throttled })).toBe(2)
        expect(activeJumpIndex({ tops: tabs, ...settled })).toBe(3)
    })

    it("is none without groups", () => {
        expect(activeJumpIndex({ tops: [], scrollY: 0, viewportHeight: 600, contentHeight: 600 })).toBe(-1)
    })

    // 4.4.0 device test (Playback): "External player" stayed lit while "Next episode" and "Picture" filled the view
    it("follows the groups that fill the view over the last screen of scrolling", () => {
        // Files 0, External player 500, Next episode 1300, Picture 1550, Seeking 1950; 800dp rows, 2200 content
        const playback = [0, 500, 1300, 1550, 1950]
        const view = (scrollY: number) => activeJumpIndex({ tops: playback, scrollY, viewportHeight: 800, contentHeight: 2200 })
        expect(view(600)).toBe(1)
        expect(view(1150)).toBe(2)
        expect(view(1300)).toBe(3)
        expect(view(1400)).toBe(4)
    })
})

describe("the sheet of all options", () => {
    it("keeps the whole sheet within 85 % of the screen", () => {
        // S22: 780dp tall, a note and the reset button: 663 - 193
        expect(pickerListMaxHeight({ windowHeight: 780, hasNote: true, hasFooter: true })).toBe(470)
        expect(pickerListMaxHeight({ windowHeight: 780, hasNote: false, hasFooter: false })).toBe(590)
    })

    it("takes no bound of its own in the tablet's side sheet, which bounds its body to the full height", () => {
        // Pixel Tablet emulator (2560x1600): the options ended ~290px above the sheet's bottom
        expect(pickerListMaxHeight({ windowHeight: 800, hasNote: true, hasFooter: true, sideSheet: true })).toBeUndefined()
        expect(pickerListMaxHeight({ windowHeight: 800, hasNote: true, hasFooter: true, sideSheet: false })).toBe(487)
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

describe("focusChipId", () => {
    const chips = ["Colors", "Sorting", "Cards and episodes", "Carousel"]

    it("lights the hit's group after a jump, not the group the line at the top still crosses", () => {
        // the row lands a third down: the line still crosses "Sorting", the chip must say "Cards and episodes"
        expect(chips[activeJumpIndex({ tops: [0, 400, 900, 1600], scrollY: 700, viewportHeight: 1200, contentHeight: 3000 })]).toBe("Sorting")
        expect(focusChipId(chips, "Cards and episodes")).toBe("Cards and episodes")
    })

    it("lights nothing for a hit without a group or a group without a chip", () => {
        expect(focusChipId(chips, undefined)).toBeNull()
        expect(focusChipId(chips, "Banner")).toBeNull()
        expect(focusChipId([], "Sorting")).toBeNull()
    })

    // 4.4.0 D2 (Media server): the group hit "Left out" scrolled to its group, but the page ends before it reaches the top,
    // so the scroll alone lit "Series"; the jump now lights the group's chip like a tapped one
    it("lights the chip of a group hit that cannot reach the top", () => {
        const chips = ["Series", "Left out", "Progress"]
        expect(activeJumpIndex({ tops: [0, 400, 600], scrollY: 100, viewportHeight: 900, contentHeight: 1300 })).toBe(0)
        expect(focusChipId(chips, "Left out")).toBe("Left out")
    })
})

describe("the room beside the mini player card", () => {
    const card = { right: 20, width: 320 }
    it("keeps the values of a pane clear of the card", () => {
        // Pixel Tablet landscape: the pane runs from 440 to 1260 of a 1280dp window, the card starts at 940
        expect(miniCardRightPad({ frameX: 440, frameWidth: 820, windowWidth: 1280, card })).toBe(336)
    })
    it("measures from the centred column's edge, not the frame's", () => {
        expect(miniCardRightPad({ frameX: 0, frameWidth: 1280, maxWidth: 960, windowWidth: 1280, card })).toBe(196)
    })
    it("adds nothing without the card or when the column ends before it", () => {
        expect(miniCardRightPad({ frameX: 440, frameWidth: 820, windowWidth: 1280, card: null })).toBe(0)
        expect(miniCardRightPad({ frameX: 0, frameWidth: 600, windowWidth: 1280, card })).toBe(0)
    })
})
