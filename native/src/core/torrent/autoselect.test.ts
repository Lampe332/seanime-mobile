import { describe, expect, it } from "vitest"
import { type AutoSelectProfile, type FoundTorrent, chooseTorrent, decodeEntities, emptyProfile, isMovieRelease, profileOf, readTorrent, resolutionHeight } from "./autoselect"

// 4.2.0 (Chamok): "Prefer larger files" and the minimum seeders, with release names as Nyaa lists them
const HASH = "ab".repeat(20)
const GiB = 1024 ** 3

function nyaa(name: string, size: number, seeders: number): FoundTorrent {
    return { provider: "nyaa", name, size, seeders, magnetLink: `magnet:?xt=urn:btih:${HASH}`, infoHash: HASH, isBestRelease: false }
}

// Episode 5 of Frieren season 2 in 1080p from three groups: no profile list tells them apart
const SUBSPLEASE = nyaa("[SubsPlease] Sousou no Frieren S2 - 05 (1080p) [4277EF46].mkv", 1.4 * GiB, 332)
const ERAI = nyaa("[Erai-raws] Sousou no Frieren 2nd Season - 05 [1080p][Multiple Subtitle][ENG][POR-BR]", 1.4 * GiB, 120)
const EMBER = nyaa("[EMBER] Sousou no Frieren S2 - 05 [1080p] [HEVC WEBRip DDP]", 2.1 * GiB, 41)

const pick = (list: FoundTorrent[], profile: Partial<AutoSelectProfile> = {}) =>
    chooseTorrent(list, { ...emptyProfile(), ...profile }, { episodeNumber: 5, preferredResolution: "" })?.torrent.name ?? null

describe("auto-select: prefer larger files", () => {
    it("is off by default: more seeders win, then the smaller file (as in 4.1)", () => {
        expect(pick([EMBER, ERAI, SUBSPLEASE])).toBe(SUBSPLEASE.name)
        // the same seeders: the smaller download
        expect(pick([{ ...EMBER, seeders: 332 }, SUBSPLEASE])).toBe(SUBSPLEASE.name)
    })

    it("on, the larger release wins among otherwise equal ones, before the seeders", () => {
        expect(pick([SUBSPLEASE, ERAI, EMBER], { preferLargerFiles: true })).toBe(EMBER.name)
        // the same size: the seeders still decide
        expect(pick([ERAI, SUBSPLEASE], { preferLargerFiles: true })).toBe(SUBSPLEASE.name)
    })

    it("does not override what ranks before it: resolution and the preferred group", () => {
        const remux = nyaa("Sousou.no.Frieren.S02E05.720p.WEB-DL.AAC2.0.H.264-VARYG", 3 * GiB, 10)
        expect(pick([SUBSPLEASE, remux], { preferLargerFiles: true })).toBe(SUBSPLEASE.name)
        expect(pick([SUBSPLEASE, EMBER], { preferLargerFiles: true, releaseGroups: ["SubsPlease"] })).toBe(SUBSPLEASE.name)
    })

    it("is kept in the profile only when on, so a saved 4.1 profile reads the same", () => {
        expect(profileOf({ preferLargerFiles: true }).preferLargerFiles).toBe(true)
        expect("preferLargerFiles" in profileOf({ preferLargerFiles: false })).toBe(false)
        expect("preferLargerFiles" in profileOf({ preferLargerFiles: "yes" })).toBe(false)
    })
})

describe("auto-select: minimum seeders", () => {
    it("leaves out torrents below the minimum, also the larger one", () => {
        expect(pick([SUBSPLEASE, ERAI, EMBER], { preferLargerFiles: true, minSeeders: 50 })).toBe(SUBSPLEASE.name)
        expect(pick([ERAI, EMBER], { minSeeders: 200 })).toBeNull()
        // exactly the minimum is enough
        expect(pick([EMBER], { minSeeders: 41 })).toBe(EMBER.name)
    })

    it("reads only whole numbers from 0 up", () => {
        expect(profileOf({ minSeeders: 5 }).minSeeders).toBe(5)
        expect(profileOf({ minSeeders: -1 }).minSeeders).toBeUndefined()
        expect(profileOf({ minSeeders: 2.5 }).minSeeders).toBeUndefined()
    })
})

