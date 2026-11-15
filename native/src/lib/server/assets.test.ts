import { describe, expect, it } from "vitest"
import { getAssetUrl } from "./assets"

describe("getAssetUrl", () => {
    it("keeps an image link as it is", () => {
        expect(getAssetUrl("https://example.com/banner.png?size=large")).toBe("https://example.com/banner.png?size=large")
        expect(getAssetUrl("HTTP://example.com/a b.gif")).toBe("HTTP://example.com/a b.gif")
    })
})
