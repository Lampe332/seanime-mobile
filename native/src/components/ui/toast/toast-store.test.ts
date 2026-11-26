import { describe, expect, it } from "vitest"
import { HEAD_ACTION_OVERHANG, HEAD_ACTION_SIZE, HEADING_LINE_HEIGHT } from "@/components/shared/page-head"
import { pageTop } from "@/components/shared/page-top"
import { miniFrame } from "@/main/_features/player/player-chrome"
import { stackedToast, toast, toasterFrame, getToasts, TOAST_ABOVE_MINI, TOAST_TOP_UNDER_HEAD } from "./toast-store"

const at = (top: number, bottom = 0, right = 0) => ({ top, bottom, right })

// sonner 2.0.7 as 2.0.32 used it: <Toaster position="top-right" visibleToasts={4} />, its top under the page head's buttons
describe("toaster frame", () => {
    it("spans a phone 16dp from the sides (max-width: 600px)", () => {
        expect(toasterFrame(384, at(0))).toMatchObject({ left: 16, right: 16 })
        expect(toasterFrame(600, at(0))).toMatchObject({ left: 16, right: 16 })
    })

    it("is 356dp wide, 24dp from the right when wider", () => {
        expect(toasterFrame(601, at(0))).toMatchObject({ right: 24, width: 356 })
        expect(toasterFrame(1280, at(0))).toMatchObject({ right: 24, width: 356 })
    })

    it("starts below the head's buttons without the rail, so it never covers them", () => {
        // page-head.ts: the 32dp title line with the 48dp buttons overhanging it by 8dp; Home's buttons end ~53dp down
        const pageHeadButtonsEnd = HEADING_LINE_HEIGHT + HEAD_ACTION_OVERHANG
        expect(pageHeadButtonsEnd + HEAD_ACTION_OVERHANG).toBe(HEAD_ACTION_SIZE)
        expect(TOAST_TOP_UNDER_HEAD).toBeGreaterThanOrEqual(53 + 8)
        for (const insetTop of [0, 30, 48]) {
            expect(toasterFrame(384, at(insetTop)).top).toBe(pageTop(insetTop) + TOAST_TOP_UNDER_HEAD)
            expect(toasterFrame(1280, at(insetTop)).top).toBe(pageTop(insetTop) + TOAST_TOP_UNDER_HEAD)
            expect((toasterFrame(384, at(insetTop)).top ?? 0) - pageTop(insetTop)).toBeGreaterThan(pageHeadButtonsEnd)
        }
        expect(toasterFrame(384, at(30)).top).toBe(98)
    })
})

describe("tablet toaster frame (rail)", () => {
    const insets = { top: 30, bottom: 24, left: 0, right: 0 }
    const card = miniFrame({ width: 1280, rail: true, navBar: 64, insets })

    it("sits at the bottom right at the mini card's edges, 356dp wide, so it never covers the page's tab rows", () => {
        expect(toasterFrame(1280, at(30, 24), { rail: true, mini: null })).toEqual({ edge: "bottom", bottom: 44, right: 20, width: 356 })
        expect(toasterFrame(1280, at(30, 24, 48), { rail: true, mini: null })).toMatchObject({ right: 68 })
        expect(toasterFrame(1280, at(30, 24), { rail: true, mini: null }).top).toBeUndefined()
    })

    it("stays 12dp over the mini player while it shows", () => {
        const frame = toasterFrame(1280, at(30, 24), { rail: true, mini: card })
        expect(frame.bottom).toBe(card.bottom + card.height + TOAST_ABOVE_MINI)
        expect(frame.right).toBe(card.right)
    })

    it("leaves phones and windows without the rail at the top as before", () => {
        expect(toasterFrame(384, at(30), { rail: false, mini: null })).toEqual({ edge: "top", top: 98, left: 16, right: 16 })
        expect(toasterFrame(900, at(30), { rail: false, mini: null })).toMatchObject({ edge: "top", right: 24, width: 356 })
    })

    it("stacks older bottom toasts upwards", () => {
        expect(stackedToast(2, "bottom").translateY).toBe(-28)
        expect(stackedToast(2, "bottom").scale).toBeCloseTo(0.9)
        expect(stackedToast(0, "bottom").contentOpacity).toBe(1)
    })
})

describe("toast stack", () => {
    it("keeps the newest in front, older ones 14dp lower and 5% smaller without their content", () => {
        expect(stackedToast(0)).toEqual({ translateY: 0, scale: 1, contentOpacity: 1 })
        expect(stackedToast(1)).toEqual({ translateY: 14, scale: 0.95, contentOpacity: 0 })
        expect(stackedToast(3).translateY).toBe(42)
        expect(stackedToast(3).scale).toBeCloseTo(0.85)
    })

    it("lasts sonner's 4 s by default", () => {
        toast.dismiss()
        toast.success("AniList is up to date")
        expect(getToasts()[0]).toMatchObject({ type: "success", duration: 4000 })
        toast.dismiss()
    })
})
