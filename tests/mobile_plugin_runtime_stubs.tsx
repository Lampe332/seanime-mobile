// Controlled transport boundaries; production renderer and Radix components stay real.
import React from "react"
import { atom } from "jotai"
export const __plugin_openedTrayPlugin = atom<string | null>(null)
export const __plugin_unpinnedTrayIconClickedAtom = atom<any>(null)
const callbacks = new Map<string, Set<Function>>()
export const probe: any = { events: [], tree: null, emit(type: string, payload: any = {}) { callbacks.get(type)?.forEach(cb => cb(payload)) } }
;(window as any).runtimeProbe = probe
function listen(type: string, cb: Function) { React.useEffect(() => { const set = callbacks.get(type) || new Set(); set.add(cb); callbacks.set(type, set); return () => { set.delete(cb) } }, [cb]) }
function sender(type: string) { return (payload: any, id: string) => { probe.events.push({ type, payload, id }); if (type === "render" && probe.tree) probe.emit("updated", { components: probe.tree }) } }
export function usePluginListenTrayUpdatedEvent(cb: Function) { listen("updated", cb) }
export function usePluginListenTrayBadgeUpdatedEvent(cb: Function) { listen("badge", cb) }
export function usePluginListenTrayOpenEvent(cb: Function) { listen("open", cb) }
export function usePluginListenTrayCloseEvent(cb: Function) { listen("close", cb) }
export function usePluginListenFieldRefSetValueEvent(cb: Function) { listen("field", cb) }
export function usePluginListenFormResetEvent(cb: Function) { listen("form-reset", cb) }
export function usePluginListenFormSetValuesEvent(cb: Function) { listen("form-values", cb) }
export function usePluginSendRenderTrayEvent() { return { sendRenderTrayEvent: sender("render") } }
export function usePluginSendTrayClickedEvent() { return { sendTrayClickedEvent: sender("clicked") } }
export function usePluginSendTrayOpenedEvent() { return { sendTrayOpenedEvent: sender("opened") } }
export function usePluginSendTrayClosedEvent() { return { sendTrayClosedEvent: sender("closed") } }
export function usePluginSendEventHandlerTriggeredEvent() { return { sendEventHandlerTriggeredEvent: sender("handler") } }
export function usePluginSendFieldRefSendValueEvent() { return { sendFieldRefSendValueEvent: sender("field-value") } }
export function usePluginSendFormSubmittedEvent() { return { sendFormSubmittedEvent: sender("form-submit") } }
export function useIsMainTabRef() { return React.useRef(true) }
export function useWebsocketSender() { return { sendPluginMessage: sender("message") } }
export function useTr() { return (en: string) => en }
export const appLanguageAtom = atom<"en" | "de">("en")
export function tr(en: string) { return en }
export function useServerStatus() { return { data: {} } }
export function SeaImage({ src, alt }: any) { return <img src={src} alt={alt} /> }

export function usePluginListenModalUpdatedEvent(cb:Function) { listen("modal",cb) }
export function usePluginSendModalClosedEvent() { return {sendModalClosedEvent:sender("modal-closed")} }
export function usePluginListenCommandPaletteCloseEvent(cb:Function) { listen("command-close",cb) }
export function usePluginListenCommandPaletteGetInputEvent(cb:Function) { listen("command-get",cb) }
export function usePluginListenCommandPaletteOpenEvent(cb:Function) { listen("command-open",cb) }
export function usePluginListenCommandPaletteSetInputEvent(cb:Function) { listen("command-input",cb) }
export function usePluginListenCommandPaletteUpdatedEvent(cb:Function) { listen("command-updated",cb) }
export function usePluginSendCommandPaletteClosedEvent(){return {sendCommandPaletteClosedEvent:sender("command-closed")}}
export function usePluginSendCommandPaletteInputEvent(){return {sendCommandPaletteInputEvent:sender("command-input-value")}}
export function usePluginSendCommandPaletteItemSelectedEvent(){return {sendCommandPaletteItemSelectedEvent:sender("command-selected")}}
export function usePluginSendCommandPaletteOpenedEvent(){return {sendCommandPaletteOpenedEvent:sender("command-opened")}}
export function usePluginSendRenderCommandPaletteEvent(){return {sendRenderCommandPaletteEvent:sender("command-render")}}
export function useRouter(){return {push(){}}}
export function usePathname(){return "/"}
