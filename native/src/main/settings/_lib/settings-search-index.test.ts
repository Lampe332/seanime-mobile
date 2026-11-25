import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { SETTINGS_SECTIONS, type SettingsSectionId } from "@/main/settings/_lib/settings-phone"
import { type Pair, searchEntryId, type SettingsSearchEntry } from "@/main/settings/_lib/settings-search"
import { SETTINGS_SEARCH_INDEX } from "@/main/settings/_lib/settings-search-index"
import ts from "typescript"
import { describe, expect, it } from "vitest"

/*
 * The search index is read from the pages' source, never written by hand: from each area's component (the switch in
 * SectionContent) through every component of the settings folder it renders, each SettingsGroup and each row of the kit
 * with its t("English", "Deutsch") texts. The test fails as soon as the stored index differs, so a new or renamed
 * setting cannot be forgotten. Write the index anew with:
 *   UPDATE_SETTINGS_INDEX=1 npx vitest run src/main/settings/_lib/settings-search-index.test.ts
 */

const SETTINGS_DIR = join(process.cwd(), "src", "main", "settings")
const INDEX_FILE = join(SETTINGS_DIR, "_lib", "settings-search-index.ts")
/** The kit's rows; the kit and the page frame themselves are not walked into */
const ROWS = new Set(["SettingSwitch", "LocalSwitch", "ThemeSwitch", "SelectRow", "LinkRow", "InfoRow", "TextSettingRow"])
const KIT_FILES = new Set(["settings-kit.tsx", "settings-page.tsx", "settings-search.tsx"])
/** Rows inside these only show once something is opened */
const HIDDEN = new Set(["Sheet", "ConfirmSheet", "TextSheet", "Modal"])

type Props = Record<string, Pair[]>
type Scope = { section: SettingsSectionId, group?: Pair, props: Props, stack: string[] }

