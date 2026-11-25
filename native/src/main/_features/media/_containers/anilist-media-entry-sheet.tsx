import type { AL_BaseAnime, AL_BaseManga, Anime_EntryListData, Manga_EntryListData } from "@/api/generated/types"
import { useDeleteAnilistListEntry, useEditAnilistListEntry } from "@/api/hooks/anilist.hooks"
import { useUpdateAnimeEntryRepeat } from "@/api/hooks/anime_entries.hooks"
import { Button } from "@/components/ui/button/button"
import { cn } from "@/components/ui/core/styling"
import { Dialog, Sheet } from "@/components/ui/sheet/sheet"
import { Text } from "@/components/ui/text/text"
import { useTr } from "@/lib/app-language"
import { colors, accentInput } from "@/lib/theme/tokens"
import { useTabletLayout } from "@/lib/use-tablet-ui"
import { PluginWebviewSlot } from "@/main/_features/plugin/plugin-webview"
import { useCurrentUser, useIsSimulatedUser } from "@/main/_hooks/use-server-status"
import {
    chooseListStatus,
    clampStep,
    formatFieldDate,
    listEntryDefaults,
    type ListEntryForm,
    listStatusOptions,
    progressMaxFor,
    stepInputText,
    stepShownText,
    submitListEntry,
    entryButton,
    addingDone,
} from "@/main/_features/media/_lib/list-entry-form"
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker"
import CalendarDays from "lucide-react-native/icons/calendar-days"
import ListPlus from "lucide-react-native/icons/list-plus"
import Minus from "lucide-react-native/icons/minus"
import Plus from "lucide-react-native/icons/plus"
import SquarePen from "lucide-react-native/icons/square-pen"
import Trash2 from "lucide-react-native/icons/trash"
import X from "lucide-react-native/icons/x"
import React from "react"
import { ActivityIndicator, Pressable, TextInput, View } from "react-native"

/*
 * The AniList list entry (anilist-media-entry-modal.tsx, Android sheet): status chips, -/+ steppers for progress and score,
 * start and completion date, rewatches, remove with one confirmation, save. Same defaults, limits and submit payload as
 * the web form (list-entry-form.ts). Phone: a bottom sheet; tablet: a centred dialog as in 2.0.33.
 * The dates use the system date picker (DateTimePickerAndroid); iOS gets its picker with E7.
 * Without a list entry the button adds the anime to Planning at once, as on the web.
 */

type ListData = Anime_EntryListData | Manga_EntryListData

