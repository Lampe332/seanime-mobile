import type { Manga_MangaSourceRefreshJob, Manga_MangaSourceRefreshMode } from "@/api/generated/types"
import { useListMangaProviderExtensions } from "@/api/hooks/extensions.hooks"
import { useStartMangaSourceRefresh, useStopMangaSourceRefresh } from "@/api/hooks/manga.hooks"
import { PickRow, RowGroup } from "@/components/shared/phone-kit"
import { Button } from "@/components/ui/button/button"
import { Sheet } from "@/components/ui/sheet/sheet"
import { Muted, Text } from "@/components/ui/text/text"
import { type Translate, useTr } from "@/lib/app-language"
import { useRouter } from "@/lib/navigation"
import { __manga_preferencesHydratedAtom } from "@/main/manga/_lib/handle-manga-selected-provider"
import { useAtomValue } from "jotai"
import ChevronDown from "lucide-react-native/icons/chevron-down"
import ChevronRight from "lucide-react-native/icons/chevron-right"
import React from "react"
import { Pressable, View } from "react-native"
import { colors } from "@/lib/theme/tokens"

/*
 * "Refresh manga sources" (manga-source-refresh-modal.tsx, phone sheet of the manga library and Home's "Continue
 * reading" ⋮): pick a mode and start; while it runs the progress (it goes on in the background when closed); when done
 * the counts, the issues and the next steps (alternatives, retry failed, run again, done).
 */

const DISCOVERY_MODES: Manga_MangaSourceRefreshMode[] = ["find_missing", "refresh_and_find", "reevaluate_all"]

