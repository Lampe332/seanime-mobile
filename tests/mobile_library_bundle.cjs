const path = require('node:path');
const {createRequire} = require('node:module');
const web = path.resolve(__dirname, '../backend/seanime-web');
const {build} = createRequire(path.join(web,'package.json'))('esbuild');
const stub = path.join(__dirname,'mobile_library_stubs.tsx');
// The real library containers, phone sheets and query hooks (react-query stays real); the server, router, links, images,
// websocket events, toasts, media preview, command palette and plugin items are fixtures.
const stubbed = ['@/api/client/requests','@/lib/navigation','sonner','@/lib/helpers/browser','@/components/shared/sea-image','@/components/shared/sea-link',
'@/app/(main)/_hooks/handle-websockets','@/app/(main)/_features/media/_containers/media-preview-modal','@/app/(main)/_features/plugin/actions/plugin-actions',
'@/app/(main)/_features/sea-command/sea-command','@/app/(main)/_features/sea-command/sea-command-search','@/app/(main)/_features/sea-command/use-inject',
'@/app/(main)/_features/anime-library/_containers/custom-library-banner','@/app/(main)/_features/library-explorer/library-explorer.atoms'];
// argv[3]: another harness entry with the same boundaries (mobile_scan_summaries_harness.tsx, mobile_medialinks_harness.tsx)
const entry=process.argv[3]||'mobile_library_harness.tsx';
build({absWorkingDir:web,entryPoints:[path.join(__dirname,entry)],outfile:process.argv[2],bundle:true,platform:'browser',format:'iife',jsx:'automatic',logLevel:'error',define:{'import.meta.env':'{"SEA_PUBLIC_PLATFORM":"mobile"}'},nodePaths:[path.join(web,'node_modules')],plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/.*/},a=>{
if(stubbed.includes(a.path)&&a.importer!==stub)return {path:stub};
})}}]}).catch(e=>{console.error(e);process.exit(1)});
