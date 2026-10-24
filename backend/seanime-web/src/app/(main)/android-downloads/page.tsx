import { __manga_selectedChapterAtom } from "@/app/(main)/manga/_lib/handle-chapter-reader"
import { useAtomValue } from "jotai"
import { MangaDownloads } from "./manga-downloads"
import { TorrentDownloads } from "./torrent-downloads"
import { useAnimeListTorrentProviderExtensions } from "@/api/hooks/extensions.hooks"
import { PageWrapper } from "@/components/shared/page-wrapper"
import { Modal } from "@/components/ui/modal"
import { useRouter, useSearchParams } from "@/lib/navigation"
import { getAppLanguage, Translate, useTr } from "@/lib/app-language"
import React from "react"
import { LuArrowDownToLine, LuCheck, LuPause, LuPlay, LuRefreshCw, LuTrash2 } from "react-icons/lu"
import { DownloadsHeader } from "./downloads-header"
import { OFFLINE_CHANGED_EVENT } from "@/lib/android-offline"
import {
    animeKey, canResume, groupEpisodes, isActive, nextEpisode, offlineAsset, OfflineEpisode, offlinePollDelay, offlineStateLabel, showsProgress, STARTED_MS, startedEpisodes, watchedShare,
} from "./offline-library"
import "@/components/shared/mobile-surface.css"
import "@/app/(main)/entry/_components/mobile-anime.css"
import "./downloads-mobile.css"

