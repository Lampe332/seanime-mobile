import { MobilePluginMenu } from "./mobile-plugin-menu"
import {
    useGetPluginSettings,
    useListDevelopmentModeExtensions,
    useReloadExternalExtension,
} from "@/api/hooks/extensions.hooks"
import { DebugLogEntry } from "@/app/(main)/_features/plugin/tray/plugin-debug-window.tsx"
import { maxDebugLogs } from "@/app/(main)/_features/plugin/tray/plugin-debug-window.tsx"
import { PluginDebugWindow } from "@/app/(main)/_features/plugin/tray/plugin-debug-window.tsx"
import { useWebsocketMessageListener } from "@/app/(main)/_hooks/handle-websockets"
import { useServerDisabledFeatures } from "@/app/(main)/_hooks/use-server-status"
import type { TrayIcon } from "@/app/(main)/_features/plugin/tray/plugin-tray"
import { WSEvents } from "@/lib/server/ws-events"
import { useAtom } from "jotai/react"
import { atom } from "jotai/vanilla"
import React from "react"
import {
    usePluginListenDebugClearEvent,
    usePluginListenDebugLogEvent,
    usePluginListenTrayBadgeUpdatedEvent,
    usePluginListenTrayIconEvent,
    usePluginSendListTrayIconsEvent,
} from "../generated/plugin-events"

const __plugin_trayIconsAtom = atom<TrayIcon[]>([])

export const __plugin_unpinnedTrayIconClickedAtom = atom<TrayIcon | null>(null)

export const __plugin_openedTrayPlugin = atom<string | null>(null)

export function PluginSidebarTray() {
    const { isFeatureDisabled } = useServerDisabledFeatures()
    const [trayIcons, setTrayIcons] = useAtom(__plugin_trayIconsAtom)

    const { data: pluginSettings } = useGetPluginSettings()

    /**
     * 1. Send a request to the server to list all tray icons
     * 2. Receive the tray icons from the server
     * 3. Set the tray icons in the state to display them
     */
    const { sendListTrayIconsEvent } = usePluginSendListTrayIconsEvent()

    React.useEffect(() => {
        // Send a request to all plugins to list their tray icons.
        // Only plugins with a registered tray icon will respond.
        sendListTrayIconsEvent({}, "")
    }, [])

    /**
     * TODO: Listen to other events from Extension Repository to refetch tray icons
     * - When an extension is loaded
     * - When an extension is unloaded
     * - When an extension is updated
     */

    usePluginListenTrayIconEvent((data, extensionId) => {
        setTrayIcons(prev => {
            const oldTrayIcons = prev.filter(icon => icon.extensionId !== extensionId)
            return [...oldTrayIcons, {
                ...data,
            }].sort((a, b) => a.extensionId.localeCompare(b.extensionId, undefined, { numeric: true }))
        })
    }, "")

    usePluginListenTrayBadgeUpdatedEvent((data, extensionId) => {
        if (!extensionId) return

        setTrayIcons(prev => {
            let changed = false
            const next = prev.map(trayIcon => {
                if (trayIcon.extensionId !== extensionId) return trayIcon
                if (trayIcon.badgeNumber === data.badgeNumber && trayIcon.badgeIntent === data.badgeIntent) return trayIcon

                changed = true
                return {
                    ...trayIcon,
                    badgeNumber: data.badgeNumber,
                    badgeIntent: data.badgeIntent,
                }
            })

            return changed ? next : prev
        })
    }, "")

    // End

    const { data: developmentModeExtensions, refetch } = useListDevelopmentModeExtensions()
    const { mutate: reloadExternalExtension, isPending: isReloadingExtension } = useReloadExternalExtension()

    const [debugLogs, setDebugLogs] = React.useState<Record<string, DebugLogEntry[]>>({})
    const [openDebugWindows, setOpenDebugWindows] = React.useState<string[]>([])
    const debugLogId = React.useRef(0)

    const debugCounts = React.useMemo(() => {
        return Object.fromEntries(Object.entries(debugLogs).map(([extensionId, logs]) => [extensionId, logs.length]))
    }, [debugLogs])

    const openDebugWindow = React.useCallback((extensionId: string) => {
        setOpenDebugWindows(prev => prev.includes(extensionId) ? prev : [...prev, extensionId])
    }, [])

    const closeDebugWindow = React.useCallback((extensionId: string) => {
        setOpenDebugWindows(prev => prev.filter(id => id !== extensionId))
    }, [])

    const clearDebugLogs = React.useCallback((extensionId: string) => {
        setDebugLogs(prev => ({ ...prev, [extensionId]: [] }))
    }, [])

    usePluginListenDebugLogEvent((payload, extensionId) => {
        setDebugLogs(prev => {
            const nextLog = { ...payload, id: ++debugLogId.current, extensionId }
            return {
                ...prev,
                [extensionId]: [...(prev[extensionId] || []), nextLog].slice(-maxDebugLogs),
            }
        })
    }, "")

    usePluginListenDebugClearEvent((_, extensionId) => {
        clearDebugLogs(extensionId)
    }, "")

    useWebsocketMessageListener({
        type: WSEvents.PLUGIN_UNLOADED,
        onMessage: (extensionId) => {
            const id = String(extensionId || "")
            if (!id) return
            setTrayIcons(prev => prev.filter(icon => icon.extensionId !== id))
            setDebugLogs(prev => ({ ...prev, [id]: [] }))
            setOpenDebugWindows(prev => prev.filter(openId => openId !== id))
            setTimeout(() => {
                refetch()
            }, 1000)
        },
    })

    if (isFeatureDisabled("PluginTray")) return null

    return (
        <>
            <MobilePluginMenu icons={trayIcons} settings={pluginSettings}
                developmentModeExtensions={developmentModeExtensions || []} debugCounts={debugCounts} openDebugWindow={openDebugWindow}
                reloadExternalExtension={reloadExternalExtension} isReloadingExtension={isReloadingExtension} />
            {openDebugWindows.map((extensionId, index) => {
                const extension = developmentModeExtensions?.find(extension => extension.id === extensionId)
                return <PluginDebugWindow
                    key={extensionId}
                    extensionId={extensionId}
                    extensionName={extension?.name}
                    logs={debugLogs[extensionId] || []}
                    index={index}
                    onClear={() => clearDebugLogs(extensionId)}
                    onClose={() => closeDebugWindow(extensionId)}
                />
            })}
        </>
    )
}
