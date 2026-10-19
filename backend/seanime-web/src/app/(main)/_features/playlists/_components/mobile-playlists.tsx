import type { Anime_LibraryCollection, Anime_LibraryCollectionEntry, Anime_Playlist, Anime_PlaylistEpisode, Anime_WatchType } from "@/api/generated/types"
import { useCreatePlaylist, useDeletePlaylist, useGetPlaylistEpisodes, useGetPlaylists, useUpdatePlaylist } from "@/api/hooks/playlist.hooks"
import { usePlaylistManager } from "../_containers/global-playlist-manager"
import { usePlaylistEditorManager } from "../lib/playlist-editor-manager"
import { createPlaylistMutationGate, MAX_PLAYLIST_EPISODES, movePlaylistEpisode, samePlaylistEpisode, selectPlaylistEpisodes, togglePlaylistEpisode } from "../lib/mobile-playlist-state"
import { useHasDebridService, useHasOnlineStreaming, useHasTorrentStreaming } from "@/app/(main)/_hooks/use-server-status"
import { MobileWorkspace } from "@/components/shared/mobile-workspace"
import { Button } from "@/components/ui/button"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { useTr } from "@/lib/app-language"
import React from "react"
import { BiCheck, BiChevronDown, BiChevronUp, BiEditAlt, BiPlay, BiPlus, BiTrash } from "react-icons/bi"
import { toast } from "sonner"
import "./mobile-playlists.css"

type Step = "list" | "editor" | "anime" | "episodes" | "delete"
type Draft = { dbId?: number, name: string, episodes: Anime_PlaylistEpisode[] }

