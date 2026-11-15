import { describe, expect, it } from "vitest"
import { RECENT_SEARCHES_MAX, withoutRecentSearch, withRecentSearch } from "./recent-searches"

describe("recent searches", () => {
    it("puts the newest search first and keeps the same words once", () => {
        expect(withRecentSearch([], "  Dr.  Stone ")).toEqual(["Dr. Stone"])
        expect(withRecentSearch(["Frieren", "dr. stone"], "Dr. Stone")).toEqual(["Dr. Stone", "Frieren"])
        const list = ["Frieren"]
        expect(withRecentSearch(list, "Frieren")).toBe(list)
    })

    it("ignores empty words and keeps at most eight", () => {
        const list = ["a"]
        expect(withRecentSearch(list, "   ")).toBe(list)
        const full = Array.from({ length: RECENT_SEARCHES_MAX }, (_, i) => `t${i}`)
        const next = withRecentSearch(full, "new")
        expect(RECENT_SEARCHES_MAX).toBe(8)
        expect(next).toHaveLength(8)
        expect(next[0]).toBe("new")
        expect(next).not.toContain("t7")
    })

    it("removes one search", () => {
        expect(withoutRecentSearch(["a", "b"], "a")).toEqual(["b"])
        const list = ["a"]
        expect(withoutRecentSearch(list, "x")).toBe(list)
    })
})
