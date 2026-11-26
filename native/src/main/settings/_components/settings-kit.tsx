import { useServerMutation } from "@/api/client/requests"
import type { PatchSetting_Variables, UpdateTheme_Variables } from "@/api/generated/endpoint.types"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import type { Models_Theme, Status } from "@/api/generated/types"
import { Button } from "@/components/ui/button/button"
import { HueRing } from "@/components/ui/color-wheel/color-wheel"
import { cn } from "@/components/ui/core/styling"
import { Sheet } from "@/components/ui/sheet/sheet"
import { Switch } from "@/components/ui/switch/switch"
import { Muted, Text } from "@/components/ui/text/text"
import { toast } from "@/components/ui/toast/toast-store"
import { type Translate, useTr } from "@/lib/app-language"
import { haptic } from "@/lib/feedback"
import { colors, accentInput } from "@/lib/theme/tokens"
import { useThemeColors } from "@/lib/theme/appearance"
import { THEME_DEFAULT_VALUES } from "@/lib/theme/theme-hooks"
import { serverStatusAtom } from "@/main/_atoms/server-status.atoms"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { type RowReveal, useJumpTarget, useRowFocus } from "@/main/settings/_components/settings-page"
import { WIDE_MIN_WIDTH } from "@/lib/tablet-ui"
import { useTabletLayout } from "@/lib/use-tablet-ui"
import { pickerListMaxHeight } from "@/main/settings/_lib/settings-page-layout"
import { withStoredOption, type Option } from "@/main/settings/_lib/settings-phone"
import { useQueryClient } from "@tanstack/react-query"
import { Image } from "expo-image"
import { atom, useAtomValue, useSetAtom, useStore } from "jotai"
import get from "lodash/get"
import type { LucideIcon } from "lucide-react-native"
import Check from "lucide-react-native/icons/check"
import ChevronRight from "lucide-react-native/icons/chevron-right"
import RefreshCw from "lucide-react-native/icons/refresh-cw"
import Smartphone from "lucide-react-native/icons/smartphone"
import React from "react"
import { Animated, Easing, Pressable, ScrollView, TextInput, useWindowDimensions, View } from "react-native"
import { useReducedMotion } from "react-native-reanimated"

/*
 * Rows and saving of the settings (settings-phone-kit.tsx): every change is stored at once, without a Save button. Server
 * settings go through PATCH /settings/path one value at a time, the theme as the stored theme with the changed fields; a row
 * shows the new value while it saves and falls back to the stored one with a toast when saving fails.
 */

/** Values being saved, by "settings:<path>", "theme:<field>" or "<row>:<field>" (torrent streaming, debrid) */
export const pendingAtom = atom<Record<string, unknown>>({})

/**
 * One save at a time: the server reads, changes and writes back the whole settings row per request, so two saves at once
 * could undo each other; theme saves send the whole theme as well.
 */
let saveQueue: Promise<unknown> = Promise.resolve()
export function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const next = saveQueue.then(job, job)
    saveQueue = next.catch(() => undefined)
    return next
}

export function usePending() {
    const setPending = useSetAtom(pendingAtom)
    const begin = React.useCallback((entries: Record<string, unknown>) => setPending(pending => ({ ...pending, ...entries })), [setPending])
    // A newer change of the same value keeps its own entry
    const end = React.useCallback((entries: Record<string, unknown>) => setPending(pending => {
        const next = { ...pending }
        for (const [key, value] of Object.entries(entries)) if (Object.is(next[key], value)) delete next[key]
        return next
    }), [setPending])
    return { begin, end }
}

export function saveFailed(t: Translate) {
    toast.error(t("The setting could not be saved. Try again.", "Die Einstellung konnte nicht gespeichert werden. Versuch es noch einmal."))
}

