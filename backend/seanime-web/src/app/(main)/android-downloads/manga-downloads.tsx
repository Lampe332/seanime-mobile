import { useSeaQuery } from "@/api/client/requests"
import { AL_BaseManga, Manga_ChapterContainer, Manga_DownloadListItem, Manga_Entry, Models_ChapterDownloadQueueItem } from "@/api/generated/types"
import { ChapterReaderDrawer } from "@/app/(main)/manga/_containers/chapter-reader/chapter-reader-drawer"
import { __manga_selectedChapterAtom } from "@/app/(main)/manga/_lib/handle-chapter-reader"
import { useHandleMangaDownloadData } from "@/app/(main)/manga/_lib/handle-manga-downloads"
import { useRouter } from "@/lib/navigation"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { useQueryClient } from "@tanstack/react-query"
import { useSetAtom } from "jotai"
import React from "react"
import { LuBookOpen, LuPause, LuPlay, LuRefreshCw, LuTrash2 } from "react-icons/lu"
import { toast } from "sonner"

type Group = { mediaId: number, media?: AL_BaseManga, queued: Models_ChapterDownloadQueueItem[], downloads: Manga_DownloadListItem["downloadData"] }
type Art = { coverAsset?: string, bannerAsset?: string }
const artwork = (key?: string) => key && /^[a-f0-9]{64}\.jpg$/.test(key) ? `/__android_offline/${key}` : undefined
const title = (media?: AL_BaseManga) => media?.title?.userPreferred || media?.title?.english || media?.title?.romaji
const clean = (text?: string) => (text || "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").trim()
const chapterKey = (provider: string, id: string) => `${provider}:${id}`

