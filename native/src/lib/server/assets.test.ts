import { describe, expect, it } from "vitest"
import { getAssetUrl } from "./assets"

describe("getAssetUrl", () => {
    it("keeps an image link as it is", () => {
        expect(getAssetUrl("https://example.com/banner.png?size=large")).toBe("https://example.com/banner.png?size=large")
        expect(getAssetUrl("HTTP://example.com/a b.gif")).toBe("HTTP://example.com/a b.gif")
    })
    it("still points a file name at the assets folder", () => {
        expect(getAssetUrl("my banner (1).png")).toMatch(/\/assets\/my%20banner%20%281%29\.png$/)
        expect(getAssetUrl("https-banner.png")).toMatch(/\/assets\/https-banner\.png$/)
    })
})
