import { WSEvents } from "@/lib/server/ws-events"
import { useWebsocketMessageListener } from "@/main/_hooks/handle-websockets"
import { useLocalSearchParams } from "expo-router"
import React from "react"
import { StyleSheet, useWindowDimensions, View } from "react-native"
import { WebView, type WebViewMessageEvent, type WebViewProps } from "react-native-webview"
import { PluginClientEvents, PluginServerEvents, type PluginWebviewIframePayload, type PluginWebviewOptions, usePluginListen, usePluginSend } from "./plugin-events"
import {
    buildWebviewHtml, cssLength, deliverToWebviewScript, generateWebviewToken, getWebviewId, isWebviewDocumentLoad, parseWebviewMessage,
    toNativeStyle, WebviewMessageType,
} from "./plugin-logic"

/*
 * Plugin HTML (web webview/plugin-webviews.tsx): the only WebView of the app (docs §2.8). A plugin sends its page for a
 * slot (`webview:iframe`); the slot shows it in react-native-webview, sandboxed like the web's iframe
 * (`sandbox="allow-scripts allow-forms"`, credentialless):
 *   - only the plugin's own page loads: every navigation is refused, links never leave for the browser (originWhitelist
 *     "*" so nothing goes to Linking, onShouldStartLoadWithRequest refuses all but the page itself)
 *   - no storage, cookies, cache, files, windows, location, camera/microphone or debugging; incognito
 *   - the page gets nothing from the app but its own state syncs: no server address, no token, no injected app object.
 *     It talks through `window.webview` (the web bridge's API) and only its own messages (this page's id + a random
 *     per-instance value) are taken; `send` goes to its plugin as `webview:post-message`.
 * Not here: dragging the "fixed" window (a desktop window move), docs §9.
 */
type Webview = { webviewId: string, extensionId: string, slot: string, html: string, token: string, options: PluginWebviewOptions }

// The package types its props as `WebViewProps & P` with P = undefined, which TypeScript 6 reduces to never
type WebViewInstance = WebView<object>
const PluginWebView = WebView as unknown as React.ComponentType<WebViewProps & React.RefAttributes<WebViewInstance>>

export function PluginWebviewSlot({ slot }: { slot: string }) {
    const send = usePluginSend()
    const params = useLocalSearchParams<{ id?: string }>()
    const screenExtensionId = slot === "screen" ? params.id : undefined
    const [webviews, setWebviews] = React.useState<Map<string, Webview>>(() => new Map())
    const frames = React.useRef(new Map<string, { inject: (script: string) => void }>())

    // the slot tells the plugins it is there (again for the screen slot when it shows another plugin)
    React.useEffect(() => {
        if (slot === "screen" && !screenExtensionId) return
        send(PluginClientEvents.WebviewMounted, { slot }, "")
        return () => {
            send(PluginClientEvents.WebviewUnmounted, { slot }, "")
            // the next plugin's page starts without this one's
            setWebviews(new Map())
        }
    }, [send, slot, screenExtensionId])

    const remove = React.useCallback((match: (webview: Webview) => boolean) => setWebviews(prev => {
        const next = new Map([...prev].filter(([, webview]) => !match(webview)))
        return next.size === prev.size ? prev : next
    }), [])

    usePluginListen<PluginWebviewIframePayload>(PluginServerEvents.WebviewIframe, "", (payload, extensionId) => {
        if (payload.slot !== slot) return
        if (slot === "screen" && extensionId !== screenExtensionId) return
        const webviewId = getWebviewId(extensionId, slot)
        const token = generateWebviewToken()
        setWebviews(prev => new Map(prev).set(webviewId, {
            webviewId, extensionId, slot, token, options: payload.options ?? {}, html: buildWebviewHtml(payload.content ?? "", token, webviewId),
        }))
    })

    // state the plugin syncs into its page (webview.channel.sync / send)
    usePluginListen<{ webviewId: string, key: string, value: unknown }>(PluginServerEvents.WebviewSyncState, "", payload => {
        const webview = webviews.get(payload.webviewId)
        if (!webview) return
        frames.current.get(webview.webviewId)?.inject(deliverToWebviewScript({ type: WebviewMessageType.SyncState, key: payload.key, value: payload.value, token: webview.token }))
    })
    usePluginListen<{ webviewId: string }>(PluginServerEvents.WebviewClose, "", payload => remove(webview => webview.webviewId === payload.webviewId))
    useWebsocketMessageListener<string>({
        type: WSEvents.PLUGIN_UNLOADED,
        onMessage: extensionId => remove(webview => webview.extensionId === extensionId),
    })

    return <>
        {[...webviews.values()].map(webview => <PluginWebviewFrame key={`${webview.webviewId}:${webview.token}`} webview={webview}
            register={inject => {
                if (inject) frames.current.set(webview.webviewId, { inject })
                else frames.current.delete(webview.webviewId)
            }} />)}
    </>
}

