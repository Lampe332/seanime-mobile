import type { TrayIcon } from "./plugin-events"

/*
 * The plugin UI's rules without React (web _features/plugin/*): merging what each plugin reports, the tray's pins, the
 * page buttons' symbols, select values, the plugin styles a native view can take, the plugin HTML's bridge and its
 * messages, and the paths a plugin may open.
 */

/** Items in plugin order (web sortItems: extension ID, numbers by value) */
export function sortByExtension<T extends { extensionId: string }>(items: T[]) {
    return [...items].sort((a, b) => a.extensionId.localeCompare(b.extensionId, undefined, { numeric: true }))
}

/**
 * One plugin's new list replaces its old one, the others stay (every `action:*:updated`). `keep` filters the incoming
 * items (a media card takes only its kind, an episode menu only its type).
 */
export function replaceExtensionItems<T extends { extensionId: string }>(prev: T[], extensionId: string, incoming: Record<string, unknown>[] | undefined,
    keep: (item: Record<string, unknown>) => boolean = () => true): T[] {
    const others = prev.filter(item => item.extensionId !== extensionId)
    const mine = (incoming ?? []).filter(keep).map(item => ({ ...item, extensionId }) as unknown as T)
    return sortByExtension([...others, ...mine])
}

/** A media card's items for its kind (`for` anime/manga/both, plugin-actions.tsx PluginMediaCardContextMenuItems) */
export const forMediaKind = (kind: "anime" | "manga") => (item: { for?: string }) => item.for === kind || item.for === "both"

/**
 * An episode menu's items for its type (PluginEpisodeGridItemMenuItems `type`: "library", "undownloaded", "onlinestream",
 * "torrentstream", "debridstream"); episode card items without a type show everywhere
 */
export const forEpisodeType = (type: string, typeless = false) => (item: { type?: string }) => item.type === type || (typeless && item.type === undefined)

/** A plugin's tray icon arrives (or comes again): it replaces its old one (plugin-sidebar-tray.tsx) */
export function withTrayIcon(prev: TrayIcon[], icon: TrayIcon, extensionId: string) {
    return sortByExtension([...prev.filter(item => item.extensionId !== extensionId), { ...icon, extensionId: icon.extensionId || extensionId }])
}

/** A tray's badge changed; the same list comes back when nothing changed */
export function withTrayBadge(prev: TrayIcon[], extensionId: string, badge: { badgeNumber: number, badgeIntent: string }) {
    let changed = false
    const next = prev.map(icon => {
        if (icon.extensionId !== extensionId || (icon.badgeNumber === badge.badgeNumber && icon.badgeIntent === badge.badgeIntent)) return icon
        changed = true
        return { ...icon, badgeNumber: badge.badgeNumber, badgeIntent: badge.badgeIntent }
    })
    return changed ? next : prev
}

/** Pinned plugins in pin order, without pins of plugins that are gone (mobile-plugin-menu.tsx) */
export function pinnedTrayIcons(pins: string[], icons: TrayIcon[]) {
    return [...new Set(pins)].flatMap(id => icons.filter(icon => icon.extensionId === id).slice(0, 1))
}

export function togglePin(pins: string[], id: string) {
    return [...new Set(pins.includes(id) ? pins.filter(pin => pin !== id) : [...pins, id])]
}

/** The anime page's round plugin buttons: the name picks a fitting symbol (plugin-actions.tsx) */
export function animeButtonSymbol(name: string): "music" | "order" | "puzzle" {
    return /theme|music|song|opening/i.test(name) ? "music" : /order/i.test(name) ? "order" : "puzzle"
}

/** The manga page's plugin buttons: a calm line icon instead of the plugin's emoji */
export function mangaButtonSymbol(name: string): "link" | "library" | "puzzle" {
    return /mangaupdates|link/i.test(name) ? "link" : /source/i.test(name) ? "library" : "puzzle"
}

/** A button's background image (`url("…")` in its style): the plugin's own icon */
export function backgroundImageUrl(value: unknown) {
    if (typeof value !== "string") return undefined
    const match = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(value)
    return match && /^(https?:|data:image\/)/.test(match[1]) ? match[1] : undefined
}

/** A tray button drawn only by its background image (label empty or a zero-width space): that image, else undefined */
export function pluginIconButton(label: unknown, style: unknown) {
    const text = typeof label === "string" ? label.replace(/[​‌‍﻿]/g, "").trim() : ""
    if (text || !style || typeof style !== "object") return undefined
    return backgroundImageUrl((style as Record<string, unknown>).backgroundImage)
}

