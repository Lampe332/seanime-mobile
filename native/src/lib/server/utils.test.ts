import { describe, expect, it } from "vitest"
import { getLibraryCollectionTitle, getMangaCollectionTitle } from "./utils"

const de = (_en: string, de: string) => de
const en = (en: string) => en

describe("collection titles", () => {
    it("translates every list status (4.3.1: Completed stayed English)", () => {
        expect(["CURRENT", "REPEATING", "PLANNING", "PAUSED", "COMPLETED", "DROPPED"].map(s => getLibraryCollectionTitle(s, de)))
            .toEqual(["Schaue ich gerade", "Schaue erneut", "Geplant", "Pausiert", "Fertig", "Abgebrochen"])
        expect(getMangaCollectionTitle("CURRENT", de)).toBe("Lese ich gerade")
        expect(getMangaCollectionTitle("REPEATING", de)).toBe("Lese erneut")
    })
    it("keeps the English titles and falls back for unknown types", () => {
        expect(getLibraryCollectionTitle("COMPLETED", en)).toBe("Completed")
        expect(getMangaCollectionTitle("REPEATING", en)).toBe("Rereading")
        expect(getLibraryCollectionTitle("CUSTOM", de)).toBe("Custom")
    })
})
