import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

// UI round 5 (10.11.): the torrent search sheet against torrent-search-phone.css / phone-screen.css of 2.0.32
describe("torrent search sheet", () => {
    const source = readFileSync(join(__dirname, "torrent-search-phone.tsx"), "utf8")

    it("spaces its five groups .75rem apart inside (.tsp .ps-sheet-group)", () => {
        expect(source).toMatch(/const TSP_GROUP = "gap-3"/)
        expect(source.match(/<SheetGroup className=\{TSP_GROUP\}/g)?.length).toBe(5)
    })

    it("puts the results note under the head, before the results", () => {
        expect(source).toMatch(/title=\{resultsTitle\} intro=/)
    })

    it("keeps .125rem between a picked release's name and facts", () => {
        const pick = source.slice(source.indexOf("function TorrentPick"))
        expect(pick).toMatch(/min-w-0 flex-1 gap-0\.5/)
    })
})
