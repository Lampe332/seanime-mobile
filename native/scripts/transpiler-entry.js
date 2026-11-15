// geschrieben nach: öffentlicher Doku von Sucrase 3 (transform(), Transform "typescript", disableESTransforms); keine Vorlage

/*
 * The entry of the TypeScript → JavaScript script for sandboxes (scripts/bundle-transpiler.mjs). Inside a sandbox it
 * puts one function on the global object; the extension loader (core/extensions/manage/loader.ts) calls it once with
 * the extension's source and removes it afterwards. Only the types are taken out: no import/export rewriting, no
 * lowering of newer syntax (QuickJS knows it).
 */
import { transform } from "sucrase"

export function install() {
    globalThis.__seanimeTranspile = function (source) {
        return transform(String(source), { transforms: ["typescript"], disableESTransforms: true }).code
    }
}
