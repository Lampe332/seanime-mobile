// Controlled backend/runtime boundaries. Never loaded by the production app.
import React from 'react'
import {atom,useAtomValue} from 'jotai'
export const __plugin_openedTrayPlugin=atom<string|null>(null)
export const __plugin_unpinnedTrayIconClickedAtom=atom<any>(null)
const listeners=new Set<()=>void>();let state:any={pins:JSON.parse(localStorage.getItem('controlled-test-pins')||'[]'),loading:false,error:false,mutationError:false,pending:false}
export const probe:any={opens:[],writes:[],runtimeRenders:0,update(value:any){state={...state,...value};listeners.forEach(f=>f())}}
;(window as any).pluginProbe=probe
function useStateSnapshot(){return React.useSyncExternalStore(f=>{listeners.add(f);return()=>listeners.delete(f)},()=>state)}
export function useGetPluginSettings(){const s=useStateSnapshot();return {data:{pinnedTrayPluginIds:s.pins},isLoading:s.loading,isError:s.error,refetch(){probe.update({error:false,loading:false})}}}
export function useSetPluginSettingsPinnedTrays(){const s=useStateSnapshot();return {isPending:s.pending,isError:s.mutationError,mutate(value:any){probe.writes.push(value);probe.update({pending:true});setTimeout(()=>{if(state.failWrite){probe.update({pending:false,mutationError:true});return}localStorage.setItem('controlled-test-pins',JSON.stringify(value.pinnedTrayPluginIds));probe.update({pins:value.pinnedTrayPluginIds,pending:false,mutationError:false})},60)}}}
export function PluginTray({trayIcon}:any){probe.runtimeRenders++;const selected=useAtomValue(__plugin_unpinnedTrayIconClickedAtom);React.useEffect(()=>{if(selected?.extensionId===trayIcon.extensionId)probe.opens.push(trayIcon.extensionId)},[selected]);return null}
export function useTr(){return (en:string,de:string)=>en}
export function Badge({children}:any){return <span>{children}</span>}

export function usePluginListenTrayOpenEvent(callback:()=>void){React.useEffect(()=>{const f=()=>callback();window.addEventListener("controlled-tray-open",f);return()=>window.removeEventListener("controlled-tray-open",f)},[callback])}
