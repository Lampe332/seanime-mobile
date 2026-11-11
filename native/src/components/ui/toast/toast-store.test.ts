import { describe, expect, it } from "vitest"
import { stackedToast, toast, toasterFrame, getToasts } from "./toast-store"

// sonner 2.0.7 as 2.0.32 used it: <Toaster position="top-right" visibleToasts={4} /> (S22 10.11.: 16dp from the top)
describe("toaster frame", () => {
    it("spans a phone 16dp from the top and the sides (max-width: 600px)", () => {
        expect(toasterFrame(384)).toEqual({ top: 16, left: 16, right: 16 })
        expect(toasterFrame(600)).toEqual({ top: 16, left: 16, right: 16 })
    })

    it("is 356dp wide, 24dp from the top right when wider", () => {
        expect(toasterFrame(601)).toEqual({ top: 24, right: 24, width: 356 })
        expect(toasterFrame(1280)).toEqual({ top: 24, right: 24, width: 356 })
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