/** Saves one server setting by its JSON path ("library.autoUpdateProgress"); resolves to whether it was stored. */
export function useSaveSetting() {
    const t = useTr()
    const qc = useQueryClient()
    const store = useStore()
    const { begin, end } = usePending()
    const { mutateAsync } = useServerMutation<Status, PatchSetting_Variables>({
        endpoint: API_ENDPOINTS.SETTINGS.PatchSetting.endpoint,
        method: API_ENDPOINTS.SETTINGS.PatchSetting.methods[0],
        mutationKey: [API_ENDPOINTS.SETTINGS.PatchSetting.key],
        // The toast below says it in the app language
        onError: () => {},
    })
    return React.useCallback(async (path: string, value: unknown) => {
        const entries = { [`settings:${path}`]: value }
        begin(entries)
        try {
            const status = await enqueue(() => mutateAsync({ path, value }))
            if (status) {
                store.set(serverStatusAtom, status)
                qc.setQueryData([API_ENDPOINTS.STATUS.GetStatus.key], status)
            }
            for (const key of [
                API_ENDPOINTS.ANIME_COLLECTION.GetLibraryCollection.key,
                API_ENDPOINTS.ANIME_ENTRIES.GetMissingEpisodes.key,
            ]) void qc.invalidateQueries({ queryKey: [key] })
            return true
        }
        catch {
            saveFailed(t)
            return false
        }
        finally {
            end(entries)
        }
    }, [begin, end, mutateAsync, qc, store, t])
}

/**
 * Saves theme fields on top of the stored theme (not the form defaults the desktop page starts from, which would store a
 * default for every empty field).
 */
export function useSaveTheme() {
    const t = useTr()
    const qc = useQueryClient()
    const store = useStore()
    const { begin, end } = usePending()
    const { mutateAsync } = useServerMutation<Models_Theme, UpdateTheme_Variables>({
        endpoint: API_ENDPOINTS.THEME.UpdateTheme.endpoint,
        method: API_ENDPOINTS.THEME.UpdateTheme.methods[0],
        mutationKey: [API_ENDPOINTS.THEME.UpdateTheme.key, "settings-phone"],
        onError: () => {},
    })
    return React.useCallback(async (patch: Partial<Models_Theme>) => {
        const entries = Object.fromEntries(Object.entries(patch).map(([field, value]) => [`theme:${field}`, value]))
        begin(entries)
        try {
            const theme = await enqueue(() => {
                const stored = store.get(serverStatusAtom)?.themeSettings
                // Fields still being saved by an earlier change go along, so this save cannot undo them
                const pending = Object.fromEntries(Object.entries(store.get(pendingAtom))
                    .filter(([key]) => key.startsWith("theme:")).map(([key, value]) => [key.slice(6), value]))
                return mutateAsync({ theme: { ...stored, ...pending, ...patch } as Models_Theme })
            })
            const status = store.get(serverStatusAtom)
            if (theme && status) {
                const next = { ...status, themeSettings: theme }
                store.set(serverStatusAtom, next)
                qc.setQueryData([API_ENDPOINTS.STATUS.GetStatus.key], next)
            }
            return true
        }
        catch {
            saveFailed(t)
            return false
        }
        finally {
            end(entries)
        }
    }, [begin, end, mutateAsync, qc, store, t])
}

/** A server setting as shown: the value being saved, else the stored one. */
export function useSettingValue<T>(path: string, fallback: T): T {
    const status = useServerStatus()
    const pending = useAtomValue(pendingAtom)
    const key = `settings:${path}`
    if (key in pending) return pending[key] as T
    return (get(status?.settings, path) ?? fallback) as T
}

/** A theme field as shown: the value being saved, else the stored one, else the app's default (as useThemeSettings reads it). */
export function useThemeValue<K extends Exclude<keyof Models_Theme, "id">>(field: K): Models_Theme[K] {
    const status = useServerStatus()
    const pending = useAtomValue(pendingAtom)
    const key = `theme:${field}`
    if (key in pending) return pending[key] as Models_Theme[K]
    const stored = status?.themeSettings?.[field]
    const fallback = THEME_DEFAULT_VALUES[field] as Models_Theme[K]
    if (stored === undefined || stored === null || typeof stored !== typeof fallback) return fallback
    if (typeof fallback === "string" && stored === "" && fallback !== "") return fallback
    return stored
}

/** The title of the group a row stands in: two groups of one page may hold a row of the same name */
const GroupTitleContext = React.createContext<string | undefined>(undefined)

/**
 * The row a search hit opened (settings-page.tsx `focus`): the page scrolls to it and an accent tint fades in and out
 * over it, about 1.5 s in all. It lies under the row's text and takes no touches; every other row renders nothing here.
 */
function RowHighlight({ label }: { label: string }) {
    const target = useRowFocus(label, React.useContext(GroupTitleContext))
    return target ? <RowGlow key={target.nonce} reveal={target.reveal} /> : null
}

