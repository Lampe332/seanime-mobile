import { useGetPluginSettings, useListDevelopmentModeExtensions, useReloadExternalExtension, useSetPluginSettingsPinnedTrays } from "@/api/hooks/extensions.hooks"
import { SearchField } from "@/components/shared/phone-kit"
import { cn } from "@/components/ui/core/styling"
import { Sheet } from "@/components/ui/sheet/sheet"
import { Muted, Text } from "@/components/ui/text/text"
import { useTr } from "@/lib/app-language"
import { WSEvents } from "@/lib/server/ws-events"
import { colors } from "@/lib/theme/tokens"
import { useWebsocketMessageListener } from "@/main/_hooks/handle-websockets"
import { useServerDisabledFeatures } from "@/main/_hooks/use-server-status"
import { Image } from "expo-image"
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai"
import ChevronRight from "lucide-react-native/icons/chevron-right"
import Pin from "lucide-react-native/icons/pin"
import PinOff from "lucide-react-native/icons/pin-off"
import Puzzle from "lucide-react-native/icons/puzzle"
import RefreshCw from "lucide-react-native/icons/refresh-cw"
import React from "react"
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native"
import { RenderPluginComponents, PluginScopeContext } from "./plugin-components"
import { PluginClientEvents, PluginServerEvents, type TrayIcon, usePluginListen, usePluginSend } from "./plugin-events"
import { pinnedTrayIcons, togglePin, withTrayBadge, withTrayIcon } from "./plugin-logic"

/*
 * The plugin tray of the phone (web tray/plugin-sidebar-tray.tsx, mobile-plugin-menu.tsx + .css, plugin-tray.tsx):
 * a "Plugins" button with the puzzle opens the list of plugins with tray icons (search, pins, badges); pinned plugins sit
 * as shortcuts next to it. Opening a plugin tells it it was clicked; a plugin with content opens its window, a sheet
 * that renders what the plugin sends (tray:updated). The plugin can open and close its window itself.
 * PluginTrayHost runs once in the main layout: it collects the icons and holds the windows, so closing the list never
 * closes a plugin. The development tools (debug log window) are a desktop tool and not here; development plugins keep
 * their reload button.
 */
const __plugin_trayIconsAtom = atom<TrayIcon[]>([])
/** the plugin whose window is open */
const __plugin_openedTrayAtom = atom<string | null>(null)
const __plugin_chooserOpenAtom = atom(false)

function useOpenTray() {
    const send = usePluginSend()
    const setOpened = useSetAtom(__plugin_openedTrayAtom)
    const setChooser = useSetAtom(__plugin_chooserOpenAtom)
    return (icon: TrayIcon) => {
        setChooser(false)
        send(PluginClientEvents.TrayClicked, {}, icon.extensionId)
        // the plugin menu draws the icons; a tray without content only reports the click
        if (icon.withContent) setTimeout(() => setOpened(icon.extensionId), 100)
    }
}

export function PluginTrayHost() {
    const [icons, setIcons] = useAtom(__plugin_trayIconsAtom)
    const send = usePluginSend()
    const { refetch } = useListDevelopmentModeExtensions()

    // every plugin with a tray icon answers with its icon
    React.useEffect(() => send(PluginClientEvents.ListTrayIcons, {}, ""), [send])
    usePluginListen<TrayIcon>(PluginServerEvents.TrayIcon, "", (icon, extensionId) => setIcons(prev => withTrayIcon(prev, icon, extensionId)))
    usePluginListen<{ badgeNumber: number, badgeIntent: string }>(PluginServerEvents.TrayBadgeUpdated, "", (badge, extensionId) => {
        if (extensionId) setIcons(prev => withTrayBadge(prev, extensionId, badge))
    })
    useWebsocketMessageListener<string>({
        type: WSEvents.PLUGIN_UNLOADED,
        onMessage: extensionId => {
            const id = String(extensionId || "")
            if (!id) return
            setIcons(prev => prev.filter(icon => icon.extensionId !== id))
            setTimeout(() => void refetch(), 1000)
        },
    })
    // a plugin loaded later (installed, enabled, reloaded) reports its icon too
    useWebsocketMessageListener<string>({
        type: WSEvents.PLUGIN_LOADED,
        onMessage: extensionId => {
            if (extensionId) send(PluginClientEvents.ListTrayIcons, {}, String(extensionId))
        },
    })

    return <>{icons.filter(icon => icon.withContent).map(icon => <PluginTrayWindow key={icon.extensionId} icon={icon} />)}</>
}

