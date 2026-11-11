import { acknowledgeInstalledUpdate, openDownloadedApk, useAppDownloadState, useAutoUpdateCheck, useDownloadAppUpdate, useGetLatestUpdate } from "@/api/hooks/releases.hooks"
import { Button } from "@/components/ui/button/button"
import { cn } from "@/components/ui/core/styling"
import { Dialog } from "@/components/ui/sheet/sheet"
import { Text } from "@/components/ui/text/text"
import { toast } from "@/components/ui/toast/toast-store"
import { type Translate, useTr } from "@/lib/app-language"
import { currentVersion } from "@/lib/app-updates/app-updater"
import {
    autoOpensFor, changelogLines, downloadPercent, installReady, isBusy, isCriticalUpdate, NOTIFIED_UPDATE_KEY, updateHint, updateNoticeOpens, updateStatusText,
} from "@/lib/app-updates/update-notice"
import { MobileIcon } from "@/lib/mobile-icons"
import { localStore } from "@/lib/storage"
import { colors } from "@/lib/theme/tokens"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { atom, useAtom, useSetAtom } from "jotai"
import React from "react"
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native"

/*
 * The update notice (web _features/update/mobile-update-modal.tsx + mobile-update.css): a panel at the top of the Menu
 * (one quiet line with a check button while there is nothing to do, else the app, the versions, the status, the
 * download's progress, the hint and the actions) and the dialog with the release notes, which opens by itself once
 * per new version while "Look for new versions" is on (updateNoticeOpens). The download and the installer are the E4
 * updater (lib/app-updates/app-updater.ts); only a tap on "Download and update" / "Install update" starts them.
 */

export const updateModalOpenAtom = atom(false)

const ACCENT = colors.brand300
const MUTED = "#b5b0c4"

/** Everything panel and dialog read: the release, the download and the actions */
function useUpdateState() {
    const t = useTr()
    const server = useServerStatus()
    const autoCheck = useAutoUpdateCheck()
    const { data, isLoading, isFetching, error, refetch } = useGetLatestUpdate(autoCheck)
    const nativeDownload = useAppDownloadState()
    const { mutate: download, isPending: starting } = useDownloadAppUpdate()
    const setOpen = useSetAtom(updateModalOpenAtom)
    const version = data?.release?.version
    // A finished download of another version than the one offered now counts as nothing
    const state = nativeDownload.status === "complete" && version && nativeDownload.version !== version ? { status: "idle" as const } : nativeDownload
    const checking = React.useRef(false)

    const checkAgain = async () => {
        if (checking.current || isFetching) return
        checking.current = true
        try {
            const result = await refetch()
            // "Check for updates" opens the notice even with "Look for new versions" off
            if (updateNoticeOpens("manual", server?.settings?.library?.disableUpdateCheck, !!result.data?.release?.version)) setOpen(true)
        } finally {
            checking.current = false
        }
    }
    const start = () => {
        if (["downloading", "verifying", "preparing", "installing", "confirmation"].includes(state.status) || starting) return
        download()
    }
    return {
        t, data, version, state, starting, checkAgain, start,
        check: { fetching: isFetching, loading: isLoading, error: !!error, hasData: !!data, version, starting },
        busy: isBusy(state, starting),
        install: () => void openDownloadedApk(),
        showDetails: () => setOpen(true),
    }
}

type UpdateState = ReturnType<typeof useUpdateState>

function Spinner() {
    return <ActivityIndicator size="small" color={ACCENT} />
}

