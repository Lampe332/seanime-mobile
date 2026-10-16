const path = require('path');
const root = path.resolve(__dirname, '../backend/seanime-web');
const esbuild = require(path.join(root, 'node_modules/esbuild'));
esbuild.build({
  stdin: {contents: `import {useDOMManager} from ${JSON.stringify(path.join(root,'src/app/(main)/_features/plugin/dom-manager.ts'))}; window.__domManager=useDOMManager('audit');`, resolveDir:root},
  bundle:true,format:'iife',outfile:path.join(__dirname,'plugin-dom-test.js'),
  plugins: [{name:'isolated-hook-test',setup(build){
    build.onResolve({filter:/^(react|@\/.*)$/},args=>({path:args.path,namespace:'stub'}));
    build.onResolve({filter:/generated\/plugin-events$/},args=>({path:args.path,namespace:'stub'}));
    build.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:
      args.path==='react' ? 'export const useRef=v=>({current:v});export const useEffect=f=>{let c=f();if(c)(window.__cleanups??=[]).push(c)};' :
      args.path.includes('handle-websockets') ? 'export const useWebsocketSender=()=>({sendPluginMessage:(type,payload)=>{(window.__messages??=[]).push({type,payload})}});' :
      args.path.includes('websocket-provider') ? 'export const useIsMainTab=()=>true;export const useIsMainTabRef=()=>({current:true});' :
      args.path.includes('debug') ? 'export const logger=()=>({info:()=>{}});' :
      'export const PluginClientEvents=new Proxy({}, {get:(o,k)=>k});'
    }));
  }}]
}).catch(error=>{console.error(error);process.exit(1)});
