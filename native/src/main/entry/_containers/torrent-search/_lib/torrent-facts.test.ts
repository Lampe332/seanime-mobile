import type { Habari_Metadata, HibikeTorrent_AnimeTorrent } from "@/api/generated/types"
import { parse } from "@/core/extensions/helpers/prelude/habari"
import { emptyProfile } from "@/core/torrent/autoselect"
import { describe, expect, it } from "vitest"
import {
    bestMatchKey,
    copyMagnet,
    factsHead,
    factsLine,
    factsSentence,
    resolutionLabel,
    seedHealth,
    sizeText,
    torrentFacts,
    torrentKey,
} from "./torrent-facts"
import { NAMES_PER_TURN, readingOf, readNamesInTurns } from "./use-torrent-reads"

const en = (a: string) => a
const de = (_: string, b: string) => b
const NOW = Date.parse("2026-11-19T12:00:00Z")
const read = (name: string) => parse(name) as unknown as Habari_Metadata

/** A result as the core's search hands it on (search.ts torrentOut): providers often leave resolution and group out */
function torrent(name: string, over: Partial<HibikeTorrent_AnimeTorrent> = {}): HibikeTorrent_AnimeTorrent {
    return {
        provider: "nyaa", name, date: "2026-11-16T12:00:00Z", size: 1_503_238_554, formattedSize: "1.4 GiB", seeders: 332, leechers: 18,
        downloadCount: 0, link: `https://nyaa.si/view/${name.length}`, downloadUrl: "", magnetLink: "", infoHash: "", episodeNumber: -1,
        isBestRelease: false, confirmed: false, ...over,
    } as HibikeTorrent_AnimeTorrent
}

const SUBSPLEASE = "[SubsPlease] Sousou no Frieren S2 - 05 (1080p) [4277EF46].mkv"
const JUDAS = "[Judas] Sousou no Frieren (Season 2) [1080p][HEVC x265 10bit][Multi-Subs] (Batch)"
const KAF = "Sousou.no.Frieren.S01.2160p.BluRay.REMUX.HEVC.DTS-HD.MA.5.1-KAF"
const ERAI = "[Erai-raws] Sousou no Frieren 2nd Season - 05v2 [1080p][Multiple Subtitle][ENG][POR-BR]"
const ASW = "[ASW] Sousou no Frieren - 01-28 [1080p HEVC x265 10Bit][AAC]"
const DUAL = "[Kaizoku] Sousou no Frieren S02E05 [1080p][x265 10bit][Dual Audio]"

