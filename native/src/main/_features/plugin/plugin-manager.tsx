import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { useListExtensionData } from "@/api/hooks/extensions.hooks"
import { Button } from "@/components/ui/button/button"
import { Dialog, Sheet } from "@/components/ui/sheet/sheet"
import { Muted, Text } from "@/components/ui/text/text"
import { useDebounce } from "@/hooks/use-debounce"
import { useTr } from "@/lib/app-language"
import { copyToClipboard } from "@/lib/helpers/browser"
import { useRouter } from "@/lib/navigation"
import { WSEvents } from "@/lib/server/ws-events"
import { colors } from "@/lib/theme/tokens"
import { useWebsocketMessageListener, useWebsocketSender } from "@/main/_hooks/handle-websockets"
import { marketplaceUrlAtom } from "@/main/extensions/_lib/marketplace.atoms"
import { websocketConnectedAtom } from "@/main/websocket-provider"
import { useQueryClient } from "@tanstack/react-query"
import { useGlobalSearchParams, usePathname } from "expo-router"
import { Image } from "expo-image"
import { atom, getDefaultStore, useAtomValue, useSetAtom } from "jotai"
import Download from "lucide-react-native/icons/download"
import KeyRound from "lucide-react-native/icons/key-round"
import Package from "lucide-react-native/icons/package"
import Settings from "lucide-react-native/icons/settings"
import ShieldCheck from "lucide-react-native/icons/shield-check"
import SquareTerminal from "lucide-react-native/icons/square-terminal"
import React from "react"
import { ScrollView, useWindowDimensions, View } from "react-native"
import { PluginActionsListener } from "./plugin-actions"
import { RenderPluginComponents, PluginScopeContext } from "./plugin-components"
import { PluginClientEvents, type PluginModalPayload, PluginServerEvents, usePluginListen, usePluginSend } from "./plugin-events"
import { isAllowedPluginPath } from "./plugin-logic"
import { PluginBoundary, PluginTrayHost } from "./plugin-tray"
import { PluginWebviewSlot } from "./plugin-webview"

/*
 * The plugins' runtime in the app (web plugin-manager.tsx, plugin-handler.tsx, actions/plugin-action-modal.tsx,
 * webview/plugin-sidebar.tsx, extension-prompt.tsx), once in the main layout:
 *   - the screen: every page change is reported (`screen:changed`), a plugin may open a page that has a native screen
 *   - the clipboard, the marketplace link, the window size
 *   - a plugin's dialog (`modal:updated`) and its Menu entry for a page of its own (`webview:sidebar` → /webview?id=)
 *   - the tray, the action lists, the "fixed" plugin windows
 *   - the extension prompt: a plugin asks before something sensitive (secure mode), Allow / Don't allow
 * The web's dom-manager is not here: plugins that read or change the page's DOM have no DOM in a native app (docs §9).
 */
type SidebarItem = { extensionId: string, label: string }
export const __plugin_sidebarItemsAtom = atom<SidebarItem[]>([])