function PluginTrayWindow({ icon }: { icon: TrayIcon }) {
    const t = useTr()
    const send = usePluginSend()
    const [opened, setOpened] = useAtom(__plugin_openedTrayAtom)
    const open = opened === icon.extensionId
    // listen before opening: the plugin may render at once on click; the latest tree stays on the window
    const [data, setData] = React.useState<{ components?: unknown } | null>(null)
    usePluginListen<{ components?: unknown }>(PluginServerEvents.TrayUpdated, icon.extensionId, setData)
    usePluginListen(PluginServerEvents.TrayOpen, icon.extensionId, () => setOpened(icon.extensionId))
    usePluginListen(PluginServerEvents.TrayClose, icon.extensionId, () => setOpened(current => current === icon.extensionId ? null : current))

    const first = React.useRef(true)
    React.useEffect(() => {
        if (first.current) {
            first.current = false
            return
        }
        send(open ? PluginClientEvents.TrayOpened : PluginClientEvents.TrayClosed, {}, icon.extensionId)
        if (open) send(PluginClientEvents.RenderTray, {}, icon.extensionId)
    }, [open, send, icon.extensionId])

    return (
        <Sheet open={open} onOpenChange={next => setOpened(next ? icon.extensionId : null)} title={icon.extensionName}>
            <PluginScopeContext value={{ extensionId: icon.extensionId, extensionName: icon.extensionName }}>
                <PluginBoundary key={String(open)} t={t} onRetry={() => send(PluginClientEvents.RenderTray, {}, icon.extensionId)}>
                    {data?.components
                        ? <View className="gap-3"><RenderPluginComponents data={data.components} /></View>
                        : <View accessibilityLabel={t("Loading plugin", "Plugin wird geladen")} className="items-center py-8"><ActivityIndicator color={colors.smAccent} /></View>}
                </PluginBoundary>
            </PluginScopeContext>
        </Sheet>
    )
}

/** A plugin's tree that fails to render shows the error with a retry, instead of taking the app down (web ErrorBoundary) */
export class PluginBoundary extends React.Component<{ t: (en: string, de: string) => string, onRetry?: () => void, children: React.ReactNode }, { error: Error | null }> {
    state = { error: null as Error | null }
    static getDerivedStateFromError(error: Error) {
        return { error }
    }
    render() {
        const { error } = this.state
        if (!error) return this.props.children
        const { t, onRetry } = this.props
        return <View accessibilityRole="alert" className="gap-3 rounded-surface bg-sm-surface-raised p-4">
            <Text>{t("This plugin could not be displayed.", "Dieses Plugin konnte nicht angezeigt werden.")}</Text>
            <Muted>{error.message}</Muted>
            {!!onRetry && <Pressable accessibilityRole="button" onPress={() => {
                this.setState({ error: null })
                onRetry()
            }} className="min-h-12 justify-center self-start rounded-full bg-sm-surface-control px-4 active:bg-sm-line-strong">
                <Text className="font-semibold">{t("Try again", "Erneut versuchen")}</Text>
            </Pressable>}
        </View>
    }
}

function PluginIcon({ icon, size = 40 }: { icon: TrayIcon, size?: number }) {
    const [failed, setFailed] = React.useState<string | null>(null)
    const showImage = !!icon.iconUrl && failed !== icon.iconUrl
    return <View style={{ width: size, height: size }} className={cn("items-center justify-center overflow-hidden rounded-[12px]", size >= 40 && "bg-sm-surface-control")}>
        {showImage
            ? <Image source={icon.iconUrl} contentFit="contain" style={{ width: size * 0.75, height: size * 0.75 }} onError={() => setFailed(icon.iconUrl)} />
            : <Puzzle size={size >= 40 ? 22 : 20} color={colors.smTextMuted} />}
    </View>
}

