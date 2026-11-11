import { describe, expect, it } from "vitest"
import { entryColumnGaps, hasTwoPanes, isShortRail, isTabletScreen, layoutWidth, readingColumn, searchBesideTabs, showsRail, TABLET_READING_WIDTH } from "./tablet-ui"

// Carried over from seanime-web lib/tablet-ui.test.ts. The web version stubbed window.screen and checked the page reload on a
// class change; the native app re-renders on dimension changes instead (use-tablet-ui.ts), so the rules are checked directly.
describe("phone or tablet layout from the screen", () => {
    it("picks the tablet layout when the smaller side is 600 dp or more", () => {
        expect(isTabletScreen({ width: 412, height: 915 })).toBe(false)
        expect(isTabletScreen({ width: 915, height: 412 })).toBe(false)
        expect(isTabletScreen({ width: 599, height: 960 })).toBe(false)
        expect(isTabletScreen({ width: 600, height: 960 })).toBe(true)
        expect(isTabletScreen({ width: 1280, height: 800 })).toBe(true)
    })

    it("decides again when a foldable opens or closes, not when the device turns", () => {
        // a phone turned stays a phone; a foldable opened becomes a tablet
        expect(isTabletScreen({ width: 915, height: 412 })).toBe(isTabletScreen({ width: 412, height: 915 }))
        expect(isTabletScreen({ width: 686, height: 854 })).toBe(true)
        // a tablet turned stays a tablet; folded shut it becomes a phone
        expect(isTabletScreen({ width: 1280, height: 800 })).toBe(isTabletScreen({ width: 800, height: 1280 }))
        expect(isTabletScreen({ width: 410, height: 820 })).toBe(false)
    })

    it("keeps the phone bar in a tablet window narrower than 600 dp", () => {
        expect(showsRail(true, { width: 1280, height: 800 })).toBe(true)
        expect(showsRail(true, { width: 599, height: 800 })).toBe(false)
        expect(showsRail(false, { width: 915, height: 412 })).toBe(false)
    })

    it("lays the tablet out against a phone width", () => {
        expect(layoutWidth(true, 1280)).toBe(430)
        expect(layoutWidth(true, 400)).toBe(400)
        expect(layoutWidth(false, 1280)).toBe(1280)
        expect(layoutWidth(true, undefined)).toBe(undefined)
    })

    it("shows two panes from 720 dp on a tablet only", () => {
        expect(hasTwoPanes(true, { width: 720, height: 900 })).toBe(true)
        expect(hasTwoPanes(true, { width: 719, height: 900 })).toBe(false)
        expect(hasTwoPanes(false, { width: 915, height: 412 })).toBe(false)
    })

    it("uses the compact rail in short windows", () => {
        expect(isShortRail({ width: 1280, height: 640 })).toBe(true)
        expect(isShortRail({ width: 1280, height: 800 })).toBe(false)
    })
})

describe("wide entry page column (tablet.css from 1000px)", () => {
    it("anime: identity margin only, progress and About touch, actions 1rem below (header dissolved into the page grid)", () => {
        // 2.0.33 tablet, Solo Leveling: progress line → About text 17dp, About line → More 17dp (the phone gaps made it 35/33)
        expect(entryColumnGaps("anime")).toEqual({ progress: 16, link: 0, about: 0, actions: 16 })
    })

    it("manga: identity margin plus the header's 1rem gap, then 1rem between the parts", () => {
        // 2.0.33 tablet, Overgeared: year → progress line 17dp lower than the native 16dp gap
        expect(entryColumnGaps("manga")).toEqual({ progress: 32, link: 16, about: 16, actions: 16 })
    })
})

describe("reading column next to the rail (r16)", () => {
    it("caps rows at the settings pane's 52rem on a tablet", () => {
        expect(TABLET_READING_WIDTH).toBe(832)
        expect(readingColumn(true)).toEqual({ width: "100%", maxWidth: 832 })
    })
    it("leaves the phone layout alone", () => {
        expect(readingColumn(false)).toBeUndefined()
    })
})

describe("search field beside Anime | Manga (r16)", () => {
    it("goes beside the segment next to the rail when segment, stats and a usable field fit", () => {
        // Pixel Tablet landscape: 1280 − 76 rail − 2 × 16 gutter
        expect(searchBesideTabs(true, 1172)).toBe(true)
        expect(searchBesideTabs(true, 876)).toBe(true)
    })
    it("keeps its own row in a narrow tablet window and on phones", () => {
        expect(searchBesideTabs(true, 875)).toBe(false)
        // Pixel Tablet portrait: 800 − 76 − 32
        expect(searchBesideTabs(true, 692)).toBe(false)
        expect(searchBesideTabs(false, 1172)).toBe(false)
    })
})
