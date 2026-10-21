import { LuLibrary, LuLink, LuListOrdered, LuMusic, LuPuzzle } from "react-icons/lu"
import { AL_BaseAnime, AL_BaseManga, Anime_Episode, Onlinestream_Episode } from "@/api/generated/types"
import { Button, ButtonProps, IconButton } from "@/components/ui/button"
import { ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu"
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { Tooltip } from "@/components/ui/tooltip"
import React, { useEffect, useState } from "react"
import { BiDotsHorizontal } from "react-icons/bi"
import {
    usePluginListenActionRenderAnimeLibraryDropdownItemsEvent,
    usePluginListenActionRenderAnimePageButtonsEvent,
    usePluginListenActionRenderAnimePageDropdownItemsEvent,
    usePluginListenActionRenderEpisodeCardContextMenuItemsEvent,
    usePluginListenActionRenderEpisodeGridItemMenuItemsEvent,
    usePluginListenActionRenderMangaLibraryDropdownItemsEvent,
    usePluginListenActionRenderMangaPageButtonsEvent,
    usePluginListenActionRenderMangaPageDropdownItemsEvent,
    usePluginListenActionRenderMediaCardContextMenuItemsEvent,
    usePluginSendActionClickedEvent,
    usePluginSendActionRenderAnimeLibraryDropdownItemsEvent,
    usePluginSendActionRenderAnimePageButtonsEvent,
    usePluginSendActionRenderAnimePageDropdownItemsEvent,
    usePluginSendActionRenderEpisodeCardContextMenuItemsEvent,
    usePluginSendActionRenderEpisodeGridItemMenuItemsEvent,
    usePluginSendActionRenderMangaLibraryDropdownItemsEvent,
    usePluginSendActionRenderMangaPageButtonsEvent,
    usePluginSendActionRenderMangaPageDropdownItemsEvent,
    usePluginSendActionRenderMediaCardContextMenuItemsEvent,
} from "../generated/plugin-events"

function sortItems<T extends { extensionId: string }>(items: T[]) {
    return items.sort((a, b) => a.extensionId.localeCompare(b.extensionId, undefined, { numeric: true }))
}

type PluginAnimePageButton = {
    extensionId: string
    intent: string
    onClick: string
    label: string
    style: React.CSSProperties
    loading?: boolean
    disabled?: boolean
    id: string
    tooltipText?: string
}

export function PluginAnimePageButtons(props: { media: AL_BaseAnime }) {
    const [buttons, setButtons] = useState<PluginAnimePageButton[]>([])

    const { sendActionRenderAnimePageButtonsEvent } = usePluginSendActionRenderAnimePageButtonsEvent()
    const { sendActionClickedEvent } = usePluginSendActionClickedEvent()

    useEffect(() => {
        sendActionRenderAnimePageButtonsEvent({}, "")
    }, [])

    // Listen for the action to render the anime page buttons
    usePluginListenActionRenderAnimePageButtonsEvent((event, extensionId) => {
        setButtons(p => {
            const otherButtons = p.filter(b => b.extensionId !== extensionId)
            const extButtons = event.buttons.map((b: Record<string, any>) => ({ ...b, extensionId } as PluginAnimePageButton))
            return sortItems([...otherButtons, ...extButtons])
        })
    }, "")

    // Send
    function handleClick(button: PluginAnimePageButton) {
        sendActionClickedEvent({
            actionId: button.id,
            event: {
                media: props.media,
            },
        }, button.extensionId)
    }

    if (buttons.length === 0) return null

    // Android: the same row of calm round icons as on manga pages; the plugin's name becomes the accessible label.
    if (import.meta.env.SEA_PUBLIC_PLATFORM === "mobile") return <>
        {buttons.map(b => {
            const name = b.tooltipText || (typeof b.label === "string" ? b.label : "") || "Plugin"
            // Keep the plugin's own icon (drawn as a background image); text-only buttons get a fitting symbol.
            const image = b.style?.backgroundImage
            const Icon = /theme|music|song|opening/i.test(name) ? LuMusic : /order/i.test(name) ? LuListOrdered : LuPuzzle
            return <button key={b.id} type="button" className="mobile-entry-icon" data-mobile-plugin-action={b.id} aria-label={name} title={name}
                style={image ? { backgroundImage: image, backgroundPosition: "center", backgroundRepeat: "no-repeat", backgroundSize: "20px 20px" } : undefined}
                onClick={() => handleClick(b)} disabled={b.disabled || b.loading}>
                {!image && <Icon aria-hidden />}
            </button>
        })}
    </>

    return <>
        {buttons.map(b => !b.tooltipText ? (
            <Button
                key={b.id}
                intent={b.intent as ButtonProps["intent"] || "gray-subtle"}
                onClick={() => handleClick(b)}
                style={b.style}
                loading={b.loading}
                disabled={b.disabled}
            >{b.label || "???"}</Button>
        ) : (
            <Tooltip
                key={b.id} trigger={
                <div>
                    <Button
                        key={b.id}
                        intent={b.intent as ButtonProps["intent"] || "gray-subtle"}
                        onClick={() => handleClick(b)}
                        style={b.style}
                        loading={b.loading}
                        disabled={b.disabled}
                    >{b.label || "???"}</Button>
                </div>
            }
            >
                {b.tooltipText || "???"}
            </Tooltip>
        ))}
    </>
}


/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

type PluginMangaPageButton = {
    extensionId: string
    intent: string
    onClick: string
    label: string
    style: React.CSSProperties
    id: string
    loading?: boolean
    disabled?: boolean
    tooltipText?: string
}

export function PluginMangaPageButtons(props: { media: AL_BaseManga }) {
    const [buttons, setButtons] = useState<PluginMangaPageButton[]>([])

    const { sendActionRenderMangaPageButtonsEvent } = usePluginSendActionRenderMangaPageButtonsEvent()
    const { sendActionClickedEvent } = usePluginSendActionClickedEvent()

    useEffect(() => {
        sendActionRenderMangaPageButtonsEvent({}, "")
    }, [])

    // Listen for the action to render the manga page buttons
    usePluginListenActionRenderMangaPageButtonsEvent((event, extensionId) => {
        setButtons(p => {
            const otherButtons = p.filter(b => b.extensionId !== extensionId)
            const extButtons = event.buttons.map((b: Record<string, any>) => ({ ...b, extensionId } as PluginMangaPageButton))
            return sortItems([...otherButtons, ...extButtons])
        })
    }, "")

    // Send
    function handleClick(button: PluginMangaPageButton) {
        sendActionClickedEvent({
            actionId: button.id,
            event: {
                media: props.media,
            },
        }, button.extensionId)
    }

    if (buttons.length === 0) return null

    // Android: a readable text chip instead of an emoji square.
    if (import.meta.env.SEA_PUBLIC_PLATFORM === "mobile") return <>
        {buttons.map(b => {
            const name = b.tooltipText || b.label || "Plugin"
            // A calm line icon instead of the plugin's emoji; known purposes get a matching symbol.
            const Icon = /mangaupdates|link/i.test(name) ? LuLink : /source/i.test(name) ? LuLibrary : LuPuzzle
            return <button key={b.id} type="button" className="mobile-entry-icon" data-mobile-plugin-action={b.id} aria-label={name} title={name}
                onClick={() => handleClick(b)} disabled={b.disabled || b.loading}>
                <Icon aria-hidden />
            </button>
        })}
    </>

    return <>
        {buttons.map(b => !b.tooltipText ? (
            <Button
                key={b.id}
                intent={b.intent as ButtonProps["intent"] || "gray-subtle"}
                onClick={() => handleClick(b)}
                style={b.style}
                loading={b.loading}
                disabled={b.disabled}
            >{b.label || "???"}</Button>
        ) : (
            <Tooltip
                key={b.id} trigger={
                <div>
                    <Button
                        key={b.id}
                        intent={b.intent as ButtonProps["intent"] || "gray-subtle"}
                        onClick={() => handleClick(b)}
                        style={b.style}
                        loading={b.loading}
                        disabled={b.disabled}
                    >{b.label || "???"}</Button>
                </div>
            }
            >
                {b.tooltipText || "???"}
            </Tooltip>
        ))}
    </>
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

type PluginMangaPageDropdownMenuItem = {
    extensionId: string
    onClick: string
    label: string
    id: string
    style: React.CSSProperties
    disabled?: boolean
}

export function PluginMangaPageDropdownItems(props: { media: AL_BaseManga }) {
    const [items, setItems] = useState<PluginMangaPageDropdownMenuItem[]>([])

    const { sendActionRenderMangaPageDropdownItemsEvent } = usePluginSendActionRenderMangaPageDropdownItemsEvent()
    const { sendActionClickedEvent } = usePluginSendActionClickedEvent()

    useEffect(() => {
        sendActionRenderMangaPageDropdownItemsEvent({}, "")
    }, [])

    // Listen for the action to render the manga page dropdown items
    usePluginListenActionRenderMangaPageDropdownItemsEvent((event, extensionId) => {
        setItems(p => {
            const otherItems = p.filter(i => i.extensionId !== extensionId)
            const extItems = event.items.map((i: Record<string, any>) => ({ ...i, extensionId } as PluginMangaPageDropdownMenuItem))
            return sortItems([...otherItems, ...extItems])
        })
    }, "")

    // Send
    function handleClick(item: PluginMangaPageDropdownMenuItem) {
        sendActionClickedEvent({
            actionId: item.id,
            event: {
                media: props.media,
            },
        }, item.extensionId)
    }

    if (items.length === 0) return null

    return <>
        <DropdownMenuSeparator />
        {items.map(i => (
            <DropdownMenuItem key={i.id} onClick={() => handleClick(i)} style={i.style} disabled={i.disabled}>{i.label || "???"}</DropdownMenuItem>
        ))}
    </>
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

type PluginMediaCardContextMenuItem = {
    extensionId: string
    onClick: string
    label: string
    style: React.CSSProperties
    id: string
    for: "anime" | "manga" | "both"
    disabled?: boolean
}

type PluginMediaCardContextMenuItemsProps = {
    for: "anime" | "manga",
    media: AL_BaseAnime | AL_BaseManga
}

export function PluginMediaCardContextMenuItems(props: PluginMediaCardContextMenuItemsProps) {
    const [items, setItems] = useState<PluginMediaCardContextMenuItem[]>([])

    const { sendActionRenderMediaCardContextMenuItemsEvent } = usePluginSendActionRenderMediaCardContextMenuItemsEvent()
    const { sendActionClickedEvent } = usePluginSendActionClickedEvent()

    useEffect(() => {
        sendActionRenderMediaCardContextMenuItemsEvent({}, "")
    }, [])

    // Listen for the action to render the media card context menu items
    usePluginListenActionRenderMediaCardContextMenuItemsEvent((event, extensionId) => {
        setItems(p => {
            const otherItems = p.filter(b => b.extensionId !== extensionId)
            const extItems = event.items
                .filter((i: PluginMediaCardContextMenuItem) => i.for === props.for || i.for === "both")
                .map((b: Record<string, any>) => ({ ...b, extensionId } as PluginMangaPageButton))
            return sortItems([...otherItems, ...extItems])
        })
    }, "")

    // Send
    function handleClick(item: PluginMediaCardContextMenuItem) {
        sendActionClickedEvent({
            actionId: item.id,
            event: {
                media: props.media,
            },
        }, item.extensionId)
    }

    if (items.length === 0) return null

    return <>
        <ContextMenuSeparator className="!my-2" />
        {items.map(i => (
            <ContextMenuItem key={i.id} onClick={() => handleClick(i)} style={i.style} disabled={i.disabled}>{i.label || "???"}</ContextMenuItem>
        ))}
    </>
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

type PluginAnimeLibraryDropdownMenuItem = {
    extensionId: string
    onClick: string
    label: string
    id: string
    style: React.CSSProperties
    disabled?: boolean
}

export function PluginAnimeLibraryDropdownItems() {
    const [items, setItems] = useState<PluginAnimeLibraryDropdownMenuItem[]>([])

    const { sendActionRenderAnimeLibraryDropdownItemsEvent } = usePluginSendActionRenderAnimeLibraryDropdownItemsEvent()
    const { sendActionClickedEvent } = usePluginSendActionClickedEvent()

    useEffect(() => {
        sendActionRenderAnimeLibraryDropdownItemsEvent({}, "")
    }, [])


    // Listen for the action to render the anime library dropdown items
    usePluginListenActionRenderAnimeLibraryDropdownItemsEvent((event, extensionId) => {
        setItems(p => {
            const otherItems = p.filter(i => i.extensionId !== extensionId)
            const extItems = event.items.map((i: Record<string, any>) => ({ ...i, extensionId } as PluginAnimeLibraryDropdownMenuItem))
            return sortItems([...otherItems, ...extItems])
        })
    }, "")

    // Send
    function handleClick(item: PluginAnimeLibraryDropdownMenuItem) {
        sendActionClickedEvent({
            actionId: item.id,
            event: {},
        }, item.extensionId)
    }

    if (items.length === 0) return null

    return <>
        <DropdownMenuSeparator />
        {items.map(i => (
            <DropdownMenuItem key={i.id} onClick={() => handleClick(i)} style={i.style} disabled={i.disabled}>{i.label || "???"}</DropdownMenuItem>
        ))}
    </>
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

type PluginMangaLibraryDropdownMenuItem = {
    extensionId: string
    onClick: string
    label: string
    id: string
    style: React.CSSProperties
    disabled?: boolean
}

export function PluginMangaLibraryDropdownItems() {
    const { items, handleClick } = usePluginMangaLibraryDropdownItems()

    if (items.length === 0) return null

    return <>
        <DropdownMenuSeparator />
        {items.map(i => (
            <DropdownMenuItem key={i.id} onClick={() => handleClick(i)} style={i.style} disabled={i.disabled}>{i.label || "???"}</DropdownMenuItem>
        ))}
    </>
}

/** Items plugins add to the manga library menu; the phone library renders them in its own menu. */
export function usePluginMangaLibraryDropdownItems() {
    const [items, setItems] = useState<PluginMangaLibraryDropdownMenuItem[]>([])

    const { sendActionRenderMangaLibraryDropdownItemsEvent } = usePluginSendActionRenderMangaLibraryDropdownItemsEvent()
    const { sendActionClickedEvent } = usePluginSendActionClickedEvent()

    useEffect(() => {
        sendActionRenderMangaLibraryDropdownItemsEvent({}, "")
    }, [])

    // Listen for the action to render the manga library dropdown items
    usePluginListenActionRenderMangaLibraryDropdownItemsEvent((event, extensionId) => {
        setItems(p => {
            const otherItems = p.filter(i => i.extensionId !== extensionId)
            const extItems = event.items.map((i: Record<string, any>) => ({ ...i, extensionId } as PluginMangaLibraryDropdownMenuItem))
            return sortItems([...otherItems, ...extItems])
        })
    }, "")

    // Send
    function handleClick(item: PluginMangaLibraryDropdownMenuItem) {
        sendActionClickedEvent({
            actionId: item.id,
            event: {},
        }, item.extensionId)
    }

    return { items, handleClick }
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

type PluginEpisodeCardContextMenuItem = {
    extensionId: string
    onClick: string
    label: string
    id: string
    style: React.CSSProperties
    type: "library" | "torrentstream" | "debridstream" | string | undefined
    disabled?: boolean
}

export function PluginEpisodeCardContextMenuItems(props: { episode: Anime_Episode | undefined, type: PluginEpisodeCardContextMenuItem["type"] }) {
    const [items, setItems] = useState<PluginEpisodeCardContextMenuItem[]>([])

    const { sendActionRenderEpisodeCardContextMenuItemsEvent } = usePluginSendActionRenderEpisodeCardContextMenuItemsEvent()
    const { sendActionClickedEvent } = usePluginSendActionClickedEvent()

    useEffect(() => {
        sendActionRenderEpisodeCardContextMenuItemsEvent({}, "")
    }, [])

    // Listen for the action to render the episode card context menu items
    usePluginListenActionRenderEpisodeCardContextMenuItemsEvent((event, extensionId) => {
        setItems(p => {
            console.log(p)
            const otherItems = p.filter(i => i.extensionId !== extensionId && (i.type === props.type || i.type === undefined))
            const extItems = event.items.filter((i: PluginEpisodeCardContextMenuItem) => i.type === props.type || i.type === undefined)
                .map((i: Record<string, any>) => ({ ...i, extensionId } as PluginEpisodeCardContextMenuItem))
            return sortItems([...otherItems, ...extItems])
        })
    }, "")

    // Send
    function handleClick(item: PluginEpisodeCardContextMenuItem) {
        sendActionClickedEvent({
            actionId: item.id,
            event: {
                episode: props.episode,
            },
        }, item.extensionId)
    }

    if (items.length === 0) return null

    return <>
        <ContextMenuSeparator className="!my-2" />
        {items.map(i => (
            <ContextMenuItem key={i.id} onClick={() => handleClick(i)} style={i.style} disabled={i.disabled}>{i.label || "???"}</ContextMenuItem>
        ))}
    </>
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

type PluginEpisodeGridItemMenuItem = {
    extensionId: string
    onClick: string
    label: string
    id: string
    type: "library" | "torrentstream" | "debridstream" | "onlinestream" | "undownloaded" | "medialinks" | "mediastream" | string
    style: React.CSSProperties
    disabled?: boolean
}

export function PluginEpisodeGridItemMenuItems(props: {
    isDropdownMenu: boolean,
    type: PluginEpisodeGridItemMenuItem["type"],
    episode: Anime_Episode | Onlinestream_Episode | undefined
}) {
    const [items, setItems] = useState<PluginEpisodeGridItemMenuItem[]>([])

    const { sendActionRenderEpisodeGridItemMenuItemsEvent } = usePluginSendActionRenderEpisodeGridItemMenuItemsEvent()
    const { sendActionClickedEvent } = usePluginSendActionClickedEvent()

    useEffect(() => {
        sendActionRenderEpisodeGridItemMenuItemsEvent({}, "")
    }, [])

    // Listen for the action to render the episode grid item context menu items
    usePluginListenActionRenderEpisodeGridItemMenuItemsEvent((event, extensionId) => {
        setItems(p => {
            const otherItems = p.filter(i => i.extensionId !== extensionId && i.type === props.type)
            const extItems = event.items.filter((i: PluginEpisodeGridItemMenuItem) => i.type === props.type)
                .map((i: Record<string, any>) => ({ ...i, extensionId } as PluginEpisodeGridItemMenuItem))
            return sortItems([...otherItems, ...extItems])
        })
    }, "")

    // Send
    function handleClick(item: PluginEpisodeGridItemMenuItem) {
        sendActionClickedEvent({
            actionId: item.id,
            event: {
                episode: props.episode,
                type: props.type,
            },
        }, item.extensionId)
    }

    if (items.length === 0) return null

    if (props.isDropdownMenu) {
        return <DropdownMenu
            trigger={
                <IconButton
                    icon={<BiDotsHorizontal />}
                    intent="gray-basic"
                    size="xs"
                />
            }
        >
            {items.map(i => (
                <DropdownMenuItem
                    key={i.id}
                    onClick={() => handleClick(i)}
                    style={i.style}
                    disabled={i.disabled}
                >{i.label || "???"}</DropdownMenuItem>
            ))}
        </DropdownMenu>
    }

    return <>
        <DropdownMenuSeparator />
        {items.map(i => (
            <DropdownMenuItem key={i.id} onClick={() => handleClick(i)} style={i.style} disabled={i.disabled}>{i.label || "???"}</DropdownMenuItem>
        ))}
    </>
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

type PluginAnimePageDropdownMenuItem = {
    extensionId: string
    onClick: string
    label: string
    id: string
    style: React.CSSProperties
    disabled?: boolean
}

export function PluginAnimePageDropdownItems(props: { media: AL_BaseAnime }) {
    const [items, setItems] = useState<PluginAnimePageDropdownMenuItem[]>([])

    const { sendActionRenderAnimePageDropdownItemsEvent } = usePluginSendActionRenderAnimePageDropdownItemsEvent()
    const { sendActionClickedEvent } = usePluginSendActionClickedEvent()

    useEffect(() => {
        sendActionRenderAnimePageDropdownItemsEvent({}, "")
    }, [])

    // Listen for the action to render the anime page dropdown items
    usePluginListenActionRenderAnimePageDropdownItemsEvent((event, extensionId) => {
        setItems(p => {
            const otherItems = p.filter(i => i.extensionId !== extensionId)
            const extItems = event.items.map((i: Record<string, any>) => ({ ...i, extensionId } as PluginAnimePageDropdownMenuItem))
            return sortItems([...otherItems, ...extItems])
        })
    }, "")

    // Send
    function handleClick(item: PluginAnimePageDropdownMenuItem) {
        sendActionClickedEvent({
            actionId: item.id,
            event: {
                media: props.media,
            },
        }, item.extensionId)
    }

    if (items.length === 0) return null

    return <>
        <DropdownMenuSeparator />
        {items.map(i => (
            <DropdownMenuItem key={i.id} onClick={() => handleClick(i)} style={i.style} disabled={i.disabled}>{i.label || "???"}</DropdownMenuItem>
        ))}
    </>

}
