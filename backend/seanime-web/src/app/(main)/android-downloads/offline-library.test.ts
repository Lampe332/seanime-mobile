import { describe, expect, it } from "vitest"
import { groupEpisodes, mangaPollDelay, nextEpisode, OfflineEpisode, offlinePollDelay, startedEpisodes, watchedShare } from "./offline-library"

const episode = (id: string, values: Partial<OfflineEpisode> = {}): OfflineEpisode => ({
    id, mediaId: 1, title: "Frieren", episode: id, ready: true, status: "ready", progress: 100, bytes: 300 * 1024 ** 2, position: 0, ...values,
})

describe("android offline library", () => {
    it("polls only while a download moves", () => {
        expect(offlinePollDelay([episode("1")])).toBeNull()
        expect(offlinePollDelay([episode("1", { ready: false, status: "paused", progress: 40 })])).toBeNull()
        expect(offlinePollDelay([episode("1", { ready: false, status: "failed" })])).toBeNull()
        for (const status of ["downloading", "queued", "resolving", "removing"] as const) {
            expect(offlinePollDelay([episode("1"), episode("2", { ready: false, status })])).toBe(1000)
        }
    })
    it("polls the manga queue quickly while loading, slowly while waiting, never when only failed", () => {
        expect(mangaPollDelay([])).toBeNull()
        expect(mangaPollDelay([{ status: "errored" }])).toBeNull()
        expect(mangaPollDelay([{ status: "not_started" }])).toBe(5000)
        expect(mangaPollDelay([{ status: "not_started" }, { status: "downloading" }])).toBe(2000)
    })
    it("offers the first started episode, else the first saved one", () => {
        expect(nextEpisode([episode("1"), episode("2", { position: 90000 }), episode("3", { position: 1000 })])?.id).toBe("2")
        expect(nextEpisode([episode("1", { ready: false, status: "downloading", position: 5000 }), episode("2")])?.id).toBe("2")
        expect(nextEpisode([episode("1", { ready: false, status: "queued" })])).toBeUndefined()
        expect(startedEpisodes([episode("1"), episode("2", { position: 1 }), episode("3", { ready: false, status: "paused", position: 9 })]).map(e => e.id)).toEqual(["2"])
    })
    it("reports the watched share only with a known runtime", () => {
        expect(watchedShare(episode("1", { position: 12 * 60000, duration: 24 }))).toBe(.5)
        expect(watchedShare(episode("1", { position: 30 * 60000, duration: 24 }))).toBe(1)
        expect(watchedShare(episode("1", { position: 60000 }))).toBeUndefined()
    })
    it("groups episodes per anime in title and episode order", () => {
        const groups = groupEpisodes([episode("3"), episode("1"), episode("1", { mediaId: 2, title: "Dandadan", id: "x" })])
        expect(groups.map(g => g.key)).toEqual(["media-2", "media-1"])
        expect(groups[1].episodes.map(e => e.episode)).toEqual(["1", "3"])
    })
})