export function AnilistMediaEntryButton({ media, listData, type = "anime", variant = "round" }: {
    media?: AL_BaseAnime | AL_BaseManga
    listData?: ListData
    type?: "anime" | "manga"
    /** round: the 52dp button of the progress block (tablet: a pill with "Edit"); action: a secondary pill (the preview sheet) */
    variant?: "round" | "action"
}) {
    const tr = useTr()
    const user = useCurrentUser()
    const { rail } = useTabletLayout()
    const [open, setOpen] = React.useState(false)
    const { mutate, isPending: isEditing, isSuccess, reset } = useEditAnilistListEntry(media?.id, type)
    // the added entry arrived: forget the add, so the button comes back if the entry is removed elsewhere later (5a-K)
    React.useEffect(() => {
        if (addingDone(isSuccess, listData)) reset()
    }, [isSuccess, listData, reset])

    const shown = entryButton(user, listData, isSuccess)
    if (shown === "none") return null

    if (shown === "add" || !listData) {
        // a list icon with its words: a bare "+" beside the progress read as "+1 episode"
        const addLabel = tr("Add to list", "Zur Liste")
        const add = () => mutate({ mediaId: media?.id || 0, status: "PLANNING", score: 0, progress: 0, startedAt: undefined, completedAt: undefined, type })
        if (variant === "action") {
            return <Button intent="secondary" leftIcon={<ListPlus size={18} color={colors.smText} />} onPress={add} disabled={isEditing}
                accessibilityLabel={tr("Add to list", "Zur Liste hinzufügen")}>
                {addLabel}
            </Button>
        }
        return <Pressable accessibilityRole="button" accessibilityLabel={tr("Add to list", "Zur Liste hinzufügen")} disabled={isEditing} onPress={add}
            className="h-12 flex-row items-center justify-center gap-2 rounded-full bg-sm-surface-control pl-3.5 pr-[18px] active:bg-sm-accent-soft">
            {isEditing ? <ActivityIndicator size="small" color={colors.smText} /> : <ListPlus size={18} color={colors.smText} />}
            <Text className="text-sm font-semibold">{addLabel}</Text>
        </Pressable>
    }

    const label = tr("Edit list, progress and rating", "Liste, Fortschritt und Wertung bearbeiten")
    return <>
        {variant === "action"
            ? <Button intent="secondary" leftIcon={<SquarePen size={18} color={colors.smText} />} onPress={() => setOpen(true)} accessibilityLabel={label}>
                {tr("Edit", "Bearbeiten")}
            </Button>
            : <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => setOpen(true)}
                className={cn("flex-row items-center justify-center gap-2 rounded-full bg-sm-surface-control active:bg-sm-accent-soft",
                    rail ? "h-12 pl-3.5 pr-[18px]" : "h-[52px] w-[52px]")}>
                <SquarePen size={rail ? 18 : 24} color={colors.smText} />
                {rail && <Text className="text-sm font-semibold">{tr("Edit", "Bearbeiten")}</Text>}
            </Pressable>}
        {open && <AnilistMediaEntrySheet media={media} listData={listData} type={type} open={open} onOpenChange={setOpen} />}
    </>
}

