import { describe, expect, it } from "vitest"
import { HEAD_ACTION_OVERHANG, HEAD_ACTION_SIZE, HEAD_ACTIONS_STYLE, HEADING_LINE_HEIGHT } from "./page-head"

describe("page head row (r16)", () => {
    it("keeps the title row as tall as the title's line, buttons or not", () => {
        // the buttons' margin box is exactly the title's line, so the row's height does not depend on them
        expect(HEAD_ACTION_SIZE + 2 * HEAD_ACTIONS_STYLE.marginVertical).toBe(HEADING_LINE_HEIGHT)
    })
    it("lets the 48dp buttons reach 8dp above and below the line, centred on the title", () => {
        expect(HEAD_ACTION_OVERHANG).toBe(8)
        expect(HEAD_ACTIONS_STYLE).toEqual({ marginVertical: -8 })
    })
})
