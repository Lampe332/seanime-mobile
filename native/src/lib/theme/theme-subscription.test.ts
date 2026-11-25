import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"
import { buildPalette } from "./palette"
import { colors } from "./tokens"

/*
 * The guarantee behind "switch the accent and everything follows at once". A colour of the palette may only reach a
 * component through useThemeColors() / usePalette(): the hook renders the component again and hands it new values. The
 * app is built with the React Compiler, which keeps whatever a component reads from a module (an imported object, a
 * helper called with constants) from its first render, so a colour taken any other way stays the old one. This test reads
 * every source file and fails on each such place.
 */

const SRC = join(__dirname, "../..")
const PALETTE_KEYS = new Set(Object.keys(buildPalette("violet", false).js))
/** The palette helpers and the position of their palette argument */
const HELPERS: Record<string, number> = {
    accentRgba: 1, accentGlow: 2, glowGround: 1, glowGroundFade: 1, accentShift: 1, accentShiftHex: 1, accentShiftRgba: 2,
    accentTextHex: 0, menuPanelBackground: 0, menuRowHighlight: 0,
}
/** Ways to a palette that do not subscribe */
const READERS = new Set(["currentPalette", "storedPalette", "buildPalette"])
const HOOK = /^use(ThemeColors|Palette)\(\)$/
const ANIMATED = new Set(["useAnimatedStyle", "useAnimatedProps", "useDerivedValue", "useAnimatedReaction", "useSharedValue"])

/** Files that are not held to the rules, each with its reason */
const OUTSIDE_REACT: Record<string, string> = {
    "lib/theme/palette.ts": "defines the palette and its helpers",
    "lib/theme/appearance.ts": "applies the palette; the subscription itself",
    "lib/theme/tokens.ts": "builds the object useThemeColors() returns",
    "lib/widget/continue-widget.tsx": "the home screen widget is drawn outside the app's React tree, from the stored palette on every update",
}
/** Files that may build a palette other than the current one */
const MAY_BUILD: Record<string, string> = {
    "main/settings/_screens/settings-ui.tsx": "the swatches show every preset, not the current palette",
    "main/settings/_components/custom-accent-sheet.tsx": "previews a colour that is not applied yet",
}

function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        // never read: the local smoke test holds an account
        if (entry.name.includes("prod-smoke") || entry.name === "node_modules") continue
        const path = join(dir, entry.name)
        if (entry.isDirectory()) sourceFiles(path, out)
        else if (/\.tsx?$/.test(entry.name) && !/\.(test|d)\.tsx?$/.test(entry.name)) out.push(path)
    }
    return out
}

function names(name: ts.BindingName): string[] {
    if (ts.isIdentifier(name)) return [name.text]
    return name.elements.flatMap(element => ts.isOmittedExpression(element) ? [] : names(element.name))
}

type Declaration = { kind: "param" } | { kind: "var", init: string } | null

/** Where the name a node uses comes from: a parameter, a variable (with its initializer), or outside the file (null) */
function declarationOf(node: ts.Node, name: string): Declaration {
    for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
        if (ts.isFunctionLike(p) && p.parameters.some(q => names(q.name).includes(name))) return { kind: "param" }
        if (!ts.isBlock(p) && !ts.isSourceFile(p)) continue
        for (const statement of p.statements) {
            if (!ts.isVariableStatement(statement)) continue
            for (const d of statement.declarationList.declarations) {
                if (names(d.name).includes(name)) return { kind: "var", init: d.initializer?.getText() ?? "" }
            }
        }
    }
    return null
}

/** An identifier that reads a value (not a property name or a declaration) */
function isRead(id: ts.Identifier): boolean {
    const p = id.parent
    if ((ts.isPropertyAccessExpression(p) || ts.isPropertyAssignment(p) || ts.isJsxAttribute(p) || ts.isPropertySignature(p)) && p.name === id) return false
    if (ts.isBindingElement(p) || ts.isImportSpecifier(p)) return false
    if ((ts.isVariableDeclaration(p) || ts.isParameter(p)) && p.name === id) return false
    return true
}

function fromHook(node: ts.Node, name: string): boolean {
    const d = declarationOf(node, name)
    return d?.kind === "param" || (d?.kind === "var" && HOOK.test(d.init))
}

