import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

// The app root draws its layers in source order: what comes later lies on top. Toasts must lie above sheets and dialogs
// (PortalHost), the setup tour above everything (device run 06.11.: a tablet side sheet hid the "All files access" toast).
describe("app root layers", () => {
    it("puts the toasts above the portal layer and the tour above both", () => {
        const source = readFileSync(join(__dirname, "client-providers.tsx"), "utf8")
        const portal = source.indexOf("<PortalHost />")
        const toaster = source.indexOf("<Toaster />")
        const tour = source.indexOf("<TourOverlay />")
        expect(portal).toBeGreaterThan(-1)
        expect(toaster).toBeGreaterThan(portal)
        expect(tour).toBeGreaterThan(toaster)
    })
})