function RowGlow({ reveal }: { reveal: RowReveal }) {
    const colors = useThemeColors()
    const ref = React.useRef<React.ComponentRef<typeof View>>(null)
    const [opacity] = React.useState(() => new Animated.Value(0))
    const reducedMotion = useReducedMotion()
    React.useEffect(() => {
        reveal(ref)
        const fade = (toValue: number, duration: number) => Animated.timing(opacity, {
            toValue, duration: reducedMotion ? 0 : duration, easing: Easing.out(Easing.cubic), useNativeDriver: true,
        })
        // waits for the page's scroll to the row, then 200 ms in, 900 ms lit, 450 ms out
        const glow = Animated.sequence([Animated.delay(280), fade(1, 200), Animated.delay(900), fade(0, 450)])
        glow.start()
        return () => glow.stop()
    }, [opacity, reducedMotion, reveal])
    return (
        <View ref={ref} collapsable={false} pointerEvents="none" className="absolute inset-0">
            <Animated.View style={{ flex: 1, backgroundColor: colors.smAccentSoft, opacity }} />
        </View>
    )
}

/** A small heading over a card of rows (as the list of areas: round corners, fine lines), an optional note under the heading */
export function SettingsGroup({ title, note, notice, children }: {
    title?: string
    note?: string
    /**
     * A Notice of its own above the rows (4.2.0 E: inside the rows its round corners sat on the square top of the next
     * row, the rows looked stuck to it); the rows keep their own rounded block below it
     */
    notice?: React.ReactNode
    children: React.ReactNode
}) {
    // On a page with jump chips the title is one of them (settings-page.tsx)
    const ref = useJumpTarget(title)
    return (
        <GroupTitleContext.Provider value={title}>
            <View className="min-w-0 gap-2">
                {/* Marks the top of the group for the jump (out of the flow: no gap of its own) */}
                <View ref={ref} collapsable={false} pointerEvents="none" className="absolute left-0 top-0 h-px w-px" />
                {/* 2.0.32 measured at the S22 (App area): ~6dp more above the heading and ~8dp more under it than the bare gap */}
                {!!title && <Text accessibilityRole="header" className="mb-2 mt-1.5 px-1 text-[13px] font-semibold tracking-[0.26px] text-sm-text-muted">{title}</Text>}
                {!!note && <Text className="-mt-1 px-1 text-[13px] leading-[19.5px] text-sm-text-subtle">{note}</Text>}
                {notice}
                <View className="gap-0.5 overflow-hidden rounded-surface">{children}</View>
            </View>
        </GroupTitleContext.Provider>
    )
}

/** Sub-settings of the switch above them (spoiler parts, blur of adult covers) sit 2rem in */
const SUB = "pl-8"

/** One row shape for every setting: the name, one sentence under it, the value or the switch on the right */
const ROW = "w-full flex-row items-center gap-3 bg-sm-surface-raised px-4 py-3 active:bg-sm-surface-control"
const rowHeight = (note: unknown) => note ? "min-h-[60px]" : "min-h-14"
const VALUE = "text-right text-sm text-sm-text-muted"
const VALUE_STYLE = { flexShrink: 0, maxWidth: "55%" } as const

/** Where a setting lives: only on this device, or carried to the user's other devices by the account's sync */
export type SettingScope = "device" | "synced"

function scopeText(t: Translate, scope: SettingScope | undefined) {
    if (!scope) return undefined
    return scope === "device" ? t("This device only", "Nur dieses Gerät") : t("Synced", "Wird synchronisiert")
}

function changedText(t: Translate, changed: boolean | undefined) {
    return changed ? t("Changed from default", "Vom Standard geändert") : undefined
}

function spoken(...parts: (string | undefined)[]) {
    return parts.filter(Boolean).join(", ")
}

/**
 * The text side of a row: name, note, where the setting lives. A value that is not the default puts an accent dot right
 * after the name, on its last line and never alone on a new one (as a box beside a wrapped name it stood out between
 * the text and the switch, S22/Pixel Tablet).
 */