// 4.2.0 E (S22): One Piece episode 1 gave "Best match" to the live-action series of 2023, all three from Internet Archive
describe("auto-select: a name dated for another show", () => {
    const archive = (name: string, size: number): FoundTorrent => ({
        provider: "internet-archive", name, size, seeders: 1, downloadUrl: `https://archive.org/download/${encodeURIComponent(name)}.torrent`, isBestRelease: false,
    })
    const LIVE_ACTION = archive("ONE.PIECE.2023.S01E01.ROMANCE.DAWN.1080p.NF.WEB-DL.x265.10Bit.6CH-PSA", 8.1 * GiB)
    const OP_001 = archive("One Piece 001", 87.5 * 1024 ** 2)
    const OP_HQ = archive("One Piece - 001 - Im gonna be King of the Pirates HQ{C_P}.mp4", 678.9 * 1024 ** 2)
    const onePiece = (list: FoundTorrent[], startYear = 1999) =>
        chooseTorrent(list, emptyProfile(), { episodeNumber: 1, preferredResolution: "", startYear })?.torrent.name ?? null

    it("leaves out the live-action series of 2023 for the anime of 1999", () => {
        expect(onePiece([OP_001, OP_HQ, LIVE_ACTION])).not.toBe(LIVE_ACTION.name)
        expect(onePiece([LIVE_ACTION])).toBeNull()
    })

    it("leaves out another show of the same name: the remake for the original, the original for the remake", () => {
        const hxh2011 = nyaa("[DB] Hunter x Hunter (2011) - 001 [1080p][HEVC 10bit]", 300 * 1024 ** 2, 50)
        const hxh1999 = nyaa("[Judas] Hunter x Hunter (1999) - 001 [720p]", 200 * 1024 ** 2, 20)
        const hunter = (startYear: number) => chooseTorrent([hxh2011, hxh1999], emptyProfile(), { episodeNumber: 1, preferredResolution: "", startYear })?.torrent.name
        expect(hunter(1999)).toBe(hxh1999.name)
        expect(hunter(2011)).toBe(hxh2011.name)
    })

    it("keeps names without a year, with the start year or a year beside it", () => {
        const subsplease = nyaa("[SubsPlease] One Piece - 1100 (1080p) [ABCD2023].mkv", 1.4 * GiB, 900)
        expect(chooseTorrent([subsplease], emptyProfile(), { episodeNumber: 1100, preferredResolution: "", startYear: 1999 })?.torrent.name).toBe(subsplease.name)
        const fruits = nyaa("[Judas] Fruits Basket (2019) - 01 [1080p]", GiB, 30)
        expect(chooseTorrent([fruits], emptyProfile(), { episodeNumber: 1, preferredResolution: "", startYear: 2019 })?.torrent.name).toBe(fruits.name)
        // AniList says the winter season begins in January, a group may write the year it was announced
        const early = nyaa("Sousou.no.Frieren.2023.S01E01.1080p.WEB-DL", GiB, 30)
        expect(chooseTorrent([early], emptyProfile(), { episodeNumber: 1, preferredResolution: "", startYear: 2024 })?.torrent.name).toBe(early.name)
        const batch = nyaa("[Group] One Piece (1999) - 001-1085 [1080p] (Batch)", 900 * GiB, 40)
        expect(onePiece([batch])).toBe(batch.name)
    })

    it("keeps a later season named with the year the series began, and S2 releases", () => {
        const s2 = (name: string) => chooseTorrent([nyaa(name, GiB, 30)], emptyProfile(), { episodeNumber: 5, preferredResolution: "", startYear: 2026 })?.torrent.name
        expect(s2("Sousou no Frieren (2023) - S02E05 - 1080p WEB-DL")).toBe("Sousou no Frieren (2023) - S02E05 - 1080p WEB-DL")
        expect(s2(SUBSPLEASE.name)).toBe(SUBSPLEASE.name)
        expect(s2(ERAI.name)).toBe(ERAI.name)
    })

    it("does not read the year without a start year, and no episode number as a year", () => {
        expect(onePiece([LIVE_ACTION], 0)).toBe(LIVE_ACTION.name)
        const conan = nyaa("[Group] Detective Conan - 2001 [1080p]", GiB, 30)
        expect(chooseTorrent([conan], emptyProfile(), { episodeNumber: 2001, preferredResolution: "", startYear: 1996 })?.torrent.name).toBe(conan.name)
    })
})

