import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { Models_HomeItem } from "@/api/generated/types"
import { useSaveDebridSettings } from "@/api/hooks/debrid.hooks"
import { useSaveSettings } from "@/api/hooks/settings.hooks"
import { useUpdateHomeItems } from "@/api/hooks/status.hooks"
import { useSaveTorrentstreamSettings } from "@/api/hooks/torrentstream.hooks"
import { DEFAULT_HOME_ITEMS, HOME_ITEM_IDS, HOME_ITEMS } from "@/app/(main)/_features/home/home-items.utils"
import { useServerStatus } from "@/app/(main)/_hooks/use-server-status"
import { uuidv4 } from "@/app/websocket-provider"
import { Button } from "@/components/ui/button"
import { cn } from "@/components/ui/core/styling"
import { Modal } from "@/components/ui/modal"
import { NumberInput } from "@/components/ui/number-input"
import { RadioGroup } from "@/components/ui/radio-group"
import { Select } from "@/components/ui/select"
import { TextInput } from "@/components/ui/text-input"
import { useThemeSettings } from "@/lib/theme/theme-hooks"
import { arrayMove } from "@dnd-kit/sortable"
import { useQueryClient } from "@tanstack/react-query"
import { atom } from "jotai"
import { useAtom } from "jotai/react"
import React from "react"
import { BiCog, BiStats } from "react-icons/bi"
import { IoHomeOutline, IoLibraryOutline } from "react-icons/io5"
import {
    LuArrowUp,
    LuArrowDown,
    LuBookOpen,
    LuCalendar,
    LuCalendarClock,
    LuCirclePlay,
    LuClock,
    LuCompass,
    LuHeading,
    LuLayoutPanelLeft,
    LuListTodo,
    LuMilestone,
} from "react-icons/lu"
import { MdOutlineVideoLibrary } from "react-icons/md"
import { TbCarouselHorizontal } from "react-icons/tb"
import { toast } from "sonner"
import { useTr } from "@/lib/app-language"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { HOME_SECTION_INFO } from "./home-section-info"

export const __home_settingsModalOpen = atom(false)

const HOME_ITEM_ICONS = {
    "anime-continue-watching": LuCirclePlay,
    "anime-continue-watching-header": LuCirclePlay,
    "anime-library": MdOutlineVideoLibrary,
    "local-anime-library": IoLibraryOutline,
    "library-upcoming-episodes": LuClock,
    "aired-recently": LuCalendarClock,
    "anime-schedule-calendar": LuCalendar,
    "local-anime-library-stats": BiStats,
    "discover-header": LuCompass,
    "anime-carousel": TbCarouselHorizontal,
    "manga-carousel": TbCarouselHorizontal,
    "manga-continue-reading": LuBookOpen,
    "manga-library": LuBookOpen,
    "centered-title": LuHeading,
    "missed-sequels": LuMilestone,
    "my-lists": LuListTodo,
} as const

