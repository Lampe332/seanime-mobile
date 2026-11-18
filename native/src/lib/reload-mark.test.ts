import { describe, expect, it } from "vitest"
import { markAppReload, takeAppReloadMark } from "./reload-mark"

describe("reload mark", () => {
    it("is taken once after a marked reload", () => {
        expect(takeAppReloadMark()).toBe(false)
        markAppReload()
        expect(takeAppReloadMark()).toBe(true)
        // the next start (a cold start with its own link) runs the link again
        expect(takeAppReloadMark()).toBe(false)
    })
})
