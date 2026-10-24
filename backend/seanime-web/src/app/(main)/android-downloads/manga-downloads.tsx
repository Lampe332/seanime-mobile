import { useSeaQuery } from "@/api/client/requests"
import { AL_BaseManga, Manga_ChapterContainer, Manga_DownloadListItem, Manga_Entry, Models_ChapterDownloadQueueItem } from "@/api/generated/types"
import { ChapterReaderDrawer } from "@/app/(main)/manga/_containers/chapter-reader/chapter-reader-drawer"
import { __manga_selectedChapterAtom } from "@/app/(main)/manga/_lib/handle-chapter-reader"
import { useHandleMangaDownloadData } from "@/app/(main)/manga/_lib/handle-manga-downloads"
import { useRouter } from "@/lib/navigation"
import { useTr } from "@/lib/app-language"
import { Modal } from "@/components/ui/modal"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { useQueryClient } from "@tanstack/react-query"
import { useSetAtom } from "jotai"
import React from "react"
import { LuBookOpen, LuPause, LuPlay, LuRefreshCw, LuTrash2 } from "react-icons/lu"
import { toast } from "sonner"
import { DownloadsHeader } from "./downloads-header"
import { mangaNextDelay, offlineAsset } from "./offline-library"

type Group = { mediaId: number, media?: AL_BaseManga, queued: Models_ChapterDownloadQueueItem[], downloads: Manga_DownloadListItem["downloadData"] }
type Art = { coverAsset?: string, bannerAsset?: string }
const title = (media?: AL_BaseManga) => media?.title?.userPreferred || media?.title?.english || media?.title?.romaji
const clean = (text?: string) => (text || "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").trim()
const chapterKey = (provider: string, id: string) => `${provider}:${id}`
const chapterWord = (count: number) => count === 1 ? "chapter" : "chapters"

