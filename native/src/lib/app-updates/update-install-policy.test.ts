import { describe, expect, it } from "vitest"
import { installed } from "./update-install-policy"

// UpdateInstallPolicyTest.kt, 1:1
describe("UpdateInstallPolicy", () => {
    it("only installed target confirms success", () => {
        expect(installed(31024, 31025, 31024)).toBe(false)
        expect(installed(31024, 31025, 31025)).toBe(true)
        expect(installed(31024, 31025, 31026)).toBe(true)
    })
    it("missing or non-increasing transaction never confirms", () => {
        expect(installed(-1, 31025, 31025)).toBe(false)
        expect(installed(31024, -1, 31025)).toBe(false)
        expect(installed(31025, 31025, 31025)).toBe(false)
        expect(installed(31025, 31024, 31026)).toBe(false)
    })
})
