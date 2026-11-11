import { buildGettingStartedPayload, DEFAULT_GETTING_STARTED_FEATURES } from "@/main/_features/getting-started/getting-started-payload"
import { describe, expect, it } from "vitest"

describe("buildGettingStartedPayload", () => {
    it("builds the Android first-start settings with the chosen features", () => {
        const payload = buildGettingStartedPayload("android", { enableOnlinestream: false, enableManga: true })
        expect(payload.library.libraryPath).toBe("")
        expect(payload.library.enableOnlinestream).toBe(false)
        expect(payload.library.enableManga).toBe(true)
        expect(payload.enableTorrentStreaming).toBe(false)
        expect(payload.anilist.enableAdultContent).toBe(false)
        expect(payload.torrent.defaultTorrentClient).toBe("none")
        expect(payload.debridProvider).toBe("none")
    })

    it("streams online and reads manga by default", () => {
        const payload = buildGettingStartedPayload("android", DEFAULT_GETTING_STARTED_FEATURES)
        expect(payload.library.enableOnlinestream).toBe(true)
        expect(payload.library.enableManga).toBe(true)
    })
})
