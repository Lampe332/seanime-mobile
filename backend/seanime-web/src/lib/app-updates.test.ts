import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { checkAppUpdate, downloadAppUpdate } from "./app-updates"

let target: EventTarget & { AppUpdater?: any }
beforeEach(() => { target = new EventTarget(); vi.stubGlobal("window", target) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
function reply(name: string, detail: unknown) { target.dispatchEvent(new CustomEvent(name, { detail })) }

describe("Android app update bridge", () => {
    it("never falls back to a desktop feed without the bridge", async () => {
        expect(await checkAppUpdate()).toEqual({ type: "app" })
    })
    it("uses the native app version and release payload", async () => {
        const update = { type: "app", current_version: "1.8.2", release: { version: "1.8.3" } }
        target.AppUpdater = { checkForUpdates: (requestId: string) => reply("seanime-app-update", { requestId, update }) }
        expect(await checkAppUpdate()).toEqual(update)
    })
    it("starts the APK download directly and waits for completion", async () => {
        target.AppUpdater = { downloadUpdate: vi.fn((requestId: string) => reply("seanime-app-download", { requestId, fileName: "Seanime-Mobile-1.8.3.apk" })) }
        expect(await downloadAppUpdate()).toBe("Seanime-Mobile-1.8.3.apk")
        expect(target.AppUpdater.downloadUpdate).toHaveBeenCalledOnce()
    })
    it("reports native download failures", async () => {
        target.AppUpdater = { downloadUpdate: (requestId: string) => reply("seanime-app-download", { requestId, error: "Network error" }) }
        await expect(downloadAppUpdate()).rejects.toThrow("Network error")
    })
    it("does not confuse simultaneous requests", async () => {
        const ids: string[] = []
        target.AppUpdater = { checkForUpdates: (id: string) => ids.push(id) }
        const first = checkAppUpdate(); const second = checkAppUpdate()
        reply("seanime-app-update", { requestId: ids[1], update: { type: "second" } })
        reply("seanime-app-update", { requestId: ids[0], update: { type: "first" } })
        expect((await first).type).toBe("first"); expect((await second).type).toBe("second")
    })
    it("times out a stalled check and removes its listener", async () => {
        vi.useFakeTimers()
        target.AppUpdater = { checkForUpdates: () => {} }
        const result = expect(checkAppUpdate()).rejects.toThrow("timed out")
        await vi.advanceTimersByTimeAsync(60_000)
        await result
    })
})
