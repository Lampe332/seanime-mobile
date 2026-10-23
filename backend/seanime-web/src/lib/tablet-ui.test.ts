import { afterEach, describe, expect, it, vi } from "vitest"

describe("phone or tablet layout from the screen", () => {
    afterEach(() => {
        vi.useRealTimers()
        vi.unstubAllEnvs()
        vi.unstubAllGlobals()
        vi.resetModules()
    })

    async function load(width: number, height: number, platform = "mobile") {
        vi.useFakeTimers()
        const listeners: Record<string, () => void> = {}
        const screen = { width, height }
        const videos: { paused: boolean, ended: boolean }[] = []
        const reload = vi.fn()
        vi.stubEnv("SEA_PUBLIC_PLATFORM", platform)
        vi.stubGlobal("window", {
            screen,
            location: { reload },
            setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
            addEventListener: (type: string, fn: () => void) => { listeners[type] = fn },
        })
        vi.stubGlobal("document", {
            querySelectorAll: () => videos,
            addEventListener: (type: string, fn: () => void) => { listeners["document " + type] = fn },
        })
        vi.resetModules()
        const ui = await import("./tablet-ui")
        ui.reloadOnScreenClassChange()
        const resize = (w: number, h: number) => { Object.assign(screen, { width: w, height: h }); listeners.resize() }
        return { ui, listeners, screen, videos, reload, resize }
    }

    it("picks the tablet layout when the smaller side is 600 px or more", async () => {
        expect((await load(412, 915)).ui.IS_TABLET_UI).toBe(false)
        expect((await load(915, 412)).ui.IS_TABLET_UI).toBe(false)
        expect((await load(599, 960)).ui.IS_TABLET_UI).toBe(false)
        expect((await load(600, 960)).ui.IS_TABLET_UI).toBe(true)
        expect((await load(1280, 800)).ui.IS_TABLET_UI).toBe(true)
        expect((await load(1280, 800, "web")).ui.IS_TABLET_UI).toBe(false)
    })

    it("decides again when a foldable opens or closes, not when the device turns", async () => {
        const phone = await load(412, 915)
        phone.resize(915, 412)
        vi.advanceTimersByTime(500)
        expect(phone.reload).not.toHaveBeenCalled()
        phone.resize(686, 854)
        expect(phone.reload).toHaveBeenCalled()

        const tablet = await load(800, 1280)
        tablet.resize(1280, 800)
        vi.advanceTimersByTime(500)
        expect(tablet.reload).not.toHaveBeenCalled()
        tablet.resize(410, 820)
        expect(tablet.reload).toHaveBeenCalled()
    })

    it("looks again when the screen size follows the resize event", async () => {
        const phone = await load(412, 915)
        phone.listeners.resize()
        Object.assign(phone.screen, { width: 686, height: 854 })
        expect(phone.reload).not.toHaveBeenCalled()
        vi.advanceTimersByTime(500)
        expect(phone.reload).toHaveBeenCalledTimes(1)
    })

    it("lets a playing video run and reloads once it pauses", async () => {
        const phone = await load(412, 915)
        phone.videos.push({ paused: false, ended: false })
        phone.resize(686, 854)
        vi.advanceTimersByTime(500)
        expect(phone.reload).not.toHaveBeenCalled()
        phone.videos[0].paused = true
        phone.listeners["document pause"]()
        expect(phone.reload).toHaveBeenCalledTimes(1)
    })

    it("does not watch the screen outside the Android app", async () => {
        const web = await load(1280, 800, "web")
        expect(Object.keys(web.listeners)).toEqual([])
    })
})
