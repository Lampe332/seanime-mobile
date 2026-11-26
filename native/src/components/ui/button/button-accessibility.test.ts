import { describe, expect, it } from "vitest"
import { buttonAccessibility } from "./button-accessibility"

describe("what a button tells the screen reader", () => {
    it("names a text button by its text, so Android writes its description again once it is no longer busy", () => {
        expect(buttonAccessibility({ children: "Signing in…", disabled: true, loading: true }))
            .toEqual({ accessibilityLabel: "Signing in…", accessibilityState: { disabled: true, busy: true } })
        expect(buttonAccessibility({ children: "Sign in", disabled: false, loading: false }))
            .toEqual({ accessibilityLabel: "Sign in", accessibilityState: { disabled: false, busy: false } })
    })

    it("keeps a label given by hand and gives none to a button without text", () => {
        expect(buttonAccessibility({ label: "Close", children: "×", disabled: false, loading: false }).accessibilityLabel).toBe("Close")
        expect(buttonAccessibility({ children: undefined, disabled: false, loading: false })).not.toHaveProperty("accessibilityLabel")
    })
})
