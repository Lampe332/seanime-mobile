import { describe, expect, it } from "vitest"
import { HEAD_ACTION_OVERHANG, HEAD_ACTION_SIZE, HEADING_LINE_HEIGHT } from "@/components/shared/page-head"
import { pageTop } from "@/components/shared/page-top"
import { stackedToast, toast, toasterFrame, getToasts, TOAST_TOP_UNDER_HEAD } from "./toast-store"

// sonner 2.0.7 as 2.0.32 used it: <Toaster position="top-right" visibleToasts={4} />, its top under the page head's buttons
describe("toaster frame", () => {
    it("spans a phone 16dp from the sides (max-width: 600px)", () => {
        expect(toasterFrame(384, 0)).toMatchObject({ left: 16, right: 16 })
        expect(toasterFrame(600, 0)).toMatchObject({ left: 16, right: 16 })
    })

    it("is 356dp wide, 24dp from the right when wider", () => {
        expect(toasterFrame(601, 0)).toMatchObject({ right: 24, width: 356 })
        expect(toasterFrame(1280, 0)).toMatchObject({ right: 24, width: 356 })
    })

    it("starts below the head's buttons on phone and tablet, so it never covers them", () => {
        // page-head.ts: the 32dp title line with the 48dp buttons overhanging it by 8dp; Home's buttons end ~53dp down
        const pageHeadButtonsEnd = HEADING_LINE_HEIGHT + HEAD_ACTION_OVERHANG
        expect(pageHeadButtonsEnd + HEAD_ACTION_OVERHANG).toBe(HEAD_ACTION_SIZE)
        expect(TOAST_TOP_UNDER_HEAD).toBeGreaterThanOrEqual(53 + 8)
        for (const insetTop of [0, 30, 48]) {
            expect(toasterFrame(384, insetTop).top).toBe(pageTop(insetTop) + TOAST_TOP_UNDER_HEAD)
            expect(toasterFrame(1280, insetTop).top).toBe(pageTop(insetTop) + TOAST_TOP_UNDER_HEAD)
            expect(toasterFrame(384, insetTop).top - pageTop(insetTop)).toBeGreaterThan(pageHeadButtonsEnd)
        }
        expect(toasterFrame(384, 30).top).toBe(98)
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
