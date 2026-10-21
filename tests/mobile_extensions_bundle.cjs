const path = require('node:path');
const {createRequire} = require('node:module');
const web = path.resolve(__dirname, '../backend/seanime-web');
const {build} = createRequire(path.join(web,'package.json'))('esbuild');
const stub = path.join(__dirname,'mobile_extensions_stubs.tsx');
// The real /extensions page; the extension server, router, websocket, links and toasts are fixtures.
const stubbed = ['@/api/hooks/extensions.hooks','@/app/(main)/_hooks/handle-websockets','@/lib/navigation','@/components/shared/sea-link',
'@/app/(main)/_features/anime-library/_containers/custom-library-banner','sonner'];
build({absWorkingDir:web,entryPoints:[path.join(__dirname,'mobile_extensions_harness.tsx')],outfile:process.argv[2],bundle:true,platform:'browser',format:'iife',jsx:'automatic',logLevel:'error',define:{'import.meta.env':'{"SEA_PUBLIC_PLATFORM":"mobile"}'},nodePaths:[path.join(web,'node_modules')],plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/.*/},a=>{
if(stubbed.includes(a.path)&&a.importer!==stub)return {path:stub};
})}}]}).catch(e=>{console.error(e);process.exit(1)});
