import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

// The entry pages and the extension sheet render native views and cannot run in Node; these read their source for the
// tablet rules of the tablet check (10.11.).
const manga = readFileSync(join(__dirname, "manga-entry-page.tsx"), "utf8")
const anime = readFileSync(join(__dirname, "../../entry/_containers/anime-entry-page.tsx"), "utf8")
const sheets = readFileSync(join(__dirname, "../../extensions/_screens/extensions-phone-sheets.tsx"), "utf8")

describe("top of the entry pages (Nick 10.11.: no empty bar or dark strip, on purpose unlike 2.0.32)", () => {
    it("start at the shared page top, the tablet with `[data-mobile-anime]`'s 1rem", () => {
        for (const source of [anime, manga]) {
            expect(source).toContain("paddingTop: top + (rail ? 16 : 0)")
            expect(source).toContain("backgroundImage: pageTint(0)")
            expect(source).not.toMatch(/TOP_BAR_HEIGHT|STRIP_TOP|TOP_BAR_COLOR/)
        }
    })

    it("move the puzzle and the manga downloads button into the actions; the tablet keeps the word", () => {
        expect(anime).not.toContain("{rail && <PluginTrayButton")
        expect(manga).not.toContain("{tablet && <PluginTrayButton")
        expect(manga).toMatch(/accessibilityLabel=\{t\("Manga downloads"[\s\S]{0,400}<FolderDown[\s\S]{0,120}\{tablet && <Text className="text-sm font-semibold">\{t\("Downloads"/)
    })
})

describe("manga page on the tablet", () => {

    it("lets the read action run the wide column's width (justify-self: stretch), 18rem at the start below it", () => {
        expect(manga).toContain(`tablet && !wide && "min-w-[288px] self-start"`)
    })
})

describe("entry headers in the wide tablet column", () => {
    it("space their parts by entryColumnGaps instead of the phone's gap and an extra mt-4", () => {
        for (const source of [anime, manga]) {
            expect(source).toMatch(/const gaps = wide \? entryColumnGaps\("(anime|manga)"\) : null/)
            expect(source).toContain(`<View className={gaps ? undefined : "gap-4"}>`)
            expect(source).not.toContain(`wide && "mt-4"`)
        }
    })
})

describe("extension sheet facts", () => {
    it("use the page's 1.5 line height (dt 13/19.5, dd 14/21) like .mex-facts", () => {
        expect(sheets).toContain(`"text-[13px] leading-[19.5px] text-sm-text-muted"`)
        expect(sheets).toContain(`"ml-auto text-right text-sm leading-[21px]"`)
    })
})
