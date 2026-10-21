import { useServerMutation, useServerQuery } from "@/api/client/requests"
import { DeleteLogs_Variables, RemoveFileCacheBucket_Variables } from "@/api/generated/endpoint.types"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { MemoryStatsResponse } from "@/api/generated/types"
import { __issueReport_overlayOpenAtom } from "@/app/(main)/_features/issue-report/issue-report"
import { PhoneEmpty, PhoneTabs } from "@/app/(main)/_features/phone-screen/phone-screen"
import { fileTimestamp, useSaveServerFile } from "@/app/(main)/_hooks/use-save-server-file"
import { useServerDisabledFeatures } from "@/app/(main)/_hooks/use-server-status"
import { ConfirmSheet, LinkRow, SelectRow, SettingsGroup, SettingsSheet } from "@/app/(main)/settings/_screens/settings-phone-kit"
import { Translate } from "@/lib/app-language"
import { copyToClipboard } from "@/lib/helpers/browser"
import { useRouter } from "@/lib/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { useSetAtom } from "jotai"
import React from "react"
import { LuChevronDown } from "react-icons/lu"
import { toast } from "sonner"

/** Logs & cache: the current log, log files, the issue recorder, the cache and (folded away) developer tools. */
export function SettingsLogsSection({ t }: { t: Translate }) {
    return <>
        <CurrentLogGroup t={t} />
        <LogFilesGroup t={t} />
        <CacheGroup t={t} />
        <DeveloperGroup t={t} />
    </>
}

function CurrentLogGroup({ t }: { t: Translate }) {
    const router = useRouter()
    const saveServerFile = useSaveServerFile()
    const setIssueRecorderOpen = useSetAtom(__issueReport_overlayOpenAtom)
    const { isFeatureDisabled, showFeatureWarning } = useServerDisabledFeatures()
    const { mutate: fetchLatest, isPending: copying } = useServerMutation<string>({
        endpoint: API_ENDPOINTS.STATUS.GetLatestLogContent.endpoint,
        method: API_ENDPOINTS.STATUS.GetLatestLogContent.methods[0],
        mutationKey: [API_ENDPOINTS.STATUS.GetLatestLogContent.key, "settings-phone"],
        onSuccess: async data => {
            if (!data) return void toast.error(t("The log could not be loaded.", "Der Log konnte nicht geladen werden."))
            await copyToClipboard(data)
            toast.success(t("Log copied", "Log kopiert"))
        },
        onError: () => { toast.error(t("The log could not be loaded.", "Der Log konnte nicht geladen werden.")) },
    })
    const [saving, setSaving] = React.useState(false)
    return <SettingsGroup id="logs-current" title={t("Server log", "Server-Log")}
        note={t("Helpful when you report a problem.", "Hilfreich, wenn du ein Problem meldest.")}>
        <LinkRow label={copying ? t("Copying…", "Wird kopiert …") : t("Copy the current log", "Aktuellen Log kopieren")} disabled={copying}
            onClick={() => fetchLatest()} data-settings-copy-log />
        <LinkRow label={saving ? t("Saving…", "Wird gespeichert …") : t("Save the current log", "Aktuellen Log speichern")} disabled={saving} data-settings-save-log
            note={t("As a file, through Android's Save dialog.", "Als Datei, über den Speichern-Dialog von Android.")}
            onClick={async () => {
                setSaving(true)
                try {
                    await saveServerFile("/api/v1/logs/latest", `seanime-${fileTimestamp()}.log`, { text: true })
                }
                catch {
                    toast.error(t("The log could not be loaded.", "Der Log konnte nicht geladen werden."))
                }
                finally {
                    setSaving(false)
                }
            }} />
        <LinkRow label={t("Record an issue", "Fehler aufzeichnen")} data-settings-record-issue
            note={t("Records what you do and the logs, to attach to a report.", "Zeichnet deine Schritte und die Logs für einen Bericht auf.")}
            onClick={() => {
                if (isFeatureDisabled("UpdateSettings")) return showFeatureWarning()
                setIssueRecorderOpen(true)
                router.push("/")
            }} />
    </SettingsGroup>
}

function LogFilesGroup({ t }: { t: Translate }) {
    const [filter, setFilter] = React.useState("all")
    const [open, setOpen] = React.useState<string | null>(null)
    const { data: filenames, isLoading } = useServerQuery<string[]>({
        endpoint: API_ENDPOINTS.STATUS.GetLogFilenames.endpoint,
        method: API_ENDPOINTS.STATUS.GetLogFilenames.methods[0],
        queryKey: [API_ENDPOINTS.STATUS.GetLogFilenames.key],
    })
    const shown = (filenames ?? []).filter(name => filter === "all" || (filter === "server" ? name.startsWith("seanime-") : name.includes("-scan")))
    return <SettingsGroup id="logs-files" title={t("Log files", "Log-Dateien")}>
        <PhoneTabs label={t("Which logs", "Welche Logs")} variant="segment" value={filter} onChange={setFilter} data-settings-log-filter
            tabs={[{ value: "all", label: t("All", "Alle") }, { value: "server", label: t("Server", "Server") }, { value: "scanner", label: t("Scanner", "Scanner") }]} />
        {!isLoading && !shown.length && <PhoneEmpty title={t("No log files", "Keine Log-Dateien")} />}
        {shown.map(name => <LinkRow key={name} label={name} onClick={() => setOpen(name)} data-settings-log-file={name} />)}
        <LogSheet t={t} filename={open} onClose={() => setOpen(null)} />
    </SettingsGroup>
}

