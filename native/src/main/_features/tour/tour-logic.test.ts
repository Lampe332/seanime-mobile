import { describe, expect, it } from "vitest"
import {
    cardButtons, cardEnterFrom, cardWidth, computePopoverPosition, dimStrips, followBackIndex, irisRect, isOffScreen, mixRect, nextIndex, padRect,
    prevIndex, resolvePlacement, spotlightPath,
} from "./tour-logic"

describe("the spotlight's moves (E5)", () => {
    const a = { top: 100, left: 20, width: 60, height: 40 }
    const b = { top: 500, left: 220, width: 160, height: 80 }
    it("glides the cutout from target to target", () => {
        expect(mixRect(a, b, 0)).toEqual(a)
        expect(mixRect(a, b, 1)).toEqual(b)
        expect(mixRect(a, b, 0.5)).toEqual({ top: 300, left: 120, width: 110, height: 60 })
    })
    it("opens the iris from the target's centre", () => {
        expect(irisRect(a)).toEqual({ top: 120, left: 50, width: 0, height: 0 })
        // a cutout of no size draws no hole
        expect(spotlightPath(phone, irisRect(a))).toBe(spotlightPath(phone, null))
    })
    it("lets a card come out of its target's side, its origin on the edge facing the target", () => {
        expect(cardEnterFrom("bottom", 18)).toEqual({ dx: 0, dy: -18, origin: "50% 0%" })
        expect(cardEnterFrom("top", 18)).toEqual({ dx: 0, dy: 18, origin: "50% 100%" })
        expect(cardEnterFrom("left", 22)).toEqual({ dx: 22, dy: 0, origin: "100% 50%" })
        expect(cardEnterFrom("right", 22)).toEqual({ dx: -22, dy: 0, origin: "0% 50%" })
    })
})

const phone = { width: 384, height: 823 }

// the mobile tutorial's order (mobile-tutorial.tsx), targets as registered
const steps = [
    { id: "welcome" },
    { id: "menu", target: "nav-menu" },
    { id: "extensions", target: "menu-extensions" },
    { id: "marketplace-tab", target: "extensions-marketplace-tab" },
    { id: "change-repo", target: "marketplace-change-repo" },
    { id: "paste-url", target: "marketplace-repo-sheet" },
    { id: "streaming-tab", target: "marketplace-type:onlinestream-provider" },
    { id: "install", target: "marketplace-install:onlinestream-provider" },
    { id: "manga", target: "marketplace-type:manga-provider", disableBack: true },
    { id: "manga-install", target: "marketplace-install:manga-provider", disableBack: true },
    { id: "done", disableBack: true },
]

describe("tour step order", () => {
    it("goes forward and ends after the last step", () => {
        expect(nextIndex(steps, 0)).toBe(1)
        expect(nextIndex(steps, steps.length - 1)).toBeNull()
    })

    it("Back goes one step back, not from the first or a one-way step", () => {
        expect(prevIndex(steps, 3)).toBe(2)
        expect(prevIndex(steps, 0)).toBeNull()
        expect(prevIndex(steps, 8)).toBeNull()
    })

    it("follows Android Back to the latest earlier step whose target is shown (F2)", () => {
        // Back closed the menu on "Extensions": only the bar's Menu button is left
        expect(followBackIndex(steps, 2, target => target === "nav-menu")).toBe(1)
        // Back closed the repository sheet: the marketplace's repository button is still there
        const onMarketplace = new Set(["nav-menu", "extensions-marketplace-tab", "marketplace-change-repo"])
        expect(followBackIndex(steps, 5, target => onMarketplace.has(target))).toBe(4)
        // nothing earlier on screen: the tour ends
        expect(followBackIndex(steps, 3, () => false)).toBe(-1)
        // the welcome card has no target and is never a place to return to
        expect(followBackIndex(steps, 1, () => true)).toBe(-1)
    })
})

describe("tour card buttons", () => {
    it("a tap-to-continue step shows only Skip next to its target", () => {
        expect(cardButtons({ hideNextButton: true }, 3, 11, false)).toEqual({ skip: true, back: false, next: false })
    })

    it("the same step as a centred fallback gets Next and Back (F5)", () => {
        expect(cardButtons({ hideNextButton: true }, 3, 11, true)).toEqual({ skip: true, back: true, next: true })
    })

    it("the finale has no Skip and no Back", () => {
        expect(cardButtons({ disableBack: true }, 10, 11, true)).toEqual({ skip: false, back: false, next: true })
    })
})

describe("tour card placement", () => {
    it("keeps 32dp of the window free beside a card", () => {
        expect(cardWidth(true, phone)).toBe(352)
        expect(cardWidth(false, { width: 1280, height: 800 })).toBe(340)
        expect(cardWidth(true, { width: 1280, height: 800 })).toBe(440)
    })

    it("places the card by its own height above the Menu button with a 12dp gap (F1)", () => {
        const menu = padRect({ top: 755, left: 300, width: 76, height: 56 }, 8)
        const placement = resolvePlacement(menu, 340, 154, "top", phone)
        expect(placement).toBe("top")
        const position = computePopoverPosition(menu, 340, 154, placement, phone)
        expect(position.top + 154 + 12).toBe(menu.top)
        // clamped 16dp inside the right edge
        expect(position.left).toBe(phone.width - 16 - 340)
    })

    it("takes the side with the most room when the preferred one has none", () => {
        // a menu row on the right half of a phone: "left" is too narrow for 340dp, the bottom has the most room
        const row = { top: 200, left: 120, width: 250, height: 56 }
        expect(resolvePlacement(row, 340, 120, "left", phone)).toBe("bottom")
        // the tablet's rail: the card goes right beside it (T2)
        const tabletMenu = { top: 600, left: 8, width: 80, height: 64 }
        expect(resolvePlacement(tabletMenu, 340, 155, "right", { width: 1280, height: 800 })).toBe("right")
    })

    it("keeps a card above a sheet 12dp clear of it", () => {
        const sheet = padRect({ top: 450, left: 8, width: 368, height: 300 }, 4)
        const position = computePopoverPosition(sheet, 352, 180, resolvePlacement(sheet, 352, 180, "top", phone), phone)
        expect(sheet.top - (position.top + 180)).toBe(12)
    })
})

describe("spotlight", () => {
    it("cuts the target out of the dim layer", () => {
        expect(spotlightPath(phone, null)).toBe("M0,0 H384 V823 H0 Z")
        expect(spotlightPath(phone, { top: 10, left: 10, width: 40, height: 40 })).toContain("M18,10")
    })

    it("lets taps only through the cutout: four strips cover the rest", () => {
        const hole = { top: 100, left: 50, width: 100, height: 60 }
        const strips = dimStrips(hole, phone)
        const area = strips.reduce((sum, r) => sum + r.width * r.height, 0)
        expect(area).toBe(phone.width * phone.height - hole.width * hole.height)
        // none of them covers the cutout's middle
        const inside = (r: { top: number, left: number, width: number, height: number }) => 100 < r.left + r.width && 100 > r.left && 130 > r.top && 130 < r.top + r.height
        expect(strips.some(inside)).toBe(false)
    })

    it("knows when a target has to be scrolled into view first", () => {
        expect(isOffScreen({ top: 900, left: 0, width: 48, height: 48 }, phone, 24, 80)).toBe(true)
        expect(isOffScreen({ top: 300, left: 0, width: 48, height: 48 }, phone, 24, 80)).toBe(false)
    })
})
