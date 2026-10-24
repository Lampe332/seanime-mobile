import { PluginProvider, registry, RenderPluginComponents } from "@/app/(main)/_features/plugin/components/registry"
import { useIsMainTabRef } from "@/app/websocket-provider"
import { MobileWorkspace } from "@/components/shared/mobile-workspace"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { useAtom } from "jotai"
import React from "react"
import { ErrorBoundary } from "react-error-boundary"
import { useTr } from "@/lib/app-language"
import "../components/mobile-plugin-adapters.css"
import {
    Plugin_Server_TrayIconEventPayload,
    usePluginListenTrayCloseEvent,
    usePluginListenTrayOpenEvent,
    usePluginListenTrayUpdatedEvent,
    usePluginSendRenderTrayEvent,
    usePluginSendTrayClickedEvent,
    usePluginSendTrayClosedEvent,
    usePluginSendTrayOpenedEvent,
} from "../generated/plugin-events"
import { __plugin_openedTrayPlugin, __plugin_unpinnedTrayIconClickedAtom } from "./plugin-sidebar-tray"

/**
 * TrayIcon
 */
export type TrayIcon = Plugin_Server_TrayIconEventPayload

type TrayPluginProps = {
    trayIcon: TrayIcon
}

export const PluginTrayContext = React.createContext<TrayPluginProps>({
    trayIcon: {
        extensionId: "",
        extensionName: "",
        iconUrl: "",
        withContent: false,
        isDrawer: false,
        tooltipText: "",
        badgeNumber: 0,
        badgeIntent: "info",
        width: "30rem",
        minHeight: "auto",
    },
})

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export function usePluginTray() {
    return React.useContext(PluginTrayContext)
}

export function PluginTray(props: TrayPluginProps) {

    const [open, setOpen] = React.useState(false)
    // Listen before opening: a click handler may render synchronously, before the
    // workspace mounts its children. Keep the latest server tree on the tray.
    const [data, setData] = React.useState<any>(null)
    usePluginListenTrayUpdatedEvent(setData, props.trayIcon.extensionId)

    const { sendTrayOpenedEvent } = usePluginSendTrayOpenedEvent()
    const { sendTrayClosedEvent } = usePluginSendTrayClosedEvent()
    const { sendTrayClickedEvent } = usePluginSendTrayClickedEvent()

    const isMainTabRef = useIsMainTabRef()


    const [unpinnedTrayIconClicked, setUnpinnedTrayIconClicked] = useAtom(__plugin_unpinnedTrayIconClickedAtom)
    const [openedTrayPlugin, setOpenedTrayPlugin] = useAtom(__plugin_openedTrayPlugin)

    const firstRender = React.useRef(true)
    React.useEffect(() => {
        if (firstRender.current) {
            firstRender.current = false
            return
        }
        if (open) {
            sendTrayOpenedEvent({}, props.trayIcon.extensionId)
        } else {
            sendTrayClosedEvent({}, props.trayIcon.extensionId)
        }
    }, [open])

    // Handle unpinned tray icon click to open the tray
    const unpinnedTrayIconClickedOpenedRef = React.useRef(false)
    React.useEffect(() => {
        if (unpinnedTrayIconClicked?.extensionId === props.trayIcon.extensionId) {
            sendTrayClickedEvent({}, props.trayIcon.extensionId)
            setOpenedTrayPlugin(props.trayIcon.extensionId)
            if (!unpinnedTrayIconClickedOpenedRef.current) {
                const timeout = setTimeout(() => {
                    setOpen(true)
                    unpinnedTrayIconClickedOpenedRef.current = true
                }, 100)
                return () => clearTimeout(timeout)
            }
        }
    }, [unpinnedTrayIconClicked])

    // Reset unpinned tray icon click state when closing the tray
    React.useEffect(() => {
        if (unpinnedTrayIconClicked?.extensionId === props.trayIcon.extensionId && !open && unpinnedTrayIconClickedOpenedRef.current) {
            setUnpinnedTrayIconClicked(null)
            unpinnedTrayIconClickedOpenedRef.current = false
        }
    }, [open])

    usePluginListenTrayOpenEvent((data) => {
        if (!isMainTabRef.current) return
        setOpen(true)
    }, props.trayIcon.extensionId)

    usePluginListenTrayCloseEvent((data) => {
        if (!isMainTabRef.current) return
        setOpen(false)
    }, props.trayIcon.extensionId)

    React.useEffect(() => {
        if (open) setOpenedTrayPlugin(props.trayIcon.extensionId)
    }, [open, props.trayIcon.extensionId])

    React.useLayoutEffect(() => {
        if (openedTrayPlugin !== props.trayIcon.extensionId) setOpen(false)
    }, [openedTrayPlugin, props.trayIcon.extensionId])

    // The plugin menu draws the icons; a tray without content only reports the click.
    if (!props.trayIcon.withContent) return null

    return (
        <MobileWorkspace
            open={open && openedTrayPlugin === props.trayIcon.extensionId}
            onOpenChange={setOpen}
            title={<span className="flex min-w-0 items-center gap-2">{props.trayIcon.iconUrl && <img loading="lazy" decoding="async" src={props.trayIcon.iconUrl} alt="" className="size-7 shrink-0 rounded-lg object-contain" />}<span className="min-w-0 break-words">{props.trayIcon.extensionName}</span></span>}
        >
            <div data-plugin-tray-popover-content={props.trayIcon.extensionId} className="mobile-plugin-runtime">
                <PluginTrayContext.Provider value={props}>
                    <PluginTrayContent open={open} data={data} trayIcon={props.trayIcon} />
                </PluginTrayContext.Provider>
            </div>
        </MobileWorkspace>
    )
}

type PluginTrayContentProps = {
    data: any
    open: boolean
} & TrayPluginProps

function PluginTrayContent(props: PluginTrayContentProps) {
    const {
        trayIcon,
        open,
        data,
    } = props

    const { sendRenderTrayEvent } = usePluginSendRenderTrayEvent()
    const tr = useTr()

    React.useEffect(() => {
        if (open) {
            sendRenderTrayEvent({}, trayIcon.extensionId)
        }
    }, [open])

    return (
        <div>
            <div className="min-w-0">

                <PluginProvider registry={registry}>
                    <ErrorBoundary resetKeys={[open, trayIcon.extensionId]} fallbackRender={({ error, resetErrorBoundary }) =>
                        <div role="alert" className="space-y-3 rounded-xl border border-red-400/20 bg-red-400/5 p-3">
                            <p>{tr("This plugin could not be displayed.", "Dieses Plugin konnte nicht angezeigt werden.")}</p>
                            <p className="break-words text-sm text-[--muted]">{error instanceof Error ? error.message : String(error)}</p>
                            <button type="button" className="plugin-runtime-button rounded-lg bg-[--subtle] px-3" onClick={() => { resetErrorBoundary(); sendRenderTrayEvent({}, trayIcon.extensionId) }}>{tr("Try again", "Erneut versuchen")}</button>
                        </div>}>
                        {!!data && data.components ? <RenderPluginComponents data={data.components} /> : <div role="status" aria-label={tr("Loading plugin", "Plugin wird geladen")}><LoadingSpinner /></div>}
                    </ErrorBoundary>
                </PluginProvider>

            </div>
        </div>
    )
}