export function MangaSourceRefreshSheet({ open, onOpenChange, job }: { open: boolean, onOpenChange: (open: boolean) => void, job: Manga_MangaSourceRefreshJob | null | undefined }) {
    const t = useTr()
    const router = useRouter()
    const hydrated = useAtomValue(__manga_preferencesHydratedAtom)
    const { data: providers } = useListMangaProviderExtensions()
    const { mutate: startRefresh, isPending: isStarting } = useStartMangaSourceRefresh()
    const { mutate: stopRefresh, isPending: isStopping } = useStopMangaSourceRefresh()
    const [mode, setMode] = React.useState<Manga_MangaSourceRefreshMode>("refresh_selected")
    const [issuesOpen, setIssuesOpen] = React.useState(false)

    const terminal = job?.status === "completed" || job?.status === "cancelled" || job?.status === "failed"
    const running = job?.status === "running" || job?.status === "stopping"
    const providerCount = providers?.length ?? 0
    const discoveryDisabled = providerCount === 0
    const startDisabled = !hydrated || isStarting || (discoveryDisabled && DISCOVERY_MODES.includes(mode))
    const progress = job?.total ? Math.min(100, Math.round(job.current / job.total * 100)) : 0
    const failedMediaIds = [...new Set(job?.result.issues?.filter(issue => issue.kind === "provider_error").map(issue => issue.mediaId) ?? [])]
    const affectedMediaIds = [...new Set(job?.result.issues?.map(issue => issue.mediaId) ?? [])]
    const canFindAlternatives = providerCount > 0 && (job?.mode === "refresh_selected" || job?.mode === "refresh_and_find") && affectedMediaIds.length > 0

    const dismissJob = (runAgain: boolean) => stopRefresh(undefined, {
        onSuccess: () => {
            if (runAgain) setMode(job?.mode ?? "refresh_selected")
            else onOpenChange(false)
        },
    })
    const retryFailed = () => {
        if (!job || !failedMediaIds.length) return
        stopRefresh(undefined, { onSuccess: () => startRefresh({ mode: job.mode, mediaIds: failedMediaIds }) })
    }
    const findAlternatives = () => {
        if (!affectedMediaIds.length) return
        stopRefresh(undefined, { onSuccess: () => startRefresh({ mode: "reevaluate_all", mediaIds: affectedMediaIds }) })
    }

    const modes: { value: Manga_MangaSourceRefreshMode, title: string, note: string, discovery: boolean }[] = [
        { value: "refresh_selected", title: t("Refresh selected sources", "Gewählte Quellen aktualisieren"), note: t("Update manga that already have a saved source.", "Manga mit gespeicherter Quelle auf neue Kapitel prüfen."), discovery: false },
        { value: "find_missing", title: t("Find missing sources", "Fehlende Quellen finden"), note: t("Search every installed provider for manga without a source.", "Für Manga ohne Quelle alle installierten Quellen durchsuchen."), discovery: true },
        { value: "refresh_and_find", title: t("Refresh and find missing", "Aktualisieren und fehlende finden"), note: t("Update saved sources, then search for missing ones.", "Gespeicherte Quellen aktualisieren, dann fehlende suchen."), discovery: true },
        { value: "reevaluate_all", title: t("Re-evaluate all sources", "Alle Quellen neu bewerten"), note: t("Compare every installed provider and allow saved sources to change.", "Alle installierten Quellen vergleichen; gespeicherte Quellen dürfen wechseln."), discovery: true },
    ]

    const footer = running ? <>
        <Button intent="secondary" wrapperClassName="flex-1" onPress={() => onOpenChange(false)}>{t("Close", "Schließen")}</Button>
        <Button intent="danger" wrapperClassName="flex-1" loading={job?.status === "stopping" || isStopping} onPress={() => stopRefresh()}>
            {job?.status === "stopping" ? t("Stopping...", "Wird gestoppt …") : t("Stop refresh", "Aktualisierung stoppen")}
        </Button>
    </> : terminal ? <View className="flex-1 gap-2">
        {(canFindAlternatives || !!failedMediaIds.length) && <View className="flex-row gap-2">
            {canFindAlternatives && <Button intent="secondary" wrapperClassName="flex-1" loading={isStarting || isStopping} onPress={findAlternatives}>{t("Find alternatives", "Alternativen suchen")}</Button>}
            {!!failedMediaIds.length && <Button intent="secondary" wrapperClassName="flex-1" loading={isStarting || isStopping} onPress={retryFailed}>{t("Retry failed", "Fehlgeschlagene wiederholen")}</Button>}
        </View>}
        <View className="flex-row gap-2">
            <Button intent="secondary" wrapperClassName="flex-1" loading={isStopping} onPress={() => dismissJob(true)}>{t("Run again", "Erneut ausführen")}</Button>
            <Button wrapperClassName="flex-1" loading={isStopping} onPress={() => dismissJob(false)}>{t("Done", "Fertig")}</Button>
        </View>
    </View> : <>
        <Button intent="secondary" wrapperClassName="flex-1" onPress={() => onOpenChange(false)}>{t("Cancel", "Abbrechen")}</Button>
        <Button wrapperClassName="flex-[2]" loading={isStarting} disabled={startDisabled} onPress={() => startRefresh({ mode })}>{t("Start refresh", "Aktualisieren")}</Button>
    </>

    return <Sheet title={t("Refresh manga sources", "Manga-Quellen aktualisieren")} open={open} onOpenChange={onOpenChange} footer={footer}>
        {running && job ? <View className="gap-3" accessibilityLiveRegion="polite">
            <View className="flex-row items-center justify-between gap-4">
                <Text className="min-w-0 flex-1 text-[15px] font-medium">{job.status === "stopping"
                    ? t("Stopping after the current request", "Stoppt nach der laufenden Anfrage")
                    : job.stage === "refreshing" ? t("Refreshing selected sources", "Gewählte Quellen werden aktualisiert")
                        : t("Searching installed sources", "Installierte Quellen werden durchsucht")}</Text>
                <Muted style={{ fontVariant: ["tabular-nums"] }}>{job.current} {t("of", "von")} {job.total}</Muted>
            </View>
            <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: progress }} className="h-1.5 overflow-hidden rounded-full bg-sm-line-strong">
                <View style={{ width: `${progress}%` }} className="h-full bg-sm-accent-strong" />
            </View>
            <Muted>{t("You can close this modal. The refresh will continue in the background.", "Du kannst das Fenster schließen. Die Aktualisierung läuft im Hintergrund weiter.")}</Muted>
        </View> : terminal && job ? <View className="gap-4">
            <View accessibilityLiveRegion={job.status === "failed" ? "assertive" : "polite"} className="gap-1">
                <Text className="text-[15px] font-semibold">{job.status === "completed" ? t("Source refresh complete", "Quellen aktualisiert")
                    : job.status === "cancelled" ? t("Source refresh stopped", "Aktualisierung gestoppt") : t("Source refresh failed", "Aktualisierung fehlgeschlagen")}</Text>
                <Muted>{refreshSummary(job, t)}</Muted>
            </View>
            {!!job.error && <Text className="rounded-surface bg-sm-surface-raised px-4 py-3 text-sm text-sm-danger">{job.error}</Text>}
            {!!job.result.issues?.length && <View className="gap-2">
                <Pressable accessibilityRole="button" accessibilityState={{ expanded: issuesOpen }} onPress={() => setIssuesOpen(v => !v)}
                    className="min-h-12 flex-row items-center justify-between rounded-full bg-sm-surface-raised px-4 active:bg-sm-surface-control">
                    <Text className="text-[15px] font-medium">{t("Review issues", "Probleme ansehen")} ({job.result.issues.length})</Text>
                    {issuesOpen ? <ChevronDown size={18} color={colors.smTextMuted} /> : <ChevronRight size={18} color={colors.smTextMuted} />}
                </Pressable>
                {issuesOpen && job.result.issues.map(issue => <Pressable key={`${issue.mediaId}-${issue.kind}`} accessibilityRole="link"
                    onPress={() => { onOpenChange(false); router.push(`/manga/entry?id=${issue.mediaId}`) }} className="gap-0.5 rounded-surface-sm px-1 py-2 active:bg-sm-surface-control">
                    <Text className="text-sm font-semibold text-sm-accent">{issue.title}</Text>
                    <Muted>{issue.kind === "not_found"
                        ? job.mode === "refresh_selected" ? t("The saved source returned no chapters.", "Die gespeicherte Quelle lieferte keine Kapitel.") : t("No matching source was found.", "Keine passende Quelle gefunden.")
                        : t("One or more providers failed.", "Mindestens eine Quelle ist fehlgeschlagen.")}{issue.providers?.length ? ` ${issue.providers.join(", ")}` : ""}</Muted>
                </Pressable>)}
            </View>}
        </View> : <View className="gap-4">
            <Muted>{providerCount} {providerCount === 1 ? t("installed provider", "installierte Quelle") : t("installed providers", "installierte Quellen")} · {t("Current and re-reading manga only", "Nur Manga, die du gerade (erneut) liest")}</Muted>
            <RowGroup>
                {modes.map(option => <View key={option.value} className={option.discovery && discoveryDisabled ? "opacity-50" : undefined}
                    pointerEvents={option.discovery && discoveryDisabled ? "none" : "auto"}>
                    <PickRow radio checked={mode === option.value} label={option.title} note={option.note} onPress={() => setMode(option.value)} />
                </View>)}
            </RowGroup>
            {mode === "reevaluate_all" && <Notice text={t("Existing source selections may be replaced when another provider has more distinct chapters.", "Gewählte Quellen können ersetzt werden, wenn eine andere Quelle mehr Kapitel hat.")} />}
            {!hydrated && <Notice text={t("Waiting for server-backed manga preferences to finish syncing.", "Warte, bis die Manga-Einstellungen vom Server geladen sind.")} />}
            {discoveryDisabled && <Notice text={t("Install a manga provider to search for missing or alternative sources.", "Installiere eine Manga-Quelle, um fehlende oder alternative Quellen zu suchen.")} />}
        </View>}
    </Sheet>
}

function Notice({ text }: { text: string }) {
    return <Text className="rounded-surface bg-sm-surface-raised px-4 py-3 text-sm leading-[20px] text-sm-text-muted">{text}</Text>
}

function refreshSummary(job: Manga_MangaSourceRefreshJob, t: Translate) {
    const parts = [
        `${job.result.refreshed} ${t("refreshed", "aktualisiert")}`,
        `${job.result.found} ${t("found", "gefunden")}`,
        `${job.result.replaced} ${t("changed", "gewechselt")}`,
    ]
    if (job.result.notFound > 0) parts.push(`${job.result.notFound} ${t("not found", "nicht gefunden")}`)
    if (job.result.failed > 0) parts.push(`${job.result.failed} ${t("failed", "fehlgeschlagen")}`)
    return `${parts.join(", ")}.`
}
