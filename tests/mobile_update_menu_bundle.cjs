const path = require("node:path")
const { createRequire } = require("node:module")

const root = path.resolve(__dirname, "..")
const web = path.join(root, "backend", "seanime-web")
const { build } = createRequire(path.join(web, "package.json"))("esbuild")
const stubs = path.join(__dirname, "mobile_update_stubs")
const output = path.resolve(process.argv[2])

const aliases = new Map([
    ["@/api/client/requests", "requests.ts"],
    ["@/api/generated/endpoints", "endpoints.ts"],
    ["@/app/(main)/_hooks/use-server-status", "server-status.ts"],
    ["@/components/ui/modal", "modal.tsx"],
    ["@/components/ui/button", "button.tsx"],
    ["@/lib/mobile-icons", "mobile-icons.tsx"],
    ["@/lib/app-language", "app-language.ts"],
    ["sonner", "sonner.ts"],
    ["./update-helper", "update-helper.tsx"],
])

build({
    absWorkingDir: web,
    entryPoints: [path.join(__dirname, "mobile_update_menu_harness.tsx")],
    outfile: output,
    nodePaths: [path.join(web, "node_modules")],
    bundle: true,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    plugins: [{
        name: "mobile-update-test-stubs",
        setup(builder) {
            builder.onResolve({ filter: /.*/ }, args => {
                if (aliases.has(args.path)) return { path: path.join(stubs, aliases.get(args.path)) }
                if (args.path === "./update-modal" && args.importer.endsWith("mobile-update-modal.tsx")) {
                    return { path: path.join(stubs, "update-modal.ts") }
                }
            })
            builder.onResolve({ filter: /^@tanstack\/react-query$/ }, () => ({ path: path.join(stubs, "react-query.ts"), sideEffects: false }))
        },
    }],
}).catch(error => { console.error(error); process.exit(1) })
