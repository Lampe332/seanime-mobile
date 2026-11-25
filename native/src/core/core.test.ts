import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { MEDIASERVER_ENDPOINTS } from "@/api/hooks/mediaserver.hooks"
import { CORE_ROUTES, type CoreEnvironment, type CoreRoute, coreAnswerFor } from "./index"
import { matchCoreRoute } from "./registry"

/** The routes of these tests use nothing from outside */
const noEnvironment = {} as CoreEnvironment


describe("core routes", () => {
    const routes: CoreRoute[] = [
        { area: "extensions", method: "GET", endpoint: "/api/v1/things/{id}/parts/{name}", answer: async request => request },
        { area: "streams", method: "POST", endpoint: "/api/v1/things", answer: async () => "made" },
    ]

    it("match the address a hook passes, with its changing parts and without its query", () => {
        expect(matchCoreRoute("GET", "/api/v1/things/105333/parts/a%20b?x=1", routes)?.path).toEqual({ id: "105333", name: "a b" })
        expect(matchCoreRoute("POST", "/api/v1/things", routes)?.route).toBe(routes[1])
        expect(matchCoreRoute("GET", "/api/v1/things", routes)).toBeNull()
        expect(matchCoreRoute("GET", "/api/v1/things/1/parts", routes)).toBeNull()
        expect(matchCoreRoute("GET", "/api/v1/things//parts/x", routes)).toBeNull()
        expect(matchCoreRoute("GET", "/api/v1/other/1/parts/x", routes)).toBeNull()
    })

    it("hands the changing parts of the address to the answer", async () => {
        const answer = coreAnswerFor("GET", "/api/v1/things/7/parts/x", routes)
        expect(await answer?.({ body: undefined, query: { a: 1 } }, noEnvironment))
            .toEqual({ body: undefined, query: { a: 1 }, path: { id: "7", name: "x" } })
    })

    it("are interfaces the app really has, with the method its hook uses", () => {
        // the media server's routes have their own list next to the generated one (api/hooks/mediaserver.hooks.ts)
        const known = [...Object.values(API_ENDPOINTS).flatMap(group => Object.values(group)), ...Object.values(MEDIASERVER_ENDPOINTS)]
        for (const route of CORE_ROUTES) {
            // one address can be two interfaces (reading and writing the home items)
            const methods = known.filter(candidate => candidate.endpoint === route.endpoint).flatMap(candidate => candidate.methods as readonly string[])
            expect(methods, route.endpoint).toContain(route.method)
        }
    })
})

describe("core boundary", () => {
    function sourceFiles(dir: string): string[] {
        return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
            const file = path.join(dir, entry.name)
            // the extension contract is Seanime's own .d.ts, copied unchanged (extensions/contract/README.md)
            if (entry.isDirectory()) return entry.name === "contract" ? [] : sourceFiles(file)
            return /\.tsx?$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [file] : []
        })
    }

    const files = sourceFiles(__dirname)
    const NODE_ENGINE = path.join(__dirname, "extensions", "sandbox", "node-engine.ts")

    it("knows nothing outside its own folder: no React, no screen, no package of the app", () => {
        expect(files.length).toBeGreaterThan(0)
        for (const file of files) {
            const source = fs.readFileSync(file, "utf8")
            const imports = [...source.matchAll(/^(?:import|export)\s[^"']*?from\s+["']([^"']+)["']/gm)].map(match => match[1])
            // the one package the core may use: Drizzle, which is plain TypeScript and describes the core's own tables
            const packages = imports.filter(name => !name.startsWith("./") && !name.startsWith("../"))
            // and one file may use QuickJS as WebAssembly: the sandbox engine for the tests under Node, which nothing
            // else of the core imports (so it never becomes part of the app)
            const forTests = file === NODE_ENGINE ? ["quickjs-emscripten"] : []
            expect(packages.filter(name => name !== "drizzle-orm" && !name.startsWith("drizzle-orm/") && !forTests.includes(name)), file).toEqual([])
            if (file !== NODE_ENGINE) expect(imports.filter(name => /(^|\/)node-engine$/.test(name)), `${file} imports the engine for the tests`).toEqual([])
            // "../" must not lead out of src/core
            for (const name of imports.filter(candidate => !packages.includes(candidate))) {
                expect(path.resolve(path.dirname(file), name).startsWith(__dirname + path.sep), `${file} imports ${name}`).toBe(true)
            }
            expect(/\.tsx$/.test(file), file).toBe(false)
        }
    })

    it("says in every file what it was written after", () => {
        for (const file of files) {
            expect(fs.readFileSync(file, "utf8").startsWith("// geschrieben nach: "), file).toBe(true)
        }
    })
})
