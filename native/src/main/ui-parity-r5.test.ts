import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

// UI round 5 (S22, 10.11.): smaller deviations from the 2.0.32 code found next to the sheets, toasts and empty states
const read = (path: string) => readFileSync(join(__dirname, path), "utf8")

describe("UI round 5", () => {
    // 4.2.0: the lists sheet's quiet .ps-more line became the search sheet's accent text action, one "Show all" for both
    it("shows all filter tags with the same text action in the lists and the search sheet", () => {
        expect(read("lists/_screens/lists-phone-filters.tsx")).toMatch(/<View className="-ml-2 self-start"><TextAction label=\{t\(`Show all \$\{tagChips\.total\} tags`/)
        expect(read("search/_screens/search-phone-filters.tsx")).toMatch(/<View className="-ml-2 self-start"><TextAction label=\{t\(`Show all \$\{tags\.total\} tags`/)
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
