import type { HibikeTorrent_AnimeTorrent } from "@/api/generated/types"
import {
    filterTorrents,
    isBatchRelease,
    isGermanRelease,
    isLanguageRelease,
    matchesResolution,
    sortTorrents,
    toggleProvider,
} from "@/app/(main)/entry/_containers/torrent-search/_lib/torrent-filters"
import { describe, expect, it } from "vitest"

const torrent = (name: string, extra: Partial<HibikeTorrent_AnimeTorrent> = {}) => ({ name, seeders: 1, size: 1, formattedSize: "", ...extra }) as HibikeTorrent_AnimeTorrent

describe("isGermanRelease", () => {
    it("finds the usual German tags", () => {
        expect(isGermanRelease("Solo Leveling S02 German DL 1080p")).toBe(true)
        expect(isGermanRelease("[Group] Overgeared - 05 [GerDub][1080p]")).toBe(true)
        expect(isGermanRelease("Frieren 01-28 Ger Sub")).toBe(true)
        expect(isGermanRelease("Show.S01.DE-Dub.720p")).toBe(true)
        expect(isGermanRelease("One Punch Man Deutsch")).toBe(true)
    })

    it("does not match unrelated words", () => {
        expect(isGermanRelease("[SubsPlease] Dandadan - 05 (1080p)")).toBe(false)
        expect(isGermanRelease("Tiger Mask 01")).toBe(false)
        expect(isGermanRelease("Death Note DEnoise")).toBe(false)
    })
})

describe("isBatchRelease", () => {
    it("takes the provider flag or the name", () => {
        expect(isBatchRelease(torrent("x", { isBatch: true }))).toBe(true)
        expect(isBatchRelease(torrent("Solo Leveling Season 2 Complete"))).toBe(true)
        expect(isBatchRelease(torrent("Frieren - 01-28 [1080p]"))).toBe(true)
        expect(isBatchRelease(torrent("Frieren - 05 [1080p]"))).toBe(false)
    })

    it("knows season packs from single episodes of a season", () => {
        expect(isBatchRelease(torrent("One Punch Man S01+6Bonus German DL AAC 1080p BluRay x265-CHIPHEAD"))).toBe(true)
        expect(isBatchRelease(torrent("One.Punch.Man.S02.1080p.BluRay.x264"))).toBe(true)
        expect(isBatchRelease(torrent("Show S01 1080p WEB"))).toBe(true)
        expect(isBatchRelease(torrent("[Judas] One Punch Man (Seasons 1-2 + OVAs + Specials) [BD 1080p]"))).toBe(true)
        expect(isBatchRelease(torrent("[SubsPlease] One-Punch Man S3 - 08 (1080p) [F3A47D58].mkv"))).toBe(false)
        expect(isBatchRelease(torrent("[Skymoon-Raws] One Punch Man Season 3 - 08 [ViuTV][1080p]"))).toBe(false)
        expect(isBatchRelease(torrent("One.Punch.Man.S02E05.1080p.WEB"))).toBe(false)
    })
})

describe("matchesResolution", () => {
    it("uses the parsed resolution, else the name", () => {
        expect(matchesResolution(torrent("a", { resolution: "1080p" }), "1080")).toBe(true)
        expect(matchesResolution(torrent("a 1080p", { resolution: "720p" }), "1080")).toBe(false)
        expect(matchesResolution(torrent("Show 1080p WEB"), "1080")).toBe(true)
        expect(matchesResolution(torrent("Show 720p"), "1080")).toBe(false)
        expect(matchesResolution(torrent("Show 720p"), "")).toBe(true)
    })
})

describe("filterTorrents", () => {
    const list = [
        torrent("Show S01 German 1080p", { isBatch: true, resolution: "1080p" }),
        torrent("Show - 05 German 1080p", { resolution: "1080p" }),
        torrent("Show S01 1080p", { isBatch: true, resolution: "1080p" }),
        torrent("Show S01 German 720p", { isBatch: true, resolution: "720p" }),
    ]

    it("combines the filters", () => {
        expect(filterTorrents(list, { resolution: "1080", batch: true, languages: ["de"] }).map(t => t.name)).toEqual(["Show S01 German 1080p"])
        expect(filterTorrents(list, { resolution: "", batch: false })).toHaveLength(4)
    })

    it("trusts the provider's own batch search", () => {
        expect(filterTorrents(list, { resolution: "", batch: true, languages: ["de"] }, true)).toHaveLength(3)
    })
})

