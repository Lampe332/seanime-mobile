import { useServerMutation, useServerQuery } from "@/api/client/requests"
import type { SaveDebridSettings_Variables, SaveTorrentstreamSettings_Variables } from "@/api/generated/endpoint.types"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import type { Models_DebridSettings, Models_TorrentstreamSettings } from "@/api/generated/types"
import { useAnimeListTorrentProviderExtensions } from "@/api/hooks/extensions.hooks"
import { Notice, TextAction } from "@/components/shared/phone-kit"
import { Button } from "@/components/ui/button/button"
import { cn } from "@/components/ui/core/styling"
import { SwitchRow } from "@/components/ui/switch/switch"
import { Muted, Text } from "@/components/ui/text/text"
import { type Translate, useTr } from "@/lib/app-language"
import { colors } from "@/lib/theme/tokens"
import { serverStatusAtom } from "@/main/_atoms/server-status.atoms"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { AutoSelectGroup } from "@/main/settings/_screens/settings-auto-select"
import { enqueue, pendingAtom, saveFailed, SelectRow, SettingsGroup, usePending, useSaveSetting, useSettingValue } from "@/main/settings/_components/settings-kit"
import { keyCheckDetail, limitOptions, type Option, planRestricted, type SettingsSectionId } from "@/main/settings/_lib/settings-phone"
import { useQueryClient } from "@tanstack/react-query"
import { useAtomValue, useStore } from "jotai"
import React from "react"
import { TextInput, View } from "react-native"

/*
 * Torrents & debrid (settings-phone-torrents.tsx): the torrent search provider, torrent streaming, auto-select, downloads
 * with the built-in client and a debrid service. Torrent streaming and debrid are their own settings rows on the server
 * (PATCH /torrentstream/settings, PATCH /debrid/settings with the whole row); a change is saved at once as the stored row
 * plus the change. Left out (desktop only): the client's host and port, the stream URL address for desktop players, the
 * cache folder, IPv6, slow seeding and accelerated startup.
 */

type Kind = "torrentstream" | "debrid"
type Row<K extends Kind> = K extends "torrentstream" ? Models_TorrentstreamSettings : Models_DebridSettings

const STATUS_FIELD = { torrentstream: "torrentstreamSettings", debrid: "debridSettings" } as const
const SAVE = { torrentstream: API_ENDPOINTS.TORRENTSTREAM.SaveTorrentstreamSettings, debrid: API_ENDPOINTS.DEBRID.SaveDebridSettings }

