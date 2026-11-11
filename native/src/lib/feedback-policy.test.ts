import { describe, expect, it } from "vitest"
import { hapticType, RINGER_MODE_NORMAL, RINGER_MODE_SILENT, RINGER_MODE_VIBRATE, soundAllowed } from "./feedback-policy"

// FeedbackTest.kt, 1:1
describe("Feedback", () => {
    it("confirm and reject use their own constants from Android 11", () => {
        expect(hapticType("confirm", 30)).toBe("confirm")
        expect(hapticType("reject", 34)).toBe("reject")
    })
    it("older Android falls back to constants of API 21", () => {
        expect(hapticType("confirm", 21)).toBe("virtual-key")
        expect(hapticType("reject", 29)).toBe("long-press")
        expect(hapticType("tick", 21)).toBe("clock-tick")
        expect(hapticType("long", 21)).toBe("long-press")
    })
    it("unknown kinds do nothing", () => {
        expect(hapticType("buzz", 34)).toBeNull()
        expect(hapticType("", 34)).toBeNull()
    })
    it("sound only with ringer on and nothing playing", () => {
        expect(soundAllowed(true, RINGER_MODE_NORMAL, false)).toBe(true)
        expect(soundAllowed(false, RINGER_MODE_NORMAL, false)).toBe(false)
        expect(soundAllowed(true, RINGER_MODE_VIBRATE, false)).toBe(false)
        expect(soundAllowed(true, RINGER_MODE_SILENT, false)).toBe(false)
        expect(soundAllowed(true, RINGER_MODE_NORMAL, true)).toBe(false)
    })
})
