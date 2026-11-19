// geschrieben nach: Plan Seanime_Chamok_Plan_420.md Abschnitt B (Text wie in der Liste, mehrere Torrents, Metadaten fehlen, Drosselung, Fertig einmal); Namen und Zahlen erfunden
import { afterEach, describe, expect, it, vi } from "vitest"
import { endNoticeOf, endWatch, type NoticeTorrent, noticeThrottle, type OngoingNotice, ongoingNoticeOf, spaceText, type Translate } from "./torrent-notice"
import type { TorrentDeviceStatus } from "./torrent"

const en: Translate = english => english
const de: Translate = (_english, german) => german

const status = (fields: Partial<TorrentDeviceStatus> = {}): TorrentDeviceStatus => ({
    infoHash: "ab".repeat(20), state: "downloading", error: "", hasMetadata: true, progress: 0.45, downRate: 3_100_000, upRate: 0,
    peers: 4, seeds: 2, bytesDone: 1_800_000_000, bytesWanted: 4_032_000_000, ...fields,
})
const torrent = (hash: string, name: string, fields: Partial<TorrentDeviceStatus> = {}): NoticeTorrent => ({ hash, name, status: status({ infoHash: hash, ...fields }) })

describe("the torrent client's notice", () => {
    it("one torrent: its name, the line of the Torrents tab and the bar", () => {
        // 2 232 000 000 bytes left at 3.1 MB/s: 720 s
        expect(ongoingNoticeOf([torrent("a", "[Group] Show - 01")], en)).toEqual({ title: "[Group] Show - 01", text: "45 % · ↓ 3.1 MB/s · 12 min left", done: 45, total: 100 })
        expect(ongoingNoticeOf([torrent("a", "Show")], de)?.text).toBe("45 % · ↓ 3.1 MB/s · noch 12 Min.")
        expect(ongoingNoticeOf([torrent("a", "Show", { bytesWanted: 1_800_000_000 + 3_100_000 * 30 })], en)?.text).toBe("45 % · ↓ 3.1 MB/s · 30 s left")
        expect(ongoingNoticeOf([torrent("a", "Show", { bytesWanted: 1_800_000_000 + 3_100_000 * 3900 })], en)?.text).toBe("45 % · ↓ 3.1 MB/s · 1 h 5 min left")
        // nothing comes in: no time left
        expect(ongoingNoticeOf([torrent("a", "Show", { downRate: 0 })], en)?.text).toBe("45 % · ↓ 0 B/s")
        expect(ongoingNoticeOf([torrent("a", "Show", { state: "checking", progress: 0.2 })], en)).toEqual({ title: "Show", text: "20 % · Checking files…", done: 20, total: 100 })
    })

    it("without a file list yet: a bar without end and \"Getting file list…\"", () => {
        expect(ongoingNoticeOf([torrent("a", "Show", { state: "metadata", hasMetadata: false, progress: 0, bytesDone: 0, bytesWanted: 0 })], en))
            .toEqual({ title: "Show", text: "Getting file list…", done: 0, total: 0 })
        expect(ongoingNoticeOf([torrent("a", "Show", { state: "metadata", hasMetadata: false })], de)?.text).toBe("Dateiliste wird geholt…")
    })

    it("several: how many, the share of all their bytes, the speed of all and the longest time left", () => {
        const several = [
            torrent("a", "One", { bytesDone: 500_000_000, bytesWanted: 1_000_000_000, downRate: 1_000_000 }),
            torrent("b", "Two", { bytesDone: 0, bytesWanted: 1_000_000_000, downRate: 2_000_000 }),
            torrent("c", "Three", { state: "metadata", hasMetadata: false, downRate: 0, bytesDone: 0, bytesWanted: 0 }),
        ]
        // 0.5 GB of 2 GB, 3 MB/s together, the longest: 1 GB at 2 MB/s = 500 s
        expect(ongoingNoticeOf(several, en)).toEqual({ title: "Downloading 3 torrents", text: "25 % · ↓ 3.0 MB/s · 8 min left", done: 25, total: 100 })
        expect(ongoingNoticeOf(several, de)?.title).toBe("3 Torrents werden geladen")
        // one of them stands still: the longest time is open
        expect(ongoingNoticeOf([several[0], torrent("b", "Two", { bytesDone: 0, bytesWanted: 1_000_000_000, downRate: 0 })], en)?.text).toBe("25 % · ↓ 1.0 MB/s")
        const waiting = { state: "metadata", hasMetadata: false }
        expect(ongoingNoticeOf([torrent("a", "One", waiting), torrent("b", "Two", waiting)], en)).toEqual({ title: "Downloading 2 torrents", text: "Getting file list…", done: 0, total: 0 })
    })

    it("paused, failed and finished ones are not in it; none that loads: no notice", () => {
        const paused = torrent("p", "Paused", { state: "paused", downRate: 0 })
        const failed = torrent("f", "Failed", { error: "disk full" })
        const done = torrent("d", "Done", { state: "seeding", progress: 1 })
        expect(ongoingNoticeOf([paused, failed, done], en)).toBeNull()
        expect(ongoingNoticeOf([paused, failed, done, torrent("a", "Show")], en)?.title).toBe("Show")
    })

    it("tells a finished torrent once and a failed one each time it fails; what is seen first tells nothing", () => {
        const watch = endWatch()
        expect(watch.ends([torrent("a", "Show"), torrent("old", "Old", { state: "seeding" })])).toEqual([])
        expect(watch.ends([torrent("a", "Show", { state: "seeding", progress: 1 }), torrent("old", "Old", { state: "seeding" })]))
            .toEqual([{ hash: "a", name: "Show", kind: "finished", error: "" }])
        expect(watch.ends([torrent("a", "Show", { state: "seeding" })])).toEqual([])
        // checked again and finished a second time: still once
        watch.ends([torrent("a", "Show", { state: "checking" })])
        expect(watch.ends([torrent("a", "Show", { state: "finished" })])).toEqual([])
        expect(watch.ends([torrent("b", "Two")])).toEqual([])
        expect(watch.ends([torrent("b", "Two", { error: "disk full" })])).toEqual([{ hash: "b", name: "Two", kind: "failed", error: "disk full" }])
        expect(watch.ends([torrent("b", "Two", { error: "disk full" })])).toEqual([])
        // removed and added again: new
        watch.forget("a")
        watch.ends([torrent("a", "Show")])
        expect(watch.ends([torrent("a", "Show", { state: "seeding" })])).toHaveLength(1)
        expect(endNoticeOf({ hash: "a", name: "Show", kind: "finished", error: "" }, en)).toEqual({ title: "Download finished: Show", text: "Saved to your library folder" })
        expect(endNoticeOf({ hash: "b", name: "Two", kind: "failed", error: "disk full" }, de)).toEqual({ title: "Download fehlgeschlagen: Two", text: "disk full" })
    })

    it("words a download that does not fit with its numbers", () => {
        expect(spaceText(4_200_000_000, 1_500_000_000, en)).toBe("Not enough free space: the download needs 4.2 GB, 1.5 GB are free.")
        expect(spaceText(4_200_000_000, 1_500_000_000, de)).toBe("Nicht genug freier Speicher: Der Download braucht 4.2 GB, frei sind 1.5 GB.")
    })
})