/** One log file: read, copy, save or delete (after asking). */
function LogSheet({ t, filename, onClose }: { t: Translate, filename: string | null, onClose: () => void }) {
    const queryClient = useQueryClient()
    const saveServerFile = useSaveServerFile()
    const [confirm, setConfirm] = React.useState(false)
    const name = React.useRef(filename)
    if (filename) name.current = filename
    const { data, isLoading } = useServerQuery<string>({
        endpoint: `/api/v1/log/${name.current}`,
        method: "GET",
        queryKey: ["STATUS-get-log-content", name.current],
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
        onError: () => { toast.error(t("The log could not be deleted.", "Der Log konnte nicht gelöscht werden.")) },
    })
    return <>
        <SettingsSheet title={name.current ?? ""} open={!!filename && !confirm} onOpenChange={next => { if (!next) onClose() }} className="pst-log-sheet"
            data-settings-log-sheet footer={<>
                <button type="button" className="ps-secondary" onClick={() => setConfirm(true)} data-log-delete>{t("Delete", "Löschen")}</button>
                <button type="button" className="ps-secondary" data-log-save onClick={() => {
                    saveServerFile(`/api/v1/log/${name.current}`, name.current ?? "seanime.log", { text: true })
                        .catch(() => toast.error(t("The log could not be loaded.", "Der Log konnte nicht geladen werden.")))
                }}>{t("Save", "Speichern")}</button>
                <button type="button" className="ps-primary" disabled={!data} data-log-copy onClick={async () => {
                    if (!data) return
                    await copyToClipboard(data)
                    toast.success(t("Log copied", "Log kopiert"))
                }}>{t("Copy", "Kopieren")}</button>
            </>}>
            <pre className="pst-log" aria-busy={isLoading} data-settings-log-content>{isLoading ? t("Loading…", "Wird geladen …") : data || t("Empty", "Leer")}</pre>
        </SettingsSheet>
        <ConfirmSheet t={t} open={confirm} onOpenChange={next => { setConfirm(next); if (!next && !filename) onClose() }}
            title={t("Delete this log?", "Diesen Log löschen?")} text={name.current} action={t("Delete", "Löschen")} danger data-settings-log-confirm
            onConfirm={() => {
                deleteLogs({ filenames: [name.current ?? ""] })
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
    React.useEffect(() => { getSize() }, [])
    const { mutate: clearBucket, isPending: clearing } = useServerMutation<boolean, RemoveFileCacheBucket_Variables>({
        endpoint: API_ENDPOINTS.FILECACHE.RemoveFileCacheBucket.endpoint,
        method: API_ENDPOINTS.FILECACHE.RemoveFileCacheBucket.methods[0],
        mutationKey: [API_ENDPOINTS.FILECACHE.RemoveFileCacheBucket.key],
        onSuccess: async () => {
            toast.success(t("Cache cleared", "Cache geleert"))
            getSize()
        },
        onError: () => { toast.error(t("The cache could not be cleared.", "Der Cache konnte nicht geleert werden.")) },
    })
    return <SettingsGroup id="logs-cache" title={t("Cache", "Cache")}
        note={t("Saved source data. Cleared data loads again from the sources.", "Gespeicherte Daten der Quellen. Geleerte Daten lädt die App neu von den Quellen.")}>
        <LinkRow label={t("Size", "Größe")} value={measuring ? "…" : (size || "–")} onClick={() => getSize()} data-settings-cache-size />
        <LinkRow label={t("Clear the manga cache", "Manga-Cache leeren")} disabled={clearing} onClick={() => setClear("manga")} data-settings-clear="manga" />
        <LinkRow label={t("Clear the online streaming cache", "Online-Streaming-Cache leeren")} disabled={clearing} onClick={() => setClear("onlinestream")}
            data-settings-clear="onlinestream" />
        <ConfirmSheet t={t} open={clear !== null} onOpenChange={open => { if (!open) setClear(null) }} data-settings-clear-confirm
            title={clear === "manga" ? t("Clear the manga cache?", "Manga-Cache leeren?") : t("Clear the online streaming cache?", "Online-Streaming-Cache leeren?")}
            text={clear === "manga" ? t("Chapter lists and pages load again from the sources.", "Kapitellisten und Seiten lädt die App neu von den Quellen.")
                : t("Episode lists and stream links load again from the sources.", "Folgenlisten und Stream-Links lädt die App neu von den Quellen.")}
            action={t("Clear", "Leeren")} danger onConfirm={() => { if (clear) clearBucket({ bucket: clear }) }} />
    </SettingsGroup>
}

/** Profiling and garbage collection, for bug reports; folded away until asked for. */
function DeveloperGroup({ t }: { t: Translate }) {
    const [open, setOpen] = React.useState(false)
    return <section className="pst-group" aria-labelledby="pst-developer" data-settings-group="developer">
        <h2 id="pst-developer" className="pst-visually-hidden">{t("Developer", "Entwickler")}</h2>
        <div className="ps-rows">
            <button type="button" className="pst-row" aria-expanded={open} aria-controls="pst-developer-tools" onClick={() => setOpen(value => !value)}
                data-settings-developer>
                <span className="pst-row-text">
                    <span>{t("Developer", "Entwickler")}</span>
                    <small>{t("Memory and performance profiles for bug reports", "Speicher- und Leistungsprofile für Fehlerberichte")}</small>
                </span>
                <LuChevronDown aria-hidden className="pst-expand" />
            </button>
            {open && <div id="pst-developer-tools" className="pst-developer"><DeveloperTools t={t} /></div>}
        </div>
    </section>
}

function formatBytes(bytes: number) {
    if (!bytes) return "0 B"
    const units = ["B", "KB", "MB", "GB"]
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
    return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(1))} ${units[i]}`
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
        onError: () => { toast.error(t("That did not work.", "Das hat nicht geklappt.")) },
    })
    const download = async (kind: string, endpoint: string) => {
        setBusy(kind)
        toast.info(t("Creating the profile…", "Profil wird erstellt …"))
        try {
            await saveServerFile(endpoint, `seanime-${kind}-profile-${fileTimestamp()}.pprof`)
        }
        catch {
            toast.error(t("The profile could not be created.", "Das Profil konnte nicht erstellt werden."))
        }
        finally {
            setBusy(null)
        }
    }
    return <>
        {!!stats && <dl className="ps-facts" data-settings-memory>
            <div><dt>{t("Heap in use", "Heap belegt")}</dt><dd>{formatBytes(stats.heapInuse)}</dd></div>
            <div><dt>{t("Heap from the system", "Heap vom System")}</dt><dd>{formatBytes(stats.heapSys)}</dd></div>
            <div><dt>{t("Allocated in total", "Insgesamt belegt")}</dt><dd>{formatBytes(stats.totalAlloc)}</dd></div>
            <div><dt>Goroutines</dt><dd>{stats.numGoroutine}</dd></div>
            <div><dt>{t("GC cycles", "GC-Durchläufe")}</dt><dd>{stats.numGC}</dd></div>
        </dl>}
        <LinkRow label={isFetching ? t("Loading…", "Wird geladen …") : t("Refresh memory statistics", "Speicherstatistik aktualisieren")} disabled={isFetching}
            onClick={() => void refetch()} data-settings-memory-refresh />
        <LinkRow label={t("Free memory now (GC)", "Speicher jetzt freigeben (GC)")} disabled={collecting} onClick={() => forceGC()} data-settings-gc />
        <LinkRow label={t("Save heap profile", "Heap-Profil speichern")} disabled={!!busy} data-settings-profile="heap"
            onClick={() => download("heap", `${API_ENDPOINTS.STATUS.GetMemoryProfile.endpoint}?heap=true`)} />
        <LinkRow label={t("Save allocations profile", "Allokationsprofil speichern")} disabled={!!busy} data-settings-profile="allocs"
            onClick={() => download("allocs", `${API_ENDPOINTS.STATUS.GetMemoryProfile.endpoint}?allocs=true`)} />
        <LinkRow label={t("Save goroutine profile", "Goroutine-Profil speichern")} disabled={!!busy} data-settings-profile="goroutine"
            onClick={() => download("goroutine", API_ENDPOINTS.STATUS.GetGoRoutineProfile.endpoint)} />
        <SelectRow id="pst-cpu-seconds" label={t("CPU profile length", "Dauer des CPU-Profils")} value={cpuSeconds} onChange={setCpuSeconds}
            options={["10", "30", "60", "120", "300"].map(value => ({ value, label: t(`${value} seconds`, `${value} Sekunden`) }))} />
        <LinkRow label={busy === "cpu" ? t(`Recording ${cpuSeconds} s…`, `Zeichnet ${cpuSeconds} s auf …`) : t("Save CPU profile", "CPU-Profil speichern")}
            disabled={!!busy} data-settings-profile="cpu"
            onClick={() => download("cpu", `${API_ENDPOINTS.STATUS.GetCPUProfile.endpoint}?duration=${cpuSeconds}`)} />
    </>
}
