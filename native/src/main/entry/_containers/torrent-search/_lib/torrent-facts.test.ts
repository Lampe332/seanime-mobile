import type { Habari_Metadata, HibikeTorrent_AnimeTorrent } from "@/api/generated/types"
import { parse } from "@/core/extensions/helpers/prelude/habari"
import { emptyProfile } from "@/core/torrent/autoselect"
import { describe, expect, it } from "vitest"
import {
    bestMatchKey,
    copyMagnet,
    factsFlow,
    factsHead,
    factsLine,
    headParts,
    factsLineWrapped,
    otherShowKeys,
    factsSentence,
    resolutionLabel,
    seedHealth,
    seedIconBox,
    sizeText,
    torrentFacts,
    torrentKey,
} from "./torrent-facts"
import { sortTorrents } from "./torrent-filters"
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
    it("names every season of a batch over several (4.2.0 E, S22: \"Frieren S1 and S2\" said only S1)", () => {
        const both = "Frieren S1 and S2"
        expect(factsHead(torrentFacts(torrent(both, { isBatch: true }), read(both), en, "en", { now: NOW }))).toBe("S1–S2 · Batch")
        // one season stays as it was
        expect(torrentFacts(torrent("Frieren S2"), read("Frieren S2"), en, "en", { now: NOW }).season).toBe("S2")
        expect(torrentFacts(torrent(SUBSPLEASE), read(SUBSPLEASE), en, "en", { now: NOW }).season).toBe("S2")
    })

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

    // names as Nyaa listed them for Frieren season 2 on 19.11.2026 (device check)
    it("reads the Nyaa batches of Frieren season 2 like the filters do", () => {
        const subsplease = "[SubsPlease] Sousou no Frieren S2 (01-10) (1080p) [Batch]"
        expect(factsHead(torrentFacts(torrent(subsplease), read(subsplease), en, "en"))).toBe("SubsPlease · S2 · Ep 1–10")
        // a list of languages in brackets is no group
        const languages = "Frieren Beyond Journeys End S02 1080p BD Remux FLAC [JAP/ENG/SPA]- AF"
        const remux = torrentFacts(torrent(languages), read(languages), en, "en")
        expect(remux.group).toBe("")
        expect(remux.tech).toContain("BluRay")
        // Nyaa's extension sends the same bracket as releaseGroup
        expect(torrentFacts(torrent(languages, { releaseGroup: "JAP/ENG/SPA" }), read(languages), en, "en").group).toBe("")
        // "BD" inside a dotted bracket: the source filter's reading of the name
        const ironclad = "[Ironclad] Sousou no Frieren - S02 [BD.1080p.AV1]"
        expect(torrentFacts(torrent(ironclad), read(ironclad), en, "en").tech).toEqual(["AV1", "BluRay"])
    })

    it("keeps each fact on one line when the line wraps", () => {
        const facts = torrentFacts(torrent(SUBSPLEASE), read(SUBSPLEASE), en, "en", { provider: "Internet Archive", now: NOW })
        expect(factsLineWrapped(facts)).toBe("332 seeders · 18 leechers · 1.4 GiB · 3 days ago · Internet Archive")
    })

    it("sizes the seeder icon to its text line: the full bar as tall as a capital, standing on the baseline (4.2.0 E)", () => {
        const { size, top } = seedIconBox(13, 18)
        expect(size).toBe(19)
        // the full bar (half the box) is at least the cap height of 13 dp text; the old 15 dp box gave 7.5 dp
        expect(size / 2).toBeGreaterThanOrEqual(13 * 0.7)
        // the bars' foot (y 20 of 24) on the baseline, about 13.7 dp down the 18 dp line
        expect(top + size * 20 / 24).toBeCloseTo(13.7, 0)
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

    it("does not mark the live-action series for the anime (4.2.0 E, S22: One Piece episode 1)", () => {
        // as Internet Archive listed them: one seeder each (no count), a .torrent file over HTTPS, only the live action names 1080p
        const archive = (name: string, n: number, size: number) => torrent(name, {
            provider: "internet-archive", infoHash: hash(n), seeders: 1, leechers: 0, size, downloadUrl: `https://archive.org/download/x${n}/x${n}.torrent`,
        })
        const shown = [
            archive("One Piece 001", 1, 91_750_400),
            archive("One Piece - 001 - Im gonna be King of the Pirates HQ{C_P}.mp4", 2, 711_884_390),
            archive("ONE.PIECE.2023.S01E01.ROMANCE.DAWN.1080p.NF.WEB-DL.x265.10Bit.6CH-PSA", 3, 8_697_308_774),
        ]
        expect(bestMatchKey(shown, emptyProfile(), 1, "", 1999)).not.toBe(hash(3))
        expect(bestMatchKey(shown, emptyProfile(), 1, "", 1999)).not.toBe("")
        // without the anime's start year the rule cannot tell (as before)
        expect(bestMatchKey(shown, emptyProfile(), 1, "")).toBe(hash(3))
    })

    // 4.2.0 E (Pixel Tablet): the card read "A&amp;C · Ep 1 · v2" and was Best match for episode 1 of the series
    it("shows a film as a film with its group decoded, and marks it only for a film", () => {
        const name = "[A&amp;C] One Piece - Movie 01 (BD 1080p HEVC) [Multi-Subs] [v2]"
        const movie = torrent(name, { infoHash: hash(5), seeders: 6, size: 19_219_633_356 })
        expect(factsHead(torrentFacts(movie, read(name), de, "de", { now: NOW }))).toBe("A&C · Film 1 · v2")
        expect(factsHead(torrentFacts(torrent(name, { releaseGroup: "A&amp;C" }), undefined, en, "en", { now: NOW }))).toBe("A&C · Movie")
        expect(torrentFacts(torrent("[Judas] One Piece - Movies 01-14 [1080p]"), read("[Judas] One Piece - Movies 01-14 [1080p]"), en, "en").episode).toBe("Movies 1–14")
        expect(bestMatchKey([movie], emptyProfile(), 1, "", 1999, "TV")).toBe("")
        expect(bestMatchKey([movie], emptyProfile(), 1, "", 2000, "MOVIE")).toBe(hash(5))
        // the real episode 1, a batch and a second version keep their reading
        const episode = "[SubsPlease] One Piece - 01v2 (1080p) [ABCD1234].mkv"
        expect(factsHead(torrentFacts(torrent(episode), read(episode), en, "en"))).toBe("SubsPlease · Ep 1 · v2")
        expect(torrentFacts(torrent(JUDAS), read(JUDAS), en, "en").episode).toBe("Batch")
        expect(bestMatchKey([torrent(episode, { infoHash: hash(6) }), movie], emptyProfile(), 1, "", 1999, "TV")).toBe(hash(6))
    })

    // 4.2.0 E (S22 retest): "Recommended" put "[A&C] One Piece - Movie 01" above the Best match, the live action read "Ep 1"
    it("orders Recommended like auto-select: the Best match first, the film and the live action last", () => {
        const nyaa = (name: string, n: number, seeders: number, size: number) => torrent(name, { infoHash: hash(n), seeders, leechers: 0, size })
        const archive = (name: string, n: number, size: number) => torrent(name, {
            provider: "internet-archive", infoHash: hash(n), seeders: 1, leechers: 0, size, downloadUrl: `https://archive.org/download/x${n}/x${n}.torrent`,
        })
        const LIVE_ACTION = "ONE.PIECE.2023.S01E01.ROMANCE.DAWN.1080p.NF.WEB-DL.x265.10Bit.6CH-PSA"
        // as the providers listed them on the S22: the film on Nyaa with 7 seeders, the rest on Internet Archive
        const shown = [
            nyaa("[A&amp;C] One Piece - Movie 01 (BD 1080p HEVC) [Multi-Subs] [v2]", 1, 7, 19_219_633_356),
            archive("One Piece 001", 2, 91_750_400),
            archive("One Piece - 001 - Im gonna be King of the Pirates HQ{C_P}.mp4", 3, 711_884_390),
            archive(LIVE_ACTION, 4, 8_697_308_774),
        ]
        const best = bestMatchKey(shown, emptyProfile(), 1, "", 1999, "TV")
        const other = new Set(otherShowKeys(shown, 1, 1999, "TV"))
        expect(other).toEqual(new Set([hash(1), hash(4)]))
        const place = (item: HibikeTorrent_AnimeTorrent) => torrentKey(item) === best ? 0 : other.has(torrentKey(item)) ? 2 : 1
        const order = sortTorrents(shown, "best", place).map(torrentKey)
        expect(order[0]).toBe(best)
        expect(order.slice(2).sort()).toEqual([hash(1), hash(4)])
        // the other sorts stay as they were
        expect(sortTorrents(shown, "seeders", place).map(torrentKey)[0]).toBe(hash(1))
        expect(sortTorrents(shown, "largest", place).map(torrentKey)).toEqual([hash(1), hash(4), hash(3), hash(2)])
        // without the anime's year and format nothing is read as another show
        expect(otherShowKeys(shown, 1)).toEqual([])
        // Frieren's own releases stay where they were
        expect(otherShowKeys([torrent(SUBSPLEASE), torrent(JUDAS), torrent(ERAI)], 5, 2026, "TV")).toEqual([])

        // the live action's card names its year, not "S1 · Ep 1" of the anime; the film stays "Movie 1"
        expect(factsHead(torrentFacts(shown[3]!, read(LIVE_ACTION), en, "en", { otherShow: true }))).toBe("PSA · 2023")
        expect(factsHead(torrentFacts(shown[3]!, read(LIVE_ACTION), en, "en"))).toBe("PSA · S1 · Ep 1")
        expect(factsHead(torrentFacts(shown[0]!, read(shown[0]!.name), en, "en", { otherShow: true }))).toBe("A&C · Movie 1 · v2")
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

// 4.2.0 (A2): beside the pick box the head was cut to "SubsPlease · S2 · Ep…"; the group gives way, the episode stays
describe("the card's head and its flowing facts", () => {
    it("splits the head into the group and the part that is never cut", () => {
        expect(headParts(torrentFacts(torrent(SUBSPLEASE), read(SUBSPLEASE), en, "en"))).toEqual({ group: "SubsPlease", rest: "S2 · Ep 5" })
        expect(headParts(torrentFacts(torrent(ERAI), read(ERAI), en, "en"))).toEqual({ group: "Erai-raws", rest: "S2 · Ep 5 · v2" })
        expect(headParts(torrentFacts(torrent(JUDAS), read(JUDAS), de, "de"))).toEqual({ group: "Judas", rest: "S2 · Batch" })
        // no group read: the rest alone
        expect(headParts(torrentFacts(torrent("Sousou no Frieren - 05 [1080p]"), read("Sousou no Frieren - 05 [1080p]"), en, "en")).group).toBe("")
    })

    it("knows a whole season or a range of episodes (the download sheet offers the files then)", () => {
        expect(torrentFacts(torrent(JUDAS), read(JUDAS), en, "en").batch).toBe(true)
        expect(torrentFacts(torrent(ASW), read(ASW), en, "en").batch).toBe(true)
        expect(torrentFacts(torrent(KAF), read(KAF), en, "en").batch).toBe(true)
        expect(torrentFacts(torrent(SUBSPLEASE), read(SUBSPLEASE), en, "en").batch).toBe(false)
    })

    it("lets the numbers and the tags flow in one text, each fact whole", () => {
        const facts = torrentFacts(torrent(JUDAS), read(JUDAS), en, "en", { provider: "Nyaa", now: NOW })
        const flow = factsFlow(facts, ["Cached", ...facts.tech])
        expect(flow.replace(/ /g, " ")).toBe("332 seeders · 18 leechers · 1.4 GiB · 3 days ago · Nyaa · Cached · HEVC · 10bit · Multi subs")
        // a line breaks only after a dot, never inside a fact
        expect(flow.split("· ").every(part => !part.includes(" "))).toBe(true)
        expect(factsFlow(facts)).toBe(factsLineWrapped(facts))
    })
})
