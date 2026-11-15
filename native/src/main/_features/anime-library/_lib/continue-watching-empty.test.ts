import { existsSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { CONTINUE_WATCHING_EMPTY_ACTIONS } from "./continue-watching-empty"

describe("empty Continue watching", () => {
    it("leads to the lists first, then to Discover, both screens of the app", () => {
        expect(CONTINUE_WATCHING_EMPTY_ACTIONS.map(action => action.href)).toEqual(["/lists", "/discover"])
        for (const action of CONTINUE_WATCHING_EMPTY_ACTIONS) {
            expect(existsSync(join(__dirname, "../../../../app/(main)", `${action.href.slice(1)}.tsx`)), action.href).toBe(true)
            expect(action.label.every(text => text.length > 0)).toBe(true)
        }
    })
})
