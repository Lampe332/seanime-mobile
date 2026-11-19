import { describe, expect, it } from "vitest"
import { contactHref, DISCORD_INVITE, imprintLine, KOFI_URL, LEGAL, shortLink } from "./legal"

describe("Legal", () => {
    it("shows the imprint as on the website", () => {
        expect(imprintLine()).toBe("Nick Schäfer · Kanton Basel-Landschaft, Switzerland · info@seanimemobile.com")
    })

    it("links only to the website's own pages over https", () => {
        expect([LEGAL.website, LEGAL.privacy, LEGAL.imprint]).toEqual([
            "https://seanimemobile.com",
            "https://seanimemobile.com/privacy",
            "https://seanimemobile.com/imprint",
        ])
    })

    it("writes to the website's address", () => {
        expect(contactHref()).toBe("mailto:info@seanimemobile.com")
    })

    it("shows links without their scheme", () => {
        expect(shortLink(LEGAL.website)).toBe("seanimemobile.com")
        expect(shortLink(LEGAL.privacy)).toBe("seanimemobile.com/privacy")
        expect(shortLink(DISCORD_INVITE)).toBe("discord.gg/dxJdj5Dqt9")
    })

    it("invites to the Discord server over https", () => {
        expect(DISCORD_INVITE).toBe("https://discord.gg/dxJdj5Dqt9")
    })

    it("leads to Nick's Ko-fi page over https", () => {
        expect(KOFI_URL).toBe("https://ko-fi.com/lampe332")
        expect(shortLink(KOFI_URL)).toBe("ko-fi.com/lampe332")
    })
})
