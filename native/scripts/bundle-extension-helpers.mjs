// geschrieben nach: öffentlicher Doku von Rolldown 1 (JavaScript-API: rolldown(), generate(), Plugins resolveId); keine Vorlage

/*
 * Packs the helpers for extensions (src/core/extensions/helpers/prelude/) with the libraries they use into two scripts,
 * written as strings into helpers/bundle.generated.ts: the light helpers (buffer, crypto-js, whatwg-url-minimum, own
 * code, $habari, $torrentUtils) and LoadDoc/Doc/$goFeed. The app runs the first in every sandbox before an extension's code (§4i), the second (LoadDoc, Doc, $goFeed: htmlparser2,
 * css-select, domutils) only where the code names them (docs/EIGENER-KERN.md §4j).
 *
 *   node scripts/bundle-extension-helpers.mjs
 *
 * The logic tests build it again and compare (helpers.test.ts), so the file in the repo is always the one these
 * sources and the pinned versions give.
 */

import { Buffer } from "node:buffer"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { rolldown } from "rolldown"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const prelude = path.join(root, "src/core/extensions/helpers/prelude")
export const GENERATED = path.join(root, "src/core/extensions/helpers/bundle.generated.ts")
const LIBRARIES = ["buffer", "crypto-js", "whatwg-url-minimum"]
/** The libraries of the second script (LoadDoc, Doc, $goFeed), with those they pull in */
const DOC_LIBRARIES = ["htmlparser2", "css-select", "domutils", "dom-serializer", "domhandler", "domelementtype", "entities", "css-what", "nth-check", "boolbase"]

function versionOf(name) {
    return JSON.parse(readFileSync(path.join(root, "node_modules", name, "package.json"), "utf8")).version
}

/** One entry of prelude/ packed into a function of its options that installs it */
async function pack(entry) {
    const bundle = await rolldown({
        input: path.join(prelude, entry),
        platform: "browser",
        logLevel: "silent",
        plugins: [{
            name: "sandbox-random",
            // crypto-js reaches for Node's crypto for random bytes; inside the sandbox it gets random.cjs
            resolveId: id => (id === "crypto" ? path.join(prelude, "random.cjs") : null),
            // it asks `typeof require === 'function'` first, which a bundle has no global for
            transform: (code, id) => (/crypto-js[\\/]core\.js$/.test(id) ? code.replace("typeof require === 'function'", "true") : null),
        }],
    })
    const { output } = await bundle.generate({ format: "iife", name: "__helpers", minify: true, comments: { legal: false } })
    await bundle.close()
    return `(function (options) {\n${output[0].code}\n__helpers.install(options)\n})`
}

/** The text of bundle.generated.ts as these sources give it */
export async function buildHelpersFile() {
    const script = await pack("entry.js")
    const docScript = await pack("doc-entry.js")
    const libraries = [...LIBRARIES, ...DOC_LIBRARIES].map(name => `${name} ${versionOf(name)}`).join(", ")
    return [
        `// geschrieben nach: erzeugt von scripts/bundle-extension-helpers.mjs aus src/core/extensions/helpers/prelude/ mit ${libraries} (MIT, BSD-2-Clause, ISC; Lizenzen in licenses/); nicht von Hand ändern`,
        "",
        "/** The helpers for extensions as one script: a function of { preferences, offline } that puts them into the sandbox */",
        `export const HELPERS_SCRIPT = ${JSON.stringify(script)}`,
        "",
        "/** The second script: LoadDoc, Doc and $goFeed, a function of {} run only in a sandbox whose code names them */",
        `export const DOC_HELPERS_SCRIPT = ${JSON.stringify(docScript)}`,
        "",
    ].join("\n")
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const text = await buildHelpersFile()
    writeFileSync(GENERATED, text)
    console.log(`${path.relative(root, GENERATED)}: ${(Buffer.byteLength(text) / 1024).toFixed(1)} KB`)
}