/** Android Home's "Customize Home" sheet. */
export function HomeSettingsModal({ emptyLibrary, isNakamaLibrary, homeItems: _homeItems }: { emptyLibrary?: boolean, isNakamaLibrary: boolean, homeItems?: Models_HomeItem[] | null }) {
    const tr = useTr()
    const serverStatus = useServerStatus()
    const ts = useThemeSettings()
    const [isModalOpen, setIsModalOpen] = useAtom(__home_settingsModalOpen)
    const [optionsModalOpen, setOptionsModalOpen] = React.useState<string | null>(null)

    const { mutate: updateHomeItems, isPending: isUpdatingHomeItems } = useUpdateHomeItems()

    const [currentItems, setCurrentItems] = React.useState<Models_HomeItem[]>(_homeItems || DEFAULT_HOME_ITEMS)
    const availableItems = HOME_ITEM_IDS.filter(type => {
        if (type === "anime-carousel" || type === "manga-carousel" || type === "centered-title" || type === "my-lists") {
            return true
        }
        return !currentItems.some(item => item.type === type)
    })

    const checkTimeRef = React.useRef<NodeJS.Timeout | null>(null)
    React.useEffect(() => {
        const homeItems = _homeItems || DEFAULT_HOME_ITEMS
        setCurrentItems(homeItems)

        if (checkTimeRef.current) {
            clearTimeout(checkTimeRef.current)
            checkTimeRef.current = null
        }

        // Check if an item doesn't exist anymore and remove it
        checkTimeRef.current = setTimeout(() => {
            const newItems = normalizeHomeItems(currentItems)

            if (newItems.length !== homeItems.length) {
                setCurrentItems(newItems)
                updateHomeItems({ items: newItems })
            }
        }, 500)

        return () => {
            if (checkTimeRef.current) {
                clearTimeout(checkTimeRef.current)
                checkTimeRef.current = null
            }
        }
    }, [_homeItems])

    function normalizeHomeItems(items: Models_HomeItem[]) {
        let newItems = items.filter(item => !!HOME_ITEMS[item.type])
        newItems = newItems.map(item => ({
            ...item,
            schemaVersion: HOME_ITEMS[item.type].schemaVersion,
        }))
        return newItems
    }

    const handleAddItem = (type: string) => {
        const newItem: Models_HomeItem = {
            id: uuidv4(),
            type,
            schemaVersion: HOME_ITEMS[type].schemaVersion,
        }

        const newItems = normalizeHomeItems([...currentItems, newItem])
        setCurrentItems(newItems)
        updateHomeItems({ items: newItems }, {
            onSuccess: () => {
                toast.success("Home item added")
            },
        })
    }

    const handleRemoveItem = (id: string) => {
        const newItems = normalizeHomeItems(currentItems.filter(item => item.id !== id))
        setCurrentItems(newItems)
        updateHomeItems({ items: newItems }, {
            onSuccess: () => {
                toast.success("Home item removed")
            },
        })
    }

    const handleUpdateItemOptions = (id: string, options: any) => {
        const newItems = normalizeHomeItems(currentItems.map(item =>
            item.id === id
                ? { ...item, options }
                : item,
        ))
        setCurrentItems(newItems)
        updateHomeItems({ items: newItems }, {
            onSuccess: () => {
                toast.success("Home layout updated")
                setOptionsModalOpen(null)
            },
        })
    }

    const animeLibraryType = (serverStatus?.torrentstreamSettings?.includeInLibrary || serverStatus?.debridSettings?.includeDebridStreamInLibrary || serverStatus?.settings?.library?.includeOnlineStreamingInLibrary)
        ?
        "stream"
        : "local"

    const { mutateAsync: updateSettings, isPending: isSavingSettings } = useSaveSettings()
    const { mutateAsync: updateTorrentstreamSettings, isPending: isSavingTorrentstreamSettings } = useSaveTorrentstreamSettings()
    const { mutateAsync: updateDebridSettings, isPending: isSavingDebridSettings } = useSaveDebridSettings()
    const queryClient = useQueryClient()

    return (
        <>
            <Modal
                data-home-settings-modal
                open={isModalOpen}
                onOpenChange={setIsModalOpen}
                title={<div className="flex items-center gap-2 w-full justify-center">
                    <IoHomeOutline className="size-5" />
                    {tr("Customize Home", "Home anpassen")}
                </div>}
                contentClass={cn(
                    "max-w-5xl sm:rounded-3xl",
                    "home-mobile-settings",
                    // ts.enableBlurringEffects && "bg-gray-950 bg-opacity-80 backdrop-blur-sm firefox:bg-opacity-100 firefox:backdrop-blur-none",
                )}
                overlayClass={cn(ts.enableBlurringEffects && "bg-gray-950/70 backdrop-blur-sm")}
                // Touch: no focus ring on the first control when the sheet opens.
                onOpenAutoFocus={e => e.preventDefault()}
            >

                <div className={cn("space-y-6", "home-settings-body")}>
                    <div className="home-library-source">
                        <div className="flex items-center gap-2 mb-4">
                            <LuCirclePlay className="size-5" />
                            <h4 className="text-lg font-semibold">{tr("Your library", "Deine Bibliothek")}</h4>
                        </div>

                        <RadioGroup
                            value={animeLibraryType}
                            onValueChange={value => {
                                (async () => {
                                    await Promise.all([
                                        updateSettings({
                                            ...(serverStatus?.settings as any),
                                            library: {
                                                ...(serverStatus?.settings?.library as any)!,
                                                includeOnlineStreamingInLibrary: value === "stream",
                                            },
                                        }),
                                        updateTorrentstreamSettings({
                                            settings: {
                                                ...(serverStatus?.torrentstreamSettings as any),
                                                includeInLibrary: value === "stream",
                                            },
                                        }),
                                        updateDebridSettings({
                                            settings: {
                                                ...(serverStatus?.debridSettings as any),
                                                includeDebridStreamInLibrary: value === "stream",
                                            },
                                        }),
                                    ])
                                    await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_COLLECTION.GetLibraryCollection.key] })
                                    await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_ENTRIES.GetMissingEpisodes.key] })
                                })()
                            }}
                            disabled={isSavingSettings || isSavingTorrentstreamSettings || isSavingDebridSettings}
                            options={[
                                { label: tr("On this device", "Auf diesem Gerät"), value: "local" },
                                { label: tr("Device + streaming", "Gerät + Streaming"), value: "stream" },
                            ]}

                            {...{
                                itemClass: cn(
                                    "border-transparent absolute top-2 right-2 bg-transparent dark:bg-transparent dark:data-[state=unchecked]:bg-transparent",
                                    "data-[state=unchecked]:bg-transparent data-[state=unchecked]:hover:bg-transparent dark:data-[state=unchecked]:hover:bg-transparent",
                                    "focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:ring-offset-transparent",
                                ),
                                stackClass: "space-y-0 grid grid-cols-1 sm:grid-cols-2 gap-2 min-w-0",
                                itemIndicatorClass: "hidden",
                                itemLabelClass: "font-normal text-center tracking-wide whitespace-normal break-words min-w-0 data-[state=checked]:text-[--gray] cursor-pointer",
                                itemContainerClass: cn(
                                    "items-center cursor-pointer transition border-transparent rounded-[--radius] min-h-12 py-2 px-3 w-full min-w-0",
                                    "hover:bg-[--subtle] --dark:bg-gray-900",
                                    "data-[state=checked]:bg-white dark:data-[state=unchecked]:hover:bg-[--subtle] dark:data-[state=checked]:bg-gray-900",
                                    "focus:ring-2 ring-transparent dark:ring-transparent outline-none ring-offset-1 ring-offset-[--background] focus-within:ring-2 transition",
                                    "border border-transparent data-[state=checked]:border-[--border] data-[state=checked]:ring-offset-0",
                                ),
                            }}
                        />

                        <p className="text-sm text-[--muted] pt-4">
                            {animeLibraryType === "local"
                                ? tr("Only anime in your local library are shown.", "Nur Anime aus deiner lokalen Bibliothek werden angezeigt.")
                                : tr("All anime you are currently watching are included.", "Alle Anime, die du gerade schaust, sind enthalten.")}
                        </p>


                    </div>

                    <section className="home-customize" aria-labelledby="home-customize-active">
                        <div className="home-customize-heading">
                            <h3 id="home-customize-active">{tr("On your Home", "Auf deiner Startseite")}</h3>
                            <p>{tr("Changes save automatically.", "Änderungen werden automatisch gespeichert.")}</p>
                        </div>
                        <ul className="home-customize-list">
                            {currentItems.map((item, index) => {
                                const name = homeSectionName(item.type, tr)
                                return <li className="home-customize-row" data-home-mobile-item={item.id} data-home-item-type={item.type} key={item.id}>
                                    <div className="home-customize-main">
                                        <span className="home-customize-icon" aria-hidden>{React.createElement(HOME_ITEM_ICONS[item.type as keyof typeof HOME_ITEM_ICONS] || LuLayoutPanelLeft)}</span>
                                        <span className="home-customize-name">{name}{!!item.options?.name && <small>{item.options.name}</small>}
                                            {item.type === "centered-title" && !item.options?.text && <small>{tr("Add its text in Options", "Text unter Optionen eintragen")}</small>}
                                            {(item.type === "discover-header" || item.type === "anime-continue-watching-header") && index > 0 &&
                                                <small>{tr("Shows only as the first section", "Erscheint nur ganz oben")}</small>}</span>
                                        <HomeSectionInfo type={item.type} name={name} />
                                        <HomeSectionSwitch checked name={name} disabled={isUpdatingHomeItems} onChange={() => handleRemoveItem(item.id)} />
                                    </div>
                                    <div className="home-customize-tools">
                                        {([-1, 1] as const).map(direction => <button key={direction} type="button" className="home-customize-tool"
                                            disabled={isUpdatingHomeItems || (direction < 0 ? index === 0 : index === currentItems.length - 1)}
                                            aria-label={`${direction < 0 ? tr("Move up", "Nach oben") : tr("Move down", "Nach unten")}: ${name}`}
                                            onClick={() => updateHomeItems({ items: normalizeHomeItems(arrayMove(currentItems, index, index + direction)) })}>
                                            {direction < 0 ? <LuArrowUp aria-hidden /> : <LuArrowDown aria-hidden />}
                                        </button>)}
                                        {HOME_ITEMS[item.type]?.options && <button type="button" className="home-customize-tool home-customize-options" disabled={isUpdatingHomeItems}
                                            aria-label={`${tr("Options", "Optionen")}: ${name}`} onClick={() => setOptionsModalOpen(item.id)}>
                                            <BiCog aria-hidden /><span>{tr("Options", "Optionen")}</span>
                                        </button>}
                                    </div>
                                </li>
                            })}
                        </ul>
                        <div className="home-customize-heading">
                            <h3>{tr("More sections", "Weitere Bereiche")}</h3>
                            <p>{tr("Turn one on to add it at the end of Home.", "Einschalten fügt den Bereich am Ende der Startseite hinzu.")}</p>
                        </div>
                        <ul className="home-customize-list">
                            {availableItems.toSorted((a, b) => homeSectionName(a, tr).localeCompare(homeSectionName(b, tr))).map(type => {
                                const name = homeSectionName(type, tr)
                                return <li className="home-customize-row is-off" data-home-available-item={type} key={type}>
                                    <div className="home-customize-main">
                                        <span className="home-customize-icon" aria-hidden>{React.createElement(HOME_ITEM_ICONS[type as keyof typeof HOME_ITEM_ICONS] || LuLayoutPanelLeft)}</span>
                                        <span className="home-customize-name">{name}</span>
                                        <HomeSectionInfo type={type} name={name} />
                                        <HomeSectionSwitch checked={false} name={name} disabled={isUpdatingHomeItems} onChange={() => handleAddItem(type)} />
                                    </div>
                                </li>
                            })}
                        </ul>
                    </section>
                </div>
            </Modal>

            {optionsModalOpen && (
                <HomeItemOptionsModal
                    id={optionsModalOpen}
                    item={currentItems.find(item => item.id === optionsModalOpen)!}
                    isOpen={!!optionsModalOpen}
                    onClose={() => setOptionsModalOpen(null)}
                    onSave={handleUpdateItemOptions}
                    isUpdating={isUpdatingHomeItems}
                />
            )}
        </>
    )
}

