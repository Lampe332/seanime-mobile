#!/usr/bin/env node
/**
 * Collects the English texts of the app's `t(en, de)` / `tr(en, de)` pairs and keeps the language catalogs in
 * src/lib/i18n/<lang>.json in step with them (lib/app-language.ts reads the catalogs; English and German stay inline).
 *
 *   node scripts/i18n-extract.mjs                    add new texts (value ""), keep translations, report orphans and coverage
 *   node scripts/i18n-extract.mjs --prune            the same, and drop orphaned keys (texts no longer in the source)
 *   node scripts/i18n-extract.mjs --check            write nothing; exit 1 when a catalog is out of step or has bad placeholders
 *   node scripts/i18n-extract.mjs --missing es [N]   print up to N untranslated keys of es.json as a JSON object (key: "")
 *   node scripts/i18n-extract.mjs --merge es f.json  copy the non-empty values of f.json into es.json (known keys, same placeholders)
 *   node scripts/i18n-extract.mjs --report           also list the dynamic t() calls the script cannot read
 *
 * Key rule: a template's `${…}` parts become {0}, {1}, … in order ("Episode ${n}" -> "Episode {0}"); a translation uses the
 * same {n} in any order. An empty value means "not translated": the app shows the English text.
 *
 * Where texts are found (src/**, files sorted by path, keys in order of first appearance):
 *  1. calls t(en, de) / tr(en, de) / translate(language, en, de): the English argument, through `?:`, `??`, `||`, parentheses and string arguments of
 *     helper calls (`count(n, "1 result", `${n} results`)`);
 *  2. object literals with `en` + `de` or `fooEn` + `fooDe` properties;
 *  3. calls that hand `t`/`tr` on together with two string arrays (`plural(t, n, ["file", "files"], ["Datei", "Dateien"])`):
 *     the first array;
 *  4. tables of rows `[…, "English", "Deutsch"]` (an array or object of at least two rows of the same length, the last two
 *     elements words rather than code values, at least one row with two different texts);
 *  5. `const FOO_DE: Record<string, string> = { "English": "Deutsch" }`: the property names.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const NATIVE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const SRC = path.join(NATIVE, "src")
const I18N = path.join(SRC, "lib", "i18n")
export const LANGUAGES = ["es", "ru", "zh-Hans", "pt-BR", "fr", "ja"]
const SKIP = [path.join(SRC, "api", "generated"), path.join(SRC, "core", "extensions", "contract"), I18N]
const TR_NAMES = new Set(["t", "tr"])

function sourceFiles(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const full = path.join(dir, entry.name)
        if (SKIP.some(skip => full.startsWith(skip))) continue
        if (entry.isDirectory()) sourceFiles(full, out)
        else if (/\.tsx?$/.test(entry.name) && !/\.(test|generated)\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(full)
    }
    return out
}

const unwrap = node => {
    while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression?.(node) || ts.isNonNullExpression(node)) node = node.expression
    return node
}
const isText = node => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)

/** The key of a string literal or template; templates get {0}, {1}, … */
function keyOf(node) {
    if (!ts.isTemplateExpression(node)) return node.text
    let key = node.head.text
    node.templateSpans.forEach((span, index) => { key += `{${index}}` + span.literal.text })
    return key
}

/** The English texts an expression can produce; `dynamic` when part of it is not a literal. */
function leaves(node, found) {
    node = unwrap(node)
    if (isText(node)) return void found.texts.push(node)
    if (ts.isConditionalExpression(node)) return void (leaves(node.whenTrue, found), leaves(node.whenFalse, found))
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(node.operatorToken.kind)) {
        return void (leaves(node.left, found), leaves(node.right, found))
    }
    if (ts.isCallExpression(node)) {
        const texts = node.arguments.map(unwrap).filter(arg => isText(arg) || ts.isConditionalExpression(arg))
        if (texts.length) return void texts.forEach(arg => leaves(arg, found))
    }
    found.dynamic = true
}

const propName = prop => prop.name && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) ? prop.name.text : undefined

/** Rows `[…, "English", "Deutsch"]`: the English element, or undefined. */
function rowEnglish(node) {
    node = unwrap(node)
    if (!ts.isArrayLiteralExpression(node) || node.elements.length < 2) return undefined
    const [en, de] = node.elements.slice(-2).map(unwrap)
    if (!isText(en) || !isText(de) || !wordy(keyOf(en)) || !wordy(keyOf(de))) return undefined
    return { en, differs: keyOf(en) !== keyOf(de), size: node.elements.length }
}

