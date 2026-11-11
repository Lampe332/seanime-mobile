import type { CardMenuItem } from "@/components/shared/card-menu"
import { cn } from "@/components/ui/core/styling"
import { useTr } from "@/lib/app-language"
import { colors } from "@/lib/theme/tokens"
import { Image } from "expo-image"
import { atom, getDefaultStore, useAtomValue } from "jotai"
import Library from "lucide-react-native/icons/library"
import Link from "lucide-react-native/icons/link"
import ListOrdered from "lucide-react-native/icons/list-ordered"
import Music from "lucide-react-native/icons/eighth-notes"
import Puzzle from "lucide-react-native/icons/puzzle"
import React from "react"
import { Pressable } from "react-native"
import { PluginClientEvents, PluginServerEvents, usePluginListen, usePluginSend } from "./plugin-events"
import { animeButtonSymbol, backgroundImageUrl, forMediaKind, mangaButtonSymbol, replaceExtensionItems } from "./plugin-logic"

/*
 * What plugins add to the app's own buttons and menus (web actions/plugin-actions.tsx): round buttons on the anime and
 * manga pages, items in the pages' "More" sheets, the manga and anime library menus, a card's long-press menu and the
 * episode menus (library, not downloaded, online tab, torrent/debrid streams). A place asks the plugins for their items when it appears (`…:render`); every plugin answers
 * with its whole list (`…:updated`), which replaces its old one. One listener (PluginActionsListener, main layout) keeps
 * the lists, so a list of cards does not listen once per card. A tap sends `action:clicked` with the media or episode.
 */
export type PluginAction = {
    extensionId: string
    id: string
    label?: string
    tooltipText?: string
    style?: Record<string, unknown>
    disabled?: boolean
    loading?: boolean
    /** media card items: "anime" | "manga" | "both" */
    for?: string
    /** episode items: "library" | "onlinestream" | "undownloaded" | … */
    type?: string
}

const KINDS = {
    animePageButtons: [PluginClientEvents.ActionRenderAnimePageButtons, "buttons"],
    animePageItems: [PluginClientEvents.ActionRenderAnimePageDropdownItems, "items"],
    mangaPageButtons: [PluginClientEvents.ActionRenderMangaPageButtons, "buttons"],
    mangaPageItems: [PluginClientEvents.ActionRenderMangaPageDropdownItems, "items"],
    mangaLibraryItems: [PluginClientEvents.ActionRenderMangaLibraryDropdownItems, "items"],
    animeLibraryItems: [PluginClientEvents.ActionRenderAnimeLibraryDropdownItems, "items"],
    mediaCardItems: [PluginClientEvents.ActionRenderMediaCardContextMenuItems, "items"],
    episodeCardItems: [PluginClientEvents.ActionRenderEpisodeCardContextMenuItems, "items"],
    episodeGridItems: [PluginClientEvents.ActionRenderEpisodeGridItemMenuItems, "items"],
} as const
export type PluginActionKind = keyof typeof KINDS

const __plugin_actionsAtom = atom<Partial<Record<PluginActionKind, PluginAction[]>>>({})
const store = getDefaultStore()

function update(kind: PluginActionKind, extensionId: string, payload: Record<string, unknown> | undefined) {
    const list = payload?.[KINDS[kind][1]] as Record<string, unknown>[] | undefined
    store.set(__plugin_actionsAtom, prev => ({ ...prev, [kind]: replaceExtensionItems(prev[kind] ?? [], extensionId, list) }))
}

/** Keeps every plugin's items; mounted once in the main layout */
export function PluginActionsListener() {
    type P = Record<string, unknown>
    usePluginListen<P>(PluginServerEvents.ActionRenderAnimePageButtons, "", (p, id) => update("animePageButtons", id, p))
    usePluginListen<P>(PluginServerEvents.ActionRenderAnimePageDropdownItems, "", (p, id) => update("animePageItems", id, p))
    usePluginListen<P>(PluginServerEvents.ActionRenderMangaPageButtons, "", (p, id) => update("mangaPageButtons", id, p))
    usePluginListen<P>(PluginServerEvents.ActionRenderMangaPageDropdownItems, "", (p, id) => update("mangaPageItems", id, p))
    usePluginListen<P>(PluginServerEvents.ActionRenderMangaLibraryDropdownItems, "", (p, id) => update("mangaLibraryItems", id, p))
    usePluginListen<P>(PluginServerEvents.ActionRenderAnimeLibraryDropdownItems, "", (p, id) => update("animeLibraryItems", id, p))
    usePluginListen<P>(PluginServerEvents.ActionRenderMediaCardContextMenuItems, "", (p, id) => update("mediaCardItems", id, p))
    usePluginListen<P>(PluginServerEvents.ActionRenderEpisodeCardContextMenuItems, "", (p, id) => update("episodeCardItems", id, p))
    usePluginListen<P>(PluginServerEvents.ActionRenderEpisodeGridItemMenuItems, "", (p, id) => update("episodeGridItems", id, p))
    return null
}

