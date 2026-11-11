import { describe, expect, it } from "vitest"
import {
    backStep, boxFrame, type BoxGeometry, boxOwner, boxVisible, isScrollDrag, loadStart, MINI_BAR, MINI_CARD, miniFrame, miniPlayCommand,
    orientationTarget, playerView, progressFraction, scrollTarget, viewTurn,
} from "./player-chrome"
import { BOX_COMPACT_HEIGHT, boxControlSizes, controlSizes } from "./control-sizes"

describe("player places (r22): full, box, mini", () => {
    it("small plays in the box while its page shows it, else in the mini player; not small is fullscreen", () => {
        expect(playerView(false, false)).toBe("full")
        expect(playerView(false, true)).toBe("full")
        expect(playerView(true, true)).toBe("box")
        expect(playerView(true, false)).toBe("mini")
    })

    it("the online page's box holds its own stream, the anime page's box every other stream of that anime", () => {
        expect(boxOwner(true, 123)).toBe("online")
        expect(boxOwner(false, 123)).toBe("media:123")
        expect(boxOwner(false, undefined)).toBeNull()
        expect(boxOwner(false, 0)).toBeNull()
    })

    it("Back in fullscreen makes the player small, it never closes it; box and mini leave Back to the page", () => {
        expect(backStep({ overlayOpen: false, view: "full" })).toBe("shrink")
        expect(backStep({ overlayOpen: false, view: "box" })).toBe("pass")
        expect(backStep({ overlayOpen: false, view: "mini" })).toBe("pass")
        // an open menu or sheet answers Back first
        expect(backStep({ overlayOpen: true, view: "full" })).toBe("pass")
    })

    it("a phone turns landscape for fullscreen and upright for box/mini, a tablet is never turned", () => {
        expect(viewTurn("full", false)).toBe("landscape")
        expect(viewTurn("box", false)).toBe("upright")
        expect(viewTurn("mini", false)).toBe("upright")
        expect(viewTurn("full", true)).toBe("none")
        expect(viewTurn("box", true)).toBe("none")
        expect(orientationTarget(true, false)).toBe("landscape")
        expect(orientationTarget(false, false)).toBe("portrait-hold")
        expect(orientationTarget(false, true)).toBe("portrait")
    })
})

describe("the box follows the page (r22)", () => {
    // S22 upright: the scroll area is the whole window, status bar 40dp, the box 380×214 at 16dp in, 900dp down the content
    const phone: BoxGeometry = { viewport: { x: 0, y: 0, width: 412, height: 915 }, content: { x: 16, y: 900, width: 380, height: 214 }, topInset: 40 }

    it("is clipped to the page under the status bar and moves up by the scroll offset", () => {
        const at0 = boxFrame(phone, 0)
        expect(at0.clip).toEqual({ left: 0, top: 40, width: 412, height: 875 })
        expect(at0.box).toEqual({ left: 16, top: 860, width: 380, height: 214 })
        const at500 = boxFrame(phone, 500)
        expect(at500.box.top).toBe(360)
        // scrolled 1 dp further, 1 dp higher: the box sticks to the page
        expect(boxFrame(phone, 501).box.top).toBe(359)
    })

    it("knows when it is scrolled out of the page", () => {
        expect(boxVisible(phone, 0)).toBe(true)
        // its bottom edge just above the clip's top
        expect(boxVisible(phone, 900 + 214 - 40)).toBe(false)
        expect(boxVisible(phone, 900 + 214 - 41)).toBe(true)
    })

    it("tablet with the rail: the scroll area starts beside the rail and below nothing", () => {
        const tablet: BoxGeometry = { viewport: { x: 96, y: 0, width: 1184, height: 800 }, content: { x: 24, y: 420, width: 1136, height: 639 }, topInset: 24 }
        const f = boxFrame(tablet, 100)
        expect(f.clip).toEqual({ left: 96, top: 24, width: 1184, height: 776 })
        expect(f.box).toEqual({ left: 24, top: 0 + 420 - 100 - 24, width: 1136, height: 639 })
    })

    it("a vertical drag on the box scrolls the page, a sideways one does not", () => {
        expect(isScrollDrag(0, 11)).toBe(true)
        expect(isScrollDrag(0, -11)).toBe(true)
        expect(isScrollDrag(0, 10)).toBe(false)
        expect(isScrollDrag(30, 20)).toBe(false)
        expect(scrollTarget(500, 120, 2000)).toBe(380)
        expect(scrollTarget(50, 120, 2000)).toBe(0)
        expect(scrollTarget(1950, -120, 2000)).toBe(2000)
    })

    it("a phone's box (214dp high) gets a smaller centre that fits between its bars, a tablet's keeps the width's sizes", () => {
        const phoneBox = boxControlSizes(380, 214)
        expect(phoneBox.button).toBe(controlSizes(380).button)
        expect(phoneBox.play).toBe(48)
        expect(phoneBox.seek).toBe(40)
        // top bar 4 + 44, bottom bar 8 + 44 + 44 + 2: 72dp room, the 48dp play button fits
        expect(214 - (4 + 44) - (44 + 44 + 2)).toBeGreaterThanOrEqual(phoneBox.play)
        expect(boxControlSizes(1136, 639)).toEqual(controlSizes(1136))
        expect(boxControlSizes(700, BOX_COMPACT_HEIGHT)).toEqual(controlSizes(700))
    })
})