/** Every place of a file that could keep a palette colour from an earlier render, as "file:line what" */
function check(rel: string, text: string): string[] {
    const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, rel.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const found: string[] = []
    const fail = (node: ts.Node, what: string) => found.push(`${rel}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${what}`)
    const exempt = Object.hasOwn(OUTSIDE_REACT, rel)

    const animated = (call: ts.CallExpression, hook: string) => {
        const [body, deps] = call.arguments
        if (!body) return
        const listed = deps && ts.isArrayLiteralExpression(deps) ? deps.elements.map(e => e.getText()) : []
        const themed = new Set<string>()
        const scan = (n: ts.Node) => {
            if (ts.isIdentifier(n) && isRead(n)) {
                const d = declarationOf(n, n.text)
                if (d?.kind === "var" && HOOK.test(d.init)) themed.add(n.text)
                if (d?.kind === "param" && (n.text === "colors" || n.text === "palette")) themed.add(n.text)
            }
            ts.forEachChild(n, scan)
        }
        scan(body)
        for (const name of themed) {
            if (hook === "useSharedValue") fail(call, `useSharedValue starts from the themed \`${name}\` and never follows the palette`)
            else if (!listed.includes(name)) fail(call, `${hook} uses the themed \`${name}\` without naming it in its dependencies`)
        }
    }

    const visit = (n: ts.Node) => {
        if (ts.isExpressionStatement(n) && HOOK.test(n.expression.getText())) fail(n, "hook called but its result thrown away: the colours used here are not the hook's")
        if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
            const fn = n.expression.text
            if (READERS.has(fn) && !exempt && !Object.hasOwn(MAY_BUILD, rel)) fail(n, `${fn}() reads a palette without subscribing`)
            if (Object.hasOwn(HELPERS, fn) && !exempt) {
                const arg = n.arguments[HELPERS[fn]]
                const ok = !!arg && (HOOK.test(arg.getText()) || (ts.isIdentifier(arg) && fromHook(arg, arg.text)))
                if (!ok) fail(n, `${fn}() needs the palette of usePalette()`)
            }
            if (ANIMATED.has(fn)) animated(n, fn)
        }
        if (!exempt && ts.isIdentifier(n) && n.text === "colors" && isRead(n)) {
            const p = n.parent
            const themed = ts.isPropertyAccessExpression(p) && p.expression === n ? PALETTE_KEYS.has(p.name.text)
                : ts.isElementAccessExpression(p) && p.expression === n
            if (themed && !fromHook(n, "colors")) fail(n, "palette colour read from `colors` that is not `const colors = useThemeColors()`")
        }
        ts.forEachChild(n, visit)
    }
    visit(sf)
    return found
}

describe("every accent-coloured element follows the palette at once", () => {
    const files = sourceFiles(SRC).map(path => ({ path, rel: relative(SRC, path).replace(/\\/g, "/") }))

    it("the fixed colours hold none of the palette's", () => {
        expect(Object.keys(colors).filter(key => PALETTE_KEYS.has(key))).toEqual([])
    })

    it("walks the app's sources", () => {
        expect(files.length).toBeGreaterThan(100)
        const rels = files.map(file => file.rel)
        for (const rel of [...Object.keys(OUTSIDE_REACT), ...Object.keys(MAY_BUILD), "components/ui/switch/switch.tsx"]) expect(rels).toContain(rel)
    })

    it("no file takes a palette colour past the hooks", () => {
        expect(files.flatMap(file => check(file.rel, readFileSync(file.path, "utf8")))).toEqual([])
    }, 60_000)

    it("catches a component that only calls the hook, and a colour from a module", () => {
        const found = check("x.tsx", `
            import { colors } from "@/lib/theme/tokens"
            const DOT = { get color() { return colors.smAccent } }
            export function Row() {
                useThemeColors()
                return <Text style={{ color: colors.smAccent, backgroundImage: glowGroundFade(0.11), borderColor: accentRgba(0.2, currentPalette()) }} />
            }`)
        expect(found.map(line => line.replace(/^x\.tsx:\d+ /, "").split(/[:(]/)[0])).toEqual([
            "palette colour read from `colors` that is not `const colors = useThemeColors",
            "hook called but its result thrown away",
            "palette colour read from `colors` that is not `const colors = useThemeColors",
            "glowGroundFade",
            "accentRgba",
            "currentPalette",
        ])
    })

    it("accepts the hook's colours, also handed on as an argument", () => {
        expect(check("x.tsx", `
            const tint = (palette: Palette) => accentGlow([[0.1, 0]], 10, palette)
            function Dot({ colors }: { colors: ThemeColors }) { return <View style={{ backgroundColor: colors.smAccent }} /> }
            export function Row() {
                const colors = useThemeColors()
                const palette = usePalette()
                return <View style={{ borderColor: colors.smAccent, backgroundImage: tint(palette), boxShadow: accentRgba(0.2, palette) }}><Dot colors={colors} /></View>
            }`)).toEqual([])
    })

    it("catches a Reanimated value that would keep a colour, and accepts one that names it", () => {
        const source = (deps: string) => `
            export function Track() {
                const { smAccentStrong } = useThemeColors()
                const start = useSharedValue(smAccentStrong)
                const style = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(on.get(), [0, 1], ["#000", smAccentStrong]) })${deps})
                return <Animated.View style={style} />
            }`
        expect(check("x.tsx", source(""))).toHaveLength(2)
        expect(check("x.tsx", source(", [smAccentStrong]"))).toHaveLength(1)
    })
})
