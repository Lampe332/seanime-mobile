const path = require('node:path');
const {createRequire} = require('node:module');
const web = path.resolve(__dirname, '../backend/seanime-web');
const {build} = createRequire(path.join(web,'package.json'))('esbuild');
const stub = path.join(__dirname,'mobile_lists_stubs.tsx');
// The real /lists page and phone screen; AniList queries, server status, router, links, images, preview, plugins, playback,
// playlists, the manga chapter numbers and toasts are fixtures.
const stubbed = ['@/api/client/requests','@tanstack/react-query','@/api/hooks/anilist.hooks','@/api/hooks/manga.hooks',
'@/app/(main)/_hooks/use-server-status','@/lib/navigation','@/lib/server/assets','@/components/shared/sea-image','@/components/shared/sea-link',
'@/app/(main)/_features/media/_containers/media-preview-modal','@/app/(main)/_features/media/_components/media-entry-card-components',
'@/app/(main)/_features/anime-library/_containers/custom-library-banner','@/app/(main)/lists/_containers/anilist-collection-lists',
'@/app/(main)/_features/plugin/actions/plugin-actions','@/app/(main)/_atoms/playback.atoms','@/app/(main)/_features/playlists/lib/playlist-editor-manager',
'@/app/(main)/manga/_lib/handle-manga-collection','sonner'];
build({absWorkingDir:web,entryPoints:[path.join(__dirname,'mobile_lists_harness.tsx')],outfile:process.argv[2],bundle:true,platform:'browser',format:'iife',jsx:'automatic',logLevel:'error',define:{'import.meta.env':'{"SEA_PUBLIC_PLATFORM":"mobile"}'},nodePaths:[path.join(web,'node_modules')],plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/.*/},a=>{
if(stubbed.includes(a.path)&&a.importer!==stub)return {path:stub};
})}}]}).catch(e=>{console.error(e);process.exit(1)});
