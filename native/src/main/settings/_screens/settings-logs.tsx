import { useServerMutation, useServerQuery } from "@/api/client/requests"
import type { DeleteLogs_Variables, RemoveFileCacheBucket_Variables } from "@/api/generated/endpoint.types"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import type { MemoryStatsResponse } from "@/api/generated/types"
import { Facts } from "@/components/shared/phone-kit"
import { Button } from "@/components/ui/button/button"
import { Sheet } from "@/components/ui/sheet/sheet"
import { Tabs } from "@/components/ui/tabs/tabs"
import { Muted, Text } from "@/components/ui/text/text"
import { toast } from "@/components/ui/toast/toast-store"
import { type Translate } from "@/lib/app-language"
import { copyToClipboard } from "@/lib/helpers/browser"
import { colors } from "@/lib/theme/tokens"
import { fileTimestamp, useSaveServerFile } from "@/main/_hooks/use-save-server-file"
import { ConfirmSheet, LinkRow, SelectRow, SettingsGroup } from "@/main/settings/_components/settings-kit"
import { filterLogFiles, formatBytes } from "@/main/settings/_lib/settings-phone"
import { useQueryClient } from "@tanstack/react-query"
import ChevronDown from "lucide-react-native/icons/chevron-down"
import React from "react"
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native"

/*
 * Logs & cache (settings-phone-logs.tsx): the current log, log files, the cache and (folded away) developer tools.
 * Saving a log or a profile goes through E4's file module (useSaveServerFile → Android's share sheet, Karte §9).
 * "Record an issue" comes with the issue recorder.
 */
export function SettingsLogsSection({ t }: { t: Translate }) {
    return <>
        <CurrentLogGroup t={t} />
        <LogFilesGroup t={t} />
        <CacheGroup t={t} />
        <DeveloperGroup t={t} />
    </>
}

function CurrentLogGroup({ t }: { t: Translate }) {
    const { mutate: fetchLatest, isPending: copying } = useServerMutation<string>({
        endpoint: API_ENDPOINTS.STATUS.GetLatestLogContent.endpoint,
        method: API_ENDPOINTS.STATUS.GetLatestLogContent.methods[0],
        mutationKey: [API_ENDPOINTS.STATUS.GetLatestLogContent.key, "settings-phone"],
        onSuccess: async data => {
            if (!data) return void toast.error(t("The log could not be loaded.", "Der Log konnte nicht geladen werden."))
            await copyToClipboard(data)
            toast.success(t("Log copied", "Log kopiert"))
        },
        onError: () => {
            toast.error(t("The log could not be loaded.", "Der Log konnte nicht geladen werden."))
        },
    })
    const saveServerFile = useSaveServerFile()
    const [saving, setSaving] = React.useState(false)
    return <SettingsGroup title={t("Server log", "Server-Log")} note={t("Helpful when you report a problem.", "Hilfreich, wenn du ein Problem meldest.")}>
        <LinkRow label={copying ? t("Copying…", "Wird kopiert …") : t("Copy the current log", "Aktuellen Log kopieren")} disabled={copying}
            onPress={() => fetchLatest()} />
        <LinkRow label={saving ? t("Saving…", "Wird gespeichert …") : t("Save the current log", "Aktuellen Log speichern")} disabled={saving}
            note={t("As a file, through Android's share sheet.", "Als Datei, über das Teilen-Menü von Android.")}
            onPress={async () => {
                setSaving(true)
                try {
                    await saveServerFile(API_ENDPOINTS.STATUS.GetLatestLogContent.endpoint, `seanime-${fileTimestamp()}.log`, { text: true })
                }
                catch {
                    toast.error(t("The log could not be loaded.", "Der Log konnte nicht geladen werden."))
                }
                finally {
                    setSaving(false)
                }
            }} />
    </SettingsGroup>
}

type LogFilter = "all" | "server" | "scanner"

