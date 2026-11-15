import type { MobileOffline_Item } from "@/api/generated/types"
import { describe, expect, it } from "vitest"
import { canPlayOffline, offlinePlaybackInfo, offlinePositionToSave, offlineStartSeconds } from "./offline-playback"

const item = (values: Partial<MobileOffline_Item> = {}): MobileOffline_Item => ({
    id: "abc", key: "k", status: "ready", ready: true, mediaId: 9, provider: "p", episode: "4", dubbed: false, quality: "", server: "", audioLanguage: "ja",
    progress: 100, bytes: 1000, position: 0, files: { video: "video.mp4" }, order: 1, title: "Frieren", metadataSaved: true, ...values,
})

describe("offline playback", () => {
    it("plays only saved episodes with a video file", () => {
        expect(canPlayOffline(item())).toBe(true)
        expect(canPlayOffline(item({ ready: false, status: "downloading" }))).toBe(false)
        expect(canPlayOffline(item({ files: {} }))).toBe(false)
    })

    it("starts at the stored position, also a short one, from the beginning after the end", () => {
        expect(offlineStartSeconds(item({ position: 125000 }))).toBe(125)
        // paused at 0:08 and closed: carries on at 0:08 like OfflineActivity.kt (exo.seekTo(saved)), not at 0:00
        expect(offlineStartSeconds(item({ position: 8300 }))).toBe(8.3)
        expect(offlineStartSeconds(item({ position: 0 }))).toBe(0)
    })

    it("stores 0 after the end so the episode starts over", () => {
        expect(offlinePositionToSave(61.4, false)).toBe(61400)
        expect(offlinePositionToSave(1400, true)).toBe(0)
        expect(offlinePositionToSave(-3, false)).toBe(0)
    })

    it("describes the episode for the player without a server playback", () => {
        const info = offlinePlaybackInfo(item({ coverUrl: "https://cover" }))
        expect(info.id).toBe("offline-abc")
        expect(info.streamType).toBe("url")
        expect(info.media).toMatchObject({ id: 9, title: { userPreferred: "Frieren" }, coverImage: { large: "https://cover" } })
        expect(info.episode).toMatchObject({ progressNumber: 4, episodeNumber: 4, displayTitle: "" })
    })
})