describe("torrentFacts", () => {
    it("reads group, season, episode and resolution from the name when the provider sends none", () => {
        const facts = torrentFacts(torrent(SUBSPLEASE), read(SUBSPLEASE), en, "en", { provider: "Nyaa", now: NOW })
        expect(factsHead(facts)).toBe("SubsPlease · S2 · Ep 5")
        expect(facts.resolution).toBe("1080p")
        expect(factsLine(facts)).toBe("332 seeders · 18 leechers · 1.4 GiB · 3 days ago · Nyaa")
        expect(facts.health).toBe("good")
        expect(facts.tech).toEqual([])
    })

    it("lets the provider's fields win over the name", () => {
        const facts = torrentFacts(torrent(SUBSPLEASE, { releaseGroup: "Provider Group", resolution: "720p", episodeNumber: 7 }), read(SUBSPLEASE), en, "en")
        expect(factsHead(facts)).toBe("Provider Group · S2 · Ep 7")
        expect(facts.resolution).toBe("720p")
    })

    it("calls a whole season a batch and lists codec, bit depth and subtitles (Judas)", () => {
        const facts = torrentFacts(torrent(JUDAS, { size: 5_905_580_032, formattedSize: "5.5 GiB" }), read(JUDAS), en, "en")
        expect(factsHead(facts)).toBe("Judas · S2 · Batch")
        expect(facts.resolution).toBe("1080p")
        expect(facts.tech).toEqual(["HEVC", "10bit", "Multi subs"])
    })

    it("reads a scene name: the group at its end, 2160p, BluRay (KAF)", () => {
        const facts = torrentFacts(torrent(KAF), read(KAF), en, "en")
        expect(factsHead(facts)).toBe("KAF · S1 · Batch")
        expect(facts.resolution).toBe("2160p")
        expect(facts.tech).toEqual(["HEVC", "BluRay"])
    })

    it("shows a range of episodes, a version and dual audio", () => {
        expect(factsHead(torrentFacts(torrent(ASW), read(ASW), en, "en"))).toBe("ASW · Ep 1–28")
        const erai = torrentFacts(torrent(ERAI), read(ERAI), en, "en")
        expect(factsHead(erai)).toBe("Erai-raws · S2 · Ep 5 · v2")
        expect(erai.tech).toEqual(["Multi subs"])
        expect(torrentFacts(torrent(DUAL), read(DUAL), en, "en").tech).toEqual(["HEVC", "10bit", "Dual audio"])
    })

    it("writes 4k as 2160p", () => {
        const name = "[SubsPlease] Frieren (01-12) (4k) [Batch]"
        const facts = torrentFacts(torrent(name), read(name), en, "en")
        expect(facts.resolution).toBe("2160p")
        expect(factsHead(facts)).toBe("SubsPlease · Ep 1–12")
        expect(resolutionLabel("UHD")).toBe("2160p")
        expect(resolutionLabel("1920x1080")).toBe("1080p")
        expect(resolutionLabel("")).toBe("")
    })

    it("says ? seeders and leaves the leechers out when the provider counts none (-1)", () => {
        const facts = torrentFacts(torrent(SUBSPLEASE, { seeders: -1, leechers: 0 }), read(SUBSPLEASE), en, "en", { now: NOW })
        expect(facts.seeders).toBe("? seeders")
        expect(facts.leechers).toBe("")
        expect(facts.health).toBe("unknown")
    })

    it("leaves an empty date and an unknown size out, and makes the size from the bytes when the text is missing", () => {
        const facts = torrentFacts(torrent(SUBSPLEASE, { date: "", size: 0, formattedSize: "" }), read(SUBSPLEASE), en, "en", { now: NOW })
        expect(factsLine(facts)).toBe("332 seeders · 18 leechers")
        expect(torrentFacts(torrent(SUBSPLEASE, { formattedSize: "", size: 1_503_238_554 }), undefined, en, "en").size).toBe("1.4 GiB")
        expect(sizeText(734_003_200)).toBe("700 MiB")
        expect(sizeText(0)).toBe("")
    })

    it("still shows the provider's facts before the name is read", () => {
        const facts = torrentFacts(torrent(JUDAS, { size: 5_905_580_032 }), undefined, en, "en")
        expect(factsHead(facts)).toBe("Batch")
        expect(facts.resolution).toBe("")
    })

    it("speaks German and counts seeders and leechers", () => {
        const facts = torrentFacts(torrent(SUBSPLEASE, { seeders: 1, leechers: 1 }), read(SUBSPLEASE), de, "de", { now: NOW })
        expect(factsHead(facts)).toBe("SubsPlease · S2 · Folge 5")
        expect(factsLine(facts)).toBe("1 Seeder · 1 Leecher · 1.4 GiB · vor 3 Tagen")
        expect(torrentFacts(torrent(SUBSPLEASE, { seeders: 0 }), read(SUBSPLEASE), de, "de").seeders).toBe("Keine Seeder")
    })

    it("grades the seeders: none red, under 10 yellow, from 10 green", () => {
        expect([-1, 0, 9, 10].map(seedHealth)).toEqual(["unknown", "none", "low", "good"])
    })

    it("says the whole card in one sentence", () => {
        const facts = torrentFacts(torrent(JUDAS, { formattedSize: "5.5 GiB" }), read(JUDAS), en, "en", { provider: "Nyaa", now: NOW })
        expect(factsSentence(JUDAS, facts, ["Best match"])).toBe(`${JUDAS}, Best match, Judas · S2 · Batch, 1080p, 332 seeders · 18 leechers · 5.5 GiB · 3 days ago · Nyaa, HEVC, 10bit, Multi subs`)
    })
})