export function MobilePlaylists({ libraryCollection, libraryLoading }: { libraryCollection?: Anime_LibraryCollection, libraryLoading: boolean }) {
    const tr = useTr()
    const manager = usePlaylistEditorManager()
    const { data: playlists, isLoading, isError, refetch } = useGetPlaylists()
    const create = useCreatePlaylist()
    const update = useUpdatePlaylist()
    const remove = useDeletePlaylist()
    const { startPlaylist } = usePlaylistManager()
    const [step, setStep] = React.useState<Step>("list")
    const [draft, setDraft] = React.useState<Draft>({ name: "", episodes: [] })
    const [category, setCategory] = React.useState("CURRENT")
    const [search, setSearch] = React.useState("")
    const [media, setMedia] = React.useState<Anime_LibraryCollectionEntry | null>(null)
    const [error, setError] = React.useState("")
    const [busy, setBusy] = React.useState(false)
    const gate = React.useRef(createPlaylistMutationGate())
    const { hasTorrentStreaming } = useHasTorrentStreaming()
    const { hasDebridService } = useHasDebridService()
    const { hasOnlineStreaming } = useHasOnlineStreaming()
    const options = [
        ...(hasTorrentStreaming ? [{ value: "torrent", label: tr("Torrent streaming", "Torrent-Streaming") }] : []),
        ...(hasDebridService ? [{ value: "debrid", label: tr("Debrid streaming", "Debrid-Streaming") }] : []),
        ...(hasOnlineStreaming ? [{ value: "online", label: tr("Online streaming", "Online-Streaming") }] : []),
    ]
    const defaultWatchType = (hasTorrentStreaming ? "torrent" : hasDebridService ? "debrid" : "") as Anime_WatchType
    const entries = React.useMemo(() => {
        const seen = new Set<number>()
        return libraryCollection?.lists?.filter(n => ["CURRENT", "PLANNING", "PAUSED"].includes(n.type ?? "")
            && (search.trim() || category === "-" || n.type === category)).flatMap(n => n.entries ?? [])
            .filter((n): n is Anime_LibraryCollectionEntry => {
                if (!n || seen.has(n.mediaId)) return false
                const needle = search.trim().toLowerCase()
                if (needle && !Object.values(n.media?.title ?? {}).some(title => title?.toLowerCase().includes(needle))) return false
                seen.add(n.mediaId)
                return true
            }) ?? []
    }, [libraryCollection, category, search])

    React.useEffect(() => {
        if (!manager.isModalOpen) { setStep("list"); setMedia(null); setError(""); setSearch("") }
    }, [manager.isModalOpen])

    function close(open: boolean) {
        if (busy) return
        manager.setModalOpen(open)
        if (!open) { manager.setSelectedMedia(null); manager.setEpisodeToAdd(null) }
    }
    function openEditor(playlist?: Anime_Playlist) {
        setDraft({ dbId: playlist?.dbId, name: playlist?.name ?? "", episodes: (playlist?.episodes ?? []).map(n => ({ ...n, watchType: n.watchType || defaultWatchType })) })
        setError("")
        const entry = libraryCollection?.lists?.flatMap(n => n.entries ?? []).find(n => n?.mediaId === manager.selectedMedia)
        setMedia(entry ?? null)
        setStep(entry ? "episodes" : "editor")
    }
    function back() {
        if (busy) return
        setError("")
        if (step === "episodes") setStep("anime")
        else if (step === "anime" || step === "delete") setStep("editor")
        else if (step === "editor") setStep("list")
        else close(false)
    }
    async function persist(deleting = false) {
        if (!deleting && (!draft.name.trim() || !draft.episodes.length)) {
            setError(tr("Enter a name and select at least one episode.", "Name eingeben und mindestens eine Episode auswählen.")); return
        }
        try {
            await gate.current(async () => {
                setBusy(true); setError("")
                try {
                    if (deleting && draft.dbId !== undefined) await remove.mutateAsync({ dbId: draft.dbId })
                    else {
                        const values = { name: draft.name, episodes: draft.episodes.map(e => ({ ...e, isNakama: e.episode?._isNakamaEpisode ?? false })) }
                        if (draft.dbId !== undefined) await update.mutateAsync({ ...values, dbId: draft.dbId })
                        else await create.mutateAsync(values)
                    }
                    setStep("list")
                    manager.setSelectedMedia(null); manager.setEpisodeToAdd(null)
                } finally { setBusy(false) }
            })
        } catch { setError(tr("Could not save the change. Your draft is still here. Try again.", "Änderung konnte nicht gespeichert werden. Dein Entwurf bleibt erhalten. Erneut versuchen.")) }
    }
    const title = step === "list" ? tr("Playlists", "Playlists") : step === "anime" ? tr("Add episodes", "Episoden hinzufügen")
        : step === "episodes" ? tr("Select episodes", "Episoden auswählen") : step === "delete" ? tr("Delete playlist?", "Playlist löschen?")
            : draft.dbId !== undefined ? tr("Edit playlist", "Playlist bearbeiten") : tr("New playlist", "Neue Playlist")
    return <MobileWorkspace open={manager.isModalOpen} onOpenChange={close} title={title}
        onBack={step === "list" ? undefined : back}
        subtitle={step === "episodes" ? (media?.media?.title?.userPreferred || media?.media?.title?.romaji) : step !== "list" ? `${draft.episodes.length} / ${MAX_PLAYLIST_EPISODES} ${tr("episodes", "Episoden")}` : undefined}
        className="mobile-playlists"
        footer={step === "list" ? <Button className="w-full min-h-12" onClick={() => openEditor()} disabled={libraryLoading}>{manager.selectedMedia ? tr("Add to new playlist", "Zu neuer Playlist hinzufügen") : tr("Create playlist", "Playlist erstellen")}</Button>
            : step === "editor" ? <Button className="w-full min-h-12" disabled={busy || !draft.name.trim() || !draft.episodes.length} loading={busy} onClick={() => persist()}>{tr("Save playlist", "Playlist speichern")}</Button>
                : step === "episodes" || step === "anime" ? <Button className="w-full min-h-12" onClick={() => setStep("editor")}>{tr("Review selection", "Auswahl übernehmen")} · {draft.episodes.length}</Button>
                    : <div className="grid grid-cols-2 gap-2"><Button intent="gray-subtle" onClick={back} disabled={busy}>{tr("Cancel", "Abbrechen")}</Button><Button intent="alert" loading={busy} disabled={busy} onClick={() => persist(true)}>{tr("Delete", "Löschen")}</Button></div>}>
        {error && <p role="alert" className="mp-error">{error}</p>}
        {step === "list" && <div className="mp-list">
            {isLoading && <LoadingSpinner />}
            {isError && <div role="alert"><p>{tr("Could not load playlists.", "Playlists konnten nicht geladen werden.")}</p><Button onClick={() => refetch()}>{tr("Retry", "Erneut versuchen")}</Button></div>}
            {!isLoading && !isError && !playlists?.length && <div className="mp-empty"><BiPlay aria-hidden="true" /><strong>{tr("No playlists yet", "Noch keine Playlists")}</strong><p>{tr("Combine episodes from your anime into a playlist.", "Stelle Episoden deiner Anime zu einer Playlist zusammen.")}</p></div>}
            {playlists?.map(playlist => <article className="mp-card" key={playlist.dbId}>
                <Thumbnail src={playlist.episodes?.[0]?.episode?.baseAnime?.coverImage?.large} />
                <div className="mp-copy"><strong>{playlist.name}</strong><small>{playlist.episodes?.length ?? 0} {tr("episodes", "Episoden")}</small></div>
                <div className="mp-actions"><button aria-label={`${manager.selectedMedia ? tr("Add to", "Hinzufügen zu") : tr("Edit", "Bearbeiten")}: ${playlist.name}`} onClick={() => openEditor(playlist)}>{manager.selectedMedia ? <BiPlus /> : <BiEditAlt />}</button>
                    {!manager.selectedMedia && <button aria-label={`${tr("Play", "Abspielen")}: ${playlist.name}`} disabled={!playlist.episodes?.length} onClick={() => { startPlaylist(playlist); close(false) }}><BiPlay /></button>}</div>
            </article>)}
        </div>}
        {step === "editor" && <div className="mp-list">
            <label className="mp-field">{tr("Name", "Name")}<input value={draft.name} onChange={e => setDraft(prev => ({ ...prev, name: e.target.value }))} autoComplete="off" /></label>
            <Button intent="gray-subtle" leftIcon={<BiPlus />} disabled={draft.episodes.length >= MAX_PLAYLIST_EPISODES} onClick={() => setStep("anime")}>{tr("Add episodes", "Episoden hinzufügen")}</Button>
            {!draft.episodes.length && <p className="mp-hint">{tr("Select anime, then choose episodes. Saving is the final step.", "Wähle Anime und danach Episoden. Erst Speichern übernimmt den Entwurf.")}</p>}
            <ol className="mp-list">{draft.episodes.map((ep, i) => <li key={`${ep.episode?.baseAnime?.id}-${ep.episode?.aniDBEpisode}-${i}`} className="mp-episode-edit">
                <div className="mp-card"><span className="mp-number">{i + 1}</span><div className="mp-copy"><small>{ep.episode?.baseAnime?.title?.userPreferred || ep.episode?.baseAnime?.title?.romaji}</small><strong>{episodeLabel(ep, tr)}{ep.isCompleted ? ` · ${tr("Watched", "Gesehen")}` : ""}</strong>{ep.episode?.localFile && <small>{ep.episode.localFile.name}</small>}</div></div>
                <div className="mp-edit-tools"><div className="mp-actions"><button disabled={i === 0} aria-label={tr("Move episode up", "Episode nach oben")} onClick={() => setDraft(prev => ({ ...prev, episodes: movePlaylistEpisode(prev.episodes, i, -1) }))}><BiChevronUp /></button><button disabled={i === draft.episodes.length - 1} aria-label={tr("Move episode down", "Episode nach unten")} onClick={() => setDraft(prev => ({ ...prev, episodes: movePlaylistEpisode(prev.episodes, i, 1) }))}><BiChevronDown /></button><button aria-label={tr("Remove episode", "Episode entfernen")} onClick={() => setDraft(prev => ({ ...prev, episodes: prev.episodes.filter((_, index) => index !== i) }))}><BiTrash /></button></div>
                {!ep.episode?.localFile && !ep.isNakama && !!options.length && <label className="mp-field mp-source"><span className="sr-only">{tr("Playback source", "Wiedergabequelle")}</span><select value={ep.watchType || defaultWatchType} onChange={e => { const value = e.target.value as Anime_WatchType; setDraft(prev => ({ ...prev, episodes: prev.episodes.map((n, index) => index === i ? { ...n, watchType: value } : n) })) }}><option value="">{tr("Choose source", "Quelle wählen")}</option>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>}</div>
            </li>)}</ol>
            {draft.dbId !== undefined && <Button intent="alert-subtle" disabled={busy} onClick={() => setStep("delete")}>{tr("Delete playlist", "Playlist löschen")}</Button>}
            <Button intent="gray-link" onClick={back}>{tr("Discard draft", "Entwurf verwerfen")}</Button>
        </div>}
        {step === "anime" && <div className="mp-list">
            <label className="mp-field"><span className="sr-only">{tr("Search anime", "Anime suchen")}</span><input type="search" placeholder={tr("Search anime…", "Anime suchen…")} value={search} onChange={e => setSearch(e.target.value)} /></label>
            <label className="mp-field"><span className="sr-only">{tr("Collection", "Sammlung")}</span><select value={category} disabled={!!search.trim()} onChange={e => setCategory(e.target.value)}><option value="CURRENT">{tr("Current", "Aktuell")}</option><option value="PAUSED">{tr("Paused", "Pausiert")}</option><option value="PLANNING">{tr("Planning", "Geplant")}</option><option value="-">{tr("All", "Alle")}</option></select></label>
            {libraryLoading && <LoadingSpinner />}
            {!libraryLoading && !entries.length && <p className="mp-hint">{tr("No anime found in this collection.", "Keine Anime in dieser Sammlung gefunden.")}</p>}
            {entries.map(entry => <button className="mp-card mp-anime" key={entry.mediaId} onClick={() => { setMedia(entry); setStep("episodes") }}><Thumbnail src={entry.media?.coverImage?.large} /><span className="mp-copy"><strong>{entry.media?.title?.userPreferred || entry.media?.title?.romaji}</strong><small>{draft.episodes.filter(n => n.episode?.baseAnime?.id === entry.mediaId).length} {tr("selected", "ausgewählt")}{entry.libraryData ? ` · ${tr("Local", "Lokal")}` : ""}</small></span><BiPlus aria-hidden="true" /></button>)}
        </div>}
        {step === "episodes" && media && <MobileEpisodeSelection entry={media} episodes={draft.episodes} onChange={episodes => setDraft(prev => ({ ...prev, episodes }))} defaultWatchType={defaultWatchType} />}
        {step === "delete" && <div className="mp-empty"><BiTrash aria-hidden="true" /><strong>{draft.name}</strong><p>{tr("This deletes this playlist. Your anime and episode files are kept.", "Diese Playlist wird gelöscht. Deine Anime und Episodendateien bleiben erhalten.")}</p></div>}
    </MobileWorkspace>
}

