const path = require('node:path');const {createRequire}=require('node:module');const root=path.resolve(__dirname,'..');const web=path.join(root,'backend/seanime-web');const {build}=createRequire(path.join(web,'package.json'))('esbuild');
const stub=path.join(__dirname,'mobile_home_plugins_stubs.tsx');
build({absWorkingDir:web,entryPoints:[path.join(__dirname,'mobile_home_plugins_harness.tsx')],outfile:path.resolve(process.argv[2]),bundle:true,platform:'browser',format:'iife',jsx:'automatic',nodePaths:[path.join(web,'node_modules')],plugins:[{name:'controlled-plugin-boundary',setup(b){b.onResolve({filter:/.*/},a=>{
if(['@/api/hooks/extensions.hooks','@/lib/app-language','@/components/ui/badge','../generated/plugin-events'].includes(a.path)||(['./plugin-tray','./plugin-sidebar-tray'].includes(a.path)&&a.importer.endsWith('mobile-plugin-menu.tsx')))return {path:stub};
})}}]}).catch(e=>{console.error(e);process.exit(1)});