function LogFilesGroup({ t }: { t: Translate }) {
    const [filter, setFilter] = React.useState<LogFilter>("all")
    const [open, setOpen] = React.useState<string | null>(null)
    const { data: filenames, isLoading } = useServerQuery<string[]>({
        endpoint: API_ENDPOINTS.STATUS.GetLogFilenames.endpoint,
        method: API_ENDPOINTS.STATUS.GetLogFilenames.methods[0],
        queryKey: [API_ENDPOINTS.STATUS.GetLogFilenames.key],
    })
    const shown = filterLogFiles(filenames ?? [], filter)
    return <SettingsGroup title={t("Log files", "Log-Dateien")}>
        <View className="bg-sm-surface-raised p-2">
            <Tabs variant="segment" value={filter} onValueChange={value => setFilter(value as LogFilter)}
                items={[{ value: "all", label: t("All", "Alle") }, { value: "server", label: t("Server", "Server") }, { value: "scanner", label: t("Scanner", "Scanner") }]} />
        </View>
        {!isLoading && !shown.length && <View className="bg-sm-surface-raised px-4 py-5">
            <Text className="text-center text-[15px] text-sm-text-muted">{t("No log files", "Keine Log-Dateien")}</Text>
        </View>}
        {shown.map(name => <LinkRow key={name} label={name} onPress={() => setOpen(name)} />)}
        <LogSheet t={t} filename={open} onClose={() => setOpen(null)} />
    </SettingsGroup>
}

/** One log file: read, copy, save or delete (after asking). */
function LogSheet({ t, filename, onClose }: { t: Translate, filename: string | null, onClose: () => void }) {
    const queryClient = useQueryClient()
    const saveServerFile = useSaveServerFile()
    const { height } = useWindowDimensions()
    const [confirm, setConfirm] = React.useState(false)
    // The name stays while the sheet closes (its exit animation still shows it)
    const [name, setName] = React.useState(filename)
    if (filename && filename !== name) setName(filename)
    const { data, isLoading } = useServerQuery<string>({
        endpoint: `/api/v1/log/${name}`,
        method: "GET",
        queryKey: ["STATUS-get-log-content", name],
        enabled: !!filename,
    })
    const { mutate: deleteLogs } = useServerMutation<boolean, DeleteLogs_Variables>({
        endpoint: API_ENDPOINTS.STATUS.DeleteLogs.endpoint,
        method: API_ENDPOINTS.STATUS.DeleteLogs.methods[0],
        mutationKey: [API_ENDPOINTS.STATUS.DeleteLogs.key],
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.STATUS.GetLogFilenames.key] })
            toast.success(t("Log deleted", "Log gelöscht"))
        },
        onError: () => {
            toast.error(t("The log could not be deleted.", "Der Log konnte nicht gelöscht werden."))
        },
    })
    return <>
        <Sheet title={name ?? ""} open={!!filename && !confirm} onOpenChange={next => {
            if (!next) onClose()
        }}
            footer={<>
                <Button intent="secondary" wrapperClassName="flex-1" onPress={() => setConfirm(true)}>{t("Delete", "Löschen")}</Button>
                <Button intent="secondary" wrapperClassName="flex-1" onPress={() => {
                    saveServerFile(`/api/v1/log/${name}`, name ?? "seanime.log", { text: true })
                        .catch(() => toast.error(t("The log could not be loaded.", "Der Log konnte nicht geladen werden.")))
                }}>{t("Save", "Speichern")}</Button>
                <Button wrapperClassName="flex-1" disabled={!data} onPress={async () => {
                    if (!data) return
                    await copyToClipboard(data)
                    toast.success(t("Log copied", "Log kopiert"))
                }}>{t("Copy", "Kopieren")}</Button>
            </>}>
            <ScrollView nestedScrollEnabled style={{ maxHeight: height * 0.55 }} className="rounded-surface-sm bg-sm-surface-sunken"
                contentContainerClassName="p-3">
                <Text selectable accessibilityState={{ busy: isLoading }} style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 18 }}>
                    {isLoading ? t("Loading…", "Wird geladen …") : data || t("Empty", "Leer")}
                </Text>
            </ScrollView>
        </Sheet>
        <ConfirmSheet open={confirm} onOpenChange={next => {
            setConfirm(next)
            if (!next && !filename) onClose()
        }} title={t("Delete this log?", "Diesen Log löschen?")} text={name ?? ""} action={t("Delete", "Löschen")} danger
            onConfirm={() => {
                deleteLogs({ filenames: [name ?? ""] })
                onClose()
            }} />
    </>
}

