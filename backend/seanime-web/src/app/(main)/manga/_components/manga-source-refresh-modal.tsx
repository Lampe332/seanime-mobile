import { Manga_MangaSourceRefreshJob, Manga_MangaSourceRefreshMode } from "@/api/generated/types"
import { useListMangaProviderExtensions } from "@/api/hooks/extensions.hooks"
import { useStartMangaSourceRefresh, useStopMangaSourceRefresh } from "@/api/hooks/manga.hooks"
import { __manga_preferencesHydratedAtom } from "@/app/(main)/manga/_lib/handle-manga-selected-provider"
import { SeaLink } from "@/components/shared/sea-link"
import { Alert } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Disclosure, DisclosureContent, DisclosureItem, DisclosureTrigger } from "@/components/ui/disclosure"
import { Modal } from "@/components/ui/modal"
import { ProgressBar } from "@/components/ui/progress-bar"
import { RadioGroup } from "@/components/ui/radio-group"
import { Translate, useTr } from "@/lib/app-language"
import { useAtomValue } from "jotai/react"
import React from "react"
import { LuChevronDown, LuRefreshCcw } from "react-icons/lu"

type MangaSourceRefreshModalProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    job: Manga_MangaSourceRefreshJob | null | undefined
    returnFocusRef: React.RefObject<HTMLButtonElement | null>
    /** Android phone library: bottom sheet in the app language; desktop keeps the English dialog */
    phone?: boolean
}

const discoveryModes: Manga_MangaSourceRefreshMode[] = ["find_missing", "refresh_and_find", "reevaluate_all"]

