import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

// UI round 5 (S22, 10.11.): smaller deviations from the 2.0.32 code found next to the sheets, toasts and empty states
const read = (path: string) => readFileSync(join(__dirname, path), "utf8")

describe("UI round 5", () => {
    it("links Custom sources on the search results head when such an extension exists (data-search-custom-sources)", () => {
        const source = read("search/_screens/search-phone.tsx")
        expect(source).toMatch(/action=\{!!customSources\?\.length && <TextAction label=\{t\("Custom sources"/)
    })

    it("shows all list filter tags with a quiet .ps-more line, not an accent action", () => {
        const source = read("lists/_screens/lists-phone-filters.tsx")
        expect(source).toMatch(/<MoreAction label=\{t\(`Show all \$\{tagChips\.total\} tags`/)
    })

    it("gives the empty downloads' Search anime the .mdl-secondary padding (1rem)", () => {
        expect(read("android-downloads/_screens/downloads-phone.tsx")).toMatch(/intent="secondary" className="rounded-\[0\.75rem\] px-4"/)
    })

    it("draws the online page's Download as the raised .mobile-source-line block, not a pill", () => {
        expect(read("onlinestream/_containers/episode-download-sheet.tsx"))
            .toMatch(/className="rounded-\[0\.75rem\] bg-sm-surface-raised px-4 active:bg-sm-surface-control" labelClassName="text-sm"/)
    })

    it("pads the home Filter like the UI Button (12dp)", () => {
        const source = read("_features/anime-library/_containers/library-collection.tsx")
        const filter = source.slice(source.indexOf("function HomeCurrentFilter"))
        expect(filter).toMatch(/gap-1\.5 rounded-full px-3 active:bg-sm-surface-control/)
    })
})
