import { API_ENDPOINTS } from "@/api/generated/endpoints"
import type { Models_HomeItem } from "@/api/generated/types"
import { useSaveDebridSettings } from "@/api/hooks/debrid.hooks"
import { HOME_ITEMS_QUERY_KEY } from "@/api/hooks/home-items-sync"
import { useSaveSettings } from "@/api/hooks/settings.hooks"
import { useGetHomeItems, useUpdateHomeItems } from "@/api/hooks/status.hooks"
import { useSaveTorrentstreamSettings } from "@/api/hooks/torrentstream.hooks"
import { Button } from "@/components/ui/button/button"
import { cn } from "@/components/ui/core/styling"
import { Select } from "@/components/ui/select/select"
import { Dialog, Sheet } from "@/components/ui/sheet/sheet"
import { Tabs } from "@/components/ui/tabs/tabs"
import { toast } from "@/components/ui/toast/toast-store"
import { Muted, Text } from "@/components/ui/text/text"
import { type Translate, useTr } from "@/lib/app-language"
import { MOTION_EASE_OUT, PHONE_EASE } from "@/lib/motion"
import { colors, accentInput } from "@/lib/theme/tokens"
import { useThemeColors } from "@/lib/theme/appearance"
import { useTabletLayout } from "@/lib/use-tablet-ui"
import { genreLabel } from "@/main/discover/_lib/discover-phone"
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
import CircleMinus from "lucide-react-native/icons/circle-minus"
import CirclePlay from "lucide-react-native/icons/circle-play"
import CirclePlus from "lucide-react-native/icons/circle-plus"
import Clock from "lucide-react-native/icons/clock"
import Cog from "lucide-react-native/icons/cog"
import Compass from "lucide-react-native/icons/compass"
import GalleryHorizontal from "lucide-react-native/icons/gallery-horizontal"
import Info from "lucide-react-native/icons/info"
import Heading from "lucide-react-native/icons/letter-h"
import LayoutPanelLeft from "lucide-react-native/icons/layout-panel-left"
import Library from "lucide-react-native/icons/library"
import ListTodo from "lucide-react-native/icons/list-todo"
import Milestone from "lucide-react-native/icons/milestone"
import Pin from "lucide-react-native/icons/pin"
import RotateCcw from "lucide-react-native/icons/rotate-ccw"
import SquareLibrary from "lucide-react-native/icons/square-library"
import React from "react"
import { Keyboard, Pressable, TextInput, View } from "react-native"
import Animated, { Easing, LinearTransition, ReduceMotion } from "react-native-reanimated"
import { DEFAULT_HOME_ITEMS, HOME_ITEMS } from "./home-items.utils"
import {
    addHomeItem,
    availableHomeItemTypes,
    canMoveHomeItem,
    defaultHomeOptions,
    isDefaultHome,
    isTopBanner,
    moveHomeItem,
    normalizeHomeItems,
    removeHomeItem,
    restoreHomeItem,
} from "./home-layout"
import {
    ANY_CHOICE,
    cleanHomeOptions,
    hasCustomOptions,
    homeOptionWarnings,
    type HomeOptions,
    isPlausibleYear,
    parseYearInput,
    selectState,
    withOption,
    YEAR_MIN,
    yearMax,
    yearText,
} from "./home-options"
import { carouselDefaultName, HOME_SECTION_INFO, homeOptionLabel } from "./home-section-info"

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

function homeSectionSummary(type: string, t: Translate) {
    const info = HOME_SECTION_INFO[type]
    return info ? t(info.summary[0], info.summary[1]) : ""
}

/**
 * Android Home's "Customize Home" sheet (home-settings-modal.tsx + home-mobile.css .home-mobile-settings): where the library
 * comes from as a two-way choice, the sections on Home (name, what it shows, up/down, Options, remove with Undo; a banner
 * stays on top), the sections that can still be added, and the default Home back after asking. Every change shows and
 * saves at once (home-items-sync.ts); a failed save brings the list back.
 */