export function MangaDownloads({ selectedId }: { selectedId: number }) {
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
    React.useEffect(() => { setReader(undefined); setContainers([]) }, [selectedId])
    React.useEffect(() => {
        let alive = true, inFlight = false, signature = ""
        async function refresh() {
            if (inFlight) return
            inFlight = true
            try {
                const [downloads = [], queue = []] = await Promise.all([
                    api.current<Manga_DownloadListItem[]>("/api/v1/manga/downloads", "GET"),
                    api.current<Models_ChapterDownloadQueueItem[]>("/api/v1/manga/download-queue", "GET", undefined, { summary: true }),
                ])
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
                setArt(assets); setLoaded(true); setError(false)
                const nextSignature = JSON.stringify([downloads.map(d => [d.mediaId, d.downloadData]), queue.map(q => [q.mediaId, q.chapterId, q.status])])
                if (selectedId && nextSignature !== signature) {
                    const result = await api.current<Manga_ChapterContainer[]>(`/api/v1/manga/downloaded-chapters/${selectedId}`, "GET")
                    const pending = new Set(queue.filter(q => q.mediaId === selectedId).map(q => chapterKey(q.provider, q.chapterId)))
                    if (alive) setContainers((result || []).map(c => ({ ...c, chapters: c.chapters?.filter(ch => !pending.has(chapterKey(c.provider, ch.id))) })))
                    await queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.MANGA_DOWNLOAD.GetMangaDownloadData.key] })
                    signature = nextSignature
                }
            } catch { if (alive) setError(true) }
            finally { inFlight = false }
        }
        refresh(); const timer = window.setInterval(refresh, 2000)
        return () => { alive = false; clearInterval(timer) }
    }, [selectedId])
    const selected = groups.find(g => g.mediaId === selectedId)
    const queue = groups.flatMap(g => g.queued)
    const run = async (action: "start" | "stop" | "retry") => {
        setBusy(true)
        try {
            if (action === "retry") await api.current("/api/v1/manga/download-queue/reset-errored", "POST")
            await api.current(`/api/v1/manga/download-queue/${action === "stop" ? "stop" : "start"}`, "POST")
            toast.success(action === "stop" ? "Manga-Warteschlange pausiert" : "Manga-Downloads gestartet")
        } catch { toast.error("Warteschlange konnte nicht geändert werden") }
        finally { setBusy(false) }
    }
    const readyChapters = (group: Group) => Object.entries(group.downloads).flatMap(([provider, chapters]) => chapters
        .filter(ch => !group.queued.some(q => q.provider === provider && q.chapterId === ch.chapterId)).map(ch => ({ ...ch, provider })))
    const numbers = new Map<string, number>()
    containers.forEach(c => c.chapters?.forEach(ch => numbers.set(ch.id, Number(ch.chapter))))
    const open = (provider: string, chapterId: string) => {
        const container = containers.find(c => c.provider === provider && c.chapters?.some(ch => ch.id === chapterId))
        const chapter = container?.chapters?.find(ch => ch.id === chapterId)
        if (!container || !chapter) { toast.info("Kapitel wird vorbereitet. Bitte gleich erneut öffnen."); return }
        setReader(container)
        React.startTransition(() => setChapter({ mediaId: selectedId, provider, chapterId, chapterNumber: chapter.chapter }))
    }
    return <div className="space-y-6" data-manga-downloads>
        {error && <p role="alert" className="text-sm text-red-300">Manga-Downloads konnten nicht geladen werden. Erneuter Versuch läuft …</p>}
        {!loaded && !error && <p className="py-12 text-center text-[--muted]">Deine Manga werden geladen …</p>}
        {queue.length > 0 && <div className="rounded-xl bg-white/5 p-4 space-y-3">
            <p className="text-sm">{queue.length} Kapitel in der Warteschlange · {queue.filter(q => q.status === "downloading").length} werden geladen</p>
            <div className="flex flex-wrap gap-2">
                <Button size="sm" intent="gray-basic" disabled={busy} onClick={() => run("start")}><LuPlay /> Starten / Fortsetzen</Button>
                <Button size="sm" intent="gray-basic" disabled={busy} onClick={() => run("stop")}><LuPause /> Pausieren</Button>
                {queue.some(q => q.status === "errored") && <Button size="sm" intent="gray-basic" disabled={busy} onClick={() => run("retry")}><LuRefreshCw /> Erneut versuchen</Button>}
            </div>
        </div>}
        {!selectedId && loaded && <>
            <p className="text-sm text-[--muted]">{groups.length} Manga · {groups.reduce((n, g) => n + readyChapters(g).length, 0)} Kapitel offline</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-6">
                {groups.map(group => <button key={group.mediaId} data-downloaded-manga className="text-left min-w-0" onClick={() => router.push(`/android-downloads?kind=manga&manga=${group.mediaId}`)}>
                    <div className="relative overflow-hidden rounded-xl aspect-[2/3] bg-gray-900">
                        {artwork(art[group.mediaId]?.coverAsset) ? <img src={artwork(art[group.mediaId]?.coverAsset)} alt={title(group.media) || "Manga-Cover"} className="w-full h-full object-cover" /> : <LuBookOpen className="absolute inset-0 m-auto text-4xl text-[--muted]" />}
                        <p className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-3 pt-12 pb-3 text-xs">{readyChapters(group).length} Kapitel bereit</p>
                    </div>
                    <h2 className="mt-2.5 font-semibold text-sm line-clamp-2">{title(group.media) || `Manga ${group.mediaId}`}</h2>
                    {group.queued.length > 0 && <p className="mt-1 text-xs text-orange-300">{group.queued.length} ausstehend</p>}
                </button>)}
            </div>
            {groups.length === 0 && <div className="py-12 text-center space-y-3"><LuBookOpen className="mx-auto text-4xl text-[--muted]" /><h2 className="font-semibold">Deine Manga für unterwegs</h2><p className="text-sm text-[--muted]">Lade Kapitel auf einer Manga-Seite herunter. Sie erscheinen hier mit Cover und Offline-Reader.</p></div>}
        </>}
        {selected && <>
            <section className="flex items-end gap-4">
                {artwork(art[selectedId]?.coverAsset) && <img src={artwork(art[selectedId]?.coverAsset)} alt="Manga-Cover" className="w-24 aspect-[2/3] rounded-lg object-cover" />}
                <div><h2 className="text-2xl font-bold">{title(selected.media) || `Manga ${selectedId}`}</h2><p className="mt-2 text-xs text-green-300">{readyChapters(selected).length} Kapitel offline verfügbar</p><p className="mt-2 text-xs text-[--muted]">{selected.media?.genres?.slice(0, 4).join(" · ")}</p></div>
            </section>
            {selected.media?.description && <details className="text-sm text-[--muted]"><summary className="text-white cursor-pointer">Über den Manga</summary><p className="mt-3 leading-relaxed">{clean(selected.media.description)}</p></details>}
            <section className="space-y-3"><h3 className="text-lg font-semibold">Deine Kapitel</h3>
                {[...readyChapters(selected).map(ch => ({ ...ch, status: "ready" })), ...selected.queued.map(ch => ({ ...ch }))]
                    .sort((a, b) => Number(a.chapterNumber) - Number(b.chapterNumber)).map(ch => <article key={chapterKey(ch.provider, ch.chapterId)} data-downloaded-chapter className="flex items-center gap-3 rounded-xl bg-white/[0.03] border border-white/5 p-3">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-white/5"><LuBookOpen className="text-xl" /></div>
                        <div className="min-w-0 flex-1"><h4 className="text-sm font-semibold">Kapitel {ch.chapterNumber}</h4><p className={`mt-1 text-xs ${ch.status === "ready" ? "text-green-300" : ch.status === "errored" ? "text-red-300" : "text-[--muted]"}`}>{ch.status === "ready" ? "Offline verfügbar" : ch.status === "downloading" ? "Wird heruntergeladen …" : ch.status === "errored" ? "Fehlgeschlagen · erneut versuchen" : "Wartet auf Download"}</p></div>
                        {ch.status === "ready" && <><button disabled={!containers.some(c => c.provider === ch.provider && c.chapters?.some(item => item.id === ch.chapterId))} className="min-h-11 px-3 flex items-center gap-2 rounded-lg bg-white/5 text-sm disabled:opacity-40" onClick={() => open(ch.provider, ch.chapterId)} aria-label={`Kapitel ${ch.chapterNumber} lesen`}><LuBookOpen />Lesen</button><button className="h-11 w-11 flex items-center justify-center text-[--muted]" aria-label={`Kapitel ${ch.chapterNumber} löschen`} onClick={() => setDeleting(ch)}><LuTrash2 /></button></>}
                    </article>)}
            </section>
        </>}
        {selectedId > 0 && loaded && !selected && <p className="text-sm text-[--muted]">Für diesen Manga sind keine Downloads gespeichert.</p>}
        {reader && selected && <ChapterReaderDrawer entry={{ mediaId: selectedId, media: selected.media }} chapterContainer={reader} chapterIdToNumbersMap={numbers} />}
        <Modal title="Kapitel vom Handy löschen?" open={!!deleting} onOpenChange={open => { if (!open) setDeleting(undefined) }}>
            <div className="space-y-4"><p className="text-sm">Kapitel {deleting?.chapterNumber}</p><div className="flex justify-end gap-2"><Button intent="gray-basic" onClick={() => setDeleting(undefined)}>Abbrechen</Button><Button intent="alert" onClick={async () => {
                try { await api.current("/api/v1/manga/download-chapter", "DELETE", { downloadIds: [{ ...deleting, mediaId: selectedId }] }); setDeleting(undefined); toast.success("Kapitel gelöscht") } catch { toast.error("Kapitel konnte nicht gelöscht werden") }
            }}>Löschen</Button></div></div>
        </Modal>
    </div>
}
