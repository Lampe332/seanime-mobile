import { API_ENDPOINTS } from "@/api/generated/endpoints"
import type { AL_BaseManga, Manga_ChapterContainer, Manga_DownloadListItem, Models_ChapterDownloadQueueItem } from "@/api/generated/types"
import { useServerQuery } from "@/api/client/requests"
import { useDeleteMangaDownloadedChapters, useResetErroredChapterDownloadQueue, useStartMangaDownloadQueue, useStopMangaDownloadQueue } from "@/api/hooks/manga_download.hooks"
import { useGetMangaEntry } from "@/api/hooks/manga.hooks"
import { Notice, TextAction } from "@/components/shared/phone-kit"
import { PhoneEmpty, PhoneSection, useGridColumns } from "@/components/shared/phone-cards"
import { Button } from "@/components/ui/button/button"
import { cn } from "@/components/ui/core/styling"
import { Dialog } from "@/components/ui/sheet/sheet"
import { Muted, Text } from "@/components/ui/text/text"
import { toast } from "@/components/ui/toast/toast-store"
import { type Translate, useTr } from "@/lib/app-language"
import { useRouter } from "@/lib/navigation"
import { getImageUrl } from "@/lib/server/assets"
import { colors } from "@/lib/theme/tokens"
import { plainDescription } from "@/main/_features/media/_lib/media-labels"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { __manga_selectedChapterAtom, useMangaReaderSource } from "@/main/manga/_lib/handle-chapter-reader"
import { useHandleMangaDownloadData } from "@/main/manga/_lib/handle-manga-downloads"
import { groupMangaDownloads, type MangaDownloadGroup, mangaDownloadRows, mangaNextDelay, mangaTitle, readyChapters } from "@/main/manga/_lib/manga-downloads"
import { FlashList } from "@shopify/flash-list"
import { Image } from "expo-image"
import { useSetAtom } from "jotai"
import ArrowLeft from "lucide-react-native/icons/arrow-left"
import BookOpen from "lucide-react-native/icons/book-open"
import ChevronDown from "lucide-react-native/icons/chevron-down"
import ChevronRight from "lucide-react-native/icons/chevron-right"
import Pause from "lucide-react-native/icons/pause"
import Play from "lucide-react-native/icons/play"
import RefreshCw from "lucide-react-native/icons/refresh-cw"
import Trash2 from "lucide-react-native/icons/trash"
import React from "react"
import { ActivityIndicator, Pressable, View } from "react-native"

/*
 * The Manga tab of the Downloads screen (android-downloads/manga-downloads.tsx). The Go server downloads the chapters
 * itself (/api/v1/manga/download-chapters, its own queue, files in its data folder); this lists them: the queue with
 * start / pause / retry, the manga as cover cards (FlashList grid), and per manga (?kind=manga&manga=ID) its cover,
 * facts, description and the chapters to read (the reader opens over the page) or delete after a question.
 * The list polls quickly while a chapter loads, slowly while others wait, once more after the queue empties, then idles.
 * The old app kept cover and description through the Android bridge (cacheManga); here they come from the server's
 * download list or the manga entry, and expo-image keeps the covers on disk.
 */

const QUEUE_KEY = API_ENDPOINTS.MANGA_DOWNLOAD.GetMangaDownloadQueue.key
const LIST_KEY = API_ENDPOINTS.MANGA_DOWNLOAD.GetMangaDownloadsList.key