/**
 * The Plugins button with the pinned plugins next to it. `home`: the bordered pill with its word (Home's head);
 * `bar`: the quiet 48dp icon of the other screens' top bar.
 */
export function PluginTrayButton({ variant }: { variant: "home" | "bar" }) {
    const t = useTr()
    const icons = useAtomValue(__plugin_trayIconsAtom)
    const [chooserOpen, setChooserOpen] = useAtom(__plugin_chooserOpenAtom)
    const { isFeatureDisabled } = useServerDisabledFeatures()
    const { data: settings } = useGetPluginSettings()
    const { data: developmentModeExtensions } = useListDevelopmentModeExtensions()
    const openTray = useOpenTray()
    const pins = settings?.pinnedTrayPluginIds ?? []
    const pinned = pinnedTrayIcons(pins, icons)

    // nothing to open or pin: the button would only lead to an empty "No plugins available" sheet
    if (isFeatureDisabled("PluginTray") || (!icons.length && !developmentModeExtensions?.length)) return null
    return <View className="min-w-0 flex-row flex-wrap items-center gap-1.5">
        <Pressable accessibilityRole="button" accessibilityLabel={t("Open plugins", "Plugins öffnen")} onPress={() => setChooserOpen(true)}
            className={variant === "home"
                ? "min-h-11 flex-row items-center gap-2 rounded-surface-sm border border-sm-line-strong bg-sm-surface-control px-3.5 active:border-sm-accent-line active:bg-sm-accent-soft"
                : "h-12 w-12 items-center justify-center rounded-full active:bg-sm-surface-control"}>
            <Puzzle size={22} color={variant === "home" ? colors.smAccent : colors.smTextMuted} />
            {variant === "home" && <Text className="text-sm font-semibold">Plugins</Text>}
        </Pressable>
        {pinned.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="grow-0" contentContainerClassName="gap-1.5 p-[3px]"
                accessibilityLabel={t("Pinned plugins", "Angeheftete Plugins")}>
                {pinned.map(icon => <Pressable key={icon.extensionId} accessibilityRole="button" accessibilityLabel={`${t("Open", "Öffnen:")} ${icon.extensionName}`}
                    onPress={() => openTray(icon)}
                    className="h-11 w-11 items-center justify-center rounded-surface-sm border border-sm-line-strong bg-sm-surface-control active:border-sm-accent-line active:bg-sm-accent-soft">
                    <PluginIcon icon={icon} size={28} />
                </Pressable>)}
            </ScrollView>
        )}
        <PluginChooser open={chooserOpen} onOpenChange={setChooserOpen} icons={icons} />
    </View>
}

