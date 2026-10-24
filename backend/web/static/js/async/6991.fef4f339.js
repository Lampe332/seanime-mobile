"use strict";(self.rspackChunkseanime_web=self.rspackChunkseanime_web||[]).push([[6991],{46146(e,t,i){i.d(t,{j:()=>p});var n=i(72361),o=i(88185),r=i(42610),d=i(86517),s=i(22570),a=i(97145),w=i(58272),l=i(68413),u=i(83195),c=i(14582),f=i(92467),v=i(44915),g=i(30867),h=i(1370);let b=(0,u.vF)("PLUGIN WEBVIEWS");function p(e){let{slot:t}=e,i=(0,c.a8)(),s=(0,c.ok)(),a="screen"===t&&"/webview"===i?s.get("id"):void 0,{sendWebviewMountedEvent:w}=(0,o.x0)(),{sendWebviewUnmountedEvent:u}=(0,o.Nz)(),{sendWebviewPostMessageEvent:p}=(0,o.lv)(),y=(0,d.iK)(),x=(0,d.tU)(),I=l.useRef(x.current),E=(0,v.ko)(),k=l.useRef(E);l.useEffect(()=>{k.current=E},[E]);let W=l.useRef(!1),R=l.useRef(a);function N(e){return document.getElementById(`webview-${e}`)}(0,g.A)(()=>{x&&(b.info("Mounting webview slot",t),w({slot:t}),W.current=!0)}),(0,h.A)(()=>{x&&(b.info("Unmounting webview slot",t),u({slot:t}),W.current=!1)}),l.useEffect(()=>{W.current&&(y&&!I.current&&(b.info("Mounting webview slot because main tab changed",t),w({slot:t})),I.current=y)},[y]),l.useEffect(()=>{if("screen"!==t||!W.current){R.current=a;return}R.current!==a&&(R.current=a,E.clear(),a&&w({slot:t}))},[E,a,w,t]),l.useEffect(()=>{let e=e=>{if(e.origin!==window.location.origin&&"null"!==e.origin)return void b.warn("Rejected message from invalid origin",e.origin);let t=e.data,i=k.current.get(t.webviewId);if(i){if(t.token!==i.token)return void b.warn("Rejected message with invalid token",{webviewId:t.webviewId});if("plugin-webview-resize"===t.type){if(i.options?.autoHeight){let e=N(t.webviewId);e&&(e.style.height=`${t.height}px`,i.options?.fullWidth||(e.style.width=`${t.width}px`))}return}if("plugin-webview-request-container-width"===t.type){let e=N(t.webviewId);if(e&&e.contentWindow){let t=e.parentElement,n=t?.clientWidth||window.innerWidth;e.contentWindow.postMessage({type:"plugin-webview-container-width",width:n,token:i.token},"*")}return}"plugin-webview-trigger"===t.type&&(b.info("Forwarding webview event to server",{extensionId:i.extensionId,event:t.event}),p({slot:i.slot,eventName:t.event,event:t.payload||{}},i.extensionId))}};return window.addEventListener("message",e),()=>window.removeEventListener("message",e)},[t]),(0,h.A)(()=>{E.clear()}),(0,r.oA)({type:"plugin-unloaded",onMessage:e=>{x&&E.forEach((t,i)=>{t.extensionId===e&&E.delete(i)})}});let $=l.useCallback((e,t,i)=>{let n=E.get(e);n&&E.set(e,{...n,position:{x:t,y:i}})},[E]);l.useCallback((e,t,i)=>{let n=E.get(e);n&&E.set(e,{...n,preservedSize:{width:t,height:i}})},[E]);let z=l.useCallback(e=>{E.delete(e),document.getElementById(`webview-${e}`)?.remove()},[E]),O=l.useCallback((e,i)=>{var n,o;let r,d;if(b.info("Setting up iframe webview",{extensionId:e}),!x)return;let s=`${e}-${t}`,a=E.get(s),w=a?.position,l=a?.preservedSize;E.has(s)&&E.delete(s);let u=`${Date.now()}-${Math.random().toString(36).substring(2,15)}`,c=(n=i.content,o=window.location.origin,r=`
    const WEBVIEW_TOKEN = "${u}"
    const PARENT_ORIGIN = "${o}"

    window.webview = {
        // Send a message to Seanime
        send: (event, payload) => {
            window.parent.postMessage({
                type: "plugin-webview-trigger",
                event,
                payload,
                webviewId: "${s}",
                token: WEBVIEW_TOKEN
            }, PARENT_ORIGIN)
        },
        // Receive messages from Seanime
        on: (event, callback) => {
            const handler = (e) => {
                const isTrustedOrigin = e.origin === PARENT_ORIGIN || e.origin === "null"
                if (!isTrustedOrigin || e.data.token !== WEBVIEW_TOKEN) return
                // State syncing
                if (e.data.type === "plugin-webview-sync" && e.data.key === event) {
                    callback(e.data.value)
                }
                // Handle response from requestContainerWidth()
                if (e.data.type === "plugin-webview-container-width") {
                    if (event === "containerWidth") {
                        callback(e.data.width)
                    }
                }
            }
            window.addEventListener("message", handler)
            // Return cancel function
            return () => {
                window.removeEventListener("message", handler)
            }
        },
        // Get the width of the container the webview is in.
        requestContainerWidth: () => {
            window.parent.postMessage({
                type: "plugin-webview-request-container-width",
                webviewId: "${s}",
                token: WEBVIEW_TOKEN
            }, PARENT_ORIGIN)
        },
        // Notify Seanime when the webview body changed size
        _onResizeObserved: () => {
            const height = document.body.scrollHeight
            const width = document.body.scrollWidth
            window.parent.postMessage({
                type: "plugin-webview-resize",
                webviewId: "${s}",
                width: width,
                height: height,
                token: WEBVIEW_TOKEN
            }, PARENT_ORIGIN)
        }
    }

    // Notify Seanime to resize iframe when content changes
    if (window.ResizeObserver) {
        window.addEventListener("load", () => {
            const resizeObserver = new ResizeObserver(() => {
                if (window.webview) window.webview._onResizeObserved()
            })
            if (document.body) {
                resizeObserver.observe(document.body)
            }
        })
    }
`,d=`<script>${r}</script>`,n.includes("<head>")?n.replace("<head>",`<head>
${d}`):n.includes("<body>")?n.replace("<body>",`<body>
${d}`):d+n),f=i.options;E.set(s,{webviewId:s,extensionId:e,src:c,token:u,options:f,position:w,preservedSize:l,slot:t})},[E]);return((0,o.PR)((e,n)=>{if(x&&e.slot===t){if("screen"!==e.slot||"/webview"===i&&n===s.get("id"))O(n,e)}},""),(0,o.pT)((e,t)=>{if(!x.current)return;let i=E.get(e.webviewId);if(!i)return;let n=N(i.webviewId);n&&n.contentWindow?n.contentWindow.postMessage({type:"plugin-webview-sync",key:e.key,value:e.value,token:i.token},"*"):b.warn("Cannot find iframe element for webview",e.webviewId)},""),(0,o.Dm)((e,t)=>{if(!x)return;let i=E.get(e.webviewId);i&&(E.delete(i.webviewId),document.getElementById(`webview-${i.webviewId}`)?.remove())},""),"fixed"===t)?(0,n.jsx)(n.Fragment,{children:(0,n.jsx)(f.Z,{container:document.body,className:"plugin-webview-portal",children:Array.from(E.values()).map(e=>(0,n.jsx)(m,{webview:e,onUpdatePosition:$,onClose:z},e.webviewId))})}):(0,n.jsx)(n.Fragment,{children:Array.from(E.values()).map(e=>(0,n.jsx)(m,{webview:e,onUpdatePosition:$,onClose:z},e.webviewId))})}function m(e){let{webview:t,onUpdatePosition:i,onClose:r}=e,{sendWebviewLoadedEvent:d}=(0,o.bQ)(),u=t.options||{},c=l.useRef(null),[f,v]=l.useState(!1),g=l.useRef({x:0,y:0,elemX:0,elemY:0}),h=l.useRef({paddingTop:0,paddingRight:0,paddingBottom:0,paddingLeft:80});function p(e){return Math.max(h.current.paddingLeft,Math.min(e,window.innerWidth-(c.current?.offsetWidth||0)-h.current.paddingRight))}function m(e){return Math.max(h.current.paddingTop,Math.min(e,window.innerHeight-(c.current?.offsetHeight||0)-h.current.paddingBottom))}let y=l.useMemo(()=>{let e=p(u?.window?.defaultX||0),t=m(u?.window?.defaultY||0);if(u?.window?.defaultPosition&&window){let i=window.innerWidth,n=window.innerHeight;switch(u.window.defaultPosition){case"top-left":e=10,t=10;break;case"top-right":e=i-(c.current?.offsetWidth||0)-10,t=10;break;case"bottom-left":e=10,t=n-(c.current?.offsetHeight||0)-10;break;case"bottom-right":e=i-(c.current?.offsetWidth||0)-10,t=n-(c.current?.offsetHeight||0)-10}}return{x:e,y:t}},[c.current]),x=t.position||y,I=l.useMemo(()=>u.style?.split(";")?.reduce((e,t)=>{let[i,n]=t.split(":").map(e=>e.trim());return i&&n&&(e[i.replace(/-([a-z])/g,e=>e[1].toUpperCase())]=n),e},{}),[u.style]),E=l.useMemo(()=>{let e={position:"fixed"===t.slot?"fixed":"relative",border:"none",zIndex:u.zIndex||("fixed"===t.slot?100:5),background:"transparent"};return"fixed"!==t.slot||t.options?.window?.frameless||(e.overflow="hidden",e.borderRadius="1rem",e.borderColor="var(--border)",e.borderStyle="solid",e.borderWidth="1px",e.backgroundColor="var(--background)",e.boxShadow="var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow)"),u.fullWidth?e.width="100%":u.width&&(e.width=u.width),u.height?e.height=u.height:u.autoHeight&&(e.height="auto"),u.maxWidth&&(e.maxWidth=u.maxWidth),u.maxHeight&&(e.maxHeight=u.maxHeight),"fixed"===t.slot&&(u?.window?.draggable?(e.left=`${x.x}px`,e.top=`${x.y}px`):(e.left=u?.window?.defaultX!==void 0?`${u?.window?.defaultX}px`:"0",e.top=u?.window?.defaultY!==void 0?`${u?.window?.defaultY}px`:"0")),I&&Object.assign(e,I),e},[t.slot,u,x,I]),k=l.useCallback(e=>{u?.window?.draggable&&(e.preventDefault(),v(!0),g.current={x:e.clientX,y:e.clientY,elemX:x.x,elemY:x.y})},[u?.window?.draggable,x]);l.useEffect(()=>{if(!f)return;let e=e=>{let n=e.clientX-g.current.x,o=e.clientY-g.current.y,r=p(g.current.elemX+n),d=m(g.current.elemY+o);i(t.webviewId,r,d)},n=()=>v(!1);return document.addEventListener("mousemove",e),document.addEventListener("mouseup",n),()=>{document.removeEventListener("mousemove",e),document.removeEventListener("mouseup",n)}},[f,i,t.webviewId]);let{width:W}=function(e,t){let i,n,o,r,d=(0,a.c)(8);d[0]!==t?(i=void 0===t?[]:t,d[0]=t,d[1]=i):i=d[1];let s=i;d[2]===Symbol.for("react.memo_cache_sentinel")?(n={width:0,height:0,top:0,left:0,bottom:0,right:0,x:0,y:0},d[2]=n):n=d[2];let[u,c]=(0,l.useState)(n);return d[3]!==e?(o=()=>{let t=e.current;if(!t)return;let i=new ResizeObserver(e=>{for(let t of e){let e=t.target.getBoundingClientRect();c({width:e.width,height:e.height,top:e.top,left:e.left,bottom:e.bottom,right:e.right,x:e.x,y:e.y})}});return i.observe(t),()=>{i.disconnect()}},d[3]=e,d[4]=o):o=d[4],d[5]!==s||d[6]!==e?(r=[e,...s],d[5]=s,d[6]=e,d[7]=r):r=d[7],(0,w.E)(o,r),u}(c,[t.options?.hidden]);return t.options?.hidden?null:(0,n.jsxs)("div",{"data-webview-container":t.webviewId,style:{..."fixed"===t.slot?{position:"fixed",left:x.x,top:x.y,zIndex:u.zIndex||("fixed"===t.slot?100:5)}:{display:"block",width:"100%"}},children:[!!u?.window?.draggable&&"fixed"===t.slot&&(0,n.jsx)("div",{"data-plugin-webview-el":"drag-handle",onMouseDown:k,className:"absolute top-0 left-0 right-0 h-8 cursor-move z-[9999]",style:{pointerEvents:"auto",width:W}}),(0,n.jsx)("iframe",{ref:c,id:`webview-${t.webviewId}`,srcDoc:t.src,sandbox:"allow-scripts allow-forms",style:E,onLoad:()=>{b.info("Loaded iframe webview",t.webviewId),d({slot:t.slot},t.extensionId)},className:(0,s.cn)(f&&"pointer-events-none",u.className),...{credentialless:"true"}})]})}},58272(e,t,i){var n=i(97145),o=i(68413);let r="u">typeof window?o.useLayoutEffect:o.useEffect;function d(e,t){let i,r=(0,n.c)(2),d=o.useRef(!0);r[0]!==e?(i=()=>{if(!d.current)return e();d.current=!1},r[0]=e,r[1]=i):i=r[1],o.useEffect(i,t)}i.d(t,{w:()=>d},{E:r})}}]);