import { describe, expect, it, vi } from "vitest"

const setHidden = vi.fn()
const setVisibilityAsync = vi.fn((_value: string) => Promise.resolve())
vi.mock("react-native", () => ({ TurboModuleRegistry: { get: (name: string) => name === "StatusBarManager" ? { setHidden } : null } }))
vi.mock("expo-navigation-bar", () => ({ setVisibilityAsync: (value: string) => setVisibilityAsync(value) }))

const { hideSystemBars } = await import("./system-bars")

describe("hideSystemBars", () => {
    it("hides the status bar natively every time (RN's StatusBar record would skip it) and the navigation bar", () => {
        hideSystemBars()
        hideSystemBars()
        expect(setHidden).toHaveBeenCalledTimes(2)
        expect(setHidden).toHaveBeenCalledWith(true)
        expect(setVisibilityAsync).toHaveBeenCalledWith("hidden")
    })

    it("does nothing harmful without the native module", () => {
        expect(() => hideSystemBars(null, () => Promise.reject(new Error("no window")))).not.toThrow()
    })
})
