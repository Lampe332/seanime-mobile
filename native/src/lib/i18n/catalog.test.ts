import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { PLURAL_CATEGORIES as SCRIPT_PLURALS, valueProblem } from "../../../scripts/i18n-extract.mjs"
import { compileCatalog, type CatalogJSON, formsOf, numberOf, placeholdersOf, translateText } from "./catalog"
import { PLURAL_CATEGORIES, pluralCategory } from "./plural"

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

    it("keeps a literal text out of a template that happens to fit it (Nakama in zh: no \"your PC or home server · Stream\")", () => {
        const zh = compileCatalog({ "{0} from {1}": "{1} · {0}", "Stream from your PC or home server": "" }, "zh-Hans")
        expect(translateText(zh, "Stream from your PC or home server")).toBe("Stream from your PC or home server")
        expect(translateText(zh, "Action anime from 2024")).toBe("2024 · Action anime")
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

describe("plural values", () => {
    const ru = compileCatalog({
        "{0} files": { one: "{0} файл", few: "{0} файла", many: "{0} файлов" },
        "{0} of {1} episodes watched": { count: "{1}", one: "{0} из {1} серии", few: "{0} из {1} серий", many: "{0} из {1} серий" },
        "Tap {0}.": "Нажми {0}.",
    }, "ru")

    it("picks the Russian form for 1 / 2-4 / 5+ and the teens", () => {
        expect(["1", "2", "4", "5", "11", "12", "21", "22", "25", "111", "1 234"].map(n => translateText(ru, `${n} files`))).toEqual([
            "1 файл", "2 файла", "4 файла", "5 файлов", "11 файлов", "12 файлов", "21 файл", "22 файла", "25 файлов", "111 файлов", "1 234 файла",
        ])
    })

    it("reads decimals and thousands in the number, not one long whole number", () => {
        expect(["1,5", "2.5", "21,5"].map(n => translateText(ru, `${n} files`))).toEqual(["1,5 файла", "2.5 файла", "21,5 файла"])
        expect(["1,000", "1.001", "1 002", "1 005"].map(n => translateText(ru, `${n} files`))).toEqual([
            "1,000 файлов", "1.001 файл", "1 002 файла", "1 005 файлов",
        ])
        expect([numberOf("1,5"), numberOf("1.234.567,5"), numberOf("12"), numberOf("abc"), numberOf("1,5,")]).toEqual([1.5, 1234567.5, 12, undefined, undefined])
        const fr = compileCatalog({ "{0} hours": { one: "{0} heure", other: "{0} heures" } }, "fr")
        expect(["0", "1,5", "2"].map(n => translateText(fr, `${n} hours`))).toEqual(["0 heure", "1,5 heure", "2 heures"])
    })

    it("follows the placeholder named by count", () => {
        expect(translateText(ru, "3 of 21 episodes watched")).toBe("3 из 21 серии")
        expect(translateText(ru, "3 of 12 episodes watched")).toBe("3 из 12 серий")
    })

    it("keeps an exact rich text with its {0} for fillParts", () => {
        expect(translateText(ru, "Tap {0}.")).toBe("Нажми {0}.")
    })

    it("treats 0 and 1 as one in French and Brazilian Portuguese", () => {
        const fr = compileCatalog({ "{0} files": { one: "{0} fichier", other: "{0} fichiers" } }, "fr")
        expect(["0", "1", "2"].map(n => translateText(fr, `${n} files`))).toEqual(["0 fichier", "1 fichier", "2 fichiers"])
        expect(pluralCategory("pt-BR", 0)).toBe("one")
        expect(pluralCategory("es", 0)).toBe("other")
    })

    it("has no plural in Japanese and Chinese", () => {
        expect([0, 1, 5].map(n => pluralCategory("ja", n))).toEqual(["other", "other", "other"])
        expect(pluralCategory("zh-Hans", 1)).toBe("other")
    })

    it("uses the same plural forms as scripts/i18n-extract.mjs", () => {
        expect(PLURAL_CATEGORIES).toEqual(SCRIPT_PLURALS)
    })

    it("are checked by the script: forms of the language, placeholders in every form", () => {
        expect(valueProblem("{0} files", { one: "{0} файл", few: "{0} файла", many: "{0} файлов" }, "ru")).toBeUndefined()
        expect(valueProblem("{0} files", { one: "{0} файл", few: "файла", many: "{0} файлов" }, "ru")).toContain("few")
        expect(valueProblem("{0} files", { one: "{0} fichier", few: "{0} x" }, "fr")).toContain("do not exist")
        expect(valueProblem("{0} files", { count: "{1}", one: "{0} fichier", other: "{0} fichiers" }, "fr")).toContain("count")
    })
})

describe("language catalogs", () => {
    const dir = __dirname
    const files = fs.readdirSync(dir).filter(name => name.endsWith(".json"))

    it("exist for every catalog language", () => {
        expect(files.sort()).toEqual(["es.json", "fr.json", "ja.json", "pt-BR.json", "ru.json", "zh-Hans.json"])
    })

    for (const file of files) {
        const json = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as CatalogJSON
        const language = file.replace(/\.json$/, "")

        it(`${file}: every translation has the placeholders of its English key, in every plural form`, () => {
            const bad = Object.entries(json).filter(([key, value]) => valueProblem(key, value, language) ||
                formsOf(value).some(form => form && placeholdersOf(key).join() !== placeholdersOf(form).join()))
            expect(bad).toEqual([])
        })

        it(`${file}: no literal text goes to a template, translated or not`, () => {
            const catalog = compileCatalog(json, language)
            const literal = Object.entries(json).filter(([key]) => !/\{\d+\}/.test(key))
            const wrong = literal.filter(([key, value]) => {
                const own = typeof value === "string" ? value || key : translateText(compileCatalog({ [key]: value }, language), key)
                return translateText(catalog, key) !== own
            }).map(([key]) => key)
            expect(wrong).toEqual([])
            // the same with every literal untranslated: what a catalog behind the code would show
            const empty = compileCatalog({ ...json, ...Object.fromEntries(literal.map(([key]) => [key, ""])) }, language)
            expect(literal.filter(([key]) => translateText(empty, key) !== key).map(([key]) => key)).toEqual([])
        })

        it(`${file}: every translated template is found by its own key`, () => {
            const catalog = compileCatalog(json, language)
            const wrong = Object.entries(json)
                .filter((entry): entry is [string, string] => typeof entry[1] === "string")
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