export function MangaDownloads({ selectedId }: { selectedId: number }) {
    const t = useTr()
    const router = useRouter()
    const hadQueue = React.useRef(false)
    const queueQuery = useServerQuery<Models_ChapterDownloadQueueItem[], { summary: boolean }>({
        endpoint: API_ENDPOINTS.MANGA_DOWNLOAD.GetMangaDownloadQueue.endpoint,
        method: "GET",
        params: { summary: true },
        queryKey: [QUEUE_KEY, "summary"],
        refetchInterval: query => {
            const queue = query.state.data ?? []
            const delay = mangaNextDelay(queue, hadQueue.current)
            hadQueue.current = queue.length > 0
            return delay ?? false
        },
    })
    const listQuery = useServerQuery<Manga_DownloadListItem[]>({
        endpoint: API_ENDPOINTS.MANGA_DOWNLOAD.GetMangaDownloadsList.endpoint,
        method: "GET",
        queryKey: [LIST_KEY],
        // follows the queue: a finished chapter moves from the queue into the list
        refetchInterval: () => queueQuery.data?.length || hadQueue.current ? 3000 : false,
    })
    const groups = React.useMemo(() => groupMangaDownloads(listQuery.data, queueQuery.data), [listQuery.data, queueQuery.data])
    const selected = selectedId > 0 ? groups.find(group => group.mediaId === selectedId) : undefined
    const queue = queueQuery.data ?? []
    const loaded = !!listQuery.data && !!queueQuery.data
    const failed = (listQuery.isError && !listQuery.data) || (queueQuery.isError && !queueQuery.data)
    const totalReady = groups.reduce((n, g) => n + readyChapters(g).length, 0)
    const back = () => router.replace("/android-downloads?kind=manga")

    return <View className="gap-6">
        {selectedId > 0 && <Pressable accessibilityRole="button" onPress={back} className="min-h-12 flex-row items-center gap-2 self-start rounded-full pl-1 pr-3 active:bg-sm-surface-control">
            <ArrowLeft size={20} color={colors.smText} />
            <Text className="text-[15px] font-semibold">{t("Back to manga overview", "Zurück zur Manga-Übersicht")}</Text>
        </Pressable>}
        {failed && <Notice text={t("Manga downloads could not be loaded. Retrying …", "Manga-Downloads konnten nicht geladen werden. Erneuter Versuch läuft …")}>
            <TextAction label={t("Try again", "Erneut versuchen")} onPress={() => { void listQuery.refetch(); void queueQuery.refetch() }} />
        </Notice>}
        {!loaded && !failed && <View className="items-center py-10"><ActivityIndicator color={colors.smTextMuted} accessibilityLabel={t("Loading your manga …", "Deine Manga werden geladen …")} /></View>}
        {loaded && !selected && queue.length > 0 && <QueueBlock queue={queue} t={t} />}
        {loaded && !selectedId && <PhoneSection title={t("Your manga", "Deine Manga")}
            count={`${groups.length} Manga · ${totalReady} ${t(totalReady === 1 ? "chapter offline" : "chapters offline", "Kapitel offline")}`}>
            {groups.length > 0 ? <MangaGrid groups={groups} t={t} onOpen={id => router.push(`/android-downloads?kind=manga&manga=${id}`)} />
                : <PhoneEmpty title={t("Your manga to go", "Deine Manga für unterwegs")}
                    text={t("Download chapters on a manga page. They show up here with cover and offline reader.", "Lade Kapitel auf einer Manga-Seite herunter. Sie erscheinen hier mit Cover und Offline-Reader.")}>
                    <Button intent="secondary" onPress={() => router.push(`/search?type=manga&at=${Date.now()}`)}>{t("Search manga", "Manga suchen")}</Button>
                </PhoneEmpty>}
        </PhoneSection>}
        {loaded && selected && <MangaDetail group={selected} queue={queue} t={t} onChanged={() => { void listQuery.refetch(); void queueQuery.refetch() }} />}
        {selectedId > 0 && loaded && !selected && <PhoneEmpty title={t("No downloads are stored for this manga.", "Für diesen Manga sind keine Downloads gespeichert.")}>
            <Button intent="secondary" onPress={back}>{t("Back to manga overview", "Zur Manga-Übersicht")}</Button>
        </PhoneEmpty>}
    </View>
}

