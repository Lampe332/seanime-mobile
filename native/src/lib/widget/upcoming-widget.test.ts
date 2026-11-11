import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

// react-native-android-widget calls the widget function outside React; compiled by the React Compiler it uses memo hooks
// and the library throws "Invalid Hook Call", the widget stays empty (device run 06.11., tablet). The directive must be
// the file's first statement.
describe("upcoming widget", () => {
    it("opts out of the React Compiler", () => {
        const source = readFileSync(join(__dirname, "upcoming-widget.tsx"), "utf8")
        const code = source.replace(/^(\s*\/\/[^\n]*\n)*/, "")
        expect(code.startsWith("\"use no memo\"")).toBe(true)
    })
})
