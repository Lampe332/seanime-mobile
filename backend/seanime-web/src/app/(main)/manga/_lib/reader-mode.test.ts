import { describe, expect, it } from "vitest"
import { MangaReadingMode } from "./manga-chapter-reader.atoms"
import { MANGA_READING_MODE_AUTO, resolveReadingMode, shouldForceLandscape } from "./reader-mode"

describe("resolveReadingMode", () => {
    it("leaves the explicit modes alone", () => {
        for (const mode of Object.values(MangaReadingMode)) {
            expect(resolveReadingMode(mode, { width: 1280, height: 800 })).toBe(mode)
        }
    })
    it("auto shows a double page in wide landscape", () => {
        expect(resolveReadingMode(MANGA_READING_MODE_AUTO, { width: 1280, height: 800 })).toBe(MangaReadingMode.DOUBLE_PAGE)
    })
    it("auto shows a single page in portrait, in a square window and in a narrow landscape window", () => {
        expect(resolveReadingMode(MANGA_READING_MODE_AUTO, { width: 800, height: 1280 })).toBe(MangaReadingMode.PAGED)
        expect(resolveReadingMode(MANGA_READING_MODE_AUTO, { width: 800, height: 800 })).toBe(MangaReadingMode.PAGED)
        expect(resolveReadingMode(MANGA_READING_MODE_AUTO, { width: 640, height: 360 })).toBe(MangaReadingMode.PAGED)
    })
})

describe("shouldForceLandscape", () => {
    it("only turns phones, only for the double page choice", () => {
        expect(shouldForceLandscape(MangaReadingMode.DOUBLE_PAGE, false)).toBe(true)
        expect(shouldForceLandscape(MangaReadingMode.DOUBLE_PAGE, true)).toBe(false)
        expect(shouldForceLandscape(MANGA_READING_MODE_AUTO, false)).toBe(false)
        expect(shouldForceLandscape(MangaReadingMode.PAGED, false)).toBe(false)
    })
})
