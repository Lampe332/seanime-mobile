import type { Translate } from "@/lib/app-language"
import type { AppDownloadState } from "./updater-state"

/*
 * What the update notice shows (web _features/update/mobile-update-modal.tsx + update-helper.tsx) without the screen:
 * when the dialog opens by itself, the status line, the hint and the release notes' lines.
 */

/** The key under which the version the user already saw is stored (same as the web app) */
export const NOTIFIED_UPDATE_KEY = "notified-available-app-update"

/**
 * "Look for new versions" (Settings › About, `library.disableUpdateCheck` inverted). Off, an update found earlier must
 * not open the update notice by itself any more (fix 4d1e48a of the settings audit); "Check for updates now" still
 * opens it. The one rule for "Look for new versions": useAutoUpdateCheck, the update notice and the settings' "Check for
 * updates now" all ask it (the copy of 2.12 in settings-phone.ts was merged into this one).
 */
export function updateNoticeOpens(trigger: "automatic" | "manual", disableUpdateCheck: boolean | undefined, hasRelease: boolean) {
    if (!hasRelease) return false
    return trigger === "manual" || !disableUpdateCheck
}

/** The dialog opens by itself once per new version, and only while the app looks for new versions */
export function autoOpensFor(version: string | undefined, disableUpdateCheck: boolean | undefined, notified: string | null) {
    return updateNoticeOpens("automatic", disableUpdateCheck, !!version) && notified !== JSON.stringify(version)
}

const BUSY: AppDownloadState["status"][] = ["downloading", "verifying", "preparing", "installing"]

export function isBusy(download: AppDownloadState, starting: boolean) {
    return starting || BUSY.includes(download.status)
}

export function downloadPercent(download: AppDownloadState) {
    return download.total && download.total > 0 ? Math.min(100, Math.floor((download.bytes || 0) * 100 / download.total)) : undefined
}

/** The verified APK waits for the installer (also after a failed install of a verified file) */
export function installReady(download: AppDownloadState) {
    return download.status === "complete" || download.status === "permission" || download.status === "confirmation" || (download.status === "failed" && !!download.verified)
}

export type CheckState = { fetching: boolean, loading: boolean, error: boolean, hasData: boolean, version?: string, starting: boolean }

/** The status line of the panel, in the order the web notice decides it */
export function updateStatusText(download: AppDownloadState, check: CheckState, t: Translate) {
    const percent = downloadPercent(download)
    if (download.status === "installed") return t("Update successfully installed – Version ", "Update erfolgreich installiert – Version ") + download.version
    if (download.status === "verifying") return t("Verifying APK…", "APK wird geprüft…")
    if (download.status === "preparing") return t("Preparing installation…", "Installation wird vorbereitet…")
    if (download.status === "installing") return t("Installation requested…", "Installation angefordert…")
    if (download.status === "permission") return t("Allow installation from this source to continue", "Installation aus dieser Quelle freigeben")
    if (download.status === "confirmation") return t("Android installation confirmation required", "Android-Installationsbestätigung erforderlich")
    if (download.status === "complete") return t("APK verified. Ready to install.", "APK geprüft. Bereit zur Installation.")
    if (check.starting) return t("Starting update…", "Update wird gestartet…")
    if (isBusy(download, false)) return `${t("Downloading", "Wird heruntergeladen")} ${percent === undefined ? "…" : `${percent}%`}`
    if (check.fetching) return t("Searching for updates…", "Suche nach Updates…")
    if (download.status === "failed" || download.status === "error") return t("Update interrupted", "Update unterbrochen")
    if (check.error) return t("Could not check for updates. Check your connection and try again.", "Updates konnten nicht geprüft werden. Prüfe deine Verbindung und versuche es erneut.")
    if (check.loading) return t("Searching for updates…", "Suche nach Updates…")
    if (check.version) return t("New version available", "Neue Version verfügbar")
    return check.hasData ? t("Up to date", "Auf dem neuesten Stand") : t("Update check unavailable", "Updateprüfung nicht verfügbar")
}

/** The explanation under the status while Android or the check needs something */
export function updateHint(download: AppDownloadState, t: Translate) {
    switch (download.status) {
        case "permission":
            return t("Allow Seanime Mobile in Android settings, then return here to continue.", "Erlaube Seanime Mobile die Installation in den Android-Einstellungen und kehre anschließend zurück.")
        case "confirmation":
            return t("Continue in the Android installer. Android or Play Protect may ask you to confirm.", "Fahre im Android-Installer fort. Android oder Play Protect können eine Bestätigung verlangen.")
        case "installing":
            return t("Waiting for Android. The update is complete only when the installed version changes.", "Warten auf Android. Erst der bestätigte Versionswechsel schließt das Update ab.")
        case "verifying":
            return t("Checking the download, app version and signature.", "Download, App-Version und Signatur werden geprüft.")
        case "preparing":
            return t("Preparing the verified APK for Android.", "Die geprüfte APK wird für Android vorbereitet.")
    }
    return undefined
}

/** The release notes' bullet lines, before a "---" footer (update-helper.tsx useUpdateChangelogBody) */
export function changelogLines(body: string | undefined) {
    if (!body) return []
    const head = body.includes("---") ? body.split("---")[0] : body
    return head.split(/\n/).filter(line => line.trim() !== "" && line.trim().startsWith("-"))
}

/** A "🚑️" line marks a critical patch */
export function isCriticalUpdate(lines: string[]) {
    return lines.some(line => line.includes("🚑️"))
}
