import { useServerMutation } from "@/api/client/requests"
import { SaveDebridSettings_Variables, SaveTorrentstreamSettings_Variables } from "@/api/generated/endpoint.types"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { Models_DebridSettings, Models_TorrentstreamSettings } from "@/api/generated/types"
import { useAnimeListTorrentProviderExtensions } from "@/api/hooks/extensions.hooks"
import { serverStatusAtom } from "@/app/(main)/_atoms/server-status.atoms"
import { PhoneNotice, PhoneSwitch } from "@/app/(main)/_features/phone-screen/phone-screen"
import { useServerStatus } from "@/app/(main)/_hooks/use-server-status"
import type { SettingsSectionId } from "@/app/(main)/settings/_screens/settings-phone"
import { SelectOption, SelectRow, SettingsGroup, useSaveSetting, useSettingValue } from "@/app/(main)/settings/_screens/settings-phone-kit"
import { Translate, useTr } from "@/lib/app-language"
import { useRouter } from "@/lib/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { atom, useAtomValue, useSetAtom, useStore } from "jotai"
import React from "react"
import { toast } from "sonner"

/**
 * Torrents & debrid: the torrent search provider, torrent streaming, downloads with the built-in client and a debrid service.
 * Torrent streaming and debrid are their own settings rows on the server (PATCH /torrentstream/settings, PATCH /debrid/settings
 * with the whole row); a change is saved at once as the stored row plus the change, the download client's values go through
 * PATCH /settings/path like every other row. Left out (desktop only): the torrent client's listening host and port, the stream
 * URL address for desktop players, the cache folder, IPv6, slow seeding and accelerated startup (network tuning for a PC).
 */

type Kind = "torrentstream" | "debrid"
type Row<K extends Kind> = K extends "torrentstream" ? Models_TorrentstreamSettings : Models_DebridSettings
type DataAttributes = { [key: `data-${string}`]: string | number | boolean | undefined }

const STATUS_FIELD = { torrentstream: "torrentstreamSettings", debrid: "debridSettings" } as const
const SAVE = { torrentstream: API_ENDPOINTS.TORRENTSTREAM.SaveTorrentstreamSettings, debrid: API_ENDPOINTS.DEBRID.SaveDebridSettings }
const GET_KEY = { torrentstream: API_ENDPOINTS.TORRENTSTREAM.GetTorrentstreamSettings.key, debrid: API_ENDPOINTS.DEBRID.GetDebridSettings.key }

/** Values being saved, by "<kind>:<field>" */
const pendingAtom = atom<Record<string, unknown>>({})

/** One save at a time: each request sends the whole row, so two at once could undo each other. */
let saveQueue: Promise<unknown> = Promise.resolve()
function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const next = saveQueue.then(job, job)
    saveQueue = next.catch(() => undefined)
    return next
}

/** Saves fields of the torrent streaming or debrid row on top of the stored row; resolves to the stored row, or null. */
function useSaveRow<K extends Kind>(kind: K) {
    const t = useTr()
    const qc = useQueryClient()
    const store = useStore()
    const setPending = useSetAtom(pendingAtom)
    const { mutateAsync } = useServerMutation<Row<K>, SaveTorrentstreamSettings_Variables | SaveDebridSettings_Variables>({
        endpoint: SAVE[kind].endpoint,
        method: SAVE[kind].methods[0],
        mutationKey: [SAVE[kind].key, "settings-phone"],
        // No default toast or console output: the request carries the debrid API key
        onError: () => {},
    })
    return React.useCallback(async (patch: Partial<Row<K>>): Promise<Row<K> | null> => {
        const entries = Object.fromEntries(Object.entries(patch).map(([field, value]) => [`${kind}:${field}`, value]))
        setPending(pending => ({ ...pending, ...entries }))
        try {
            const saved = await enqueue(() => {
                const stored = store.get(serverStatusAtom)?.[STATUS_FIELD[kind]]
                // Fields still being saved by an earlier change go along, so this save cannot undo them
                const pending = Object.fromEntries(Object.entries(store.get(pendingAtom))
                    .filter(([key]) => key.startsWith(`${kind}:`)).map(([key, value]) => [key.slice(kind.length + 1), value]))
                return mutateAsync({ settings: { ...stored, ...pending, ...patch } as any })
            })
            const status = store.get(serverStatusAtom)
            if (saved && status) {
                const next = { ...status, [STATUS_FIELD[kind]]: saved }
                store.set(serverStatusAtom, next)
                qc.setQueryData([API_ENDPOINTS.STATUS.GetStatus.key], next)
            }
            void qc.invalidateQueries({ queryKey: [GET_KEY[kind]] })
            return (saved ?? null) as Row<K> | null
        }
        catch {
            toast.error(t("The setting could not be saved. Try again.", "Die Einstellung konnte nicht gespeichert werden. Versuch es noch einmal."))
            return null
        }
        finally {
            setPending(pending => {
                const next = { ...pending }
                for (const [key, value] of Object.entries(entries)) if (Object.is(next[key], value)) delete next[key]
                return next
            })
        }
    }, [kind, mutateAsync, qc, setPending, store, t])
}