function homeSectionName(type: string, tr: (en: string, de: string) => string) {
    const info = HOME_SECTION_INFO[type]
    return info ? tr(info.name[0], info.name[1]) : HOME_ITEMS[type]?.name || type
}

function HomeSectionSwitch({ checked, name, disabled, onChange }: { checked: boolean, name: string, disabled?: boolean, onChange: () => void }) {
    return <button type="button" role="switch" aria-checked={checked} aria-label={name} className="home-customize-switch" disabled={disabled} onClick={onChange}>
        <span aria-hidden />
    </button>
}

/** "?" explains what a section adds: a small centered card over a dimmed, blurred backdrop. */
function HomeSectionInfo({ type, name }: { type: string, name: string }) {
    const tr = useTr()
    const [open, setOpen] = React.useState(false)
    const info = HOME_SECTION_INFO[type]
    React.useEffect(() => {
        if (!open) return
        // Android Back and Escape close only this card, not the Customize sheet underneath.
        // Window capture runs before the dialogs' document listeners.
        const back = (event: Event) => {
            if (event instanceof KeyboardEvent && event.key !== "Escape") return
            event.preventDefault()
            event.stopPropagation()
            setOpen(false)
        }
        window.addEventListener("seanime:android-back", back)
        window.addEventListener("keydown", back, true)
        return () => {
            window.removeEventListener("seanime:android-back", back)
            window.removeEventListener("keydown", back, true)
        }
    }, [open])
    if (!info) return null
    return <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Trigger asChild>
            <button type="button" className="home-customize-info" aria-label={`${tr("About", "Info")}: ${name}`}><span aria-hidden>?</span></button>
        </DialogPrimitive.Trigger>
        <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="home-info-overlay" />
            <DialogPrimitive.Content className="home-info-card" data-home-section-info={type}>
                <DialogPrimitive.Title>{name}</DialogPrimitive.Title>
                <DialogPrimitive.Description>{tr(info.info[0], info.info[1])}</DialogPrimitive.Description>
                <DialogPrimitive.Close asChild><button type="button" className="home-info-ok">OK</button></DialogPrimitive.Close>
            </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
}

