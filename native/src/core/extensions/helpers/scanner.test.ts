// geschrieben nach: goja_plugin_types/core.d.ts ($scannerUtils, Beispiele buildSeasonQuery „Overlord“ und buildPartQuery „Re:Zero“ aus den Beschreibungen); übrige Prüfwerte eigene Fälle; keine Vorlage
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { nodeSandboxEngine } from "../sandbox/node-engine"
import { type ExtensionSandbox, openExtensionSandbox } from "./helpers"

const noNetwork = async () => {
    throw new Error("no network in this test")
}

let sandbox: ExtensionSandbox

beforeAll(async () => {
    sandbox = await openExtensionSandbox(nodeSandboxEngine, { fetch: noNetwork })
    await sandbox.load("function scan(name, args) { return $scannerUtils[name].apply(null, args) }\nfunction names() { return Object.keys($scannerUtils).sort() }", "scanner.js")
})

afterAll(async () => {
    await sandbox.close()
})

const scan = <T>(name: string, ...args: unknown[]) => sandbox.call<T>("scan", name, args)

describe("$scannerUtils", () => {
    it("has every function core.d.ts declares", async () => {
        expect(await sandbox.call("names")).toEqual([
            "buildAdvancedQuery", "buildPartQuery", "buildSearchQuery", "buildSeasonQuery", "buildSmartSearchTitles", "compareTitles",
            "extractPartNumber", "extractSeasonNumber", "extractYear", "findBestMatch", "getSignificantTokens", "normalizeTitle", "sanitizeQuery",
        ])
    })

    it("reads season, part and year", async () => {
        const seasons: [string, number][] = [["Overlord Season 2", 2], ["Show S03", 3], ["Attack on Titan 2nd Season", 2], ["Overlord II", 2],
            ["Konosuba 2", 2], ["進撃の巨人 3期", 3], ["Dr. STONE", -1], ["Mob Psycho 100", -1], ["Kaiju No. 8", -1], ["Season III of Show", 3], ["Fate/Zero", -1]]
        for (const [title, season] of seasons) expect([title, await scan("extractSeasonNumber", title)]).toEqual([title, season])
        const parts: [string, number][] = [["Re:Zero Part 2", 2], ["Show Cour 2", 2], ["Show Part II", 2], ["Show 2nd Cour", 2], ["Show", -1]]
        for (const [title, part] of parts) expect([title, await scan("extractPartNumber", title)]).toEqual([title, part])
        expect(await scan("extractYear", "Hunter x Hunter (2011)")).toBe(2011)
        expect(await scan("extractYear", "Mob Psycho 100")).toBe(-1)
    })

    it("normalizes macrons, possessives, separators and format words", async () => {
        const n = await scan<Record<string, unknown>>("normalizeTitle", "Kōri's Adventure: The Movie 2nd Season (2020)")
        expect(n).toMatchObject({ normalized: "koris adventure the movie 2nd season 2020", cleanBaseTitle: "koris adventure", denoisedTitle: "koris adventure", tokens: ["koris", "adventure"], season: 2, part: -1, year: 2020, isMain: false })
        expect(await scan("normalizeTitle", "Dr. STONE")).toMatchObject({ cleanBaseTitle: "dr stone", tokens: ["dr", "stone"], season: -1, isMain: true })
        expect(await scan("getSignificantTokens", "The Rising of the Shield Hero")).toEqual(["rising", "shield", "hero"])
        expect(await scan("buildSearchQuery", "The Rising of the Shield Hero Season 2")).toBe("rising shield hero")
    })

    it("compares titles and finds the best one", async () => {
        expect(await scan("compareTitles", "Dr. STONE", "dr stone")).toBe(1)
        expect(await scan<number>("compareTitles", "Dr. STONE", "Dr. Stone: New World")).toBeGreaterThan(await scan<number>("compareTitles", "Dr. STONE", "Ninja Scroll"))
        expect(await scan<number>("compareTitles", "Overlord II", "Overlord III")).toBeLessThan(1)
        expect(await scan("findBestMatch", "Sousou no Frieren", ["Frieren: Beyond Journey's End", "Sousou no Frieren", "Sousou no Frieren 2nd Season"])).toBe("Sousou no Frieren")
        expect(await scan("findBestMatch", "x", [])).toBe("")
    })

    it("builds the queries of the contract's examples", async () => {
        expect(await scan("buildSeasonQuery", "Overlord", 2)).toBe("(Overlord S02 | Overlord Season 2 | Overlord 2nd Season)")
        expect(await scan("buildSeasonQuery", "Overlord", 1)).toBe("Overlord")
        expect(await scan("buildPartQuery", "Re:Zero", 2)).toBe("(Re Zero Part 2 | Re Zero Part II | Re Zero 2nd Cour)")
        expect(await scan("buildPartQuery", "Re:Zero", 0)).toBe("Re Zero")
        expect(await scan("buildAdvancedQuery", ["One", "one", "Two (TV)"])).toBe("(One | Two TV)")
        expect(await scan("sanitizeQuery", "a (b | \"c\") *d*")).toBe("a b c d")
    })

    it("gives clean search variants with season and part", async () => {
        // the manual search hands only the typed words: the variant without the dot is a second query (§4m: 30 → 49)
        expect(await scan("buildSmartSearchTitles", ["dr. stone"])).toEqual({ titles: ["dr stone"], season: -1, part: -1 })
        expect(await scan("buildSmartSearchTitles", ["Dr. STONE: New World Part 2", "Dr. Stone: New World", ""])).toEqual({ titles: ["dr stone new world", "dr stone"], season: -1, part: 2 })
        expect(await scan("buildSmartSearchTitles", ["Shingeki no Kyojin Season 3", "Attack on Titan Season 3"])).toEqual({ titles: ["shingeki no kyojin", "attack on titan"], season: 3, part: -1 })
        expect(await scan("buildSmartSearchTitles", [])).toEqual({ titles: [], season: -1, part: -1 })
    })
})
