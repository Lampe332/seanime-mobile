import type { Extension_Extension } from "@/api/generated/types"
import { DEFAULT_MARKETPLACE_URL } from "@/core/extensions/manage/manage"
import { describe, expect, it } from "vitest"
import { marketplaceLink, marketplacePreview, RECENT_MARKETPLACES, rememberMarketplace, sameMarketplace, storedMarketplace } from "./marketplace-link"

const ext = (id: string, type: string) => ({ id, name: id, type, manifestURI: `https://x/${id}.json` } as unknown as Extension_Extension)

describe("marketplaceLink", () => {
    it("keeps a direct .json link", () => {
        expect(marketplaceLink("https://example.org/seanime/index.json")).toBe("https://example.org/seanime/index.json")
    })
    it("finds the link in copied text and trims trailing punctuation", () => {
        expect(marketplaceLink("  Repo: https://example.org/a/index.json).\n")).toBe("https://example.org/a/index.json")
    })
    it("turns a GitHub file page into its raw file", () => {
        expect(marketplaceLink("https://github.com/owner/repo/blob/main/dist/index.json"))
            .toBe("https://raw.githubusercontent.com/owner/repo/main/dist/index.json")
        expect(marketplaceLink("https://github.com/owner/repo/raw/master/marketplace.json"))
            .toBe("https://raw.githubusercontent.com/owner/repo/master/marketplace.json")
    })
    it("turns a GitHub repository into its marketplace.json, like the official one", () => {
        expect(marketplaceLink("https://github.com/5rahim/seanime-extensions")).toBe("https://raw.githubusercontent.com/5rahim/seanime-extensions/HEAD/marketplace.json")
        expect(marketplaceLink("https://www.github.com/owner/repo.git/")).toBe("https://raw.githubusercontent.com/owner/repo/HEAD/marketplace.json")
        expect(marketplaceLink("https://github.com/owner/repo/tree/main/lists")).toBe("https://raw.githubusercontent.com/owner/repo/main/lists/marketplace.json")
    })
    it("rejects text without a full link", () => {
        expect(marketplaceLink("")).toBeNull()
        expect(marketplaceLink("example.org/index.json")).toBeNull()
        expect(marketplaceLink("ftp://example.org/index.json")).toBeNull()
    })
})

describe("sameMarketplace", () => {
    it("treats the app's empty default as the official marketplace", () => {
        expect(sameMarketplace("", DEFAULT_MARKETPLACE_URL)).toBe(true)
        expect(sameMarketplace(" ", "https://example.org/index.json")).toBe(false)
    })
    it("ignores scheme, host case, a trailing slash and refs/heads in raw links", () => {
        expect(sameMarketplace("http://Example.org/index.json/", "https://example.org/index.json")).toBe(true)
        expect(sameMarketplace("https://raw.githubusercontent.com/o/r/refs/heads/main/m.json", "https://raw.githubusercontent.com/o/r/main/m.json")).toBe(true)
        expect(sameMarketplace("https://example.org/A.json", "https://example.org/a.json")).toBe(false)
    })
    it("takes a pasted repository link (HEAD, the default branch) as that repository's marketplace on any branch", () => {
        const pasted = marketplaceLink("https://github.com/5rahim/seanime-extensions")!
        expect(pasted).toContain("/HEAD/")
        expect(sameMarketplace(pasted, "")).toBe(true)
        expect(sameMarketplace(pasted, DEFAULT_MARKETPLACE_URL)).toBe(true)
        expect(storedMarketplace(pasted)).toBe("")
        expect(sameMarketplace("https://raw.githubusercontent.com/O/R/HEAD/m.json", "https://raw.githubusercontent.com/o/r/refs/heads/dev/m.json")).toBe(true)
    })
    it("keeps other repositories, other files and two named branches apart", () => {
        expect(sameMarketplace("https://raw.githubusercontent.com/o/r/HEAD/m.json", "https://raw.githubusercontent.com/o/other/main/m.json")).toBe(false)
        expect(sameMarketplace("https://raw.githubusercontent.com/o/r/HEAD/m.json", "https://raw.githubusercontent.com/o/r/main/x.json")).toBe(false)
        expect(sameMarketplace("https://raw.githubusercontent.com/o/r/main/m.json", "https://raw.githubusercontent.com/o/r/dev/m.json")).toBe(false)
    })
})

describe("storedMarketplace", () => {
    it("stores the official marketplace as the empty default", () => {
        expect(storedMarketplace(DEFAULT_MARKETPLACE_URL.replace("/main/", "/refs/heads/main/"))).toBe("")
        expect(storedMarketplace(" https://example.org/index.json ")).toBe("https://example.org/index.json")
    })
})

describe("rememberMarketplace", () => {
    it("puts the used one first without duplicates", () => {
        expect(rememberMarketplace(["https://a.org/i.json", "https://b.org/i.json"], "http://B.org/i.json")).toEqual(["http://B.org/i.json", "https://a.org/i.json"])
    })
    it("never keeps the official one and keeps at most the limit", () => {
        const many = ["https://1.org/i.json", "https://2.org/i.json", "https://3.org/i.json", "https://4.org/i.json"]
        expect(rememberMarketplace(many, "")).toEqual(many)
        expect(rememberMarketplace([DEFAULT_MARKETPLACE_URL, ...many], "https://5.org/i.json")).toHaveLength(RECENT_MARKETPLACES)
        expect(rememberMarketplace([DEFAULT_MARKETPLACE_URL, ...many], "https://5.org/i.json")[0]).toBe("https://5.org/i.json")
    })
})

describe("marketplacePreview", () => {
    it("counts what the phone can use (no plugins), its sources and the installed ones", () => {
        const data = [ext("s1", "onlinestream-provider"), ext("s2", "onlinestream-provider"), ext("m1", "manga-provider"), ext("p1", "plugin"), ext("x", "unknown-type")]
        const preview = marketplacePreview(data, new Set(["s2"]))
        expect(preview.streaming).toBe(2)
        expect(preview.manga).toBe(1)
        expect(preview.installed).toBe(1)
        expect(preview.total).toBe(3)
    })
    it("is empty without data", () => {
        expect(marketplacePreview(undefined, new Set())).toEqual({ total: 0, streaming: 0, manga: 0, installed: 0 })
    })
})
