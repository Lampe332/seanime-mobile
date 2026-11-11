import { describe, expect, it } from "vitest"
import { plainDescription } from "./media-labels"

describe("plainDescription", () => {
    it("drops tags and folds white space like the web's <p>", () => {
        expect(plainDescription("The third season of Blue Lock.\n")).toBe("The third season of Blue Lock.")
        expect(plainDescription("Line one.<br>\n<br>\nLine <i>two</i>.")).toBe("Line one. Line two.")
    })

    it("is empty without a description", () => {
        expect(plainDescription(null)).toBe("")
        expect(plainDescription("<br>\n")).toBe("")
    })
})
