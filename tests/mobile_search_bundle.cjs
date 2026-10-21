const path = require('node:path');
const {createRequire} = require('node:module');
const web = path.resolve(__dirname, '../backend/seanime-web');
const {build} = createRequire(path.join(web,'package.json'))('esbuild');
const stub = path.join(__dirname,'mobile_search_stubs.tsx');
// The real /search page, phone screen, router, query client and collection atoms; AniList, server status, links (a Link without preloading), images,
// the desktop search parts and the card menu's preview / plugin / playlist / explorer hooks are fixtures.
const stubbed = ['@/api/client/requests','@/components/shared/sea-link','@/components/shared/sea-image',
'@/lib/server/assets','@/api/hooks/extensions.hooks','@/api/hooks/extensions.hooks.ts','@/app/(main)/_hooks/use-server-status',
'@/app/(main)/_features/anime-library/_containers/custom-library-banner','@/app/(main)/search/_components/advanced-search-list',
'@/app/(main)/search/_components/advanced-search-options','@/app/(main)/search/_components/advanced-search-page-title',
'@/app/(main)/_features/media/_containers/media-preview-modal','@/app/(main)/_features/media/_components/media-entry-card-components',
'@/app/(main)/_features/plugin/actions/plugin-actions','@/app/(main)/_features/playlists/lib/playlist-editor-manager',
'@/app/(main)/_features/library-explorer/library-explorer.atoms'];
// A second arg "production" builds React's production mode (stress_search.py measures frames as the app ships)
const production = process.argv[3] === 'production';
build({absWorkingDir:web,entryPoints:[path.join(__dirname,'mobile_search_harness.tsx')],outfile:process.argv[2],bundle:true,platform:'browser',format:'iife',jsx:'automatic',logLevel:'error',define:{'import.meta.env':'{"SEA_PUBLIC_PLATFORM":"mobile"}',...production?{'process.env.NODE_ENV':'"production"'}:{}},nodePaths:[path.join(web,'node_modules')],plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/.*/},a=>{
if(stubbed.includes(a.path)&&a.importer!==stub)return {path:stub};
})}}]}).catch(e=>{console.error(e);process.exit(1)});
