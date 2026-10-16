"use strict";(self.rspackChunkseanime_web=self.rspackChunkseanime_web||[]).push([[6991],{46146(e,t,n){n.d(t,{j:()=>p});var i=n(72361),o=n(88185),r=n(42610),d=n(31237),s=n(22570),a=n(97145),w=n(58272),l=n(68413),u=n(83195),c=n(14582),f=n(92467),v=n(44915),g=n(30867),h=n(1370);let b=(0,u.vF)("PLUGIN WEBVIEWS");function p(e){let{slot:t}=e,n=(0,c.a8)(),s=(0,c.ok)(),a="screen"===t&&"/webview"===n?s.get("id"):void 0,{sendWebviewMountedEvent:w}=(0,o.x0)(),{sendWebviewUnmountedEvent:u}=(0,o.Nz)(),{sendWebviewPostMessageEvent:p}=(0,o.lv)(),y=(0,d.iK)(),x=(0,d.tU)(),E=l.useRef(x.current),I=(0,v.ko)(),k=l.useRef(I);l.useEffect(()=>{k.current=I},[I]);let R=l.useRef(!1),W=l.useRef(a);function N(e){return document.getElementById(`webview-${e}`)}(0,g.A)(()=>{x&&(b.info("Mounting webview slot",t),w({slot:t}),R.current=!0)}),(0,h.A)(()=>{x&&(b.info("Unmounting webview slot",t),u({slot:t}),R.current=!1)}),l.useEffect(()=>{R.current&&(y&&!E.current&&(b.info("Mounting webview slot because main tab changed",t),w({slot:t})),E.current=y)},[y]),l.useEffect(()=>{if("screen"!==t||!R.current){W.current=a;return}W.current!==a&&(W.current=a,I.clear(),a&&w({slot:t}))},[I,a,w,t]),l.useEffect(()=>{let e=e=>{if(e.origin!==window.location.origin&&"null"!==e.origin)return void b.warn("Rejected message from invalid origin",e.origin);let t=e.data,n=k.current.get(t.webviewId);if(n){if(t.token!==n.token)return void b.warn("Rejected message with invalid token",{webviewId:t.webviewId});if("plugin-webview-resize"===t.type){if(n.options?.autoHeight){let e=N(t.webviewId);e&&(e.style.height=`${t.height}px`,n.options?.fullWidth||(e.style.width=`${t.width}px`))}return}if("plugin-webview-request-container-width"===t.type){let e=N(t.webviewId);if(e&&e.contentWindow){let t=e.parentElement,i=t?.clientWidth||window.innerWidth;e.contentWindow.postMessage({type:"plugin-webview-container-width",width:i,token:n.token},"*")}return}"plugin-webview-trigger"===t.type&&(b.info("Forwarding webview event to server",{extensionId:n.extensionId,event:t.event}),p({slot:n.slot,eventName:t.event,event:t.payload||{}},n.extensionId))}};return window.addEventListener("message",e),()=>window.removeEventListener("message",e)},[t]),(0,h.A)(()=>{I.clear()}),(0,r.oA)({type:"plugin-unloaded",onMessage:e=>{x&&I.forEach((t,n)=>{t.extensionId===e&&I.delete(n)})}});let $=l.useCallback((e,t,n)=>{let i=I.get(e);i&&I.set(e,{...i,position:{x:t,y:n}})},[I]);l.useCallback((e,t,n)=>{let i=I.get(e);i&&I.set(e,{...i,preservedSize:{width:t,height:n}})},[I]);let z=l.useCallback(e=>{I.delete(e),document.getElementById(`webview-${e}`)?.remove()},[I]),O=l.useCallback((e,n)=>{var i,o;let r,d;if(b.info("Setting up iframe webview",{extensionId:e}),!x)return;let s=`${e}-${t}`,a=I.get(s),w=a?.position,l=a?.preservedSize;I.has(s)&&I.delete(s);let u=`${Date.now()}-${Math.random().toString(36).substring(2,15)}`,c=(i=n.content,o=window.location.origin,r=`
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
`,d=`<script>${r}</script>`,i.includes("<head>")?i.replace("<head>",`<head>
${d}`):i.includes("<body>")?i.replace("<body>",`<body>
${d}`):d+i),f=n.options;I.set(s,{webviewId:s,extensionId:e,src:c,token:u,options:f,position:w,preservedSize:l,slot:t})},[I]);return((0,o.PR)((e,i)=>{if(x&&e.slot===t){if("screen"!==e.slot||"/webview"===n&&i===s.get("id"))O(i,e)}},""),(0,o.pT)((e,t)=>{if(!x.current)return;let n=I.get(e.webviewId);if(!n)return;let i=N(n.webviewId);i&&i.contentWindow?i.contentWindow.postMessage({type:"plugin-webview-sync",key:e.key,value:e.value,token:n.token},"*"):b.warn("Cannot find iframe element for webview",e.webviewId)},""),(0,o.Dm)((e,t)=>{if(!x)return;let n=I.get(e.webviewId);n&&(I.delete(n.webviewId),document.getElementById(`webview-${n.webviewId}`)?.remove())},""),"fixed"===t)?(0,i.jsx)(i.Fragment,{children:(0,i.jsx)(f.Z,{container:document.body,className:"plugin-webview-portal",children:Array.from(I.values()).map(e=>(0,i.jsx)(m,{webview:e,onUpdatePosition:$,onClose:z},e.webviewId))})}):(0,i.jsx)(i.Fragment,{children:Array.from(I.values()).map(e=>(0,i.jsx)(m,{webview:e,onUpdatePosition:$,onClose:z},e.webviewId))})}function m(e){let{webview:t,onUpdatePosition:n,onClose:r}=e,{sendWebviewLoadedEvent:d}=(0,o.bQ)(),u=t.options||{},c=l.useRef(null),[f,v]=l.useState(!1),g=l.useRef({x:0,y:0,elemX:0,elemY:0}),h=l.useRef({paddingTop:0,paddingRight:0,paddingBottom:0,paddingLeft:80});function p(e){return Math.max(h.current.paddingLeft,Math.min(e,window.innerWidth-(c.current?.offsetWidth||0)-h.current.paddingRight))}function m(e){return Math.max(h.current.paddingTop,Math.min(e,window.innerHeight-(c.current?.offsetHeight||0)-h.current.paddingBottom))}let y=l.useMemo(()=>{let e=p(u?.window?.defaultX||0),t=m(u?.window?.defaultY||0);if(u?.window?.defaultPosition&&window){let n=window.innerWidth,i=window.innerHeight;switch(u.window.defaultPosition){case"top-left":e=10,t=10;break;case"top-right":e=n-(c.current?.offsetWidth||0)-10,t=10;break;case"bottom-left":e=10,t=i-(c.current?.offsetHeight||0)-10;break;case"bottom-right":e=n-(c.current?.offsetWidth||0)-10,t=i-(c.current?.offsetHeight||0)-10}}return{x:e,y:t}},[c.current]),x=t.position||y,E=l.useMemo(()=>u.style?.split(";")?.reduce((e,t)=>{let[n,i]=t.split(":").map(e=>e.trim());return n&&i&&(e[n.replace(/-([a-z])/g,e=>e[1].toUpperCase())]=i),e},{}),[u.style]),I=l.useMemo(()=>{let e={position:"fixed"===t.slot?"fixed":"relative",border:"none",zIndex:u.zIndex||("fixed"===t.slot?100:5),background:"transparent"};return"fixed"!==t.slot||t.options?.window?.frameless||(e.overflow="hidden",e.borderRadius="1rem",e.borderColor="var(--border)",e.borderStyle="solid",e.borderWidth="1px",e.backgroundColor="var(--background)",e.boxShadow="var(--tw-ring-offset-shadow, 0 0 #0000), var(--tw-ring-shadow, 0 0 #0000), var(--tw-shadow)"),u.fullWidth?e.width="100%":u.width&&(e.width=u.width),u.height?e.height=u.height:u.autoHeight&&(e.height="auto"),u.maxWidth&&(e.maxWidth=u.maxWidth),u.maxHeight&&(e.maxHeight=u.maxHeight),"fixed"===t.slot&&(u?.window?.draggable?(e.left=`${x.x}px`,e.top=`${x.y}px`):(e.left=u?.window?.defaultX!==void 0?`${u?.window?.defaultX}px`:"0",e.top=u?.window?.defaultY!==void 0?`${u?.window?.defaultY}px`:"0")),E&&Object.assign(e,E),e},[t.slot,u,x,E]),k=l.useCallback(e=>{u?.window?.draggable&&(e.preventDefault(),v(!0),g.current={x:e.clientX,y:e.clientY,elemX:x.x,elemY:x.y})},[u?.window?.draggable,x]);l.useEffect(()=>{if(!f)return;let e=e=>{let i=e.clientX-g.current.x,o=e.clientY-g.current.y,r=p(g.current.elemX+i),d=m(g.current.elemY+o);n(t.webviewId,r,d)},i=()=>v(!1);return document.addEventListener("mousemove",e),document.addEventListener("mouseup",i),()=>{document.removeEventListener("mousemove",e),document.removeEventListener("mouseup",i)}},[f,n,t.webviewId]);let{width:R}=function(e,t){let n,i,o,r,d=(0,a.c)(8);d[0]!==t?(n=void 0===t?[]:t,d[0]=t,d[1]=n):n=d[1];let s=n;d[2]===Symbol.for("react.memo_cache_sentinel")?(i={width:0,height:0,top:0,left:0,bottom:0,right:0,x:0,y:0},d[2]=i):i=d[2];let[u,c]=(0,l.useState)(i);return d[3]!==e?(o=()=>{let t=e.current;if(!t)return;let n=new ResizeObserver(e=>{for(let t of e){let e=t.target.getBoundingClientRect();c({width:e.width,height:e.height,top:e.top,left:e.left,bottom:e.bottom,right:e.right,x:e.x,y:e.y})}});return n.observe(t),()=>{n.disconnect()}},d[3]=e,d[4]=o):o=d[4],d[5]!==s||d[6]!==e?(r=[e,...s],d[5]=s,d[6]=e,d[7]=r):r=d[7],(0,w.Es)(o,r),u}(c,[t.options?.hidden]);return t.options?.hidden?null:(0,i.jsxs)("div",{"data-webview-container":t.webviewId,style:{..."fixed"===t.slot?{position:"fixed",left:x.x,top:x.y,zIndex:u.zIndex||("fixed"===t.slot?100:5)}:{display:"block",width:"100%"}},children:[!!u?.window?.draggable&&"fixed"===t.slot&&(0,i.jsx)("div",{"data-plugin-webview-el":"drag-handle",onMouseDown:k,className:"absolute top-0 left-0 right-0 h-8 cursor-move z-[9999]",style:{pointerEvents:"auto",width:R}}),(0,i.jsx)("iframe",{ref:c,id:`webview-${t.webviewId}`,srcDoc:t.src,sandbox:"allow-scripts allow-forms",style:I,onLoad:()=>{b.info("Loaded iframe webview",t.webviewId),d({slot:t.slot},t.extensionId)},className:(0,s.cn)(f&&"pointer-events-none",u.className),...{credentialless:"true"}})]})}},58272(e,t,n){var i=n(97145),o=n(68413);function r(e,t,n,r){let s,a,w,l,u=(0,i.c)(11),c=o.useRef(t);u[0]!==t?(s=()=>{c.current=t},a=[t],u[0]=t,u[1]=s,u[2]=a):(s=u[1],a=u[2]),d(s,a),u[3]!==n?.current||u[4]!==e||u[5]!==r?(w=()=>{let t=n?.current??window;if(!(t&&t.addEventListener))return;let i=e=>c.current(e);return t.addEventListener(e,i,r),()=>{t.removeEventListener(e,i,r)}},u[3]=n?.current,u[4]=e,u[5]=r,u[6]=w):w=u[6],u[7]!==n||u[8]!==e||u[9]!==r?(l=[e,n,r],u[7]=n,u[8]=e,u[9]=r,u[10]=l):l=u[10],o.useEffect(w,l)}let d="u">typeof window?o.useLayoutEffect:o.useEffect;function s(e,t){let n,r=(0,i.c)(2),d=o.useRef(!0);r[0]!==e?(n=()=>{if(!d.current)return e();d.current=!1},r[0]=e,r[1]=n):n=r[1],o.useEffect(n,t)}n.d(t,{ML:()=>r,w5:()=>s},{Es:d})}}]);