/** A field of the row as shown: the value being saved, else the stored one. */
function useRowValue<K extends Kind, F extends keyof Row<K>>(kind: K, field: F, fallback: Row<K>[F]): Row<K>[F] {
    const status = useServerStatus()
    const pending = useAtomValue(pendingAtom)
    const key = `${kind}:${String(field)}`
    if (key in pending) return pending[key] as Row<K>[F]
    const stored = (status?.[STATUS_FIELD[kind]] as Row<K> | undefined)?.[field]
    return (stored ?? fallback) as Row<K>[F]
}

function RowSwitch<K extends Kind>({ kind, field, label, note, ...data }: {
    kind: K
    field: keyof Row<K> & string
    label: string
    note?: string
} & DataAttributes) {
    const save = useSaveRow(kind)
    const value = useRowValue(kind, field, false as any)
    return <PhoneSwitch label={label} note={note} checked={!!value} {...{ [`data-${kind}-field`]: field }} {...data}
        onChange={checked => void save({ [field]: checked } as Partial<Row<K>>)} />
}

function resolutionOptions(t: Translate): SelectOption[] {
    return [
        { value: "-", label: t("Highest", "Höchste") },
        { value: "1080", label: "1080p" },
        { value: "720", label: "720p" },
        { value: "480", label: "480p" },
    ]
}

export function SettingsTorrentsSection({ t, onOpen }: { t: Translate, onOpen: (id: SettingsSectionId) => void }) {
    return <>
        <ProvidersGroup t={t} />
        <StreamingGroup t={t} />
        <DownloadsGroup t={t} onOpen={onOpen} />
        <DebridGroup t={t} />
    </>
}

/** The search provider for torrents, from the installed torrent provider extensions (as on the desktop page: "main" ones). */
function ProvidersGroup({ t }: { t: Translate }) {
    const save = useSaveSetting()
    const router = useRouter()
    const stored = useSettingValue("library.torrentProvider", "")
    const { data: extensions, isLoading } = useAnimeListTorrentProviderExtensions()
    const providers = (extensions ?? []).filter(extension => extension?.settings?.type === "main")
        .map(extension => ({ value: extension.id, label: extension.name })).sort((a, b) => a.label.localeCompare(b.label))
    const value = stored && stored !== "none" ? stored : "none"
    const options = [...providers, { value: "none", label: t("None", "Keiner") }]
    const shown = options.some(option => option.value === value) ? options : [...options, { value, label: t(`Not installed (${value})`, `Nicht installiert (${value})`) }]

    return <SettingsGroup id="torrents-providers" title={t("Torrent providers", "Torrent-Anbieter")}>
        {!isLoading && !providers.length
            ? <PhoneNotice data-settings-no-providers text={t("No torrent provider is installed. Torrent providers are installed under Extensions.",
                "Kein Torrent-Anbieter installiert. Torrent-Anbieter installierst du unter Erweiterungen.")}>
                <button type="button" className="ps-text-action" onClick={() => router.push("/extensions")} data-settings-open-extensions>
                    {t("Open Extensions", "Erweiterungen öffnen")}
                </button>
            </PhoneNotice>
            : <SelectRow id="pst-torrent-provider" label={t("Default provider", "Standard-Anbieter")} value={value} options={shown} disabled={isLoading}
                note={t("Searched when you look for torrents of an episode.", "Wird durchsucht, wenn du Torrents für eine Folge suchst.")}
                onChange={next => void save("library.torrentProvider", next)} data-setting="library.torrentProvider" />}
    </SettingsGroup>
}

