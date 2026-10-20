import { describe, expect, it } from "vitest"
import { showsSidebarTrigger } from "./sidebar-trigger"

describe("Sidebar trigger (☰)", () => {
    it.each([[384, 823], [823, 384], [320, 740]])("is removed on Android phones (%i×%i)", (width, height) => {
        expect(showsSidebarTrigger("mobile", width, height)).toBe(false)
    })
    it.each([[800, 1280], [1280, 800]])("stays on Android tablets (%i×%i)", (width, height) => {
        expect(showsSidebarTrigger("mobile", width, height)).toBe(true)
    })
    it.each(["desktop", "web", undefined])("is unchanged outside the Android build (%s)", platform => {
        expect(showsSidebarTrigger(platform, 384, 823)).toBe(true)
    })
})
