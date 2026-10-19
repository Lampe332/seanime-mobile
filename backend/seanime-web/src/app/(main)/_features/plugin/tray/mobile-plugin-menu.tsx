import React from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { useAtomValue, useSetAtom } from "jotai"
import { Extension_Extension, ExtensionRepo_StoredPluginSettingsData } from "@/api/generated/types"
import { useGetPluginSettings, useSetPluginSettingsPinnedTrays } from "@/api/hooks/extensions.hooks"
import { Badge } from "@/components/ui/badge"
import { useTr } from "@/lib/app-language"
import { LuPin, LuPinOff, LuSearch, LuX, LuChevronRight, LuRefreshCw, LuSquareTerminal } from "react-icons/lu"
import { PluginTray, TrayIcon } from "./plugin-tray"
import { __plugin_openedTrayPlugin, __plugin_unpinnedTrayIconClickedAtom } from "./plugin-sidebar-tray"
import { usePluginListenTrayOpenEvent } from "../generated/plugin-events"
import "./mobile-plugin-menu.css"

/** An extension fitting into an open socket, using the existing 24px/2px icon language. */
export function PluginExtensionIcon() {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 3H5a2 2 0 0 0-2 2v4h2a3 3 0 1 1 0 6H3v4a2 2 0 0 0 2 2h4v-2a3 3 0 1 1 6 0v2h4a2 2 0 0 0 2-2v-4" />
        <path d="M16 3v6h6M16 9l6-6" />
    </svg>
}

export function PluginIcon({ icon }: { icon: TrayIcon }) {
    const [failed, setFailed] = React.useState(false)
    React.useEffect(() => setFailed(false), [icon.iconUrl])
    return <span className="mobile-plugin-icon" aria-hidden="true">
        {icon.iconUrl && !failed ? <img src={icon.iconUrl} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} /> : <PluginExtensionIcon />}
    </span>
}

// Outside the sheet: closing the chooser must not unmount the selected plugin.
// Query state lives in Choices and does not rerender these plugin runtimes.
const MobilePluginRuntimes = React.memo(function MobilePluginRuntimes({ icons, settings, width }: {
    icons: TrayIcon[]; settings?: ExtensionRepo_StoredPluginSettingsData; width: number | null
}) {
    return <div hidden aria-hidden="true" data-mobile-plugin-runtimes>{icons.map(icon => <PluginTray key={icon.extensionId} trayIcon={icon}
        place="top" width={width} isPinned={!!settings?.pinnedTrayPluginIds?.includes(icon.extensionId)} />)}</div>
})