describe("the notice's pace", () => {
    afterEach(() => {
        vi.useRealTimers()
    })

    const notice = (text: string): OngoingNotice => ({ title: "Show", text, done: 45, total: 100 })
    const settle = async () => {
        for (let i = 0; i < 3; i++) await Promise.resolve()
    }

    it("sends at most once a second and never the same notice twice", async () => {
        vi.useFakeTimers()
        const sent: string[] = []
        const pace = noticeThrottle(async next => {
            sent.push(next.text)
            return true
        }, () => Date.now())
        expect(pace.offer(notice("45 %"))).toBe(true)
        vi.advanceTimersByTime(300)
        expect(pace.offer(notice("46 %"))).toBe(false)
        vi.advanceTimersByTime(700)
        expect(pace.offer(notice("46 %"))).toBe(true)
        vi.advanceTimersByTime(5000)
        expect(pace.offer(notice("46 %"))).toBe(false)
        expect(pace.offer(null)).toBe(false)
        // the notice was started again: the same goes out at once
        pace.reset()
        expect(pace.offer(notice("46 %"))).toBe(true)
        await settle()
        expect(sent).toEqual(["45 %", "46 %", "46 %"])
    })

    it("sends a notice the device did not show again with the next offer", async () => {
        vi.useFakeTimers()
        let shown = false
        const sent: string[] = []
        const pace = noticeThrottle(async next => {
            sent.push(next.text)
            return shown
        }, () => Date.now())
        pace.offer(notice("Getting file list…"))
        await settle()
        vi.advanceTimersByTime(1000)
        shown = true
        expect(pace.offer(notice("Getting file list…"))).toBe(true)
        await settle()
        vi.advanceTimersByTime(1000)
        expect(pace.offer(notice("Getting file list…"))).toBe(false)
        expect(sent).toEqual(["Getting file list…", "Getting file list…"])
    })
})
