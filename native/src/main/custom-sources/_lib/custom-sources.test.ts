import { describe, expect, it } from "vitest"
import { customSourceType, pickCustomSource } from "./custom-sources"

describe("custom sources", () => {
    it("switches to the type the source supports", () => {
        expect(customSourceType("anime", false, true)).toBe("manga")
        expect(customSourceType("manga", true, false)).toBe("anime")
        expect(customSourceType("anime", true, true)).toBe("anime")
        expect(customSourceType("manga", false, false)).toBe("manga")
    })
    it("picks the linked source, else the last one, else the first", () => {
        const sources = [{ id: "a" }, { id: "b" }, { id: "c" }]
        expect(pickCustomSource(sources, "c", "b")).toBe("c")
        expect(pickCustomSource(sources, "gone", "b")).toBe("b")
        expect(pickCustomSource(sources, undefined, "gone")).toBe("a")
        expect(pickCustomSource([], undefined, null)).toBeNull()
    })
})
