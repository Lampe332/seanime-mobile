const path = require('node:path');
const {createRequire} = require('node:module');
const web = path.resolve(__dirname, '../backend/seanime-web');
const {build} = createRequire(path.join(web,'package.json'))('esbuild');
const stub = path.join(__dirname,'mobile_downloads_stubs.tsx');
// Downloads page with its router, server and reader boundaries replaced by fixtures.
const stubbed = ['@/lib/navigation','@/api/client/requests','@/app/(main)/manga/_containers/chapter-reader/chapter-reader-drawer','@/app/(main)/manga/_lib/handle-manga-downloads','@/app/(main)/manga/_lib/handle-chapter-reader','@tanstack/react-query'];
build({absWorkingDir:web,entryPoints:[path.join(__dirname,'mobile_downloads_harness.tsx')],outfile:process.argv[2],bundle:true,platform:'browser',format:'iife',jsx:'automatic',define:{'import.meta.env':'{}'},nodePaths:[path.join(web,'node_modules')],plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/.*/},a=>{
if(stubbed.includes(a.path)&&a.importer!==stub)return {path:stub};
})}}]}).catch(e=>{console.error(e);process.exit(1)});
