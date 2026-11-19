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

    // 4.2.0 (Chamok): one card for the stream list, the download list and the download sheet instead of TorrentRow,
    // TorrentPick and the sheet's own rows
    it("shows every result as a TorrentCard: stream, pick and the download sheet", () => {
        expect(source).not.toMatch(/function TorrentRow|function TorrentPick/)
        expect(source).toMatch(/<TorrentCard [^>]*mode=\{kind === "download" \? "pick" : "stream"\}/)
        expect(source).toMatch(/<TorrentCard [^>]*mode="show"/)
        expect(source.match(/<TorrentCard /g)?.length).toBe(2)
    })

    it("marks the one auto-select would take and offers the largest first", () => {
        expect(source).toMatch(/best=\{best === torrentKey\(torrent\)\}/)
        expect(source).toMatch(/bestMatchKey\(torrents, profile/)
        expect(source).toMatch(/\{ value: "largest", label: t\("Largest", "Größte"\) \}/)
    })
})

describe("torrent card", () => {
    const card = readFileSync(join(__dirname, "torrent-card.tsx"), "utf8")

    it("copies the magnet link on a long press, with the copy button and with the screen reader's action", () => {
        expect(card).toMatch(/const copy = \(\) => void copyMagnetWithToast\(torrent, t\)/)
        expect(card).toMatch(/onLongPress=\{copy\}/)
        expect(card).toMatch(/accessibilityLabel=\{t\("Copy magnet link", "Magnet-Link kopieren"\)\} onPress=\{copy\}/)
        expect(card).toMatch(/actionName === "longpress" && copy\(\)/)
        expect(card).toMatch(/copyMagnet\(torrent, Clipboard\.setStringAsync\)/)
    })

    it("keeps the copy button at 48 dp and uses tone steps, no lines or shadows except the pick box", () => {
        expect(card).toMatch(/className="h-12 w-12 items-center justify-center/)
        expect(card).not.toMatch(/shadow-|shadow[A-Z]|elevation[=:]/)
        expect(card.match(/border-/g)?.length).toBe(2)
        expect(card).toMatch(/"border-2 border-sm-text-subtle"/)
    })

    it("uses the one accent only for Best match and tabular figures for the numbers", () => {
        expect(card.match(/sm-accent(?!-strong)/g)?.length).toBe(1)
        expect(card).toMatch(/fontVariant: \["tabular-nums"\]/)
        expect(card).not.toMatch(/uppercase/)
    })
})
