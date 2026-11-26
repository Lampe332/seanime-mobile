import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { SETTINGS_SECTIONS, type SettingsSectionId } from "@/main/settings/_lib/settings-phone"
import { type Pair, SEARCH_CONDITIONS, type SearchCondition, searchEntryId, type SettingsSearchEntry } from "@/main/settings/_lib/settings-search"
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
const ROWS = new Set(["SettingSwitch", "LocalSwitch", "ThemeSwitch", "SelectRow", "SwatchRow", "LinkRow", "InfoRow", "TextSettingRow", "ImageChoiceRow", "ChoiceRows"])
const KIT_FILES = new Set(["settings-kit.tsx", "settings-page.tsx", "settings-search.tsx"])
/** Rows inside these only show once something is opened */
const HIDDEN = new Set(["ConfirmSheet", "TextSheet", "Modal"])
/** A sheet opened from a row: its rows count as the row's group, its own group titles are not on the page */
const SHEET = "Sheet"
/** A condition about loading, a failure or nothing there: what it shows is a state, not a setting */
const STATE = /\b(isLoading|isPending|isError|isFetching|loadFailed)\b|"loading"|=== 0\b/
/** Of a row's names, the one that only shows while something runs ("Sending…" for "Send a new code"); "Share…" alone stays */
const BUSY = (text: Pair) => text[0].endsWith("…")

type Props = Record<string, Pair[]>
type Scope = { section: SettingsSectionId, group?: Pair, props: Props, stack: string[], when: SearchCondition[], inSheet?: boolean, sheet?: Pair }

