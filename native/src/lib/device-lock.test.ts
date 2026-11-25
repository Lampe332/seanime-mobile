import { beforeEach, describe, expect, it, vi } from "vitest"

const native = vi.hoisted(() => ({ level: 0, success: true, authenticate: vi.fn() }))
vi.mock("react-native", () => ({ AppState: { addEventListener: () => ({ remove: () => undefined }) } }))
vi.mock("expo-local-authentication", () => ({
    SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
    getEnrolledLevelAsync: () => Promise.resolve(native.level),
    authenticateAsync: (options: unknown) => {
        native.authenticate(options)
        return Promise.resolve({ success: native.success })
    },
}))

const { confirmWithDeviceLock, hasDeviceLock, onDeviceLockPrompt } = await import("./device-lock")

describe("device lock", () => {
    beforeEach(() => {
        native.authenticate.mockClear()
        native.level = 1
        native.success = true
    })

    // (c) a device lock removed after the app lock was turned on: the app opens without asking, nobody is locked out
    it("confirms without a prompt when the device has no lock", async () => {
        native.level = 0
        expect(await hasDeviceLock()).toBe(false)
        expect(await confirmWithDeviceLock("Unlock")).toBe(true)
        expect(native.authenticate).not.toHaveBeenCalled()
    })

    it("asks the device lock and stays locked on a cancel", async () => {
        expect(await confirmWithDeviceLock("Unlock")).toBe(true)
        native.success = false
        expect(await confirmWithDeviceLock("Unlock")).toBe(false)
        expect(native.authenticate).toHaveBeenCalledTimes(2)
    })

    // (a) the app lock ignores the background trip of the prompt between these two calls
    it("tells its listeners when a prompt opens and closes", async () => {
        const seen: boolean[] = []
        const stop = onDeviceLockPrompt(open => seen.push(open))
        await confirmWithDeviceLock("Unlock")
        stop()
        await confirmWithDeviceLock("Unlock")
        expect(seen).toEqual([true, false])
    })
})