/** Words, not a code value ("kitsu_id", "row-reverse", "malId", "90", "en"). */
const wordy = text => /\p{L}/u.test(text) && !/^[a-z]{1,2}$/.test(text) && !/^[a-z][a-zA-Z0-9]*([-_][\w-]*|[A-Z][\w-]*)$/.test(text)

export function extract() {
    const keys = new Map() // key -> first place
    const dynamic = []
    const innerText = []
    const add = (node, file, src) => {
        const key = keyOf(node)
        if (!/\p{L}/u.test(key.replace(/\{\d+\}/g, ""))) return // no words: nothing to translate
        if (!keys.has(key)) keys.set(key, `${path.relative(NATIVE, file).replaceAll("\\", "/")}:${src.getLineAndCharacterOfPosition(node.getStart()).line + 1}`)
    }
    for (const file of sourceFiles(SRC)) {
        const src = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
        const where = node => `${path.relative(NATIVE, file).replaceAll("\\", "/")}:${src.getLineAndCharacterOfPosition(node.getStart()).line + 1}`
        const visit = node => {
            // 1. t(en, de)
            const call = ts.isCallExpression(node) && ts.isIdentifier(node.expression) ? node.expression.text : ""
            if (TR_NAMES.has(call) && node.arguments.length === 2 || call === "translate" && node.arguments.length === 3) {
                const found = { texts: [], dynamic: false }
                leaves(node.arguments[call === "translate" ? 1 : 0], found)
                for (const text of found.texts) {
                    add(text, file, src)
                    if (ts.isTemplateExpression(text)) {
                        // English words inside ${…} stay English in every language: report them (nested t() calls are fine)
                        const look = inner => {
                            if (ts.isCallExpression(inner) && ts.isIdentifier(inner.expression) && TR_NAMES.has(inner.expression.text)) return
                            if (ts.isCallExpression(inner) && inner.arguments.some(arg => ts.isIdentifier(arg) && TR_NAMES.has(arg.text))) return
                            if ((ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner)) && /[A-Za-z]{2}/.test(inner.text)) innerText.push(`${where(inner)}  "${inner.text}"`)
                            ts.forEachChild(inner, look)
                        }
                        text.templateSpans.forEach(span => look(span.expression))
                    }
                }
                if (found.dynamic) dynamic.push(`${where(node)}  ${node.getText(src).replace(/\s+/g, " ").slice(0, 110)}`)
            }
            // 2. { en, de } and { fooEn, fooDe }
            if (ts.isObjectLiteralExpression(node)) {
                const props = new Map(node.properties.filter(ts.isPropertyAssignment).map(prop => [propName(prop), prop]))
                for (const [name, prop] of props) {
                    if (!name) continue
                    const pair = name === "en" ? "de" : name.endsWith("En") ? name.slice(0, -2) + "De" : undefined
                    if (!pair || !props.has(pair)) continue
                    const found = { texts: [], dynamic: false }
                    leaves(prop.initializer, found)
                    found.texts.forEach(text => add(text, file, src))
                }
            }
            // 3. plural(t, n, [en…], [de…])
            if (ts.isCallExpression(node) && node.arguments.some(arg => ts.isIdentifier(arg) && TR_NAMES.has(arg.text))) {
                const arrays = node.arguments.map(unwrap).filter(arg => ts.isArrayLiteralExpression(arg) && arg.elements.length && arg.elements.every(el => isText(unwrap(el))))
                if (arrays.length >= 2) arrays[0].elements.forEach(el => add(unwrap(el), file, src))
            }
            // 4. tables of [… , en, de] rows
            if (ts.isArrayLiteralExpression(node) || ts.isObjectLiteralExpression(node)) {
                const items = ts.isArrayLiteralExpression(node) ? node.elements : node.properties.filter(ts.isPropertyAssignment).map(prop => prop.initializer)
                const rows = items.map(rowEnglish)
                if (items.length >= 2 && rows.every(Boolean) && rows.some(row => row.differs) && rows.every(row => row.size === rows[0].size)) {
                    rows.forEach(row => add(unwrap(row.en), file, src))
                }
            }
            // 5. const FOO_DE: Record<string, string> = { "English": "Deutsch" }
            if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text.endsWith("_DE") && node.initializer && ts.isObjectLiteralExpression(unwrap(node.initializer))) {
                for (const prop of unwrap(node.initializer).properties) {
                    if (ts.isPropertyAssignment(prop) && prop.name && ts.isStringLiteral(prop.name) || ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) add(prop.name, file, src)
                }
            }
            ts.forEachChild(node, visit)
        }
        visit(src)
    }
    return { keys, dynamic, innerText }
}

