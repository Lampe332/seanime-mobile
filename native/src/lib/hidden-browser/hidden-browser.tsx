// geschrieben nach: docs/EIGENER-KERN.md §4k und öffentlicher Doku von react-native-webview 14 (source, userAgent, injectJavaScript, onMessage, onLoadStart/onLoadEnd/onError, onShouldStartLoadWithRequest, sharedCookiesEnabled, thirdPartyCookiesEnabled, setSupportMultipleWindows, mediaPlaybackRequiresUserAction); keine Vorlage
import type { HiddenBrowser, HiddenPage } from "@/core"
import React from "react"
import { View } from "react-native"
import { WebView, type WebViewProps } from "react-native-webview"
import { evaluateScript, pageAnswer } from "./page-script"

/*
 * The app's hidden browser: one WebView nobody sees, which the core steers for extensions (`ChromeDP` and the way past
 * Cloudflare's automatic check, docs/EIGENER-KERN.md §4k). The core knows no screen, so the WebView lives here and the
 * core gets `hiddenBrowser`, three things a page can do: load an address, run JavaScript, be thrown away.
 *
 * `HiddenBrowserHost` is mounted once at the root, under everything. It renders nothing until a page is asked for; the
 * WebView then lies beneath the app's screens, fully transparent, takes no touches and no part in the layout, and is
 * unmounted (the page with everything in it gone) when the page is closed. Cookies stay: the WebView and the app's
 * network share one cookie store, which is how a passed check of Cloudflare reaches the app's requests.
 *
 * The page gets nothing of the app: no address of the server, no token, no object but the message bridge. It may load
 * http and https only, opens no windows, starts no other app and plays no media by itself.
 */

// The package types its props as `WebViewProps & P` with P = undefined, which TypeScript 6 reduces to never
type WebViewInstance = WebView<object>
const PageWebView = WebView as unknown as React.ComponentType<WebViewProps & React.RefAttributes<WebViewInstance>>

type Shown = { key: number, uri: string, userAgent?: string }
type Waiting<Value> = { resolve: (value: Value) => void, reject: (error: Error) => void }

// There is one hidden page in the app: the mounted host, its WebView and who waits for it
let show: ((page: Shown | null) => void) | null = null
let view: WebViewInstance | null = null
let loading: Waiting<void> | null = null
const asked = new Map<string, Waiting<unknown> & { code: string }>()
let pages = 0
let questions = 0

function dropAsked(reason: string) {
    for (const waiting of asked.values()) waiting.reject(new Error(reason))
    asked.clear()
}

function dropWaiting(reason: string) {
    loading?.reject(new Error(reason))
    loading = null
    dropAsked(reason)
}

export const hiddenBrowser: HiddenBrowser = {
    open: async ({ userAgent }) => {
        const mount = show
        if (!mount) throw new Error("the hidden browser is not there")
        const key = ++pages
        let shown = false
        let closed = false
        const page: HiddenPage = {
            navigate: url => new Promise<void>((resolve, reject) => {
                if (closed) {
                    reject(new Error("the page is closed"))
                    return
                }
                dropWaiting("the page went to another address")
                loading = { resolve, reject }
                if (shown) {
                    view?.injectJavaScript(`window.location.assign(${JSON.stringify(url)}); true;`)
                    return
                }
                shown = true
                mount({ key, uri: url, userAgent })
            }),
            evaluate: code => new Promise<unknown>((resolve, reject) => {
                if (closed || !shown || !view) {
                    reject(new Error("no page is loaded"))
                    return
                }
                const id = `${key}-${++questions}-${Math.random().toString(36).slice(2)}`
                asked.set(id, { resolve, reject, code })
                view.injectJavaScript(evaluateScript(id, code, false))
            }),
            close: async () => {
                if (closed) return
                closed = true
                dropWaiting("the page is closed")
                if (shown) mount(null)
            },
        }
        return page
    },
}

function onAnswer(data: string) {
    const answer = pageAnswer(data)
    const waiting = answer ? asked.get(answer.id) : undefined
    if (!answer || !waiting) return
    if (!answer.ok && "blocked" in answer) {
        // the page forbids eval: the same question again, written into the script as an expression
        view?.injectJavaScript(evaluateScript(answer.id, waiting.code, true))
        return
    }
    asked.delete(answer.id)
    if (answer.ok) waiting.resolve(answer.value)
    else waiting.reject(new Error(answer.error))
}

export function HiddenBrowserHost() {
    const [page, setPage] = React.useState<Shown | null>(null)

    React.useEffect(() => {
        show = setPage
        return () => {
            show = null
            dropWaiting("the hidden browser is gone")
        }
    }, [])

    if (!page) return null

    return (
        <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{ position: "absolute", left: 0, top: 0, width: 360, height: 640, opacity: 0, pointerEvents: "none" }}
        >
            <PageWebView
                key={page.key}
                ref={instance => {
                    view = instance
                }}
                source={{ uri: page.uri }}
                userAgent={page.userAgent}
                style={{ flex: 1, backgroundColor: "transparent" }}
                onMessage={event => onAnswer(event.nativeEvent.data)}
                // a question asked of the page before is lost with it
                onLoadStart={() => dropAsked("the page went to another address")}
                onLoadEnd={() => {
                    loading?.resolve()
                    loading = null
                }}
                onError={event => {
                    loading?.reject(new Error(event.nativeEvent.description || "the page could not be loaded"))
                    loading = null
                }}
                onRenderProcessGone={() => dropWaiting("the page's process ended")}
                onContentProcessDidTerminate={() => dropWaiting("the page's process ended")}
                // "*" keeps every URL away from Linking.openURL; the next line lets the page load the web and nothing else
                originWhitelist={["*"]}
                onShouldStartLoadWithRequest={request => /^(?:https?|about|data|blob):/i.test(request.url)}
                javaScriptEnabled
                domStorageEnabled
                javaScriptCanOpenWindowsAutomatically={false}
                setSupportMultipleWindows={false}
                // the cookie of a passed check must reach the app's network, and the check runs in a frame of its own
                sharedCookiesEnabled
                thirdPartyCookiesEnabled
                mediaPlaybackRequiresUserAction
                allowsInlineMediaPlayback
                // a page may not save files on the device (prop added by patches/react-native-webview+14.0.1.patch)
                downloadsDisabled
                allowFileAccess={false}
                allowFileAccessFromFileURLs={false}
                allowUniversalAccessFromFileURLs={false}
                geolocationEnabled={false}
                mediaCapturePermissionGrantType="deny"
                saveFormDataDisabled
                webviewDebuggingEnabled={false}
                textZoom={100}
            />
        </View>
    )
}
