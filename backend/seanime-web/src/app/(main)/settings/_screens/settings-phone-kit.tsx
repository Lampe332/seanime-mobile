import { useServerMutation } from "@/api/client/requests"
import { PatchSetting_Variables, UpdateTheme_Variables } from "@/api/generated/endpoint.types"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { Models_Theme, Status } from "@/api/generated/types"
import { serverStatusAtom } from "@/app/(main)/_atoms/server-status.atoms"
import { PhoneSelect, PhoneSheet, PhoneSwitch } from "@/app/(main)/_features/phone-screen/phone-screen"
import { useServerStatus } from "@/app/(main)/_hooks/use-server-status"
import { cn } from "@/components/ui/core/styling"
import { Translate, useTr } from "@/lib/app-language"
import { THEME_DEFAULT_VALUES } from "@/lib/theme/theme-hooks"
import { useQueryClient } from "@tanstack/react-query"
import { atom, useAtomValue, useSetAtom, useStore } from "jotai"
import get from "lodash/get"
import React from "react"
import { LuChevronRight } from "react-icons/lu"
import { toast } from "sonner"

/**
 * Rows and saving of the Android phone settings: every change is stored at once, without a Save button. Server settings go
 * through PATCH /settings/path one value at a time, the theme as the stored theme with the changed fields; the row shows the new
 * value while it saves and falls back to the stored one with a toast when saving fails.
 */

type DataAttributes = { [key: `data-${string}`]: string | number | boolean | undefined }

/** Values being saved, by "settings:<path>" or "theme:<field>" */
const pendingAtom = atom<Record<string, unknown>>({})

/**
 * One save at a time: the server reads, changes and writes back the whole settings row per request, so two saves at once could
 * undo each other; theme saves send the whole theme as well.
 */
let saveQueue: Promise<unknown> = Promise.resolve()
function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const next = saveQueue.then(job, job)
    saveQueue = next.catch(() => undefined)
    return next
}

