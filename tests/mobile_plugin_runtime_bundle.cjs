const path = require("node:path"); const { createRequire } = require("node:module");
const root = path.resolve(__dirname, ".."); const web = path.join(root, "backend/seanime-web"); const { build } = createRequire(path.join(web, "package.json"))("esbuild");
const stub = path.join(__dirname, "mobile_plugin_runtime_stubs.tsx");
build({ absWorkingDir: web, entryPoints: [path.join(__dirname, "mobile_plugin_runtime_harness.tsx")], outfile: path.resolve(process.argv[2]), bundle: true, platform: "browser", format: "iife", jsx: "automatic", define: { "import.meta.env": JSON.stringify({ SEA_PUBLIC_PLATFORM: "mobile", MODE: "production" }) }, nodePaths: [path.join(web, "node_modules")], plugins: [{ name: "runtime-transport-boundary", setup(b) { b.onResolve({ filter: /.*/ }, a => {
if (["@/app/websocket-provider", "@/app/(main)/_hooks/handle-websockets", "@/lib/app-language", "@/lib/theme/theme-hooks", "@/components/shared/sea-image", "@/components/vaul", "../generated/plugin-events", "@/app/(main)/_features/plugin/generated/plugin-events", "@/lib/navigation", "./plugin-sidebar-tray"].includes(a.path)) return { path: stub };
}) } }] }).catch(e => { console.error(e); process.exit(1) });