/** `.mobile-update`: the full panel (in the Menu while something is to do, and at the top of the dialog) */
function UpdateSummary({ s, inDialog }: { s: UpdateState, inDialog?: boolean }) {
    const { t, state, version, check, busy } = s
    const complete = state.status === "installed"
    const failed = state.status === "failed" || state.status === "error"
    const ready = installReady(state)
    const working = busy || check.fetching || check.loading
    const installed = complete ? state.version : s.data?.current_version
    const percent = downloadPercent(state)
    const hint = updateHint(state, t)
    const mb = (bytes: number) => new Intl.NumberFormat(t("en", "de"), { maximumFractionDigits: 1 }).format(bytes / (1024 * 1024)) + " MB"
    const tone = failed || check.error ? "#fda4af" : ACCENT
    return (
        <View accessibilityLabel={t("App update", "App-Update")} className={cn(inDialog ? "py-1" : "p-4")}>
            <View className="flex-row items-center gap-3">
                <View style={{ backgroundColor: "rgba(139,92,246,0.12)" }} className="h-10 w-10 items-center justify-center rounded-[14px]">
                    <MobileIcon name={complete ? "check" : "update"} size={24} color={ACCENT} />
                </View>
                <View className="min-w-0 flex-1">
                    <Text className={cn("font-semibold text-[#e9e7f0]", inDialog ? "text-lg" : "text-base")}>Seanime Mobile</Text>
                    <View className="mt-0.5 flex-row flex-wrap gap-x-3">
                        {!!installed && <Text style={{ color: MUTED }} className="text-[13px]">{t("Installed", "Installiert")}: <Text className="text-[13px] font-medium text-[#d8d4e4]">{installed}</Text></Text>}
                        {!!version && !complete && <Text style={{ color: ACCENT }} className="text-[13px]">{t("Available", "Verfügbar")}: <Text style={{ color: ACCENT }} className="text-[13px] font-medium">{version}</Text></Text>}
                    </View>
                </View>
            </View>
            <View accessibilityRole="text" accessibilityLiveRegion="polite" className="mt-3.5 flex-row items-start gap-2">
                {working ? <Spinner /> : <MobileIcon name={failed || check.error ? "close" : version && !complete ? "update" : "check"} size={16} color={tone} />}
                <Text style={{ color: failed || check.error ? "#fda4af" : "#e9e7f0" }} className="min-w-0 flex-1 text-sm font-medium">{updateStatusText(state, check, t)}</Text>
            </View>
            {state.status === "downloading" && (
                <View className="mt-3">
                    <View accessibilityRole="progressbar" accessibilityLabel={t("Download progress", "Downloadfortschritt")} accessibilityValue={{ min: 0, max: 100, now: percent }}
                        className="h-1.5 overflow-hidden rounded-full bg-sm-line-strong">
                        <View style={{ width: `${percent ?? 0}%`, backgroundColor: ACCENT }} className="h-full" />
                    </View>
                    {typeof state.bytes === "number" && <Text style={{ color: MUTED, fontVariant: ["tabular-nums"] }} className="mt-1.5 text-right text-xs">
                        {mb(state.bytes)}{state.total && state.total > 0 ? ` / ${mb(state.total)}` : ""}
                    </Text>}
                </View>
            )}
            {!!hint && <Text style={{ color: MUTED }} className="mt-2 text-[13px] leading-[20px]">{hint}</Text>}
            {!!state.message && busy && <Text style={{ color: MUTED }} className="mt-2 text-[13px] leading-[20px]">{state.message}</Text>}
            {failed && !!state.error && (
                <View style={{ borderLeftWidth: 2, borderLeftColor: "rgba(251,113,133,0.5)" }} className="mt-2 pl-2.5">
                    <Text selectable className="text-[13px] leading-[20px] text-[#fecdd3]">{state.error}</Text>
                </View>
            )}
            {(!!version || ready) && !complete && <Text style={{ color: MUTED }} className="mt-3 text-[13px] leading-[20px]">
                {t("Installation interrupts playback and running downloads.", "Die Installation unterbricht Wiedergabe und laufende Downloads.")}
            </Text>}
            <View className="mt-2.5 flex-row flex-wrap gap-x-2 gap-y-1">
                {!!version && !complete && !ready && (
                    <Button wrapperClassName="w-full" className="rounded-xl" disabled={busy} onPress={s.start} leftIcon={<MobileIcon name="download" size={20} color="#ffffff" />}>
                        {busy ? t("Update in progress…", "Update läuft…") : failed ? t("Retry download", "Download wiederholen") : t("Download and update", "Herunterladen und aktualisieren")}
                    </Button>
                )}
                {ready && (
                    <Button wrapperClassName="w-full" className="rounded-xl" disabled={busy} onPress={s.install} leftIcon={<MobileIcon name="update" size={20} color="#ffffff" />}>
                        {state.status === "confirmation" ? t("Confirm installation", "Installation bestätigen") : state.status === "permission" ? t("Allow installation", "Installation erlauben") : t("Install update", "Update installieren")}
                    </Button>
                )}
                {!!version && !inDialog && <Button intent="text" className="-ml-2" onPress={s.showDetails}>{t("Update details", "Updateinformationen")}</Button>}
                {!version && (
                    <Button intent="text" className="-ml-2" disabled={check.fetching} onPress={() => void s.checkAgain()} leftIcon={<MobileIcon name="refresh" size={18} color={ACCENT} />}>
                        {check.fetching ? t("Checking…", "Prüfung läuft…") : check.error ? t("Try again", "Erneut versuchen") : t("Check again", "Erneut prüfen")}
                    </Button>
                )}
            </View>
        </View>
    )
}