/** The {n} placeholders of a text, sorted. */
export const placeholdersOf = text => [...new Set(text.match(/\{\d+\}/g) ?? [])].sort()

const catalogPath = language => path.join(I18N, `${language}.json`)
const readCatalog = language => fs.existsSync(catalogPath(language)) ? JSON.parse(fs.readFileSync(catalogPath(language), "utf8")) : {}
const writeCatalog = (language, catalog) => fs.writeFileSync(catalogPath(language), JSON.stringify(catalog, null, 2) + "\n")

function badPlaceholders(catalog) {
    return Object.entries(catalog).filter(([key, value]) => value && placeholdersOf(key).join() !== placeholdersOf(value).join()).map(([key]) => key)
}

function main(args) {
    const { keys, dynamic, innerText } = extract()
    if (args[0] === "--missing") {
        const language = args[1]
        const limit = Number(args[2] ?? Infinity)
        const catalog = readCatalog(language)
        const missing = [...keys.keys()].filter(key => !catalog[key]).slice(0, limit)
        process.stdout.write(JSON.stringify(Object.fromEntries(missing.map(key => [key, ""])), null, 2) + "\n")
        return 0
    }
    if (args[0] === "--merge") {
        const [language, file] = args.slice(1)
        const catalog = readCatalog(language)
        const incoming = JSON.parse(fs.readFileSync(file, "utf8"))
        let merged = 0
        const rejected = []
        for (const [key, value] of Object.entries(incoming)) {
            if (!value) continue
            if (!keys.has(key)) rejected.push(`unknown key: ${key}`)
            else if (placeholdersOf(key).join() !== placeholdersOf(value).join()) rejected.push(`placeholders differ: ${key}  ->  ${value}`)
            else { catalog[key] = value; merged++ }
        }
        writeCatalog(language, Object.fromEntries([...keys.keys()].map(key => [key, catalog[key] ?? ""]).concat(Object.entries(catalog).filter(([key]) => !keys.has(key)))))
        console.log(`${language}: merged ${merged}, rejected ${rejected.length}`)
        rejected.forEach(line => console.log("  " + line))
        return rejected.length ? 1 : 0
    }

    const check = args.includes("--check")
    const prune = args.includes("--prune")
    let failed = false
    console.log(`${keys.size} English texts (${[...keys.keys()].filter(key => /\{\d+\}/.test(key)).length} with placeholders)`)
    for (const language of LANGUAGES) {
        const catalog = readCatalog(language)
        const orphans = Object.keys(catalog).filter(key => !keys.has(key))
        const added = [...keys.keys()].filter(key => !(key in catalog))
        const done = [...keys.keys()].filter(key => catalog[key]).length
        const bad = badPlaceholders(catalog)
        const next = Object.fromEntries([...keys.keys()].map(key => [key, catalog[key] ?? ""])
            .concat(prune ? [] : orphans.map(key => [key, catalog[key]])))
        if (!check) writeCatalog(language, next)
        if (check && (added.length || orphans.length || bad.length)) failed = true
        if (bad.length) failed = true
        const percent = (100 * done / keys.size).toFixed(1)
        console.log(`${language.padEnd(7)} ${String(done).padStart(5)}/${keys.size}  ${percent.padStart(5)} %  new ${added.length}, orphaned ${orphans.length}${prune && orphans.length ? " (dropped)" : ""}, bad placeholders ${bad.length}`)
        bad.forEach(key => console.log(`    bad placeholders: ${key}`))
        if (orphans.length && !prune) orphans.slice(0, 20).forEach(key => console.log(`    orphaned: ${key}`))
    }
    if (innerText.length) {
        console.log(`\n${innerText.length} English words inside \${…} of a t() text (they stay English in every language; split the call):`)
        innerText.forEach(line => console.log("  " + line))
    }
    if (args.includes("--report")) {
        console.log(`\n${dynamic.length} t() calls with a computed English text (found only when its parts match rules 2-5):`)
        dynamic.forEach(line => console.log("  " + line))
    }
    return failed ? 1 : 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2))