export function MangaSourceRefreshModal({ open, onOpenChange, job, returnFocusRef, phone }: MangaSourceRefreshModalProps) {
    const hydrated = useAtomValue(__manga_preferencesHydratedAtom)
    const { data: providers } = useListMangaProviderExtensions()
    const { mutate: startRefresh, isPending: isStarting } = useStartMangaSourceRefresh()
    const { mutate: stopRefresh, isPending: isStopping } = useStopMangaSourceRefresh()
    const [mode, setMode] = React.useState<Manga_MangaSourceRefreshMode>("refresh_selected")
    const statusHeadingRef = React.useRef<HTMLParagraphElement>(null)
    const appLanguage = useTr()
    const t: Translate = (en, de) => phone ? appLanguage(en, de) : en

    const terminal = job?.status === "completed" || job?.status === "cancelled" || job?.status === "failed"
    const running = job?.status === "running" || job?.status === "stopping"

    React.useEffect(() => {
        if (open && job) {
            statusHeadingRef.current?.focus()
        }
    }, [job?.id, job?.status, open])

    const providerCount = providers?.length ?? 0
    const discoveryDisabled = providerCount === 0
    const startDisabled = !hydrated || isStarting || discoveryDisabled && discoveryModes.includes(mode)
    const progress = job?.total ? Math.min(100, Math.round(job.current / job.total * 100)) : 0
    const failedMediaIds = [...new Set(job?.result.issues
        ?.filter(issue => issue.kind === "provider_error")
        .map(issue => issue.mediaId) ?? [])]
    const affectedMediaIds = [...new Set(job?.result.issues?.map(issue => issue.mediaId) ?? [])]
    const canFindAlternatives = providerCount > 0 &&
        (job?.mode === "refresh_selected" || job?.mode === "refresh_and_find") &&
        affectedMediaIds.length > 0

    const dismissJob = React.useCallback((runAgain: boolean) => {
        stopRefresh(undefined, {
            onSuccess: () => {
                if (runAgain) {
                    setMode(job?.mode ?? "refresh_selected")
                } else {
                    onOpenChange(false)
                }
            },
        })
    }, [job?.mode, onOpenChange, stopRefresh])

    const retryFailed = React.useCallback(() => {
        if (!job || !failedMediaIds.length) return
        stopRefresh(undefined, {
            onSuccess: () => startRefresh({ mode: job.mode, mediaIds: failedMediaIds }),
        })
    }, [failedMediaIds, job, startRefresh, stopRefresh])

    const findAlternatives = React.useCallback(() => {
        if (!affectedMediaIds.length) return
        stopRefresh(undefined, {
            onSuccess: () => startRefresh({ mode: "reevaluate_all", mediaIds: affectedMediaIds }),
        })
    }, [affectedMediaIds, startRefresh, stopRefresh])

    return (
        <Modal
            open={open}
            onOpenChange={onOpenChange}
            title={t("Refresh manga sources", "Manga-Quellen aktualisieren")}
            contentClass={phone ? "mml-sheet mml-refresh-sheet" : "max-w-xl"}
            onCloseAutoFocus={event => {
                event.preventDefault()
                returnFocusRef.current?.focus()
            }}
            footer={running ? (
                <>
                    <Button intent="gray-outline" onClick={() => onOpenChange(false)}>{t("Close", "Schließen")}</Button>
                    <Button
                        intent="warning"
                        loading={job?.status === "stopping" || isStopping}
                        disabled={job?.status === "stopping" || isStopping}
                        onClick={() => stopRefresh()}
                    >
                        {job?.status === "stopping" ? t("Stopping...", "Wird gestoppt …") : t("Stop refresh", "Aktualisierung stoppen")}
                    </Button>
                </>
            ) : terminal ? (
                <>
                    {canFindAlternatives && (
                        <Button intent="gray-outline" loading={isStarting || isStopping} onClick={findAlternatives}>
                            {t("Find alternatives", "Alternativen suchen")}
                        </Button>
                    )}
                    {!!failedMediaIds.length && (
                        <Button intent="gray-outline" loading={isStarting || isStopping} onClick={retryFailed}>
                            {t("Retry failed", "Fehlgeschlagene wiederholen")}
                        </Button>
                    )}
                    <Button intent="gray-outline" loading={isStopping} onClick={() => dismissJob(true)}>{t("Run again", "Erneut ausführen")}</Button>
                    <Button intent="primary" loading={isStopping} onClick={() => dismissJob(false)}>{t("Done", "Fertig")}</Button>
                </>
            ) : (
                <>
                    <Button intent="gray-outline" onClick={() => onOpenChange(false)}>{t("Cancel", "Abbrechen")}</Button>
                    <Button
                        intent="primary"
                        leftIcon={<LuRefreshCcw />}
                        loading={isStarting}
                        disabled={startDisabled}
                        onClick={() => startRefresh({ mode })}
                    >{t("Start refresh", "Aktualisieren")}</Button>
                </>
            )}
        >
            {running && job ? (
                <div className="space-y-5" aria-live="polite">
                    <div className="space-y-2">
                        <div className="flex items-center justify-between gap-4 text-sm">
                            <p ref={statusHeadingRef} tabIndex={-1} className="font-medium outline-none">
                                {job.status === "stopping"
                                    ? t("Stopping after the current request", "Stoppt nach der laufenden Anfrage")
                                    : job.stage === "refreshing"
                                        ? t("Refreshing selected sources", "Gewählte Quellen werden aktualisiert")
                                        : t("Searching installed sources", "Installierte Quellen werden durchsucht")}
                            </p>
                            <p className="shrink-0 text-[--muted]">{job.current} {t("of", "von")} {job.total}</p>
                        </div>
                        <ProgressBar value={progress} size="sm" aria-label={t("Source refresh progress", "Fortschritt der Quellenaktualisierung")} />
                    </div>
                    <p className="text-sm text-[--muted]">
                        {t("You can close this modal. The refresh will continue in the background.",
                            "Du kannst das Fenster schließen. Die Aktualisierung läuft im Hintergrund weiter.")}
                    </p>
                </div>
            ) : terminal && job ? (
                <div className="space-y-5">
                    <div aria-live={job.status === "failed" ? "assertive" : "polite"}>
                        <p ref={statusHeadingRef} tabIndex={-1} className="font-medium outline-none">
                            {job.status === "completed" ? t("Source refresh complete", "Quellen aktualisiert") : job.status === "cancelled"
                                ? t("Source refresh stopped", "Aktualisierung gestoppt")
                                : t("Source refresh failed", "Aktualisierung fehlgeschlagen")}
                        </p>
                        <p className="mt-1 text-sm text-[--muted]">
                            {formatRefreshSummary(job, t)}
                        </p>
                    </div>

                    {!!job.error && <Alert intent="alert-basic" description={job.error} />}

                    {!!job.result.issues?.length && (
                        <Disclosure type="single" collapsible>
                            <DisclosureItem value="issues">
                                <DisclosureTrigger>
                                    <Button intent="gray-outline" className="w-full justify-between" rightIcon={<LuChevronDown />}>
                                        {t("Review issues", "Probleme ansehen")} ({job.result.issues.length})
                                    </Button>
                                </DisclosureTrigger>
                                <DisclosureContent className="pt-3 max-h-56 overflow-y-auto">
                                    <div className="space-y-2">
                                        {job.result.issues.map(issue => (
                                            <div key={`${issue.mediaId}-${issue.kind}`} className="min-w-0 text-sm">
                                                <SeaLink href={`/manga/entry?id=${issue.mediaId}`} className="font-medium break-words">
                                                    {issue.title}
                                                </SeaLink>
                                                <p className="text-[--muted] break-words">
                                                    {issue.kind === "not_found"
                                                        ? job.mode === "refresh_selected"
                                                            ? t("The saved source returned no chapters.", "Die gespeicherte Quelle lieferte keine Kapitel.")
                                                            : t("No matching source was found.", "Keine passende Quelle gefunden.")
                                                        : t("One or more providers failed.", "Mindestens eine Quelle ist fehlgeschlagen.")}
                                                    {!!issue.providers?.length && ` ${issue.providers.join(", ")}`}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                </DisclosureContent>
                            </DisclosureItem>
                        </Disclosure>
                    )}
                </div>
            ) : (
                <div className="space-y-5">
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-[--muted]">
                        <span>{providerCount} {providerCount === 1 ? t("installed provider", "installierte Quelle") : t("installed providers", "installierte Quellen")}</span>
                        <span>{t("Current and re-reading manga only", "Nur Manga, die du gerade (erneut) liest")}</span>
                    </div>

                    <RadioGroup
                        value={mode}
                        onValueChange={value => setMode(value as Manga_MangaSourceRefreshMode)}
                        stackClass="space-y-2"
                        itemContainerClass="items-start gap-3 rounded-xl border border-[--border] px-3 py-3 data-[state=checked]:border-brand/60 data-[state=checked]:bg-brand/5"
                        itemClass="mt-0.5 shrink-0"
                        itemLabelClass="min-w-0 flex-1"
                        options={[
                            {
                                value: "refresh_selected",
                                label: <ModeLabel
                                    title={t("Refresh selected sources", "Gewählte Quellen aktualisieren")}
                                    description={t("Update manga that already have a saved source.", "Manga mit gespeicherter Quelle auf neue Kapitel prüfen.")}
                                />,
                            },
                            {
                                value: "find_missing",
                                disabled: discoveryDisabled,
                                label: <ModeLabel
                                    title={t("Find missing sources", "Fehlende Quellen finden")}
                                    description={t("Search every installed provider for manga without a source.",
                                        "Für Manga ohne Quelle alle installierten Quellen durchsuchen.")}
                                />,
                            },
                            {
                                value: "refresh_and_find",
                                disabled: discoveryDisabled,
                                label: <ModeLabel
                                    title={t("Refresh and find missing", "Aktualisieren und fehlende finden")}
                                    description={t("Update saved sources, then search for missing ones.",
                                        "Gespeicherte Quellen aktualisieren, dann fehlende suchen.")}
                                />,
                            },
                            {
                                value: "reevaluate_all",
                                disabled: discoveryDisabled,
                                label: <ModeLabel
                                    title={t("Re-evaluate all sources", "Alle Quellen neu bewerten")}
                                    description={t("Compare every installed provider and allow saved sources to change.",
                                        "Alle installierten Quellen vergleichen; gespeicherte Quellen dürfen wechseln.")}
                                />,
                            },
                        ]}
                    />

                    {mode === "reevaluate_all" && (
                        <Alert
                            intent="warning-basic"
                            description={t("Existing source selections may be replaced when another provider has more distinct chapters.",
                                "Gewählte Quellen können ersetzt werden, wenn eine andere Quelle mehr Kapitel hat.")}
                        />
                    )}
                    {!hydrated && (
                        <Alert intent="info-basic" description={t("Waiting for server-backed manga preferences to finish syncing.",
                            "Warte, bis die Manga-Einstellungen vom Server geladen sind.")} />
                    )}
                    {discoveryDisabled && (
                        <Alert intent="warning-basic" description={t("Install a manga provider to search for missing or alternative sources.",
                            "Installiere eine Manga-Quelle, um fehlende oder alternative Quellen zu suchen.")} />
                    )}
                </div>
            )}
        </Modal>
    )
}

function ModeLabel({ title, description }: { title: string, description: string }) {
    return (
        <span className="block min-w-0">
            <span className="block font-medium text-[--foreground] break-words">{title}</span>
            <span className="mt-0.5 block text-sm font-normal text-[--muted] break-words">{description}</span>
        </span>
    )
}

function formatRefreshSummary(job: Manga_MangaSourceRefreshJob, t: Translate) {
    const parts = [
        `${job.result.refreshed} ${t("refreshed", "aktualisiert")}`,
        `${job.result.found} ${t("found", "gefunden")}`,
        `${job.result.replaced} ${t("changed", "gewechselt")}`,
    ]
    if (job.result.notFound > 0) parts.push(`${job.result.notFound} ${t("not found", "nicht gefunden")}`)
    if (job.result.failed > 0) parts.push(`${job.result.failed} ${t("failed", "fehlgeschlagen")}`)
    return `${parts.join(", ")}.`
}
