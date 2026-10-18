import React from "react"
import { createPortal } from "react-dom"
import { useAtom } from "jotai/react"
import { useGetLatestUpdate } from "@/api/hooks/releases.hooks"
import { useServerStatus } from "@/app/(main)/_hooks/use-server-status"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { MobileIcon } from "@/lib/mobile-icons"
import { AppDownloadState, downloadAppUpdate, readAppDownload } from "@/lib/app-updates"
import { useTr } from "@/lib/app-language"
import { updateModalOpenAtom } from "./update-modal"
import { toast } from "sonner"
import { UpdateChangelogBody } from "./update-helper"

/** Both surfaces are rendered by this owner; native DownloadManager remains the durable authority. */
export function MobileUpdateModal() {
    const t = useTr()
    const server = useServerStatus()
    const { data, isLoading, error, refetch } = useGetLatestUpdate(!!server && !server.settings?.library?.disableUpdateCheck)
    const [open, setOpen] = useAtom(updateModalOpenAtom)
    const [nativeDownload, setDownload] = React.useState<AppDownloadState>({ status: "idle" })
    const download: AppDownloadState = nativeDownload.status === "complete" && data?.release?.version && nativeDownload.version !== data.release.version
        ? {status: "idle"} : nativeDownload
    const [starting, setStarting] = React.useState(false)
    const [host, setHost] = React.useState<HTMLElement | null>(null)
    const lock = React.useRef(false)
    const confirmed = React.useRef<string | undefined>(undefined)
    React.useEffect(() => {
        const find = () => setHost(document.getElementById("__seanime_update_menu_host"))
        const poll = () => setDownload(previous => { const next = readAppDownload();
            if (next.status === "installed" && confirmed.current !== next.version) {
                confirmed.current = next.version
                toast.success(t("Update successfully installed – Version ", "Update erfolgreich installiert – Version ") + next.version, { duration: 10000 })
                window.AppUpdater?.acknowledgeInstalledUpdate?.()
                void refetch()
            }
            return next.status === "idle" && previous.status === "error" ? previous : next })
        find(); poll()
        const timer = window.setInterval(poll, 1000)
        document.addEventListener("visibilitychange", poll)
        window.addEventListener("seanime-update-menu", find)
        return () => { clearInterval(timer); document.removeEventListener("visibilitychange", poll); window.removeEventListener("seanime-update-menu", find) }
    }, [])
    const version = data?.release?.version
    React.useEffect(() => {
        if (version && localStorage.getItem("notified-available-app-update") !== JSON.stringify(version)) setOpen(true)
    }, [version])
    function close() {
        if (version) localStorage.setItem("notified-available-app-update", JSON.stringify(version))
        setOpen(false)
    }
    async function start() {
        if (lock.current || ["downloading", "verifying", "preparing", "installing", "confirmation"].includes(download.status)) return
        lock.current = true; setStarting(true)
        try { setDownload(await downloadAppUpdate()) }
        catch (e) { setDownload({ status: "error", error: String(e) }) }
        finally { lock.current = false; setStarting(false) }
    }
    const busy = starting || ["downloading", "verifying", "preparing", "installing"].includes(download.status)
    const complete = download.status === "installed"
    const percent = download.total && download.total > 0 ? Math.min(100, Math.floor((download.bytes || 0) * 100 / download.total)) : undefined
    const status = download.status === "installed" ? t("Update successfully installed – Version ", "Update erfolgreich installiert – Version ") + download.version
        : download.status === "verifying" ? t("Verifying APK…", "APK wird geprüft…")
        : download.status === "preparing" ? t("Preparing installation…", "Installation wird vorbereitet…")
        : download.status === "installing" ? t("Installation requested…", "Installation angefordert…")
        : download.status === "permission" ? t("Allow installation from this source to continue", "Installation aus dieser Quelle freigeben")
        : download.status === "confirmation" ? t("Android installation confirmation required", "Android-Installationsbestätigung erforderlich")
        : download.status === "complete" ? t("APK verified. Ready to install.", "APK geprüft. Bereit zur Installation.")
        : download.status === "failed" || download.status === "error" ? download.error
        : busy ? `${t("Downloading", "Wird heruntergeladen")} ${percent === undefined ? "…" : `${percent}%`}`
        : error ? t("Update check failed", "Updateprüfung fehlgeschlagen")
        : isLoading ? t("Checking for updates…", "Suche nach Updates…") : version
        ? t("New version available", "Neue Version verfügbar") : data ? t("Up to date", "Aktuell") : t("Update check unavailable", "Updateprüfung nicht verfügbar")
    const installAction = download.status === "complete" || download.status === "permission" || download.status === "confirmation" || (download.status === "failed" && download.verified)
    const summary = <section data-app-update-panel className="rounded-2xl border border-brand-300/20 bg-brand-300/5 p-3 my-2 space-y-2 min-w-0" aria-label={t("App update", "App-Update")}>
        <div className="flex items-start gap-3">
            <MobileIcon name={complete ? "check" : "update"} className="size-6 shrink-0 text-brand-300 mt-1" />
            <div className="min-w-0 flex-1">
                <strong className="block break-words">Seanime Mobile{version ? ` ${version}` : ""}</strong>
                {data?.current_version && <small className="text-[--muted]">{t("Installed", "Installiert")}: {data.current_version}</small>}
                <p role="status" className="text-sm break-words" data-download-status={download.status}>{status}</p>
            </div>
        </div>
        {download.status === "downloading" && <progress className="w-full accent-violet-400" aria-label={t("Download progress", "Downloadfortschritt")} max={100} value={percent} />}
        {download.message && busy && <p className="text-sm text-[--muted]">{download.message}</p>}
        {(version || installAction) && !complete && <p className="text-sm">{t("Installation interrupts playback and running downloads.", "Die Installation unterbricht Wiedergabe und laufende Downloads.")}</p>}
        <div className="flex flex-wrap gap-2 [&_button]:min-h-12">
            {version && !complete && !installAction && <Button intent="white" disabled={busy} onClick={start} leftIcon={<MobileIcon name="download" className="size-5" />}>
                {busy ? t("Downloading…", "Wird heruntergeladen…") : download.status === "error" ? t("Retry download", "Download wiederholen") : t("Download and update", "Herunterladen und aktualisieren")}
            </Button>}
            {installAction && <Button intent="white" disabled={busy} onClick={() => window.AppUpdater?.openDownloadedApk?.()}>{download.status === "confirmation" ? t("Confirm installation", "Installation bestätigen") : t("Install update", "Update installieren")}</Button>}
            {version && <Button intent="gray-subtle" onClick={() => setOpen(true)}>{t("Update details", "Updateinformationen")}</Button>}
            {!version && !isLoading && <Button intent="gray-subtle" onClick={() => refetch()}>{t("Check again", "Erneut prüfen")}</Button>}
        </div>
    </section>
    return <>
        <div data-app-update-sidebar>{summary}</div>
        {host && createPortal(summary, host)}
        <Modal open={open && !!version} onOpenChange={close} contentClass="max-w-3xl">
            <h3>{t("App update", "App-Update")}</h3>
            {summary}
            <UpdateChangelogBody updateData={data} />
        </Modal>
    </>
}
