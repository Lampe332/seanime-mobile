// geschrieben nach: öffentlicher Doku von Rolldown 1 (JavaScript-API: rolldown(), generate()) und Sucrase 3; Vorbild scripts/bundle-extension-helpers.mjs

/*
 * Packs Sucrase (only its TypeScript transform is used) into one script, written as a string into
 * src/core/extensions/manage/transpiler.generated.ts. A sandbox runs it before an extension written in TypeScript, so
 * the types are taken out inside the sandbox, never on the app's thread (docs/EIGENER-KERN.md §4l).
 *
 *   node scripts/bundle-transpiler.mjs
 *
 * The logic tests build it again and compare (manage.test.ts).
 */

import { Buffer } from "node:buffer"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { rolldown } from "rolldown"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
export const GENERATED = path.join(root, "src/core/extensions/manage/transpiler.generated.ts")

function versionOf(name) {
    return JSON.parse(readFileSync(path.join(root, "node_modules", name, "package.json"), "utf8")).version
}

export async function buildTranspilerFile() {
    const bundle = await rolldown({ input: path.join(root, "scripts/transpiler-entry.js"), platform: "browser", logLevel: "silent" })
    const { output } = await bundle.generate({ format: "iife", name: "__transpiler", minify: true, comments: { legal: false } })
    await bundle.close()
    const script = `(function () {\n${output[0].code}\n__transpiler.install()\n})()`
    return [
        `// geschrieben nach: erzeugt von scripts/bundle-transpiler.mjs aus scripts/transpiler-entry.js mit sucrase ${versionOf("sucrase")}, ts-interface-checker ${versionOf("ts-interface-checker")}, lines-and-columns ${versionOf("lines-and-columns")} (MIT, Apache-2.0, MIT; Lizenzen in licenses/); nicht von Hand ändern`,
        "",
        "/** Puts `__seanimeTranspile(source)` (TypeScript → JavaScript, types taken out) into the sandbox it runs in */",
        `export const TRANSPILER_SCRIPT = ${JSON.stringify(script)}`,
        "",
    ].join("\n")
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const text = await buildTranspilerFile()
    writeFileSync(GENERATED, text)
    console.log(`${path.relative(root, GENERATED)}: ${(Buffer.byteLength(text) / 1024).toFixed(1)} KB`)
}