export function HomeSettingsSheet() {
    const t = useTr()
    const serverStatus = useServerStatus()
    const [open, setOpen] = useAtom(__home_settingsModalOpen)
    const queryClient = useQueryClient()
    const { data: savedItems, isSuccess: loaded, isError: loadFailed } = useGetHomeItems()
    const { mutate: updateHomeItems } = useUpdateHomeItems()
    // The saved list as Home shows it; unsaved means the default sections, an emptied Home stays empty
    const items = React.useMemo(() => normalizeHomeItems(savedItems ?? DEFAULT_HOME_ITEMS), [savedItems])
    // Undo acts on the list as it is when tapped, not as it was when the toast came
    const currentItems = () => normalizeHomeItems(queryClient.getQueryData<Models_HomeItem[] | null>(HOME_ITEMS_QUERY_KEY) ?? DEFAULT_HOME_ITEMS)
    const save = (next: Models_HomeItem[]) => updateHomeItems({ items: next })

    // The options sheet stays mounted while it slides out; a new opening starts a fresh form
    const [options, setOptions] = React.useState<{ id: string, session: number } | null>(null)
    const [optionsOpen, setOptionsOpen] = React.useState(false)
    const optionsItem = options ? items.find(item => item.id === options.id) : undefined
    const openOptions = (id: string) => {
        setOptions(prev => ({ id, session: (prev?.session ?? 0) + 1 }))
        setOptionsOpen(true)
    }
    const [confirmDefaults, setConfirmDefaults] = React.useState(false)

    const remove = (item: Models_HomeItem, index: number) => {
        save(removeHomeItem(items, item.id))
        toast(t("Section removed", "Bereich entfernt"), {
            id: "home-section-removed",
            duration: 6000,
            description: homeSectionName(item.type, t),
            action: { label: t("Undo", "Rückgängig"), onClick: () => save(restoreHomeItem(currentItems(), item, index)) },
        })
    }
    const restoreDefaults = () => {
        const before = items
        save(normalizeHomeItems(DEFAULT_HOME_ITEMS))
        toast(t("Default Home restored", "Standard-Startseite wiederhergestellt"), {
            id: "home-defaults-restored",
            duration: 6000,
            action: { label: t("Undo", "Rückgängig"), onClick: () => save(before) },
        })
    }

    const streaming = !!(serverStatus?.torrentstreamSettings?.includeInLibrary || serverStatus?.debridSettings?.includeDebridStreamInLibrary
        || serverStatus?.settings?.library?.includeOnlineStreamingInLibrary)
    const hasLibraryFolder = !!serverStatus?.settings?.library?.libraryPath
    const { mutateAsync: saveSettings, isPending: savingSettings } = useSaveSettings()
    const { mutateAsync: saveTorrentstream, isPending: savingTorrentstream } = useSaveTorrentstreamSettings()
    const { mutateAsync: saveDebrid, isPending: savingDebrid } = useSaveDebridSettings()
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
    const needs = (type: string) => {
        const need = HOME_SECTION_INFO[type]?.needs
        // a local folder can be checked: say it only while there is none
        if (!need || (type.startsWith("local-anime-library") && hasLibraryFolder)) return ""
        return t(need[0], need[1])
    }
    // Tablet 200 ms on the out curve, phone 220 ms on the phone curve (as the web FLIP)
    const { isTablet } = useTabletLayout()
    const rowGlide = React.useMemo(() => LinearTransition.duration(isTablet ? 200 : 220).easing(Easing.bezier(...(isTablet ? MOTION_EASE_OUT : PHONE_EASE)))
        .reduceMotion(ReduceMotion.System), [isTablet])

    return (
        <>
            <Sheet open={open} onOpenChange={setOpen} title={t("Customize Home", "Startseite anpassen")}>
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

                    {!loaded ? (
                        // Editing a list that did not load would save the defaults over the saved one
                        <Muted accessibilityRole={loadFailed ? "alert" : undefined}>
                            {loadFailed
                                ? t("Your Home layout could not load. Close this and try again.", "Deine Startseiten-Anordnung konnte nicht geladen werden. Schließe das hier und versuche es erneut.")
                                : t("Loading Home", "Startseite wird geladen")}
                        </Muted>
                    ) : (
                        <>
                            <View className="gap-2">
                                <View className="gap-[3px]">
                                    <Text accessibilityRole="header" className="text-base font-bold">{t("On your Home", "Auf deiner Startseite")}</Text>
                                    <Muted>{t("Changes save automatically.", "Änderungen werden automatisch gespeichert.")}</Muted>
                                </View>
                                {items.length ? (
                                    <View className="gap-0.5 overflow-hidden rounded-surface">
                                        {items.map((item, index) => (
                                            // Moves, adds and removals: the rows glide to their new places instead of jumping
                                            <Animated.View key={item.id} layout={rowGlide} className="bg-sm-surface-raised py-1 pl-3 pr-1">
                                                <HomeSectionRow item={item} index={index} items={items} needs={needs(item.type)}
                                                    onMove={direction => save(moveHomeItem(items, index, direction))}
                                                    onOptions={() => openOptions(item.id)}
                                                    onRemove={() => remove(item, index)} />
                                            </Animated.View>
                                        ))}
                                    </View>
                                ) : (
                                    <View className="rounded-surface bg-sm-surface-raised p-4">
                                        <Text className="text-[15px] leading-[21px] text-sm-text-muted">{t("Your Home has no sections. Add one below.", "Deine Startseite hat keine Bereiche. Füge unten einen hinzu.")}</Text>
                                    </View>
                                )}
                            </View>

                            <View className="gap-2">
                                <View className="gap-[3px]">
                                    <Text accessibilityRole="header" className="text-base font-bold">{t("Add a section", "Bereich hinzufügen")}</Text>
                                    {!!available.length && <Muted>{t("Banners go on top, other sections at the end of Home.", "Banner kommen nach oben, andere Bereiche ans Ende der Startseite.")}</Muted>}
                                </View>
                                {available.length ? (
                                    <View className="gap-0.5 overflow-hidden rounded-surface">
                                        {available.map(type => (
                                            <Animated.View key={type} layout={rowGlide}>
                                                <AddSectionRow type={type} needs={needs(type)} onAdd={() => save(addHomeItem(items, type, randomUUID()))} />
                                            </Animated.View>
                                        ))}
                                    </View>
                                ) : (
                                    <Muted>{t("Every section is already on your Home.", "Alle Bereiche sind schon auf deiner Startseite.")}</Muted>
                                )}
                            </View>

                            <Button intent="secondary" wrapperClassName="self-start" disabled={isDefaultHome(items)}
                                leftIcon={<RotateCcw size={18} color={colors.smText} />} onPress={() => setConfirmDefaults(true)}>
                                {t("Restore default Home", "Standard-Startseite wiederherstellen")}
                            </Button>
                        </>
                    )}
                </View>
                <Dialog open={confirmDefaults} onOpenChange={setConfirmDefaults} className="bg-sm-surface-raised"
                    title={t("Restore the default Home?", "Standard-Startseite wiederherstellen?")}
                    description={t("Home goes back to Continue watching and Anime library. Your other sections and their options are removed.",
                        "Die Startseite zeigt wieder Weiterschauen und Anime-Bibliothek. Deine anderen Bereiche und ihre Optionen werden entfernt.")}
                    footer={<>
                        <Button intent="secondary" onPress={() => setConfirmDefaults(false)}>{t("Cancel", "Abbrechen")}</Button>
                        <Button onPress={() => {
                            setConfirmDefaults(false)
                            restoreDefaults()
                        }}>{t("Restore", "Wiederherstellen")}</Button>
                    </>} />
            </Sheet>

            {!!options && (
                <HomeItemOptionsSheet
                    key={`${options.id}:${options.session}`}
                    item={optionsItem}
                    // a section removed meanwhile (Undo toast, another device) closes its options
                    open={optionsOpen && !!optionsItem}
                    onClose={() => setOptionsOpen(false)}
                    onSave={next => {
                        save(normalizeHomeItems(items.map(i => i.id === options.id ? { ...i, options: cleanHomeOptions(next) } : i)))
                        setOptionsOpen(false)
                    }}
                />
            )}
        </>
    )
}