function parse(dir: string, file: string) {
    return ts.createSourceFile(file, readFileSync(join(SETTINGS_DIR, dir, file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

function extract(): { entries: SettingsSearchEntry[], sections: string[] } {
    const components = new Map<string, ts.Node>()
    let roots: ts.SwitchStatement | undefined
    for (const dir of ["_screens", "_components"]) {
        for (const file of readdirSync(join(SETTINGS_DIR, dir)).sort()) {
            if (!file.endsWith(".tsx") || KIT_FILES.has(file)) continue
            const collect = (node: ts.Node) => {
                if (ts.isFunctionDeclaration(node) && node.name) {
                    components.set(node.name.text, node)
                    if (node.name.text === "SectionContent") {
                        ts.forEachChild(node, function find(child) {
                            if (ts.isSwitchStatement(child)) roots = child
                            else ts.forEachChild(child, find)
                        })
                    }
                }
                else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && /^[A-Z]/.test(node.name.text)) {
                    components.set(node.name.text, node.initializer)
                }
                if (ts.isSourceFile(node) || ts.isVariableStatement(node) || ts.isVariableDeclarationList(node)) ts.forEachChild(node, collect)
            }
            collect(parse(dir, file))
        }
    }
    if (!roots) throw new Error("SectionContent with its switch over the areas was not found")

    const entries: SettingsSearchEntry[] = []
    const seen = new Set<string>()
    const add = (entry: SettingsSearchEntry) => {
        const id = searchEntryId(entry)
        if (seen.has(id)) return
        seen.add(id)
        entries.push(entry)
    }

    /** The t("…", "…") texts an expression can become; a prop of the component being walked counts with what was handed in */
    const texts = (node: ts.Node | undefined, props: Props): Pair[] => {
        if (!node) return []
        if (ts.isStringLiteralLike(node)) return node.text ? [[node.text, node.text]] : []
        if (ts.isJsxExpression(node)) return texts(node.expression, props)
        if (ts.isParenthesizedExpression(node)) return texts(node.expression, props)
        if (ts.isIdentifier(node)) return props[node.text] ?? []
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && (node.expression.text === "t" || node.expression.text === "tr")
            && node.arguments.length === 2 && ts.isStringLiteralLike(node.arguments[0]) && ts.isStringLiteralLike(node.arguments[1])) {
            return [[node.arguments[0].text, node.arguments[1].text]]
        }
        if (ts.isConditionalExpression(node)) return [...texts(node.whenTrue, props), ...texts(node.whenFalse, props)]
        if (ts.isBinaryExpression(node) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(node.operatorToken.kind)) {
            return [...texts(node.left, props), ...texts(node.right, props)]
        }
        return []
    }

    const walk = (node: ts.Node, scope: Scope) => {
        const element = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : undefined
        if (!element) {
            ts.forEachChild(node, child => walk(child, scope))
            return
        }
        const tag = element.tagName.getText()
        if (HIDDEN.has(tag)) return
        const attrs: Props = {}
        for (const attr of element.attributes.properties) {
            if (ts.isJsxAttribute(attr) && ts.isIdentifier(attr.name)) attrs[attr.name.text] = texts(attr.initializer, scope.props)
        }
        if (ROWS.has(tag)) {
            const [label, ...alt] = attrs.label ?? []
            if (label) add({ section: scope.section, ...(scope.group ? { group: scope.group } : null), label, ...(attrs.note?.[0] ? { note: attrs.note[0] } : null), ...(alt.length ? { alt } : null) })
            return
        }
        let inner = scope
        if (tag === "SettingsGroup") {
            const title = attrs.title?.[0]
            inner = { ...scope, group: title }
            if (title) add({ section: scope.section, group: title, ...(attrs.note?.[0] ? { note: attrs.note[0] } : null) })
        }
        // What stands in the element (its children and the JSX handed in as props) belongs to the page as written here…
        ts.forEachChild(node, child => walk(child, inner))
        // …and a component of the settings folder adds what it renders itself
        const component = components.get(tag)
        if (component && !scope.stack.includes(tag)) walk(component, { ...inner, props: attrs, stack: [...scope.stack, tag] })
    }

    const sections: string[] = []
    for (const clause of roots.caseBlock.clauses) {
        if (!ts.isCaseClause(clause) || !ts.isStringLiteralLike(clause.expression)) continue
        const section = clause.expression.text as SettingsSectionId
        sections.push(section)
        for (const statement of clause.statements) walk(statement, { section, props: {}, stack: [] })
    }
    return { entries, sections }
}

const quote = (text: string) => JSON.stringify(text)
const pair = (value: Pair) => `[${quote(value[0])}, ${quote(value[1])}]`

function render(entries: SettingsSearchEntry[]): string {
    const lines = entries.map(entry => {
        const parts = [`section: ${quote(entry.section)}`]
        if (entry.group) parts.push(`group: ${pair(entry.group)}`)
        if (entry.label) parts.push(`label: ${pair(entry.label)}`)
        if (entry.note) parts.push(`note: ${pair(entry.note)}`)
        if (entry.alt) parts.push(`alt: [${entry.alt.map(pair).join(", ")}]`)
        return `    { ${parts.join(", ")} },`
    })
    return [
        "import type { SettingsSearchEntry } from \"@/main/settings/_lib/settings-search\"",
        "",
        "/*",
        " * Generated from the settings pages by settings-search-index.test.ts. Do not edit by hand; after adding or renaming a",
        " * setting run: UPDATE_SETTINGS_INDEX=1 npx vitest run src/main/settings/_lib/settings-search-index.test.ts",
        " */",
        "",
        "export const SETTINGS_SEARCH_INDEX: readonly SettingsSearchEntry[] = [",
        ...lines,
        "]",
        "",
    ].join("\n")
}

describe("settings search index", () => {
    const { entries, sections } = extract()

    it("matches the settings pages' source", () => {
        if (process.env.UPDATE_SETTINGS_INDEX) writeFileSync(INDEX_FILE, render(entries))
        else expect(SETTINGS_SEARCH_INDEX).toEqual(entries)
    })

    it("walks every area of the list", () => {
        expect([...sections].sort()).toEqual([...SETTINGS_SECTIONS].sort())
        for (const section of SETTINGS_SECTIONS) expect(entries.some(entry => entry.section === section && entry.label), section).toBe(true)
    })

    it("gives every entry its own id and both languages", () => {
        const ids = entries.map(searchEntryId)
        expect(new Set(ids).size).toBe(ids.length)
        for (const entry of entries) {
            for (const text of [entry.group, entry.label, entry.note, ...(entry.alt ?? [])]) {
                if (text) expect(text[0] && text[1], searchEntryId(entry)).toBeTruthy()
            }
        }
    })
})