function parse(dir: string, file: string) {
    return ts.createSourceFile(file, readFileSync(join(SETTINGS_DIR, dir, file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

function extract(): { entries: SettingsSearchEntry[], sections: string[], conditions: Set<string> } {
    const components = new Map<string, ts.Node>()
    /** Row factories inside a component: const preferenceRow = (key, label, note) => <SelectRow … /> */
    const factories = new Map<string, ts.ArrowFunction>()
    const conditions = new Set<string>()
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
            const source = parse(dir, file)
            collect(source)
            ts.forEachChild(source, function findFactories(node) {
                if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && /^[a-z]/.test(node.name.text) && node.initializer && ts.isArrowFunction(node.initializer)) {
                    factories.set(node.name.text, node.initializer)
                }
                ts.forEachChild(node, findFactories)
            })
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
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
            const condition = node.left.getText()
            if (STATE.test(condition)) return
            const key = `${scope.stack.at(-1) ?? ""}:${condition}`
            const known = (SEARCH_CONDITIONS as readonly string[]).includes(key)
            if (known) conditions.add(key)
            walk(node.left, scope)
            walk(node.right, known ? { ...scope, when: [...scope.when, key as SearchCondition] } : scope)
            return
        }
        if (ts.isConditionalExpression(node) && STATE.test(node.condition.getText())) {
            walk(node.whenFalse, scope)
            return
        }
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && factories.has(node.expression.text)) {
            const factory = factories.get(node.expression.text)!
            const params: Props = {}
            factory.parameters.forEach((param, index) => {
                if (ts.isIdentifier(param.name)) params[param.name.text] = texts(node.arguments[index], scope.props)
            })
            walk(factory.body, { ...scope, props: { ...scope.props, ...params } })
            return
        }
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
            const names = attrs.label ?? []
            const [label, ...alt] = names.length > 1 ? names.filter(name => !BUSY(name)) : names
            // a note that depends on a state: the last one is the default ("special ? note : usual note")
            const note = attrs.note?.at(-1)
            if (label) add({ section: scope.section, ...(scope.group ? { group: scope.group } : null), label, ...(note ? { note } : null), ...(alt.length ? { alt } : null), ...(scope.when.length ? { when: scope.when } : null), ...(scope.sheet ? { sheet: scope.sheet } : null) })
            return
        }
        let inner = scope
        // a row in a sheet is found under the sheet's title, so the hit can open the sheet before it jumps to the row
        if (tag === SHEET) inner = { ...scope, inSheet: true, ...(attrs.title?.[0] ? { sheet: attrs.title[0] } : null) }
        else if (tag === "SettingsGroup" && !scope.inSheet) {
            const title = attrs.title?.[0]
            inner = { ...scope, group: title }
            if (title) add({ section: scope.section, group: title, ...(attrs.note?.[0] ? { note: attrs.note[0] } : null), ...(scope.when.length ? { when: scope.when } : null) })
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
        for (const statement of clause.statements) walk(statement, { section, props: {}, stack: [], when: [] })
    }
    return { entries, sections, conditions }
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
        if (entry.when) parts.push(`when: [${entry.when.map(quote).join(", ")}]`)
        if (entry.sheet) parts.push(`sheet: ${pair(entry.sheet)}`)
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
    const { entries, sections, conditions } = extract()

    it("matches the settings pages' source", () => {
        if (process.env.UPDATE_SETTINGS_INDEX) writeFileSync(INDEX_FILE, render(entries))
        else expect(SETTINGS_SEARCH_INDEX).toEqual(entries)
    })

    it("walks every area of the list", () => {
        expect([...sections].sort()).toEqual([...SETTINGS_SECTIONS].sort())
        for (const section of SETTINGS_SECTIONS) expect(entries.some(entry => entry.section === section && entry.label), section).toBe(true)
    })

    const row = (label: string) => entries.find(entry => entry.label?.[0] === label)

    it("knows every row of the kit", () => {
        const kit = parse("_components", "settings-kit.tsx")
        const withLabel: string[] = []
        ts.forEachChild(kit, node => {
            if (!ts.isFunctionDeclaration(node) || !node.name || !/^[A-Z]/.test(node.name.text)) return
            if (!node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) return
            const props = node.parameters[0]?.name
            if (props && ts.isObjectBindingPattern(props) && props.elements.some(element => element.name.getText() === "label")) withLabel.push(node.name.text)
        })
        expect(withLabel.filter(name => !ROWS.has(name))).toEqual([])
    })

    it("holds rows of every kind, rows from factories and the rows of a sheet", () => {
        expect(row("Accent color")).toMatchObject({ section: "ui" })
        expect(row("Multiple subtitle tracks")).toMatchObject({ section: "torrents", group: ["Auto-select", "Auto-Auswahl"], sheet: ["Auto-select profile", "Auto-Auswahl-Profil"] })
        expect(row("Accent color")?.sheet).toBeUndefined()
        expect(row("Player for files")?.note?.[0]).toBe("Plays in the app with subtitles, progress tracking and skipping.")
    })

    it("leaves loading, failure and empty states out", () => {
        const names = entries.flatMap(entry => [entry.label, ...(entry.alt ?? [])]).filter(name => name !== undefined)
        for (const state of ["Loading…", "Sending…", "Backing up…", "Checking for updates…", "Could not load the media server", "No series yet", "Couldn't load the devices"]) {
            expect(names.some(name => name[0] === state), state).toBe(false)
        }
        expect(entries.some(entry => entry.group?.[0] === "Couldn't load your account")).toBe(false)
        expect(row("Share…")).toBeDefined()
    })

    it("notes the state a row shows under", () => {
        expect([...conditions].sort()).toEqual([...SEARCH_CONDITIONS].sort())
        expect(row("Show the next episode")?.when).toEqual(["SettingsAppSection:hideSpoilers"])
        expect(row("Preload the next episode")?.when).toEqual(["StreamingGroup:enabled"])
        expect(row("Banner image")?.when).toEqual(["SettingsUISection:!tablet"])
        expect(row("Banner position")?.when).toEqual(["SettingsUISection:!tablet", "BannerGroup:!!shown"])
        expect(row("Accent color")?.when).toBeUndefined()
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
