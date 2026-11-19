import { describe, expect, it } from "vitest"
import { heardStreamState, offersOtherTorrent, STREAM_STATE_STALE_MS, streamStateLines, type TorrentStreamState } from "./torrent-stream-state"

const en = (english: string) => english
const de = (_: string, german: string) => german
const NOW = 1_700_000_000_000

/** A state in the form core/torrent/torrent.ts streamStateOf sends it */
const state = (state: string, more: Partial<TorrentStreamState["status"]> = {}): TorrentStreamState => ({
    state,
    status: { uploadProgress: 0, downloadProgress: 0, progressPercentage: 0, downloadSpeed: "0 B/s", uploadSpeed: "0 B/s", size: "0 B", seeders: 0, peers: 0, downloadRate: 0, ...more },
})
const heard = (one: TorrentStreamState) => heardStreamState(one, NOW)

describe("the torrent state the player hears", () => {
    it("keeps a state with its arrival time and drops payloads without the fields it reads", () => {
        expect(heard(state("metadata"))).toMatchObject({ state: "metadata", at: NOW })
        expect(heardStreamState(null, NOW)).toBeNull()
        expect(heardStreamState({ state: "downloading" }, NOW)).toBeNull()
        expect(heardStreamState({ state: "downloading", status: { seeders: 1 } }, NOW)).toBeNull()
    })
})

describe("the loading screen's words for the torrent", () => {
    it("finding peers while nobody is connected, then getting the file list", () => {
        expect(streamStateLines(heard(state("metadata")), NOW, false, en))
            .toEqual({ stage: "Finding peers", detail: "↓ 0 B/s · 0 peers · 0 seeders", stalled: false })
        expect(streamStateLines(heard(state("metadata", { peers: 1, seeders: 1, downloadSpeed: "12.0 KB/s", downloadRate: 12_000 })), NOW, false, en))
            .toEqual({ stage: "Getting file list", detail: "↓ 12.0 KB/s · 1 peer · 1 seeder", stalled: false })
        expect(streamStateLines(heard(state("metadata", { peers: 4, seeders: 2 })), NOW, false, de)?.stage).toBe("Lade Dateiliste")
    })

    it("buffering with the loaded percent, the speed, peers and seeders", () => {
        const loading = state("downloading", { progressPercentage: 1.2, downloadSpeed: "2.5 MB/s", downloadRate: 2_500_000, peers: 12, seeders: 8 })
        expect(streamStateLines(heard(loading), NOW, false, en))
            .toEqual({ stage: "Buffering", detail: "1.2% loaded · ↓ 2.5 MB/s · 12 peers · 8 seeders", stalled: false })
        expect(streamStateLines(heard({ ...loading, status: { ...loading.status, progressPercentage: 42.6 } }), NOW, false, de)?.detail)
            .toBe("43% geladen · ↓ 2.5 MB/s · 12 Peers · 8 Seeder")
    })

    it("a torrent with 0 seeders and no peer still finds peers after its file list came", () => {
        expect(streamStateLines(heard(state("downloading")), NOW, false, en)?.stage).toBe("Finding peers")
    })

    it("mid-stream with an empty buffer and nothing coming in: waiting for peers · 0 B/s", () => {
        expect(streamStateLines(heard(state("downloading", { progressPercentage: 30, peers: 0 })), NOW, true, en))
            .toEqual({ stage: "Waiting for peers", detail: "0 B/s", stalled: true })
        expect(streamStateLines(heard(state("downloading", { peers: 3 })), NOW, true, de))
            .toEqual({ stage: "Warte auf Peers", detail: "0 B/s", stalled: true })
        // data still comes: buffering with the speed, no stall
        expect(streamStateLines(heard(state("downloading", { downloadSpeed: "800 KB/s", downloadRate: 800_000, peers: 2, seeders: 1 })), NOW, true, en))
            .toEqual({ stage: "Buffering", detail: "↓ 800 KB/s · 2 peers · 1 seeder", stalled: false })
    })

    it("reads a server's state without peers and rate from its seeders and speed text", () => {
        const { peers: _peers, downloadRate: _rate, ...older } = state("downloading").status
        expect(streamStateLines(heard({ state: "downloading", status: older }), NOW, true, en)).toEqual({ stage: "Waiting for peers", detail: "0 B/s", stalled: true })
        expect(streamStateLines(heard({ state: "metadata", status: { ...older, seeders: 3 } }), NOW, false, en))
            .toEqual({ stage: "Getting file list", detail: "↓ 0 B/s · 3 seeders", stalled: false })
    })

    it("says nothing without a state or with a stale one (the core's step text stays)", () => {
        expect(streamStateLines(null, NOW, false, en)).toBeNull()
        expect(streamStateLines(heard(state("metadata")), NOW + STREAM_STATE_STALE_MS, false, en)).not.toBeNull()
        expect(streamStateLines(heard(state("metadata")), NOW + STREAM_STATE_STALE_MS + 1, false, en)).toBeNull()
    })
})

describe("a start that failed for 0 seeders", () => {
    it("offers another torrent for a file list that never came, not for other errors", () => {
        expect(offersOtherTorrent("the torrent's file list did not come within 60 s: no peer was reached (peers 0 of 4 known). Another torrent with more seeders may start.")).toBe(true)
        expect(offersOtherTorrent("torrentstream: timeout waiting for torrent info")).toBe(true)
        expect(offersOtherTorrent("no file of the torrent fits episode 7")).toBe(false)
        expect(offersOtherTorrent(null)).toBe(false)
    })
})
