import { API_ENDPOINTS } from "@/api/generated/endpoints"
import type { Models_HomeItem } from "@/api/generated/types"
import { useSaveDebridSettings } from "@/api/hooks/debrid.hooks"
import { useSaveSettings } from "@/api/hooks/settings.hooks"
import { useUpdateHomeItems } from "@/api/hooks/status.hooks"
import { useSaveTorrentstreamSettings } from "@/api/hooks/torrentstream.hooks"
import { Button } from "@/components/ui/button/button"
import { cn } from "@/components/ui/core/styling"
import { Select } from "@/components/ui/select/select"
import { Dialog, Sheet } from "@/components/ui/sheet/sheet"
import { Switch } from "@/components/ui/switch/switch"
import { Tabs } from "@/components/ui/tabs/tabs"
import { toast } from "@/components/ui/toast/toast-store"
import { Muted, Text } from "@/components/ui/text/text"
import { type Translate, useTr } from "@/lib/app-language"
import { MOTION_EASE_OUT, PHONE_EASE } from "@/lib/motion"
import { colors } from "@/lib/theme/tokens"
import { useTabletLayout } from "@/lib/use-tablet-ui"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { useQueryClient } from "@tanstack/react-query"
import { randomUUID } from "expo-crypto"
import { atom, useAtom } from "jotai"
import ArrowDown from "lucide-react-native/icons/arrow-down"
import ArrowUp from "lucide-react-native/icons/arrow-up"
import BookOpen from "lucide-react-native/icons/book-open"
import Calendar from "lucide-react-native/icons/calendar"
import CalendarClock from "lucide-react-native/icons/calendar-clock"
import ChartColumn from "lucide-react-native/icons/chart-column"
import CirclePlay from "lucide-react-native/icons/circle-play"
import Clock from "lucide-react-native/icons/clock"
import Cog from "lucide-react-native/icons/cog"
import Compass from "lucide-react-native/icons/compass"
import GalleryHorizontal from "lucide-react-native/icons/gallery-horizontal"
import Heading from "lucide-react-native/icons/letter-h"
import LayoutPanelLeft from "lucide-react-native/icons/layout-panel-left"
import Library from "lucide-react-native/icons/library"
import ListTodo from "lucide-react-native/icons/list-todo"
import Milestone from "lucide-react-native/icons/milestone"
import SquareLibrary from "lucide-react-native/icons/square-library"
import React from "react"
import { Pressable, TextInput, View } from "react-native"
import Animated, { Easing, LinearTransition, ReduceMotion } from "react-native-reanimated"
import { DEFAULT_HOME_ITEMS, HOME_ITEMS } from "./home-items.utils"
import { addHomeItem, availableHomeItemTypes, moveHomeItem, normalizeHomeItems } from "./home-layout"
import { HOME_SECTION_INFO } from "./home-section-info"

export const __home_settingsModalOpen = atom(false)

type IconType = React.ComponentType<{ size?: number, color?: string }>
const HOME_ITEM_ICONS: Record<string, IconType> = {
    "anime-continue-watching": CirclePlay,
    "anime-continue-watching-header": CirclePlay,
    "anime-library": SquareLibrary,
    "local-anime-library": Library,
    "library-upcoming-episodes": Clock,
    "aired-recently": CalendarClock,
    "anime-schedule-calendar": Calendar,
    "local-anime-library-stats": ChartColumn,
    "discover-header": Compass,
    "anime-carousel": GalleryHorizontal,
    "manga-carousel": GalleryHorizontal,
    "manga-library": BookOpen,
    "centered-title": Heading,
    "missed-sequels": Milestone,
    "my-lists": ListTodo,
}

export function homeSectionName(type: string, t: Translate) {
    const info = HOME_SECTION_INFO[type]
    return info ? t(info.name[0], info.name[1]) : HOME_ITEMS[type]?.name || type
}

/**
 * Android Home's "Customize Home" sheet (home-settings-modal.tsx + home-mobile.css .home-mobile-settings): where the library
 * comes from as a two-way choice, the sections on Home with a switch, "?" and up/down/Options each, and the sections that can
 * be added. Every change saves at once (PATCH home items).
 */