function usePending() {
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

function saveFailed(t: Translate) {
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
                API_ENDPOINTS.SETTINGS.GetSettings.key,
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
 * Saves theme fields on top of the stored theme (not the form defaults the desktop page starts from, which would store a default
 * for every empty field).
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

/** A group of rows under a small heading, as in the phone player settings. */
export function SettingsGroup({ id, title, note, children, ...data }: { id: string, title: string, note?: React.ReactNode, children: React.ReactNode } & DataAttributes) {
    return <section className="pst-group" aria-labelledby={`pst-${id}`} data-settings-group={id} {...data}>
        <h2 id={`pst-${id}`}>{title}</h2>
        {!!note && <p className="pst-group-note">{note}</p>}
        <div className="ps-rows">{children}</div>
    </section>
}

/** A switch row for a server setting. */
export function SettingSwitch({ path, label, note, disabled, invert, ...data }: {
    path: string
    label: string
    note?: string
    disabled?: boolean
    /** Shows the opposite of the stored flag ("Check for updates" for disableUpdateCheck) */
    invert?: boolean
} & DataAttributes) {
    const save = useSaveSetting()
    const stored = useSettingValue<boolean>(path, false)
    return <PhoneSwitch label={label} note={note} disabled={disabled} checked={invert ? !stored : !!stored} data-setting={path} {...data}
        onChange={checked => void save(path, invert ? !checked : checked)} />
}

/** A switch row for a theme field. */
export function ThemeSwitch({ field, label, note, ...data }: {
    field: Exclude<keyof Models_Theme, "id">
    label: string
    note?: string
} & DataAttributes) {
    const save = useSaveTheme()
    const value = useThemeValue(field)
    return <PhoneSwitch label={label} note={note} checked={!!value} data-theme-field={field} {...data}
        onChange={checked => void save({ [field]: checked })} />
}

export type SelectOption = { value: string, label: string }

/** A labelled native select (Android's own picker, which Back closes). */
export function SelectRow({ id, label, note, value, options, onChange, disabled, ...data }: {
    id: string
    label: string
    note?: string
    value: string
    options: SelectOption[]
    onChange: (value: string) => void
    disabled?: boolean
} & DataAttributes) {
    // A stored value the options no longer list stays visible instead of silently showing the first option
    const shown = options.some(option => option.value === value) ? options : [...options, { value, label: value }]
    return <div className="pst-select">
        <label htmlFor={id}>{label}</label>
        {!!note && <small>{note}</small>}
        <PhoneSelect id={id} label={label} value={value} options={shown} onChange={onChange} disabled={disabled} {...data} />
    </div>
}

/** A row that opens something: a value on the right and a chevron. */
export const LinkRow = React.forwardRef<HTMLButtonElement, {
    label: string
    value?: React.ReactNode
    note?: string
    onClick: () => void
    disabled?: boolean
    tone?: "danger" | "accent"
} & DataAttributes>(function LinkRow({ label, value, note, onClick, disabled, tone, ...data }, ref) {
    return <button ref={ref} type="button" className="pst-row" data-tone={tone} onClick={onClick} disabled={disabled} {...data}>
        <span className="pst-row-text">
            <span>{label}</span>
            {!!note && <small>{note}</small>}
        </span>
        {value != null && value !== "" && <span className="pst-row-value">{value}</span>}
        <LuChevronRight aria-hidden />
    </button>
})

/** Open sheets on the page: Android Back closes the sheet first, before it leaves a section. */
export const SheetCountContext = React.createContext<(delta: number) => void>(() => {})

/** PhoneSheet that tells the screen it is open. */
export function SettingsSheet(props: React.ComponentProps<typeof PhoneSheet>) {
    const count = React.useContext(SheetCountContext)
    React.useEffect(() => {
        if (!props.open) return
        count(1)
        return () => count(-1)
    }, [props.open, count])
    return <PhoneSheet {...props} />
}

/** Asks before something that cannot be undone. */
export function ConfirmSheet({ t, open, onOpenChange, title, text, action, danger, onConfirm, returnFocusRef, ...data }: {
    t: Translate
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    text: React.ReactNode
    action: string
    danger?: boolean
    onConfirm: () => void
    returnFocusRef?: React.RefObject<HTMLElement | null>
} & DataAttributes) {
    return <SettingsSheet title={title} open={open} onOpenChange={onOpenChange} returnFocusRef={returnFocusRef} data-settings-confirm {...data}
        footer={<>
            <button type="button" className="ps-secondary" onClick={() => onOpenChange(false)} data-confirm-cancel>{t("Cancel", "Abbrechen")}</button>
            <button type="button" className={cn("ps-primary", danger && "pst-danger")} data-confirm-action
                onClick={() => {
                    onOpenChange(false)
                    onConfirm()
                }}>{action}</button>
        </>}>
        <p className="pst-sheet-text">{text}</p>
    </SettingsSheet>
}

/** Edits a text value in a sheet; Apply saves, Cancel and Back keep the stored value. */
export function TextSheet({ t, open, onOpenChange, title, label, note, value, placeholder, type = "text", multiline, validate, onApply, extra, returnFocusRef, ...data }: {
    t: Translate
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    label: string
    note?: React.ReactNode
    value: string
    placeholder?: string
    type?: "text" | "url" | "password"
    multiline?: boolean
    /** An error sentence, or null when the value can be saved */
    validate?: (value: string) => string | null
    onApply: (value: string) => void
    /** More actions inside the sheet (a folder picker) that set the draft */
    extra?: (setDraft: (value: string) => void) => React.ReactNode
    returnFocusRef?: React.RefObject<HTMLElement | null>
} & DataAttributes) {
    const [draft, setDraft] = React.useState(value)
    React.useEffect(() => { if (open) setDraft(value) }, [open, value])
    const error = validate?.(draft) ?? null
    const id = React.useId()
    const apply = () => {
        if (error) return
        onOpenChange(false)
        if (draft !== value) onApply(draft)
    }
    return <SettingsSheet title={title} open={open} onOpenChange={onOpenChange} returnFocusRef={returnFocusRef} data-settings-text-sheet {...data}
        footer={<>
            <button type="button" className="ps-secondary" onClick={() => onOpenChange(false)} data-text-cancel>{t("Cancel", "Abbrechen")}</button>
            <button type="button" className="ps-primary" onClick={apply} disabled={!!error} data-text-apply>{t("Apply", "Übernehmen")}</button>
        </>}>
        <div className="pst-field">
            {/* The sheet's title already names the field when they are the same */}
            <label htmlFor={id} className={label === title ? "pst-visually-hidden" : undefined}>{label}</label>
            {multiline
                ? <textarea id={id} value={draft} placeholder={placeholder} onChange={event => setDraft(event.target.value)} spellCheck={false}
                    autoCapitalize="off" autoCorrect="off" rows={8} aria-invalid={!!error} aria-describedby={`${id}-help`} data-text-input />
                : <input id={id} type={type} value={draft} placeholder={placeholder} onChange={event => setDraft(event.target.value)} spellCheck={false}
                    autoCapitalize="off" autoCorrect="off" autoComplete="off" enterKeyHint="done" aria-invalid={!!error} aria-describedby={`${id}-help`}
                    onKeyDown={event => { if (event.key === "Enter") apply() }} data-text-input />}
            <small id={`${id}-help`} className={error ? "pst-error" : undefined} role={error ? "alert" : undefined}>{error ?? note}</small>
        </div>
        {extra?.(setDraft)}
    </SettingsSheet>
}

/** Opens a TextSheet from a row showing the value; the row gets the focus back when the sheet closes. */
export function TextSettingRow({ t, label, value, empty, note, sheetTitle, placeholder, type, multiline, validate, onApply, extra, display, ...data }: {
    t: Translate
    label: string
    value: string
    /** Shown in the row when the value is empty */
    empty: string
    note?: React.ReactNode
    sheetTitle?: string
    placeholder?: string
    type?: "text" | "url" | "password"
    multiline?: boolean
    validate?: (value: string) => string | null
    onApply: (value: string) => void
    extra?: (setDraft: (value: string) => void) => React.ReactNode
    /** How the row shows a set value (passwords as dots) */
    display?: (value: string) => string
} & DataAttributes) {
    const [open, setOpen] = React.useState(false)
    const row = React.useRef<HTMLButtonElement>(null)
    return <>
        <LinkRow ref={row} label={label} value={value ? (display ? display(value) : value) : empty} onClick={() => setOpen(true)} {...data} />
        <TextSheet t={t} open={open} onOpenChange={setOpen} title={sheetTitle ?? label} label={label} note={note} value={value} placeholder={placeholder}
            type={type} multiline={multiline} validate={validate} onApply={onApply} extra={extra} returnFocusRef={row} />
    </>
}

/** "" or an http(s) link. */
export function validateImageLink(t: Translate) {
    return (value: string) => !value.trim() || /^https?:\/\/\S+$/i.test(value.trim()) ? null
        : t("Enter a link that starts with https://", "Gib einen Link ein, der mit https:// beginnt")
}
