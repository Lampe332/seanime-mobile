import type { Extension_Extension, ExtensionRepo_AllExtensions } from "@/api/generated/types"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { findSelection, installedExtensionIds, isInsecureAddress, isWebUrl, lineDiff, marketplaceView, OVERVIEW_ROWS, repositoryInstallOutcome, userConfigValues } from "./extensions-screen"

const ext = (id: string, type: string, extra: Partial<Extension_Extension> = {}) => ({
    id, name: id.toUpperCase(), type, version: "1.0.0", manifestURI: `https://x/${id}.json`, language: "javascript", lang: "en",
    author: "a", description: "", payload: "", ...extra,
} as unknown as Extension_Extension)

describe("findSelection", () => {
    const all: ExtensionRepo_AllExtensions = {
        extensions: [ext("on", "manga-provider")],
        disabledExtensions: [ext("off", "plugin")],
        invalidExtensions: [{ id: "broken", path: "/p", reason: "boom", code: "invalid_payload", extension: ext("", "plugin", { name: "" }) }],
        invalidUserConfigExtensions: [{ id: "on", path: "", reason: "user config is missing", code: "user_config_error", extension: ext("on", "manga-provider") }],
        hasUpdate: [{ extensionID: "on", manifestURI: "https://x/on2.json", version: "2.0.0", payload: "" }],
        unsafeExtensions: { off: true },
    }
    it("finds an enabled extension with its setup error and update", () => {
        const s = findSelection(all, "on")!
        expect(s.disabled).toBe(false)
        expect(s.invalid).toBeUndefined()
        expect(s.userConfigError?.id).toBe("on")
        expect(s.updateData?.version).toBe("2.0.0")
    })
    it("marks a turned off extension and its unsafe flag", () => {
        const s = findSelection(all, "off")!
        expect(s.disabled).toBe(true)
        expect(s.unsafe).toBe(true)
    })
    it("names a broken extension by its id when the manifest has none", () => {
        const s = findSelection(all, "broken")!
        expect(s.extension.id).toBe("broken")
        expect(s.extension.name).toBe("broken")
        expect(s.invalid?.code).toBe("invalid_payload")
    })
    it("returns null for an uninstalled one, so its sheet closes", () => {
        expect(findSelection(all, "gone")).toBeNull()
        expect(findSelection(undefined, "on")).toBeNull()
    })
    it("collects installed ids including broken ones", () => {
        expect([...installedExtensionIds(all)].sort()).toEqual(["broken", "off", "on"])
    })
})

describe("isWebUrl", () => {
    it("takes full http and https links", () => {
        expect(isWebUrl("https://raw.githubusercontent.com/a/b/main/index.json")).toBe(true)
        expect(isWebUrl("  http://192.168.1.20:43211/repo.json ")).toBe(true)
        expect(isWebUrl("https://example.com")).toBe(true)
    })
    it("refuses other schemes, bare hosts and spaces", () => {
        expect(isWebUrl("example.com/index.json")).toBe(false)
        expect(isWebUrl("ftp://x/index.json")).toBe(false)
        expect(isWebUrl("https://")).toBe(false)
        expect(isWebUrl("https://a b/index.json")).toBe(false)
        expect(isWebUrl("")).toBe(false)
    })
})

describe("isInsecureAddress", () => {
    it("flags plain http links in any spelling", () => {
        expect(isInsecureAddress("http://192.168.1.20:43211/repo.json")).toBe(true)
        expect(isInsecureAddress("  HTTP://example.com/manifest.json ")).toBe(true)
    })
    it("leaves https, unfinished input and nothing alone", () => {
        expect(isInsecureAddress("https://raw.githubusercontent.com/a/b/main/index.json")).toBe(false)
        expect(isInsecureAddress("htt")).toBe(false)
        expect(isInsecureAddress("example.com/index.json")).toBe(false)
        expect(isInsecureAddress("")).toBe(false)
        expect(isInsecureAddress(undefined)).toBe(false)
    })
})

describe("marketplaceView", () => {
    const data = [
        ...Array.from({ length: OVERVIEW_ROWS + 2 }, (_, i) => ext(`m${i}`, "manga-provider", { lang: i % 2 ? "de" : "en" })),
        ext("p", "plugin"),
        ext("desktop", "mediaplayer"),
    ]
    it("keeps only phone types and lists the languages", () => {
        const v = marketplaceView(data, { type: "all", language: "all", search: "" }, "en", false)
        expect(v.usable.some(e => e.id === "desktop")).toBe(false)
        expect(v.usable.some(e => e.id === "p")).toBe(false)
        expect(v.chips.map(c => c.type)).not.toContain("plugin")
        expect(v.groups.map(g => g.type)).not.toContain("plugin")
        expect(v.languages).toEqual(["de", "en"])
        expect(v.overview).toBe(true)
        expect(v.filtered).toBe(false)
    })
    it("counts chips after the language, not after the type", () => {
        const v = marketplaceView(data, { type: "plugin", language: "de", search: "" }, "en", false)
        expect(v.chips.find(c => c.type === "manga-provider")!.count).toBe(3)
        expect(v.chips.find(c => c.type === "all")!.count).toBe(3)
        expect(v.groups).toHaveLength(0)
        expect(v.filtered).toBe(true)
    })
    it("names a chosen type the repository lacks", () => {
        const v = marketplaceView(data, { type: "onlinestream-provider", language: "all", search: "" }, "en", false)
        expect(v.typeMissing?.type).toBe("onlinestream-provider")
        expect(v.overview).toBe(false)
    })
    it("says the official repository has no streaming sources", () => {
        const v = marketplaceView(data, { type: "all", language: "all", search: "" }, "en", true)
        expect(v.missing.map(m => m.type)).toEqual(["onlinestream-provider"])
        expect(marketplaceView(data, { type: "all", language: "all", search: "" }, "en", false).missing).toEqual([])
    })
})

