import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { haptic, successFeedback } from "./feedback"

let target: { SeanimeAndroid?: any }
beforeEach(() => { target = {}; vi.stubGlobal("window", target) })
afterEach(() => { vi.unstubAllGlobals() })

describe("touch feedback bridge", () => {
    it("does nothing outside the app or with an older app build", () => {
        expect(() => haptic("tick")).not.toThrow()
        target.SeanimeAndroid = { getAppVersion: () => "2.0.29" }
        expect(() => successFeedback()).not.toThrow()
    })
    it("passes the kind to the app", () => {
        target.SeanimeAndroid = { haptic: vi.fn() }
        haptic("reject")
        expect(target.SeanimeAndroid.haptic).toHaveBeenCalledWith("reject")
    })
    it("confirms a success with a tick and the success sound", () => {
        target.SeanimeAndroid = { haptic: vi.fn(), playSound: vi.fn() }
        successFeedback()
        expect(target.SeanimeAndroid.haptic).toHaveBeenCalledWith("confirm")
        expect(target.SeanimeAndroid.playSound).toHaveBeenCalledWith("success")
    })
    it("still plays the sound when the haptic call throws", () => {
        target.SeanimeAndroid = { haptic: () => { throw new Error("gone") }, playSound: vi.fn() }
        successFeedback()
        expect(target.SeanimeAndroid.playSound).toHaveBeenCalledOnce()
    })
})