function PluginChooser({ open, onOpenChange, icons }: { open: boolean, onOpenChange: (open: boolean) => void, icons: TrayIcon[] }) {
    const t = useTr()
    const [query, setQuery] = React.useState("")
    const { data: settings, isLoading, isError, refetch } = useGetPluginSettings()
    const mutation = useSetPluginSettingsPinnedTrays()
    const [optimisticPins, setOptimisticPins] = React.useState<string[] | null>(null)
    const pinLock = React.useRef(false)
    const { data: developmentModeExtensions } = useListDevelopmentModeExtensions()
    const { mutate: reloadExtension, isPending: reloading } = useReloadExternalExtension()
    const openTray = useOpenTray()
    const pins = optimisticPins ?? settings?.pinnedTrayPluginIds ?? []
    const toggle = (id: string) => {
        if (pinLock.current) return
        pinLock.current = true
        const next = togglePin(pins, id)
        setOptimisticPins(next)
        mutation.mutate({ pinnedTrayPluginIds: next }, { onSettled: () => { setOptimisticPins(null); pinLock.current = false } })
    }
    // a plugin may reopen its tray while the list is open
    usePluginListen(PluginServerEvents.TrayOpen, "", () => onOpenChange(false))
    const filtered = icons.filter(icon => icon.extensionName.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))

    return (
        <Sheet open={open} onOpenChange={onOpenChange} title={`Plugins (${icons.length})`}
            description={t("Pin a plugin to keep it as a shortcut next to the plugin button.", "Angeheftete Plugins erscheinen als Kurzbefehl neben dem Plugin-Knopf.")}>
            <SearchField value={query} onChangeText={setQuery} placeholder={t("Search plugins…", "Plugins suchen…")} />
            {isLoading && <Muted>{t("Loading saved pins…", "Angeheftete Plugins werden geladen…")}</Muted>}
            {isError && <View className="flex-row flex-wrap items-center gap-2">
                <Muted>{t("Saved pins could not load.", "Angeheftete Plugins konnten nicht geladen werden.")}</Muted>
                <Pressable accessibilityRole="button" onPress={() => void refetch()} className="min-h-11 justify-center px-1">
                    <Text className="text-sm text-sm-accent underline">{t("Try again", "Erneut versuchen")}</Text>
                </Pressable>
            </View>}
            {mutation.isError && <Muted accessibilityRole="alert">{t("Pin could not be saved. Try again.", "Anheften konnte nicht gespeichert werden. Versuche es erneut.")}</Muted>}
            <View className="gap-0.5 overflow-hidden rounded-surface">
                {filtered.map(icon => {
                    const isPinned = pins.includes(icon.extensionId)
                    return <View key={icon.extensionId} className="flex-row items-center gap-1 bg-sm-surface-raised pr-1">
                        <Pressable accessibilityRole="button" accessibilityLabel={`${t("Open", "Öffnen:")} ${icon.extensionName}`} onPress={() => openTray(icon)}
                            className="min-h-16 min-w-0 flex-1 flex-row items-center gap-3.5 py-2.5 pl-3 pr-2 active:bg-sm-surface-control">
                            <PluginIcon icon={icon} />
                            <View className="min-w-0 flex-1">
                                <Text className="text-[15px] font-semibold leading-[20px]">{icon.extensionName}</Text>
                                {isPinned && <Text className="mt-0.5 text-[13px] text-sm-text-muted">{t("Pinned", "Angeheftet")}</Text>}
                            </View>
                            {!!icon.badgeNumber && <View className="rounded-full bg-sm-accent-strong px-2 py-0.5"><Text className="text-xs font-bold text-white">{icon.badgeNumber}</Text></View>}
                            <ChevronRight size={18} color={colors.smTextSubtle} />
                        </Pressable>
                        <Pressable accessibilityRole="button" accessibilityState={{ selected: isPinned, disabled: isLoading || isError || mutation.isPending }}
                            accessibilityLabel={`${isPinned ? t("Unpin", "Lösen:") : t("Pin", "Anheften:")} ${icon.extensionName}`}
                            disabled={isLoading || isError || mutation.isPending} onPress={() => toggle(icon.extensionId)}
                            className={cn("h-12 w-12 items-center justify-center rounded-full active:bg-sm-surface-control", (isLoading || isError || mutation.isPending) && "opacity-40")}>
                            {isPinned ? <PinOff size={20} color={colors.smAccent} /> : <Pin size={20} color={colors.smTextMuted} />}
                        </Pressable>
                    </View>
                })}
            </View>
            {!filtered.length && <View className="items-center gap-3 px-2 py-8">
                <Puzzle size={32} color={colors.smTextSubtle} />
                <Muted>{icons.length ? t("No matching plugins", "Keine passenden Plugins") : t("No plugins available", "Keine Plugins verfügbar")}</Muted>
            </View>}
            {!!developmentModeExtensions?.length && <View className="gap-1">
                {developmentModeExtensions.map(extension => <View key={extension.id} className="min-h-12 flex-row items-center gap-2">
                    <Text className="min-w-0 flex-1 text-sm">{extension.id}</Text>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Reload ${extension.id}`} disabled={reloading}
                        onPress={() => reloadExtension({ id: extension.id })} className="h-12 w-12 items-center justify-center rounded-full active:bg-sm-surface-control">
                        <RefreshCw size={18} color={colors.smTextMuted} />
                    </Pressable>
                </View>)}
            </View>}
        </Sheet>
    )
}