function AnilistMediaEntrySheet({ media, listData, type, open, onOpenChange }: {
    media?: AL_BaseAnime | AL_BaseManga
    listData: ListData
    type: "anime" | "manga"
    open: boolean
    onOpenChange: (open: boolean) => void
}) {
    const t = useTr()
    const { isTablet } = useTabletLayout()
    const [form, setForm] = React.useState<ListEntryForm>(() => listEntryDefaults(listData))
    const [repeat, setRepeat] = React.useState<number | null>(listData.repeat || 0)
    const [confirmDelete, setConfirmDelete] = React.useState(false)
    const isGuest = useIsSimulatedUser()
    const { mutate, isPending: isEditing, isError: saveFailed } = useEditAnilistListEntry(media?.id, type)
    const { mutate: mutateRepeat, isPending: isRepeating, isError: repeatFailed } = useUpdateAnimeEntryRepeat(media?.id)
    const { mutate: deleteEntry, isPending: isDeleting } = useDeleteAnilistListEntry(media?.id, type, () => onOpenChange(false))
    const released = media?.status !== "NOT_YET_RELEASED"
    const max = progressMaxFor(media, type)
    const total = type === "anime" ? (media as AL_BaseAnime | undefined)?.episodes : (media as AL_BaseManga | undefined)?.chapters

    const save = () => submitListEntry(form, repeat, listData.repeat, media?.id || 0, type, {
        saveEntry: (body, options) => mutate(body, options),
        saveRepeat: (body, options) => mutateRepeat(body, options),
        close: () => onOpenChange(false),
    })

    const pickDate = (field: "startedAt" | "completedAt") => DateTimePickerAndroid.open({
        value: form[field] ?? new Date(),
        mode: "date",
        onChange: (event, date) => {
            if (event.type === "set" && date) setForm(f => ({ ...f, [field]: date }))
        },
    })

    const clearDate = (field: "startedAt" | "completedAt") => setForm(f => ({ ...f, [field]: null }))

    const body = <View className="gap-4">
        <View accessibilityRole="radiogroup" accessibilityLabel={t("Status", "Status")} className="flex-row flex-wrap gap-1.5">
            {listStatusOptions(t, type, released).map(option => {
                const checked = form.status === option.value
                return <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked }} onPress={() => setForm(f => chooseListStatus(f, option.value, media, type, new Date()))}
                    className={cn("min-h-12 grow basis-[100px] items-center justify-center rounded-full px-2 py-1", checked ? "bg-sm-accent-soft" : "bg-sm-surface-raised active:bg-sm-surface-control")}>
                    <Text className={cn("text-[13px]", checked ? "font-semibold text-sm-accent" : "font-medium text-sm-text-muted")}>{option.label}</Text>
                </Pressable>
            })}
        </View>
        {released && <>
            <View className="flex-row flex-wrap gap-2">
                <Field label={t("Progress", "Fortschritt")}>
                    <Stepper label={t("Progress", "Fortschritt")} value={form.progress} max={max} suffix={total ? `/ ${total}` : undefined} onValue={progress => setForm(f => ({ ...f, progress }))} />
                </Field>
                <Field label={t("Score", "Bewertung")}>
                    <Stepper label={t("Score", "Bewertung")} value={form.score} max={10} decimals suffix="/ 10" onValue={score => setForm(f => ({ ...f, score }))} />
                </Field>
            </View>
            <View className="flex-row flex-wrap gap-2">
                <Field label={t("Start date", "Startdatum")}><DateField value={form.startedAt} label={t("Start date", "Startdatum")} onPress={() => pickDate("startedAt")} onClear={() => clearDate("startedAt")} /></Field>
                <Field label={t("Completion date", "Enddatum")}><DateField value={form.completedAt} label={t("Completion date", "Enddatum")} onPress={() => pickDate("completedAt")} onClear={() => clearDate("completedAt")} /></Field>
            </View>
            <View className="flex-row flex-wrap items-center justify-between gap-3">
                <Text className="text-[13px] font-medium text-sm-text-muted">{type === "anime" ? t("Total rewatches", "Wiederholungen") : t("Total rereads", "Erneut gelesen")}</Text>
                <View className="w-[152px]">
                    <Stepper label={type === "anime" ? t("Total rewatches", "Wiederholungen") : t("Total rereads", "Erneut gelesen")} value={repeat} max={1000} onValue={setRepeat} />
                </View>
            </View>
        </>}
        {/* a plugin's own HTML under the form (web anilist-media-entry-modal) */}
        <PluginWebviewSlot slot="after-media-entry-form" />
    </View>

    const footer = <View className="flex-1 flex-row flex-wrap items-center justify-between gap-3">
        {(saveFailed || repeatFailed) && !isEditing && !isRepeating && <Text accessibilityLiveRegion="polite" className="w-full text-[13px] text-sm-danger">
            {t("Not saved. Your changes are still here.", "Nicht gespeichert. Deine Änderungen sind noch da.")}
        </Text>}
        <View className="flex-row items-center gap-2">
            <Pressable accessibilityRole="button" accessibilityLabel={t("Remove from list", "Aus Liste entfernen")} onPress={() => setConfirmDelete(v => !v)}
                className="h-12 w-12 items-center justify-center rounded-full active:bg-sm-surface-control">
                <Trash2 size={20} color={colors.smDanger} />
            </Pressable>
            {confirmDelete && <Button intent="danger" loading={isDeleting} onPress={() => deleteEntry({ mediaId: media?.id!, type })}>{t("Confirm", "Bestätigen")}</Button>}
        </View>
        <Button wrapperClassName="ml-auto min-w-[136px]" loading={isEditing || isRepeating} disabled={isDeleting} onPress={save}>{t("Save", "Speichern")}</Button>
    </View>

    const title = media?.title?.userPreferred || ""
    // where the entry lives: the guest's lists are kept on the phone only
    const where = isGuest ? t("On this device", "Auf diesem Gerät") : "AniList"
    return isTablet
        ? <Dialog title={title} description={where} open={open} onOpenChange={onOpenChange} footer={footer}>{body}</Dialog>
        : <Sheet title={title} description={where} open={open} onOpenChange={onOpenChange} footer={footer}>{body}</Sheet>
}

