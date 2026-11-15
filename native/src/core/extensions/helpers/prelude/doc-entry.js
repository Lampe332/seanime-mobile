// geschrieben nach: goja_plugin_types/core.d.ts (LoadDoc, Doc, $goFeed); keine Vorlage

/*
 * The second helper script (docs/EIGENER-KERN.md §4j): what needs an HTML/XML reader. It is larger than all light
 * helpers together, so helpers.ts runs it only in a sandbox whose extension code names one of these globals.
 */

import { Doc, LoadDoc } from "./doc.js"
import { parse as parseFeed } from "./feed.js"

export function install() {
    const define = (name, value) => Object.defineProperty(globalThis, name, { value, writable: false, enumerable: false, configurable: false })
    define("LoadDoc", LoadDoc)
    define("Doc", Doc)
    define("$goFeed", Object.freeze({ parse: parseFeed }))
}
