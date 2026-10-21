const path = require('node:path');
const {createRequire} = require('node:module');
const web = path.resolve(__dirname, '../backend/seanime-web');
const {build} = createRequire(path.join(web,'package.json'))('esbuild');
const stub = path.join(__dirname,'mobile_discover_stubs.tsx');
// The real /discover page and query hooks (react-query keys and caching stay real); the server, the router (with
// TanStack's history keys), links, images, preview modal, plugin parts and the desktop page's containers are fixtures.
const stubbed = ['@/api/client/requests','@tanstack/react-router','@/lib/navigation','@/components/shared/sea-link','@/components/shared/sea-image','@/lib/server/assets',
'@/app/(main)/_features/media/_containers/media-preview-modal','@/app/(main)/_features/media/_components/media-entry-card-components',
'@/app/(main)/_features/plugin/actions/plugin-actions','@/app/(main)/_features/plugin/webview/plugin-webviews',
'@/app/(main)/discover/_components/discover-page-header','@/app/(main)/discover/_containers/discover-airing-schedule',
'@/app/(main)/discover/_containers/discover-missed-sequels','@/app/(main)/discover/_containers/discover-popular',
'@/app/(main)/discover/_containers/discover-trending','@/app/(main)/discover/_containers/discover-trending-country',
'@/app/(main)/discover/_containers/discover-trending-movies','@/app/(main)/discover/_containers/discover-upcoming',
'@/app/(main)/schedule/_containers/recent-releases'];
// --production: React's production build, minified (frame times as in the app); without it React's warnings stay on.
const production = process.argv.includes('--production');
build({absWorkingDir:web,entryPoints:[path.join(__dirname,'mobile_discover_harness.tsx')],outfile:process.argv[2],bundle:true,platform:'browser',format:'iife',jsx:'automatic',logLevel:'error',minify:production,define:{'import.meta.env':'{"SEA_PUBLIC_PLATFORM":"mobile"}',...(production?{'process.env.NODE_ENV':'"production"'}:{})},nodePaths:[path.join(web,'node_modules')],plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/.*/},a=>{
if(stubbed.includes(a.path)&&a.importer!==stub)return {path:stub};
})}}]}).catch(e=>{console.error(e);process.exit(1)});