function Field({ label, children }: { label: string, children: React.ReactNode }) {
    return <View className="min-w-[132px] flex-1 gap-1.5">
        <Text className="text-[13px] font-medium text-sm-text-muted">{label}</Text>
        {children}
    </View>
}

/** A tap picks the date; with one set, the ✕ beside it empties the field (saved as no date). */
function DateField({ value, label, onPress, onClear }: { value: Date | null, label: string, onPress: () => void, onClear: () => void }) {
    const t = useTr()
    return <View className="min-h-12 flex-row items-center overflow-hidden rounded-surface-sm bg-sm-surface-raised">
        <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${formatFieldDate(value) || "–"}`} onPress={onPress}
            className="min-h-12 min-w-0 flex-1 flex-row items-center justify-between px-3 active:bg-sm-surface-control">
            <Text className={cn("text-sm", !value && "text-sm-text-subtle")} style={{ fontVariant: ["tabular-nums"] }}>{formatFieldDate(value) || "–"}</Text>
            {!value && <CalendarDays size={18} color={colors.smTextMuted} />}
        </Pressable>
        {!!value && <Pressable accessibilityRole="button" accessibilityLabel={`${t("Remove date", "Datum entfernen")}: ${label}`} onPress={onClear}
            className="h-12 w-12 items-center justify-center active:bg-sm-surface-control">
            <X size={18} color={colors.smTextMuted} />
        </Pressable>}
    </View>
}

function Stepper({ value, onValue, min = 0, max, decimals, suffix, label }: {
    value: number | null, onValue: (value: number | null) => void, min?: number, max?: number, decimals?: boolean, suffix?: string, label: string
}) {
    const t = useTr()
    const limits = { min, max, decimals }
    const [draft, setDraft] = React.useState<string | null>(null)
    const current = value ?? min
    const shown = stepShownText(draft, value, limits)
    return <View className="min-h-12 flex-row items-center rounded-surface-sm bg-sm-surface-raised">
        <Pressable accessibilityRole="button" accessibilityLabel={`${t("Decrease", "Verringern")}: ${label}`} disabled={value === null || current <= min}
            onPress={() => onValue(clampStep(Math.ceil(current) - 1, limits))}
            className={cn("h-12 w-12 items-center justify-center rounded-surface-sm active:bg-sm-surface-control", (value === null || current <= min) && "opacity-40")}>
            <Minus size={18} color={colors.smText} />
        </Pressable>
        <View className="min-w-0 flex-1 flex-row items-baseline justify-center gap-1">
            <TextInput {...accentInput} value={shown} placeholder="–" placeholderTextColor={colors.smTextSubtle} accessibilityLabel={label}
                keyboardType={decimals ? "decimal-pad" : "number-pad"}
                onChangeText={text => {
                    const next = stepInputText(text, shown, limits)
                    setDraft(next.text)
                    if (next.value !== undefined) onValue(next.value)
                }}
                onBlur={() => setDraft(null)}
                className="min-w-[30px] p-0 text-right font-sans text-base font-semibold text-sm-text" style={{ fontVariant: ["tabular-nums"] }} />
            {!!suffix && <Text className="text-[13px] text-sm-text-subtle">{suffix}</Text>}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={`${t("Increase", "Erhöhen")}: ${label}`} disabled={max !== undefined && current >= max}
            onPress={() => onValue(clampStep(value === null ? min + 1 : Math.floor(current) + 1, limits))}
            className={cn("h-12 w-12 items-center justify-center rounded-surface-sm active:bg-sm-surface-control", max !== undefined && current >= max && "opacity-40")}>
            <Plus size={18} color={colors.smText} />
        </Pressable>
    </View>
}
