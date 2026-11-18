import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { compileCatalog, placeholdersOf, translateText } from "./catalog"

describe("translateText", () => {
    const catalog = compileCatalog({
        "Cancel": "Cancelar",
        "Not done yet": "",
        "Episode {0}": "Episodio {0}",
        "{0} of {1} downloaded": "Descargados: {1} de {0}",
        "{0} free": "{0} libres",
        "{0} chapters free": "{0} capítulos libres",
        "{0}{1} left": "faltan {0}{1}",
        "{0}": "{0}!",
    })

    it("gives the translation of a plain text", () => {
        expect(translateText(catalog, "Cancel")).toBe("Cancelar")
    })

    it("falls back to English for a text without translation or without key", () => {
        expect(translateText(catalog, "Not done yet")).toBe("Not done yet")
        expect(translateText(catalog, "Added later on another branch")).toBe("Added later on another branch")
    })

    it("fills a template's placeholders, also in another order", () => {
        expect(translateText(catalog, "Episode 12")).toBe("Episodio 12")
        expect(translateText(catalog, "3 of 10 downloaded")).toBe("Descargados: 10 de 3")
    })

    it("only matches whole texts and prefers the template with more fixed text", () => {
        expect(translateText(catalog, "Watch Episode 12")).toBe("Watch Episode 12")
        expect(translateText(catalog, "4 chapters free")).toBe("4 capítulos libres")
        expect(translateText(catalog, "2 GB free")).toBe("2 GB libres")
    })

    it("never matches a key without fixed text or with two placeholders side by side", () => {
        expect(translateText(catalog, "5m left")).toBe("5m left")
        expect(translateText(catalog, "Anything")).toBe("Anything")
    })

    it("gives the same answer again from its cache", () => {
        expect(translateText(catalog, "Episode 7")).toBe("Episodio 7")
        expect(catalog.cache.get("Episode 7")).toBe("Episodio 7")
        expect(translateText(catalog, "Episode 7")).toBe("Episodio 7")
    })
})

describe("language catalogs", () => {
    const dir = __dirname
    const files = fs.readdirSync(dir).filter(name => name.endsWith(".json"))

    it("exist for every catalog language", () => {
        expect(files.sort()).toEqual(["es.json", "fr.json", "ja.json", "pt-BR.json", "ru.json", "zh-Hans.json"])
    })

    for (const file of files) {
        const json = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as Record<string, string>

        it(`${file}: every translation has the placeholders of its English key`, () => {
            const bad = Object.entries(json).filter(([key, value]) => value && placeholdersOf(key).join() !== placeholdersOf(value).join())
            expect(bad).toEqual([])
        })

        it(`${file}: every translated template is found by its own key`, () => {
            const catalog = compileCatalog(json)
            const wrong = Object.entries(json)
                .filter(([key, value]) => value && /\{\d+\}/.test(key) && !/\}\{/.test(key) && key.replace(/\{\d+\}/g, "") !== "")
                .filter(([key, value]) => {
                    const sample = (text: string) => text.replace(/\{(\d+)\}/g, (_, index: string) => `«${index}»`)
                    return translateText(catalog, sample(key)) !== sample(value)
                })
                .map(([key]) => key)
            expect(wrong).toEqual([])
        })
    }
})
