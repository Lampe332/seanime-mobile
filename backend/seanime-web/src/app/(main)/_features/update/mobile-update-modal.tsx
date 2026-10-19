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
import "./mobile-update.css"

/** Both surfaces are rendered by this owner; native DownloadManager remains the durable authority. */
export function MobileUpdateModal() {
    const t = useTr()
    const server = useServerStatus()
    const { data, isLoading, isFetching, error, refetch } = useGetLatestUpdate(!!server && !server.settings?.library?.disableUpdateCheck)
    const [open, setOpen] = useAtom(updateModalOpenAtom)
    const [nativeDownload, setDownload] = React.useState<AppDownloadState>({ status: "idle" })
    const download: AppDownloadState = nativeDownload.status === "complete" && data?.release?.version && nativeDownload.version !== data.release.version
        ? {status: "idle"} : nativeDownload
    const [starting, setStarting] = React.useState(false)
    const [host, setHost] = React.useState<HTMLElement | null>(null)
    const lock = React.useRef(false)
    const checkLock = React.useRef(false)
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
    async function checkAgain() {
        if (checkLock.current || isFetching) return
        checkLock.current = true
        try { await refetch() }
        finally { checkLock.current = false }
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
        : starting ? t("Starting update…", "Update wird gestartet…")
        : busy ? `${t("Downloading", "Wird heruntergeladen")} ${percent === undefined ? "…" : `${percent}%`}`
        : isFetching ? t("Searching for updates…", "Suche nach Updates…")
        : download.status === "failed" || download.status === "error" ? t("Update interrupted", "Update unterbrochen")
        : error ? t("Could not check for updates. Check your connection and try again.", "Updates konnten nicht geprüft werden. Prüfe deine Verbindung und versuche es erneut.")
        : isLoading ? t("Searching for updates…", "Suche nach Updates…") : version
        ? t("New version available", "Neue Version verfügbar") : data ? t("Up to date", "Auf dem neuesten Stand") : t("Update check unavailable", "Updateprüfung nicht verfügbar")
    const installAction = download.status === "complete" || download.status === "permission" || download.status === "confirmation" || (download.status === "failed" && download.verified)
    const failed = download.status === "failed" || download.status === "error"
    const working = busy || isFetching || isLoading
    const installedVersion = complete ? download.version : data?.current_version
    const formatBytes = (bytes: number) => new Intl.NumberFormat(t("en", "de"), { maximumFractionDigits: 1 }).format(bytes / (1024 * 1024)) + " MB"
    const hint = download.status === "permission" ? t("Allow Seanime Mobile in Android settings, then return here to continue.", "Erlaube Seanime Mobile die Installation in den Android-Einstellungen und kehre anschließend zurück.")
        : download.status === "confirmation" ? t("Continue in the Android installer. Android or Play Protect may ask you to confirm.", "Fahre im Android-Installer fort. Android oder Play Protect können eine Bestätigung verlangen.")
        : download.status === "installing" ? t("Waiting for Android. The update is complete only when the installed version changes.", "Warten auf Android. Erst der bestätigte Versionswechsel schließt das Update ab.")
        : download.status === "verifying" ? t("Checking the download, app version and signature.", "Download, App-Version und Signatur werden geprüft.")
        : download.status === "preparing" ? t("Preparing the verified APK for Android.", "Die geprüfte APK wird für Android vorbereitet.")
        : undefined
    const summary = <section data-app-update-panel data-update-tone={failed || error ? "error" : complete ? "success" : "default"} className="mobile-update" aria-label={t("App update", "App-Update")}>
        <header className="mobile-update__header">
            <span className="mobile-update__icon"><MobileIcon name={complete ? "check" : "update"} /></span>
            <div className="mobile-update__identity">
                <strong>Seanime Mobile</strong>
                <div className="mobile-update__versions">
                    {installedVersion && <span>{t("Installed", "Installiert")}: <b>{installedVersion}</b></span>}
                    {version && !complete && <span className="mobile-update__target">{t("Available", "Verfügbar")}: <b>{version}</b></span>}
                </div>
            </div>
        </header>
        <div className="mobile-update__status" role="status" aria-live="polite" aria-atomic="true" data-download-status={download.status}>
            {working ? <span aria-hidden="true" data-update-check-spinner={isFetching && !busy ? "" : undefined} className="mobile-update__spinner" />
                : <MobileIcon name={failed || error ? "close" : version && !complete ? "update" : "check"} />}
            <span>{status}</span>
        </div>
        {download.status === "downloading" && <div className="mobile-update__transfer">
            <progress aria-label={t("Download progress", "Downloadfortschritt")} max={100} value={percent} />
            {typeof download.bytes === "number" && <p className="mobile-update__bytes">{formatBytes(download.bytes)}{download.total && download.total > 0 ? ` / ${formatBytes(download.total)}` : ""}</p>}
        </div>}
        {hint && <p className="mobile-update__hint">{hint}</p>}
        {download.message && busy && <p className="mobile-update__hint">{download.message === "Waiting for network / Android download service" ? t("Waiting for network or Android download service.", "Warten auf Netzwerk oder Android-Downloaddienst.") : download.message}</p>}
        {failed && download.error && <p className="mobile-update__error">{download.error}</p>}
        {(version || installAction) && !complete && <p className="mobile-update__notice">{t("Installation interrupts playback and running downloads.", "Die Installation unterbricht Wiedergabe und laufende Downloads.")}</p>}
        <div className="mobile-update__actions">
            {version && !complete && !installAction && <Button className="mobile-update__primary" intent="primary" disabled={busy} onClick={start} leftIcon={<MobileIcon name="download" />}>
                {busy ? t("Update in progress…", "Update läuft…") : failed ? t("Retry download", "Download wiederholen") : t("Download and update", "Herunterladen und aktualisieren")}
            </Button>}
            {installAction && <Button className="mobile-update__primary" intent="primary" disabled={busy} onClick={() => window.AppUpdater?.openDownloadedApk?.()} leftIcon={<MobileIcon name="update" />}>
                {download.status === "confirmation" ? t("Confirm installation", "Installation bestätigen") : download.status === "permission" ? t("Allow installation", "Installation erlauben") : t("Install update", "Update installieren")}
            </Button>}
            {version && <Button className="mobile-update__secondary" intent="primary-basic" onClick={() => setOpen(true)}>{t("Update details", "Updateinformationen")}</Button>}
            {!version && <Button className="mobile-update__secondary" type="button" intent="primary-basic" disabled={isFetching} onClick={() => void checkAgain()} leftIcon={<MobileIcon name="refresh" />}>
                {isFetching ? t("Checking…", "Prüfung läuft…") : error ? t("Try again", "Erneut versuchen") : t("Check again", "Erneut prüfen")}
            </Button>}
        </div>
    </section>
    return <>
        <div data-app-update-sidebar>{summary}</div>
        {host && createPortal(summary, host)}
        <Modal open={open && !!version} onOpenChange={close} title={t("App update", "App-Update")} contentClass="mobile-update-dialog" titleClass="mobile-update-dialog__title" closeClass="mobile-update-dialog__close" overlayClass="mobile-update-overlay"
            closeButton={<Button intent="primary-basic" aria-label={t("Close update", "Update schließen")}><MobileIcon name="close" className="size-5" /></Button>}>
            {summary}
            <div className="mobile-update-release"><UpdateChangelogBody updateData={data} /></div>
        </Modal>
    </>
}