/** Torrent streaming: plays an episode while its torrent downloads. */
function StreamingGroup({ t }: { t: Translate }) {
    const save = useSaveRow("torrentstream")
    const enabled = useRowValue("torrentstream", "enabled", false)
    const autoSelect = useRowValue("torrentstream", "autoSelect", false)
    const resolution = useRowValue("torrentstream", "preferredResolution", "")

    return <SettingsGroup id="torrents-streaming" title={t("Streaming torrents", "Torrents streamen")}
        note={t("Torrents use your connection's data, mobile data too. Streamed data is cached by the app while you watch.",
            "Torrents verbrauchen das Datenvolumen deiner Verbindung, auch mobile Daten. Gestreamte Daten speichert die App beim Schauen zwischen.")}>
        <RowSwitch kind="torrentstream" field="enabled" label={t("Torrent streaming", "Torrent-Streaming")}
            note={t("Play episodes from torrents while they download.", "Folgen aus Torrents abspielen, während sie laden.")} />
        {enabled && <>
            <RowSwitch kind="torrentstream" field="autoSelect" label={t("Auto-select the best torrent", "Besten Torrent automatisch wählen")}
                note={t("Picks a torrent for you instead of showing the list.", "Wählt einen Torrent für dich, statt die Liste zu zeigen.")} data-settings-sub />
            {autoSelect && <SelectRow id="pst-torrentstream-resolution" label={t("Preferred resolution", "Bevorzugte Auflösung")} value={resolution || "-"}
                options={resolutionOptions(t)} data-torrentstream-field="preferredResolution"
                onChange={next => void save({ preferredResolution: next === "-" ? "" : next })} />}
            <RowSwitch kind="torrentstream" field="preloadNextStream" label={t("Preload the next episode", "Nächste Folge vorladen")}
                note={t("Starts downloading it in the background. Experimental, uses more data.", "Lädt sie im Hintergrund. Experimentell, braucht mehr Daten.")}
                data-settings-sub />
            <RowSwitch kind="torrentstream" field="includeInLibrary" label={t("Streaming titles in your anime lists", "Streaming-Titel in deinen Anime-Listen")}
                note={t("Shows the titles you are streaming in your anime lists.", "Zeigt gestreamte Titel in deinen Anime-Listen.")} data-settings-sub />
        </>}
    </SettingsGroup>
}

/** KB/s choices; a stored value that is not one of them stays visible. */
function limitOptions(t: Translate, values: number[], stored: number): SelectOption[] {
    const label = (kb: number) => kb === 0 ? t("Unlimited", "Unbegrenzt") : kb >= 1024 && kb % 1024 === 0 ? `${kb / 1024} MB/s` : `${kb} KB/s`
    const all = values.includes(stored) ? values : [...values, stored].sort((a, b) => a - b)
    return all.map(kb => ({ value: String(kb), label: label(kb) }))
}

/** Downloads with the built-in torrent client (the only client on a phone). */
function DownloadsGroup({ t, onOpen }: { t: Translate, onOpen: (id: SettingsSectionId) => void }) {
    const save = useSaveSetting()
    const libraryPath = useSettingValue("library.libraryPath", "")
    const libraryPaths = useSettingValue<string[] | null>("library.libraryPaths", []) ?? []
    const download = useSettingValue("torrent.seanimeDownloadLimit", 0)
    const upload = useSettingValue("torrent.seanimeUploadLimit", 0)
    const active = useSettingValue("torrent.seanimeMaxActiveDownloads", 0) || 3
    const noFolder = !libraryPath.trim() && !libraryPaths.length

    return <SettingsGroup id="torrents-downloads" title={t("Downloads", "Downloads")}
        note={t("Downloaded torrents are saved to your local library folder.", "Geladene Torrents werden in deinem lokalen Bibliotheksordner gespeichert.")}>
        {noFolder && <PhoneNotice data-settings-no-library-folder text={t("No library folder is set yet. Choose one before you download.",
            "Es ist noch kein Bibliotheksordner gesetzt. Wähle einen, bevor du etwas lädst.")}>
            <button type="button" className="ps-text-action" onClick={() => onOpen("library")} data-settings-open-library>
                {t("Open Local library", "Lokale Bibliothek öffnen")}
            </button>
        </PhoneNotice>}
        <SelectRow id="pst-download-limit" label={t("Download limit", "Download-Limit")} value={String(download)}
            options={limitOptions(t, [0, 512, 1024, 2048, 5120, 10240, 20480], download)} data-setting="torrent.seanimeDownloadLimit"
            onChange={next => void save("torrent.seanimeDownloadLimit", Number(next))} />
        <SelectRow id="pst-upload-limit" label={t("Upload limit", "Upload-Limit")} value={String(upload)}
            note={t("Sharing back is part of how torrents work; a low limit saves data.", "Teilen gehört zu Torrents dazu; ein niedriges Limit spart Daten.")}
            options={limitOptions(t, [0, 64, 128, 256, 512, 1024, 2048], upload)} data-setting="torrent.seanimeUploadLimit"
            onChange={next => void save("torrent.seanimeUploadLimit", Number(next))} />
        <SelectRow id="pst-active-downloads" label={t("Downloads at the same time", "Gleichzeitige Downloads")} value={String(active)}
            options={Array.from(new Set([1, 2, 3, 4, 5, active])).sort((a, b) => a - b).map(n => ({ value: String(n), label: String(n) }))}
            data-setting="torrent.seanimeMaxActiveDownloads" onChange={next => void save("torrent.seanimeMaxActiveDownloads", Number(next))} />
    </SettingsGroup>
}