describe("player frame (r21)", () => {
    it("the mini player's button does what it shows", () => {
        expect(miniPlayCommand(true)).toBe("pause")
        expect(miniPlayCommand(false)).toBe("play")
    })

    it("phone: a bar docked above the navigation bar", () => {
        const f = miniFrame({ width: 412, rail: false, navBar: 56, insets: { bottom: 24, left: 0, right: 0 } })
        expect(f.kind).toBe("bar")
        expect(f.bottom).toBe(24 + 56 + MINI_BAR.margin)
        expect(f.right).toBe(MINI_BAR.margin)
        expect(f.width).toBe(412 - 2 * MINI_BAR.margin)
        expect(f.height).toBe(MINI_BAR.height)
        // a 16:9 picture inside the bar's padding
        expect(f.video).toEqual({ width: 92, height: MINI_BAR.height - 2 * MINI_BAR.pad })
    })

    it("phone landscape: the bar keeps 480dp at the right, clear of the cutout inset", () => {
        const f = miniFrame({ width: 915, rail: false, navBar: 60, insets: { bottom: 0, left: 48, right: 24 } })
        expect(f.width).toBe(MINI_BAR.maxWidth)
        expect(f.right).toBe(24 + MINI_BAR.margin)
    })

    it("tablet: 2.0.33's card 20dp from the edges, video over a row of titles and buttons", () => {
        const f = miniFrame({ width: 1280, rail: true, navBar: 56, insets: { bottom: 0, left: 0, right: 0 } })
        expect(f.kind).toBe("card")
        expect(f).toMatchObject({ right: MINI_CARD.edge, bottom: MINI_CARD.edge, width: MINI_CARD.width })
        expect(f.video).toEqual({ width: 308, height: 173 })
        expect(f.height).toBe(MINI_CARD.pad + 173 + MINI_CARD.rowHeight)
    })

    it("a loaded episode plays with Auto play, unless paused while it loaded", () => {
        expect(loadStart(true, true)).toBe("play")
        expect(loadStart(true, false)).toBe("keep")
        expect(loadStart(false, true)).toBe("pause")
        expect(loadStart(false, false)).toBe("pause")
    })

    it("progress line stays within 0…1", () => {
        expect(progressFraction(10, 40)).toBe(0.25)
        expect(progressFraction(50, 40)).toBe(1)
        expect(progressFraction(-1, 40)).toBe(0)
        expect(progressFraction(5, 0)).toBe(0)
        expect(progressFraction(Number.NaN, 40)).toBe(0)
    })
})