export function HomeSettingsSheet({ homeItems: savedItems }: { homeItems?: Models_HomeItem[] | null }) {
    const t = useTr()
    const serverStatus = useServerStatus()
    const [open, setOpen] = useAtom(__home_settingsModalOpen)
    const [optionsFor, setOptionsFor] = React.useState<string | null>(null)
    const { mutate: updateHomeItems, isPending: updating } = useUpdateHomeItems()
    const [items, setItems] = React.useState<Models_HomeItem[]>(savedItems || DEFAULT_HOME_ITEMS)

    // The saved list wins whenever it comes back from the server
    const [seen, setSeen] = React.useState(savedItems)
    if (seen !== savedItems) {
        setSeen(savedItems)
        setItems(savedItems || DEFAULT_HOME_ITEMS)
    }
    // A saved section whose type no longer exists is dropped from the saved list (the web app did this 500 ms after load)
    React.useEffect(() => {
        const current = savedItems || DEFAULT_HOME_ITEMS
        const timer = setTimeout(() => {
            const normalized = normalizeHomeItems(current)
            if (normalized.length !== current.length) updateHomeItems({ items: normalized })
        }, 500)
        return () => clearTimeout(timer)
    }, [savedItems, updateHomeItems])

    const save = (next: Models_HomeItem[], message?: string, after?: () => void) => {
        setItems(next)
        updateHomeItems({ items: next }, {
            onSuccess: () => {
                if (message) toast.success(message)
                after?.()
            },
        })
    }

    const streaming = !!(serverStatus?.torrentstreamSettings?.includeInLibrary || serverStatus?.debridSettings?.includeDebridStreamInLibrary
        || serverStatus?.settings?.library?.includeOnlineStreamingInLibrary)
    const { mutateAsync: saveSettings, isPending: savingSettings } = useSaveSettings()
    const { mutateAsync: saveTorrentstream, isPending: savingTorrentstream } = useSaveTorrentstreamSettings()
    const { mutateAsync: saveDebrid, isPending: savingDebrid } = useSaveDebridSettings()
    const queryClient = useQueryClient()
    const savingSource = savingSettings || savingTorrentstream || savingDebrid

    const setLibrarySource = async (value: string) => {
        if (savingSource || !serverStatus?.settings) return
        const stream = value === "stream"
        await Promise.all([
            saveSettings({ ...serverStatus.settings, library: { ...serverStatus.settings.library!, includeOnlineStreamingInLibrary: stream } } as never),
            saveTorrentstream({ settings: { ...serverStatus.torrentstreamSettings, includeInLibrary: stream } } as never),
            saveDebrid({ settings: { ...serverStatus.debridSettings, includeDebridStreamInLibrary: stream } } as never),
        ])
        await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_COLLECTION.GetLibraryCollection.key] })
        await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_ENTRIES.GetMissingEpisodes.key] })
    }

    const available = availableHomeItemTypes(items).sort((a, b) => homeSectionName(a, t).localeCompare(homeSectionName(b, t)))
    const optionsItem = items.find(item => item.id === optionsFor)
    // Tablet 200 ms on the out curve, phone 220 ms on the phone curve (as the web FLIP)
    const { isTablet } = useTabletLayout()
    const rowGlide = React.useMemo(() => LinearTransition.duration(isTablet ? 200 : 220).easing(Easing.bezier(...(isTablet ? MOTION_EASE_OUT : PHONE_EASE)))
        .reduceMotion(ReduceMotion.System), [isTablet])

    return (
        <>
            <Sheet open={open} onOpenChange={setOpen} title={t("Customize Home", "Home anpassen")}>
                <View className="gap-6">
                    <View>
                        <Text className="mb-2.5 text-base font-bold">{t("Your library", "Deine Bibliothek")}</Text>
                        <Tabs
                            value={streaming ? "stream" : "local"}
                            onValueChange={value => void setLibrarySource(value)}
                            items={[
                                { value: "local", label: t("On this device", "Auf diesem Gerät") },
                                { value: "stream", label: t("Device + streaming", "Gerät + Streaming") },
                            ]}
                        />
                        <Muted className="pt-2.5">
                            {streaming
                                ? t("All anime you are currently watching are included.", "Alle Anime, die du gerade schaust, sind enthalten.")
                                : t("Only anime in your local library are shown.", "Nur Anime aus deiner lokalen Bibliothek werden angezeigt.")}
                        </Muted>
                    </View>

                    <View className="gap-2">
                        <View className="gap-[3px]">
                            <Text accessibilityRole="header" className="text-base font-bold">{t("On your Home", "Auf deiner Startseite")}</Text>
                            <Muted>{t("Changes save automatically.", "Änderungen werden automatisch gespeichert.")}</Muted>
                        </View>
                        <View className="gap-0.5 overflow-hidden rounded-surface">
                            {items.map((item, index) => {
                                const name = homeSectionName(item.type, t)
                                return (
                                    // Move up/down: the rows glide to their new places instead of trading places in one frame
                                    <Animated.View key={item.id} layout={rowGlide}
                                        className="bg-sm-surface-raised py-1 pl-3 pr-1">
                                        <SectionRow type={item.type} name={name} on disabled={updating} onToggle={() => save(normalizeHomeItems(items.filter(i => i.id !== item.id)), t("Home item removed", "Bereich entfernt"))}
                                            notes={[
                                                item.options?.name ? String(item.options.name) : "",
                                                item.type === "centered-title" && !item.options?.text ? t("Add its text in Options", "Text unter Optionen eintragen") : "",
                                                (item.type === "discover-header" || item.type === "anime-continue-watching-header") && index > 0 ? t("Shows only as the first section", "Erscheint nur ganz oben") : "",
                                            ]} />
                                        <View className="flex-row flex-wrap items-center gap-1 pb-1 pl-7">
                                            {([-1, 1] as const).map(direction => (
                                                <Pressable key={direction} accessibilityRole="button"
                                                    accessibilityLabel={`${direction < 0 ? t("Move up", "Nach oben") : t("Move down", "Nach unten")}: ${name}`}
                                                    disabled={updating || (direction < 0 ? index === 0 : index === items.length - 1)}
                                                    onPress={() => save(moveHomeItem(items, index, direction))}
                                                    className="h-11 min-w-11 items-center justify-center rounded-full px-2.5 active:bg-sm-surface-control disabled:opacity-30">
                                                    {direction < 0 ? <ArrowUp size={18} color={colors.smTextMuted} /> : <ArrowDown size={18} color={colors.smTextMuted} />}
                                                </Pressable>
                                            ))}
                                            {!!HOME_ITEMS[item.type]?.options && (
                                                <Pressable accessibilityRole="button" accessibilityLabel={`${t("Options", "Optionen")}: ${name}`} disabled={updating}
                                                    onPress={() => setOptionsFor(item.id)}
                                                    className="h-11 flex-row items-center gap-1.5 rounded-full px-2.5 active:bg-sm-surface-control">
                                                    <Cog size={18} color={colors.smTextMuted} />
                                                    <Text className="text-[13px] text-sm-text-muted">{t("Options", "Optionen")}</Text>
                                                </Pressable>
                                            )}
                                        </View>
                                    </Animated.View>
                                )
                            })}
                        </View>

                        <View className="mt-4 gap-[3px]">
                            <Text accessibilityRole="header" className="text-base font-bold">{t("More sections", "Weitere Bereiche")}</Text>
                            <Muted>{t("Turn one on to add it at the end of Home.", "Einschalten fügt den Bereich am Ende der Startseite hinzu.")}</Muted>
                        </View>
                        <View className="gap-0.5 overflow-hidden rounded-surface">
                            {available.map(type => (
                                <View key={type} className="bg-sm-surface-raised py-1 pl-3 pr-1">
                                    <SectionRow type={type} name={homeSectionName(type, t)} on={false} disabled={updating}
                                        onToggle={() => save(addHomeItem(items, type, randomUUID()), t("Home item added", "Bereich hinzugefügt"))} />
                                </View>
                            ))}
                        </View>
                    </View>
                </View>
            </Sheet>

            {!!optionsItem && (
                <HomeItemOptionsSheet
                    key={optionsItem.id}
                    item={optionsItem}
                    open={!!optionsItem}
                    onClose={() => setOptionsFor(null)}
                    updating={updating}
                    onSave={options => save(normalizeHomeItems(items.map(i => i.id === optionsItem.id ? { ...i, options } : i)),
                        t("Home layout updated", "Startseite aktualisiert"), () => setOptionsFor(null))}
                />
            )}
        </>
    )
}

