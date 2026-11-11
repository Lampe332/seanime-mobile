import type { AL_BaseAnime, MobileOffline_Snapshot, Onlinestream_Episode } from "@/api/generated/types"
import { describe, expect, it } from "vitest"
import {
    batchRequest, canResume, clock, downloadPresets, filterGroups, followingEpisode, formatSize, groupItems, nextEpisode, noticeName, offlineColumns,
    type OfflineItem, offlineNotices, plainText, resumeAction, showsProgress, startedItems, stateLabel, storedEpisodes, watchedShare,
} from "./offline-library"

const en = (en: string) => en
const de = (_en: string, de: string) => de

const item = (id: string, values: Partial<OfflineItem> = {}): OfflineItem => ({
    id, key: id, status: "ready", ready: true, mediaId: 1, provider: "p", episode: id, dubbed: false, quality: "1080p", server: "", audioLanguage: "ja",
    progress: 100, bytes: 300 * 1024 ** 2, position: 0, files: { video: "video.mp4" }, order: Number(id) || 0, title: "Frieren", metadataSaved: true, ...values,
})

const snapshot = (items: OfflineItem[], waiting = ""): MobileOffline_Snapshot => ({ items, wifiOnly: true, network: { known: true, connected: true, metered: false }, waiting })

describe("offline library", () => {
    it("groups by anime, sorts anime by title and episodes by number", () => {
        const groups = groupItems([item("10"), item("2"), item("1", { mediaId: 2, title: "Apothecary" }), item("3", { mediaId: 0, title: undefined })])
        expect(groups.map(group => group.key)).toEqual(["title-", "media-2", "media-1"])
        expect(groups[2].items.map(entry => entry.id)).toEqual(["2", "10"])
    })

    it("offers the first started episode, else the first saved one", () => {
        expect(nextEpisode([item("1"), item("2", { position: 90000 }), item("3", { position: 1000 })])?.id).toBe("2")
        expect(nextEpisode([item("1", { ready: false, status: "downloading", position: 5000 }), item("2")])?.id).toBe("2")
        expect(nextEpisode([item("1", { ready: false, status: "queued" })])).toBeUndefined()
        expect(startedItems([item("1"), item("2", { position: 20000 }), item("3", { ready: false, status: "paused", position: 90000 })]).map(e => e.id)).toEqual(["2"])
    })

    it("pauses moving downloads, resumes paused ones and retries failed ones", () => {
        expect(canResume(item("1", { ready: false, status: "downloading" }))).toBe(false)
        expect(canResume(item("1", { ready: false, status: "paused" }))).toBe(true)
        expect(resumeAction(item("1", { ready: false, status: "paused" }))).toBe("resume")
        expect(resumeAction(item("1", { ready: false, status: "failed" }))).toBe("retry")
    })

    it("keeps showing partial progress while paused or failed, never for saved episodes", () => {
        expect(showsProgress(item("1", { ready: false, status: "paused", progress: 40 }))).toBe(true)
        expect(showsProgress(item("1", { ready: false, status: "queued", progress: 0 }))).toBe(false)
        expect(showsProgress(item("1"))).toBe(false)
    })

    it("labels every server state in both languages", () => {
        expect(stateLabel(item("1", { status: "resolving", ready: false }), de)).toBe("Quelle wird vorbereitet")
        expect(stateLabel(item("1", { status: "queued", ready: false }), en)).toBe("Queued")
        expect(stateLabel(item("1"), de)).toBe("Offline verfügbar")
    })

    it("shares watched only with a known runtime", () => {
        expect(watchedShare(item("1", { duration: 24, position: 12 * 60000 }))).toBe(0.5)
        expect(watchedShare(item("1", { duration: 24, position: 30 * 60000 }))).toBe(1)
        expect(watchedShare(item("1"))).toBeUndefined()
    })

    it("plays the next saved episode of the same anime", () => {
        const items = [item("1"), item("2", { ready: false, status: "queued" }), item("3"), item("4", { mediaId: 2 })]
        expect(followingEpisode(items, items[0])?.id).toBe("3")
        expect(followingEpisode(items, items[2])).toBeUndefined()
    })

    it("formats sizes and clock like the old page", () => {
        expect(formatSize(1.5 * 1024 ** 3, "en")).toBe("1.5 GB")
        expect(formatSize(300 * 1024 ** 2, "de")).toBe("300 MB")
        expect(clock(83000)).toBe("01:23")
        expect(plainText("A<br>B &amp; <i>C</i>")).toBe("A B & C")
    })

    it("uses one column on phones and 320dp cells from 600dp", () => {
        expect(offlineColumns(412)).toBe(1)
        expect(offlineColumns(600)).toBe(2)
        expect(offlineColumns(1000)).toBe(3)
        expect(offlineColumns(2000)).toBe(4)
    })

    it("filters anime by ready and active episodes", () => {
        const groups = groupItems([item("1"), item("2", { mediaId: 2, title: "B", ready: false, status: "downloading" })])
        expect(filterGroups(groups, "ready").map(group => group.key)).toEqual(["media-1"])
        expect(filterGroups(groups, "active").map(group => group.key)).toEqual(["media-2"])
        expect(filterGroups(groups, "all")).toHaveLength(2)
    })
})

