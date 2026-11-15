import { describe, expect, it } from "vitest"
import { providerForMedia, withMediaProvider } from "./onlinestream-provider-choice"

describe("online stream provider per anime", () => {
    it("takes the anime's own provider, else the global one", () => {
        const byMedia = { 1: "aniworld" }
        expect(providerForMedia(byMedia, 1, "anikoto", ["anikoto", "aniworld"])).toBe("aniworld")
        expect(providerForMedia(byMedia, "1", "anikoto", ["anikoto", "aniworld"])).toBe("aniworld")
        expect(providerForMedia(byMedia, 2, "anikoto", ["anikoto", "aniworld"])).toBe("anikoto")
        expect(providerForMedia({}, 2, null, [])).toBeNull()
    })

    it("falls back to the global provider when the anime's one is uninstalled, not while the list is unknown", () => {
        expect(providerForMedia({ 1: "gone" }, 1, "anikoto", ["anikoto"])).toBe("anikoto")
        expect(providerForMedia({ 1: "gone" }, 1, "anikoto", [])).toBe("gone")
    })

    it("keeps a pick per anime without touching the others", () => {
        const byMedia = { 1: "aniworld" }
        expect(withMediaProvider(byMedia, 1, "aniworld")).toBe(byMedia)
        expect(withMediaProvider(byMedia, 2, "anikoto")).toEqual({ 1: "aniworld", 2: "anikoto" })
        expect(withMediaProvider(byMedia, 1, "anikoto")).toEqual({ 1: "anikoto" })
    })
})