/** Values the server accepts (debrid/client/repository.go InitializeProvider). */
const DEBRID_PROVIDERS = [
    { value: "torbox", label: "TorBox" },
    { value: "realdebrid", label: "Real-Debrid" },
    { value: "alldebrid", label: "AllDebrid" },
    { value: "premiumize", label: "Premiumize" },
]

type KeyCheck = { state: "idle" | "checking" | "ok" } | { state: "failed", detail: string }

/**
 * Debrid: provider, API key, streaming. Saving the settings never fails for a wrong key: the server stores the row and only logs
 * that the provider could not sign in (InitializeProvider; TorBox and Real-Debrid do not even check the key there). So the key is
 * checked afterwards by asking the provider for its torrent list (GET /debrid/torrents), whose error is shown in the group.
 */
function DebridGroup({ t }: { t: Translate }) {
    const save = useSaveRow("debrid")
    const status = useServerStatus()
    const stored = status?.debridSettings
    const enabled = useRowValue("debrid", "enabled", false)
    const provider = useRowValue("debrid", "provider", "")
    const autoSelect = useRowValue("debrid", "streamAutoSelect", false)
    const resolution = useRowValue("debrid", "streamPreferredResolution", "")
    const providerName = DEBRID_PROVIDERS.find(item => item.value === provider)?.label ?? provider
    const check = useKeyCheck(stored)

    return <SettingsGroup id="torrents-debrid" title={t("Debrid", "Debrid")}
        note={t("A paid service that downloads torrents for you and streams them from its servers.",
            "Ein kostenpflichtiger Dienst, der Torrents für dich lädt und von seinen Servern streamt.")}>
        <RowSwitch kind="debrid" field="enabled" label={t("Debrid service", "Debrid-Dienst")}
            note={t("Stream and download through your debrid account.", "Über dein Debrid-Konto streamen und laden.")} />
        {enabled && <>
            <SelectRow id="pst-debrid-provider" label={t("Provider", "Anbieter")} value={provider || "-"} data-debrid-field="provider"
                options={[{ value: "-", label: t("None", "Keiner") }, ...DEBRID_PROVIDERS]}
                onChange={next => void save({ provider: next === "-" ? "" : next })} />
            {!!provider && <ApiKeyField t={t} providerName={providerName} hasKey={!!stored?.apiKey} check={check.result}
                onSave={async key => !!await save({ apiKey: key })} />}
            {check.result.state === "failed" && <PhoneNotice data-settings-debrid-error text={<>
                {t(`${providerName} did not accept the API key, or could not be reached.`, `${providerName} hat den API-Schlüssel nicht angenommen oder war nicht erreichbar.`)}
                {!!check.result.detail && <small className="pst-notice-detail" data-settings-debrid-error-detail>{check.result.detail}</small>}
            </>}>
                <button type="button" className="ps-text-action" onClick={check.run} data-settings-debrid-recheck>{t("Check again", "Erneut prüfen")}</button>
            </PhoneNotice>}
            <RowSwitch kind="debrid" field="streamAutoSelect" label={t("Auto-select the best torrent", "Besten Torrent automatisch wählen")}
                note={t("Picks a cached torrent for you instead of showing the list.", "Wählt einen zwischengespeicherten Torrent für dich, statt die Liste zu zeigen.")}
                data-settings-sub />
            {autoSelect && <SelectRow id="pst-debrid-resolution" label={t("Preferred resolution", "Bevorzugte Auflösung")} value={resolution || "-"}
                options={resolutionOptions(t)} data-debrid-field="streamPreferredResolution"
                onChange={next => void save({ streamPreferredResolution: next === "-" ? "" : next })} />}
            <RowSwitch kind="debrid" field="includeDebridStreamInLibrary" label={t("Streaming titles in your anime lists", "Streaming-Titel in deinen Anime-Listen")}
                note={t("Shows the titles you are streaming in your anime lists.", "Zeigt gestreamte Titel in deinen Anime-Listen.")} data-settings-sub />
        </>}
    </SettingsGroup>
}