describe("episode picker", () => {
    it("treats saved and queued episodes in the same audio as stored, failed ones as free", () => {
        const items = [
            item("1"), item("2", { ready: false, status: "queued" }), item("3", { ready: false, status: "failed" }),
            item("4", { audioLanguage: "de", dubbed: true }), item("5", { audioLanguage: "", dubbed: false }), item("6", { mediaId: 2 }),
        ]
        expect([...storedEpisodes(items, 1, false)].sort()).toEqual([1, 2, 5])
        expect([...storedEpisodes(items, 1, true)]).toEqual([4])
    })

    it("offers season, from the current episode and this episode", () => {
        expect(downloadPresets([1, 2, 3, 5], 3)).toEqual({ season: [1, 2, 3, 5], from: [3, 5], this: [3] })
        expect(downloadPresets([1, 2], 4).this).toEqual([])
        expect(downloadPresets([1, 2], null).from).toEqual([1, 2])
    })

    it("builds the batch request with Auto quality and short descriptions", () => {
        const media = { id: 7, title: { romaji: "Sousou no Frieren" }, coverImage: { large: "cover" }, bannerImage: "banner" } as AL_BaseAnime
        const episodes: Onlinestream_Episode[] = [
            { number: 2, title: "Two", description: "x".repeat(500) },
            { number: 1, metadata: { episodeTitle: "One", episodeMetadata: { image: "img" } } as Onlinestream_Episode["metadata"] },
            { number: 3 },
        ]
        const request = batchRequest(media, episodes, new Set([1, 2]), { provider: "anime", server: null, quality: null, dubbed: false })
        expect(request).toMatchObject({ mediaId: 7, provider: "anime", server: "", quality: "Auto", dubbed: false, title: "Sousou no Frieren", coverUrl: "cover", bannerUrl: "banner" })
        expect(request.episodes.map(episode => episode.number)).toEqual([1, 2])
        expect(request.episodes[0]).toMatchObject({ title: "One", image: "img", description: "" })
        expect(request.episodes[1].description).toHaveLength(400)
    })
})

describe("download notices", () => {
    it("announces nothing for the first snapshot after the start", () => {
        expect(offlineNotices(undefined, snapshot([item("1")], "wifi"))).toEqual([])
    })

    it("announces finished and failed episodes once", () => {
        const before = snapshot([item("1", { ready: false, status: "downloading" }), item("2", { ready: false, status: "downloading" })])
        const after = snapshot([item("1"), item("2", { ready: false, status: "failed", failure: "CONNECTION" })])
        expect(offlineNotices(before, after).map(n => n.kind)).toEqual(["finished", "failed"])
        expect(offlineNotices(after, after)).toEqual([])
    })

    it("counts an episode queued and finished between two snapshots", () => {
        expect(offlineNotices(snapshot([]), snapshot([item("1")])).map(n => n.kind)).toEqual(["finished"])
    })

    it("starts and ends the Wi-Fi notice", () => {
        expect(offlineNotices(snapshot([]), snapshot([], "wifi"))).toEqual([{ kind: "waiting-wifi" }])
        expect(offlineNotices(snapshot([], "wifi"), snapshot([], ""))).toEqual([{ kind: "waiting-wifi-over" }])
        expect(offlineNotices(snapshot([], "internet"), snapshot([], "internet"))).toEqual([])
    })

    it("names the episode in both languages", () => {
        expect(noticeName(item("3"), de)).toBe("Frieren · Folge 3")
        expect(noticeName(item("3", { title: "" }), en)).toBe("Anime episode · Episode 3")
    })
})
