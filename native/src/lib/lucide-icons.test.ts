import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Every `lucide-react-native/icons/<name>` the app imports must exist in the installed lucide version. tsc does not see a
 * wrong name (the icons resolve through a wildcard type), only the release bundle fails, minutes into a build.
 */
const SRC = join(__dirname, "..")
const ICONS = join(__dirname, "..", "..", "node_modules", "lucide-react-native", "dist", "esm", "icons")

function sources(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) return sources(path)
        return /\.tsx?$/.test(name) ? [path] : []
    })
}

describe("lucide icons", () => {
    it("are all present in the installed lucide-react-native", () => {
        const names = new Set(sources(SRC).flatMap(file => [...readFileSync(file, "utf8").matchAll(/lucide-react-native\/icons\/([a-z0-9-]+)/g)].map(match => match[1])))
        expect(names.size).toBeGreaterThan(50)
        expect([...names].filter(name => !existsSync(join(ICONS, `${name}.mjs`)))).toEqual([])
    })
})