function Thumbnail({ src }: { src?: string }) {
    const [failed, setFailed] = React.useState(false)
    React.useEffect(() => setFailed(false), [src])
    return <span className="mp-thumbnail">{src && !failed ? <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} /> : <BiPlay aria-hidden="true" />}</span>
}

function episodeLabel(ep: Anime_PlaylistEpisode, tr: (en: string, de: string) => string) {
    return ep.episode?.baseAnime?.format === "MOVIE" ? tr("Movie", "Film") : `${tr("Episode", "Episode")} ${ep.episode?.episodeNumber ?? "?"}`
}

function MobileEpisodeSelection({ entry, episodes, onChange, defaultWatchType }: { entry: Anime_LibraryCollectionEntry, episodes: Anime_PlaylistEpisode[], onChange: (episodes: Anime_PlaylistEpisode[]) => void, defaultWatchType: Anime_WatchType }) {
    const tr = useTr()
    const { data, isLoading, isError, refetch } = useGetPlaylistEpisodes(entry.mediaId)
    const { episodeToAdd, selectedMedia, setEpisodeToAdd } = usePlaylistEditorManager()
    const available = React.useMemo(() => (data ?? []).filter(n => !!n.episode).sort((a, b) => a.episode!.progressNumber - b.episode!.progressNumber).map(n => ({ ...n, watchType: n.watchType || defaultWatchType })), [data, defaultWatchType])
    React.useEffect(() => {
        if (!data || !episodeToAdd || selectedMedia !== entry.mediaId) return
        const found = available.find(n => n.episode?.aniDBEpisode === episodeToAdd)
        if (found && !episodes.some(n => samePlaylistEpisode(n, found))) onChange(togglePlaylistEpisode(episodes, found))
        setEpisodeToAdd(null)
    }, [data, episodeToAdd, selectedMedia, entry.mediaId, available, episodes])
    const allSelected = available.length > 0 && available.every(ep => episodes.some(n => samePlaylistEpisode(n, ep)))
    const selected = available.filter(ep => episodes.some(n => samePlaylistEpisode(n, ep))).length
    const limit = () => toast.error(tr(`A playlist can contain up to ${MAX_PLAYLIST_EPISODES} episodes.`, `Eine Playlist kann höchstens ${MAX_PLAYLIST_EPISODES} Episoden enthalten.`))
    return <div className="mp-list">
        <div className="mp-selection"><strong aria-live="polite">{selected} / {available.length} {tr("selected", "ausgewählt")}</strong><Button intent="gray-subtle" disabled={!available.length} onClick={() => { if (!allSelected && available.length - selected > MAX_PLAYLIST_EPISODES - episodes.length) limit(); onChange(selectPlaylistEpisodes(episodes, available)) }}>{allSelected ? tr("Deselect all", "Alle abwählen") : tr("Select all", "Alle auswählen")}</Button></div>
        {isLoading && <LoadingSpinner />}
        {isError && <div role="alert"><p>{tr("Could not load episodes.", "Episoden konnten nicht geladen werden.")}</p><Button onClick={() => refetch()}>{tr("Retry", "Erneut versuchen")}</Button></div>}
        {!isLoading && !isError && !available.length && <p className="mp-hint">{tr("No episodes found.", "Keine Episoden gefunden.")}</p>}
        {available.map((ep, i) => { const checked = episodes.some(n => samePlaylistEpisode(n, ep)); return <button type="button" aria-pressed={checked} key={`${ep.episode?.aniDBEpisode}-${i}`} className={`mp-card mp-episode-choice ${checked ? "is-selected" : ""}`} onClick={() => { if (!checked && episodes.length >= MAX_PLAYLIST_EPISODES) { limit(); return }; onChange(togglePlaylistEpisode(episodes, ep)) }}><span className="mp-check" aria-hidden="true">{checked && <BiCheck />}</span><span className="mp-copy"><strong>{episodeLabel(ep, tr)}</strong>{ep.episode?.localFile && <small>{ep.episode.localFile.name}</small>}</span></button> })}
    </div>
}
