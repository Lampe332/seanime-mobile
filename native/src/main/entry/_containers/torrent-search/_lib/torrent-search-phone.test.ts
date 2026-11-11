import type { HibikeTorrent_AnimeTorrent } from "@/api/generated/types"
import { describe, expect, it } from "vitest"
import {
    ago,
    canSmartSelect,
    decodeEntities,
    downloadError,
    episodeList,
    getDefaultDestination,
    initialTorrentLanguages,
    sanitizeDirectoryName,
    shouldLookForBatches,
    sizeLabel,
    streamKind,
    toggled,
    torrentMeta,
} from "./torrent-search-phone"

const en = (a: string) => a
const de = (_: string, b: string) => b
const NOW = Date.parse("2026-11-05T12:00:00Z")

function torrent(over: Partial<HibikeTorrent_AnimeTorrent> = {}): HibikeTorrent_AnimeTorrent {
    return {
        provider: "p", name: "[Group] Show - 01 [1080p]", date: "2026-11-02T12:00:00Z", size: 1_000_000_000, formattedSize: "1 GiB", seeders: 12,
        leechers: 0, downloadCount: 0, link: "l", downloadUrl: "", magnetLink: "", infoHash: "h", resolution: "1080p", isBatch: false,
        episodeNumber: 1, releaseGroup: "Group", isBestRelease: false, confirmed: false, ...over,
    } as HibikeTorrent_AnimeTorrent
}

describe("initialTorrentLanguages", () => {
    it("migrates the old German switch to the German language", () => {
        expect(initialTorrentLanguages("true", undefined)).toEqual(["de"])
        expect(initialTorrentLanguages("false", undefined)).toEqual([])
        expect(initialTorrentLanguages(undefined, undefined)).toEqual([])
    })
    it("keeps languages chosen since", () => {
        expect(initialTorrentLanguages("true", [])).toEqual([])
        expect(initialTorrentLanguages("true", ["en", "multi"])).toEqual(["en", "multi"])
    })
})

describe("streamKind", () => {
    it("maps the selection types to the sheet's purpose", () => {
        expect(streamKind("torrentstream-select")).toBe("torrent")
        expect(streamKind("torrentstream-select-file")).toBe("torrent")
        expect(streamKind("debridstream-select")).toBe("debrid")
        expect(streamKind("debridstream-select-file")).toBe("debrid")
        expect(streamKind("download")).toBe("download")
        expect(streamKind(undefined)).toBeUndefined()
    })
})

describe("shouldLookForBatches", () => {
    const now = new Date("2026-11-05T12:00:00Z")
    const info = { canBatch: true, episodesToDownload: [{ episodeNumber: 7 }] } as never
    it("downloads look for seasons that ended at least 6 days ago", () => {
        expect(shouldLookForBatches("download", info, { year: 2026, month: 10, day: 1 }, now)).toBe(true)
        expect(shouldLookForBatches("download", info, { year: 2026, month: 11, day: 2 }, now)).toBe(false)
        expect(shouldLookForBatches("download", { canBatch: true, episodesToDownload: [] } as never, { year: 2020 }, now)).toBe(false)
    })
    it("streams look for seasons that ended at least a month ago", () => {
        expect(shouldLookForBatches("torrent", info, { year: 2026, month: 10, day: 20 }, now)).toBe(false)
        expect(shouldLookForBatches("debrid", info, { year: 2026, month: 9, day: 1 }, now)).toBe(true)
        expect(shouldLookForBatches("torrent", { canBatch: false } as never, { year: 2020 }, now)).toBe(false)
    })
})