describe("isLanguageRelease", () => {
    // Names from a real One-Punch Man search
    const names = {
        erai: "[Erai-raws] One Punch Man (2025) - 08 [1080p CR WEB-DL AVC AAC][MultiSub][B5349E1E]",
        subsPlease: "[SubsPlease] One-Punch Man S3 - 08 (1080p) [F3A47D58].mkv",
        cht: "[Skymoon-Raws] 一拳超人 第3季 / One Punch Man Season 3 - 08 [ViuTV][WEB-DL][CHT][1080p][AVC AAC]",
        lolihouse: "[LoliHouse] 一拳超人 第二季 / One Punch Man S2 - 08 [WebRip 1080p HEVC-10bit AAC][英文内封字幕]",
        german: "One Punch Man S01+6Bonus German DL AAC 1080p BluRay x265-CHIPHEAD",
        french: "[Team] One Punch Man - 08 VOSTFR 1080p",
        raw: "[Ohys-Raws] One Punch Man - 08 (TX 1280x720 x264 AAC).mp4",
    }

    it("finds tagged languages", () => {
        expect(isLanguageRelease(names.german, "de")).toBe(true)
        expect(isLanguageRelease(names.french, "fr")).toBe(true)
        expect(isLanguageRelease(names.cht, "zh")).toBe(true)
        expect(isLanguageRelease(names.erai, "multi")).toBe(true)
        expect(isLanguageRelease("Show - 08 [SUB ITA]", "it")).toBe(true)
        expect(isLanguageRelease("Show - 08 [PT-BR]", "pt")).toBe(true)
        expect(isLanguageRelease("Show - 08 [Latino]", "es")).toBe(true)
        expect(isLanguageRelease("[AniLibria] Ванпанчмен 08", "ru")).toBe(true)
        expect(isLanguageRelease(names.erai, "de")).toBe(false)
        expect(isLanguageRelease(names.subsPlease, "fr")).toBe(false)
    })

    it("treats untagged and multi-sub releases as English, but not raws or other languages", () => {
        expect(isLanguageRelease(names.subsPlease, "en")).toBe(true)
        expect(isLanguageRelease(names.erai, "en")).toBe(true)
        expect(isLanguageRelease(names.lolihouse, "en")).toBe(true)
        expect(isLanguageRelease(names.raw, "en")).toBe(false)
        expect(isLanguageRelease(names.cht, "en")).toBe(false)
        expect(isLanguageRelease(names.german, "en")).toBe(false)
    })

    it("keeps any of several languages", () => {
        const list = Object.values(names).map(name => torrent(name))
        expect(filterTorrents(list, { resolution: "", batch: false, languages: ["de", "fr"] }).map(t => t.name)).toEqual([names.german, names.french])
    })
})

describe("codec, source, bit depth, size and 4K", () => {
    const list = [
        torrent("[SubsPlease] Show - 08 (1080p) [F3A47D58].mkv", { size: 1_400_000_000 }),
        torrent("[LoliHouse] Show - 08 [WebRip 1080p HEVC-10bit AAC]", { size: 300_000_000 }),
        torrent("Show S01 German DL AAC 1080p BluRay x265-CHIPHEAD", { size: 9_000_000_000 }),
        torrent("[Judas] Show (Season 1) [BD 2160p][HEVC x265 10bit][Dual-Audio]", { size: 0 }),
        torrent("[Erai-raws] Show - 08 [1080p CR WEB-DL AVC AAC][MultiSub]", { size: 1_300_000_000 }),
        torrent("[Group] Show - 08 [4K][AV1]", { size: 2_000_000_000 }),
    ]
    const none = { resolution: "", batch: false }
    const names = (filters: Partial<Parameters<typeof filterTorrents>[1]>) => filterTorrents(list, { ...none, ...filters }).map(t => list.indexOf(t))

    it("filters each", () => {
        expect(names({ codecs: ["hevc"] })).toEqual([1, 2, 3])
        expect(names({ codecs: ["avc", "av1"] })).toEqual([4, 5])
        expect(names({ sources: ["bluray"] })).toEqual([2, 3])
        expect(names({ sources: ["web"] })).toEqual([1, 4])
        expect(names({ tenBit: true })).toEqual([1, 3])
        // unknown sizes stay
        expect(names({ maxSize: 1_000_000_000 })).toEqual([1, 3])
        expect(names({ resolution: "2160" })).toEqual([3, 5])
    })
})

describe("text, dual audio and seeders", () => {
    const list = [
        torrent("[EMBER] Show S01 1080p HEVC Dual Audio", { releaseGroup: "EMBER", seeders: 140 }),
        torrent("[Erai-raws] Show - 01 ~ 12 [1080p][Multiple Subtitle]", { releaseGroup: "Erai-raws", seeders: 0 }),
        torrent("[koala] Show Season 1 (BD 1080p HEVC Opus) [Dual Audio]", { releaseGroup: "koala", seeders: 12 }),
    ]
    const none = { resolution: "", batch: false }

    it("needs every word and leaves out -words", () => {
        expect(filterTorrents(list, { ...none, text: "ember" }).map(t => t.releaseGroup)).toEqual(["EMBER"])
        expect(filterTorrents(list, { ...none, text: "hevc -koala" }).map(t => t.releaseGroup)).toEqual(["EMBER"])
        expect(filterTorrents(list, { ...none, text: "  " })).toHaveLength(3)
    })

    it("filters dual audio and unseeded torrents", () => {
        expect(filterTorrents(list, { ...none, dualAudio: true })).toHaveLength(2)
        expect(filterTorrents(list, { ...none, seeded: true }).map(t => t.releaseGroup)).toEqual(["EMBER", "koala"])
    })
})

describe("sortTorrents", () => {
    const list = [
        torrent("a", { seeders: 5, size: 300, date: "2024-01-01T00:00:00Z" }),
        torrent("b", { seeders: 50, size: 100, date: "2022-01-01T00:00:00Z", isBestRelease: true }),
        torrent("c", { seeders: 90, size: 200, date: "2025-01-01T00:00:00Z" }),
    ]

    it("sorts by each key", () => {
        expect(sortTorrents(list, "best").map(t => t.name)).toEqual(["b", "c", "a"])
        expect(sortTorrents(list, "seeders").map(t => t.name)).toEqual(["c", "b", "a"])
        expect(sortTorrents(list, "newest").map(t => t.name)).toEqual(["c", "a", "b"])
        expect(sortTorrents(list, "smallest").map(t => t.name)).toEqual(["b", "c", "a"])
    })
})

describe("toggleProvider", () => {
    it("adds, removes and keeps one", () => {
        expect(toggleProvider(["nyaa"], "animetosho")).toEqual(["nyaa", "animetosho"])
        expect(toggleProvider(["nyaa", "animetosho"], "nyaa")).toEqual(["animetosho"])
        expect(toggleProvider(["nyaa"], "nyaa")).toEqual(["nyaa"])
    })
})
