import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

// The hook needs NetInfo and React; the rule is read from its source (style of client-providers.test.ts).
describe("network report to the server", () => {
    it("reports again after every new connection to the server (a restarted server knows no network)", () => {
        const source = readFileSync(join(__dirname, "mobile_offline.hooks.ts"), "utf8")
        const hook = source.slice(source.indexOf("export function useReportNetworkToServer"))
        expect(hook).toContain("useAtomValue(websocketConnectedAtom)")
        expect(hook).toMatch(/if \(!connected\) return\s+return NetInfo\.addEventListener/)
        expect(hook).toMatch(/\}, \[password, connected\]\)/)
    })
})
