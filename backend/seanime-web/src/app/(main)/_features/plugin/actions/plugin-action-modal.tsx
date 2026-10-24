import { PluginProvider, registry, RenderPluginComponents } from "@/app/(main)/_features/plugin/components/registry"
import {
    Plugin_Server_ModalUpdatedEventPayload,
    usePluginListenModalUpdatedEvent,
    usePluginSendModalClosedEvent,
} from "@/app/(main)/_features/plugin/generated/plugin-events"
import { PluginTrayContext, usePluginTray } from "@/app/(main)/_features/plugin/tray/plugin-tray"
import { useIsMainTabRef } from "@/app/websocket-provider"
import { MobileWorkspace } from "@/components/shared/mobile-workspace"
import React from "react"

export function PluginActionModal({ extensionId }: { extensionId: string }) {
    const [modal, setModal] = React.useState<Plugin_Server_ModalUpdatedEventPayload | null>(null)
    const isMainTabRef = useIsMainTabRef()
    const tray = usePluginTray()
    const { sendModalClosedEvent } = usePluginSendModalClosedEvent()

    usePluginListenModalUpdatedEvent(event => {
        if (!isMainTabRef.current) return
        setModal(prev => {
            if (event.action === "open") return event
            if (event.action === "close") return null
            return prev ? { ...prev, ...event } : null
        })
    }, extensionId)

    if (!modal) return null

    return <PluginProvider registry={registry}>
        <PluginTrayContext.Provider value={{ ...tray, trayIcon: { ...tray.trayIcon, extensionId } }}>
            <MobileWorkspace
                open
                title={modal.title}
                className="mobile-plugin-action"
                subtitle={modal.description}
                onOpenChange={open => {
                    if (!open) {
                        setModal(null)
                        sendModalClosedEvent({}, extensionId)
                    }
                }}
            >
                <div className={`mobile-plugin-runtime plugin-runtime-block ${modal.className || ""}`}>
                    {modal.components && <RenderPluginComponents data={modal.components} />}
                </div>
            </MobileWorkspace>
        </PluginTrayContext.Provider>
    </PluginProvider>
}