function SectionRow({ type, name, on, disabled, onToggle, notes = [] }: { type: string, name: string, on: boolean, disabled?: boolean, onToggle: () => void, notes?: string[] }) {
    const Icon = HOME_ITEM_ICONS[type] || LayoutPanelLeft
    return (
        <View className="min-h-12 flex-row items-center gap-2">
            <View className="w-5 items-center"><Icon size={18} color={colors.smTextSubtle} /></View>
            <View className="min-w-0 flex-1">
                <Text className={cn("text-[15px] leading-[20px]", on ? "font-medium text-sm-text" : "font-normal text-sm-text-muted")}>{name}</Text>
                {notes.filter(Boolean).map(note => <Text key={note} className="text-xs text-sm-text-subtle">{note}</Text>)}
            </View>
            <SectionInfo type={type} name={name} />
            <View className="min-h-12 min-w-12 items-center justify-center">
                <Switch checked={on} disabled={disabled} accessibilityLabel={name} onCheckedChange={onToggle} />
            </View>
        </View>
    )
}

/** "?" explains what a section adds: a small centred card over the dimmed sheet; Back closes only the card. */
function SectionInfo({ type, name }: { type: string, name: string }) {
    const t = useTr()
    const [open, setOpen] = React.useState(false)
    const info = HOME_SECTION_INFO[type]
    if (!info) return null
    return (
        <>
            <Pressable accessibilityRole="button" accessibilityLabel={`${t("About", "Info")}: ${name}`} onPress={() => setOpen(true)}
                className="h-12 w-12 items-center justify-center rounded-full">
                <View className="h-6 w-6 items-center justify-center rounded-full bg-sm-surface-control">
                    <Text className="text-[13px] font-semibold leading-[16px] text-sm-text-muted">?</Text>
                </View>
            </Pressable>
            <Dialog open={open} onOpenChange={setOpen} title={name} description={t(info.info[0], info.info[1])} className="max-w-[336px] bg-sm-surface-raised"
                footer={<Button wrapperClassName="flex-1" onPress={() => setOpen(false)}>OK</Button>} />
        </>
    )
}