// No-break space: a narrow card must not leave the unit alone on the next line ("1.4" / "GB")
const formatSize = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toLocaleString(getAppLanguage(), { maximumFractionDigits: 1 })} GB`
    : `${(bytes / 1024 ** 2).toLocaleString(getAppLanguage(), { maximumFractionDigits: 0 })} MB`
const clock = (position: number) => `${Math.floor(position / 60000).toString().padStart(2, "0")}:${Math.floor(position / 1000 % 60).toString().padStart(2, "0")}`
const plain = (value?: string) => (value || "").replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").trim()
const episodeWord = (count: number, t: Translate) => count === 1 ? t("episode", "Folge") : t("episodes", "Folgen")
const stateLabel = offlineStateLabel

function Artwork({ image, className = "" }: { image?: string, className?: string }) {
    const [failed, setFailed] = React.useState(false)
    React.useEffect(() => setFailed(false), [image])
    const src = offlineAsset(image)
    return <span className={`mdl-art ${className}`}>
        {src && !failed ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} /> : <LuArrowDownToLine aria-hidden />}
    </span>
}

/** Thin bar in the accent: download progress or how far an episode was watched. */
function ProgressLine({ value, label }: { value: number, label: string }) {
    return <span className="mdl-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)}>
        <span style={{ transform: `scaleX(${Math.min(100, Math.max(0, value)) / 100})` }} />
    </span>
}

export default function Page() {
    const t = useTr()
    const currentChapter = useAtomValue(__manga_selectedChapterAtom)
    const router = useRouter()
    const search = useSearchParams()
    const kind = search.get("kind") === "manga" ? "manga" : search.get("kind") === "torrents" ? "torrents" : "anime"
    // Torrents get a tab once the app can find them (a torrent provider is installed) or one is already there
    const { data: torrentProviders } = useAnimeListTorrentProviderExtensions()
    const showTorrents = kind === "torrents" || !!torrentProviders?.length
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
            // The manga list closes its own delete sheet; the reader handles back itself.
            if (event.defaultPrevented || (kind === "manga" && (currentChapter || document.querySelector("[data-manga-delete-dialog]")))) return
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
        if (!window.SeanimeOffline || !window.__seanimeOfflineToken) return false
        try {
            const value = JSON.parse(window.SeanimeOffline.snapshot(window.__seanimeOfflineToken))
            if (!Array.isArray(value)) throw new Error("Invalid library")
            const library = value as OfflineEpisode[]
            setEpisodes(previous => JSON.stringify(previous) === JSON.stringify(library) ? previous : library)
            setLoaded(true); setError(false)
        } catch { setError(true) }
        return true
    }, [])
    // Selection belongs to the anime overview; switching tab or opening an anime ends it.
    React.useEffect(() => { setSelecting(false); setSelectedAnime(new Set()) }, [kind, selectedKey])
    // Follow other parts of the app (a download started on an anime page, a deletion in the player).
    React.useEffect(() => {
        // On a cold start the bridge token can arrive after the first render; look again until it is there.
        let wait = 0
        const first = () => { if (!refresh() && wait < 40) { wait++; timer = window.setTimeout(first, 500) } }
        let timer = 0
        first()
        const visible = () => { if (document.visibilityState === "visible") refresh() }
        window.addEventListener("focus", refresh)
        window.addEventListener(OFFLINE_CHANGED_EVENT, refresh)
        document.addEventListener("visibilitychange", visible)
        return () => {
            clearTimeout(timer)
            window.removeEventListener("focus", refresh); window.removeEventListener(OFFLINE_CHANGED_EVENT, refresh)
            document.removeEventListener("visibilitychange", visible)
        }
    }, [refresh])
    // Poll only while a download is moving; an idle library costs nothing.
    const pollDelay = offlinePollDelay(episodes)
    React.useEffect(() => {
        if (pollDelay === null) return
        const timer = window.setInterval(refresh, pollDelay)
        return () => clearInterval(timer)
    }, [pollDelay, refresh])
    const followUp = React.useRef<number[]>([])
    React.useEffect(() => () => followUp.current.forEach(clearTimeout), [])
    const action = (episode: OfflineEpisode, value: string) => {
        if (window.__seanimeOfflineToken) window.SeanimeOffline?.action(window.__seanimeOfflineToken, episode.id, value)
        // The native state changes shortly after the call (a cold download service takes longer); look a few times so
        // polling picks it up. One set of checks per burst, so deleting a whole anime does not stack timers.
        if (value === "play") return
        followUp.current.forEach(clearTimeout)
        followUp.current = [200, 1200, 3000].map(delay => window.setTimeout(refresh, delay))
    }
    const groups = groupEpisodes(episodes)
    const selected = groups.find(group => group.key === selectedKey)
    const media = selected?.episodes.find(episode => episode.coverAsset) || selected?.episodes[0]
    const active = episodes.filter(isActive)
    const counts = { all: groups.length, ready: groups.filter(g => g.episodes.some(e => e.ready)).length, active: groups.filter(g => g.episodes.some(isActive)).length }
    const view = active.length ? filter : "all"
    // Once nothing is pending the chips disappear; do not jump back to "Active" when the next download starts.
    React.useEffect(() => { if (!active.length) setFilter("all") }, [active.length])
    // Anime deleted elsewhere drop out of the selection.
    const chosen = [...selectedAnime].filter(key => groups.some(group => group.key === key))
    const filtered = groups.filter(group => view === "all" || group.episodes.some(episode => view === "ready" ? episode.ready : isActive(episode)))
    const totalBytes = episodes.reduce((total, episode) => total + episode.bytes, 0)
    const toggle = (key: string) => setSelectedAnime(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next })
    const overview = !selectedKey && !selectedManga
    // Android's font size setting zooms text but not layout lengths; measure it so the cover grid can widen its cards.
    const root = React.useRef<HTMLDivElement>(null)
    React.useLayoutEffect(() => {
        const probe = document.createElement("span")
        probe.style.cssText = "position:absolute;visibility:hidden;font:16px/1 sans-serif"
        probe.textContent = "M"
        document.body.append(probe)
        const zoom = probe.getBoundingClientRect().height / 16
        probe.remove()
        if (zoom > 0) root.current?.style.setProperty("--mdl-text-zoom", zoom.toFixed(2))
    }, [])

    return <PageWrapper ref={root} className="mdl-page" data-downloads-page data-mobile-downloads="true">
        {overview && <>
            <DownloadsHeader backLabel={t("Back to Seanime", "Zurück zu Seanime")} onBack={() => router.push("/")} title="Downloads"
                facts={kind === "anime" && loaded ? `${groups.length} Anime · ${episodes.length} ${episodeWord(episodes.length, t)} · ${formatSize(totalBytes)}`
                    : kind === "torrents" ? t("Saved to your library folder", "In deinem Bibliotheksordner gespeichert") : t("Saved on your phone", "Auf deinem Handy gespeichert")} />
            <div className="mdl-tabs" role="tablist" aria-label={t("Download type", "Download-Typ")}>
                {[{ value: "anime", label: "Anime" }, { value: "manga", label: "Manga" }, ...(showTorrents ? [{ value: "torrents", label: "Torrents" }] : [])]
                    .map(tab => <button key={tab.value} type="button" role="tab" aria-selected={kind === tab.value} data-downloads-tab={tab.value}
                        onClick={() => router.push(tab.value === "anime" ? "/android-downloads" : `/android-downloads?kind=${tab.value}`)}>{tab.label}</button>)}
            </div>
        </>}
        {kind === "torrents" ? <TorrentDownloads /> : kind === "manga" ? <MangaDownloads selectedId={selectedManga} /> : <>
            {selectedKey && <DownloadsHeader backLabel={t("Back to anime overview", "Zurück zur Anime-Übersicht")} onBack={() => router.push("/android-downloads")} />}
            {error && <div role="alert" className="mdl-notice">{t("Downloads could not be loaded.", "Downloads konnten nicht geladen werden.")}
                <button type="button" onClick={refresh}>{t("Try again", "Erneut versuchen")}</button></div>}
            {!loaded && !error && <p className="mdl-loading">{t("Loading your downloads …", "Deine Downloads werden geladen …")}</p>}

            {overview && loaded && <>
                {active.length > 0 && <section className="mdl-section" aria-labelledby="mdl-active-title" data-active-downloads>
                    <div className="mdl-section-head"><h2 id="mdl-active-title">{t("Downloading", "Wird geladen")}</h2><span>{active.length}</span></div>
                    <ul className="mdl-rows">
                        {active.map(episode => <li key={episode.id} className="mdl-row">
                            <button type="button" className="mdl-row-main" onClick={() => router.push(`/android-downloads?anime=${encodeURIComponent(animeKey(episode))}`)}>
                                <Artwork image={episode.episodeImageAsset || episode.bannerAsset || episode.coverAsset} className="mdl-thumb" />
                                <span className="mdl-row-text">
                                    <span className="mdl-row-kicker">{episode.title}</span>
                                    <span className="mdl-row-title">{t("Episode", "Folge")} {episode.episode}</span>
                                    {showsProgress(episode) && <ProgressLine value={episode.progress} label={t(`Episode ${episode.episode} download`, `Download Folge ${episode.episode}`)} />}
                                    <span className="mdl-row-meta" data-state={episode.status}>{stateLabel(episode, t)}{showsProgress(episode) ? ` · ${Math.round(episode.progress)} %` : ""}</span>
                                </span>
                            </button>
                            <button type="button" className="mdl-icon-button" disabled={episode.status === "removing"} onClick={() => action(episode, canResume(episode) ? "resume" : "pause")}
                                aria-label={canResume(episode) ? t(`Resume episode ${episode.episode}`, `Folge ${episode.episode} fortsetzen`) : t(`Pause episode ${episode.episode}`, `Folge ${episode.episode} pausieren`)}>
                                {canResume(episode) ? <LuRefreshCw aria-hidden /> : <LuPause aria-hidden />}
                            </button>
                        </li>)}
                    </ul>
                </section>}

                {startedEpisodes(episodes).length > 0 && !selecting && <section className="mdl-section" aria-labelledby="mdl-continue-title">
                    <div className="mdl-section-head"><h2 id="mdl-continue-title">{t("Continue offline", "Offline weiterschauen")}</h2></div>
                    <div className="mdl-continue">
                        {startedEpisodes(episodes).map(episode => {
                            const share = watchedShare(episode)
                            return <button key={episode.id} type="button" className="mdl-continue-tile" onClick={() => action(episode, "play")}
                                aria-label={t(`${episode.title}: resume episode ${episode.episode} at ${clock(episode.position)}`, `${episode.title}: Folge ${episode.episode} bei ${clock(episode.position)} fortsetzen`)}>
                                <span className="mdl-continue-image">
                                    <Artwork image={episode.episodeImageAsset || episode.bannerAsset || episode.coverAsset} className="mdl-fill" />
                                    <span className="mdl-play" aria-hidden><LuPlay /></span>
                                    {share !== undefined && <ProgressLine value={share * 100} label={t("Watched", "Gesehen")} />}
                                </span>
                                <span className="mdl-continue-title">{episode.title}</span>
                                <span className="mdl-row-meta">{t("Episode", "Folge")} {episode.episode} · {t(`at ${clock(episode.position)}`, `bei ${clock(episode.position)}`)}</span>
                            </button>
                        })}
                    </div>
                </section>}

                <section className="mdl-section" aria-labelledby="mdl-library-title">
                    <div className="mdl-section-head">
                        <h2 id="mdl-library-title">{selecting ? t(`${chosen.length} anime selected`, `${chosen.length} Anime ausgewählt`) : t("Your anime", "Deine Anime")}</h2>
                        {groups.length > 0 && <button type="button" className="mdl-text-action" onClick={() => { setSelecting(!selecting); setSelectedAnime(new Set()) }}>
                            {selecting ? t("Cancel", "Abbrechen") : t("Select", "Auswählen")}</button>}
                    </div>
                    {selecting && <div className="mdl-selection" data-anime-selection>
                        <button type="button" onClick={() => setSelectedAnime(new Set(filtered.map(g => g.key)))}>{t("Select all", "Alle auswählen")}</button>
                        <button type="button" className="mdl-danger" disabled={!chosen.length} onClick={() => setDeletingAnime(chosen)}>
                            {t("Delete selected", "Ausgewählte löschen")} ({chosen.length})</button>
                    </div>}
                    {active.length > 0 && !selecting && <div className="mdl-chips" role="group" aria-label={t("Filter downloads", "Downloads filtern")}>
                        {([["all", t("All", "Alle")], ["ready", t("Ready", "Bereit")], ["active", t("Active", "Aktiv")]] as const).map(([name, label]) =>
                            <button key={name} type="button" onClick={() => setFilter(name)} aria-pressed={view === name}>{label}<span>{counts[name]}</span></button>)}
                    </div>}
                    {filtered.length > 0 ? <div className="mdl-grid">
                        {filtered.map(group => {
                            const item = group.episodes.find(episode => episode.coverAsset) || group.episodes[0]
                            const ready = group.episodes.filter(episode => episode.ready).length
                            const pending = group.episodes.length - ready
                            const picked = selectedAnime.has(group.key)
                            return <button key={group.key} type="button" className="mdl-card" data-downloaded-anime
                                onClick={() => selecting ? toggle(group.key) : router.push(`/android-downloads?anime=${encodeURIComponent(group.key)}`)}
                                aria-pressed={selecting ? picked : undefined}
                                aria-label={t(`${item.title} – open downloaded episodes`, `${item.title} – heruntergeladene Folgen öffnen`)}>
                                <span className="mdl-card-cover" data-picked={picked || undefined}>
                                    <Artwork image={item.coverAsset} className="mdl-fill" />
                                    {selecting && <span className="mdl-check" aria-hidden>{picked && <LuCheck />}</span>}
                                </span>
                                <span className="mdl-card-title">{item.title}</span>
                                <span className="mdl-row-meta">{[ready ? `${ready} ${episodeWord(ready, t)}` : null, formatSize(group.episodes.reduce((sum, e) => sum + e.bytes, 0))].filter(Boolean).join(" · ")}</span>
                                {pending > 0 && <span className="mdl-card-pending">{pending} {t("pending", "ausstehend")}</span>}
                            </button>
                        })}
                    </div> : <div className="mdl-empty">
                        <p>{episodes.length ? t("Nothing here right now", "Hier ist gerade alles erledigt") : t("Your offline library starts here", "Deine Offline-Bibliothek beginnt hier")}</p>
                        <p>{episodes.length ? t("Pick another filter to see your anime.", "Wähle einen anderen Filter, um deine Anime zu sehen.") : t("Download an episode on an anime page. Covers, info and episodes will show up here.", "Lade eine Folge auf einer Anime-Seite herunter. Cover, Infos und Folgen findest du anschließend hier.")}</p>
                    </div>}
                </section>
            </>}

            {selectedKey && loaded && !selected && <div className="mdl-empty">
                <p>{t("No downloads are stored for this anime anymore.", "Für diesen Anime sind keine Downloads mehr gespeichert.")}</p>
                <button type="button" className="mdl-secondary" onClick={() => router.push("/android-downloads")}>{t("Back to anime overview", "Zur Anime-Übersicht")}</button>
            </div>}
            {selected && media && <AnimeDetail episodes={selected.episodes} media={media} onAction={action} onDelete={setDeleting} onDeleteAll={() => setDeletingAnime([selected.key])} />}
        </>}
        <Modal title={t("Delete anime from phone?", "Anime vom Handy löschen?")} open={deletingAnime.length > 0} onOpenChange={open => { if (!open) setDeletingAnime([]) }}
            contentClass="mobile-anime-dialog mobile-download-sheet">
            <div className="mdl-confirm" data-anime-delete-dialog>
                <p>{t("All saved episodes and pending downloads of the selected anime will be removed.", "Alle gespeicherten Folgen und ausstehenden Downloads der gewählten Anime werden entfernt.")}</p>
                <ul>{groups.filter(g => deletingAnime.includes(g.key)).map(g => <li key={g.key}><span>{g.episodes[0].title}</span><span>{g.episodes.length} {episodeWord(g.episodes.length, t)} · {formatSize(g.episodes.reduce((s, e) => s + e.bytes, 0))}</span></li>)}</ul>
                <div className="mobile-cache-actions">
                    <button type="button" className="mobile-cache-clear" onClick={() => {
                        groups.filter(g => deletingAnime.includes(g.key)).forEach(g => g.episodes.forEach(e => action(e, "remove")))
                        setDeletingAnime([]); setSelectedAnime(new Set()); setSelecting(false)
                        if (selectedKey) router.push("/android-downloads")
                    }}>{t("Delete anime", "Anime löschen")}</button>
                    <button type="button" className="mobile-cache-cancel" onClick={() => setDeletingAnime([])}>{t("Cancel", "Abbrechen")}</button>
                </div>
            </div>
        </Modal>
        <Modal title={t("Delete episode from phone?", "Folge vom Handy löschen?")} open={!!deleting} onOpenChange={open => { if (!open) setDeleting(null) }}
            contentClass="mobile-anime-dialog mobile-download-sheet">
            {deleting && <div data-download-delete-dialog className="mdl-confirm">
                <p>{deleting.title} · {t("Episode", "Folge")} {deleting.episode} · {formatSize(deleting.bytes)}</p>
                <div className="mobile-cache-actions">
                    <button type="button" className="mobile-cache-clear" onClick={() => { action(deleting, "remove"); setDeleting(null) }}>{t("Delete", "Löschen")}</button>
                    <button type="button" className="mobile-cache-cancel" onClick={() => setDeleting(null)}>{t("Cancel", "Abbrechen")}</button>
                </div>
            </div>}
        </Modal>
    </PageWrapper>
}

function AnimeDetail({ episodes, media, onAction, onDelete, onDeleteAll }: {
    episodes: OfflineEpisode[], media: OfflineEpisode, onAction: (episode: OfflineEpisode, value: string) => void,
    onDelete: (episode: OfflineEpisode) => void, onDeleteAll: () => void,
}) {
    const t = useTr()
    const next = nextEpisode(episodes)
    const saved = episodes.filter(episode => episode.ready).length
    const facts = [media.year, media.format, media.duration ? `${media.duration} ${t("min", "Min.")}` : null, media.score ? `★ ${media.score / 10}` : null].filter(Boolean).join(" · ")
    return <>
        <section className="mdl-object">
            <div className="mdl-object-identity">
                <Artwork image={media.coverAsset} className="mdl-object-cover" />
                <div className="mdl-object-title">
                    <h1>{media.title}</h1>
                    {facts && <p>{facts}</p>}
                    {media.genres?.length ? <p>{media.genres.slice(0, 4).join(" · ")}</p> : null}
                </div>
            </div>
            <p className="mdl-object-facts">
                <span><LuCheck aria-hidden />{saved} {saved === 1 ? t("episode saved", "Folge gespeichert") : t("episodes saved", "Folgen gespeichert")}</span>
                <span>{formatSize(episodes.reduce((sum, e) => sum + e.bytes, 0))}</span>
            </p>
            {next && <button type="button" className="mobile-anime-episodes-link mdl-primary" onClick={() => onAction(next, "play")}>
                <LuPlay aria-hidden />
                {next.position >= STARTED_MS ? t(`Resume episode ${next.episode} at ${clock(next.position)}`, `Folge ${next.episode} bei ${clock(next.position)} fortsetzen`)
                    : t(`Watch episode ${next.episode}`, `Folge ${next.episode} ansehen`)}
            </button>}
            {plain(media.description) && <details className="mobile-anime-details"><summary>{t("About this anime", "Über den Anime")}</summary><p>{plain(media.description)}</p></details>}
        </section>
        <section className="mdl-section" aria-labelledby="mdl-episodes-title">
            <div className="mdl-section-head"><h2 id="mdl-episodes-title">{t("Saved episodes", "Gespeicherte Folgen")}</h2><span>{episodes.length}</span></div>
            <ul className="mdl-rows mdl-rows-plain">
                {episodes.map(episode => {
                    const share = watchedShare(episode)
                    const meta = episode.ready
                        ? [episode.position >= STARTED_MS ? t(`at ${clock(episode.position)}`, `bei ${clock(episode.position)}`) : null, episode.duration ? `${episode.duration} ${t("min", "Min.")}` : null, formatSize(episode.bytes)].filter(Boolean).join(" · ")
                        : `${stateLabel(episode, t)}${showsProgress(episode) ? ` · ${Math.round(episode.progress)} %` : ""}`
                    return <li key={episode.id} className="mdl-row" data-downloaded-episode data-ready={episode.ready}>
                        <button type="button" className="mdl-row-main" disabled={!episode.ready} onClick={() => onAction(episode, "play")}
                            aria-label={episode.ready ? t(`Play episode ${episode.episode}`, `Folge ${episode.episode} abspielen`) : `${t("Episode", "Folge")} ${episode.episode}`}>
                            <span className="mdl-thumb">
                                <Artwork image={episode.episodeImageAsset || episode.bannerAsset} className="mdl-fill" />
                                {episode.ready && <span className="mdl-play" aria-hidden><LuPlay /></span>}
                                {share !== undefined && episode.position >= STARTED_MS && <ProgressLine value={share * 100} label={t("Watched", "Gesehen")} />}
                            </span>
                            <span className="mdl-row-text">
                                <span className="mdl-row-kicker">{t("Episode", "Folge")} {episode.episode}</span>
                                <span className="mdl-row-title">{episode.episodeTitle || `${t("Episode", "Folge")} ${episode.episode}`}</span>
                                {showsProgress(episode) && <ProgressLine value={episode.progress} label={t(`Episode ${episode.episode} download`, `Download Folge ${episode.episode}`)} />}
                                <span className="mdl-row-meta" data-state={episode.status}>{meta}</span>
                            </span>
                        </button>
                        {!episode.ready && <button type="button" className="mdl-icon-button" disabled={episode.status === "removing"} onClick={() => onAction(episode, canResume(episode) ? "resume" : "pause")}
                            aria-label={canResume(episode) ? t(`Resume episode ${episode.episode}`, `Folge ${episode.episode} fortsetzen`) : t(`Pause episode ${episode.episode}`, `Folge ${episode.episode} pausieren`)}>
                            {canResume(episode) ? <LuRefreshCw aria-hidden /> : <LuPause aria-hidden />}
                        </button>}
                        <button type="button" className="mdl-icon-button" disabled={episode.status === "removing"} onClick={() => onDelete(episode)}
                            aria-label={t(`Delete episode ${episode.episode}`, `Folge ${episode.episode} löschen`)}><LuTrash2 aria-hidden /></button>
                    </li>
                })}
            </ul>
            <button type="button" className="mdl-text-action mdl-danger mdl-delete-all" onClick={onDeleteAll}><LuTrash2 aria-hidden />{t("Delete anime", "Anime löschen")}</button>
        </section>
    </>
}
