import { describe, expect, it } from "vitest"
import { contactHref, imprintLine, LEGAL, shortLink } from "./legal"

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
    })
})
