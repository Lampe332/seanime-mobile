import { AL_BaseAnime, Onlinestream_Episode } from "@/api/generated/types"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { notifyOfflineChanged, openAndroidDownloads } from "@/lib/android-offline"
import { useTr } from "@/lib/app-language"
import { successFeedback } from "@/lib/feedback"
import React from "react"
import { LuCheck, LuDownload } from "react-icons/lu"
import { toast } from "sonner"

const episodeWord = (count: number) => count === 1 ? "episode" : "episodes"
const sameSet = (a: Set<number>, b: number[]) => a.size === b.length && b.every(n => a.has(n))

export function EpisodeDownloadPicker({ media, episodes, provider, server, quality, dubbed, currentEpisode }: {
    media: AL_BaseAnime, episodes?: Onlinestream_Episode[], provider?: string | null, server?: string | null,
    quality?: string | null, dubbed: boolean, currentEpisode: number | null,
}) {
    const t = useTr()
    const [open, setOpen] = React.useState(false)
    const [selected, setSelected] = React.useState<Set<number>>(new Set())
    const [existing, setExisting] = React.useState<Set<number>>(new Set())
    const [busy, setBusy] = React.useState(false)
    const all = React.useMemo(() => [...(episodes || [])].sort((a, b) => a.number - b.number), [episodes])
    const available = all.filter(episode => !existing.has(episode.number))
    const show = () => {
        let stored = new Set<number>()
        try {
            const values = JSON.parse(window.SeanimeOffline?.snapshot(window.__seanimeOfflineToken || "") || "[]") as { mediaId: number, episode: string, status: string, audioLanguage?: string, dubbed?: boolean }[]
            stored = new Set(values.filter(value => value.mediaId === media.id && value.status !== "failed" && value.status !== "removing"
                && (value.audioLanguage ? value.audioLanguage === (dubbed ? "de" : "ja") : !!value.dubbed === dubbed)).map(value => Number(value.episode)))
        } catch { /* The native queue also deduplicates submissions. */ }
        setExisting(stored); setSelected(new Set(all.filter(episode => !stored.has(episode.number)).map(episode => episode.number))); setOpen(true)
    }
    const submit = () => {
        if (!provider || !window.SeanimeOffline || !window.__seanimeOfflineToken || !selected.size) return
        setBusy(true)
        try {
            const result = JSON.parse(window.SeanimeOffline.batch(window.__seanimeOfflineToken, JSON.stringify({
                mediaId: media.id, provider, server, quality: quality || "Auto", dubbed,
                title: media.title?.userPreferred || media.title?.romaji || "Anime",
                description: media.description, genres: media.genres, year: media.seasonYear, format: media.format,
                totalEpisodes: media.episodes, duration: media.duration, score: media.meanScore,
                coverUrl: media.coverImage?.extraLarge || media.coverImage?.large, bannerUrl: media.bannerImage,
                episodes: all.filter(episode => selected.has(episode.number)).map(episode => ({
                    number: episode.number, title: episode.title || episode.metadata?.episodeTitle,
                    image: episode.image || episode.metadata?.episodeMetadata?.image,
                    description: (episode.description || episode.metadata?.episodeMetadata?.summary || "").slice(0, 400),
                })),
            }))) as { error?: string, added?: number }
            if (result.error) throw new Error(result.error)
            notifyOfflineChanged()
            if (result.added) successFeedback()
            toast.success(result.added ? t(`${result.added} ${episodeWord(result.added)} queued`, `${result.added} Folgen eingeplant`) : t("All selected episodes are already queued or saved", "Alle gewählten Folgen sind bereits eingeplant oder gespeichert"), {
                action: { label: "Downloads", onClick: () => openAndroidDownloads() },
            })
            setOpen(false)
        } catch (error) { toast.error(error instanceof Error ? error.message : t("Episodes could not be queued", "Folgen konnten nicht eingeplant werden")) }
        finally { setBusy(false) }
    }
    const from = currentEpisode || 1
    const presets = [
        { id: "season", label: t("Season", "Staffel"), numbers: available.map(episode => episode.number) },
        { id: "from", label: t(`From ep. ${from}`, `Ab Folge ${from}`), numbers: available.filter(episode => episode.number >= from).map(episode => episode.number) },
        ...(currentEpisode !== null ? [{ id: "this", label: t("This episode", "Diese Folge"), numbers: available.some(episode => episode.number === currentEpisode) ? [currentEpisode] : [] }] : []),
    ]
    const toggle = (number: number) => setSelected(previous => {
        const next = new Set(previous)
        if (next.has(number)) next.delete(number); else next.add(number)
        return next
    })
    return <>
        <Button size="sm" rounded intent="gray-basic" leftIcon={<LuDownload />} disabled={!provider || !all.length} onClick={show} data-download-season
            aria-label={t("Download season / episodes", "Staffel / Folgen herunterladen")}>
            {t("Download", "Download")}
        </Button>
        <Modal open={open} onOpenChange={setOpen} contentClass="mobile-anime-dialog mobile-download-sheet" title={t("Download episodes", "Folgen herunterladen")}>
            <div data-episode-download-picker>
                <div className="mobile-download-head">
                    {!!(media.coverImage?.large || media.coverImage?.medium) && <img loading="lazy" decoding="async" src={media.coverImage?.large || media.coverImage?.medium} alt="" className="mobile-download-cover" />}
                    <div className="min-w-0">
                        <p className="mobile-download-title">{media.title?.userPreferred || media.title?.romaji}</p>
                        <p className="mobile-download-meta">{[`${all.length} ${t(episodeWord(all.length), all.length === 1 ? "Folge" : "Folgen")}`, dubbed ? "Dub" : t("Original audio", "Originalton"), provider, quality || "Auto"].filter(Boolean).join(" · ")}</p>
                    </div>
                </div>
                <div className="mobile-download-presets" role="group" aria-label={t("Quick selection", "Schnellauswahl")}>
                    {presets.map(preset => <button key={preset.id} type="button" data-download-preset={preset.id}
                        aria-pressed={sameSet(selected, preset.numbers)} disabled={busy || !preset.numbers.length}
                        onClick={() => setSelected(new Set(preset.numbers))}>{preset.label}</button>)}
                </div>
                <div className="mobile-download-listhead">
                    <span>{t("Episodes", "Folgen")}</span>
                    <button type="button" data-download-preset="none" aria-pressed={!selected.size} disabled={busy || !selected.size}
                        onClick={() => setSelected(new Set())}>{t("Clear selection", "Auswahl leeren")}</button>
                </div>
                <ul className="mobile-download-list" aria-label={t("Episodes", "Folgen")}>
                    {all.map(episode => {
                        const saved = existing.has(episode.number)
                        const checked = selected.has(episode.number)
                        return <li key={episode.number}>
                            <label data-download-episode={episode.number} data-saved={saved || undefined} data-checked={checked || undefined}>
                                <input type="checkbox" className="sr-only" aria-label={t(`Select episode ${episode.number}`, `Folge ${episode.number} auswählen`)}
                                    checked={checked} disabled={saved || busy} onChange={() => toggle(episode.number)} />
                                <span className="mobile-download-number">{episode.number}</span>
                                <span className="mobile-download-name">{episode.title || episode.metadata?.episodeTitle || `${t("Episode", "Folge")} ${episode.number}`}</span>
                                {saved ? <span className="mobile-download-saved">{t("Saved", "Gespeichert")}</span>
                                    : <span className="mobile-download-check" aria-hidden>{checked && <LuCheck />}</span>}
                            </label>
                        </li>
                    })}
                </ul>
                <p className="mobile-download-hint" aria-live="polite">{selected.size} {t("selected", "ausgewählt")} · {t("Saved episodes are skipped, the queue keeps running in the background.", "Gespeicherte Folgen werden übersprungen, die Warteschlange läuft im Hintergrund weiter.")}</p>
                <div className="mobile-download-footer">
                    <Button intent="primary" disabled={!selected.size || busy} onClick={submit} data-download-submit>{busy ? t("Queuing …", "Wird eingeplant …") : t(`Download ${selected.size} ${episodeWord(selected.size)}`, `${selected.size} ${selected.size === 1 ? "Folge" : "Folgen"} herunterladen`)}</Button>
                </div>
            </div>
        </Modal>
    </>
}
