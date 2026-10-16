import { __manga_selectedChapterAtom } from "@/app/(main)/manga/_lib/handle-chapter-reader"
import { useAtomValue } from "jotai"
import { MangaDownloads } from "./manga-downloads"
import { PageWrapper } from "@/components/shared/page-wrapper"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { useRouter, useSearchParams } from "@/lib/navigation"
import { getAppLanguage, Translate, useTr } from "@/lib/app-language"
import React from "react"
import { LuArrowLeft, LuArrowDownToLine, LuCheck, LuHardDrive, LuPause, LuPlay, LuRefreshCw, LuTrash2, LuWifiOff } from "react-icons/lu"

export type OfflineEpisode = {
    id: string, mediaId?: number, title: string, episode: number | string, ready: boolean,
    status: "ready" | "paused" | "failed" | "downloading" | "removing" | "queued" | "resolving", progress: number, bytes: number, position: number,
    quality?: string, provider?: string, description?: string, genres?: string[], year?: number,
    format?: string, totalEpisodes?: number, duration?: number, score?: number,
    coverAsset?: string, bannerAsset?: string, episodeImageAsset?: string,
    episodeTitle?: string, episodeDescription?: string, airDate?: string,
}
const asset = (key?: string) => key && /^[a-f0-9]{64}\.jpg$/.test(key) ? `/__android_offline/${key}` : undefined
export const animeKey = (episode: OfflineEpisode) => episode.mediaId ? `media-${episode.mediaId}` : `title-${episode.title}`
export function groupEpisodes(episodes: OfflineEpisode[]) {
    const groups = new Map<string, OfflineEpisode[]>()
    episodes.forEach(episode => { const key = animeKey(episode); groups.set(key, [...(groups.get(key) || []), episode]) })
    return [...groups.entries()].sort((a, b) => a[1][0].title.localeCompare(b[1][0].title))
        .map(([key, values]) => ({ key, episodes: values.sort((a, b) => Number(a.episode) - Number(b.episode)) }))
}
const size = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toLocaleString(getAppLanguage(), { maximumFractionDigits: 1 })} GB`
    : `${(bytes / 1024 ** 2).toLocaleString(getAppLanguage(), { maximumFractionDigits: 1 })} MB`
const clock = (position: number) => `${Math.floor(position / 60000).toString().padStart(2, "0")}:${Math.floor(position / 1000 % 60).toString().padStart(2, "0")}`
const plain = (value?: string) => (value || "").replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").trim()
const stateLabel = (episode: OfflineEpisode, t: Translate) => ({
    ready: t("Available offline", "Offline verfügbar"), paused: t("Paused", "Pausiert"), failed: t("Failed", "Fehlgeschlagen"),
    downloading: t("Downloading", "Wird geladen"), removing: t("Deleting", "Wird gelöscht"), queued: t("Queued", "In der Warteschlange"),
    resolving: t("Preparing source", "Quelle wird vorbereitet"),
})[episode.status]

function Artwork({ image, title, className = "" }: { image?: string, title: string, className?: string }) {
    const [failed, setFailed] = React.useState(false)
    React.useEffect(() => setFailed(false), [image])
    return <div className={`overflow-hidden bg-gray-900 ${className}`}>
        {asset(image) && !failed ? <img src={asset(image)} alt={title} className="h-full w-full object-cover" loading="lazy" onError={() => setFailed(true)} />
            : <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-gray-800 to-gray-950 text-[--muted]"><LuArrowDownToLine className="text-3xl" /></div>}
    </div>
}

export default function Page() {
    const t = useTr()
    const currentChapter = useAtomValue(__manga_selectedChapterAtom)
    const router = useRouter()
    const search = useSearchParams()
    const kind = search.get("kind") === "manga" ? "manga" : "anime"
    const selectedManga = Number(search.get("manga")) || 0
    const selectedKey = kind === "anime" ? search.get("anime") : null
    const [episodes, setEpisodes] = React.useState<OfflineEpisode[]>([])
    const [loaded, setLoaded] = React.useState(false)
    const [error, setError] = React.useState(false)
    const [selecting, setSelecting] = React.useState(false)
    const [selectedAnime, setSelectedAnime] = React.useState<Set<string>>(new Set())
    const [deletingAnime, setDeletingAnime] = React.useState<string[]>([])
    const [filter, setFilter] = React.useState<"all" | "ready" | "active">("all")
    const [deleting, setDeleting] = React.useState<OfflineEpisode | null>(null)
    React.useEffect(() => {
        const back = (event: Event) => {
            if (kind === "manga" && currentChapter) return
            if (deletingAnime.length) { event.preventDefault(); setDeletingAnime([]) }
            else if (selecting) { event.preventDefault(); setSelecting(false); setSelectedAnime(new Set()) }
            else if (deleting) { event.preventDefault(); setDeleting(null) }
            else if (selectedManga) { event.preventDefault(); router.push("/android-downloads?kind=manga") }
            else if (selectedKey) { event.preventDefault(); router.push("/android-downloads") }
        }
        window.addEventListener("seanime:android-back", back)
        return () => window.removeEventListener("seanime:android-back", back)
    }, [deleting, selectedKey, selectedManga, currentChapter, kind, selecting, deletingAnime])
    const refresh = React.useCallback(() => {
        if (!window.SeanimeOffline || !window.__seanimeOfflineToken) return
        try {
            const value = JSON.parse(window.SeanimeOffline.snapshot(window.__seanimeOfflineToken))
            if (!Array.isArray(value)) throw new Error("Invalid library")
            const library = value as OfflineEpisode[]
            setEpisodes(previous => JSON.stringify(previous) === JSON.stringify(library) ? previous : library)
            setLoaded(true); setError(false)
        } catch { setError(true) }
    }, [])
    React.useEffect(() => {
        refresh()
        const timer = window.setInterval(refresh, 1000)
        window.addEventListener("focus", refresh)
        return () => { clearInterval(timer); window.removeEventListener("focus", refresh) }
    }, [refresh])
    const action = (episode: OfflineEpisode, value: string) => {
        if (window.__seanimeOfflineToken) window.SeanimeOffline?.action(window.__seanimeOfflineToken, episode.id, value)
        if (value !== "play") window.setTimeout(refresh, 200)
    }
    const groups = groupEpisodes(episodes)
    const selected = groups.find(group => group.key === selectedKey)
    const media = selected?.episodes.find(episode => episode.coverAsset) || selected?.episodes[0]
    const filtered = groups.filter(group => filter === "all" || group.episodes.some(episode => filter === "ready" ? episode.ready : !episode.ready))
    const totalBytes = episodes.reduce((total, episode) => total + episode.bytes, 0)
    const active = episodes.filter(episode => !episode.ready).length

    return <PageWrapper className="mx-auto max-w-6xl px-4 pt-4 sm:px-8 pb-28 space-y-6" data-downloads-page>
        <header className="flex items-center gap-3 min-h-12">
            <button type="button" aria-label={selectedKey ? t("Back to anime overview", "Zurück zur Anime-Übersicht") : t("Back to Seanime", "Zurück zu Seanime")}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/5 hover:bg-white/10 transition"
                onClick={() => selectedManga ? router.push("/android-downloads?kind=manga") : selectedKey ? router.push("/android-downloads") : router.push("/")}><LuArrowLeft className="text-xl" /></button>
            <div className="min-w-0 flex-1"><h1 className="text-2xl font-semibold tracking-tight">{selectedManga ? t("Your chapters", "Deine Kapitel") : selectedKey ? t("Your episodes", "Deine Folgen") : "Downloads"}</h1>
                <p className="mt-0.5 text-sm text-[--muted]">{selectedKey || selectedManga ? t("Saved on your phone", "Auf deinem Handy gespeichert") : t("Anime and manga to go", "Anime und Manga für unterwegs")}</p></div>
            <LuWifiOff aria-label={t("Offline library", "Offline-Bibliothek")} className="text-lg text-[--muted]" />
        </header>

        {!selectedKey && !selectedManga && <div className="flex gap-2" role="tablist" aria-label={t("Download type", "Download-Typ")}>
            {[{ value: "anime", label: "Anime" }, { value: "manga", label: "Manga" }].map(tab => <button key={tab.value} role="tab" aria-selected={kind === tab.value}
                className={`rounded-full px-5 py-2 text-sm font-medium ${kind === tab.value ? "bg-white/15 text-white" : "text-[--muted]"}`}
                onClick={() => router.push(tab.value === "manga" ? "/android-downloads?kind=manga" : "/android-downloads")}>{tab.label}</button>)}
        </div>}
        {kind === "manga" ? <MangaDownloads selectedId={selectedManga} /> : <>
        {error && <div role="alert" className="rounded-xl bg-red-950/40 p-4 text-sm">{t("Downloads could not be loaded.", "Downloads konnten nicht geladen werden.")} <button onClick={refresh} className="underline">{t("Try again", "Erneut versuchen")}</button></div>}
        {!loaded && !error && <p className="py-12 text-center text-[--muted]">{t("Loading your downloads …", "Deine Downloads werden geladen …")}</p>}

        {!selectedKey && loaded && <>
            <div className="flex items-center justify-between gap-3 text-sm text-[--muted]">
                <span>{groups.length} Anime · {episodes.length} {episodes.length === 1 ? t("episode", "Folge") : t("episodes", "Folgen")}</span>
                <span className="flex items-center gap-1.5"><LuHardDrive />{size(totalBytes)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{selecting ? t(`${selectedAnime.size} anime selected`, `${selectedAnime.size} Anime ausgewählt`) : t("Your anime", "Deine Anime")}</p>
                <Button size="sm" intent="gray-basic" disabled={!groups.length} onClick={() => { setSelecting(!selecting); setSelectedAnime(new Set()) }}>{selecting ? t("Cancel", "Abbrechen") : t("Select", "Auswählen")}</Button>
            </div>
            {selecting && <div className="flex gap-2" data-anime-selection>
                <Button size="sm" intent="gray-basic" onClick={() => setSelectedAnime(new Set(filtered.map(g => g.key)))}>{t("Select all", "Alle auswählen")}</Button>
                <Button size="sm" intent="alert" disabled={!selectedAnime.size} onClick={() => setDeletingAnime([...selectedAnime])}>{t("Delete selected", "Ausgewählte löschen")} ({selectedAnime.size})</Button>
            </div>}
            <div className="flex gap-2" role="group" aria-label={t("Filter downloads", "Downloads filtern")}>
                {([["all", t("All", "Alle")], ["ready", t("Ready", "Bereit")], ["active", t("Active", "Aktiv")]] as const).map(([name, label]) => <button key={name} onClick={() => setFilter(name)} aria-pressed={filter === name}
                    className={`rounded-full px-4 py-2 text-sm font-medium transition ${filter === name ? "bg-white/15 text-white" : "text-[--muted] hover:bg-white/5"}`}>
                    {label}{name === "active" && active > 0 ? ` (${active})` : ""}</button>)}
            </div>
            {filtered.length > 0 ? <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-6">
                {filtered.map(group => {
                    const item = group.episodes.find(episode => episode.coverAsset) || group.episodes[0]
                    const ready = group.episodes.filter(episode => episode.ready).length
                    return <button key={group.key} type="button" onClick={() => selecting ? setSelectedAnime(previous => { const next = new Set(previous); if (next.has(group.key)) next.delete(group.key); else next.add(group.key); return next }) : router.push(`/android-downloads?anime=${encodeURIComponent(group.key)}`)}
                        aria-pressed={selecting ? selectedAnime.has(group.key) : undefined}
                        aria-label={t(`${item.title} – open downloaded episodes`, `${item.title} – heruntergeladene Folgen öffnen`)} className="group text-left min-w-0" data-downloaded-anime>
                        <div className={`relative overflow-hidden rounded-xl ${selecting && selectedAnime.has(group.key) ? "ring-2 ring-violet-400" : ""}`}>
                            {selecting && <span className={`absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 ${selectedAnime.has(group.key) ? "bg-violet-500 border-violet-300" : "bg-black/60 border-white/60"}`}>{selectedAnime.has(group.key) && <LuCheck />}</span>}
                            <Artwork image={item.coverAsset} title={item.title} className="aspect-[2/3] w-full transition duration-200 group-hover:scale-[1.03]" />
                            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-3 pt-12 pb-3">
                                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-white"><LuCheck />{ready} {ready === 1 ? t("episode ready", "Folge bereit") : t("episodes ready", "Folgen bereit")}</span>
                            </div>
                        </div>
                        <h2 className="mt-2.5 text-sm sm:text-base font-semibold leading-snug line-clamp-2">{item.title}</h2>
                        <p className="mt-1 text-xs text-[--muted]">{[item.year, item.format, size(group.episodes.reduce((sum, e) => sum + e.bytes, 0))].filter(Boolean).join(" · ")}</p>
                        {group.episodes.some(e => !e.ready) && <p className="mt-1 text-xs text-orange-300">{group.episodes.filter(e => !e.ready).length} {t("pending", "ausstehend")}</p>}
                    </button>
                })}
            </div> : <div className="flex min-h-60 flex-col items-center justify-center gap-3 py-12 text-center">
                <LuArrowDownToLine className="text-4xl text-[--muted]" /><h2 className="text-lg font-semibold">{episodes.length ? t("Nothing here right now", "Hier ist gerade alles erledigt") : t("Your offline library starts here", "Deine Offline-Bibliothek beginnt hier")}</h2>
                <p className="max-w-xs text-sm text-[--muted]">{episodes.length ? t("Pick another filter to see your anime.", "Wähle einen anderen Filter, um deine Anime zu sehen.") : t("Download an episode while watching. Covers, info and episodes will show up here.", "Lade eine Folge beim Anschauen herunter. Cover, Infos und Folgen findest du anschließend hier.")}</p>
            </div>}
        </>}

        {selectedKey && loaded && !selected && <div className="py-12 text-center text-[--muted]">{t("No downloads are stored for this anime anymore.", "Für diesen Anime sind keine Downloads mehr gespeichert.")}
            <div className="mt-4"><Button intent="gray-basic" onClick={() => router.push("/android-downloads")}>{t("Back to anime overview", "Zur Anime-Übersicht")}</Button></div></div>}
        {selected && media && <>
            <section className="relative -mx-4 sm:mx-0 overflow-hidden sm:rounded-2xl">
                {asset(media.bannerAsset) && <div className="absolute inset-0"><Artwork image={media.bannerAsset} title="" className="h-full w-full opacity-30" /><div className="absolute inset-0 bg-gradient-to-t from-[--background] via-[--background]/60 to-transparent" /></div>}
                <div className="relative flex items-end gap-4 p-4 sm:p-6 pt-10">
                    <Artwork image={media.coverAsset} title={media.title} className="w-24 sm:w-32 aspect-[2/3] shrink-0 rounded-lg shadow-xl" />
                    <div className="min-w-0 pb-1"><h2 className="text-2xl sm:text-3xl font-bold leading-tight">{media.title}</h2>
                        <p className="mt-2 text-xs sm:text-sm text-[--muted]">{[media.year, media.format, media.duration ? `${media.duration} ${t("min", "Min.")}` : null, media.score ? `★ ${media.score / 10}` : null].filter(Boolean).join(" · ")}</p>
                        <p className="mt-2 flex items-center gap-1.5 text-xs text-green-300"><LuCheck />{selected.episodes.length} {selected.episodes.length === 1 ? t("episode saved", "Folge gespeichert") : t("episodes saved", "Folgen gespeichert")}</p>
                    </div>
                </div>
            </section>
            {media.genres?.length ? <div className="flex flex-wrap gap-2">{media.genres.slice(0, 5).map(genre => <span key={genre} className="rounded-full bg-white/5 px-3 py-1 text-xs text-[--muted]">{genre}</span>)}</div> : null}
            {plain(media.description) && <details className="text-sm text-[--muted]"><summary className="cursor-pointer font-medium text-white">{t("About this anime", "Über den Anime")}</summary><p className="mt-3 leading-relaxed">{plain(media.description)}</p></details>}
            <div className="flex justify-end"><Button size="sm" intent="gray-basic" onClick={() => setDeletingAnime([selected.key])}><LuTrash2 /> {t("Delete anime", "Anime löschen")}</Button></div>
            <section className="space-y-4"><div className="flex items-center justify-between"><h3 className="text-lg font-semibold">{t("Saved episodes", "Gespeicherte Folgen")}</h3><span className="text-xs text-[--muted]">{size(selected.episodes.reduce((sum, e) => sum + e.bytes, 0))}</span></div>
                {selected.episodes.map(episode => <article key={episode.id} className="overflow-hidden rounded-xl border border-white/5 bg-white/[0.03]" data-downloaded-episode>
                    <div className="flex gap-3 p-3">
                        <button disabled={!episode.ready} onClick={() => action(episode, "play")} aria-label={t(`Play episode ${episode.episode}`, `Folge ${episode.episode} abspielen`)} className="relative w-28 sm:w-40 aspect-video shrink-0 self-start overflow-hidden rounded-lg disabled:opacity-60">
                            <Artwork image={episode.episodeImageAsset || episode.bannerAsset} title={`${t("Episode", "Folge")} ${episode.episode}`} className="h-full w-full" />
                            {episode.ready && <span className="absolute inset-0 flex items-center justify-center bg-black/20"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/60"><LuPlay className="ml-0.5" /></span></span>}
                        </button>
                        <div className="min-w-0 flex-1"><p className="text-xs text-[--muted]">{t("Episode", "Folge")} {episode.episode}</p>
                            <h4 className="mt-1 text-sm font-semibold leading-snug line-clamp-2">{episode.episodeTitle || `${t("Episode", "Folge")} ${episode.episode}`}</h4>
                            <p className="mt-1.5 text-xs text-[--muted]">{[episode.duration ? `${episode.duration} ${t("min", "Min.")}` : null, size(episode.bytes)].filter(Boolean).join(" · ")}</p>
                            <p className={`mt-1.5 text-xs ${episode.ready ? "text-green-300" : episode.status === "failed" ? "text-red-300" : "text-[--muted]"}`}>{stateLabel(episode, t)}{episode.status === "downloading" ? ` · ${episode.progress}%` : ""}</p>
                        </div>
                    </div>
                    {!episode.ready && <div className="mx-3 h-1 rounded-full bg-white/10"><div className="h-full rounded-full bg-[--brand]" style={{ width: `${episode.progress}%` }} /></div>}
                    {plain(episode.episodeDescription) && <details className="px-3 pb-1 text-xs text-[--muted]"><summary className="cursor-pointer">{t("Episode description", "Folgenbeschreibung")}</summary><p className="py-2 leading-relaxed">{plain(episode.episodeDescription)}</p></details>}
                    <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                        <button disabled={episode.status === "removing"} onClick={() => action(episode, episode.ready ? "play" : ["paused", "failed"].includes(episode.status) ? "resume" : "pause")}
                            className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium bg-white/5 hover:bg-white/10 disabled:opacity-40">
                            {episode.ready ? <LuPlay /> : ["paused", "failed"].includes(episode.status) ? <LuRefreshCw /> : <LuPause />}
                            {episode.ready ? episode.position > 0 ? t(`Resume at ${clock(episode.position)}`, `Weiter bei ${clock(episode.position)}`) : t("Watch", "Ansehen") : ["paused", "failed"].includes(episode.status) ? t("Resume", "Fortsetzen") : t("Pause", "Pausieren")}
                        </button>
                        <button disabled={episode.status === "removing"} onClick={() => setDeleting(episode)} aria-label={t(`Delete episode ${episode.episode}`, `Folge ${episode.episode} löschen`)} className="flex h-10 w-10 items-center justify-center rounded-lg text-[--muted] hover:bg-white/5 hover:text-red-300"><LuTrash2 className="text-lg" /></button>
                    </div>
                </article>)}
            </section>
        </>}
        </>}
        <Modal title={t("Delete anime from phone?", "Anime vom Handy löschen?")} open={deletingAnime.length > 0} onOpenChange={open => { if (!open) setDeletingAnime([]) }}>
            <div className="space-y-5" data-anime-delete-dialog>
                <p className="text-sm text-[--muted]">{t("All saved episodes and pending downloads of the selected anime will be removed.", "Alle gespeicherten Folgen und ausstehenden Downloads der gewählten Anime werden entfernt.")}</p>
                <ul className="space-y-2 text-sm">{groups.filter(g => deletingAnime.includes(g.key)).map(g => <li key={g.key}>{g.episodes[0].title} · {g.episodes.length} {g.episodes.length === 1 ? t("episode", "Folge") : t("episodes", "Folgen")}</li>)}</ul>
                <div className="flex justify-end gap-2"><Button intent="gray-basic" onClick={() => setDeletingAnime([])}>{t("Cancel", "Abbrechen")}</Button><Button intent="alert" onClick={() => {
                    groups.filter(g => deletingAnime.includes(g.key)).forEach(g => g.episodes.forEach(e => action(e, "remove")))
                    setDeletingAnime([]); setSelectedAnime(new Set()); setSelecting(false)
                    if (selectedKey) router.push("/android-downloads")
                }}>{t("Delete anime", "Anime löschen")}</Button></div>
            </div>
        </Modal>
        <Modal title={t("Delete episode from phone?", "Folge vom Handy löschen?")} open={!!deleting} onOpenChange={open => { if (!open) setDeleting(null) }}>
            {deleting && <div data-download-delete-dialog className="space-y-5">
                <p className="text-sm text-[--muted]">{deleting.title} · {t("Episode", "Folge")} {deleting.episode}</p>
                <div className="flex justify-end gap-2"><Button intent="gray-basic" onClick={() => setDeleting(null)}>{t("Cancel", "Abbrechen")}</Button><Button intent="alert" onClick={() => { action(deleting, "remove"); setDeleting(null) }}>{t("Delete", "Löschen")}</Button></div>
            </div>}
        </Modal>
    </PageWrapper>
}
