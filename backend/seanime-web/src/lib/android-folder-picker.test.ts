import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { canPickAndroidFolder, pickAndroidFolder } from "./android-folder-picker"

let target: EventTarget & { SeanimeAndroid?: any }
beforeEach(() => { target = new EventTarget(); vi.stubGlobal("window", target) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
function reply(detail: unknown) { target.dispatchEvent(new CustomEvent("seanime-folder-picked", { detail })) }

describe("Android folder picker bridge", () => {
    it("is unavailable without the bridge method", async () => {
        expect(canPickAndroidFolder()).toBe(false)
        target.SeanimeAndroid = { getAppVersion: () => "1.9.36" }
        expect(canPickAndroidFolder()).toBe(false)
        await expect(pickAndroidFolder()).rejects.toThrow("unavailable")
    })
    it("resolves with the picked path", async () => {
        target.SeanimeAndroid = { pickFolder: vi.fn((requestId: string) => reply({ requestId, path: "/storage/emulated/0/Anime/Show" })) }
        expect(canPickAndroidFolder()).toBe(true)
        expect(await pickAndroidFolder()).toBe("/storage/emulated/0/Anime/Show")
        expect(target.SeanimeAndroid.pickFolder).toHaveBeenCalledOnce()
    })
    it.each(["cancelled", "not-primary", "permission"])("rejects with the native %s code", async code => {
        target.SeanimeAndroid = { pickFolder: (requestId: string) => reply({ requestId, error: code }) }
        await expect(pickAndroidFolder()).rejects.toThrow(code)
    })
    it("reports a throwing bridge as unavailable", async () => {
        target.SeanimeAndroid = { pickFolder: () => { throw new Error("bridge gone") } }
        await expect(pickAndroidFolder()).rejects.toThrow("unavailable")
    })
    it("ignores results of other requests", async () => {
        const ids: string[] = []
        target.SeanimeAndroid = { pickFolder: (id: string) => ids.push(id) }
        const first = pickAndroidFolder(); const second = pickAndroidFolder()
        reply({ requestId: "someone-else", path: "/storage/emulated/0/Wrong" })
        reply({ requestId: ids[1], path: "/storage/emulated/0/Second" })
        reply({ requestId: ids[0], path: "/storage/emulated/0/First" })
        expect(await first).toBe("/storage/emulated/0/First"); expect(await second).toBe("/storage/emulated/0/Second")
    })
    it("times out after ten minutes", async () => {
        vi.useFakeTimers()
        target.SeanimeAndroid = { pickFolder: () => {} }
        const result = expect(pickAndroidFolder()).rejects.toThrow("timeout")
        await vi.advanceTimersByTimeAsync(10 * 60_000 - 1)
        reply({ requestId: "late-other", path: "/x" })
        await vi.advanceTimersByTimeAsync(1)
        await result
    })
})