/** Saves fields of the torrent streaming or debrid row on top of the stored row; resolves to the stored row, or null. */
function useSaveRow<K extends Kind>(kind: K) {
    const t = useTr()
    const qc = useQueryClient()
    const store = useStore()
    const { begin, end } = usePending()
    const { mutateAsync } = useServerMutation<Row<K>, SaveTorrentstreamSettings_Variables | SaveDebridSettings_Variables>({
        endpoint: SAVE[kind].endpoint,
        method: SAVE[kind].methods[0],
        mutationKey: [SAVE[kind].key, "settings-phone"],
        // No default toast or console output: the request carries the debrid API key
        onError: () => {},
    })
    return React.useCallback(async (patch: Partial<Row<K>>): Promise<Row<K> | null> => {
        const entries = Object.fromEntries(Object.entries(patch).map(([field, value]) => [`${kind}:${field}`, value]))
        begin(entries)
        try {
            const saved = await enqueue(() => {
                const stored = store.get(serverStatusAtom)?.[STATUS_FIELD[kind]]
                // Fields still being saved by an earlier change go along, so this save cannot undo them
                const pending = Object.fromEntries(Object.entries(store.get(pendingAtom))
                    .filter(([key]) => key.startsWith(`${kind}:`)).map(([key, value]) => [key.slice(kind.length + 1), value]))
                const settings = { ...stored, ...pending, ...patch } as Models_TorrentstreamSettings & Models_DebridSettings
                return mutateAsync({ settings })
            })
            const status = store.get(serverStatusAtom)
            if (saved && status) {
                const next = { ...status, [STATUS_FIELD[kind]]: saved }
                store.set(serverStatusAtom, next)
                qc.setQueryData([API_ENDPOINTS.STATUS.GetStatus.key], next)
            }
            return (saved ?? null) as Row<K> | null
        }
        catch {
            saveFailed(t)
            return null
        }
        finally {
            end(entries)
        }
    }, [begin, end, kind, mutateAsync, qc, store, t])
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

function RowSwitch<K extends Kind>({ kind, field, label, note, sub }: {
    kind: K
    field: keyof Row<K> & string
    label: string
    note?: string
    sub?: boolean
}) {
    const save = useSaveRow(kind)
    const value = useRowValue(kind, field as keyof Row<K>, false as Row<K>[keyof Row<K>])
    return <SwitchRow label={label} description={note} checked={!!value} className={sub ? "pl-8" : undefined}
        onCheckedChange={checked => void save({ [field]: checked } as Partial<Row<K>>)} />
}

function resolutionOptions(t: Translate): Option[] {
    return [
        { value: "-", label: t("Highest", "Höchste") },
        { value: "1080", label: "1080p" },
        { value: "720", label: "720p" },
        { value: "480", label: "480p" },
    ]
}

export function SettingsTorrentsSection({ t, onOpen, onOpenExtensions }: {
    t: Translate
    onOpen: (id: SettingsSectionId) => void
    /** null while the Extensions screen (2.11) is not ready */
    onOpenExtensions: (() => void) | null
}) {
    return <>
        <ProvidersGroup t={t} onOpenExtensions={onOpenExtensions} />
        <StreamingGroup t={t} />
        <AutoSelectGroup t={t} />
        <DownloadsGroup t={t} onOpen={onOpen} />
        <DebridGroup t={t} />
    </>
}

/**
 * The search provider for torrents, from the installed torrent provider extensions ("main" ones, as on the desktop page).
 * There is no "None" on phones: the torrent search searches the first installed provider when the stored one is "none"
 * (earlier Android versions stored it themselves) or no longer installed, and that is the provider shown here.
 */
function ProvidersGroup({ t, onOpenExtensions }: { t: Translate, onOpenExtensions: (() => void) | null }) {
    const save = useSaveSetting()
    const stored = useSettingValue("library.torrentProvider", "")
    const { data: extensions, isLoading } = useAnimeListTorrentProviderExtensions()
    const providers = (extensions ?? []).filter(extension => extension?.settings?.type === "main")
        .map(extension => ({ value: extension.id, label: extension.name })).sort((a, b) => a.label.localeCompare(b.label))
    const searched = (extensions ?? []).find(extension => extension.id === stored) ?? extensions?.[0]
    const value = searched?.id ?? ""
    const shown = providers.some(option => option.value === value) || !searched ? providers : [...providers, { value, label: searched.name }]

    return <SettingsGroup title={t("Torrent providers", "Torrent-Anbieter")}>
        {!isLoading && !providers.length
            ? <Notice text={t("No torrent provider is installed. Torrent providers are installed under Extensions.",
                "Kein Torrent-Anbieter installiert. Torrent-Anbieter installierst du unter Erweiterungen.")}>
                {!!onOpenExtensions && <TextAction label={t("Open Extensions", "Erweiterungen öffnen")} onPress={onOpenExtensions} />}
            </Notice>
            : <SelectRow label={t("Default provider", "Standard-Anbieter")} value={value} options={shown} disabled={isLoading}
                note={t("Searched when you look for torrents of an episode.", "Wird durchsucht, wenn du Torrents für eine Folge suchst.")}
                onChange={next => void save("library.torrentProvider", next)} />}
    </SettingsGroup>
}

/** Torrent streaming: plays an episode while its torrent downloads. */
function StreamingGroup({ t }: { t: Translate }) {
    const save = useSaveRow("torrentstream")
    const enabled = useRowValue("torrentstream", "enabled", false)
    const autoSelect = useRowValue("torrentstream", "autoSelect", false)
    const resolution = useRowValue("torrentstream", "preferredResolution", "")

    return <SettingsGroup title={t("Streaming torrents", "Torrents streamen")}
        note={t("Torrents use your connection's data, mobile data too. Streamed data is cached by the app while you watch.",
            "Torrents verbrauchen das Datenvolumen deiner Verbindung, auch mobile Daten. Gestreamte Daten speichert die App beim Schauen zwischen.")}>
        <RowSwitch kind="torrentstream" field="enabled" label={t("Torrent streaming", "Torrent-Streaming")}
            note={t("Play episodes from torrents while they download.", "Folgen aus Torrents abspielen, während sie laden.")} />
        {enabled && <>
            <RowSwitch kind="torrentstream" field="autoSelect" label={t("Auto-select the best torrent", "Besten Torrent automatisch wählen")}
                note={t("Picks a torrent for you instead of showing the list.", "Wählt einen Torrent für dich, statt die Liste zu zeigen.")} sub />
            {autoSelect && <SelectRow label={t("Preferred resolution", "Bevorzugte Auflösung")} value={resolution || "-"} options={resolutionOptions(t)} sub
                onChange={next => void save({ preferredResolution: next === "-" ? "" : next })} />}
            <RowSwitch kind="torrentstream" field="preloadNextStream" label={t("Preload the next episode", "Nächste Folge vorladen")}
                note={t("Starts downloading it in the background. Experimental, uses more data.", "Lädt sie im Hintergrund. Experimentell, braucht mehr Daten.")} sub />
            <RowSwitch kind="torrentstream" field="includeInLibrary" label={t("Streaming titles in your anime lists", "Streaming-Titel in deinen Anime-Listen")}
                note={t("Shows the titles you are streaming in your anime lists.", "Zeigt gestreamte Titel in deinen Anime-Listen.")} sub />
        </>}
    </SettingsGroup>
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
    const unlimited = t("Unlimited", "Unbegrenzt")

    return <SettingsGroup title={t("Downloads", "Downloads")}
        note={t("Downloaded torrents are saved to your local library folder.", "Geladene Torrents werden in deinem lokalen Bibliotheksordner gespeichert.")}>
        {noFolder && <Notice text={t("No library folder is set yet. Choose one before you download.",
            "Es ist noch kein Bibliotheksordner gesetzt. Wähle einen, bevor du etwas lädst.")}>
            <TextAction label={t("Open Local library", "Lokale Bibliothek öffnen")} onPress={() => onOpen("library")} />
        </Notice>}
        <SelectRow label={t("Download limit", "Download-Limit")} value={String(download)}
            options={limitOptions([0, 512, 1024, 2048, 5120, 10240, 20480], download, unlimited)}
            onChange={next => void save("torrent.seanimeDownloadLimit", Number(next))} />
        <SelectRow label={t("Upload limit", "Upload-Limit")} value={String(upload)}
            note={t("Sharing back is part of how torrents work; a low limit saves data.", "Teilen gehört zu Torrents dazu; ein niedriges Limit spart Daten.")}
            options={limitOptions([0, 64, 128, 256, 512, 1024, 2048], upload, unlimited)}
            onChange={next => void save("torrent.seanimeUploadLimit", Number(next))} />
        <SelectRow label={t("Downloads at the same time", "Gleichzeitige Downloads")} value={String(active)}
            options={Array.from(new Set([1, 2, 3, 4, 5, active])).sort((a, b) => a - b).map(n => ({ value: String(n), label: String(n) }))}
            onChange={next => void save("torrent.seanimeMaxActiveDownloads", Number(next))} />
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
 * Debrid: provider, API key, streaming. Saving never fails for a wrong key: the server stores the row and only logs that the
 * provider could not sign in (InitializeProvider; TorBox and Real-Debrid do not even check the key there). So the key is
 * checked afterwards by asking the provider for its torrent list (GET /debrid/torrents), whose error shows in the group.
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
    const failed = check.result.state === "failed" ? check.result.detail : null

    return <SettingsGroup title={t("Debrid", "Debrid")}
        note={t("A paid service that downloads torrents for you and streams them from its servers.",
            "Ein kostenpflichtiger Dienst, der Torrents für dich lädt und von seinen Servern streamt.")}>
        <RowSwitch kind="debrid" field="enabled" label={t("Debrid service", "Debrid-Dienst")}
            note={t("Stream and download through your debrid account.", "Über dein Debrid-Konto streamen und laden.")} />
        {enabled && <>
            <SelectRow label={t("Provider", "Anbieter")} value={provider || "-"} sub
                options={[{ value: "-", label: t("None", "Keiner") }, ...DEBRID_PROVIDERS]}
                onChange={next => void save({ provider: next === "-" ? "" : next })} />
            {!!provider && <ApiKeyField t={t} providerName={providerName} hasKey={!!stored?.apiKey} check={check.result}
                onSave={async key => !!await save({ apiKey: key })} />}
            {failed !== null && <Notice text={planRestricted(failed)
                ? t(`${providerName} knows the key, but your plan does not include API access, which the app needs.`,
                    `${providerName} kennt den Schlüssel, aber dein Tarif enthält keinen API-Zugang, den die App braucht.`)
                : t(`${providerName} did not accept the API key, or could not be reached.`, `${providerName} hat den API-Schlüssel nicht angenommen oder war nicht erreichbar.`)}>
                {/* The raw answer only when it says something beyond the plan (settings audit daa7b8c: no cut-off raw JSON) */}
                {!!failed && !planRestricted(failed) && <Muted className="w-full px-2 text-[13px] leading-[19px]">{failed}</Muted>}
                <TextAction label={t("Check again", "Erneut prüfen")} onPress={check.run} />
            </Notice>}
            <RowSwitch kind="debrid" field="streamAutoSelect" label={t("Auto-select the best torrent", "Besten Torrent automatisch wählen")}
                note={t("Picks a cached torrent for you instead of showing the list.", "Wählt einen zwischengespeicherten Torrent für dich, statt die Liste zu zeigen.")} sub />
            {autoSelect && <SelectRow label={t("Preferred resolution", "Bevorzugte Auflösung")} value={resolution || "-"} options={resolutionOptions(t)} sub
                onChange={next => void save({ streamPreferredResolution: next === "-" ? "" : next })} />}
            <RowSwitch kind="debrid" field="includeDebridStreamInLibrary" label={t("Streaming titles in your anime lists", "Streaming-Titel in deinen Anime-Listen")}
                note={t("Shows the titles you are streaming in your anime lists.", "Zeigt gestreamte Titel in deinen Anime-Listen.")} sub />
        </>}
    </SettingsGroup>
}

/** A short fingerprint of the key for the query key, so the key itself never sits in the query cache */
function fingerprint(key: string) {
    let hash = 5381
    for (let i = 0; i < key.length; i++) hash = ((hash << 5) + hash + key.charCodeAt(i)) | 0
    return hash
}

/**
 * Checks the stored key when the area opens and whenever the server's enabled flag, provider or key changes (a query keyed
 * by them); "Check again" asks once more. No error toast: the result shows in the group.
 */
function useKeyCheck(stored: Models_DebridSettings | undefined) {
    const ready = !!stored?.enabled && !!stored.provider && !!stored.apiKey
    const key = stored?.apiKey ?? ""
    const { isFetching, isError, isSuccess, error, refetch } = useServerQuery<unknown>({
        endpoint: API_ENDPOINTS.DEBRID.DebridGetTorrents.endpoint,
        method: API_ENDPOINTS.DEBRID.DebridGetTorrents.methods[0],
        queryKey: [API_ENDPOINTS.DEBRID.DebridGetTorrents.key, "settings-key-check", stored?.provider, fingerprint(key)],
        enabled: ready,
        retry: false,
        gcTime: 0,
        refetchOnWindowFocus: false,
        muteError: true,
    })
    const result: KeyCheck = !ready ? { state: "idle" }
        : isFetching ? { state: "checking" }
            : isError ? { state: "failed", detail: keyCheckDetail(error, key) }
                : isSuccess ? { state: "ok" } : { state: "idle" }
    return { result, run: () => void refetch() }
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
    const note = check.state === "checking" ? t("Checking the key…", "Schlüssel wird geprüft …")
        : check.state === "ok" ? t(`Connected to ${providerName}.`, `Mit ${providerName} verbunden.`)
            : hasKey ? t("A key is saved. Enter a new one to replace it.", "Ein Schlüssel ist gespeichert. Gib einen neuen ein, um ihn zu ersetzen.")
                : t(`Find it in your ${providerName} account settings.`, `Du findest ihn in den Kontoeinstellungen von ${providerName}.`)
    const submit = async () => {
        const key = draft.trim()
        if (!key || saving) return
        setSaving(true)
        const ok = await onSave(key)
        setSaving(false)
        if (ok) setDraft("")
    }
    return (
        <View className="gap-2 bg-sm-surface-raised py-3 pl-8 pr-4">
            <Text className="text-[15px]">{t("API key", "API-Schlüssel")}</Text>
            <TextInput value={draft} onChangeText={setDraft} secureTextEntry autoComplete="off" autoCapitalize="none" autoCorrect={false}
                accessibilityLabel={t("API key", "API-Schlüssel")} returnKeyType="done" onSubmitEditing={() => void submit()}
                placeholder={hasKey ? t("Saved key", "Gespeicherter Schlüssel") : t("Paste your API key", "API-Schlüssel einfügen")}
                placeholderTextColor={colors.smTextSubtle}
                className={cn("min-h-[52px] rounded-surface bg-sm-surface-control px-4 font-sans text-base text-sm-text", check.state === "failed" && "border-2 border-sm-danger")} />
            <Text accessibilityLiveRegion="polite" className="text-[13px] leading-[19px] text-sm-text-muted">{note}</Text>
            <View className="flex-row">
                <Button disabled={!draft.trim() || saving} loading={saving} onPress={() => void submit()}>
                    {saving ? t("Saving…", "Wird gespeichert …") : t("Save key", "Schlüssel speichern")}
                </Button>
            </View>
        </View>
    )
}
