import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/*
 * Metro does not tree-shake: one `import { X } from "lucide-react-native"` put all ~2000 icon modules into the bundle
 * (1.9 MB) and ran them at every start, `date-fns` its ~290 functions and `date-fns/locale` every language (1.1 MB).
 * Icons, date functions and the locale are imported from their own files instead ("lucide-react-native/icons/x",
 * "date-fns/addDays", "date-fns/locale/de"); type-only imports from the package roots cost nothing and stay allowed.
 */
const BARRELS = ["lucide-react-native", "date-fns", "date-fns/locale"]

/** The value imports of a source file that load a whole package (`import type` does not count). */
function barrelImports(source: string): string[] {
    const found: string[] = []
    for (const match of source.matchAll(/^import\s+(?!type\s)([^"']*?)\s+from\s+["']([^"']+)["']/gm)) {
        if (BARRELS.includes(match[2])) found.push(match[0].replace(/\s+/g, " "))
    }
    return found
}

function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(dir, entry.name)
        if (entry.isDirectory()) return sourceFiles(file)
        return /\.tsx?$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [file] : []
    })
}

describe("direct imports", () => {
    it("finds a barrel import, also over several lines, and leaves type imports and direct imports alone", () => {
        expect(barrelImports(`import { Check, X } from "lucide-react-native"`)).toHaveLength(1)
        expect(barrelImports(`import {\n    addDays,\n    type Day,\n} from "date-fns"`)).toHaveLength(1)
        expect(barrelImports(`import { de } from "date-fns/locale"`)).toHaveLength(1)
        expect(barrelImports(`import * as Icons from "lucide-react-native"`)).toHaveLength(1)
        expect(barrelImports(`import type { LucideIcon } from "lucide-react-native"`)).toEqual([])
        expect(barrelImports(`import Check from "lucide-react-native/icons/check"\nimport { addDays } from "date-fns/addDays"\nimport { de } from "date-fns/locale/de"`)).toEqual([])
    })

    it("no source file imports a whole icon or date package", () => {
        const src = path.resolve(__dirname, "..")
        const offenders = sourceFiles(src).flatMap(file =>
            barrelImports(fs.readFileSync(file, "utf8")).map(statement => `${path.relative(src, file)}: ${statement}`))
        expect(offenders).toEqual([])
    })
})
