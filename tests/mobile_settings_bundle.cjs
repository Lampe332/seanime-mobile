const path = require('node:path');
const {createRequire} = require('node:module');
const web = path.resolve(__dirname, '../backend/seanime-web');
const {build} = createRequire(path.join(web,'package.json'))('esbuild');
const stub = path.join(__dirname,'mobile_settings_stubs.tsx');
// The real /settings page, phone screen, save hooks, query hooks (react-query stays real) and folder picker helper; the
// server, router, toasts, clipboard, file saves, update check, tutorial, issue recorder, manga source store and the desktop
// page's containers are fixtures.
const stubbed = ['@/api/client/requests','@/lib/navigation','sonner','@/lib/android-app','@/lib/helpers/browser'];
// Stubbed only for the settings page and its screens (other modules of the bundle keep the real ones)
const scoped = ['@/api/hooks/releases.hooks','@/app/(main)/_features/update/update-modal','@/app/(main)/_features/tour/mobile-tutorial',
'@/app/(main)/_features/issue-report/issue-report','@/app/(main)/manga/_lib/handle-manga-selected-provider','@/app/(main)/_hooks/use-save-server-file',
'@/app/(main)/_features/anime-library/_containers/custom-library-banner'];
// The desktop page's containers, as page.tsx imports them
const desktop = /^(@\/app\/\(main\)\/settings\/|\.\/)_(containers|components)\/(?!settings-page\.atoms|android-folder-button)/;
build({absWorkingDir:web,entryPoints:[path.join(__dirname,'mobile_settings_harness.tsx')],outfile:process.argv[2],bundle:true,platform:'browser',format:'iife',jsx:'automatic',logLevel:'error',define:{'import.meta.env':'{}'},nodePaths:[path.join(web,'node_modules')],plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/.*/},a=>{
if(a.importer===stub)return;
const importer=a.importer.replace(/\\/g,'/');
if(stubbed.includes(a.path)||(a.path==='../client/requests'&&importer.includes('/src/api/hooks/'))||(importer.includes('/app/(main)/settings/')&&scoped.includes(a.path))
    ||(importer.endsWith('/settings/page.tsx')&&desktop.test(a.path)))return {path:stub};
})}}]}).catch(e=>{console.error(e);process.exit(1)});