function SectionIcon({ type }: { type: string }) {
    const Icon = HOME_ITEM_ICONS[type] || LayoutPanelLeft
    return <View className="h-12 w-5 items-center justify-center"><Icon size={18} color={colors.smTextSubtle} /></View>
}

/** Name, what the section shows and its notes, in one block (TalkBack reads it as one). */
function SectionText({ name, summary, notes }: { name: string, summary: string, notes: string[] }) {
    return (
        <View accessible className="min-w-0 flex-1 justify-center py-2">
            <Text className="text-[15px] font-medium leading-[20px] text-sm-text">{name}</Text>
            {!!summary && <Text className="text-[13px] leading-[18px] text-sm-text-muted">{summary}</Text>}
            {notes.filter(Boolean).map(note => <Text key={note} className="pt-0.5 text-xs leading-[16px] text-sm-text-subtle">{note}</Text>)}
        </View>
    )
}

/** A section on Home: its text and "?", then up/down (a banner instead says it stays on top), Options and Remove. */
function HomeSectionRow({ item, index, items, needs, onMove, onOptions, onRemove }: {
    item: Models_HomeItem
    index: number
    items: Models_HomeItem[]
    needs: string
    onMove: (direction: -1 | 1) => void
    onOptions: () => void
    onRemove: () => void
}) {
    const t = useTr()
    const name = homeSectionName(item.type, t)
    const banner = isTopBanner(items, index)
    const title = item.options?.name ? `“${String(item.options.name)}”` : ""
    const missingText = item.type === "centered-title" && !item.options?.text ? t("Add its text in Options", "Text unter Optionen eintragen") : ""
    return (
        <>
            <View className="flex-row items-start gap-2">
                <SectionIcon type={item.type} />
                <SectionText name={name} summary={homeSectionSummary(item.type, t)} notes={[title, missingText, needs]} />
                <SectionInfo type={item.type} name={name} />
            </View>
            <View className="flex-row flex-wrap items-center gap-1 pl-7">
                {banner ? (
                    <View className="h-12 flex-row items-center gap-1.5 px-2.5">
                        <Pin size={16} color={colors.smTextMuted} />
                        <Text className="text-[13px] text-sm-text-muted">{t("Always on top", "Immer oben")}</Text>
                    </View>
                ) : ([-1, 1] as const).map(direction => (
                    <Pressable key={direction} accessibilityRole="button"
                        accessibilityLabel={`${direction < 0 ? t("Move up", "Nach oben") : t("Move down", "Nach unten")}: ${name}`}
                        disabled={!canMoveHomeItem(items, index, direction)}
                        onPress={() => onMove(direction)}
                        className="h-12 w-12 items-center justify-center rounded-full active:bg-sm-surface-control disabled:opacity-30">
                        {direction < 0 ? <ArrowUp size={18} color={colors.smTextMuted} /> : <ArrowDown size={18} color={colors.smTextMuted} />}
                    </Pressable>
                ))}
                {!!HOME_ITEMS[item.type]?.options && (
                    <Pressable accessibilityRole="button" accessibilityLabel={`${t("Options", "Optionen")}: ${name}`}
                        onPress={onOptions}
                        className="h-12 flex-row items-center gap-1.5 rounded-full px-3 active:bg-sm-surface-control">
                        <Cog size={18} color={colors.smTextMuted} />
                        <Text className="text-[13px] font-medium text-sm-text-muted">{t("Options", "Optionen")}</Text>
                    </Pressable>
                )}
                <View className="flex-1" />
                <Pressable accessibilityRole="button" accessibilityLabel={`${t("Remove", "Entfernen")}: ${name}`}
                    onPress={onRemove}
                    className="h-12 w-12 items-center justify-center rounded-full active:bg-sm-surface-control">
                    <CircleMinus size={20} color={colors.smTextMuted} />
                </Pressable>
            </View>
        </>
    )
}