// 4.2.0 E (Pixel Tablet): "[A&C] One Piece - Movie 01" was Best match for episode 1 of the series
describe("auto-select: a film for a series", () => {
    const MOVIE = nyaa("[A&amp;C] One Piece - Movie 01 (BD 1080p HEVC) [Multi-Subs] [v2]", 17.9 * GiB, 6)
    const EPISODE = nyaa("[SubsPlease] One Piece - 1 (720p) [ABCD1234].mkv", 300 * 1024 ** 2, 5)
    const choose = (list: FoundTorrent[], format: string, episodeNumber = 1) =>
        chooseTorrent(list, emptyProfile(), { episodeNumber, preferredResolution: "", startYear: 1999, format })?.torrent.name ?? null

    it("reads films by the parser's type and by the words for them, decoding the name first", () => {
        expect(readTorrent(MOVIE)).toMatchObject({ movie: true, group: "a&c" })
        expect(readTorrent(nyaa("[Group] One Piece Film Red (1080p)", GiB, 9)).movie).toBe(true)
        expect(readTorrent(nyaa("[X] Kimetsu no Yaiba Gekijouban - Mugen Ressha-hen (1080p)", GiB, 9)).movie).toBe(true)
        expect(readTorrent(EPISODE).movie).toBe(false)
        expect(readTorrent(nyaa("[Group] One Piece (1999) - 001-1085 [1080p] (Batch)", 900 * GiB, 40)).movie).toBe(false)
        expect(isMovieRelease("[SubsPlease] Frieren - 01v2 (1080p)", [])).toBe(false)
    })

    it("leaves a film out for a series, never for a film", () => {
        expect(choose([MOVIE], "TV")).toBeNull()
        expect(choose([MOVIE, EPISODE], "TV")).toBe(EPISODE.name)
        expect(choose([MOVIE], "MOVIE")).toBe(MOVIE.name)
        // the format unknown: as before
        expect(choose([MOVIE], "")).toBe(MOVIE.name)
    })

    it("keeps the real episode 1, a batch and a second version", () => {
        expect(choose([EPISODE], "TV")).toBe(EPISODE.name)
        const batch = nyaa("[Group] One Piece (001-100) [1080p] [Batch]", 90 * GiB, 40)
        expect(choose([batch], "TV")).toBe(batch.name)
        const v2 = nyaa("[SubsPlease] One Piece - 01v2 (1080p) [ABCD1234].mkv", GiB, 40)
        expect(choose([v2], "TV")).toBe(v2.name)
    })

    it("decodes entities in the provider's group too", () => {
        expect(readTorrent({ ...EPISODE, releaseGroup: "A&amp;C" }).group).toBe("a&c")
        expect(decodeEntities("[A&amp;C] One Piece")).toBe("[A&C] One Piece")
    })
})

describe("auto-select: the preferred resolution from the settings", () => {
    const uhd = nyaa("[Group] Sousou no Frieren S2 - 05 [2160p]", 4 * GiB, 50)
    const fhd = nyaa("[Group] Sousou no Frieren S2 - 05 [1080p]", 1.5 * GiB, 40)
    const choose = (preferredResolution: string) =>
        chooseTorrent([uhd, fhd], emptyProfile(), { episodeNumber: 5, preferredResolution })?.torrent.name ?? null

    it("takes the 1080p torrent before 2160p when the settings say \"1080\"", () => {
        expect(choose("1080")).toBe(fhd.name)
        expect(choose("1080p")).toBe(fhd.name)
        expect(choose("")).toBe(uhd.name)
    })

    it("reads the height from every way of writing it", () => {
        expect(resolutionHeight("1080p")).toBe(1080)
        expect(resolutionHeight("1080")).toBe(1080)
        expect(resolutionHeight("1920x1080")).toBe(1080)
        expect(resolutionHeight("4K")).toBe(2160)
        expect(resolutionHeight("")).toBe(0)
    })
})