function RowText({ label, note, scope, changed, tone, className }: {
    label: string
    note?: string
    scope?: SettingScope
    changed?: boolean
    tone?: "danger" | "accent"
    className?: string
}) {
    const colors = useThemeColors()
    const t = useTr()
    const ScopeIcon = scope === "device" ? Smartphone : RefreshCw
    return (
        <View className={cn("min-w-0 gap-0.5", className ?? "flex-1")}>
            <Text accessibilityLabel={spoken(label, changedText(t, changed))}
                className={cn("text-base", tone === "danger" && "text-sm-danger", tone === "accent" && "text-sm-accent")}>
                {label}
                {changed && <Text className="font-bold" style={{ color: colors.smAccent }}>{" •"}</Text>}
            </Text>
            {!!note && <Muted className="text-[13px] leading-[19px]">{note}</Muted>}
            {!!scope && <View className="mt-0.5 flex-row items-center gap-1.5">
                <ScopeIcon size={12} color={colors.smTextSubtle} />
                <Text className="text-xs text-sm-text-subtle">{scopeText(t, scope)}</Text>
            </View>}
        </View>
    )
}

/** The switch row all three kinds share */
function SwitchSettingRow({ label, note, checked, onCheckedChange, disabled, sub, scope, changed }: {
    label: string
    note?: string
    checked: boolean
    onCheckedChange: (checked: boolean) => void
    disabled?: boolean
    sub?: boolean
    scope?: SettingScope
    changed?: boolean
}) {
    const t = useTr()
    return (
        <Pressable accessibilityRole="switch" accessibilityState={{ checked, disabled: !!disabled }}
            accessibilityLabel={spoken(label, note, scopeText(t, scope), changedText(t, changed))} disabled={disabled}
            onPress={() => {
                haptic("tick")
                onCheckedChange(!checked)
            }}
            className={cn(ROW, rowHeight(note || scope), disabled && "opacity-60", sub && SUB)}>
            <RowHighlight label={label} />
            <RowText label={label} note={note} scope={scope} changed={changed} />
            <View pointerEvents="none">
                <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
            </View>
        </Pressable>
    )
}

/** A switch row for a server setting. */
export function SettingSwitch({ path, label, note, disabled, invert, sub, scope, defaultChecked }: {
    path: string
    label: string
    note?: string
    disabled?: boolean
    /** Shows the opposite of the stored flag ("Look for new versions" for disableUpdateCheck) */
    invert?: boolean
    sub?: boolean
    scope?: SettingScope
    /** The switch as the app starts (as shown, after `invert`): a dot marks the row once it differs */
    defaultChecked?: boolean
}) {
    const save = useSaveSetting()
    const stored = useSettingValue<boolean>(path, false)
    const checked = invert ? !stored : !!stored
    return <SwitchSettingRow label={label} note={note} disabled={disabled} checked={checked} sub={sub} scope={scope}
        changed={defaultChecked !== undefined && checked !== defaultChecked}
        onCheckedChange={next => void save(path, invert ? !next : next)} />
}

/** A switch row for a theme field; a dot marks a value that is not the app's default. */
export function ThemeSwitch({ field, label, note, sub, scope }: {
    field: Exclude<keyof Models_Theme, "id">
    label: string
    note?: string
    sub?: boolean
    scope?: SettingScope
}) {
    const save = useSaveTheme()
    const value = useThemeValue(field)
    return <SwitchSettingRow label={label} note={note} checked={!!value} sub={sub} scope={scope} changed={!!value !== !!THEME_DEFAULT_VALUES[field]}
        onCheckedChange={checked => void save({ [field]: checked })} />
}

/** A switch row for a value of this device */
export function LocalSwitch({ label, note, checked, onCheckedChange, sub, disabled, scope, defaultChecked }: {
    label: string
    note?: string
    checked: boolean
    onCheckedChange: (checked: boolean) => void
    sub?: boolean
    disabled?: boolean
    scope?: SettingScope
    /** The value the app starts with: a dot marks the row once it differs */
    defaultChecked?: boolean
}) {
    return <SwitchSettingRow label={label} note={note} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} sub={sub} scope={scope}
        changed={defaultChecked !== undefined && checked !== defaultChecked} />
}

/** A colour circle: its name for the screen reader, the colour it shows */
export type SwatchOption = { value: string, color: string, label: string }

/**
 * A row of colour circles: name and note above, the circles below (48dp to tap, the colour 36dp inside). The current one
 * is ringed and checked; with `defaultValue` a dot marks a changed value. `custom` adds a last circle with a rainbow ring
 * that opens a picker; it shows the own colour once one is in use.
 */
