import { useServerMutation } from "@/api/client/requests"
import type { RemoveFileCacheBucket_Variables } from "@/api/generated/endpoint.types"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { toast } from "@/components/ui/toast/toast-store"
import { type Translate } from "@/lib/app-language"
import { makeDiagnosticReport } from "@/lib/diagnostics/collect-diagnostics"
import { useCurrentUser } from "@/main/_hooks/use-server-status"
import { ConfirmSheet, LinkRow, SettingsGroup } from "@/main/settings/_components/settings-kit"
import * as Clipboard from "expo-clipboard"
import Copy from "lucide-react-native/icons/copy"
import Share2 from "lucide-react-native/icons/share-2"
import React from "react"
import { Share } from "react-native"

/*
 * Logs & cache (settings-phone-logs.tsx): clearing what the core keeps of the sources (core/cache-bucket.ts).
 * Since stage 8 the app runs without its server: server logs, log files, the cache's size on disk and the server's
 * memory and profile tools had no one to answer them, so their rows are gone. The core logs to Logcat; its last lines
 * stay in memory for the diagnostic report (lib/diagnostics), which the user copies or shares for a bug report.
 */
export function SettingsLogsSection({ t }: { t: Translate }) {
    return <>
        <DiagnosticGroup t={t} />
        <CacheGroup t={t} />
    </>
}

/** "Copy diagnostic report" / "Share diagnostic report": app, phone, problems and recent log lines, private data filtered */
function DiagnosticGroup({ t }: { t: Translate }) {
    const user = useCurrentUser()
    const [busy, setBusy] = React.useState(false)
    const privateWords = [user?.viewer?.name]

    const withReport = async (deliver: (report: string) => Promise<void>) => {
        if (busy) return
        setBusy(true)
        try {
            await deliver(await makeDiagnosticReport(privateWords))
        }
        catch {
            toast.error(t("The diagnostic report could not be made.", "Der Fehlerbericht konnte nicht erstellt werden."))
        }
        finally {
            setBusy(false)
        }
    }

    return <SettingsGroup title={t("Diagnostic report", "Fehlerbericht")}
        note={t("App and Android version, device, language and the app's recent log lines, for a bug report. Sign-ins, email addresses, links, file paths and your AniList name are left out.",
            "App- und Android-Version, Gerät, Sprache und die letzten Log-Zeilen der App, für eine Fehlermeldung. Anmeldungen, E-Mail-Adressen, Links, Dateipfade und dein AniList-Name bleiben draußen.")}>
        <LinkRow label={t("Copy diagnostic report", "Fehlerbericht kopieren")} icon={Copy} chevron={false} disabled={busy}
            note={t("Puts the report on the clipboard, to paste into a message.", "Legt den Bericht in die Zwischenablage, zum Einfügen in eine Nachricht.")}
            onPress={() => void withReport(async report => {
                await Clipboard.setStringAsync(report)
                toast.success(t("Diagnostic report copied", "Fehlerbericht kopiert"))
            })} />
        <LinkRow label={t("Share diagnostic report", "Fehlerbericht teilen")} icon={Share2} chevron={false} disabled={busy}
            note={t("Sends the report with an app of your choice.", "Schickt den Bericht mit einer App deiner Wahl.")}
            onPress={() => void withReport(async report => {
                await Share.share({ message: report, title: t("Seanime Mobile diagnostic report", "Seanime-Mobile-Fehlerbericht") })
            })} />
    </SettingsGroup>
}

function CacheGroup({ t }: { t: Translate }) {
    // the bucket stays set while the sheet closes, so its title does not jump to the other one on the way out
    const [clear, setClear] = React.useState<"manga" | "onlinestream">("manga")
    const [confirm, setConfirm] = React.useState(false)
    const ask = (bucket: "manga" | "onlinestream") => {
        setClear(bucket)
        setConfirm(true)
    }
    const { mutate: clearBucket, isPending: clearing } = useServerMutation<boolean, RemoveFileCacheBucket_Variables>({
        endpoint: API_ENDPOINTS.FILECACHE.RemoveFileCacheBucket.endpoint,
        method: API_ENDPOINTS.FILECACHE.RemoveFileCacheBucket.methods[0],
        mutationKey: [API_ENDPOINTS.FILECACHE.RemoveFileCacheBucket.key],
        onSuccess: async () => {
            toast.success(t("Cache cleared", "Cache geleert"))
        },
        onError: () => {
            toast.error(t("The cache could not be cleared.", "Der Cache konnte nicht geleert werden."))
        },
    })
    return <SettingsGroup title={t("Cache", "Cache")}
        note={t("Saved source data. Cleared data loads again from the sources.", "Gespeicherte Daten der Quellen. Geleerte Daten lädt die App neu von den Quellen.")}>
        <LinkRow label={t("Clear the manga cache", "Manga-Cache leeren")} disabled={clearing} onPress={() => ask("manga")}
            note={t("Chapter lists and pages. Helps when a manga shows old or broken chapters.",
                "Kapitellisten und Seiten. Hilft, wenn ein Manga alte oder kaputte Kapitel zeigt.")} />
        <LinkRow label={t("Clear the online streaming cache", "Online-Streaming-Cache leeren")} disabled={clearing} onPress={() => ask("onlinestream")}
            note={t("Episode lists and stream links. Helps when an episode is missing or does not play.",
                "Folgenlisten und Stream-Links. Hilft, wenn eine Folge fehlt oder nicht abspielt.")} />
        <ConfirmSheet open={confirm} onOpenChange={setConfirm}
            title={clear === "manga" ? t("Clear the manga cache?", "Manga-Cache leeren?") : t("Clear the online streaming cache?", "Online-Streaming-Cache leeren?")}
            text={clear === "manga" ? t("Chapter lists and pages load again from the sources.", "Kapitellisten und Seiten lädt die App neu von den Quellen.")
                : t("Episode lists and stream links load again from the sources.", "Folgenlisten und Stream-Links lädt die App neu von den Quellen.")}
            action={t("Clear", "Leeren")} danger onConfirm={() => clearBucket({ bucket: clear })} />
    </SettingsGroup>
}
