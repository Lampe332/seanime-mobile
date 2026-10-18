import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { checkAppUpdate, downloadAppUpdate, readAppDownload } from "./app-updates"

let target: EventTarget & { AppUpdater?: any }
beforeEach(() => { target = new EventTarget(); vi.stubGlobal("window", target) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
function reply(name: string, detail: unknown) { target.dispatchEvent(new CustomEvent(name, { detail })) }

describe("Android app update bridge", () => {
    it("never falls back to a desktop feed without the bridge", async () => {
        await expect(checkAppUpdate()).rejects.toThrow("App updater unavailable")
    })
    it("uses the native app version and release payload", async () => {
        const update = { type: "app", current_version: "1.8.2", release: { version: "1.8.3" } }
        target.AppUpdater = { checkForUpdates: (requestId: string) => reply("seanime-app-update", { requestId, update }) }
        expect(await checkAppUpdate()).toEqual(update)
    })
    it("does not report an accepted download as a completed APK", async () => {
        target.AppUpdater = { downloadUpdate: vi.fn((requestId: string) => reply("seanime-app-download", { requestId, state: {status: "downloading", bytes: 0} })) }
        expect(await downloadAppUpdate()).toEqual({status: "downloading", bytes: 0})
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

it("coalesces repeated taps into one native download request", async () => {
    let id = ""
    target.AppUpdater = { downloadUpdate: vi.fn((requestId: string) => { id = requestId }) }
    const first = downloadAppUpdate(); const second = downloadAppUpdate()
    expect(first).toBe(second)
    reply("seanime-app-download", {requestId: id, state: {status: "downloading"}})
    await first
    expect(target.AppUpdater.downloadUpdate).toHaveBeenCalledOnce()
})
it("restores native progress and verified completion without a local success flag", () => {
    target.AppUpdater = {getDownloadState: () => JSON.stringify({status:"downloading", bytes:50, total:100})}
    expect(readAppDownload().status).toBe("downloading")
    target.AppUpdater.getDownloadState = () => JSON.stringify({status:"complete", fileName:"update.apk", sha256:"verified"})
    expect(readAppDownload()).toMatchObject({status:"complete", sha256:"verified"})
})
it("reports unreadable state honestly", () => {
    target.AppUpdater = {getDownloadState: () => "not JSON"}
    expect(readAppDownload().status).toBe("error")
})

it("retains distinct installation states instead of treating download completion as installed", () => {
    for (const status of ["verifying", "permission", "confirmation", "preparing", "installing", "failed", "installed"]) {
        target.AppUpdater = {getDownloadState: () => JSON.stringify({status, version: "1.9.0"})}
        expect(readAppDownload().status).toBe(status)
    }
})