export function SwatchRow({ label, note, value, options, onChange, scope, defaultValue, custom }: {
    label: string
    note?: string
    value: string
    options: SwatchOption[]
    onChange: (value: string) => void
    scope?: SettingScope
    defaultValue?: string
    custom?: { label: string, selected: boolean, color?: string, onPress: () => void }
}) {
    const colors = useThemeColors()
    return (
        <View accessibilityRole="radiogroup" accessibilityLabel={label} className={cn(ROW, "flex-col items-stretch gap-3")}>
            <RowHighlight label={label} />
            <RowText label={label} note={note} scope={scope} changed={defaultValue !== undefined && value !== defaultValue} className="min-w-0" />
            <View className="flex-row flex-wrap gap-1.5">
                {options.map(option => {
                    const selected = option.value === value
                    return <Pressable key={option.value} accessibilityRole="radio" accessibilityLabel={option.label}
                        accessibilityState={{ checked: selected }}
                        onPress={() => {
                            if (selected) return
                            haptic("tick")
                            onChange(option.value)
                        }}
                        className="size-12 items-center justify-center rounded-full border-2"
                        style={{ borderColor: selected ? colors.smText : "transparent" }}>
                        <View className="size-9 items-center justify-center rounded-full" style={{ backgroundColor: option.color }}>
                            {selected && <Check size={18} strokeWidth={3} color={colors.paper} />}
                        </View>
                    </Pressable>
                })}
                {custom && <Pressable accessibilityRole="radio" accessibilityLabel={custom.label} accessibilityState={{ checked: custom.selected }}
                    onPress={() => {
                        haptic("tick")
                        custom.onPress()
                    }}
                    className="size-12 items-center justify-center rounded-full border-2"
                    style={{ borderColor: custom.selected ? colors.smText : "transparent" }}>
                    <HueRing size={36} inner={custom.color ?? colors.smSurfaceRaised} />
                    {custom.selected && <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
                        <Check size={18} strokeWidth={3} color={colors.paper} />
                    </View>}
                </Pressable>}
            </View>
        </View>
    )
}

/**
 * A picture to choose: its name for the screen reader, the picture (a bundled asset or a uri) or an icon with a caption.
 * `again` lets a chosen tile be tapped once more (the photo tile opens the picker every time).
 */
export type ImageChoice = { value: string, label: string, source?: number | string, icon?: LucideIcon, caption?: string, again?: boolean }

/**
 * A grid of wide picture tiles, two per line (the banner's own shape, so each previews what it gives): name and note above.
 * The current one is ringed with a check; icon tiles carry their caption inside, a picture with a caption gets it on a
 * dark strip at its foot.
 */
export function ImageChoiceRow({ label, note, value, options, onChange, scope }: {
    label: string
    note?: string
    value: string
    options: ImageChoice[]
    onChange: (value: string) => void
    scope?: SettingScope
}) {
    const colors = useThemeColors()
    return (
        <View accessibilityRole="radiogroup" accessibilityLabel={label} className={cn(ROW, "flex-col items-stretch gap-3 active:bg-sm-surface-raised")}>
            <RowHighlight label={label} />
            <RowText label={label} note={note} scope={scope} className="min-w-0" />
            <View className="flex-row flex-wrap justify-between gap-y-2">
                {options.map(option => {
                    const selected = option.value === value
                    const Icon = option.icon
                    return <Pressable key={option.value} accessibilityRole="radio" accessibilityLabel={spoken(option.label, option.caption !== option.label ? option.caption : undefined)}
                        accessibilityState={{ checked: selected }}
                        onPress={() => {
                            if (selected && !option.again) return
                            haptic("tick")
                            onChange(option.value)
                        }}
                        className="overflow-hidden rounded-xl border-2 bg-sm-surface-control active:opacity-80"
                        style={{ width: "48.5%", borderColor: selected ? colors.smText : "transparent" }}>
                        {/* the tile's height comes from this inner box: aspectRatio on the Pressable itself was lost (tiles 15 px high) */}
                        <View style={{ width: "100%", aspectRatio: 2.4 }}>
                        {option.source !== undefined
                            ? <Image source={option.source} contentFit="cover" transition={{ duration: 160, effect: "cross-dissolve" }}
                                style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
                            : <View className="flex-1 items-center justify-center gap-1 px-2">
                                {!!Icon && <Icon size={20} color={colors.smTextMuted} />}
                                {!!option.caption && <Text numberOfLines={2} className="text-center text-[13px] leading-[17px] text-sm-text-muted">{option.caption}</Text>}
                            </View>}
                        {option.source !== undefined && !!option.caption &&
                            <View className="absolute inset-x-0 bottom-0 flex-row items-center gap-1.5 px-2 py-1" style={{ backgroundColor: "rgba(12,12,14,0.66)" }}>
                                {!!Icon && <Icon size={13} color="#fff" />}
                                <Text numberOfLines={1} className="shrink text-xs text-white">{option.caption}</Text>
                            </View>}
                        {selected && <View className="absolute right-1.5 top-1.5 size-6 items-center justify-center rounded-full" style={{ backgroundColor: colors.smText }}>
                            <Check size={14} strokeWidth={3} color={colors.paper} />
                        </View>}
                        </View>
                    </Pressable>
                })}
            </View>
        </View>
    )
}

