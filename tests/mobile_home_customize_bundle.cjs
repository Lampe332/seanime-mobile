const path = require('node:path');const {createRequire}=require('node:module');const root=path.resolve(__dirname,'..');const web=path.join(root,'backend/seanime-web');const {build}=createRequire(path.join(web,'package.json'))('esbuild');
const stub=path.join(__dirname,'mobile_home_customize_stubs.tsx');
const stubbed=['@/api/hooks/debrid.hooks','@/api/hooks/settings.hooks','@/api/hooks/status.hooks','@/api/hooks/torrentstream.hooks','@/app/(main)/_hooks/use-server-status','@/app/websocket-provider','@/lib/theme/theme-hooks','@/lib/app-language','@tanstack/react-query','sonner'];
build({absWorkingDir:web,entryPoints:[path.join(__dirname,'mobile_home_customize_harness.tsx')],outfile:path.resolve(process.argv[2]),bundle:true,platform:'browser',format:'iife',jsx:'automatic',logLevel:'error',define:{'import.meta.env':'{}'},nodePaths:[path.join(web,'node_modules')],plugins:[{name:'controlled-customize-boundary',setup(b){b.onResolve({filter:/.*/},a=>{
if(stubbed.includes(a.path))return {path:stub};
})}}],resolveExtensions:['.tsx','.ts','.jsx','.js','.css','.json']}).catch(e=>{console.error(e);process.exit(1)});