function CacheGroup({ t }: { t: Translate }) {
    const [clear, setClear] = React.useState<"manga" | "onlinestream" | null>(null)
    const { mutate: getSize, data: size, isPending: measuring } = useServerMutation<string>({
        endpoint: API_ENDPOINTS.FILECACHE.GetFileCacheTotalSize.endpoint,
        method: API_ENDPOINTS.FILECACHE.GetFileCacheTotalSize.methods[0],
        mutationKey: [API_ENDPOINTS.FILECACHE.GetFileCacheTotalSize.key],
        onError: () => {},
    })
    React.useEffect(() => {
        getSize()
    }, [getSize])
    const { mutate: clearBucket, isPending: clearing } = useServerMutation<boolean, RemoveFileCacheBucket_Variables>({
        endpoint: API_ENDPOINTS.FILECACHE.RemoveFileCacheBucket.endpoint,
        method: API_ENDPOINTS.FILECACHE.RemoveFileCacheBucket.methods[0],
        mutationKey: [API_ENDPOINTS.FILECACHE.RemoveFileCacheBucket.key],
        onSuccess: async () => {
            toast.success(t("Cache cleared", "Cache geleert"))
            getSize()
        },
        onError: () => {
            toast.error(t("The cache could not be cleared.", "Der Cache konnte nicht geleert werden."))
        },
    })
    return <SettingsGroup title={t("Cache", "Cache")}
        note={t("Saved source data. Cleared data loads again from the sources.", "Gespeicherte Daten der Quellen. Geleerte Daten lädt die App neu von den Quellen.")}>
        <LinkRow label={t("Size", "Größe")} value={measuring ? "…" : (size || "–")} onPress={() => getSize()} />
        <LinkRow label={t("Clear the manga cache", "Manga-Cache leeren")} disabled={clearing} onPress={() => setClear("manga")} />
        <LinkRow label={t("Clear the online streaming cache", "Online-Streaming-Cache leeren")} disabled={clearing} onPress={() => setClear("onlinestream")} />
        <ConfirmSheet open={clear !== null} onOpenChange={open => {
            if (!open) setClear(null)
        }}
            title={clear === "manga" ? t("Clear the manga cache?", "Manga-Cache leeren?") : t("Clear the online streaming cache?", "Online-Streaming-Cache leeren?")}
            text={clear === "manga" ? t("Chapter lists and pages load again from the sources.", "Kapitellisten und Seiten lädt die App neu von den Quellen.")
                : t("Episode lists and stream links load again from the sources.", "Folgenlisten und Stream-Links lädt die App neu von den Quellen.")}
            action={t("Clear", "Leeren")} danger onConfirm={() => {
                if (clear) clearBucket({ bucket: clear })
            }} />
    </SettingsGroup>
}

/** Memory statistics and garbage collection, for bug reports; folded away until asked for. */
function DeveloperGroup({ t }: { t: Translate }) {
    const [open, setOpen] = React.useState(false)
    return <SettingsGroup>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(value => !value)}
            className="min-h-[52px] w-full flex-row items-center gap-3 bg-sm-surface-raised px-4 py-2.5 active:bg-sm-surface-control">
            <View className="min-w-0 flex-1 gap-0.5">
                <Text className="text-[15px]">{t("Developer", "Entwickler")}</Text>
                <Muted className="text-[13px] leading-[19px]">{t("Memory and performance profiles for bug reports", "Speicher- und Leistungsprofile für Fehlerberichte")}</Muted>
            </View>
            <View style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}>
                <ChevronDown size={18} color={colors.smTextSubtle} />
            </View>
        </Pressable>
        {open && <DeveloperTools t={t} />}
    </SettingsGroup>
}

