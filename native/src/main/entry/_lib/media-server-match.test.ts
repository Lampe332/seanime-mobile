import { describe, expect, it } from "vitest"
import {
    firstEpisodeFromOffset,
    matchItemId,
    offsetFromFirstEpisode,
    parseFirstEpisode,
    ruleKind,
    startFirstEpisode,
    subjectOfLeftOut,
    subjectOfUnmatched,
} from "./media-server-match"

const season = (id: string, episodes: number, index: number) => ({ id, name: `Season ${index}`, index, episodes })

describe("offsetFromFirstEpisode", () => {
    it("is 0 when server episode 1 is AniList episode 1", () => {
        expect(offsetFromFirstEpisode(1)).toBe(0)
    })

    it("is subtracted by the core: server episode 1 as AniList episode 13 gives -12", () => {
        const offset = offsetFromFirstEpisode(13)
        expect(offset).toBe(-12)
        expect(1 - offset).toBe(13)
        expect(12 - offset).toBe(24)
    })

    it("goes back to the episode the field showed", () => {
        for (const n of [1, 2, 13, 100]) expect(firstEpisodeFromOffset(offsetFromFirstEpisode(n))).toBe(n)
    })
})

describe("parseFirstEpisode", () => {
    it("takes whole numbers of at least 1", () => {
        expect(parseFirstEpisode("1")).toBe(1)
        expect(parseFirstEpisode(" 13 ")).toBe(13)
    })

    it("refuses empty, zero, negative and broken numbers", () => {
        for (const text of ["", " ", "0", "-3", "1.5", "abc", "12a"]) expect(parseFirstEpisode(text)).toBeNull()
    })
})

describe("matchItemId", () => {
    const series = { seriesId: "series", seasons: [season("s1", 12, 1), season("s2", 12, 2)] }

    it("saves the whole series when no season is picked", () => {
        expect(matchItemId(series, null)).toBe("series")
    })

    it("saves the picked season when the series has several", () => {
        expect(matchItemId(series, "s2")).toBe("s2")
    })

    it("saves the series when it has only one season", () => {
        expect(matchItemId({ seriesId: "series", seasons: [season("s1", 12, 1)] }, "s1")).toBe("series")
    })

    it("saves the series for a season it does not have", () => {
        expect(matchItemId(series, "elsewhere")).toBe("series")
    })
})

describe("startFirstEpisode", () => {
    it("starts at 1 without a match made by hand", () => {
        expect(startFirstEpisode({ mappings: [] }, "series")).toBe(1)
    })

    it("takes the picked item's offset made by hand", () => {
        const subject = { mappings: [{ itemId: "s2", episodeOffset: -12 }, { itemId: "series", episodeOffset: 0 }] }
        expect(startFirstEpisode(subject, "s2")).toBe(13)
        expect(startFirstEpisode(subject, "series")).toBe(1)
    })
})

describe("ruleKind", () => {
    it("names numbers, title, by hand and none", () => {
        expect(["S1", "S2", "S3"].map(rule => ruleKind(rule as "S1"))).toEqual(["numbers", "numbers", "numbers"])
        expect(ruleKind("S4")).toBe("title")
        expect(ruleKind("manual")).toBe("manual")
        expect(ruleKind("none")).toBe("none")
    })
})

describe("subjectOfUnmatched", () => {
    it("counts the seasons' episodes and picks the suggestion", () => {
        const subject = subjectOfUnmatched({
            seriesId: "x", name: "Show", year: 2020, seasons: [season("a", 12, 1), season("b", 13, 2)],
            suggestion: { anilistId: 21, title: "One Piece" },
        })
        expect(subject.episodes).toBe(25)
        expect(subject.title).toEqual({ id: 21, title: "One Piece" })
        expect(subject.rule).toBe("none")
    })

    it("picks nothing without a suggestion", () => {
        expect(subjectOfUnmatched({ seriesId: "x", name: "Show", year: 0, seasons: [], suggestion: null }).title).toBeNull()
    })
})

describe("subjectOfLeftOut", () => {
    it("is left out, picks no title and carries its row, so the sheet offers Back to automatic", () => {
        const subject = subjectOfLeftOut({
            itemId: "b", seriesId: "x", name: "Show", year: 2020, seasonName: "Season 2", seasons: [season("a", 12, 1), season("b", 13, 2)],
        })
        expect(subject).toMatchObject({ seriesId: "x", rule: "left-out", title: null, episodes: 25, mappings: [{ itemId: "b", episodeOffset: 0 }] })
        expect(ruleKind(subject.rule)).toBe("left-out")
        expect(matchItemId(subject, "b")).toBe("b")
    })
})
