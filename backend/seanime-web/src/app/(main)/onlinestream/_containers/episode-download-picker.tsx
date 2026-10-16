import { AL_BaseAnime, Onlinestream_Episode } from "@/api/generated/types"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { openAndroidDownloads } from "@/lib/android-offline"
import React from "react"
import { LuDownload } from "react-icons/lu"
import { toast } from "sonner"

export function EpisodeDownloadPicker({ media, episodes, provider, server, quality, dubbed, currentEpisode }: {
    media: AL_BaseAnime, episodes?: Onlinestream_Episode[], provider?: string | null, server?: string | null,
    quality?: string | null, dubbed: boolean, currentEpisode: number | null,
}) {
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
            toast.success(result.added ? `${result.added} Folgen eingeplant` : "Alle gewählten Folgen sind bereits eingeplant oder gespeichert", {
                action: { label: "Downloads", onClick: () => openAndroidDownloads() },
            })
            setOpen(false)
        } catch (error) { toast.error(error instanceof Error ? error.message : "Folgen konnten nicht eingeplant werden") }
        finally { setBusy(false) }
    }
    return <>
        <Button size="sm" rounded intent="gray-basic" leftIcon={<LuDownload />} disabled={!provider || !all.length} onClick={show} data-download-season>
            Staffel / Folgen herunterladen
        </Button>
        <Modal open={open} onOpenChange={setOpen} title="Folgen herunterladen">
            <div className="space-y-4" data-episode-download-picker>
                <div><h3 className="text-lg font-semibold">{media.title?.userPreferred || media.title?.romaji}</h3>
                    <p className="mt-1 text-sm text-[--muted]">{all.length} Folgen · {dubbed ? "Dub" : "Originalton"} · {quality || "Auto"}</p>
                    <p className="mt-1 text-xs text-[--muted]">Quelle: {provider}. Bereits gespeicherte Folgen werden übersprungen. Die Warteschlange bleibt beim Verlassen der Seite erhalten.</p></div>
                <div className="flex flex-wrap gap-2">
                    <Button size="sm" intent="gray-basic" onClick={() => setSelected(new Set(available.map(episode => episode.number)))}>Ganze Staffel</Button>
                    <Button size="sm" intent="gray-basic" onClick={() => setSelected(new Set(available.filter(episode => episode.number >= (currentEpisode || 1)).map(episode => episode.number)))}>Ab Folge {currentEpisode || 1}</Button>
                    <Button size="sm" intent="gray-basic" onClick={() => setSelected(new Set())}>Keine</Button>
                </div>
                <div className="max-h-[45vh] overflow-y-auto divide-y divide-white/5 rounded-xl border border-white/5">
                    {all.map(episode => <label key={episode.number} className={`flex min-h-12 items-center gap-3 px-3 py-2 ${existing.has(episode.number) ? "opacity-50" : "cursor-pointer hover:bg-white/5"}`}>
                        <input type="checkbox" aria-label={`Folge ${episode.number} auswählen`} checked={selected.has(episode.number)} disabled={existing.has(episode.number) || busy}
                            className="h-4 w-4 accent-violet-400" onChange={event => setSelected(previous => { const next = new Set(previous); if (event.target.checked) next.add(episode.number); else next.delete(episode.number); return next })} />
                        <span className="min-w-0"><span className="block text-sm font-medium">Folge {episode.number}</span>
                            <span className="block truncate text-xs text-[--muted]">{existing.has(episode.number) ? "Bereits gespeichert / eingeplant" : episode.title || episode.metadata?.episodeTitle || ""}</span></span>
                    </label>)}
                </div>
                <div className="flex items-center justify-between gap-3"><span className="text-xs text-[--muted]">{selected.size} ausgewählt</span>
                    <Button intent="primary" disabled={!selected.size || busy} onClick={submit}>{busy ? "Wird eingeplant …" : `${selected.size} Folgen herunterladen`}</Button></div>
            </div>
        </Modal>
    </>
}
