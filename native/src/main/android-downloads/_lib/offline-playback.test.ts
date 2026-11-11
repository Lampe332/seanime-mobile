import type { MobileOffline_Item } from "@/api/generated/types"
import { describe, expect, it } from "vitest"
import { canPlayOffline, offlinePlayback, offlinePlaybackInfo, offlinePositionToSave, offlineStartSeconds } from "./offline-playback"

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

    it("plays the saved files from the Go server", () => {
        const playback = offlinePlayback(item({
            files: { video: "video.ts", audio: "audio de.m4a", subtitles: [{ file: "en.vtt", language: "en", label: "English", default: true, mime: "text/vtt" }] },
            position: 30000,
        }))
        expect(playback.startSeconds).toBe(30)
        expect(playback.audioUrl).toMatch(/\/api\/v1\/mobile-offline\/file\/abc\/audio%20de\.m4a$/)
        expect(playback.subtitles).toEqual([{ url: expect.stringMatching(/\/file\/abc\/en\.vtt$/), label: "English", language: "en", default: true }])
        expect(offlinePlayback(item()).audioUrl).toBeUndefined()
    })

    it("describes the episode for the player without a server playback", () => {
        const info = offlinePlaybackInfo(item({ coverUrl: "https://cover" }))
        expect(info.id).toBe("offline-abc")
        expect(info.streamType).toBe("url")
        expect(info.streamUrl).toMatch(/\/api\/v1\/mobile-offline\/file\/abc\/video\.mp4$/)
        expect(info.media).toMatchObject({ id: 9, title: { userPreferred: "Frieren" }, coverImage: { large: "https://cover" } })
        expect(info.episode).toMatchObject({ progressNumber: 4, episodeNumber: 4, displayTitle: "" })
    })
})