function QueueBlock({ queue, t }: { queue: Models_ChapterDownloadQueueItem[], t: Translate }) {
    const { mutate: start, isPending: starting } = useStartMangaDownloadQueue()
    const { mutate: stop, isPending: stopping } = useStopMangaDownloadQueue()
    const { mutate: resetErrored, isPending: resetting } = useResetErroredChapterDownloadQueue()
    const busy = starting || stopping || resetting
    const loading = queue.filter(q => q.status === "downloading").length
    const fail = () => toast.error(t("Queue could not be changed", "Warteschlange konnte nicht geändert werden"))
    return <PhoneSection title={t("Queue", "Warteschlange")}
        count={t(`${queue.length} ${queue.length === 1 ? "chapter" : "chapters"} · ${loading} loading`, `${queue.length} Kapitel · ${loading} werden geladen`)}>
        <View className="flex-row flex-wrap gap-2">
            <Button intent="secondary" disabled={busy} leftIcon={<Play size={18} color={colors.smText} />} onPress={() => start(undefined, { onError: fail })}>{t("Start / resume", "Starten / Fortsetzen")}</Button>
            <Button intent="secondary" disabled={busy} leftIcon={<Pause size={18} color={colors.smText} />} onPress={() => stop(undefined, { onError: fail })}>{t("Pause", "Pausieren")}</Button>
            {queue.some(q => q.status === "errored") && <Button intent="secondary" disabled={busy} leftIcon={<RefreshCw size={18} color={colors.smText} />}
                onPress={() => resetErrored(undefined, { onSuccess: () => start(undefined, { onError: fail }), onError: fail })}>{t("Try again", "Erneut versuchen")}</Button>}
        </View>
    </PhoneSection>
}

function MangaGrid({ groups, t, onOpen }: { groups: MangaDownloadGroup[], t: Translate, onOpen: (mediaId: number) => void }) {
    const [width, setWidth] = React.useState(0)
    const grid = useGridColumns(width)
    return <View onLayout={event => setWidth(event.nativeEvent.layout.width)} style={{ marginHorizontal: -grid.gap / 2 }}>
        {width > 0 && <FlashList data={groups} numColumns={grid.columns} scrollEnabled={false} keyExtractor={group => String(group.mediaId)}
            renderItem={({ item }) => <View style={{ paddingHorizontal: grid.gap / 2, paddingBottom: grid.rowGap }}>
                <MangaCard group={item} width={grid.width} t={t} onOpen={onOpen} />
            </View>} />}
    </View>
}

/** The manga of a group: from the download list, or its entry when the list has none (a manga only in the queue). */
function useGroupMedia(group: MangaDownloadGroup): AL_BaseManga | undefined {
    const { data } = useGetMangaEntry(group.media ? null : group.mediaId)
    return group.media ?? data?.media
}

function Cover({ media, width, title }: { media?: AL_BaseManga, width: number, title: string }) {
    const t = useTr()
    const serverStatus = useServerStatus()
    const veiled = !!serverStatus?.settings?.anilist?.blurAdultContent && !!media?.isAdult
    const cover = media?.coverImage?.large || media?.coverImage?.extraLarge
    return <View style={{ width }} className="aspect-[2/3] items-center justify-center overflow-hidden rounded-surface-sm bg-sm-surface-control">
        {cover ? <Image source={getImageUrl(cover)} contentFit="cover" cachePolicy="disk" blurRadius={veiled ? 24 : 0} style={{ position: "absolute", inset: 0 }}
            accessibilityLabel={title || t("Manga cover", "Manga-Cover")} accessibilityIgnoresInvertColors /> : <BookOpen size={28} color={colors.smTextSubtle} />}
    </View>
}

function MangaCard({ group, width, t, onOpen }: { group: MangaDownloadGroup, width: number, t: Translate, onOpen: (mediaId: number) => void }) {
    const media = useGroupMedia(group)
    const title = mangaTitle(media) || `Manga ${group.mediaId}`
    const ready = readyChapters(group).length
    return <Pressable accessibilityRole="button" onPress={() => onOpen(group.mediaId)} style={{ width }} className="gap-1 active:opacity-85">
        <View className="mb-1"><Cover media={media} width={width} title={title} /></View>
        <Text numberOfLines={2} className="text-[13px] font-medium leading-[18px]">{title}</Text>
        <Text className="text-xs text-sm-text-subtle" style={{ fontVariant: ["tabular-nums"] }}>{ready} {t(ready === 1 ? "chapter ready" : "chapters ready", "Kapitel bereit")}</Text>
        {group.queued.length > 0 && <Text className="text-xs font-semibold text-sm-accent">{group.queued.length} {t("pending", "ausstehend")}</Text>}
    </Pressable>
}

