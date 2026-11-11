import { useWebsocketPluginMessageListener, useWebsocketSender } from "@/main/_hooks/handle-websockets"
import React from "react"

/*
 * The plugin protocol over the app's WebSocket (web _features/plugin/generated/plugin-events.ts, generated from
 * backend/internal/plugin/ui/events.go). Only the events the native app takes part in; the DOM events of the web's
 * dom-manager are not answered (no DOM, docs §9).
 */
export const PluginClientEvents = {
    ModalClosed: "modal:closed",
    RenderTray: "tray:render",
    ListTrayIcons: "tray:list-icons",
    TrayOpened: "tray:opened",
    TrayClosed: "tray:closed",
    TrayClicked: "tray:clicked",
    WebviewSidebarMounted: "webview:sidebar-mounted",
    WebviewMounted: "webview:mounted",
    WebviewLoaded: "webview:loaded",
    WebviewUnmounted: "webview:unmounted",
    WebviewPostMessage: "webview:post-message",
    ActionRenderAnimePageButtons: "action:anime-page-buttons:render",
    ActionRenderAnimePageDropdownItems: "action:anime-page-dropdown-items:render",
    ActionRenderMangaPageButtons: "action:manga-page-buttons:render",
    ActionRenderMangaPageDropdownItems: "action:manga-page-dropdown-items:render",
    ActionRenderMangaLibraryDropdownItems: "action:manga-library-dropdown-items:render",
    ActionRenderAnimeLibraryDropdownItems: "action:anime-library-dropdown-items:render",
    ActionRenderMediaCardContextMenuItems: "action:media-card-context-menu-items:render",
    ActionRenderEpisodeCardContextMenuItems: "action:episode-card-context-menu-items:render",
    ActionRenderEpisodeGridItemMenuItems: "action:episode-grid-item-menu-items:render",
    ActionClicked: "action:clicked",
    FormSubmitted: "form:submitted",
    ScreenChanged: "screen:changed",
    EventHandlerTriggered: "handler:triggered",
    FieldRefSendValue: "field-ref:send-value",
    DOMViewportSize: "dom:viewport-size",
    MarketplaceGetURLResult: "marketplace:get-url-result",
} as const

export const PluginServerEvents = {
    TrayUpdated: "tray:updated",
    TrayIcon: "tray:icon",
    TrayBadgeUpdated: "tray:badge-updated",
    TrayOpen: "tray:open",
    TrayClose: "tray:close",
    ModalUpdated: "modal:updated",
    WebviewIframe: "webview:iframe",
    WebviewSidebar: "webview:sidebar",
    WebviewSyncState: "webview:sync-state",
    WebviewClose: "webview:close",
    ActionRenderAnimePageButtons: "action:anime-page-buttons:updated",
    ActionRenderAnimePageDropdownItems: "action:anime-page-dropdown-items:updated",
    ActionRenderMangaPageButtons: "action:manga-page-buttons:updated",
    ActionRenderMangaPageDropdownItems: "action:manga-page-dropdown-items:updated",
    ActionRenderMangaLibraryDropdownItems: "action:manga-library-dropdown-items:updated",
    ActionRenderAnimeLibraryDropdownItems: "action:anime-library-dropdown-items:updated",
    ActionRenderMediaCardContextMenuItems: "action:media-card-context-menu-items:updated",
    ActionRenderEpisodeCardContextMenuItems: "action:episode-card-context-menu-items:updated",
    ActionRenderEpisodeGridItemMenuItems: "action:episode-grid-item-menu-items:updated",
    FormReset: "form:reset",
    FormSetValues: "form:set-values",
    FieldRefSetValue: "field-ref:set-value",
    ScreenNavigateTo: "screen:navigate-to",
    ScreenReload: "screen:reload",
    ScreenGetCurrent: "screen:get-current",
    DOMGetViewportSize: "dom:get-viewport-size",
    DOMClipboardWrite: "dom:clipboard:write",
    MarketplaceGetURL: "marketplace:get-url",
    MarketplaceSetURL: "marketplace:set-url",
} as const

export type TrayIcon = {
    extensionId: string
    extensionName: string
    iconUrl: string
    withContent: boolean
    tooltipText: string
    badgeNumber: number
    badgeIntent: string
    width: string
    minHeight: string
    isDrawer: boolean
}

export type PluginModalPayload = { action: string, title: string, description: string, className: string, components: unknown }
export type PluginWebviewIframePayload = { slot: string, content: string, id: string, options?: PluginWebviewOptions }
export type PluginWebviewOptions = {
    className?: string, style?: string, width?: string, height?: string, maxWidth?: string, maxHeight?: string, zIndex?: number
    window?: { draggable?: boolean, frameless?: boolean, defaultX?: number, defaultY?: number, defaultPosition?: string }
    autoHeight?: boolean, fullWidth?: boolean, hidden?: boolean
}

/** Sends a plugin event (batched by the socket, as on the web); no extension = every plugin */
export function usePluginSend() {
    const { sendPluginMessage } = useWebsocketSender()
    const latest = React.useRef(sendPluginMessage)
    React.useEffect(() => { latest.current = sendPluginMessage })
    return React.useCallback((type: string, payload: unknown, extensionId?: string) => {
        latest.current(type, payload, extensionId)
    }, [])
}

/** Listens to a plugin event from one extension ("" = all); the callback may change every render */
export function usePluginListen<T>(type: string, extensionId: string, onMessage: (payload: T, extensionId: string) => void) {
    const latest = React.useRef(onMessage)
    React.useEffect(() => { latest.current = onMessage })
    const stable = React.useCallback((payload: T, id: string) => latest.current(payload, id), [])
    useWebsocketPluginMessageListener<T>({ type, extensionId, onMessage: stable })
}
