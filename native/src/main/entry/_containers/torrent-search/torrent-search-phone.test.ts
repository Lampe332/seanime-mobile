import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

// UI round 5 (10.11.): the torrent search sheet against torrent-search-phone.css / phone-screen.css of 2.0.32
describe("torrent search sheet", () => {
    const source = readFileSync(join(__dirname, "torrent-search-phone.tsx"), "utf8")

    // 4.2.0 (A2): the four filter groups became one group that folds away, so the first screen shows cards
    it("spaces its two groups (filters, results) .75rem apart inside (.tsp .ps-sheet-group)", () => {
        expect(source).toMatch(/const TSP_GROUP = "gap-3"/)
        expect(source.match(/<SheetGroup className=\{TSP_GROUP\}/g)?.length).toBe(2)
    })

    it("folds the filters away, closed at first and kept, with the count on the head and a line when closed", () => {
        expect(source).toMatch(/useAtom\(__torrentSearchPhone_filtersOpenAtom\)/)
        expect(source).toMatch(/\{filtersOpen && <>/)
        expect(source).toMatch(/\{!filtersOpen && <Text numberOfLines=\{2\}/)
        expect(source).toMatch(/t\(`Filters · \$\{filterLabels\.length\}`/)
        expect(source).toMatch(/<TextAction expanded=\{filtersOpen\}/)
    })

    it("keeps the search in results and the sort outside the filters, the sort in one sideways row", () => {
        const results = source.slice(source.indexOf("title={resultsTitle}"))
        expect(results).toMatch(/<SearchField value=\{resultText\}/)
        expect(results).toMatch(/<ChipRow label=\{t\("Sort by", "Sortieren nach"\)\} chips=\{sorts\}/)
    })

    it("lets one batch torrent's files be chosen, through the request's own deselect", () => {
        expect(source).toMatch(/useTorrentFileList\(only, !!shown && choosing\)/)
        expect(source).toMatch(/fileChoiceRequest\(rows, chosen\)/)
        expect(source).toMatch(/<TorrentFileChoice /)
        // no start while the list comes: the core adds the torrent for its list and lets it go after
        expect(source).toMatch(/disabled=\{[^}]*listWaiting/)
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
        expect(source).toMatch(/bestMatchKey\(shown, profile/)
        // 4.2.0 E: "Recommended" follows the same reading, the Best match first and releases of another show last
        expect(source).toMatch(/sortTorrents\(shown, sort, torrent =>/)
        expect(source).toMatch(/otherShow: new Set\(otherShowKeys\(shown,/)
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

    // 4.2.0 (A2): the copy button in the head's row, numbers and tags in one flowing text, the group cut before the episode
    it("keeps the episode in sight beside the pick box and lets the lines below the head use the width", () => {
        expect(card).toMatch(/<Text numberOfLines=\{1\} className="min-w-0 shrink [^"]*">\{group\}<\/Text>/)
        expect(card).toMatch(/className="shrink-0 [^"]*"[^>]*>\{group \? ` · \$\{rest\}` : rest\}/)
        expect(card).toMatch(/factsFlow\(facts, tags\)/)
        expect(card).toMatch(/const COPY_PLACE = \{ marginVertical: -14 \}/)
        expect(card).toMatch(/\{mode === "pick" && <View className="h-5 justify-center"><PickBox/)
    })

    it("uses the one accent only for Best match and tabular figures for the numbers", () => {
        expect(card.match(/sm-accent(?!-strong)/g)?.length).toBe(1)
        expect(card).toMatch(/fontVariant: \["tabular-nums"\]/)
        expect(card).not.toMatch(/uppercase/)
    })
})
