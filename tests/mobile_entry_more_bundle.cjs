const path = require('node:path');
const {createRequire} = require('node:module');
const web = path.resolve(__dirname, '../backend/seanime-web');
const {build} = createRequire(path.join(web,'package.json'))('esbuild');
const stub = path.join(__dirname,'mobile_entry_more_stubs.tsx');
// The real "More" menu and its sheets, the long-press menu and the preview modal with the real query hooks (react-query
// stays real); the server, the page's view, plugin items, router, links, images, clipboard and toasts are fixtures.
const stubbed = ['@/api/client/requests','@/lib/navigation','sonner','@/lib/helpers/browser','@/components/shared/sea-image','@/components/shared/sea-link'];
// Stubbed only for the menu files: the page's view and the plugins' items (everything else keeps the real modules)
const scoped = ['@/app/(main)/entry/_containers/anime-entry-page','@/app/(main)/_features/plugin/actions/plugin-actions'];
const menu = /entry-actions\/anime-entry-(phone-menu|dropdown-menu)\.tsx$/;
build({absWorkingDir:web,entryPoints:[path.join(__dirname,'mobile_entry_more_harness.tsx')],outfile:process.argv[2],bundle:true,platform:'browser',format:'iife',jsx:'automatic',logLevel:'error',define:{'import.meta.env':'{}'},nodePaths:[path.join(web,'node_modules')],plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/.*/},a=>{
if(a.importer===stub)return;
if(stubbed.includes(a.path)||(scoped.includes(a.path)&&menu.test(a.importer.replace(/\\/g,'/'))))return {path:stub};
})}}]}).catch(e=>{console.error(e);process.exit(1)});
