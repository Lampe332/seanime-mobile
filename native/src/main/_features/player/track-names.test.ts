import type { Translate } from "@/lib/app-language"
import { describe, expect, it } from "vitest"
import { titleNamesLanguage, trackDisplayName, trackLanguageName } from "./track-names"

const en: Translate = english => english
const de: Translate = (_, german) => german
const track = (lang: string, title: string, id = 1) => ({ id, lang, title })

describe("track language names", () => {
    it("names 639-1, both 639-2 codes and regional tags", () => {
        expect(trackLanguageName("jpn", en)).toBe("Japanese")
        expect(trackLanguageName("chi", en)).toBe("Chinese")
        expect(trackLanguageName("zho", de)).toBe("Chinesisch")
        expect(trackLanguageName("zh-CN", en)).toBe("Chinese")
        expect(trackLanguageName("ger", de)).toBe("Deutsch")
        expect(trackLanguageName("pt_BR", en)).toBe("Portuguese")
    })

    it("unknown, undetermined and empty codes", () => {
        expect(trackLanguageName("ta", en)).toBe("Tamil")
        expect(trackLanguageName("xyz", en)).toBe("XYZ")
        expect(trackLanguageName("und", en)).toBe("")
        expect(trackLanguageName("", en)).toBe("")
    })
})

describe("track display names", () => {
    it("title = language: no second name", () => {
        expect(trackDisplayName(track("chi", "Chinese"), en)).toBe("Chinese")
        expect(trackDisplayName(track("jpn", "Japanese"), en)).toBe("Japanese")
    })

    it("title holds the language with a region or script (the doubled name of the old app)", () => {
        expect(trackDisplayName(track("chi", "Chinese - (China)"), en)).toBe("Chinese - (China)")
        expect(trackDisplayName(track("zho", "Chinese (Simplified)"), en)).toBe("Chinese (Simplified)")
        expect(trackDisplayName(track("spa", "Spanish (Latin America)"), de)).toBe("Spanish (Latin America)")
        expect(trackDisplayName(track("ger", "Deutsch [Forced]"), en)).toBe("Deutsch [Forced]")
        expect(trackDisplayName(track("chi", "简体中文"), en)).toBe("简体中文")
    })

    it("title holds only a code of the language", () => {
        expect(trackDisplayName(track("chi", "chi"), en)).toBe("chi")
        expect(trackDisplayName(track("chi", "zh-CN"), en)).toBe("zh-CN")
        expect(trackDisplayName(track("zh-CN", "CHS"), en)).toBe("CHS")
        expect(trackDisplayName(track("eng", "Full Subs (en)"), de)).toBe("Full Subs (en)")
    })

    it("title without the language: language first", () => {
        expect(trackDisplayName(track("eng", "Signs & Songs"), en)).toBe("English · Signs & Songs")
        expect(trackDisplayName(track("eng", "Signs & Songs"), de)).toBe("Englisch · Signs & Songs")
        expect(trackDisplayName(track("jpn", "Commentary"), en)).toBe("Japanese · Commentary")
    })

    it("no title: the language alone, or the track number", () => {
        expect(trackDisplayName(track("chi", ""), en)).toBe("Chinese")
        expect(trackDisplayName(track("ger", "  "), de)).toBe("Deutsch")
        expect(trackDisplayName(track("", "", 3), en)).toBe("Track 3")
        expect(trackDisplayName(track("und", "", 2), de)).toBe("Spur 2")
    })

    it("no language: the title alone", () => {
        expect(trackDisplayName(track("", "Signs"), en)).toBe("Signs")
        expect(trackDisplayName(track("und", "Signs"), en)).toBe("Signs")
    })

    it("a code that is not the track's language does not count", () => {
        expect(titleNamesLanguage("German Signs", "eng")).toBe(false)
        expect(trackDisplayName(track("eng", "German Signs"), en)).toBe("English · German Signs")
    })
})
