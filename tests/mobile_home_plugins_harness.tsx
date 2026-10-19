import React from 'react'
import {createRoot} from 'react-dom/client'
import {Provider} from 'jotai'
import {MobilePluginMenu} from '../backend/seanime-web/src/app/(main)/_features/plugin/tray/mobile-plugin-menu'
import {HomeMobileHeader} from '../backend/seanime-web/src/app/(main)/_features/home/home-mobile-header'
import '../backend/seanime-web/src/app/(main)/_features/home/home-mobile.css'
const initial=Array.from({length:13},(_,i)=>({extensionId:`controlled-${i}`,extensionName:i===12?'Controlled last plugin with an exceptionally long name that must wrap safely':`Controlled plugin ${i}`,iconUrl:i===0?'http://plugins.test/broken-icon.png':'',badgeNumber:0,withContent:true}))
function Harness(){const[icons,setIcons]=React.useState(initial);(window as any).setControlledIcons=setIcons;return <><div data-home-navbar><HomeMobileHeader><MobilePluginMenu icons={icons as any} width={320} developmentModeExtensions={[]} debugCounts={{}} openDebugWindow={()=>{}} reloadExternalExtension={()=>{}} isReloadingExtension={false}/></HomeMobileHeader></div><main style={{height:1800}}>Controlled test page</main></>}
createRoot(document.getElementById('root')!).render(<Provider><Harness/></Provider>)