/** A section that is not on Home: one tap on it adds it; "?" explains it first. */
function AddSectionRow({ type, needs, onAdd }: { type: string, needs: string, onAdd: () => void }) {
    const colors = useThemeColors()
    const t = useTr()
    const name = homeSectionName(type, t)
    const summary = homeSectionSummary(type, t)
    return (
        <View className="flex-row items-center bg-sm-surface-raised pr-1">
            <Pressable accessibilityRole="button" accessibilityLabel={`${t("Add", "Hinzufügen")}: ${name}`}
                accessibilityHint={[summary, needs].filter(Boolean).join(". ")}
                onPress={onAdd}
                className="min-h-14 min-w-0 flex-1 flex-row items-center gap-2 py-1 pl-3 active:bg-sm-surface-control">
                <SectionIcon type={type} />
                <SectionText name={name} summary={summary} notes={[needs]} />
                <View className="h-12 w-12 items-center justify-center"><CirclePlus size={22} color={colors.smAccent} /></View>
            </Pressable>
            <SectionInfo type={type} name={name} />
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

type OptionSchema = { label: string, name: string, type: string, options?: { label: string, value: string }[] }

/**
 * A section's options: labelled fields whose empty state says what the section then does, hints for combinations that
 * will likely find nothing, "Reset options", Cancel / Save. The sheet takes the keyboard down as it opens and closes
 * (Sheet); Cancel and Save let the name field go first, else the keyboard came back over the next page without a field
 * (Home › "Add series to your collection" › Discover).
 */
function HomeItemOptionsSheet({ item: openedWith, open, onClose, onSave }: {
    item: Models_HomeItem | undefined
    open: boolean
    onClose: () => void
    onSave: (options: HomeOptions) => void
}) {
    const colors = useThemeColors()
    const t = useTr()
    // The section as it was when its options opened: the sheet keeps it while it slides out, also after a removal
    const [item] = React.useState(openedWith)
    const schema = item ? HOME_ITEMS[item.type] : undefined
    const [form, setForm] = React.useState<HomeOptions>(() => (item && schema?.schemaVersion === item.schemaVersion ? item.options : undefined) ?? {})
    // "Reset options" starts the fields over (the year field keeps its own text)
    const [resets, setResets] = React.useState(0)
    if (!item || !schema?.options) return null
    const type = item.type
    const close = () => {
        Keyboard.dismiss()
        onClose()
    }
    const yearValid = isPlausibleYear(typeof form.year === "number" ? form.year : undefined)
    const warnings = homeOptionWarnings(type, form)

    return (
        <Sheet open={open} onOpenChange={o => !o && close()} title={`${t("Options", "Optionen")}: ${homeSectionName(type, t)}`}
            footer={<>
                <Button intent="secondary" wrapperClassName="flex-1" onPress={close}>{t("Cancel", "Abbrechen")}</Button>
                <Button wrapperClassName="flex-1" disabled={!yearValid} onPress={() => {
                    Keyboard.dismiss()
                    onSave(form)
                }}>{t("Save", "Speichern")}</Button>
            </>}>
            {(schema.options as OptionSchema[]).map(option => (
                <OptionField key={`${option.name}:${resets}`} sectionType={type} option={option} value={form[option.name]} sorting={form.sorting}
                    onChange={value => setForm(prev => withOption(prev, option.name, value))} />
            ))}
            {warnings.map(warning => (
                <View key={warning.kind} accessibilityLiveRegion="polite" className="flex-row gap-2.5 rounded-surface-sm bg-sm-surface-raised p-3">
                    <Info size={18} color={colors.smWarning} />
                    <Text className="min-w-0 flex-1 text-[13px] leading-[19px] text-sm-text">
                        {warning.kind === "genres"
                            ? t(`AniList shows only titles with all ${warning.count} genres, so this row may stay short or empty.`,
                                `AniList zeigt nur Titel mit allen ${warning.count} Genres, daher bleibt die Reihe vielleicht kurz oder leer.`)
                            : t("A custom list is set, so the statuses are not used.", "Eine eigene Liste ist gesetzt, daher werden die Status nicht verwendet.")}
                    </Text>
                </View>
            ))}
            <Button intent="text" wrapperClassName="self-start" disabled={!hasCustomOptions(form)}
                leftIcon={<RotateCcw size={16} color={colors.smAccent} />}
                onPress={() => {
                    setForm(defaultHomeOptions(form) ?? {})
                    setResets(n => n + 1)
                }}>
                {t("Reset options", "Optionen zurücksetzen")}
            </Button>
        </Sheet>
    )
}

/** What an empty field means, under the field */
function optionHint(name: string, t: Translate): string {
    if (name === "status") return t("None picked: releasing and finished", "Keiner gewählt: laufend und beendet")
    if (name === "statuses") return t("None picked: all statuses", "Keiner gewählt: alle Status")
    if (name === "genres") return t("A title needs every picked genre.", "Ein Titel braucht jedes gewählte Genre.")
    if (name === "customListName") return t("The exact name of one of your custom lists on AniList. It replaces the statuses.",
        "Der genaue Name einer deiner eigenen Listen auf AniList. Er ersetzt die Status.")
    return ""
}

function optionPlaceholder(sectionType: string, name: string, sorting: unknown, t: Translate): string {
    if (name === "name") return carouselDefaultName(t, sectionType === "manga-carousel" ? "manga" : "anime", typeof sorting === "string" ? sorting : undefined)
    if (name === "text") return t("Your heading", "Deine Überschrift")
    return t("Optional", "Optional")
}

function OptionField({ sectionType, option, value, sorting, onChange }: { sectionType: string, option: OptionSchema, value: unknown, sorting: unknown, onChange: (value: unknown) => void }) {
    const t = useTr()
    const label = homeOptionLabel(t, option.label)
    const hint = optionHint(option.name, t)
    const head = <Text className="text-[13px] font-semibold text-sm-text-muted">{label}</Text>
    const foot = !!hint && <Text className="text-xs leading-[17px] text-sm-text-subtle">{hint}</Text>
    switch (option.type) {
        case "text":
            return (
                <View className="gap-2">
                    {head}
                    <TextInput {...accentInput} value={String(value ?? "")} onChangeText={onChange}
                        placeholder={optionPlaceholder(sectionType, option.name, sorting, t)} placeholderTextColor={colors.smTextSubtle}
                        accessibilityLabel={label} accessibilityHint={hint || undefined}
                        className="min-h-12 rounded-surface-sm bg-sm-surface-raised px-4 font-sans text-base text-sm-text" />
                    {foot}
                </View>
            )
        case "number":
            return <YearField label={label} value={value} onChange={onChange} />
        case "select": {
            const state = selectState(sectionType, option.name, value)
            const choices = (option.options ?? []).map(choice => ({ value: choice.value, label: homeOptionLabel(t, choice.label) }))
            return (
                <View className="gap-2">
                    {head}
                    <Select value={state.value} onValueChange={next => onChange(next === ANY_CHOICE ? undefined : next)}
                        options={state.any ? [{ value: ANY_CHOICE, label: t("Any", "Beliebig") }, ...choices] : choices}
                        placeholder={t("Any", "Beliebig")} accessibilityLabel={label} />
                    {foot}
                </View>
            )
        }
        case "multi-select": {
            const picked = Array.isArray(value) ? value as string[] : []
            return (
                <View className="gap-2">
                    {head}
                    <View className="flex-row flex-wrap gap-1.5">
                        {(option.options ?? []).map(opt => {
                            const on = picked.includes(opt.value)
                            const text = option.name === "genres" ? genreLabel(t, opt.value) : homeOptionLabel(t, opt.label)
                            return (
                                <Pressable key={opt.value} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={text}
                                    onPress={() => onChange(on ? picked.filter(v => v !== opt.value) : [...picked, opt.value])}
                                    style={{ flexBasis: 128 }}
                                    className={cn("min-h-12 grow justify-center rounded-surface-sm px-3", on ? "bg-sm-accent-soft" : "bg-sm-surface-raised active:bg-sm-surface-control")}>
                                    <Text className={cn("text-sm", on ? "font-medium text-sm-text" : "text-sm-text-muted")}>{text}</Text>
                                </Pressable>
                            )
                        })}
                    </View>
                    {foot}
                </View>
            )
        }
        default:
            return null
    }
}

/** The year: empty is any year (the placeholder says so), digits only, and a year AniList can have titles for. */
function YearField({ label, value, onChange }: { label: string, value: unknown, onChange: (value: unknown) => void }) {
    const t = useTr()
    const [text, setText] = React.useState(() => yearText(value))
    const { year } = parseYearInput(text)
    const valid = isPlausibleYear(year)
    return (
        <View className="gap-2">
            <Text className="text-[13px] font-semibold text-sm-text-muted">{label}</Text>
            {/* above the field: under it the sheet's footer and the keyboard cover the message while typing */}
            {!valid && (
                <Text accessibilityRole="alert" className="text-xs leading-[17px] text-sm-danger">
                    {t(`Enter a year from ${YEAR_MIN} to ${yearMax()}.`, `Gib ein Jahr von ${YEAR_MIN} bis ${yearMax()} ein.`)}
                </Text>
            )}
            <TextInput {...accentInput} value={text} maxLength={4} keyboardType="number-pad"
                onChangeText={input => {
                    const parsed = parseYearInput(input)
                    setText(parsed.text)
                    onChange(parsed.year)
                }}
                placeholder={t("Any year", "Jedes Jahr")} placeholderTextColor={colors.smTextSubtle} accessibilityLabel={label}
                className={cn("min-h-12 rounded-surface-sm bg-sm-surface-raised px-4 font-sans text-base text-sm-text", !valid && "border border-sm-danger")} />
        </View>
    )
}