interface HomeItemOptionsModalProps {
    id: string
    item: Models_HomeItem
    isOpen: boolean
    onClose: () => void
    onSave: (id: string, options: any) => void
    isUpdating: boolean
}

function HomeItemOptionsModal({ id, item, isOpen, onClose, onSave, isUpdating }: HomeItemOptionsModalProps) {
    const tr = useTr()
    const homeItemConfig = HOME_ITEMS[item.type]
    const [formData, setFormData] = React.useState<Record<string, any>>(item.options || {})

    React.useEffect(() => {
        if (!homeItemConfig || homeItemConfig.schemaVersion !== item.schemaVersion) {
            setFormData({})
            return
        }
        setFormData(item.options || {})
    }, [item.options, homeItemConfig])

    if (!homeItemConfig?.options) return null

    const handleFieldChange = (fieldName: string, value: any) => {
        setFormData(prev => ({
            ...prev,
            [fieldName]: value,
        }))
    }

    const handleSave = () => {
        onSave(id, formData)
    }

    return (
        <Modal
            open={isOpen}
            onOpenChange={onClose}
            title={tr("Options", "Optionen") + ": " + homeSectionName(item.type, tr)}
            contentClass={cn("max-w-2xl bg-gray-950 bg-opacity-90 firefox:bg-opacity-100 firefox:backdrop-blur-none sm:rounded-3xl", "home-mobile-settings home-mobile-options")}
            overlayClass="bg-black/80"
        >
            <div className="space-y-6">
                <div className="space-y-4">
                    {(homeItemConfig.options || []).map((option: any) => (
                        <OptionField
                            key={option.name}
                            option={option}
                            value={formData[option.name]}
                            onChange={(value) => handleFieldChange(option.name, value)}
                        />
                    ))}
                </div>

                <div className={cn("flex justify-end gap-3 pt-4 border-t border-gray-800", "home-options-actions")}>
                    <Button
                        intent="gray-subtle"
                        onClick={onClose}
                        disabled={isUpdating}
                    >
                        {tr("Cancel", "Abbrechen")}
                    </Button>
                    <Button
                        intent="primary"
                        onClick={handleSave}
                        loading={isUpdating}
                    >
                        {tr("Save", "Speichern")}
                    </Button>
                </div>
            </div>
        </Modal>
    )
}

