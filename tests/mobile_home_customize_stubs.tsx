// Controlled backend/runtime boundaries for the Customize Home harness. Never loaded by the production app.
import React from 'react'
const listeners=new Set<()=>void>()
let state:any={items:[{id:'a',type:'anime-continue-watching',schemaVersion:1},{id:'b',type:'anime-library',schemaVersion:2},{id:'c',type:'manga-library',schemaVersion:2},{id:'d',type:'aired-recently',schemaVersion:1}],lang:'en'}
export const probe:any={writes:[],get state(){return state},update(value:any){state={...state,...value};listeners.forEach(f=>f())}}
;(window as any).customizeProbe=probe
export function useProbeState(){return React.useSyncExternalStore(f=>{listeners.add(f);return()=>listeners.delete(f)},()=>state)}
const idle={mutateAsync:async()=>{},mutate(){},isPending:false}
export function useSaveSettings(){return idle}
export function useSaveTorrentstreamSettings(){return idle}
export function useSaveDebridSettings(){return idle}
// Mirrors the server: the saved list comes back as the dialog's new homeItems prop.
export function useUpdateHomeItems(){return {isPending:false,mutate(value:any,callbacks?:any){probe.writes.push(value);setTimeout(()=>{probe.update({items:value.items});callbacks?.onSuccess?.()},20)}}}
export function useServerStatus(){return {settings:{library:{includeOnlineStreamingInLibrary:true}}}}
export function useThemeSettings(){return {}}
export function useQueryClient(){return {invalidateQueries:async()=>{}}}
let n=0
export function uuidv4(){return `added-${++n}`}
export function useTr(){const s=useProbeState();return (en:string,de:string)=>s.lang==='de'?de:en}
export function toast(){}
toast.success=()=>{};toast.error=()=>{}