/** An option may say in one sentence what it does (shown in the sheet of all options) */
export type SelectOption = Option & { note?: string }

/** Two or three short options fit side by side in the row; anything else opens the sheet */
function fitsSegments(options: Option[], value: string) {
    if (options.length < 2 || options.length > 3 || !options.some(option => option.value === value)) return false
    const longest = options.length === 2 ? 16 : 10
    return options.every(option => option.label.length <= longest)
}

/**
 * One of several values. Two or three short options are a segmented control in the row; more are a row that shows the
 * current value and opens a sheet with all of them, the current one checked. With `defaultValue` a dot marks a changed
 * value and the sheet offers the way back.
 */
export function SelectRow({ label, note, value, options, onChange, disabled, sub, scope, defaultValue }: {
    label: string
    note?: string
    value: string
    options: SelectOption[]
    onChange: (value: string) => void
    disabled?: boolean
    sub?: boolean
    scope?: SettingScope
    defaultValue?: string
}) {
    const colors = useThemeColors()
    const t = useTr()
    const { height: windowHeight } = useWindowDimensions()
    // the tablet's side sheet (sheet.tsx) bounds its body itself
    const { isTablet, window } = useTabletLayout()
    const sideSheet = isTablet && window.width >= WIDE_MIN_WIDTH
    const [open, setOpen] = React.useState(false)
    const changed = defaultValue !== undefined && value !== defaultValue

    if (fitsSegments(options, value)) {
        return (
            <View className={cn("gap-2.5 bg-sm-surface-raised px-4 py-3", disabled && "opacity-60", sub && SUB)}>
                <RowHighlight label={label} />
                <RowText label={label} note={note} scope={scope} changed={changed} className="" />
                <View accessibilityRole="radiogroup" accessibilityLabel={spoken(label, note, changedText(t, changed))} className="flex-row gap-0.5 rounded-[10px] p-0.5"
                    style={{ backgroundColor: colors.smSurfaceSunken }}>
                    {options.map(option => {
                        const selected = option.value === value
                        return <Pressable key={option.value} accessibilityRole="radio" accessibilityLabel={option.label}
                            accessibilityState={{ checked: selected, disabled: !!disabled }} disabled={disabled}
                            onPress={() => {
                                if (selected) return
                                haptic("tick")
                                onChange(option.value)
                            }}
                            className={cn("min-h-11 flex-1 items-center justify-center rounded-lg px-2", selected && "bg-sm-surface-control")}>
                            <Text numberOfLines={1} className={cn("text-sm", selected ? "font-semibold" : "text-sm-text-muted")}>{option.label}</Text>
                        </Pressable>
                    })}
                </View>
            </View>
        )
    }

    // A stored value the options no longer list stays visible
    const all: SelectOption[] = withStoredOption(options, value)
    const current = all.find(option => option.value === value)
    return <>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={() => setOpen(true)}
            accessibilityLabel={spoken(label, current?.label, note, scopeText(t, scope), changedText(t, changed))}
            className={cn(ROW, rowHeight(note || scope), disabled && "opacity-60", sub && SUB)}>
            <RowHighlight label={label} />
            <RowText label={label} note={note} scope={scope} changed={changed} />
            <Text numberOfLines={1} style={VALUE_STYLE} className={VALUE}>{current?.label ?? value}</Text>
            <ChevronRight size={18} color={colors.smTextSubtle} />
        </Pressable>
        <Sheet title={label} description={note} open={open} onOpenChange={setOpen}
            footer={changed ? <Button intent="secondary" wrapperClassName="flex-1" onPress={() => {
                setOpen(false)
                onChange(defaultValue)
            }}>{t("Reset to default", "Auf Standard zurücksetzen")}</Button> : undefined}>
            {/* As tall as the options, at most ~85 % of the screen with the sheet's head and foot (the side sheet: its body); past it they scroll here */}
            <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false}
                style={{ flexGrow: 0, maxHeight: pickerListMaxHeight({ windowHeight, hasNote: !!note, hasFooter: changed, sideSheet }) }}>
            <View accessibilityRole="radiogroup" accessibilityLabel={label} className="gap-0.5 overflow-hidden rounded-surface">
                {all.map(option => {
                    const selected = option.value === value
                    return <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: selected }}
                        accessibilityLabel={spoken(option.label, option.note)}
                        onPress={() => {
                            setOpen(false)
                            if (selected) return
                            haptic("tick")
                            onChange(option.value)
                        }}
                        className="min-h-[52px] w-full flex-row items-center gap-3 bg-sm-surface-raised px-4 py-2.5 active:bg-sm-surface-control">
                        <View className="min-w-0 flex-1 gap-0.5">
                            <Text className={cn("text-[15px]", selected && "font-semibold")}>{option.label}</Text>
                            {!!option.note && <Muted className="text-[13px] leading-[19px]">{option.note}</Muted>}
                        </View>
                        {selected && <Check size={20} color={colors.smAccent} />}
                    </Pressable>
                })}
            </View>
            </ScrollView>
        </Sheet>
    </>
}

