import type { Summary_ScanSummaryFile, Summary_ScanSummaryGroup } from "@/api/generated/types"
import { describe, expect, it } from "vitest"
import { levelOf, logText, matchesQuery, newestScans, readFromName, visibleGroups } from "./scan-summaries"

const t = (en: string) => en
const file = (path: string, levels: string[] = [], parsed: Record<string, string> = {}, folders: Record<string, string>[] = []) => ({
    id: path, localFile: { path, name: path.split("/").pop(), parsedInfo: parsed, parsedFolderInfo: folders },
    logs: levels.map((level, i) => ({ id: `${path}${i}`, filePath: path, level, message: level })),
}) as unknown as Summary_ScanSummaryFile

describe("scan summaries", () => {
    it("takes the worst note of a file", () => {
        expect(levelOf(file("a", ["info", "warning", "error"]))).toBe("error")
        expect(levelOf(file("a", ["warning"]))).toBe("warning")
        expect(levelOf(file("a"))).toBeUndefined()
    })
    it("searches the path in lower case", () => {
        expect(matchesQuery(file("/Anime/Frieren/E01.mkv"), "frieren")).toBe(true)
        expect(matchesQuery(file("/Anime/Frieren/E01.mkv"), "naruto")).toBe(false)
        expect(matchesQuery(file("/x"), "")).toBe(true)
    })
    it("lists scans newest first without changing the data", () => {
        const items = [{ createdAt: "1", scanSummary: { id: "a" } }, { createdAt: "2", scanSummary: { id: "b" } }, { scanSummary: { id: "c" } }]
        expect(newestScans(items).map(i => i.scanSummary!.id)).toEqual(["b", "a"])
        expect(items[0].scanSummary.id).toBe("a")
    })
    it("orders anime with matching files by title, numbers in order", () => {
        const groups = [
            { id: "1", mediaId: 1, mediaTitle: "Show Season 10", mediaImage: "", mediaIsInCollection: true, files: [file("/s10/e1")] },
            { id: "2", mediaId: 2, mediaTitle: "Show Season 2", mediaImage: "", mediaIsInCollection: true, files: [file("/s2/e1")] },
            { id: "3", mediaId: 3, mediaTitle: "Other", mediaImage: "", mediaIsInCollection: false, files: [file("/o/e1")] },
        ] as Summary_ScanSummaryGroup[]
        expect(visibleGroups(groups, "").map(g => g.mediaId)).toEqual([3, 2, 1])
        expect(visibleGroups(groups, "/s2").map(g => g.mediaId)).toEqual([2])
    })
    it("joins what was read from the name and the folders", () => {
        const read = readFromName(file("/a", [], { title: "Frieren", episode: "3" }, [{ title: "Sousou no Frieren", season: "1" }]), t)
        expect(read[0]).toEqual(["Title", "Frieren · Sousou no Frieren"])
        expect(read[1]).toEqual(["Episode", "3"])
        expect(read[2]).toEqual(["Season", "1"])
    })
    it("explains a scanner crash", () => {
        expect(logText("PANIC: nil", t)).toContain("crashed")
        expect(logText("no match", t)).toBe("no match")
    })
})
