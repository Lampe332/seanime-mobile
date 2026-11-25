// geschrieben nach: Schema und Regeln des Originals (Seanime, internal/library/scanner/config.go, matcher.go, hydrator.go), wie im Auftrag beschrieben; Pfade, Namen und Nummern erfunden
import { describe, expect, it } from "vitest"
import { MAX_PATTERN, MAX_RULES, calculate, mediaIdByRule, metaByRule, readScannerConfig } from "./scanner-config"

const normal = { episode: 1, anidbEpisode: "1", type: "main" }

describe("reading the scanner rules", () => {
    it("empty, broken or odd text is no rules and never throws", () => {
        expect(readScannerConfig("")).toEqual({ matching: [], hydration: [], problems: [] })
        expect(readScannerConfig(undefined).problems).toEqual([])
        expect(readScannerConfig("{ matching: ").problems[0]).toMatch(/^not valid JSON/)
        expect(readScannerConfig("[]").problems).toEqual(["the rules must be a JSON object"])
        expect(readScannerConfig(JSON.stringify({ matching: { rules: 3 } })).problems).toEqual(["matching: \"rules\" must be a list"])
    })

    it("names the broken rule and keeps the others", () => {
        const config = readScannerConfig(JSON.stringify({ matching: { rules: [
            { pattern: "ok", mediaId: 1 }, { pattern: "(broken", mediaId: 2 }, { pattern: "", mediaId: 3 }, { pattern: "x", mediaId: 0 },
            { pattern: "a".repeat(MAX_PATTERN + 1), mediaId: 4 },
        ] } }))
        expect(config.matching.map(rule => rule.mediaId)).toEqual([1])
        expect(config.problems[0]).toMatch(/^matching rule 2: invalid pattern/)
        expect(config.problems.slice(1)).toEqual(["matching rule 3: needs a pattern and a mediaId", "matching rule 4: needs a pattern and a mediaId",
            `matching rule 5: pattern longer than ${MAX_PATTERN} characters`])
    })

    it("takes at most 200 rules", () => {
        const rules = Array.from({ length: MAX_RULES + 5 }, (_, n) => ({ pattern: `p${n}`, mediaId: n + 1 }))
        const config = readScannerConfig(JSON.stringify({ matching: { rules } }))
        expect(config.matching).toHaveLength(MAX_RULES)
        expect(config.problems).toHaveLength(5)
    })
})

describe("matching by rule", () => {
    it("is a regex on the full path, case counts unless the pattern starts with (?i)", () => {
        const config = readScannerConfig(JSON.stringify({ matching: { rules: [{ pattern: "/Movies/Made", mediaId: 7 }, { pattern: "(?i)/anime/astra", mediaId: 8 }] } }))
        expect(mediaIdByRule(config, "/sd/Movies/Made Film.mkv")).toBe(7)
        expect(mediaIdByRule(config, "/sd/movies/made film.mkv")).toBe(0)
        expect(mediaIdByRule(config, "/sd/Anime/ASTRA/01.mkv")).toBe(8)
    })
})

describe("hydration by rule", () => {
    const config = readScannerConfig(JSON.stringify({ hydration: { rules: [
        { pattern: "(?i)^made", mediaId: 7, files: [
            { filename: "E(\\d+)", isRegex: true, episode: "$1-12" },
            { filename: "Made Special.mkv", isRegex: false, episode: "2", type: "special" },
            { filename: "OP(\\d)", isRegex: true, episode: "$1", aniDbEpisode: "OP{calc($1*2+1)}", type: "nc" },
        ] },
    ] } }))

    it("sets the episode from the regex's groups and a sum", () => {
        expect(metaByRule(config, { name: "Made E15.mkv", mediaId: 7 }, normal)).toEqual({ meta: { episode: 3, anidbEpisode: "3", type: "main" }, problems: [] })
    })

    it("compares a plain filename without case, sets type and calculates {calc(...)}", () => {
        expect(metaByRule(config, { name: "made special.MKV", mediaId: 7 }, normal)?.meta).toEqual({ episode: 2, anidbEpisode: "S2", type: "special" })
        expect(metaByRule(config, { name: "Made OP2.mkv", mediaId: 7 }, normal)?.meta).toEqual({ episode: 2, anidbEpisode: "OP5", type: "nc" })
    })

    it("needs the rule's anime and a fitting file", () => {
        expect(metaByRule(config, { name: "Made E15.mkv", mediaId: 9 }, normal)).toBeNull()
        expect(metaByRule(config, { name: "Other E15.mkv", mediaId: 7 }, normal)).toBeNull()
        expect(metaByRule(config, { name: "Made 15.mkv", mediaId: 7 }, normal)).toBeNull()
    })
})

describe("the small sums", () => {
    it("knows + - * / and brackets with whole numbers, nothing else", () => {
        expect(calculate("15-12")).toBe(3)
        expect(calculate("2*(3+4)")).toBe(14)
        expect(calculate("7/2")).toBe(3)
        expect(calculate("-3+10")).toBe(7)
        expect(calculate("6×2÷4")).toBe(3)
        expect(calculate("1/0")).toBeNull()
        expect(calculate("alert(1)")).toBeNull()
        expect(calculate("(1+2")).toBeNull()
        expect(calculate("")).toBeNull()
        expect(calculate("1.5")).toBeNull()
    })
})