/** Radix uses string IDs; plugins may use numeric values and keep values not in the current presets (plugin-select-options.ts) */
export type PluginSelectValue = string | number
export function pluginSelectOptions(options: { label: string, value: PluginSelectValue }[], current: PluginSelectValue | undefined) {
    const mapped = options.map((option, index) => ({ label: option.label, value: `plugin-option-${index}`, original: option.value }))
    let selected = mapped.find(option => Object.is(option.original, current))
    if (!selected && current !== undefined && current !== "") {
        selected = { label: String(current), value: "plugin-current", original: current }
        mapped.unshift(selected)
    }
    return { options: mapped, value: selected?.value, decode: (value: string) => mapped.find(option => option.value === value)?.original }
}

/** A CSS length in dp: px and bare numbers as they are, rem/em at 16, % kept; anything else (calc, vh, var) is dropped */
export function cssLength(value: unknown): number | `${number}%` | undefined {
    if (typeof value === "number") return Number.isFinite(value) ? value : undefined
    if (typeof value !== "string") return undefined
    const match = /^\s*(-?\d*\.?\d+)\s*(px|rem|em|%)?\s*$/.exec(value)
    if (!match) return undefined
    const n = Number(match[1])
    if (match[2] === "%") return `${n}%`
    return match[2] === "rem" || match[2] === "em" ? n * 16 : n
}

const LENGTH_KEYS = new Set(["width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight", "padding", "paddingTop", "paddingBottom", "paddingLeft",
    "paddingRight", "paddingHorizontal", "paddingVertical", "margin", "marginTop", "marginBottom", "marginLeft", "marginRight", "gap", "rowGap", "columnGap",
    "borderRadius", "borderWidth", "top", "left", "right", "bottom", "fontSize", "lineHeight", "flexBasis", "letterSpacing"])
const COLOR_KEYS = new Set(["color", "backgroundColor", "borderColor"])
const ENUM_KEYS: Record<string, string[]> = {
    flexDirection: ["row", "column", "row-reverse", "column-reverse"],
    flexWrap: ["wrap", "nowrap", "wrap-reverse"],
    alignItems: ["flex-start", "flex-end", "center", "stretch", "baseline"],
    alignSelf: ["auto", "flex-start", "flex-end", "center", "stretch", "baseline"],
    alignContent: ["flex-start", "flex-end", "center", "stretch", "space-between", "space-around"],
    justifyContent: ["flex-start", "flex-end", "center", "space-between", "space-around", "space-evenly"],
    textAlign: ["left", "right", "center", "justify"],
    fontStyle: ["normal", "italic"],
    overflow: ["hidden", "visible"],
    display: ["none", "flex"],
    position: ["relative", "absolute"],
}
const CSS_ALIASES: Record<string, string> = { start: "flex-start", end: "flex-end" }

/**
 * The part of a plugin's inline style (web CSSProperties) a native view can take. Unknown or web-only values are left
 * out instead of breaking the layout. A fixed-height scroll box flows instead: the window scrolls, one scroll and no
 * second scrollbar (mobile-plugin-runtime.css).
 */
export function toNativeStyle(style: unknown): Record<string, string | number> {
    if (!style || typeof style !== "object") return {}
    const source = style as Record<string, unknown>
    const out: Record<string, string | number> = {}
    const scrollBox = typeof source.overflow === "string" && /scroll|auto/.test(source.overflow)
        || typeof source.overflowY === "string" && /scroll|auto/.test(source.overflowY)
    for (const [key, raw] of Object.entries(source)) {
        if (scrollBox && (key === "height" || key === "maxHeight")) continue
        if (LENGTH_KEYS.has(key)) {
            if (raw === "auto" && /^(width|height|margin)/.test(key)) out[key] = "auto"
            else {
                const length = cssLength(raw)
                if (length !== undefined) out[key] = length
            }
        } else if (COLOR_KEYS.has(key)) {
            if (typeof raw === "string" && /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|[a-z]+)$/i.test(raw.trim())) out[key] = raw.trim()
        } else if (ENUM_KEYS[key]) {
            const value = typeof raw === "string" ? CSS_ALIASES[raw] ?? raw : undefined
            if (value && ENUM_KEYS[key].includes(value)) out[key] = value
        } else if (key === "opacity" || key === "flex" || key === "flexGrow" || key === "flexShrink" || key === "zIndex") {
            const n = Number(raw)
            if (raw !== "" && Number.isFinite(n)) out[key] = n
        } else if (key === "fontWeight") {
            const value = String(raw)
            if (/^(normal|bold|[1-9]00)$/.test(value)) out[key] = value
        } else if (key === "textDecoration" || key === "textDecorationLine") {
            if (typeof raw === "string" && /underline|line-through/.test(raw)) out.textDecorationLine = raw.includes("underline") ? "underline" : "line-through"
        }
    }
    return out
}

/** Outlined boxes (a plugin's cards) become the kit's raised surfaces; a lone top/bottom line stays a line */
export function pluginBoxLook(className: unknown): "raised" | "line" | null {
    if (typeof className !== "string") return null
    const classes = className.split(/\s+/)
    if (classes.includes("border")) return "raised"
    return classes.includes("border-b") || classes.includes("border-t") ? "line" : null
}