describe("Best match", () => {
    const hash = (n: number) => String(n).repeat(40).slice(0, 40)
    const list = [
        torrent("[Erai-raws] Sousou no Frieren 2nd Season - 05 [720p][Multiple Subtitle]", { infoHash: hash(1), seeders: 900 }),
        torrent(SUBSPLEASE, { infoHash: hash(2), seeders: 332 }),
        torrent("[SubsPlease] Sousou no Frieren S2 - 04 (1080p) [0A1B2C3D].mkv", { infoHash: hash(3), seeders: 2000 }),
        torrent("[Nobody] Sousou no Frieren S2 - 05 (1080p).mkv", { infoHash: hash(4), seeders: 0 }),
    ]

    it("marks the torrent auto-select takes: the episode wanted, seeded, the highest resolution", () => {
        expect(bestMatchKey(list, emptyProfile(), 5, "")).toBe(hash(2))
    })

    it("follows the user's profile and preferred resolution", () => {
        expect(bestMatchKey(list, { ...emptyProfile(), resolutions: ["720p"] }, 5, "")).toBe(hash(1))
        expect(bestMatchKey(list, emptyProfile(), 5, "720p")).toBe(hash(1))
    })

    it("marks none when nothing fits", () => {
        expect(bestMatchKey(list, { ...emptyProfile(), excludeTerms: ["frieren"] }, 5, "")).toBe("")
        expect(bestMatchKey([], emptyProfile(), 5, "")).toBe("")
    })

    it("knows a result by its info hash, else its link", () => {
        expect(torrentKey(list[1]!)).toBe(hash(2))
        expect(torrentKey(torrent("x", { infoHash: "", link: "https://nyaa.si/view/1" }))).toBe("https://nyaa.si/view/1")
    })
})

describe("copying the magnet link (long press and copy button)", () => {
    it("copies the provider's magnet link", async () => {
        const written: string[] = []
        const magnet = "magnet:?xt=urn:btih:4277ef46aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&dn=Frieren"
        expect(await copyMagnet({ magnetLink: magnet, infoHash: "" }, async text => written.push(text))).toBe(true)
        expect(written).toEqual([magnet])
    })

    it("makes one of the info hash, and copies nothing without either", async () => {
        const written: string[] = []
        expect(await copyMagnet({ magnetLink: "", infoHash: "4277EF46AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }, async text => written.push(text))).toBe(true)
        expect(written).toEqual(["magnet:?xt=urn:btih:4277ef46aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"])
        expect(await copyMagnet({ magnetLink: "", infoHash: "" }, async text => written.push(text))).toBe(false)
        expect(written).toHaveLength(1)
    })
})

describe("reading names in turns", () => {
    it("reads a few names per turn, each name once", () => {
        const names = Array.from({ length: NAMES_PER_TURN * 2 + 3 }, (_, i) => `[Group${i}] Turn Test - ${String(i + 1).padStart(2, "0")} [1080p].mkv`)
        const turns: (() => void)[] = []
        let done = 0
        readNamesInTurns([...names, names[0]!], () => done++, step => turns.push(step))
        expect(readingOf(names[0]!)).toBeUndefined()
        turns.shift()!()
        expect(readingOf(names[NAMES_PER_TURN - 1]!)?.release_group).toBe(`Group${NAMES_PER_TURN - 1}`)
        expect(readingOf(names[NAMES_PER_TURN]!)).toBeUndefined()
        while (turns.length) turns.shift()!()
        expect(done).toBe(3)
        expect(readingOf(names[names.length - 1]!)?.video_resolution).toBe("1080p")
    })

    it("stops when told", () => {
        const turns: (() => void)[] = []
        const stop = readNamesInTurns(["[Stop] Test - 01 [720p].mkv"], () => undefined, step => turns.push(step))
        stop()
        turns.shift()!()
        expect(readingOf("[Stop] Test - 01 [720p].mkv")).toBeUndefined()
    })
})
