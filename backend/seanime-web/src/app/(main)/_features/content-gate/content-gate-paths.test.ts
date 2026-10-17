import { describe, expect, it } from "vitest"
import { isContentGateAllowedPath } from "./content-gate-paths"

describe("content gate paths", () => {
    it("keeps setup pages reachable", () => {
        for (const p of ["/settings", "/extensions", "/extensions/playground", "/auth/callback", "/android-downloads", "/offline/entry/anime"]) {
            expect(isContentGateAllowedPath(p)).toBe(true)
        }
    })
    it("hides every page that shows anime or manga", () => {
        for (const p of ["/", "/discover", "/search", "/schedule", "/lists", "/manga", "/manga/entry", "/entry", "/settingsx"]) {
            expect(isContentGateAllowedPath(p)).toBe(false)
        }
    })
})
