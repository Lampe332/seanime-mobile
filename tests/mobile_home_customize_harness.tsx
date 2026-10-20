import React from 'react'
import {createRoot} from 'react-dom/client'
import {Provider, createStore} from 'jotai'
import {HomeSettingsModal, __home_settingsModalOpen} from '../backend/seanime-web/src/app/(main)/_features/home/home-settings-modal'
import {useProbeState} from './mobile_home_customize_stubs'
import '../backend/seanime-web/src/components/shared/mobile-surface.css'
import '../backend/seanime-web/src/app/(main)/_features/home/home-mobile.css'
const store=createStore()
;(window as any).openCustomize=()=>store.set(__home_settingsModalOpen,true)
;(window as any).isCustomizeOpen=()=>store.get(__home_settingsModalOpen)
function Harness(){const s=useProbeState();return <HomeSettingsModal isNakamaLibrary={false} mobileHome homeItems={s.items}/>}
createRoot(document.getElementById('root')!).render(<Provider store={store}><Harness/></Provider>)