/** Paths a plugin may open (plugin-manager.tsx), limited to the ones the native app has a screen for */
const PLUGIN_PATHS = ["/entry", "/lists", "/search", "/manga", "/settings", "/schedule", "/extensions", "/discover", "/scan-summaries", "/webview"]
export function isAllowedPluginPath(path: unknown): path is string {
    return typeof path === "string" && PLUGIN_PATHS.some(prefix => path === prefix || path.startsWith(prefix + "?") || path.startsWith(prefix + "/"))
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Plugin HTML (plugin-webviews.tsx)
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const WebviewMessageType = {
    SyncState: "plugin-webview-sync",
    Trigger: "plugin-webview-trigger",
    Resize: "plugin-webview-resize",
    RequestContainerWidth: "plugin-webview-request-container-width",
    ContainerWidth: "plugin-webview-container-width",
} as const

export function getWebviewId(extensionId: string, slot: string) {
    return `${extensionId}-${slot}`
}

/** A per-instance value that only checks that a message comes from this page (not an app secret) */
export function generateWebviewToken() {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`
}

/**
 * The `window.webview` API of the web bridge (send, on, requestContainerWidth, resize reports) over react-native-webview's
 * `ReactNativeWebView.postMessage`. Messages to the page arrive as `message` events carrying the token.
 */
function bridgeScript(token: string, webviewId: string) {
    // a JS string inside <script>: "<" escaped, so a "</script>" in a value cannot end the tag
    const literal = (value: string) => JSON.stringify(value).replace(/</g, "\\u003c")
    const T = literal(token)
    const ID = literal(webviewId)
    return `(function(){
var TOKEN=${T};var ID=${ID};
function post(m){m.webviewId=ID;m.token=TOKEN;if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify(m));}
window.webview={
send:function(event,payload){post({type:"${WebviewMessageType.Trigger}",event:event,payload:payload});},
on:function(event,callback){var h=function(e){var d=e.data;if(!d||d.token!==TOKEN)return;
if(d.type==="${WebviewMessageType.SyncState}"&&d.key===event)callback(d.value);
if(d.type==="${WebviewMessageType.ContainerWidth}"&&event==="containerWidth")callback(d.width);};
window.addEventListener("message",h);return function(){window.removeEventListener("message",h);};},
requestContainerWidth:function(){post({type:"${WebviewMessageType.RequestContainerWidth}"});},
_onResizeObserved:function(){post({type:"${WebviewMessageType.Resize}",width:document.body.scrollWidth,height:document.body.scrollHeight});}
};
if(window.ResizeObserver){window.addEventListener("load",function(){var ro=new ResizeObserver(function(){window.webview._onResizeObserved();});if(document.body)ro.observe(document.body);});}
})();`
}

/** The plugin's HTML with the bridge first: into <head>, else <body>, else in front (processUserHtml) */
export function buildWebviewHtml(userHtml: string, token: string, webviewId: string) {
    const tag = `<script>${bridgeScript(token, webviewId)}</script>`
    if (userHtml.includes("<head>")) return userHtml.replace("<head>", `<head>\n${tag}`)
    if (userHtml.includes("<body>")) return userHtml.replace("<body>", `<body>\n${tag}`)
    return tag + userHtml
}

export type WebviewMessage =
    | { type: typeof WebviewMessageType.Trigger, event: string, payload: unknown }
    | { type: typeof WebviewMessageType.Resize, width: number, height: number }
    | { type: typeof WebviewMessageType.RequestContainerWidth }

/** A message from the page, only when it is one of the bridge's and carries this instance's id and token */
export function parseWebviewMessage(raw: string, webviewId: string, token: string): WebviewMessage | null {
    let data: Record<string, unknown>
    try {
        data = JSON.parse(raw) as Record<string, unknown>
    } catch {
        return null
    }
    if (!data || typeof data !== "object" || data.webviewId !== webviewId || data.token !== token) return null
    switch (data.type) {
        case WebviewMessageType.Trigger:
            return typeof data.event === "string" ? { type: data.type, event: data.event, payload: data.payload ?? {} } : null
        case WebviewMessageType.Resize:
            return typeof data.height === "number" && typeof data.width === "number" ? { type: data.type, width: data.width, height: data.height } : null
        case WebviewMessageType.RequestContainerWidth:
            return { type: data.type }
        default:
            return null
    }
}

/** The script that hands a message to the page (as the web's `contentWindow.postMessage`) */
export function deliverToWebviewScript(data: Record<string, unknown>) {
    return `window.dispatchEvent(new MessageEvent("message",{data:${JSON.stringify(data)}}));true;`
}

/** Only the plugin's own page loads in the WebView: no navigation, no links that leave it */
export function isWebviewDocumentLoad(url: string) {
    return url === "about:blank" || url.startsWith("data:")
}
