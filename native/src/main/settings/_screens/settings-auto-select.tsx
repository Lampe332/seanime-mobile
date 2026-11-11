import type { Anime_AutoSelectPreference } from "@/api/generated/types"
import { useDeleteAutoSelectProfile, useGetAutoSelectProfile, useSaveAutoSelectProfile } from "@/api/hooks/auto_select.hooks"
import { useAnimeListTorrentProviderExtensions } from "@/api/hooks/extensions.hooks"
import { TextAction } from "@/components/shared/phone-kit"
import { Button } from "@/components/ui/button/button"
import { cn } from "@/components/ui/core/styling"
import { Sheet, SheetGroup } from "@/components/ui/sheet/sheet"
import { SwitchRow } from "@/components/ui/switch/switch"
import { Muted, Text } from "@/components/ui/text/text"
import { toast } from "@/components/ui/toast/toast-store"
import { type Translate } from "@/lib/app-language"
import { colors } from "@/lib/theme/tokens"
import { ConfirmSheet, LinkRow, SelectRow, SettingsGroup } from "@/main/settings/_components/settings-kit"
import {
    addToken,
    type AutoSelectForm,
    EMPTY_FORM,
    formEquals,
    formErrors,
    formToProfile,
    MAX_PROVIDERS,
    PREFERENCES,
    profileToForm,
    removeToken,
    toggleToken,
    withStored,
} from "@/main/settings/_lib/auto-select-profile"
import type { Option } from "@/main/settings/_lib/settings-phone"
import Plus from "lucide-react-native/icons/plus"
import X from "lucide-react-native/icons/x"
import React from "react"
import { Pressable, TextInput, View } from "react-native"

/*
 * Auto-select profile (settings-phone-auto-select.tsx): what the app prefers when it picks a torrent by itself while
 * streaming (torrent streaming and debrid, "Auto-select the best torrent"). One profile on the server
 * (GET/POST/DELETE /auto-select/profile); the form is edited in a sheet and saved as a whole, "Reset" deletes the profile.
 * Entries of the lists are ordered: the first one counts most.
 */

type ListKey = "providers" | "releaseGroups" | "resolutions" | "excludeTerms" | "preferredLanguages" | "preferredCodecs" | "preferredSources"
type PreferenceKey = "multipleAudioPreference" | "multipleSubsPreference" | "batchPreference" | "bestReleasePreference"

const RESOLUTIONS = ["2160p", "1440p", "1080p", "720p", "480p"].map(value => ({ value, label: value }))

// Values are what the server matches (comma separated alternatives of one entry, as in the profile's own examples)
const LANGUAGES: [string, string, string][] = [
    ["jp, jpn, japanese", "Japanese", "Japanisch"],
    ["en, eng, english", "English", "Englisch"],
    ["de, ger, german, deu", "German", "Deutsch"],
    ["fr, fre, french", "French", "Französisch"],
    ["es, spa, spanish", "Spanish", "Spanisch"],
    ["pt, por, portuguese", "Portuguese", "Portugiesisch"],
]
const CODECS: [string, string][] = [
    ["HEVC, x265, H.265", "HEVC (x265)"],
    ["AVC, x264, H.264", "AVC (x264)"],
    ["AV1", "AV1"],
    ["VP9", "VP9"],
]
const SOURCES: [string, string, string][] = [
    ["BD, BDRip, BD RIP, BluRay, Blu-Ray", "Blu-ray", "Blu-ray"],
    ["WEB, WEB-DL, WEBRip", "Web (WEB-DL)", "Web (WEB-DL)"],
    ["DVD, DVDRip", "DVD", "DVD"],
    ["HDTV, TV", "TV", "TV"],
    ["AT-X", "AT-X", "AT-X"],
]

function preferenceOptions(t: Translate): Option[] {
    const labels: Record<Anime_AutoSelectPreference, string> = {
        neutral: t("Don't care", "Egal"),
        prefer: t("Prefer", "Bevorzugen"),
        avoid: t("Avoid", "Vermeiden"),
        only: t("Only these", "Nur diese"),
        never: t("Never", "Nie"),
    }
    return PREFERENCES.map(value => ({ value, label: labels[value] }))
}