/**
 * A row that opens or does something; the value and a chevron on the right. A short value ("None", "Default")
 * keeps its full width and the label wraps instead; a long one (a path) stops at 55 % with an ellipsis (settings audit
 * 98fa4e2: values were cut to "No…" and "De…").
 */
export function LinkRow({ label, value, note, onPress, disabled, tone, chevron = true, sub, icon: Icon, scope, path }: {
    label: string
    value?: string
    /** The value is a folder's path: shortened in its middle, so the folder's name at its end stays (S22: "/storage/emulated/0/An…") */
    path?: boolean
    note?: string
    onPress: () => void
    disabled?: boolean
    tone?: "danger" | "accent"
    chevron?: boolean
    sub?: boolean
    /** a small muted icon in front of the label (About › Support) */
    icon?: LucideIcon
    scope?: SettingScope
}) {
    const t = useTr()
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={spoken(label, value, note, scopeText(t, scope))} accessibilityState={{ disabled: !!disabled }}
            disabled={disabled} onPress={onPress}
            className={cn(ROW, rowHeight(note || scope), disabled && "opacity-60", sub && SUB)}>
            <RowHighlight label={label} />
            {!!Icon && <Icon size={20} color={colors.smTextMuted} />}
            <RowText label={label} note={note} scope={scope} tone={tone} />
            {!!value && <Text numberOfLines={1} ellipsizeMode={path ? "middle" : "tail"} style={VALUE_STYLE} className={VALUE}>{value}</Text>}
            {chevron && <ChevronRight size={18} color={colors.smTextSubtle} />}
        </Pressable>
    )
}

/** A row that only shows something (a security event, a loading line): no button, so TalkBack does not call it disabled */
export function InfoRow({ label, value, note }: { label: string, value?: string, note?: string }) {
    return (
        <View accessible accessibilityLabel={spoken(label, value, note)}
            className={cn("w-full flex-row items-center gap-3 bg-sm-surface-raised px-4 py-3", rowHeight(note))}>
            <RowHighlight label={label} />
            <RowText label={label} note={note} />
            {!!value && <Text numberOfLines={1} style={VALUE_STYLE} className={VALUE}>{value}</Text>}
        </View>
    )
}

/** Radio rows (`.pst-choice`): one of a few */
export function ChoiceRows({ label, children }: { label: string, children: React.ReactNode }) {
    return <View accessibilityRole="radiogroup" accessibilityLabel={label} className="gap-0.5">{children}</View>
}

/** Asks before something that cannot be undone. */
export function ConfirmSheet({ open, onOpenChange, title, text, action, danger, onConfirm }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    text: string
    action: string
    danger?: boolean
    onConfirm: () => void
}) {
    const t = useTr()
    return <Sheet title={title} open={open} onOpenChange={onOpenChange}
        footer={<>
            <Button intent="secondary" wrapperClassName="flex-1" onPress={() => onOpenChange(false)}>{t("Cancel", "Abbrechen")}</Button>
            <Button intent={danger ? "danger" : "primary"} wrapperClassName="flex-1" onPress={() => {
                onOpenChange(false)
                onConfirm()
            }}>{action}</Button>
        </>}>
        <Text className="text-[15px] leading-[23px] text-sm-text-muted">{text}</Text>
    </Sheet>
}

