const path = require('node:path');
const {createRequire} = require('node:module');
const web = path.resolve(__dirname, '../backend/seanime-web');
const {build} = createRequire(path.join(web,'package.json'))('esbuild');
const stub = path.join(__dirname,'mobile_manga_library_stubs.tsx');
// The real /manga page and collection hook; server, router, plugins, images and the command palette are fixtures.
const stubbed = ['@/api/client/requests','@tanstack/react-query','@/api/hooks/extensions.hooks','@/api/hooks/manga.hooks','@/api/hooks/theme.hooks',
'@/app/(main)/_hooks/use-server-status','@/lib/navigation','@/lib/theme/theme-hooks','@/lib/server/assets','@/components/shared/sea-image','@/components/shared/sea-link',
'@/app/(main)/_features/media/_containers/media-preview-modal','@/app/(main)/_features/media/_components/media-entry-card-components',
'@/app/(main)/_features/media/_components/media-entry-page-loading-display','@/app/(main)/_features/anime-library/_containers/custom-library-banner',
'@/app/(main)/manga/_components/library-header','@/app/(main)/manga/_screens/manga-library-view',
'@/app/(main)/_features/plugin/actions/plugin-actions','@/app/(main)/_features/plugin/webview/plugin-webviews','@/app/(main)/_features/sea-command/use-inject',
'@/app/(main)/_features/sea-command/_components/command-utils','@/app/(main)/_features/sea-command/utils'];
build({absWorkingDir:web,entryPoints:[path.join(__dirname,'mobile_manga_library_harness.tsx')],outfile:process.argv[2],bundle:true,platform:'browser',format:'iife',jsx:'automatic',define:{'import.meta.env':'{}'},nodePaths:[path.join(web,'node_modules')],plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/.*/},a=>{
if(stubbed.includes(a.path)&&a.importer!==stub)return {path:stub};
})}}]}).catch(e=>{console.error(e);process.exit(1)});
