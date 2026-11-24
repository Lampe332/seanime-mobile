import { describe, expect, it } from "vitest"
import { formatLabel, plainDescription } from "./media-labels"

const en = (english: string) => english
const de = (_english: string, german: string) => german

describe("plainDescription", () => {
    it("drops tags and trailing white space", () => {
        expect(plainDescription("The third season of Blue Lock.\n")).toBe("The third season of Blue Lock.")
        expect(plainDescription("Line  one.<br>\n<br>\nLine <i>two</i>.")).toBe("Line one.\n\nLine two.")
    })

    it("keeps AniList's line breaks and lists, and folds more than one empty line into one", () => {
        const berserk = "Guts is a mercenary.<br><br>\n<i>Notes:</i><br>\n- Chapter 0 was published first.<br>\n- Some chapters are uncollected.<br><br><br><br>\n(Source: Dark Horse)"
        expect(plainDescription(berserk)).toBe("Guts is a mercenary.\n\nNotes:\n- Chapter 0 was published first.\n- Some chapters are uncollected.\n\n(Source: Dark Horse)")
        expect(plainDescription("<p>One</p><p>Two</p>")).toBe("One\n\nTwo")
        expect(plainDescription("<ul><li>A</li><li>B</li></ul>")).toBe("- A\n- B")
        expect(plainDescription("Tom &amp; Jerry&#39;s")).toBe("Tom & Jerry's")
    })

    it("is empty without a description", () => {
        expect(plainDescription(null)).toBe("")
        expect(plainDescription("<br>\n")).toBe("")
    })
})

describe("formatLabel", () => {
    it("names every AniList format readably in both languages", () => {
        const formats = ["TV", "TV_SHORT", "MOVIE", "SPECIAL", "OVA", "ONA", "MUSIC", "MANGA", "NOVEL", "ONE_SHOT"]
        for (const format of formats) {
            expect(formatLabel(en, format)).not.toBe(format === "TV" || format === "OVA" || format === "ONA" ? "" : format)
            expect(formatLabel(de, format)).not.toMatch(/_/)
        }
        expect(formatLabel(en, "MUSIC")).toBe("Music")
        expect(formatLabel(de, "MUSIC")).toBe("Musik")
        expect(formatLabel(en, "ONE_SHOT")).toBe("One shot")
        expect(formatLabel(de, "NOVEL")).toBe("Roman")
    })

    it("reads an unknown format as words and is empty without one", () => {
        expect(formatLabel(en, "LIVE_ACTION")).toBe("Live action")
        expect(formatLabel(en, null)).toBe("")
    })
})