function MobilePluginChoices({ icons, close, pins, mutation, toggle }: { icons: TrayIcon[]; close: () => void; pins: string[]; mutation: ReturnType<typeof useSetPluginSettingsPinnedTrays>; toggle: (id: string) => void }) {
    const tr = useTr()
    const [query, setQuery] = React.useState("")
    const { data: settings, isLoading, isError, refetch } = useGetPluginSettings()
    const select = useSetAtom(__plugin_unpinnedTrayIconClickedAtom)
    const filtered = icons.filter(icon => icon.extensionName.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    return <>
        <label className="mobile-plugin-search"><LuSearch aria-hidden="true" />
            <input type="search" aria-label={tr("Search plugins", "Plugins suchen")} placeholder={tr("Search plugins…", "Plugins suchen…")}
                value={query} onChange={event => setQuery(event.target.value)} />
            {!!query && <button type="button" aria-label={tr("Clear search", "Suche löschen")} onClick={() => setQuery("")}><LuX aria-hidden="true" /></button>}
        </label>
        {isLoading && <p className="mobile-plugin-status" role="status">{tr("Loading saved pins…", "Angeheftete Plugins werden geladen…")}</p>}
        {isError && <div className="mobile-plugin-status" role="alert">{tr("Saved pins could not load.", "Angeheftete Plugins konnten nicht geladen werden.")}
            <button type="button" onClick={() => refetch()}>{tr("Try again", "Erneut versuchen")}</button></div>}
        {mutation.isError && <p className="mobile-plugin-status" role="alert">{tr("Pin could not be saved. Try again.", "Anheften konnte nicht gespeichert werden. Versuche es erneut.")}</p>}
        <div className="mobile-plugin-list" data-plugin-sidebar-debug-popover-content>
            {filtered.map(icon => {
                const pinned = pins.includes(icon.extensionId)
                return <div className="mobile-plugin-row" data-pinned={pinned} key={icon.extensionId} data-plugin-id={icon.extensionId}>
                    <button type="button" className="mobile-plugin-open" aria-label={`${tr("Open", "Öffnen:")} ${icon.extensionName}`}
                        onClick={() => { close(); select(icon) }}>
                        <PluginIcon icon={icon} />
                        <span className="mobile-plugin-name">{icon.extensionName}{pinned && <small>{tr("Pinned", "Angeheftet")}</small>}</span>
                        {!!icon.badgeNumber && <Badge intent={`${icon.badgeIntent}-solid` as any} size="sm">{icon.badgeNumber}</Badge>}
                        <LuChevronRight className="mobile-plugin-chevron" aria-hidden="true" />
                    </button>
                    <button type="button" className="mobile-plugin-pin" aria-pressed={pinned}
                        aria-label={`${pinned ? tr("Unpin", "Lösen:") : tr("Pin", "Anheften:")} ${icon.extensionName}`}
                        disabled={isLoading || isError || mutation.isPending}
                        onClick={() => toggle(icon.extensionId)}>
                        {pinned ? <LuPinOff aria-hidden="true" /> : <LuPin aria-hidden="true" />}
                    </button>
                </div>
            })}
            {!filtered.length && <div className="mobile-plugin-empty" role="status"><PluginExtensionIcon /><p>{icons.length
                ? tr("No matching plugins", "Keine passenden Plugins") : tr("No plugins available", "Keine Plugins verfügbar")}</p></div>}
        </div>
    </>
}

type Props = {
    icons: TrayIcon[]; settings?: ExtensionRepo_StoredPluginSettingsData; width: number | null
    developmentModeExtensions: Extension_Extension[]; debugCounts: Record<string, number>
    openDebugWindow: (id: string) => void; reloadExternalExtension: (params: { id: string }) => void; isReloadingExtension: boolean
}

export function MobilePluginMenu(props: Props) {
    const tr = useTr()
    const { data: settings } = useGetPluginSettings()
    const mutation = useSetPluginSettingsPinnedTrays()
    const [optimisticPins, setOptimisticPins] = React.useState<string[] | null>(null)
    const pinLock = React.useRef(false)
    const select = useSetAtom(__plugin_unpinnedTrayIconClickedAtom)
    const pins = optimisticPins ?? settings?.pinnedTrayPluginIds ?? props.settings?.pinnedTrayPluginIds ?? []
    const toggle = (id: string) => {
        if (pinLock.current) return
        pinLock.current = true
        const next = [...new Set(pins.includes(id) ? pins.filter(pin => pin !== id) : [...pins, id])]
        setOptimisticPins(next)
        mutation.mutate({ pinnedTrayPluginIds: next }, { onSettled: () => { setOptimisticPins(null); pinLock.current = false } })
    }
    const pinnedIcons = [...new Set(pins)].flatMap(id => {
        const icon = props.icons.find(icon => icon.extensionId === id)
        return icon ? [icon] : []
    })
    const [open, setOpen] = React.useState(false)
    const openedPlugin = useAtomValue(__plugin_openedTrayPlugin)
    const content = React.useRef<HTMLDivElement>(null)
    const trigger = React.useRef<HTMLButtonElement>(null)
    const close = React.useCallback(() => setOpen(false), [])
    React.useEffect(() => { if (openedPlugin) close() }, [openedPlugin, close])
    // A plugin may reopen its existing tray while the chooser is visible.
    usePluginListenTrayOpenEvent(close, "")
    // Keyboard resize only; no document-scroll subscription or scroll-driven React state.
    React.useEffect(() => {
        if (!open) return
        const viewport = window.visualViewport
        const resize = () => {
            const native = (window as Window & { __seanimeInsets?: { bottom: number; top: number } }).__seanimeInsets
            // Samsung's padded WebView can keep an unchanged visualViewport behind the IME.
            // Subtract only the native inset not already reflected by a resized layout viewport.
            const nativeInset = Math.max(0, (native?.bottom || 0) / window.devicePixelRatio - Math.max(0, window.screen.height - window.innerHeight))
            const visualInset = Math.max(0, window.innerHeight - (viewport?.height || window.innerHeight) - (viewport?.offsetTop || 0))
            const inset = Math.max(nativeInset, visualInset)
            content.current?.style.setProperty("--plugin-viewport-height", `${(viewport?.height || window.innerHeight) - Math.max(0, nativeInset - visualInset)}px`)
            content.current?.style.setProperty("--plugin-keyboard-inset", `${inset}px`)
            content.current?.style.setProperty("--plugin-safe-top", `${(native?.top || 0) / window.devicePixelRatio}px`)
        }
        resize(); viewport?.addEventListener("resize", resize)
        window.addEventListener("seanime:window-insets", resize)
        return () => { viewport?.removeEventListener("resize", resize); window.removeEventListener("seanime:window-insets", resize) }
    }, [open])
    return <>
        <div className="mobile-plugin-actions">
        <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Trigger asChild><button ref={trigger} type="button" className="mobile-plugin-trigger" aria-label={tr("Open plugins", "Plugins öffnen")}>
                <PluginExtensionIcon /><span>Plugins</span>
            </button></Dialog.Trigger>
            <Dialog.Portal>
                <Dialog.Overlay className="mobile-plugin-overlay UI-Modal__overlay" />
                <Dialog.Content ref={content} className="mobile-plugin-sheet UI-Modal__content" data-mobile-plugin-overview aria-describedby={undefined}
                    onOpenAutoFocus={event => { event.preventDefault(); content.current?.querySelector<HTMLButtonElement>('.mobile-plugin-close')?.focus({ preventScroll: true }) }}
                    onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus({ preventScroll: true }) }}>
                    <div className="mobile-plugin-heading"><span className="mobile-plugin-heading-icon"><PluginExtensionIcon /></span>
                        <Dialog.Title>Plugins <span>({props.icons.length})</span></Dialog.Title>
                        <Dialog.Close asChild><button type="button" className="mobile-plugin-close" aria-label={tr("Close plugin overview", "Plugin-Übersicht schließen")}><LuX aria-hidden="true" /></button></Dialog.Close>
                    </div>
                    <MobilePluginChoices icons={props.icons} close={close} pins={pins} mutation={mutation} toggle={toggle} />
                    {!!props.developmentModeExtensions.length && <div className="mobile-plugin-debug">{props.developmentModeExtensions.map(extension => <div key={extension.id}>
                        <span>{extension.id}</span>
                        <button type="button" aria-label={`Debug ${extension.id}`} onClick={() => props.openDebugWindow(extension.id)}><LuSquareTerminal />{props.debugCounts[extension.id] || ""}</button>
                        <button type="button" aria-label={`Reload ${extension.id}`} disabled={props.isReloadingExtension} onClick={() => props.reloadExternalExtension({ id: extension.id })}><LuRefreshCw /></button>
                    </div>)}</div>}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
        <div className="mobile-plugin-shortcuts" role="group" aria-label={tr("Pinned plugins", "Angeheftete Plugins")}>
            {pinnedIcons.map(icon => <button type="button" key={icon.extensionId} data-plugin-shortcut={icon.extensionId}
                aria-label={`${tr("Open", "Öffnen:")} ${icon.extensionName}`} title={icon.extensionName} onClick={() => { close(); select(icon) }}>
                <PluginIcon icon={icon} />
            </button>)}
        </div>
        </div>
        <MobilePluginRuntimes icons={props.icons} settings={props.settings} width={props.width} />
    </>
}