describe("lineDiff", () => {
    it("keeps common lines and marks changes", () => {
        expect(lineDiff("a\nb\nc", "a\nB\nc\nd")).toEqual([
            { kind: "same", text: "a" }, { kind: "del", text: "b" }, { kind: "add", text: "B" }, { kind: "same", text: "c" }, { kind: "add", text: "d" },
        ])
    })
    it("ignores a BOM and CRLF line ends", () => {
        expect(lineDiff("﻿x\r\ny", "x\ny").every(l => l.kind === "same")).toBe(true)
    })
    it("finds moved-around middles by LCS", () => {
        const kinds = lineDiff("1\n2\n3\n4", "1\n3\n2\n4").map(l => l.kind)
        expect(kinds.filter(k => k === "same")).toHaveLength(3)
        expect(kinds.filter(k => k !== "same")).toHaveLength(2)
    })
    it("handles empty sides", () => {
        expect(lineDiff("", "a")).toEqual([{ kind: "del", text: "" }, { kind: "add", text: "a" }])
        expect(lineDiff("same", "same")).toEqual([{ kind: "same", text: "same" }])
    })
})

describe("userConfigValues", () => {
    it("saves every field, typed value or default", () => {
        expect(userConfigValues([{ name: "a", default: "1" }, { name: "b" }, { name: "c", default: "x" }], { c: "typed" }))
            .toEqual({ a: "1", b: "", c: "typed" })
    })
})

// 4.2.0 E (Pixel Tablet): "Successfully installed Nyaa" came in English with the app in German (the core's message)
describe("extension toasts", () => {
    const screens = ["extensions-phone-marketplace.tsx", "extensions-phone-sheets.tsx"]
        .map(file => readFileSync(join(__dirname, "..", "_screens", file), "utf8")).join("\n")
    const hooks = readFileSync(join(__dirname, "..", "..", "..", "api", "hooks", "extensions.hooks.ts"), "utf8")

    it("say install, update and removal in the app language with the extension's name", () => {
        expect(screens).not.toMatch(/response\?\.message/)
        expect(screens).toMatch(/t\(`Installed \$\{name\}`, `\$\{name\} installiert`\)/)
        expect(screens).toMatch(/t\(`Updated \$\{extension\.name \|\| extension\.id\}`/)
        expect(screens).toMatch(/t\(`Uninstalled \$\{extension\.name \|\| extension\.id\}`/)
        expect(hooks).not.toMatch(/toast\.success\("/)
    })

    it("are translated in every catalog", () => {
        for (const language of ["es", "ru", "zh-Hans", "pt-BR", "fr", "ja"]) {
            const catalog = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "lib", "i18n", `${language}.json`), "utf8")) as Record<string, string>
            for (const key of ["Installed {0}", "Updated {0}", "Uninstalled {0}", "Extension disabled.", "Extension enabled."]) {
                expect(catalog[key], `${language}: ${key}`).toBeTruthy()
                if (key.includes("{0}")) expect(catalog[key]).toContain("{0}")
            }
        }
    })
})

describe("repositoryInstallOutcome (Install all)", () => {
    const en = (english: string) => english
    const de = (_english: string, german: string) => german
    const done = (n: number) => Array.from({ length: n }, (_, index) => ({ id: `e${index}` }))
    const failed = (n: number) => Array.from({ length: n }, (_, index) => ({ name: `f${index}`, reason: "failed to load extension code" }))

    it("names the real count when some fail and keeps the sheet open", () => {
        expect(repositoryInstallOutcome(en, { extensions: done(3), failed: failed(2) })).toEqual({ kind: "warning", text: "3 of 5 installed, 2 failed" })
        expect(repositoryInstallOutcome(de, { extensions: done(3), failed: failed(2) })).toEqual({ kind: "warning", text: "3 von 5 installiert, 2 fehlgeschlagen" })
    })

    it("is a success only when every extension went in", () => {
        expect(repositoryInstallOutcome(en, { extensions: done(4), failed: [] })).toEqual({ kind: "success", text: "4 extensions installed" })
        expect(repositoryInstallOutcome(en, { extensions: done(1) })).toEqual({ kind: "success", text: "1 extension installed" })
    })

    it("is an error when none could be installed", () => {
        expect(repositoryInstallOutcome(en, { extensions: [], failed: failed(2) })).toEqual({ kind: "error", text: "None of the 2 extensions could be installed" })
        expect(repositoryInstallOutcome(de, { extensions: [], failed: failed(1) })).toEqual({ kind: "error", text: "Die Erweiterung konnte nicht installiert werden" })
    })
})
