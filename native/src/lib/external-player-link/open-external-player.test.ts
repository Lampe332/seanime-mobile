import { beforeEach, describe, expect, it, vi } from "vitest"

const openURL = vi.fn()
const startActivityAsync = vi.fn()
const toastError = vi.fn()
vi.mock("react-native", () => ({ Linking: { openURL: (url: string) => openURL(url) } }))
vi.mock("expo-intent-launcher", () => ({ startActivityAsync: (...args: unknown[]) => startActivityAsync(...args) }))
vi.mock("@/components/ui/toast/toast-store", () => ({ toast: { error: (message: string) => toastError(message) } }))

const { openExternalPlayer } = await import("./open-external-player")

describe("openExternalPlayer", () => {
    beforeEach(() => {
        openURL.mockReset()
        startActivityAsync.mockReset()
        toastError.mockReset()
    })

    it("says whether an app took a plain link (medialinks marks and tracks only then)", async () => {
        openURL.mockResolvedValueOnce(undefined)
        expect(await openExternalPlayer("vlc://http://127.0.0.1/x.mkv")).toBe(true)
        openURL.mockRejectedValueOnce(new Error("no activity"))
        expect(await openExternalPlayer("vlc://http://127.0.0.1/x.mkv")).toBe(false)
        expect(toastError).toHaveBeenCalledTimes(1)
    })

    it("reports a missing player app for a preset intent link", async () => {
        startActivityAsync.mockRejectedValueOnce(new Error("ActivityNotFound"))
        const link = "intent://127.0.0.1:43212/x.mkv#Intent;scheme=http;type=video/*;package=org.videolan.vlc;end"
        expect(await openExternalPlayer(link)).toBe(false)
        expect(toastError).toHaveBeenCalledTimes(1)
    })
})