function DeveloperTools({ t }: { t: Translate }) {
    const saveServerFile = useSaveServerFile()
    const [cpuSeconds, setCpuSeconds] = React.useState("30")
    const [busy, setBusy] = React.useState<string | null>(null)
    const { data: stats, refetch, isFetching } = useServerQuery<MemoryStatsResponse>({
        endpoint: API_ENDPOINTS.STATUS.GetMemoryStats.endpoint,
        method: API_ENDPOINTS.STATUS.GetMemoryStats.methods[0],
        queryKey: [API_ENDPOINTS.STATUS.GetMemoryStats.key],
        refetchInterval: false,
    })
    const { mutate: forceGC, isPending: collecting } = useServerMutation<MemoryStatsResponse>({
        endpoint: API_ENDPOINTS.STATUS.ForceGC.endpoint,
        method: API_ENDPOINTS.STATUS.ForceGC.methods[0],
        mutationKey: [API_ENDPOINTS.STATUS.ForceGC.key],
        onSuccess: async () => {
            toast.success(t("Memory freed", "Speicher freigegeben"))
            void refetch()
        },
        onError: () => {
            toast.error(t("That did not work.", "Das hat nicht geklappt."))
        },
    })
    const download = async (kind: string, endpoint: string) => {
        setBusy(kind)
        toast.info(t("Creating the profile…", "Profil wird erstellt …"))
        try {
            await saveServerFile(endpoint, `seanime-${kind}-profile-${fileTimestamp()}.pprof`, { mime: "application/octet-stream" })
        }
        catch {
            toast.error(t("The profile could not be created.", "Das Profil konnte nicht erstellt werden."))
        }
        finally {
            setBusy(null)
        }
    }
    return <>
        {!!stats && <Facts items={[
            { label: t("Heap in use", "Heap belegt"), value: formatBytes(stats.heapInuse) },
            { label: t("Heap from the system", "Heap vom System"), value: formatBytes(stats.heapSys) },
            { label: t("Allocated in total", "Insgesamt belegt"), value: formatBytes(stats.totalAlloc) },
            { label: "Goroutines", value: stats.numGoroutine },
            { label: t("GC cycles", "GC-Durchläufe"), value: stats.numGC },
        ]} />}
        <LinkRow label={isFetching ? t("Loading…", "Wird geladen …") : t("Refresh memory statistics", "Speicherstatistik aktualisieren")} disabled={isFetching}
            onPress={() => void refetch()} />
        <LinkRow label={t("Free memory now (GC)", "Speicher jetzt freigeben (GC)")} disabled={collecting} onPress={() => forceGC()} />
        <LinkRow label={t("Save heap profile", "Heap-Profil speichern")} disabled={!!busy}
            onPress={() => download("heap", `${API_ENDPOINTS.STATUS.GetMemoryProfile.endpoint}?heap=true`)} />
        <LinkRow label={t("Save allocations profile", "Allokationsprofil speichern")} disabled={!!busy}
            onPress={() => download("allocs", `${API_ENDPOINTS.STATUS.GetMemoryProfile.endpoint}?allocs=true`)} />
        <LinkRow label={t("Save goroutine profile", "Goroutine-Profil speichern")} disabled={!!busy}
            onPress={() => download("goroutine", API_ENDPOINTS.STATUS.GetGoRoutineProfile.endpoint)} />
        <SelectRow label={t("CPU profile length", "Dauer des CPU-Profils")} value={cpuSeconds} onChange={setCpuSeconds}
            options={["10", "30", "60", "120", "300"].map(value => ({ value, label: t(`${value} seconds`, `${value} Sekunden`) }))} />
        <LinkRow label={busy === "cpu" ? t(`Recording ${cpuSeconds} s…`, `Zeichnet ${cpuSeconds} s auf …`) : t("Save CPU profile", "CPU-Profil speichern")}
            disabled={!!busy} onPress={() => download("cpu", `${API_ENDPOINTS.STATUS.GetCPUProfile.endpoint}?duration=${cpuSeconds}`)} />
    </>
}
