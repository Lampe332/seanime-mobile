import { useServerMutation } from "@/api/client/requests"
import type { RemoveFileCacheBucket_Variables } from "@/api/generated/endpoint.types"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { toast } from "@/components/ui/toast/toast-store"
import { type Translate } from "@/lib/app-language"
import { ConfirmSheet, LinkRow, SettingsGroup } from "@/main/settings/_components/settings-kit"
import React from "react"

/*
 * Logs & cache (settings-phone-logs.tsx): clearing what the core keeps of the sources (core/cache-bucket.ts).
 * Since stage 8 the app runs without its server: server logs, log files, the cache's size on disk and the server's
 * memory and profile tools had no one to answer them, so their rows are gone. The core logs to Logcat only.
 */
export function SettingsLogsSection({ t }: { t: Translate }) {
    return <CacheGroup t={t} />
}

function CacheGroup({ t }: { t: Translate }) {
    const [clear, setClear] = React.useState<"manga" | "onlinestream" | null>(null)
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
