import { describe, expect, it } from "vitest"
import { type AutoSelectProfile, type FoundTorrent, chooseTorrent, emptyProfile, profileOf } from "./autoselect"

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
