import { describe, expect, it } from "vitest"
import { backStep, canTurnScreen, isFullscreenWindow, loadStart, MINI_BAR, MINI_CARD, miniFrame, miniPlayCommand, orientationTarget, progressFraction } from "./player-chrome"

const back = (over: Partial<Parameters<typeof backStep>[0]>) =>
    backStep({ overlayOpen: false, mini: false, fullscreen: false, isTablet: false, turnedByApp: false, ...over })

describe("player frame (r21)", () => {
    it("Back closes the player like 2.0.x, after leaving fullscreen first", () => {
        expect(back({})).toBe("close")
        expect(back({ fullscreen: true })).toBe("exit-fullscreen")
        expect(back({ fullscreen: true, turnedByApp: true })).toBe("exit-fullscreen")
        // an open menu/sheet and the mini player leave Back to others
        expect(back({ overlayOpen: true, fullscreen: true })).toBe("pass")
        expect(back({ mini: true })).toBe("pass")
    })

    it("a tablet's own landscape is not left by Back, a landscape the app turned is", () => {
        expect(back({ isTablet: true, fullscreen: true })).toBe("close")
        expect(back({ isTablet: true, fullscreen: true, turnedByApp: true })).toBe("exit-fullscreen")
        expect(back({ isTablet: true })).toBe("close")
    })

    it("fullscreen is the landscape window, so the button always turns the screen", () => {
        expect(isFullscreenWindow(3088, 1440)).toBe(true)
        expect(isFullscreenWindow(1440, 3088)).toBe(false)
        expect(isFullscreenWindow(1000, 1000)).toBe(false)
        expect(orientationTarget(true, false)).toBe("landscape")
        expect(orientationTarget(true, true)).toBe("landscape")
        expect(orientationTarget(false, false)).toBe("portrait-hold")
        expect(orientationTarget(false, true)).toBe("portrait")
    })

    it("Android 16 tablets do not let the app turn the screen, phones and older tablets do", () => {
        expect(canTurnScreen(36, 2560, 1600)).toBe(false)
        expect(canTurnScreen(37, 800, 1280)).toBe(false)
        expect(canTurnScreen(36, 412, 915)).toBe(true)
        expect(canTurnScreen(35, 2560, 1600)).toBe(true)
    })

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