export function AutoSelectGroup({ t }: { t: Translate }) {
    const { data: profile, isLoading, isError } = useGetAutoSelectProfile()
    const remove = useDeleteAutoSelectProfile()
    const [open, setOpen] = React.useState(false)
    const [confirm, setConfirm] = React.useState(false)
    const saved = !!profile?.dbId

    return <SettingsGroup title={t("Auto-select", "Auto-Auswahl")}
        note={t("Applies when the app picks a torrent for you while streaming (\"Auto-select the best torrent\" above and with debrid).",
            "Gilt, wenn die App beim Streamen automatisch einen Torrent für dich wählt („Besten Torrent automatisch wählen“).")}>
        <LinkRow label={t("Auto-select profile", "Auto-Auswahl-Profil")} disabled={isLoading || isError}
            value={isLoading ? t("Loading…", "Lädt …") : isError ? t("Not available", "Nicht verfügbar") : saved ? t("Set", "Eingestellt") : t("Default", "Standard")}
            note={t("Release groups, languages, codecs, exclusions and more.", "Release-Gruppen, Sprachen, Codecs, Ausschlüsse und mehr.")}
            onPress={() => setOpen(true)} />
        {saved && <LinkRow label={t("Reset profile", "Profil zurücksetzen")} tone="danger" onPress={() => setConfirm(true)} />}
        {open && <AutoSelectSheet t={t} onClose={() => setOpen(false)} dbId={profile?.dbId ?? 0} stored={profileToForm(profile)} />}
        <ConfirmSheet open={confirm} onOpenChange={setConfirm} title={t("Reset auto-select profile?", "Auto-Auswahl-Profil zurücksetzen?")}
            text={t("All your auto-select preferences are deleted. The app goes back to its default choice (1080p).",
                "Alle deine Auto-Auswahl-Einstellungen werden gelöscht. Die App wählt dann wieder nach Standard (1080p).")}
            action={t("Reset", "Zurücksetzen")} danger
            onConfirm={() => remove.mutate(undefined, { onSuccess: () => toast.success(t("Profile reset.", "Profil zurückgesetzt.")) })} />
    </SettingsGroup>
}