/** The plugin's `options.style` string ("height: 200px; border-radius: 1rem") as an object */
function parseStyleString(style: string | undefined) {
    const out: Record<string, string> = {}
    for (const rule of (style ?? "").split(";")) {
        const [key, value] = rule.split(":").map(part => part?.trim())
        if (key && value) out[key.replace(/-([a-z])/g, g => g[1].toUpperCase())] = value
    }
    return out
}

function PluginWebviewFrame({ webview, register }: { webview: Webview, register: (inject: ((script: string) => void) | null) => void }) {
    const send = usePluginSend()
    const window = useWindowDimensions()
    const ref = React.useRef<WebViewInstance>(null)
    const [containerWidth, setContainerWidth] = React.useState(0)
    const [content, setContent] = React.useState<{ width: number, height: number } | null>(null)
    const { options, slot, extensionId } = webview

    React.useEffect(() => {
        register(script => ref.current?.injectJavaScript(script))
        return () => register(null)
    }, [register])

    if (options.hidden) return null

    const onMessage = (event: WebViewMessageEvent) => {
        const message = parseWebviewMessage(event.nativeEvent.data, webview.webviewId, webview.token)
        if (!message) return
        if (message.type === WebviewMessageType.Resize) {
            if (options.autoHeight) setContent({ width: message.width, height: message.height })
        } else if (message.type === WebviewMessageType.RequestContainerWidth) {
            ref.current?.injectJavaScript(deliverToWebviewScript({ type: WebviewMessageType.ContainerWidth, width: containerWidth || window.width, token: webview.token }))
        } else {
            send(PluginClientEvents.WebviewPostMessage, { slot, eventName: message.event, event: message.payload }, extensionId)
        }
    }

    const custom = toNativeStyle(parseStyleString(options.style))
    const width = options.fullWidth ? "100%" : cssLength(options.width) ?? (options.autoHeight && content ? content.width : "100%")
    const height = cssLength(options.height) ?? (options.autoHeight && content ? content.height : 150)
    const fixed = slot === "fixed"
    const frame = fixed && !options.window?.frameless
    const position = fixed ? fixedPosition(options, window, typeof width === "number" ? width : window.width, typeof height === "number" ? height : 150) : null

    return (
        <View onLayout={event => setContainerWidth(event.nativeEvent.layout.width)}
            style={[fixed ? { position: "absolute", zIndex: options.zIndex || 100, ...position } : { width: "100%" }]}>
            <View style={[{ width, height, maxWidth: cssLength(options.maxWidth) ?? "100%", maxHeight: cssLength(options.maxHeight) }, custom]}
                className={frame ? "overflow-hidden rounded-[16px] border border-sm-line bg-background" : undefined}>
                <PluginWebView
                    ref={ref}
                    source={{ html: webview.html }}
                    style={[StyleSheet.absoluteFill, { backgroundColor: "transparent" }]}
                    onMessage={onMessage}
                    onLoadEnd={() => send(PluginClientEvents.WebviewLoaded, { slot }, extensionId)}
                    // "*" keeps every URL away from Linking.openURL; the next line refuses every load but the page itself
                    originWhitelist={["*"]}
                    onShouldStartLoadWithRequest={request => isWebviewDocumentLoad(request.url)}
                    javaScriptEnabled
                    javaScriptCanOpenWindowsAutomatically={false}
                    setSupportMultipleWindows={false}
                    domStorageEnabled={false}
                    incognito
                    cacheEnabled={false}
                    thirdPartyCookiesEnabled={false}
                    sharedCookiesEnabled={false}
                    allowFileAccess={false}
                    allowFileAccessFromFileURLs={false}
                    allowUniversalAccessFromFileURLs={false}
                    mixedContentMode="never"
                    geolocationEnabled={false}
                    mediaCapturePermissionGrantType="deny"
                    saveFormDataDisabled
                    webviewDebuggingEnabled={false}
                    textZoom={100}
                />
            </View>
        </View>
    )
}

/** Where a "fixed" plugin window sits: its default corner or its default x/y, inside the window */
function fixedPosition(options: PluginWebviewOptions, window: { width: number, height: number }, width: number, height: number) {
    const padding = 10
    switch (options.window?.defaultPosition) {
        case "top-left":
            return { left: padding, top: padding }
        case "top-right":
            return { left: window.width - width - padding, top: padding }
        case "bottom-left":
            return { left: padding, top: window.height - height - padding }
        case "bottom-right":
            return { left: window.width - width - padding, top: window.height - height - padding }
        default:
            return { left: Math.max(0, Math.min(options.window?.defaultX ?? 0, window.width - width)), top: Math.max(0, Math.min(options.window?.defaultY ?? 0, window.height - height)) }
    }
}
