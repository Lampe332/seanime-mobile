import { Anime_AutoSelectPreference } from "@/api/generated/types"
import { useDeleteAutoSelectProfile, useGetAutoSelectProfile, useSaveAutoSelectProfile } from "@/api/hooks/auto_select.hooks"
import { useAnimeListTorrentProviderExtensions } from "@/api/hooks/extensions.hooks"
import { PhoneChips, PhoneField, PhoneSheetGroup, PhoneSwitch } from "@/app/(main)/_features/phone-screen/phone-screen"
import {
    addToken,
    AutoSelectForm,
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
} from "@/app/(main)/settings/_screens/auto-select-profile"
import { ConfirmSheet, LinkRow, SelectOption, SelectRow, SettingsGroup, SettingsSheet } from "@/app/(main)/settings/_screens/settings-phone-kit"
import { Translate } from "@/lib/app-language"
import React from "react"
import { LuPlus, LuX } from "react-icons/lu"
import { toast } from "sonner"

/**
 * Auto-select profile: what the app prefers when it picks a torrent by itself while streaming (torrent streaming and debrid,
 * "Auto-select the best torrent"). One profile on the server (GET/POST/DELETE /auto-select/profile); the form is edited in a
 * sheet and saved as a whole, "Reset" deletes the profile again. Entries of the lists are ordered: the first one counts most.
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

function preferenceOptions(t: Translate): SelectOption[] {
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
    const row = React.useRef<HTMLButtonElement>(null)
    const saved = !!profile?.dbId

    return <SettingsGroup id="torrents-auto-select" title={t("Auto-select", "Auto-Auswahl")} data-settings-auto-select
        note={t("Applies when the app picks a torrent for you while streaming (\"Auto-select the best torrent\" above and with debrid).",
            "Gilt, wenn die App beim Streamen automatisch einen Torrent für dich wählt („Besten Torrent automatisch wählen“).")}>
        <LinkRow ref={row} label={t("Auto-select profile", "Auto-Auswahl-Profil")} disabled={isLoading || isError}
            value={isLoading ? t("Loading…", "Lädt …") : isError ? t("Not available", "Nicht verfügbar") : saved ? t("Set", "Eingestellt") : t("Default", "Standard")}
            note={t("Release groups, languages, codecs, exclusions and more.", "Release-Gruppen, Sprachen, Codecs, Ausschlüsse und mehr.")}
            onClick={() => setOpen(true)} data-settings-auto-select-open />
        {saved && <LinkRow label={t("Reset profile", "Profil zurücksetzen")} tone="danger" onClick={() => setConfirm(true)} data-settings-auto-select-reset />}
        {open && <AutoSelectSheet t={t} open={open} onOpenChange={setOpen} dbId={profile?.dbId ?? 0} form={profileToForm(profile)} returnFocusRef={row} />}
        <ConfirmSheet t={t} open={confirm} onOpenChange={setConfirm} title={t("Reset auto-select profile?", "Auto-Auswahl-Profil zurücksetzen?")}
            text={t("All your auto-select preferences are deleted. The app goes back to its default choice (1080p).",
                "Alle deine Auto-Auswahl-Einstellungen werden gelöscht. Die App wählt dann wieder nach Standard (1080p).")}
            action={t("Reset", "Zurücksetzen")} danger returnFocusRef={row}
            onConfirm={() => remove.mutate(undefined, { onSuccess: () => toast.success(t("Profile reset.", "Profil zurückgesetzt.")) })} />
    </SettingsGroup>
}

function AutoSelectSheet({ t, open, onOpenChange, dbId, form: stored, returnFocusRef }: {
    t: Translate
    open: boolean
    onOpenChange: (open: boolean) => void
    dbId: number
    form: AutoSelectForm
    returnFocusRef: React.RefObject<HTMLElement | null>
}) {
    const save = useSaveAutoSelectProfile()
    const { data: extensions } = useAnimeListTorrentProviderExtensions()
    // The draft starts from the stored profile each time the sheet opens (the sheet is only mounted while open)
    const [draft, setDraft] = React.useState<AutoSelectForm>(stored)
    const errors = formErrors(draft)
    const invalid = !!errors.minSize || !!errors.maxSize
    const dirty = !formEquals(draft, stored)
    const set = <K extends keyof AutoSelectForm>(key: K, value: AutoSelectForm[K]) => setDraft(current => ({ ...current, [key]: value }))
    const toggle = (key: ListKey, max?: number) => (value: string) => setDraft(current => ({ ...current, [key]: toggleToken(current[key], value, max) }))

    const providerChips = withStored(
        (extensions ?? []).filter(extension => extension?.settings?.type === "main").map(extension => ({ value: extension.id, label: extension.name })),
        draft.providers, value => ({ value, label: value }))
    const languageChips = withStored(LANGUAGES.map(([value, en, de]) => ({ value, label: t(en, de) })), draft.preferredLanguages, value => ({ value, label: value }))
    const codecChips = withStored(CODECS.map(([value, label]) => ({ value, label })), draft.preferredCodecs, value => ({ value, label: value }))
    const sourceChips = withStored(SOURCES.map(([value, en, de]) => ({ value, label: t(en, de) })), draft.preferredSources, value => ({ value, label: value }))
    const resolutionChips = withStored(RESOLUTIONS, draft.resolutions, value => ({ value, label: value }))
    const order = t("Tap the chips in the order you want: the number on a chip is its priority, 1 counts most.",
        "Tippe die Chips in der gewünschten Reihenfolge an: die Zahl auf einem Chip ist seine Priorität, 1 zählt am meisten.")

    const onSave = () => {
        if (invalid || save.isPending) return
        save.mutate({ profile: formToProfile(draft, dbId) }, {
            onSuccess: () => {
                toast.success(t("Auto-select profile saved.", "Auto-Auswahl-Profil gespeichert."))
                onOpenChange(false)
            },
        })
    }

    const preferenceRow = (key: PreferenceKey, label: string, note: string) =>
        <SelectRow id={`pas-${key}`} label={label} note={note} value={draft[key]} options={preferenceOptions(t)}
            onChange={value => set(key, value as Anime_AutoSelectPreference)} data-auto-select-field={key} />

    return <SettingsSheet title={t("Auto-select profile", "Auto-Auswahl-Profil")} open={open} onOpenChange={onOpenChange} returnFocusRef={returnFocusRef}
        data-settings-auto-select-sheet
        footer={<>
            <button type="button" className="ps-secondary" onClick={() => onOpenChange(false)} data-auto-select-cancel>{t("Cancel", "Abbrechen")}</button>
            <button type="button" className="ps-primary" onClick={onSave} disabled={invalid || save.isPending || !dirty} data-auto-select-save>
                {save.isPending ? t("Saving…", "Wird gespeichert …") : t("Save", "Speichern")}
            </button>
        </>}>
        <p className="ps-sheet-note">{order}</p>

        <PhoneSheetGroup title={t("Quality", "Qualität")}>
            <div className="ps-rows">
                <ChipPicker label={t("Resolution", "Auflösung")} chips={resolutionChips} selected={draft.resolutions} onToggle={toggle("resolutions")} data-auto-select-field="resolutions" />
                <ChipPicker label={t("Providers (max. 3)", "Anbieter (max. 3)")} chips={providerChips} selected={draft.providers} onToggle={toggle("providers", MAX_PROVIDERS)}
                    data-auto-select-field="providers" empty={t("No torrent provider is installed.", "Kein Torrent-Anbieter installiert.")} />
            </div>
        </PhoneSheetGroup>

        <PhoneSheetGroup title={t("Language, codec, source", "Sprache, Codec, Quelle")}>
            <div className="ps-rows">
                <ChipPicker label={t("Languages", "Sprachen")} chips={languageChips} selected={draft.preferredLanguages} onToggle={toggle("preferredLanguages")}
                    data-auto-select-field="preferredLanguages" />
                <PhoneSwitch label={t("Skip torrents without a preferred language", "Torrents ohne bevorzugte Sprache ablehnen")} checked={draft.requireLanguage}
                    onChange={value => set("requireLanguage", value)} data-auto-select-field="requireLanguage" />
            </div>
            <div className="ps-rows">
                <ChipPicker label={t("Codecs", "Codecs")} chips={codecChips} selected={draft.preferredCodecs} onToggle={toggle("preferredCodecs")} data-auto-select-field="preferredCodecs" />
                <PhoneSwitch label={t("Skip torrents without a preferred codec", "Torrents ohne bevorzugten Codec ablehnen")} checked={draft.requireCodec}
                    onChange={value => set("requireCodec", value)} data-auto-select-field="requireCodec" />
            </div>
            <div className="ps-rows">
                <ChipPicker label={t("Sources", "Quellen")} chips={sourceChips} selected={draft.preferredSources} onToggle={toggle("preferredSources")} data-auto-select-field="preferredSources" />
                <PhoneSwitch label={t("Skip torrents without a preferred source", "Torrents ohne bevorzugte Quelle ablehnen")} checked={draft.requireSource}
                    onChange={value => set("requireSource", value)} data-auto-select-field="requireSource" />
            </div>
        </PhoneSheetGroup>

        <PhoneSheetGroup title={t("Release groups and exclusions", "Release-Gruppen und Ausschlüsse")}>
            <TokenList t={t} id="pas-groups" label={t("Preferred release groups", "Bevorzugte Release-Gruppen")} placeholder="SubsPlease" items={draft.releaseGroups}
                onChange={value => set("releaseGroups", value)} note={t("The first group counts most.", "Die erste Gruppe zählt am meisten.")} data-auto-select-field="releaseGroups" />
            <TokenList t={t} id="pas-exclude" label={t("Excluded words", "Ausgeschlossene Begriffe")} placeholder="CamRip" items={draft.excludeTerms}
                onChange={value => set("excludeTerms", value)} note={t("Torrents with one of these words in the name are never picked.", "Torrents mit einem dieser Wörter im Namen werden nie gewählt.")}
                data-auto-select-field="excludeTerms" />
        </PhoneSheetGroup>

        <PhoneSheetGroup title={t("Kind of release", "Art der Veröffentlichung")}>
            <div className="ps-rows">
                {preferenceRow("multipleAudioPreference", t("Multiple audio tracks", "Mehrere Tonspuren"), t("Multi or dual audio releases.", "Multi- oder Dual-Audio-Releases."))}
                {preferenceRow("multipleSubsPreference", t("Multiple subtitle tracks", "Mehrere Untertitel-Spuren"), t("Multi-subs releases.", "Releases mit vielen Untertiteln."))}
                {preferenceRow("batchPreference", t("Batches", "Komplettpakete"), t("Whole seasons in one torrent.", "Ganze Staffeln in einem Torrent."))}
                {preferenceRow("bestReleasePreference", t("Best releases", "Beste Releases"), t("Releases the provider marks as best.", "Releases, die der Anbieter als beste markiert."))}
            </div>
        </PhoneSheetGroup>

        <PhoneSheetGroup title={t("Limits", "Grenzen")}>
            <PhoneField id="pas-seeders" label={t("Minimum seeders", "Mindestanzahl Seeder")} numeric value={draft.minSeeders} placeholder="0"
                onChange={value => set("minSeeders", value)} data-auto-select-field="minSeeders" />
            <PhoneField id="pas-min-size" label={t("Minimum size", "Mindestgröße")} placeholder="200MB" value={draft.minSize} onChange={value => set("minSize", value)}
                note={errors.minSize ? sizeError(t, errors.minSize) : t("For example 200MB or 1.5GB. Empty means no limit.", "Zum Beispiel 200MB oder 1.5GB. Leer heißt keine Grenze.")}
                data-auto-select-field="minSize" />
            <PhoneField id="pas-max-size" label={t("Maximum size", "Maximalgröße")} placeholder="2GB" value={draft.maxSize} onChange={value => set("maxSize", value)}
                note={errors.maxSize ? sizeError(t, errors.maxSize) : t("Empty means no limit.", "Leer heißt keine Grenze.")}
                data-auto-select-field="maxSize" />
            <button type="button" className="ps-text-action" onClick={() => setDraft({ ...EMPTY_FORM })} disabled={formEquals(draft, EMPTY_FORM)} data-auto-select-clear>
                {t("Clear all fields", "Alle Felder leeren")}
            </button>
        </PhoneSheetGroup>
    </SettingsSheet>
}

function sizeError(t: Translate, error: "format" | "range") {
    return error === "format"
        ? t("Enter a number with a unit, like 500MB or 1.5GB.", "Gib eine Zahl mit Einheit ein, etwa 500MB oder 1.5GB.")
        : t("The maximum must not be below the minimum.", "Das Maximum darf nicht unter dem Minimum liegen.")
}

/** Toggle chips of a choice under their label, a block among rows; the position in `selected` is the priority (the chip's number). */
function ChipPicker({ label, chips, selected, onToggle, empty, ...data }: {
    label: string
    chips: { value: string, label: string }[]
    selected: string[]
    onToggle: (value: string) => void
    empty?: string
    [key: `data-${string}`]: string
}) {
    return <div className="pas-picker" role="group" aria-label={label}>
        <span className="pas-label">{label}</span>
        {chips.length
            ? <PhoneChips label={label} variant="wrap" selected={selected} onToggle={onToggle} {...data}
                chips={chips.map(chip => ({ ...chip, count: selected.includes(chip.value) ? selected.indexOf(chip.value) + 1 : undefined }))} />
            : !!empty && <small>{empty}</small>}
    </div>
}

