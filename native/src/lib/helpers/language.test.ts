import { describe, expect, it } from "vitest"
import { detectTrackLanguage, isTrackLanguageMatch } from "./language"

describe("detectTrackLanguage", () => {
    it("reads accented Latin labels by their words", () => {
        expect(detectTrackLanguage({ label: "Português (Brasil)" })).toBe("pt")
        expect(detectTrackLanguage({ label: "Español (Latinoamérica)" })).toBe("es")
        expect(detectTrackLanguage({ label: "Français" })).toBe("fr")
    })

    it("still finds Vietnamese and other scripts", () => {
        expect(detectTrackLanguage({ label: "Tiếng Việt" })).toBe("vi")
        expect(detectTrackLanguage({ label: "にほんご" })).toBe("ja")
        expect(detectTrackLanguage({ label: "Русский" })).toBe("ru")
    })

    it("prefers the language tag", () => {
        expect(detectTrackLanguage({ language: "ger", label: "Signs" })).toBe("de")
        expect(isTrackLanguageMatch({ label: "Português (Brasil)" }, "por")).toBe(true)
    })
})