export function PluginManager() {
    const router = useRouter()
    const pathname = usePathname()
    const params = useGlobalSearchParams()
    const send = usePluginSend()
    const queryClient = useQueryClient()
    const { data: extensions } = useListExtensionData()
    const [unloaded, setUnloaded] = React.useState<string[]>([])
    const setSidebarItems = useSetAtom(__plugin_sidebarItemsAtom)

    const query = React.useMemo(() => {
        const entries = Object.entries(params).filter(([, value]) => value !== undefined)
            .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(Array.isArray(value) ? value.join(",") : String(value))}`)
        return entries.length ? `?${entries.join("&")}` : ""
    }, [params])

    React.useEffect(() => send(PluginClientEvents.ScreenChanged, { pathname, query }, ""), [send, pathname, query])
    usePluginListen(PluginServerEvents.ScreenGetCurrent, "", (_payload, extensionId) => send(PluginClientEvents.ScreenChanged, { pathname, query }, extensionId))
    usePluginListen<{ path: string }>(PluginServerEvents.ScreenNavigateTo, "", event => {
        if (isAllowedPluginPath(event.path)) router.push(event.path)
    })
    usePluginListen(PluginServerEvents.ScreenReload, "", () => void queryClient.invalidateQueries())
    usePluginListen<{ text: string }>(PluginServerEvents.DOMClipboardWrite, "", event => {
        if (typeof event.text === "string") void copyToClipboard(event.text)
    })
    usePluginListen<{ requestId: string }>(PluginServerEvents.MarketplaceGetURL, "", (event, extensionId) =>
        send(PluginClientEvents.MarketplaceGetURLResult, { requestId: event.requestId, url: getDefaultStore().get(marketplaceUrlAtom) }, extensionId))
    usePluginListen<{ url: string }>(PluginServerEvents.MarketplaceSetURL, "", event => {
        getDefaultStore().set(marketplaceUrlAtom, event.url)
        void queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.EXTENSIONS.GetMarketplaceExtensions.key] })
    })

    // the window size (debounced), for plugins that lay out their pages by it
    const window = useWindowDimensions()
    const width = useDebounce(window.width, 400)
    const height = useDebounce(window.height, 400)
    React.useEffect(() => send(PluginClientEvents.DOMViewportSize, { width, height }, ""), [send, width, height])
    usePluginListen(PluginServerEvents.DOMGetViewportSize, "", (_payload, extensionId) => send(PluginClientEvents.DOMViewportSize, { width, height }, extensionId))

    // a plugin's own page in the Menu
    React.useEffect(() => send(PluginClientEvents.WebviewSidebarMounted, {}, ""), [send])
    usePluginListen<{ label: string }>(PluginServerEvents.WebviewSidebar, "", (payload, extensionId) =>
        setSidebarItems(prev => [...prev.filter(item => item.extensionId !== extensionId), { extensionId, label: payload.label }]
            .sort((a, b) => a.extensionId.localeCompare(b.extensionId))))

    useWebsocketMessageListener<string>({
        type: WSEvents.PLUGIN_LOADED,
        onMessage: extensionId => setUnloaded(prev => prev.filter(id => id !== extensionId)),
    })
    useWebsocketMessageListener<string>({
        type: WSEvents.PLUGIN_UNLOADED,
        onMessage: extensionId => {
            setUnloaded(prev => prev.includes(extensionId) ? prev : [...prev, extensionId])
            setSidebarItems(prev => prev.filter(item => item.extensionId !== extensionId))
        },
    })

    return <>
        {extensions?.filter(extension => extension.type === "plugin" && !unloaded.includes(extension.id)).map(extension => (
            <PluginActionModal key={extension.id} extensionId={extension.id} extensionName={extension.name} />
        ))}
        <PluginActionsListener />
        <PluginTrayHost />
        <PluginWebviewSlot slot="fixed" />
        <ExtensionPrompt />
    </>
}

/** A plugin's dialog (ctx.action … modal): opened, updated and closed by the plugin; closing it tells the plugin */
function PluginActionModal({ extensionId, extensionName }: { extensionId: string, extensionName: string }) {
    const t = useTr()
    const send = usePluginSend()
    const [modal, setModal] = React.useState<PluginModalPayload | null>(null)
    usePluginListen<PluginModalPayload>(PluginServerEvents.ModalUpdated, extensionId, event => setModal(prev => {
        if (event.action === "open") return event
        if (event.action === "close") return null
        return prev ? { ...prev, ...event } : null
    }))
    if (!modal) return null
    return (
        <Sheet open title={modal.title || extensionName} description={modal.description || undefined} onOpenChange={open => {
            if (open) return
            setModal(null)
            send(PluginClientEvents.ModalClosed, {}, extensionId)
        }}>
            <PluginScopeContext value={{ extensionId, extensionName }}>
                <PluginBoundary t={t}>
                    <View className="gap-3">{!!modal.components && <RenderPluginComponents data={modal.components} />}</View>
                </PluginBoundary>
            </PluginScopeContext>
        </Sheet>
    )
}

type ExtensionPromptRequest = {
    id: string
    kind: string
    extension: { id: string, name: string, icon?: string }
    action: string
    resource: string
    message: string
    details?: string[]
    allowLabel?: string
    denyLabel?: string
    expired?: boolean
}

const PROMPT_ICONS = { auth: KeyRound, settings: Settings, extensions: Package, system: SquareTerminal, download: Download } as Record<string, typeof ShieldCheck>

/**
 * An extension asks before doing something sensitive (extension-prompt.tsx): one request at a time, in the order they
 * came; an expired one leaves the queue. Closing the dialog (Back, ✕, a tap outside) answers "Don't allow", as closing
 * did on the web (which shook on a tap outside instead, docs §9).
 */
function ExtensionPrompt() {
    const { sendMessage } = useWebsocketSender()
    const connected = useAtomValue(websocketConnectedAtom)
    const [queue, setQueue] = React.useState<ExtensionPromptRequest[]>([])
    const prompt = queue[0]

    useWebsocketMessageListener<ExtensionPromptRequest>({
        type: WSEvents.EXTENSION_PROMPT,
        onMessage: payload => {
            if (!payload?.id) return
            if (payload.expired) return setQueue(prev => prev.filter(item => item.id !== payload.id))
            setQueue(prev => prev.some(item => item.id === payload.id) ? prev : [...prev, payload])
        },
    })
    // requests that were waiting while the socket was away come again
    React.useEffect(() => {
        if (connected) sendMessage({ type: WSEvents.EXTENSION_PROMPT_SYNC, payload: {} })
        // the sender changes with every render; only the connection matters
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [connected])

    if (!prompt) return null
    const respond = (allowed: boolean) => {
        sendMessage({ type: WSEvents.EXTENSION_PROMPT_RESPONSE, payload: { id: prompt.id, allowed } })
        setQueue(prev => prev.slice(1))
    }
    const Icon = PROMPT_ICONS[prompt.kind] ?? ShieldCheck
    const name = prompt.extension?.name || "An extension"
    const title = prompt.message || `Allow the extension "${prompt.extension?.name || "Extension"}" to ${prompt.action}?`
    return (
        <Dialog open title={title} onOpenChange={open => !open && respond(false)}
            footer={<View className="flex-1 gap-3">
                <Button intent="secondary" size="lg" onPress={() => respond(false)}>{prompt.denyLabel || "Don't Allow"}</Button>
                <Button size="lg" onPress={() => respond(true)}>{prompt.allowLabel || "Allow"}</Button>
            </View>}>
            <View className="gap-3">
                <View className="h-16 w-16 items-center justify-center rounded-xl bg-sm-surface-control">
                    <Icon size={32} color={colors.smText} />
                    {!!prompt.extension?.icon && <Image source={prompt.extension.icon} style={{ position: "absolute", right: -8, bottom: -8, width: 28, height: 28, borderRadius: 10 }} />}
                </View>
                <Muted>{name} would like to perform the following action{prompt.resource ? ` on "${prompt.resource}"` : ""}.</Muted>
                {!!prompt.details?.length && <ScrollView style={{ maxHeight: 128 }} className="rounded-xl bg-sm-surface-raised p-3">
                    {prompt.details.map(detail => <Text selectable key={detail} className="text-sm">{detail}</Text>)}
                </ScrollView>}
            </View>
        </Dialog>
    )
}