export function MangaDownloads({ selectedId }: { selectedId: number }) {
    const t = useTr()
    const router = useRouter()
    const { seaFetch } = useSeaQuery()
    const api = React.useRef(seaFetch); api.current = seaFetch
    const queryClient = useQueryClient()
    const [groups, setGroups] = React.useState<Group[]>([])
    const [art, setArt] = React.useState<Record<number, Art>>({})
    const [loaded, setLoaded] = React.useState(false)
    const [error, setError] = React.useState(false)
    const [busy, setBusy] = React.useState(false)
    const [containers, setContainers] = React.useState<Manga_ChapterContainer[]>([])
    const [reader, setReader] = React.useState<Manga_ChapterContainer>()
    const [deleting, setDeleting] = React.useState<{ provider: string, chapterId: string, chapterNumber: string }>()
    const setChapter = useSetAtom(__manga_selectedChapterAtom)
    useHandleMangaDownloadData(selectedId || undefined)
    const metadata = React.useRef<Record<number, AL_BaseManga>>((() => {
        try { return JSON.parse(localStorage.getItem("android-offline-manga-metadata") || "{}") as Record<number, AL_BaseManga> } catch { return {} }
    })())
    const attempts = React.useRef<Record<number, number>>({})
    const kick = React.useRef<() => void>(() => {})
    React.useEffect(() => { setReader(undefined); setContainers([]); setDeleting(undefined) }, [selectedId])
    // Android back closes the delete sheet; the page skips its own back step while [data-manga-delete-dialog] is open.
    React.useEffect(() => {
        if (!deleting) return
        const back = (event: Event) => { event.preventDefault(); setDeleting(undefined) }
        window.addEventListener("seanime:android-back", back)
        return () => window.removeEventListener("seanime:android-back", back)
    }, [deleting])
    React.useEffect(() => {
        let alive = true, inFlight = false, again = false, hadQueue = false, signature = "", timer = 0
        // One self-scheduling loop: quick while a chapter loads, slow while chapters wait, idle when the queue is empty.
        const schedule = (delay: number | null) => { clearTimeout(timer); if (alive && delay !== null) timer = window.setTimeout(refresh, delay) }
        async function refresh() {
            // A refresh asked for while one runs (after a delete or a queue change) runs right after it.
            if (inFlight) { again = true; return }
            inFlight = true
            let delay: number | null = null
            try {
                const [downloads = [], queue = []] = await Promise.all([
                    api.current<Manga_DownloadListItem[]>("/api/v1/manga/downloads", "GET"),
                    api.current<Models_ChapterDownloadQueueItem[]>("/api/v1/manga/download-queue", "GET", undefined, { summary: true }),
                ])
                delay = mangaNextDelay(queue, hadQueue); hadQueue = queue.length > 0
                const map = new Map<number, Group>()
                downloads.forEach(item => map.set(item.mediaId, { mediaId: item.mediaId, media: item.media, downloads: item.downloadData, queued: [] }))
                queue.forEach(item => {
                    const group = map.get(item.mediaId) || { mediaId: item.mediaId, downloads: {}, queued: [] }
                    group.queued.push(item); map.set(item.mediaId, group)
                })
                const assets: Record<number, Art> = {}
                for (const group of map.values()) {
                    if (!group.media && !metadata.current[group.mediaId] && Date.now() - (attempts.current[group.mediaId] || 0) > 60000) {
                        attempts.current[group.mediaId] = Date.now()
                        try { const entry = await api.current<Manga_Entry>(`/api/v1/manga/entry/${group.mediaId}`, "GET"); group.media = entry?.media } catch { /* Keep queue visible even if metadata is unavailable. */ }
                    }
                    group.media = group.media || metadata.current[group.mediaId]
                    if (group.media) metadata.current[group.mediaId] = group.media
                    const token = window.__seanimeOfflineToken
                    if (token && window.SeanimeOffline?.cacheManga) {
                        try {
                            assets[group.mediaId] = JSON.parse(window.SeanimeOffline.cacheManga(token, JSON.stringify({
                                mediaId: group.mediaId, title: title(group.media), description: group.media?.description,
                                genres: group.media?.genres, format: group.media?.format,
                                coverUrl: group.media?.coverImage?.extraLarge || group.media?.coverImage?.large,
                                bannerUrl: group.media?.bannerImage,
                            }))) as Art
                        } catch { /* Artwork is optional; chapters remain available. */ }
                    }
                }
                try { localStorage.setItem("android-offline-manga-metadata", JSON.stringify(metadata.current)) } catch { /* Storage quota does not block reading. */ }
                if (!alive) return
                setGroups([...map.values()].sort((a, b) => (title(a.media) || "").localeCompare(title(b.media) || "")))
                setArt(previous => JSON.stringify(previous) === JSON.stringify(assets) ? previous : assets)
                setLoaded(true); setError(false)
                const nextSignature = JSON.stringify([downloads.map(d => [d.mediaId, d.downloadData]), queue.map(q => [q.mediaId, q.chapterId, q.status])])
                if (selectedId && nextSignature !== signature) {
                    const result = await api.current<Manga_ChapterContainer[]>(`/api/v1/manga/downloaded-chapters/${selectedId}`, "GET")
                    const pending = new Set(queue.filter(q => q.mediaId === selectedId).map(q => chapterKey(q.provider, q.chapterId)))
                    if (alive) setContainers((result || []).map(c => ({ ...c, chapters: c.chapters?.filter(ch => !pending.has(chapterKey(c.provider, ch.id))) })))
                    await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.MANGA_DOWNLOAD.GetMangaDownloadData.key] })
                    signature = nextSignature
                }
            } catch { if (alive) { setError(true); delay = 5000 } }
            finally { inFlight = false; if (again && alive) { again = false; void refresh() } else schedule(delay) }
        }
        kick.current = () => { void refresh() }
        const visible = () => { if (document.visibilityState === "visible") void refresh() }
        void refresh()
        window.addEventListener("focus", visible)
        document.addEventListener("visibilitychange", visible)
        return () => {
            alive = false; clearTimeout(timer); kick.current = () => {}
            window.removeEventListener("focus", visible); document.removeEventListener("visibilitychange", visible)
        }
    }, [selectedId])
    const selected = groups.find(g => g.mediaId === selectedId)
    const queue = groups.flatMap(g => g.queued)
    const loading = queue.filter(q => q.status === "downloading").length
    const run = async (action: "start" | "stop" | "retry") => {
        setBusy(true)
        try {
            if (action === "retry") await api.current("/api/v1/manga/download-queue/reset-errored", "POST")
            await api.current(`/api/v1/manga/download-queue/${action === "stop" ? "stop" : "start"}`, "POST")
            toast.success(action === "stop" ? t("Manga queue paused", "Manga-Warteschlange pausiert") : t("Manga downloads started", "Manga-Downloads gestartet"))
        } catch { toast.error(t("Queue could not be changed", "Warteschlange konnte nicht geändert werden")) }
        finally { setBusy(false); kick.current() }
    }
    const readyChapters = (group: Group) => Object.entries(group.downloads).flatMap(([provider, chapters]) => chapters
        .filter(ch => !group.queued.some(q => q.provider === provider && q.chapterId === ch.chapterId)).map(ch => ({ ...ch, provider })))
    const numbers = new Map<string, number>()
    containers.forEach(c => c.chapters?.forEach(ch => numbers.set(ch.id, Number(ch.chapter))))
    const open = (provider: string, chapterId: string) => {
        const container = containers.find(c => c.provider === provider && c.chapters?.some(ch => ch.id === chapterId))
        const chapter = container?.chapters?.find(ch => ch.id === chapterId)
        if (!container || !chapter) { toast.info(t("Chapter is being prepared. Please open it again in a moment.", "Kapitel wird vorbereitet. Bitte gleich erneut öffnen.")); return }
        setReader(container)
        React.startTransition(() => setChapter({ mediaId: selectedId, provider, chapterId, chapterNumber: chapter.chapter }))
    }
    const totalReady = groups.reduce((n, g) => n + readyChapters(g).length, 0)
    const stateText = (status: string) => status === "ready" ? t("Available offline", "Offline verfügbar") : status === "downloading" ? t("Downloading …", "Wird heruntergeladen …")
        : status === "errored" ? t("Failed · try again", "Fehlgeschlagen · erneut versuchen") : t("Waiting to download", "Wartet auf Download")

    const queueBlock = queue.length > 0 && <section className="mdl-section" aria-labelledby="mdl-queue-title" data-manga-queue>
        <div className="mdl-section-head"><h2 id="mdl-queue-title">{t("Queue", "Warteschlange")}</h2>
            <span>{t(`${queue.length} ${chapterWord(queue.length)} · ${loading} loading`, `${queue.length} Kapitel · ${loading} werden geladen`)}</span></div>
        <div className="mdl-queue-actions">
            <button type="button" disabled={busy} onClick={() => run("start")}><LuPlay aria-hidden />{t("Start / resume", "Starten / Fortsetzen")}</button>
            <button type="button" disabled={busy} onClick={() => run("stop")}><LuPause aria-hidden />{t("Pause", "Pausieren")}</button>
            {queue.some(q => q.status === "errored") && <button type="button" disabled={busy} onClick={() => run("retry")}><LuRefreshCw aria-hidden />{t("Try again", "Erneut versuchen")}</button>}
        </div>
    </section>

    return <div className="mdl-manga" data-manga-downloads>
        {selectedId > 0 && <DownloadsHeader backLabel={t("Back to manga overview", "Zurück zur Manga-Übersicht")} onBack={() => router.push("/android-downloads?kind=manga")} />}
        {error && <p role="alert" className="mdl-notice">{t("Manga downloads could not be loaded. Retrying …", "Manga-Downloads konnten nicht geladen werden. Erneuter Versuch läuft …")}</p>}
        {!loaded && !error && <p className="mdl-loading">{t("Loading your manga …", "Deine Manga werden geladen …")}</p>}
        {!selected && queueBlock}
        {!selectedId && loaded && <section className="mdl-section" aria-labelledby="mdl-manga-title">
            <div className="mdl-section-head"><h2 id="mdl-manga-title">{t("Your manga", "Deine Manga")}</h2>
                <span>{groups.length} Manga · {totalReady} {t(`${chapterWord(totalReady)} offline`, "Kapitel offline")}</span></div>
            {groups.length > 0 ? <div className="mdl-grid">
                {groups.map(group => {
                    const ready = readyChapters(group).length
                    return <button key={group.mediaId} type="button" data-downloaded-manga className="mdl-card" onClick={() => router.push(`/android-downloads?kind=manga&manga=${group.mediaId}`)}>
                        <span className="mdl-card-cover">
                            <span className="mdl-art mdl-fill">{offlineAsset(art[group.mediaId]?.coverAsset)
                                ? <img src={offlineAsset(art[group.mediaId]?.coverAsset)} alt={title(group.media) || t("Manga cover", "Manga-Cover")} loading="lazy" decoding="async" />
                                : <LuBookOpen aria-hidden />}</span>
                        </span>
                        <span className="mdl-card-title">{title(group.media) || `Manga ${group.mediaId}`}</span>
                        <span className="mdl-row-meta">{ready} {t(`${chapterWord(ready)} ready`, "Kapitel bereit")}</span>
                        {group.queued.length > 0 && <span className="mdl-card-pending">{group.queued.length} {t("pending", "ausstehend")}</span>}
                    </button>
                })}
            </div> : <div className="mdl-empty">
                <p>{t("Your manga to go", "Deine Manga für unterwegs")}</p>
                <p>{t("Download chapters on a manga page. They show up here with cover and offline reader.", "Lade Kapitel auf einer Manga-Seite herunter. Sie erscheinen hier mit Cover und Offline-Reader.")}</p>
            </div>}
        </section>}
        {selected && <>
            <section className="mdl-object">
                <div className="mdl-object-identity">
                    <span className="mdl-art mdl-object-cover">{offlineAsset(art[selectedId]?.coverAsset)
                        ? <img loading="lazy" src={offlineAsset(art[selectedId]?.coverAsset)} alt={t("Manga cover", "Manga-Cover")} decoding="async" /> : <LuBookOpen aria-hidden />}</span>
                    <div className="mdl-object-title">
                        <h1>{title(selected.media) || `Manga ${selectedId}`}</h1>
                        {selected.media?.genres?.length ? <p>{selected.media.genres.slice(0, 4).join(" · ")}</p> : null}
                    </div>
                </div>
                <p className="mdl-object-facts"><span>{readyChapters(selected).length} {t(`${chapterWord(readyChapters(selected).length)} available offline`, "Kapitel offline verfügbar")}</span>
                    {selected.queued.length > 0 && <span>{selected.queued.length} {t("pending", "ausstehend")}</span>}</p>
                {selected.media?.description && <details className="mobile-anime-details"><summary>{t("About this manga", "Über den Manga")}</summary><p>{clean(selected.media.description)}</p></details>}
            </section>
            {queueBlock}
            <section className="mdl-section" aria-labelledby="mdl-chapters-title">
                <div className="mdl-section-head"><h2 id="mdl-chapters-title">{t("Your chapters", "Deine Kapitel")}</h2></div>
                <ul className="mdl-rows mdl-rows-plain">
                    {[...readyChapters(selected).map(ch => ({ ...ch, status: "ready" })), ...selected.queued.map(ch => ({ ...ch }))]
                        .sort((a, b) => Number(a.chapterNumber) - Number(b.chapterNumber)).map(ch => {
                            const ready = ch.status === "ready"
                            const openable = ready && containers.some(c => c.provider === ch.provider && c.chapters?.some(item => item.id === ch.chapterId))
                            return <li key={chapterKey(ch.provider, ch.chapterId)} data-downloaded-chapter className="mdl-row" data-ready={ready}>
                                <button type="button" className="mdl-row-main mdl-chapter-main" disabled={!openable} onClick={() => open(ch.provider, ch.chapterId)}
                                    aria-label={ready ? t(`Read chapter ${ch.chapterNumber}`, `Kapitel ${ch.chapterNumber} lesen`) : `${t("Chapter", "Kapitel")} ${ch.chapterNumber}`}>
                                    <span className="mdl-row-text">
                                        <span className="mdl-row-title">{t("Chapter", "Kapitel")} {ch.chapterNumber}</span>
                                        <span className="mdl-row-meta" data-state={ch.status}>{stateText(ch.status)}</span>
                                    </span>
                                    {ready && <span className="mdl-read" aria-hidden><LuBookOpen />{t("Read", "Lesen")}</span>}
                                </button>
                                {ready && <button type="button" className="mdl-icon-button" aria-label={t(`Delete chapter ${ch.chapterNumber}`, `Kapitel ${ch.chapterNumber} löschen`)}
                                    onClick={() => setDeleting(ch)}><LuTrash2 aria-hidden /></button>}
                            </li>
                        })}
                </ul>
            </section>
        </>}
        {selectedId > 0 && loaded && !selected && <div className="mdl-empty"><p>{t("No downloads are stored for this manga.", "Für diesen Manga sind keine Downloads gespeichert.")}</p></div>}
        {reader && selected && <ChapterReaderDrawer entry={{ mediaId: selectedId, media: selected.media }} chapterContainer={reader} chapterIdToNumbersMap={numbers} />}
        <Modal title={t("Delete chapter from phone?", "Kapitel vom Handy löschen?")} open={!!deleting} onOpenChange={open => { if (!open) setDeleting(undefined) }}
            contentClass="mobile-anime-dialog mobile-download-sheet">
            <div className="mdl-confirm" data-manga-delete-dialog><p>{title(selected?.media)} · {t("Chapter", "Kapitel")} {deleting?.chapterNumber}</p>
                <div className="mobile-cache-actions">
                    <button type="button" className="mobile-cache-clear" onClick={async () => {
                        try {
                            await api.current("/api/v1/manga/download-chapter", "DELETE", { downloadIds: [{ ...deleting, mediaId: selectedId }] })
                            setDeleting(undefined); toast.success(t("Chapter deleted", "Kapitel gelöscht")); kick.current()
                        } catch { toast.error(t("Chapter could not be deleted", "Kapitel konnte nicht gelöscht werden")) }
                    }}>{t("Delete", "Löschen")}</button>
                    <button type="button" className="mobile-cache-cancel" onClick={() => setDeleting(undefined)}>{t("Cancel", "Abbrechen")}</button>
                </div>
            </div>
        </Modal>
    </div>
}