export { forEpisodeType, forMediaKind } from "./plugin-logic"

// a list of episodes or cards asks once, not once per row
const lastAsked: Partial<Record<PluginActionKind, number>> = {}

/** The plugins' items for a place; the place asks for them when it appears. `keep` must be stable (module-level). */
export function usePluginActions(kind: PluginActionKind, keep?: (item: PluginAction) => boolean) {
    const send = usePluginSend()
    React.useEffect(() => {
        const now = Date.now()
        if (now - (lastAsked[kind] ?? 0) < 1000) return
        lastAsked[kind] = now
        send(KINDS[kind][0], {}, "")
    }, [send, kind])
    const all = useAtomValue(__plugin_actionsAtom)[kind]
    return React.useMemo(() => (all ?? []).filter(item => !keep || keep(item)), [all, keep])
}

/** Runs an item: the plugin gets the media or episode it was used on */
export function useRunPluginAction() {
    const send = usePluginSend()
    return React.useCallback((item: PluginAction, event: Record<string, unknown>) => {
        send(PluginClientEvents.ActionClicked, { actionId: item.id, event }, item.extensionId)
    }, [send])
}

const animeCardItems = forMediaKind("anime")
const mangaCardItems = forMediaKind("manga")

/** The plugins' items for a card's long-press menu (PluginMediaCardContextMenuItems), after the card's own */
export function usePluginCardMenuItems(type: "anime" | "manga", media: unknown): CardMenuItem[] {
    const items = usePluginActions("mediaCardItems", type === "anime" ? animeCardItems : mangaCardItems)
    const run = useRunPluginAction()
    return React.useMemo(() => items.map(item => ({ id: `plugin:${item.extensionId}:${item.id}`, label: item.label || "???", icon: Puzzle,
        onPress: () => run(item, { media }) })), [items, run, media])
}

/** The plugin's name for an item or button */
export const pluginActionName = (item: PluginAction) => item.tooltipText || item.label || "Plugin"

/**
 * The plugins' round buttons beside More on the anime and manga pages: the same calm round icons as the page's own; the
 * plugin's name is the accessible label. An anime button keeps the plugin's own icon (its background image); text-only
 * buttons get a fitting symbol.
 */
export function PluginPageButtons({ kind, media }: { kind: "anime" | "manga", media: unknown }) {
    const t = useTr()
    const buttons = usePluginActions(kind === "anime" ? "animePageButtons" : "mangaPageButtons")
    const run = useRunPluginAction()
    if (!buttons.length) return null
    return <>
        {buttons.map(button => {
            const name = pluginActionName(button)
            const image = kind === "anime" ? backgroundImageUrl(button.style?.backgroundImage) : undefined
            const symbol = kind === "anime" ? animeButtonSymbol(name) : mangaButtonSymbol(name)
            const Icon = symbol === "music" ? Music : symbol === "order" ? ListOrdered : symbol === "link" ? Link : symbol === "library" ? Library : Puzzle
            const disabled = !!button.disabled || !!button.loading
            return <Pressable key={`${button.extensionId}:${button.id}`} accessibilityRole="button" accessibilityLabel={name || t("Plugin", "Plugin")}
                accessibilityState={{ disabled }} disabled={disabled} onPress={() => run(button, { media })}
                className={cn("h-12 w-12 items-center justify-center rounded-full bg-sm-surface-raised active:bg-sm-accent-soft", disabled && "opacity-50")}>
                {image ? <Image source={image} contentFit="contain" style={{ width: 20, height: 20 }} /> : <Icon size={20} color={colors.smTextMuted} />}
            </Pressable>
        })}
    </>
}