const FIELD = "min-h-[52px] rounded-surface bg-sm-surface-raised px-4 py-3 font-sans text-base text-sm-text"

/** Edits a text value in a sheet; Apply saves, Cancel and Back keep the stored value. */
function TextSheet({ open, onOpenChange, title, label, note, value, placeholder, secure, multiline, keyboardType, validate, onApply, extra }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    label: string
    note?: string
    value: string
    placeholder?: string
    secure?: boolean
    multiline?: boolean
    keyboardType?: "default" | "url"
    /** An error sentence, or null when the value can be saved */
    validate?: (value: string) => string | null
    onApply: (value: string) => void
    /** Below the field, e.g. "Choose folder"; it may fill the draft */
    extra?: (setDraft: (value: string) => void) => React.ReactNode
}) {
    const t = useTr()
    // The row mounts the sheet anew for each opening (key), so the draft starts from the stored value
    const [draft, setDraft] = React.useState(value)
    const error = validate?.(draft) ?? null
    const apply = () => {
        if (error) return
        onOpenChange(false)
        if (draft !== value) onApply(draft)
    }
    return <Sheet title={title} open={open} onOpenChange={onOpenChange}
        footer={<>
            <Button intent="secondary" wrapperClassName="flex-1" onPress={() => onOpenChange(false)}>{t("Cancel", "Abbrechen")}</Button>
            <Button wrapperClassName="flex-1" disabled={!!error} onPress={apply}>{t("Apply", "Übernehmen")}</Button>
        </>}>
        <View className="gap-2">
            {/* The sheet's title already names the field when they are the same */}
            {label !== title && <Text className="text-[15px] font-semibold">{label}</Text>}
            <TextInput {...accentInput} value={draft} onChangeText={setDraft} placeholder={placeholder} placeholderTextColor={colors.smTextSubtle}
                accessibilityLabel={label} autoCapitalize="none" autoCorrect={false} autoComplete="off" secureTextEntry={secure}
                keyboardType={keyboardType === "url" ? "url" : "default"} multiline={multiline} returnKeyType={multiline ? "default" : "done"}
                onSubmitEditing={multiline ? undefined : apply} textAlignVertical={multiline ? "top" : "center"}
                style={multiline ? { minHeight: 192, fontFamily: "monospace", fontSize: 14, lineHeight: 21 } : undefined}
                className={cn(FIELD, !!error && "border-2 border-sm-danger")} />
            {(!!error || !!note) && <Text accessibilityRole={error ? "alert" : undefined}
                className={cn("text-[13px] leading-[19.5px]", error ? "text-sm-danger" : "text-sm-text-muted")}>{error ?? note}</Text>}
            {extra?.(setDraft)}
        </View>
    </Sheet>
}

/** Opens a TextSheet from a row showing the value. */
export function TextSettingRow({ label, value, empty, note, sheetTitle, placeholder, secure, multiline, keyboardType, validate, onApply, display, sub, extra, path }: {
    label: string
    value: string
    /** Shown in the row when the value is empty */
    empty: string
    note?: string
    sheetTitle?: string
    placeholder?: string
    secure?: boolean
    multiline?: boolean
    keyboardType?: "default" | "url"
    validate?: (value: string) => string | null
    onApply: (value: string) => void
    /** How the row shows a set value (passwords as dots) */
    display?: (value: string) => string
    sub?: boolean
    extra?: (setDraft: (value: string) => void) => React.ReactNode
    /** The value is a folder's path (LinkRow) */
    path?: boolean
}) {
    const [open, setOpen] = React.useState(false)
    const [opened, setOpened] = React.useState(0)
    return <>
        <LinkRow label={label} value={value ? (display ? display(value) : value) : empty} sub={sub} path={path && !!value} onPress={() => {
            setOpened(count => count + 1)
            setOpen(true)
        }} />
        <TextSheet key={opened} open={open} onOpenChange={setOpen} title={sheetTitle ?? label} label={label} note={note} value={value} placeholder={placeholder}
            secure={secure} multiline={multiline} keyboardType={keyboardType} validate={validate} onApply={onApply} extra={extra} />
    </>
}
