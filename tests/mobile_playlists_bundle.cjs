const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const web = path.join(root, 'backend/seanime-web');
const { build } = createRequire(path.join(web, 'package.json'))('esbuild');
const stub = path.join(__dirname, 'mobile_playlists_stubs.tsx');
build({ absWorkingDir: web, entryPoints: [path.join(__dirname, 'mobile_playlists_harness.tsx')], outfile: path.resolve(process.argv[2]), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', nodePaths: [path.join(web, 'node_modules')], plugins: [{ name: 'controlled-playlist-boundaries', setup(b) {
    b.onResolve({ filter: /.*/ }, a => {
        if (['@/api/hooks/playlist.hooks', '../_containers/global-playlist-manager', '../lib/playlist-editor-manager', '@/app/(main)/_hooks/use-server-status', '@/components/ui/loading-spinner', 'sonner', '@/lib/app-language'].includes(a.path)) return { path: stub };
    });
} }] }).catch(e => { console.error(e); process.exit(1) });