/** The Menu's top: one quiet line while nothing is to do, else the full panel (`#__seanime_update_menu_host`) */
export function MobileUpdatePanel() {
    const s = useUpdateState()
    const { t, state, version, check, busy } = s
    const quiet = !version && state.status !== "installed" && !installReady(state) && state.status !== "failed" && state.status !== "error" && !busy && !updateHint(state, t)
    return (
        <View style={{ borderBottomWidth: 1, borderBottomColor: "rgba(199,194,255,0.12)" }} className="mb-1.5">
            {quiet ? (
                <View accessibilityLabel={t("App update", "App-Update")} className="flex-row items-center gap-2.5 py-0.5 pl-4 pr-1">
                    {check.fetching || check.loading ? <Spinner /> : <MobileIcon name={check.error ? "close" : "check"} size={16} color={check.error ? "#fda4af" : ACCENT} />}
                    <Text accessibilityLiveRegion="polite" style={{ color: MUTED, fontVariant: ["tabular-nums"] }} className="min-w-0 flex-1 text-[13px]">
                        {[`App ${s.data?.current_version || currentVersion()}`, check.fetching || check.loading ? t("checking…", "wird geprüft…") : check.error ? t("check failed", "Prüfung fehlgeschlagen")
                            : check.hasData ? t("up to date", "aktuell") : t("check unavailable", "Prüfung nicht verfügbar")].join(" · ")}
                    </Text>
                    <Pressable accessibilityRole="button" accessibilityLabel={t("Check for updates", "Nach Updates suchen")} disabled={check.fetching} onPress={() => void s.checkAgain()}
                        className="h-11 w-11 items-center justify-center rounded-xl active:bg-[rgba(139,92,246,0.12)]">
                        <MobileIcon name="refresh" size={20} color={ACCENT} />
                    </Pressable>
                </View>
            ) : <UpdateSummary s={s} />}
        </View>
    )
}

function ReleaseNotes({ t, body }: { t: Translate, body: string | undefined }) {
    const lines = changelogLines(body)
    return (
        <View style={{ borderTopWidth: 1, borderTopColor: "rgba(199,194,255,0.12)" }} className="gap-1 pt-4">
            {isCriticalUpdate(lines) && <Text className="mb-1 font-semibold text-[#fca5a5]">{t("This update includes a critical patch", "Dieses Update enthält eine kritische Korrektur")}</Text>}
            <Text className="mb-2.5 text-sm font-semibold text-[#e9e7f0]">{t("What’s new", "Was ist neu?")}</Text>
            {!lines.length && <Text className="text-sm text-[#bfbaca]">{t("No release notes provided.", "Keine Releaseinformationen vorhanden.")}</Text>}
            {lines.map((line, index) => {
                const sub = /^\s+-/.test(line)
                return <Text key={index} className={cn("leading-[23px]", line.includes("🚑️") ? "font-semibold text-[#fca5a5]" : sub ? "pl-4 text-sm text-[#bfbaca] opacity-75" : "text-sm text-[#bfbaca]")}>{line.trim()}</Text>
            })}
        </View>
    )
}

/** The dialog with the panel and the release notes; once in the main layout */
export function MobileUpdateModal() {
    const s = useUpdateState()
    const server = useServerStatus()
    const [open, setOpen] = useAtom(updateModalOpenAtom)
    const { t, version, state } = s
    const disableUpdateCheck = server ? server.settings?.library?.disableUpdateCheck : true

    // Once per new version while "Look for new versions" is on
    React.useEffect(() => {
        if (autoOpensFor(version, disableUpdateCheck, localStore.getItem(NOTIFIED_UPDATE_KEY))) setOpen(true)
    }, [version, disableUpdateCheck, setOpen])

    // An installed update is confirmed once
    const confirmed = React.useRef<string | undefined>(undefined)
    React.useEffect(() => {
        if (state.status !== "installed" || confirmed.current === state.version) return
        confirmed.current = state.version
        toast.success(t("Update successfully installed – Version ", "Update erfolgreich installiert – Version ") + state.version, { duration: 10000 })
        acknowledgeInstalledUpdate()
    }, [state.status, state.version, t])

    const close = (next: boolean) => {
        if (next) return setOpen(true)
        if (version) localStore.setItem(NOTIFIED_UPDATE_KEY, JSON.stringify(version))
        setOpen(false)
    }
    return (
        <Dialog open={open && !!version} onOpenChange={close} title={t("App update", "App-Update")} className="max-h-[92%] border-[rgba(199,194,255,0.16)] bg-[#12101c]">
            <ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="gap-4 pb-1">
                <UpdateSummary s={s} inDialog />
                <ReleaseNotes t={t} body={s.data?.release?.body} />
            </ScrollView>
        </Dialog>
    )
}