/** The sheet is only mounted while open, so the draft starts from the stored profile each time */
function AutoSelectSheet({ t, onClose, dbId, stored }: { t: Translate, onClose: () => void, dbId: number, stored: AutoSelectForm }) {
    const save = useSaveAutoSelectProfile()
    const { data: extensions } = useAnimeListTorrentProviderExtensions()
    const [draft, setDraft] = React.useState<AutoSelectForm>(stored)
    const errors = formErrors(draft)
    const invalid = !!errors.minSize || !!errors.maxSize
    const dirty = !formEquals(draft, stored)
    const set = <K extends keyof AutoSelectForm>(key: K, value: AutoSelectForm[K]) => setDraft(current => ({ ...current, [key]: value }))
    const toggle = (key: ListKey, max?: number) => (value: string) => setDraft(current => ({ ...current, [key]: toggleToken(current[key], value, max) }))
    const asIs = (value: string) => ({ value, label: value })

    const providerChips = withStored(
        (extensions ?? []).filter(extension => extension?.settings?.type === "main").map(extension => ({ value: extension.id, label: extension.name })),
        draft.providers, asIs)
    const languageChips = withStored(LANGUAGES.map(([value, en, de]) => ({ value, label: t(en, de) })), draft.preferredLanguages, asIs)
    const codecChips = withStored(CODECS.map(([value, label]) => ({ value, label })), draft.preferredCodecs, asIs)
    const sourceChips = withStored(SOURCES.map(([value, en, de]) => ({ value, label: t(en, de) })), draft.preferredSources, asIs)
    const resolutionChips = withStored(RESOLUTIONS, draft.resolutions, asIs)

    const onSave = () => {
        if (invalid || save.isPending) return
        save.mutate({ profile: formToProfile(draft, dbId) }, {
            onSuccess: () => {
                toast.success(t("Auto-select profile saved.", "Auto-Auswahl-Profil gespeichert."))
                onClose()
            },
        })
    }

    const preferenceRow = (key: PreferenceKey, label: string, note: string) =>
        <SelectRow label={label} note={note} value={draft[key]} options={preferenceOptions(t)} onChange={value => set(key, value as Anime_AutoSelectPreference)} />

    return <Sheet title={t("Auto-select profile", "Auto-Auswahl-Profil")} open onOpenChange={open => !open && onClose()}
        description={t("Tap the chips in the order you want: the number on a chip is its priority, 1 counts most.",
            "Tippe die Chips in der gewünschten Reihenfolge an: die Zahl auf einem Chip ist seine Priorität, 1 zählt am meisten.")}
        footer={<>
            <Button intent="secondary" wrapperClassName="flex-1" onPress={onClose}>{t("Cancel", "Abbrechen")}</Button>
            <Button wrapperClassName="flex-1" disabled={invalid || save.isPending || !dirty} onPress={onSave}>
                {save.isPending ? t("Saving…", "Wird gespeichert …") : t("Save", "Speichern")}
            </Button>
        </>}>
        <SheetGroup title={t("Quality", "Qualität")}>
            <Rows>
                <ChipPicker label={t("Resolution", "Auflösung")} chips={resolutionChips} selected={draft.resolutions} onToggle={toggle("resolutions")} />
                <ChipPicker label={t("Providers (max. 3)", "Anbieter (max. 3)")} chips={providerChips} selected={draft.providers} onToggle={toggle("providers", MAX_PROVIDERS)}
                    empty={t("No torrent provider is installed.", "Kein Torrent-Anbieter installiert.")} />
            </Rows>
        </SheetGroup>

        <SheetGroup title={t("Language, codec, source", "Sprache, Codec, Quelle")}>
            <Rows>
                <ChipPicker label={t("Languages", "Sprachen")} chips={languageChips} selected={draft.preferredLanguages} onToggle={toggle("preferredLanguages")} />
                <SwitchRow label={t("Skip torrents without a preferred language", "Torrents ohne bevorzugte Sprache ablehnen")} checked={draft.requireLanguage}
                    onCheckedChange={value => set("requireLanguage", value)} />
            </Rows>
            <Rows>
                <ChipPicker label={t("Codecs", "Codecs")} chips={codecChips} selected={draft.preferredCodecs} onToggle={toggle("preferredCodecs")} />
                <SwitchRow label={t("Skip torrents without a preferred codec", "Torrents ohne bevorzugten Codec ablehnen")} checked={draft.requireCodec}
                    onCheckedChange={value => set("requireCodec", value)} />
            </Rows>
            <Rows>
                <ChipPicker label={t("Sources", "Quellen")} chips={sourceChips} selected={draft.preferredSources} onToggle={toggle("preferredSources")} />
                <SwitchRow label={t("Skip torrents without a preferred source", "Torrents ohne bevorzugte Quelle ablehnen")} checked={draft.requireSource}
                    onCheckedChange={value => set("requireSource", value)} />
            </Rows>
        </SheetGroup>

        <SheetGroup title={t("Release groups and exclusions", "Release-Gruppen und Ausschlüsse")}>
            <TokenList t={t} label={t("Preferred release groups", "Bevorzugte Release-Gruppen")} placeholder="SubsPlease" items={draft.releaseGroups}
                onChange={value => set("releaseGroups", value)} note={t("The first group counts most.", "Die erste Gruppe zählt am meisten.")} />
            <TokenList t={t} label={t("Excluded words", "Ausgeschlossene Begriffe")} placeholder="CamRip" items={draft.excludeTerms}
                onChange={value => set("excludeTerms", value)} note={t("Torrents with one of these words in the name are never picked.", "Torrents mit einem dieser Wörter im Namen werden nie gewählt.")} />
        </SheetGroup>

        <SheetGroup title={t("Kind of release", "Art der Veröffentlichung")}>
            <Rows>
                {preferenceRow("multipleAudioPreference", t("Multiple audio tracks", "Mehrere Tonspuren"), t("Multi or dual audio releases.", "Multi- oder Dual-Audio-Releases."))}
                {preferenceRow("multipleSubsPreference", t("Multiple subtitle tracks", "Mehrere Untertitel-Spuren"), t("Multi-subs releases.", "Releases mit vielen Untertiteln."))}
                {preferenceRow("batchPreference", t("Batches", "Komplettpakete"), t("Whole seasons in one torrent.", "Ganze Staffeln in einem Torrent."))}
                {preferenceRow("bestReleasePreference", t("Best releases", "Beste Releases"), t("Releases the provider marks as best.", "Releases, die der Anbieter als beste markiert."))}
            </Rows>
        </SheetGroup>

        <SheetGroup title={t("Limits", "Grenzen")}>
            <Field label={t("Minimum seeders", "Mindestanzahl Seeder")} value={draft.minSeeders} placeholder="0" numeric
                onChange={value => set("minSeeders", value.replace(/[^0-9]/g, ""))} />
            <Field label={t("Minimum size", "Mindestgröße")} placeholder="200MB" value={draft.minSize} onChange={value => set("minSize", value)}
                error={errors.minSize ? sizeError(t, errors.minSize) : undefined}
                note={t("For example 200MB or 1.5GB. Empty means no limit.", "Zum Beispiel 200MB oder 1.5GB. Leer heißt keine Grenze.")} />
            <Field label={t("Maximum size", "Maximalgröße")} placeholder="2GB" value={draft.maxSize} onChange={value => set("maxSize", value)}
                error={errors.maxSize ? sizeError(t, errors.maxSize) : undefined} note={t("Empty means no limit.", "Leer heißt keine Grenze.")} />
            <View className="flex-row">
                <TextAction label={t("Clear all fields", "Alle Felder leeren")} onPress={() => setDraft({ ...EMPTY_FORM })} disabled={formEquals(draft, EMPTY_FORM)} />
            </View>
        </SheetGroup>
    </Sheet>
}

function sizeError(t: Translate, error: "format" | "range") {
    return error === "format"
        ? t("Enter a number with a unit, like 500MB or 1.5GB.", "Gib eine Zahl mit Einheit ein, etwa 500MB oder 1.5GB.")
        : t("The maximum must not be below the minimum.", "Das Maximum darf nicht unter dem Minimum liegen.")
}

