import type { TorrentClient_Torrent } from "@/api/generated/types"
import { describe, expect, it } from "vitest"
import { torrentGroups } from "./torrent-groups"

const row = (hash: string, status: string, progress: number) => ({ hash, status, progress }) as TorrentClient_Torrent
const counts = (torrents: TorrentClient_Torrent[]) => torrentGroups(torrents).map(group => `${group.key} ${group.rows.length}`)

// 4.2.0 E (S22): "Downloading 5" over five torrents that all said "Paused · 100 %" ("Stop sharing when finished")
describe("torrent list groups", () => {
    it("counts a paused torrent that is complete as done, not as downloading", () => {
        const paused = ["a", "b", "c", "d", "e"].map(hash => row(hash, "paused", 1))
        expect(counts(paused)).toEqual(["done 5"])
    })

    it("counts only the torrents that load as downloading; queued ones wait, paused and failed ones are stopped", () => {
        const list = [
            row("1", "downloading", 0.4), row("2", "other", 0), row("3", "queued", 0.1), row("4", "queued", 0),
            row("5", "paused", 0.5), row("6", "error", 0.2), row("7", "stopped", 0.9), row("8", "seeding", 1), row("9", "paused", 1),
        ]
        expect(counts(list)).toEqual(["downloading 2", "waiting 2", "stopped 3", "done 2"])
    })

    it("leaves out empty groups", () => {
        expect(counts([])).toEqual([])
        expect(counts([row("1", "queued", 0)])).toEqual(["waiting 1"])
    })
})
