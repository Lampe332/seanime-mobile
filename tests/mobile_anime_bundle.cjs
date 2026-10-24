const path = require('node:path');
const {createRequire} = require('node:module');
const web = path.resolve(__dirname, '../backend/seanime-web');
const {build} = createRequire(path.join(web,'package.json'))('esbuild');
const stub = path.join(__dirname,'mobile_anime_stubs.tsx');
build({absWorkingDir:web,entryPoints:[path.join(__dirname,process.argv[3]||'mobile_anime_harness.tsx')],outfile:process.argv[2],bundle:true,platform:'browser',format:'iife',jsx:'automatic',define:{'import.meta.env':'{}'},nodePaths:[path.join(web,'node_modules')],plugins:[{name:'read-only-boundaries',setup(b){b.onResolve({filter:/.*/},a=>{
if(process.argv[4]!=='--no-stubs'&&['@/api/hooks/anilist.hooks','@/api/hooks/anime_entries.hooks','@/app/(main)/_features/plugin/webview/plugin-webviews','@/app/(main)/_hooks/use-server-status','@/lib/theme/theme-hooks','@/lib/theme/anime-spoilers','@/lib/server/assets','@/components/shared/sea-image'].includes(a.path))return {path:stub};
})}}]}).catch(e=>{console.error(e);process.exit(1)});