interface OptionFieldProps {
    option: any
    value: any
    onChange: (value: any) => void
}

function OptionField({ option, value, onChange }: OptionFieldProps) {
    const { label, type, name, options, min, max } = option

    const handleMultiSelectChange = (selectedValue: string) => {
        const currentValues = Array.isArray(value) ? value : []
        const newValues = currentValues.includes(selectedValue)
            ? currentValues.filter((v: any) => v !== selectedValue)
            : [...currentValues, selectedValue]
        onChange(newValues)
    }

    switch (type) {
        case "text":
            return (
                <div className="space-y-2">
                    <label className="text-sm font-medium text-white">{label}</label>
                    <TextInput
                        value={value || ""}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder={`Enter ${label.toLowerCase()}`}
                    />
                </div>
            )

        case "number":
            return (
                <div className="space-y-2">
                    <label className="text-sm font-medium text-white">{label}</label>
                    <NumberInput
                        value={value || min || 0}
                        onValueChange={(valueAsNumber) => onChange(valueAsNumber)}
                        min={min}
                        max={max}
                        formatOptions={{ useGrouping: false }}
                    />
                </div>
            )

        case "select":
            return (
                <div className="space-y-2">
                    <label className="text-sm font-medium text-white">{label}</label>
                    <Select
                        value={value || ""}
                        onValueChange={onChange}
                        placeholder={`Select ${label.toLowerCase()}`}
                        options={[
                            ...options,
                        ]}
                    />
                </div>
            )

        case "multi-select":
            const selectedValues = Array.isArray(value) ? value : []
            return (
                <div className="space-y-2">
                    <label className="text-sm font-medium text-white">{label}</label>
                    <div className="home-option-chips grid grid-cols-2 md:grid-cols-3 gap-2 max-h-48 overflow-y-auto p-3 bg-gray-900/30 rounded-lg border border-gray-800">
                        {options.map((opt: any) => (
                            <button
                                key={opt.value}
                                type="button"
                                aria-pressed={selectedValues.includes(opt.value)}
                                onClick={() => handleMultiSelectChange(opt.value)}
                                className={cn(
                                    "p-2 text-sm rounded-md border transition-colors text-left",
                                    selectedValues.includes(opt.value)
                                        ? "bg-brand-500/20 border-brand-500 text-brand-300"
                                        : "bg-gray-800/50 border-gray-700 text-gray-300 hover:border-gray-600",
                                )}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </div>
            )

        default:
            return (
                <div className="text-sm text-gray-400">
                    Unsupported field type: {type}
                </div>
            )
    }
}