/**
 * Checks the stored key when the section opens and whenever the server's enabled flag, provider or key changes. The
 * detail is the server's message with the key blanked out, in case a provider echoes it.
 */
function useKeyCheck(stored: Models_DebridSettings | undefined) {
    const [result, setResult] = React.useState<KeyCheck>({ state: "idle" })
    const latest = React.useRef(0)
    const { mutateAsync } = useServerMutation<unknown>({
        endpoint: API_ENDPOINTS.DEBRID.DebridGetTorrents.endpoint,
        method: API_ENDPOINTS.DEBRID.DebridGetTorrents.methods[0],
        mutationKey: [API_ENDPOINTS.DEBRID.DebridGetTorrents.key, "settings-phone"],
        onError: () => {},
    })
    const ready = !!stored?.enabled && !!stored.provider && !!stored.apiKey
    const key = stored?.apiKey ?? ""
    const run = React.useCallback(async () => {
        const id = ++latest.current
        if (!ready) {
            setResult({ state: "idle" })
            return
        }
        setResult({ state: "checking" })
        try {
            await mutateAsync()
            if (id === latest.current) setResult({ state: "ok" })
        }
        catch (error: any) {
            if (id !== latest.current) return
            const message = String(error?.response?.data?.error ?? "")
            const detail = (key.length >= 4 ? message.split(key).join("•••") : message).slice(0, 240)
            setResult({ state: "failed", detail })
        }
    }, [ready, key, mutateAsync])
    React.useEffect(() => { void run() }, [ready, stored?.provider, key])
    return { result, run }
}

/** The key is typed into an empty password field and saved with its own button; the stored key is never put back on screen. */
function ApiKeyField({ t, providerName, hasKey, check, onSave }: {
    t: Translate
    providerName: string
    hasKey: boolean
    check: KeyCheck
    onSave: (key: string) => Promise<boolean>
}) {
    const [draft, setDraft] = React.useState("")
    const [saving, setSaving] = React.useState(false)
    const id = React.useId()
    const note = check.state === "checking" ? t("Checking the key…", "Schlüssel wird geprüft …")
        : check.state === "ok" ? t(`Connected to ${providerName}.`, `Mit ${providerName} verbunden.`)
            : hasKey ? t("A key is saved. Enter a new one to replace it.", "Ein Schlüssel ist gespeichert. Gib einen neuen ein, um ihn zu ersetzen.")
                : t(`Find it in your ${providerName} account settings.`, `Du findest ihn in den Kontoeinstellungen von ${providerName}.`)
    const submit = async (event: React.FormEvent) => {
        event.preventDefault()
        const key = draft.trim()
        if (!key || saving) return
        setSaving(true)
        const ok = await onSave(key)
        setSaving(false)
        if (ok) setDraft("")
    }
    return <form className="pst-key" onSubmit={submit} data-settings-debrid-key data-settings-sub data-key-state={check.state}>
        <label htmlFor={id}>{t("API key", "API-Schlüssel")}</label>
        <input id={id} type="password" value={draft} onChange={event => setDraft(event.target.value)} autoComplete="off" autoCapitalize="off" autoCorrect="off"
            spellCheck={false} enterKeyHint="done" aria-describedby={`${id}-note`} aria-invalid={check.state === "failed"} data-settings-debrid-key-input
            placeholder={hasKey ? t("Saved key", "Gespeicherter Schlüssel") : t("Paste your API key", "API-Schlüssel einfügen")} />
        <small id={`${id}-note`} aria-live="polite">{note}</small>
        <button type="submit" className="ps-primary" disabled={!draft.trim() || saving} data-settings-debrid-key-save>
            {saving ? t("Saving…", "Wird gespeichert …") : t("Save key", "Schlüssel speichern")}
        </button>
    </form>
}
