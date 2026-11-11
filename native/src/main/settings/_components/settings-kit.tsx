import { useServerMutation } from "@/api/client/requests"
import type { PatchSetting_Variables, UpdateTheme_Variables } from "@/api/generated/endpoint.types"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import type { Models_Theme, Status } from "@/api/generated/types"
import { Button } from "@/components/ui/button/button"
import { cn } from "@/components/ui/core/styling"
import { Select } from "@/components/ui/select/select"
import { Sheet } from "@/components/ui/sheet/sheet"
import { SwitchRow } from "@/components/ui/switch/switch"
import { Muted, Text } from "@/components/ui/text/text"
import { toast } from "@/components/ui/toast/toast-store"
import { type Translate, useTr } from "@/lib/app-language"
import { colors } from "@/lib/theme/tokens"
import { THEME_DEFAULT_VALUES } from "@/lib/theme/theme-hooks"
import { serverStatusAtom } from "@/main/_atoms/server-status.atoms"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { withStoredOption, type Option } from "@/main/settings/_lib/settings-phone"
import { useQueryClient } from "@tanstack/react-query"
import { atom, useAtomValue, useSetAtom, useStore } from "jotai"
import get from "lodash/get"
import ChevronRight from "lucide-react-native/icons/chevron-right"
import React from "react"
import { Pressable, TextInput, View } from "react-native"

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

/** `.pst-group`: a small heading over raised rows, an optional note under the heading */
export function SettingsGroup({ title, note, children }: { title?: string, note?: string, children: React.ReactNode }) {
    return (
        <View className="min-w-0 gap-2">
            {/* 2.0.32 measured at the S22 (App area): ~6dp more above the heading and ~8dp more under it than the bare gap */}
            {!!title && <Text accessibilityRole="header" className="mb-2 mt-1.5 px-1 text-[13px] font-semibold tracking-[0.26px] text-sm-text-muted">{title}</Text>}
            {!!note && <Text className="-mt-1 px-1 text-[13px] leading-[19.5px] text-sm-text-subtle">{note}</Text>}
            <View className="gap-0.5 overflow-hidden rounded-surface">{children}</View>
        </View>
    )
}

/** Sub-settings of the switch above them (spoiler parts, blur of adult covers) sit 2rem in */
const SUB = "pl-8"

/** A switch row for a server setting. */
export function SettingSwitch({ path, label, note, disabled, invert, sub }: {
    path: string
    label: string
    note?: string
    disabled?: boolean
    /** Shows the opposite of the stored flag ("Look for new versions" for disableUpdateCheck) */
    invert?: boolean
    sub?: boolean
}) {
    const save = useSaveSetting()
    const stored = useSettingValue<boolean>(path, false)
    return <SwitchRow label={label} description={note} disabled={disabled} checked={invert ? !stored : !!stored} className={sub ? SUB : undefined}
        onCheckedChange={checked => void save(path, invert ? !checked : checked)} />
}

/** A switch row for a theme field. */
export function ThemeSwitch({ field, label, note, sub }: {
    field: Exclude<keyof Models_Theme, "id">
    label: string
    note?: string
    sub?: boolean
}) {
    const save = useSaveTheme()
    const value = useThemeValue(field)
    return <SwitchRow label={label} description={note} checked={!!value} className={sub ? SUB : undefined}
        onCheckedChange={checked => void save({ [field]: checked })} />
}

/** A switch row for a value of this device */
export function LocalSwitch({ label, note, checked, onCheckedChange, sub, disabled }: {
    label: string
    note?: string
    checked: boolean
    onCheckedChange: (checked: boolean) => void
    sub?: boolean
    disabled?: boolean
}) {
    return <SwitchRow label={label} description={note} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} className={sub ? SUB : undefined} />
}

/** `.pst-select`: a label (and note) over a select on the control surface, a block among the rows */
export function SelectRow({ label, note, value, options, onChange, disabled, sub }: {
    label: string
    note?: string
    value: string
    options: Option[]
    onChange: (value: string) => void
    disabled?: boolean
    sub?: boolean
}) {
    return (
        <View className={cn("gap-1.5 bg-sm-surface-raised px-4 py-3", sub && SUB)}>
            <Text className="text-[15px]">{label}</Text>
            {!!note && <Muted className="-mt-1 text-[13px] leading-[19px]">{note}</Muted>}
            <Select value={value} options={withStoredOption(options, value)} onValueChange={onChange} disabled={disabled} placeholder={label}
                accessibilityLabel={label} triggerClassName="bg-sm-surface-control" />
        </View>
    )
}

/**
 * `.pst-row`: a row that opens or does something; the value and a chevron on the right. A short value ("None", "Default")
 * keeps its full width and the label wraps instead; a long one (a path) stops at 55 % with an ellipsis (settings audit
 * 98fa4e2: values were cut to "No…" and "De…").
 */
export function LinkRow({ label, value, note, onPress, disabled, tone, chevron = true, sub }: {
    label: string
    value?: string
    note?: string
    onPress: () => void
    disabled?: boolean
    tone?: "danger" | "accent"
    chevron?: boolean
    sub?: boolean
}) {
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={[label, value, note].filter(Boolean).join(", ")} accessibilityState={{ disabled: !!disabled }}
            disabled={disabled} onPress={onPress}
            className={cn("min-h-[52px] w-full flex-row items-center gap-3 bg-sm-surface-raised px-4 py-2.5 active:bg-sm-surface-control", disabled && "opacity-60", sub && SUB)}>
            <View className="min-w-0 flex-1 gap-0.5">
                <Text className={cn("text-[15px]", tone === "danger" && "text-sm-danger", tone === "accent" && "text-sm-accent")}>{label}</Text>
                {!!note && <Muted className="text-[13px] leading-[19px]">{note}</Muted>}
            </View>
            {!!value && <Text numberOfLines={1} style={{ flexShrink: 0, maxWidth: "55%" }} className="text-right text-sm text-sm-text-muted">{value}</Text>}
            {chevron && <ChevronRight size={18} color={colors.smTextSubtle} />}
        </Pressable>
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
            <TextInput value={draft} onChangeText={setDraft} placeholder={placeholder} placeholderTextColor={colors.smTextSubtle}
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
export function TextSettingRow({ label, value, empty, note, sheetTitle, placeholder, secure, multiline, keyboardType, validate, onApply, display, sub, extra }: {
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
}) {
    const [open, setOpen] = React.useState(false)
    const [opened, setOpened] = React.useState(0)
    return <>
        <LinkRow label={label} value={value ? (display ? display(value) : value) : empty} sub={sub} onPress={() => {
            setOpened(count => count + 1)
            setOpen(true)
        }} />
        <TextSheet key={opened} open={open} onOpenChange={setOpen} title={sheetTitle ?? label} label={label} note={note} value={value} placeholder={placeholder}
            secure={secure} multiline={multiline} keyboardType={keyboardType} validate={validate} onApply={onApply} extra={extra} />
    </>
}

/** "" or an http(s) link. */
export function validateImageLink(t: Translate) {
    return (value: string) => !value.trim() || /^https?:\/\/\S+$/i.test(value.trim()) ? null
        : t("Enter a link that starts with https://", "Gib einen Link ein, der mit https:// beginnt")
}