type OptionSchema = { label: string, name: string, type: string, options?: { label: string, value: string }[], min?: number, max?: number }

/** A section's options: labelled fields, flat chips for several values, Cancel / Save. */
function HomeItemOptionsSheet({ item, open, onClose, onSave, updating }: {
    item: Models_HomeItem
    open: boolean
    onClose: () => void
    onSave: (options: Record<string, unknown>) => void
    updating: boolean
}) {
    const t = useTr()
    const schema = HOME_ITEMS[item.type]
    const [form, setForm] = React.useState<Record<string, unknown>>(() => schema?.schemaVersion === item.schemaVersion ? (item.options || {}) : {})
    if (!schema?.options) return null
    const set = (name: string, value: unknown) => setForm(prev => ({ ...prev, [name]: value }))

    return (
        <Sheet open={open} onOpenChange={o => !o && onClose()} title={`${t("Options", "Optionen")}: ${homeSectionName(item.type, t)}`}
            footer={<>
                <Button intent="secondary" wrapperClassName="flex-1" disabled={updating} onPress={onClose}>{t("Cancel", "Abbrechen")}</Button>
                <Button wrapperClassName="flex-1" loading={updating} onPress={() => onSave(form)}>{t("Save", "Speichern")}</Button>
            </>}>
            {(schema.options as OptionSchema[]).map(option => <OptionField key={option.name} option={option} value={form[option.name]} onChange={value => set(option.name, value)} />)}
        </Sheet>
    )
}

function OptionField({ option, value, onChange }: { option: OptionSchema, value: unknown, onChange: (value: unknown) => void }) {
    const label = <Text className="text-[13px] font-semibold text-sm-text-muted">{option.label}</Text>
    switch (option.type) {
        case "text":
        case "number":
            return (
                <View className="gap-2">
                    {label}
                    <TextInput
                        value={option.type === "number" ? String((value as number) || option.min || 0) : String(value ?? "")}
                        onChangeText={text => {
                            if (option.type !== "number") return onChange(text)
                            const n = Number(text.replace(/[^\d]/g, ""))
                            onChange(Math.min(option.max ?? n, Math.max(option.min ?? n, n)))
                        }}
                        keyboardType={option.type === "number" ? "number-pad" : "default"}
                        placeholder={`Enter ${option.label.toLowerCase()}`}
                        placeholderTextColor={colors.smTextSubtle}
                        accessibilityLabel={option.label}
                        className="min-h-12 rounded-surface-sm bg-sm-surface-raised px-4 font-sans text-base text-sm-text"
                    />
                </View>
            )
        case "select":
            return (
                <View className="gap-2">
                    {label}
                    <Select value={(value as string) || undefined} onValueChange={onChange} options={option.options ?? []}
                        placeholder={`Select ${option.label.toLowerCase()}`} accessibilityLabel={option.label} />
                </View>
            )
        case "multi-select": {
            const picked = Array.isArray(value) ? value as string[] : []
            return (
                <View className="gap-2">
                    {label}
                    <View className="flex-row flex-wrap gap-1.5">
                        {(option.options ?? []).map(opt => {
                            const on = picked.includes(opt.value)
                            return (
                                <Pressable key={opt.value} accessibilityRole="button" accessibilityState={{ selected: on }}
                                    onPress={() => onChange(on ? picked.filter(v => v !== opt.value) : [...picked, opt.value])}
                                    style={{ flexBasis: 128 }}
                                    className={cn("min-h-11 grow justify-center rounded-surface-sm px-3", on ? "bg-sm-accent-soft" : "bg-sm-surface-raised active:bg-sm-surface-control")}>
                                    <Text className={cn("text-sm", on ? "text-sm-text" : "text-sm-text-muted")}>{opt.label}</Text>
                                </Pressable>
                            )
                        })}
                    </View>
                </View>
            )
        }
        default:
            return null
    }
}
