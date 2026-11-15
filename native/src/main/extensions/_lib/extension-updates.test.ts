import { describe, expect, it } from "vitest"
import { extensionUpdateCount, isUpdateCheckDue, UPDATE_CHECK_EVERY_MS, updateDotOn } from "./extension-updates"

describe("extension updates", () => {
    const now = Date.UTC(2026, 10, 15, 8)

    it("checks at start when never checked, after a day, or when the clock went back", () => {
        expect(isUpdateCheckDue(null, now)).toBe(true)
        expect(isUpdateCheckDue(0, now)).toBe(true)
        expect(isUpdateCheckDue(now - UPDATE_CHECK_EVERY_MS, now)).toBe(true)
        expect(isUpdateCheckDue(now + 60_000, now)).toBe(true)
    })

    it("does not check again within a day", () => {
        expect(isUpdateCheckDue(now - 60_000, now)).toBe(false)
        expect(isUpdateCheckDue(now - UPDATE_CHECK_EVERY_MS + 1, now)).toBe(false)
    })

    it("counts each extension with an update once; not checked yet is 0", () => {
        expect(extensionUpdateCount(null)).toBe(0)
        expect(extensionUpdateCount([])).toBe(0)
        expect(extensionUpdateCount([{ extensionID: "a" }, { extensionID: "b" }, { extensionID: "a" }])).toBe(2)
    })

    it("puts the dot on the Extensions entry, or on the Menu button while Extensions is in the Menu", () => {
        expect(updateDotOn({ href: "/extensions" }, 2, true)).toBe(true)
        expect(updateDotOn({ isMenu: true }, 2, false)).toBe(true)
        expect(updateDotOn({ isMenu: true }, 2, true)).toBe(false)
        expect(updateDotOn({ href: "/lists" }, 2, false)).toBe(false)
        expect(updateDotOn({ href: "/extensions" }, 0, true)).toBe(false)
    })
})