/** Free entries: a field with its add button beside it, the entries as chips under it (tap one to remove it). */
function TokenList({ t, id, label, placeholder, items, onChange, note, ...data }: {
    t: Translate
    id: string
    label: string
    placeholder: string
    items: string[]
    onChange: (items: string[]) => void
    note?: string
    [key: `data-${string}`]: string
}) {
    const [text, setText] = React.useState("")
    const add = (event: React.FormEvent) => {
        event.preventDefault()
        onChange(addToken(items, text))
        setText("")
    }
    return <form className="pas-tokens" onSubmit={add} {...data}>
        <label htmlFor={id}>{label}</label>
        <div className="pas-token-field">
            <input id={id} value={text} placeholder={placeholder} autoComplete="off" spellCheck={false} enterKeyHint="done"
                aria-describedby={note ? `${id}-note` : undefined} onChange={event => setText(event.target.value)} />
            <button type="submit" className="ps-secondary" disabled={!text.trim()} data-auto-select-add><LuPlus aria-hidden />{t("Add", "Hinzufügen")}</button>
        </div>
        {!!note && <small id={`${id}-note`}>{note}</small>}
        {!!items.length && <div className="ps-choices" role="group" aria-label={label}>
            {items.map(item => <button key={item} type="button" aria-label={t(`Remove ${item}`, `${item} entfernen`)} data-chip={item}
                onClick={() => onChange(removeToken(items, item))}>
                {item}<LuX aria-hidden />
            </button>)}
        </div>}
    </form>
}