function MangaDetail({ group, queue, t, onChanged }: { group: MangaDownloadGroup, queue: Models_ChapterDownloadQueueItem[], t: Translate, onChanged: () => void }) {
    const media = useGroupMedia(group)
    const title = mangaTitle(media) || `Manga ${group.mediaId}`
    const setChapter = useSetAtom(__manga_selectedChapterAtom)
    const [aboutOpen, setAboutOpen] = React.useState(false)
    const [deleting, setDeleting] = React.useState<{ provider: string, chapterId: string, chapterNumber: string } | null>(null)
    const { mutate: deleteChapters } = useDeleteMangaDownloadedChapters(group.mediaId, null)
    // the reader steps through this manga's downloaded chapters
    useHandleMangaDownloadData(group.mediaId)
    const queueSignature = queue.filter(q => q.mediaId === group.mediaId).map(q => `${q.provider}:${q.chapterId}:${q.status}`).join("|")
    const { data: containers } = useServerQuery<Manga_ChapterContainer[]>({
        endpoint: API_ENDPOINTS.MANGA.GetMangaEntryDownloadedChapters.endpoint.replace("{id}", String(group.mediaId)),
        method: "GET",
        // read again when the saved chapters or the queue change
        queryKey: [API_ENDPOINTS.MANGA.GetMangaEntryDownloadedChapters.key, String(group.mediaId), JSON.stringify(group.downloads), queueSignature],
    })
    // chapters still in the queue are not readable yet
    const pending = React.useMemo(() => new Set(queue.filter(q => q.mediaId === group.mediaId).map(q => `${q.provider}:${q.chapterId}`)), [queue, group.mediaId])
    const readable = React.useMemo(() => (containers ?? []).map(c => ({ ...c, chapters: c.chapters?.filter(ch => !pending.has(`${c.provider}:${ch.id}`)) })), [containers, pending])
    const [readerContainer, setReaderContainer] = React.useState<Manga_ChapterContainer | null>(null)
    const readerSource = React.useMemo(() => readerContainer ? { entry: { mediaId: group.mediaId, media }, chapterContainer: readerContainer } : null,
        [readerContainer, group.mediaId, media])
    useMangaReaderSource(readerSource)

    const open = (provider: string, chapterId: string) => {
        const container = readable.find(c => c.provider === provider && c.chapters?.some(ch => ch.id === chapterId))
        const chapter = container?.chapters?.find(ch => ch.id === chapterId)
        if (!container || !chapter) return toast.info(t("Chapter is being prepared. Please open it again in a moment.", "Kapitel wird vorbereitet. Bitte gleich erneut öffnen."))
        setReaderContainer(container)
        setChapter({ mediaId: group.mediaId, provider, chapterId, chapterNumber: chapter.chapter })
    }
    const stateText = (status: string) => status === "ready" ? t("Available offline", "Offline verfügbar") : status === "downloading" ? t("Downloading …", "Wird heruntergeladen …")
        : status === "errored" ? t("Failed · try again", "Fehlgeschlagen · erneut versuchen") : t("Waiting to download", "Wartet auf Download")
    const ready = readyChapters(group).length
    const description = plainDescription(media?.description)

    return <View className="gap-6">
        <View className="gap-4">
            <View className="flex-row items-end gap-4">
                <Cover media={media} width={88} title={title} />
                <View className="min-w-0 flex-1 gap-1">
                    <Text accessibilityRole="header" numberOfLines={4} className="text-[22px] font-bold leading-[28px] tracking-[-0.44px]">{title}</Text>
                    {!!media?.genres?.length && <Muted>{media.genres.slice(0, 4).join(" · ")}</Muted>}
                </View>
            </View>
            <View className="flex-row flex-wrap gap-x-4">
                <Text className="text-sm text-sm-text-muted">{ready} {t(ready === 1 ? "chapter available offline" : "chapters available offline", "Kapitel offline verfügbar")}</Text>
                {group.queued.length > 0 && <Text className="text-sm font-semibold text-sm-accent">{group.queued.length} {t("pending", "ausstehend")}</Text>}
            </View>
            {!!description && <View className="border-b border-sm-line">
                <Pressable accessibilityRole="button" accessibilityState={{ expanded: aboutOpen }} onPress={() => setAboutOpen(v => !v)} className="min-h-12 flex-row items-center gap-1.5 py-3">
                    {aboutOpen ? <ChevronDown size={16} color={colors.smTextSubtle} /> : <ChevronRight size={16} color={colors.smTextSubtle} />}
                    <Text className="text-[15px] font-semibold">{t("About this manga", "Über den Manga")}</Text>
                </Pressable>
                {aboutOpen && <Text className="pb-3 text-sm leading-[22px] text-sm-text-muted">{description}</Text>}
            </View>}
        </View>
        {group.queued.length > 0 && <QueueBlock queue={queue} t={t} />}
        <PhoneSection title={t("Your chapters", "Deine Kapitel")}>
            <View className="gap-0.5 overflow-hidden rounded-surface">
                {mangaDownloadRows(group).map(ch => {
                    const isReady = ch.status === "ready"
                    const openable = isReady && readable.some(c => c.provider === ch.provider && c.chapters?.some(item => item.id === ch.chapterId))
                    return <View key={`${ch.provider}:${ch.chapterId}`} className="min-h-14 flex-row items-center bg-sm-surface-raised">
                        <Pressable accessibilityRole="button" disabled={!openable} onPress={() => open(ch.provider, ch.chapterId)}
                            accessibilityLabel={isReady ? t(`Read chapter ${ch.chapterNumber}`, `Kapitel ${ch.chapterNumber} lesen`) : `${t("Chapter", "Kapitel")} ${ch.chapterNumber}`}
                            className="min-h-14 min-w-0 flex-1 flex-row items-center gap-3 px-4 py-2 active:bg-sm-surface-control">
                            <View className="min-w-0 flex-1 gap-0.5">
                                <Text className="text-[15px]">{t("Chapter", "Kapitel")} {ch.chapterNumber}</Text>
                                <Text className={cn("text-[13px]", ch.status === "errored" ? "text-sm-danger" : isReady ? "text-sm-text-muted" : "text-sm-accent")}>{stateText(ch.status)}</Text>
                            </View>
                            {isReady && <View className={cn("flex-row items-center gap-1.5", !openable && "opacity-50")}>
                                <BookOpen size={16} color={colors.smAccent} />
                                <Text className="text-sm font-semibold text-sm-accent">{t("Read", "Lesen")}</Text>
                            </View>}
                        </Pressable>
                        {isReady && <Pressable accessibilityRole="button" accessibilityLabel={t(`Delete chapter ${ch.chapterNumber}`, `Kapitel ${ch.chapterNumber} löschen`)}
                            onPress={() => setDeleting(ch)} className="h-12 w-12 items-center justify-center rounded-full active:bg-sm-surface-control">
                            <Trash2 size={20} color={colors.smDanger} />
                        </Pressable>}
                    </View>
                })}
            </View>
        </PhoneSection>
        <Dialog title={t("Delete chapter from phone?", "Kapitel vom Handy löschen?")} open={!!deleting} onOpenChange={value => { if (!value) setDeleting(null) }}
            description={`${title} · ${t("Chapter", "Kapitel")} ${deleting?.chapterNumber ?? ""}`}
            footer={<>
                <Button intent="secondary" wrapperClassName="flex-1" onPress={() => setDeleting(null)}>{t("Cancel", "Abbrechen")}</Button>
                <Button intent="danger" wrapperClassName="flex-1" onPress={() => {
                    if (!deleting) return
                    deleteChapters({ downloadIds: [{ ...deleting, mediaId: group.mediaId }] }, {
                        onSuccess: onChanged,
                        onError: () => toast.error(t("Chapter could not be deleted", "Kapitel konnte nicht gelöscht werden")),
                    })
                    setDeleting(null)
                }}>{t("Delete", "Löschen")}</Button>
            </>} />
    </View>
}