describe("torrentMeta", () => {
    it("joins the facts and shows unknown seeders (-1)", () => {
        expect(torrentMeta(torrent({ seeders: -1, isBatch: true }), en, "en", false, "", NOW)).toBe("Batch · Group · 1080p · 1 GiB · Seeders unknown · 3 days ago")
        expect(torrentMeta(torrent({ seeders: 0 }), de, "de", false, "", NOW)).toBe("Group · 1080p · 1 GiB · Keine Seeder · vor 3 Tagen")
    })
    it("names the provider, the best release and the debrid cache first", () => {
        expect(torrentMeta(torrent({ isBestRelease: true }), en, "en", true, "Prov", NOW)).toBe("Prov · Best release · Cached · Group · 1080p · 1 GiB · 12 seeders · 3 days ago")
    })
})

describe("ago", () => {
    it("rounds to hours, days, months and years", () => {
        expect(ago("2026-11-05T09:00:00Z", "en", NOW)).toBe("3 hours ago")
        expect(ago("2026-09-05T12:00:00Z", "en", NOW)).toBe("2 months ago")
        expect(ago("2023-11-05T12:00:00Z", "en", NOW)).toBe("3 years ago")
        expect(ago("", "en", NOW)).toBe("")
    })
})

describe("episodeList", () => {
    it("writes runs as ranges", () => {
        expect(episodeList([7, 8, 9, 10, 11, 12])).toBe("7–12")
        expect(episodeList([1, 2, 3, 5, 7, 8])).toBe("1–3, 5, 7–8")
        expect(episodeList([])).toBe("")
    })
})

describe("small helpers", () => {
    it("toggles a value in a list", () => {
        expect(toggled(["de"], "en")).toEqual(["de", "en"])
        expect(toggled(["de", "en"], "de")).toEqual(["en"])
    })
    it("labels the largest sizes", () => {
        expect(sizeLabel(500_000_000)).toBe("≤ 500 MB")
        expect(sizeLabel(2_000_000_000)).toBe("≤ 2 GB")
    })
    it("decodes the entities providers leave in names", () => {
        expect(decodeEntities("A Returner&#39;s Magic &amp; More &quot;S1&quot; &#x41;")).toBe("A Returner's Magic & More \"S1\" A")
        expect(decodeEntities("Plain & simple")).toBe("Plain & simple")
    })
    it("explains the smart select errors of the server", () => {
        expect(downloadError("could not find the right season files", en)).toContain("Everything in the torrent")
        expect(downloadError("torrent can't tell seasons apart", de)).toContain("mischt Staffeln")
        expect(downloadError("other", en)).toBe("other")
    })
})

describe("canSmartSelect", () => {
    const media = { format: "TV", status: "FINISHED", episodes: 12 } as never
    it("needs one batch of a finished series with some episodes missing", () => {
        expect(canSmartSelect([{ isBatch: true }], media, [7, 8])).toBe(true)
        expect(canSmartSelect([{ isBatch: true }, { isBatch: true }], media, [7])).toBe(false)
        expect(canSmartSelect([{ isBatch: false }], media, [7])).toBe(false)
        expect(canSmartSelect([{ isBatch: true }], media, Array.from({ length: 12 }, (_, i) => i + 1))).toBe(false)
        expect(canSmartSelect([{ isBatch: true }], { format: "MOVIE", status: "FINISHED", episodes: 2 } as never, [1])).toBe(false)
    })
})

describe("getDefaultDestination", () => {
    it("saves next to the anime's files, else in a folder named after it", () => {
        expect(getDefaultDestination({ localFiles: [{ path: "/lib/Show/a.mkv" }, { path: "/lib/Show/b.mkv" }] as never, media: undefined }, "/lib")).toBe("/lib/Show")
        expect(getDefaultDestination({ localFiles: [], media: { title: { romaji: "Re:Zero / Season: 2" } } as never }, "/lib")).toBe("/lib/Re Zero Season 2")
        expect(getDefaultDestination({ localFiles: [], media: undefined }, "")).toBe("")
    })
    it("cleans folder names", () => {
        expect(sanitizeDirectoryName("..a<b>c..")).toBe("a b c")
        expect(sanitizeDirectoryName("   ")).toBe("Untitled")
    })
})
