import { describe, expect, it } from "vitest"
import { defaultMangaProvider, fromMangaPreferences, getActiveMangaFilters, toMangaPreferences, withInstalledProviders } from "./manga-preferences"

describe("manga preferences", () => {
    it("preserves filters for inactive providers", () => {
        const preferences = toMangaPreferences(
            { "1": "provider-a" },
            {
                "1$provider-a": { scanlators: ["Group A"], language: "en" },
                "1$provider-b": { scanlators: ["Group B"], language: "fr" },
            },
        )

        expect(preferences.entries?.[1].provider).toBe("provider-a")
        expect(preferences.entries?.[1].filters?.["provider-b"]).toEqual({
            scanlators: ["Group B"],
            language: "fr",
        })
    })

    it("hydrates the local provider and filter maps", () => {
        const unpacked = fromMangaPreferences({
            entries: {
                5: {
                    provider: "provider-b",
                    filters: {
                        "provider-b": { scanlators: ["Group"], language: "ja" },
                    },
                },
            },
        })

        expect(unpacked.providers).toEqual({ "5": "provider-b" })
        expect(unpacked.filters).toEqual({
            "5$provider-b": { scanlators: ["Group"], language: "ja" },
        })
    })

    it("uses filters from the selected provider only", () => {
        const filters = getActiveMangaFilters(
            {
                "1$provider-a": { scanlators: ["Active Group"], language: "en" },
                "1$provider-b": { scanlators: ["Inactive Group"], language: "fr" },
            },
            { "1": "provider-a" },
            [{
                id: "provider-a",
                name: "Provider A",
                lang: "en",
                settings: { supportsMultiScanlator: true, supportsMultiLanguage: true },
            }],
        )

        expect(filters).toEqual({
            "1": { scanlators: ["Active Group"], language: "en" },
        })
    })
})

describe("a saved source that is gone", () => {
    const installed = [{ id: "weebcentral", name: "WeebCentral" }, { id: "mangafire", name: "MangaFire" }] as never[]

    it("falls back from the old built-in local source to the first installed one", () => {
        expect(defaultMangaProvider("local-manga", installed)).toBe("weebcentral")
        expect(defaultMangaProvider("mangafire", installed)).toBe("mangafire")
        expect(defaultMangaProvider("local-manga", [])).toBeNull()
        expect(defaultMangaProvider(undefined, undefined)).toBeNull()
    })

    it("replaces a stored local choice and keeps the others", () => {
        expect(withInstalledProviders({ "1": "local-manga", "2": "mangafire" }, installed, "weebcentral"))
            .toEqual({ "1": "weebcentral", "2": "mangafire" })
        expect(withInstalledProviders({ "2": "mangafire" }, installed, "weebcentral")).toBeNull()
    })
})