function Rows({ children }: { children: React.ReactNode }) {
    return <View className="gap-0.5 overflow-hidden rounded-surface">{children}</View>
}

/** `.pas-picker`: toggle chips under their label; the position in `selected` is the priority, shown as a number in front */
function ChipPicker({ label, chips, selected, onToggle, empty }: {
    label: string
    chips: Option[]
    selected: string[]
    onToggle: (value: string) => void
    empty?: string
}) {
    return (
        <View accessibilityLabel={label} className="gap-2.5 bg-sm-surface-raised px-4 pb-4 pt-3.5">
            <Text className="text-[15px] font-semibold">{label}</Text>
            {chips.length
                ? <View className="flex-row flex-wrap gap-2">
                    {chips.map(chip => {
                        const priority = selected.indexOf(chip.value) + 1
                        const pressed = priority > 0
                        return <Pressable key={chip.value} accessibilityRole="togglebutton" accessibilityState={{ checked: pressed }}
                            accessibilityLabel={pressed ? `${chip.label}, ${priority}` : chip.label} onPress={() => onToggle(chip.value)}
                            className={cn("min-h-12 flex-row items-center gap-1.5 rounded-full px-3.5",
                                pressed ? "bg-sm-accent-soft active:bg-sm-surface-control" : "bg-sm-surface-control active:bg-sm-line-strong")}>
                            {pressed && <View className="-ml-1.5 h-[22px] min-w-[22px] items-center justify-center rounded-full bg-sm-accent-strong px-1">
                                <Text className="text-xs font-bold text-white">{priority}</Text>
                            </View>}
                            <Text className={cn("text-sm", pressed ? "font-semibold text-sm-accent" : "font-medium text-sm-text")}>{chip.label}</Text>
                        </Pressable>
                    })}
                </View>
                : !!empty && <Muted className="text-[13px]">{empty}</Muted>}
        </View>
    )
}

const INPUT = "min-h-[52px] rounded-surface bg-sm-surface-raised px-4 font-sans text-base text-sm-text"

/** Free entries: a field with its add button beside it, the entries as chips under it (tap one to remove it). */
function TokenList({ t, label, placeholder, items, onChange, note }: {
    t: Translate
    label: string
    placeholder: string
    items: string[]
    onChange: (items: string[]) => void
    note?: string
}) {
    const [text, setText] = React.useState("")
    const add = () => {
        onChange(addToken(items, text))
        setText("")
    }
    return (
        <View className="min-w-0 gap-2">
            <Text className="text-sm font-semibold">{label}</Text>
            <View className="flex-row gap-2">
                <TextInput value={text} onChangeText={setText} placeholder={placeholder} placeholderTextColor={colors.smTextSubtle} accessibilityLabel={label}
                    autoCapitalize="none" autoCorrect={false} returnKeyType="done" onSubmitEditing={() => text.trim() && add()} className={cn(INPUT, "min-w-0 flex-1")} />
                <Button intent="secondary" size="lg" disabled={!text.trim()} onPress={add} leftIcon={<Plus size={18} color={colors.smText} />}>
                    {t("Add", "Hinzufügen")}
                </Button>
            </View>
            {!!note && <Muted className="text-[13px] leading-[19px]">{note}</Muted>}
            {!!items.length && <View className="flex-row flex-wrap gap-2">
                {items.map(item => <Pressable key={item} accessibilityRole="button" accessibilityLabel={t(`Remove ${item}`, `${item} entfernen`)}
                    onPress={() => onChange(removeToken(items, item))}
                    className="min-h-12 flex-row items-center gap-1.5 rounded-full bg-sm-surface-raised pl-3.5 pr-3 active:bg-sm-surface-control">
                    <Text className="text-sm font-medium">{item}</Text>
                    <X size={16} color={colors.smTextMuted} />
                </Pressable>)}
            </View>}
        </View>
    )
}

function Field({ label, value, placeholder, onChange, note, error, numeric }: {
    label: string
    value: string
    placeholder: string
    onChange: (value: string) => void
    note?: string
    error?: string
    numeric?: boolean
}) {
    return (
        <View className="gap-2">
            <Text className="text-sm font-semibold">{label}</Text>
            <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={colors.smTextSubtle} accessibilityLabel={label}
                autoCapitalize="none" autoCorrect={false} keyboardType={numeric ? "number-pad" : "default"} returnKeyType="done"
                className={cn(INPUT, !!error && "border-2 border-sm-danger")} />
            {(!!error || !!note) && <Text accessibilityRole={error ? "alert" : undefined}
                className={cn("text-[13px] leading-[19px]", error ? "text-sm-danger" : "text-sm-text-muted")}>{error ?? note}</Text>}
        </View>
    )
}
