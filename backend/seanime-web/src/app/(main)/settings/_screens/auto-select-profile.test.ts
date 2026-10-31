import { describe, expect, it } from "vitest"
import { addToken, EMPTY_FORM, formEquals, formErrors, formToProfile, isValidSize, profileToForm, removeToken, toggleToken, withStored } from "./auto-select-profile"

describe("auto-select profile", () => {
    it("treats the empty profile of the server (null lists, empty preferences) as the empty form", () => {
        const empty: any = { dbId: 0, providers: null, multipleAudioPreference: "", requireCodec: false }
        expect(profileToForm(empty)).toEqual(EMPTY_FORM)
        expect(profileToForm(null)).toEqual(EMPTY_FORM)
    })

    it("round-trips a full profile", () => {
        const profile = {
            dbId: 4, providers: ["nyaa"], releaseGroups: ["SubsPlease", "Erai-raws"], resolutions: ["1080p", "720p"], excludeTerms: ["CamRip"],
            preferredLanguages: ["jp, jpn"], preferredCodecs: ["HEVC, x265"], preferredSources: ["BDRip, BD RIP"],
            multipleAudioPreference: "avoid", multipleSubsPreference: "prefer", batchPreference: "never", bestReleasePreference: "only",
            requireLanguage: true, requireCodec: false, requireSource: true, minSeeders: 5, minSize: "200MB", maxSize: "1.5GB",
        } as const
        expect(formToProfile(profileToForm(profile), 4)).toEqual(profile)
    })

    it("sends numbers and sizes the way the server reads them", () => {
        const sent = formToProfile({ ...EMPTY_FORM, minSeeders: "12", minSize: " 300 MB " })
        expect(sent.minSeeders).toBe(12)
        expect(sent.minSize).toBe("300 MB")
        expect(formToProfile(EMPTY_FORM).minSeeders).toBe(0)
    })

    it("keeps at most three providers", () => {
        expect(formToProfile({ ...EMPTY_FORM, providers: ["a", "b", "c", "d"] }).providers).toEqual(["a", "b", "c"])
        expect(addToken(["a", "b", "c"], "d", 3)).toEqual(["a", "b", "c"])
    })

    it("adds, removes and toggles entries in order without duplicates", () => {
        expect(addToken(["A"], " a ")).toEqual(["A"])
        expect(addToken(["A"], "  ")).toEqual(["A"])
        expect(addToken(["A"], "B")).toEqual(["A", "B"])
        expect(removeToken(["A", "B"], "A")).toEqual(["B"])
        expect(toggleToken(["1080p"], "720p")).toEqual(["1080p", "720p"])
        expect(toggleToken(["1080p", "720p"], "1080p")).toEqual(["720p"])
    })

    it("validates sizes like the server and rejects a minimum above the maximum", () => {
        for (const ok of ["", "200MB", "1.5 GB", "1GiB", "500", "2tb"]) expect(isValidSize(ok)).toBe(true)
        for (const bad of ["big", "MB", "1,5GB", "-1GB", "1 GB 2"]) expect(isValidSize(bad)).toBe(false)
        expect(formErrors({ ...EMPTY_FORM, minSize: "2GB", maxSize: "500MB" })).toEqual({ maxSize: "range" })
        expect(formErrors({ ...EMPTY_FORM, minSize: "500MB", maxSize: "2GB" })).toEqual({})
        expect(formErrors({ ...EMPTY_FORM, minSize: "x" })).toEqual({ minSize: "format" })
    })

    it("compares forms and lists stored entries outside the presets", () => {
        expect(formEquals(EMPTY_FORM, { ...EMPTY_FORM })).toBe(true)
        expect(formEquals(EMPTY_FORM, { ...EMPTY_FORM, minSize: "1GB" })).toBe(false)
        const chips = withStored([{ value: "a" }], ["a", "z"], value => ({ value }))
        expect(chips.map(chip => chip.value)).toEqual(["a", "z"])
    })
})
