import type { HibikeManga_ChapterDetails, Manga_ChapterContainer, Manga_Entry, Manga_MediaDownloadData } from "@/api/generated/types"
import { useDeleteMangaDownloadedChapters } from "@/api/hooks/manga_download.hooks"
import { useGetMangaSourceRefresh, useStartMangaSourceRefresh } from "@/api/hooks/manga.hooks"
import { ActionRow, RowGroup } from "@/components/shared/phone-kit"
import { PhoneEmpty } from "@/components/shared/phone-cards"
import { Button } from "@/components/ui/button/button"
import { cn } from "@/components/ui/core/styling"
import { Select } from "@/components/ui/select/select"
import { Dialog, Sheet } from "@/components/ui/sheet/sheet"
import { Tabs } from "@/components/ui/tabs/tabs"
import { Muted, Text } from "@/components/ui/text/text"
import { toast } from "@/components/ui/toast/toast-store"
import { useTr } from "@/lib/app-language"
import { MENU_ENTRIES } from "@/lib/nav/nav-items"
import { useRouter } from "@/lib/navigation"
import { atomWithStorage } from "@/lib/storage"
import { colors } from "@/lib/theme/tokens"
import { MangaManualMappingSheet } from "@/main/manga/_containers/chapter-list/manga-manual-mapping-sheet"
import {
    CHAPTER_ORDER_STORAGE,
    findChapterIndex,
    isChapterUnread,
    orderChapters,
    parseChapterQuery,
    visibleCountFor,
} from "@/main/manga/_lib/chapter-list-order"
import { __manga_selectedChapterAtom, useMangaReaderSource } from "@/main/manga/_lib/handle-chapter-reader"
import { useHandleMangaChapters } from "@/main/manga/_lib/handle-manga-chapters"
import { useHandleDownloadMangaChapter, useMangaEntryDownloadedChapters } from "@/main/manga/_lib/handle-manga-downloads"
import { __manga_preferencesHydratedAtom } from "@/main/manga/_lib/handle-manga-selected-provider"
import { getChapterNumberFromChapter, useMangaDownloadDataUtils } from "@/main/manga/_lib/handle-manga-utils"
import { LANGUAGES_LIST } from "@/main/manga/_lib/language-map"
import { __manga_resumeLocationsAtom } from "@/main/manga/_lib/manga-chapter-reader.atoms"
import { __manga_continueIntentAtom, getMangaResumeChapter, isMangaContinueIntentFor } from "@/main/manga/_lib/manga-continue"
import type { MangaDownloadChapterItem } from "@/main/manga/_lib/manga-downloads"
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai"
import ArrowDownWideNarrow from "lucide-react-native/icons/arrow-down-wide-narrow"
import ArrowRight from "lucide-react-native/icons/arrow-right"
import ArrowUpNarrowWide from "lucide-react-native/icons/arrow-up-narrow-wide"
import BookOpen from "lucide-react-native/icons/book-open"
import ChevronDown from "lucide-react-native/icons/chevron-down"
import CircleCheck from "lucide-react-native/icons/circle-check"
import Download from "lucide-react-native/icons/download"
import EllipsisVertical from "lucide-react-native/icons/ellipsis-vertical"
import Hash from "lucide-react-native/icons/hash"
import Puzzle from "lucide-react-native/icons/puzzle"
import RefreshCw from "lucide-react-native/icons/refresh-cw"
import RotateCw from "lucide-react-native/icons/rotate-cw"
import Search from "lucide-react-native/icons/search"
import Trash2 from "lucide-react-native/icons/trash"
import React from "react"
import { ActivityIndicator, Pressable, TextInput, View } from "react-native"

/*
 * The manga page's chapters (chapter-list.tsx + downloaded-chapter-list.tsx, mobile-anime.css `.mobile-chapter*`):
 * Online reading | Downloaded as tabs. Online: the source with its caption, language and translator when the source has
 * several, "More" (reload the source, manual match); then the chapters: Unread | All with counts, one button that flips
 * the order (each view keeps its own: Unread oldest first, All newest first, CHAPTER_ORDER_STORAGE), "Go to chapter",
 * 30 rows at a time with "Show more", a download button per chapter and "Download unread". Downloaded: the chapters on
 * this device, read with a tap, delete with the trash button.
 * Rows stay in steps of 30 inside the page's scroll view like 2.0.33 (a FlashList in a ScrollView would not window; §9).
 */

const MOBILE_PAGE_SIZE = 30

const __manga_chapterListOrderAtom = atomWithStorage(CHAPTER_ORDER_STORAGE.all.key, CHAPTER_ORDER_STORAGE.all.initial as "newest" | "oldest")
const __manga_unreadChapterListOrderAtom = atomWithStorage(CHAPTER_ORDER_STORAGE.unread.key, CHAPTER_ORDER_STORAGE.unread.initial as "newest" | "oldest")

/** The chapter list publishes its read action (start / continue / resume) for the page header (mobile-anime-header.tsx). */
export type MangaReadAction = { label: string, detail?: string, onPress: () => void }
export const mangaReadActionAtom = atom<MangaReadAction | null>(null)

export function ChapterList({ mediaId, entry, downloadData, downloadDataLoading, onJumpTo }: {
    mediaId: string
    entry: Manga_Entry
    downloadData: Manga_MediaDownloadData | undefined
    downloadDataLoading: boolean
    /** scrolls the page so the given y (within this list) is in sight */
    onJumpTo: (y: number) => void
}) {
    const t = useTr()
    const router = useRouter()
    const {
        selectedExtension, providerExtensionsLoading, providerOptions, selectedProvider, setSelectedProvider,
        selectedFilters, setSelectedLanguage, setSelectedScanlator, languageOptions, scanlatorOptions,
        chapterContainer, chapterContainerLoading, chapterContainerError, refetchChapterContainer,
    } = useHandleMangaChapters(mediaId)

    // chapter numbers as integers, to tell read from unread
    const chapterIdToNumbersMap = React.useMemo(() => {
        const map = new Map<string, number>()
        for (const chapter of chapterContainer?.chapters ?? []) map.set(chapter.id, getChapterNumberFromChapter(chapter.chapter))
        return map
    }, [chapterContainer?.chapters])

    const setSelectedChapter = useSetAtom(__manga_selectedChapterAtom)
    const { data: sourceRefreshJob } = useGetMangaSourceRefresh()
    const { mutate: startSourceRefresh, isPending: isStartingSourceRefresh } = useStartMangaSourceRefresh()
    const preferencesHydrated = useAtomValue(__manga_preferencesHydratedAtom)
    const sourceRefreshRunning = sourceRefreshJob?.status === "running" || sourceRefreshJob?.status === "stopping"
    const sourceRefreshEligible = entry.listData?.status === "CURRENT" || entry.listData?.status === "REPEATING"
    const { downloadChapters, isSendingDownloadRequest } = useHandleDownloadMangaChapter(mediaId)
    const { isChapterQueued, isChapterDownloaded, isChapterLocal } = useMangaDownloadDataUtils(downloadData, downloadDataLoading)

    const [mobileVisible, setMobileVisible] = React.useState(MOBILE_PAGE_SIZE)
    const [allOrder, setAllOrder] = useAtom(__manga_chapterListOrderAtom)
    const [unreadOrder, setUnreadOrder] = useAtom(__manga_unreadChapterListOrderAtom)
    const [jumpText, setJumpText] = React.useState("")
    const [highlightedChapterId, setHighlightedChapterId] = React.useState<string | null>(null)
    const [mobileTab, setMobileTab] = React.useState<"online" | "downloaded">("online")
    const savedChapters = useMangaEntryDownloadedChapters()

    const isUnread = React.useCallback((chapter: HibikeManga_ChapterDetails) => !entry.listData || !chapterIdToNumbersMap.has(chapter.id)
        || isChapterUnread(chapterIdToNumbersMap.get(chapter.id), entry.listData?.progress), [chapterIdToNumbersMap, entry.listData])
    const unreadChapters = React.useMemo(() => chapterContainer?.chapters?.filter(isUnread) ?? [], [chapterContainer?.chapters, isUnread])
    const resumeLocations = useAtomValue(__manga_resumeLocationsAtom)
    const resumeLocation = resumeLocations[String(mediaId)]
    const [now] = React.useState(() => Date.now())
    const resumeChapter = React.useMemo(() => getMangaResumeChapter(unreadChapters, resumeLocation, selectedProvider, now),
        [resumeLocation, selectedProvider, unreadChapters, now])
    const readingChapter = resumeChapter || unreadChapters[0]
    const allChapters = React.useMemo(() => orderChapters(chapterContainer?.chapters ?? [], allOrder), [chapterContainer?.chapters, allOrder])

    // Unread is the start view while there are unread chapters (the web's layout effect on their count)
    const [showUnreadChapter, setShowUnreadChapter] = React.useState(false)
    const [unreadSeen, setUnreadSeen] = React.useState<number | null>(null)
    if (unreadSeen !== unreadChapters.length) {
        setUnreadSeen(unreadChapters.length)
        setShowUnreadChapter(!!unreadChapters.length)
    }
    const chapterOrder = showUnreadChapter ? unreadOrder : allOrder
    const setChapterOrder = showUnreadChapter ? setUnreadOrder : setAllOrder
    const chapters = React.useMemo(() => showUnreadChapter ? orderChapters(unreadChapters, chapterOrder) : allChapters,
        [showUnreadChapter, unreadChapters, allChapters, chapterOrder])
    const downloadableUnreadChapters = React.useMemo(() => unreadChapters.filter(chapter => !isChapterLocal(chapter) && !isChapterDownloaded(chapter) && !isChapterQueued(chapter)),
        [unreadChapters, isChapterDownloaded, isChapterLocal, isChapterQueued])
    const [confirmUnread, setConfirmUnread] = React.useState(false)

    const open = React.useCallback((chapter: { id: string, chapter: string, provider: string }) => setSelectedChapter({
        chapterId: chapter.id, chapterNumber: chapter.chapter, provider: chapter.provider, mediaId: Number(mediaId),
    }), [mediaId, setSelectedChapter])

    // The reader reads from this page's chapter list (or, for a downloaded chapter without one, its own container)
    const [downloadedContainer, setDownloadedContainer] = React.useState<Manga_ChapterContainer | null>(null)
    const readerContainer = chapterContainer || downloadedContainer
    const readerSource = React.useMemo(() => readerContainer ? { entry, chapterContainer: readerContainer } : null, [entry, readerContainer])
    useMangaReaderSource(readerSource)

    // Rows report where they are, so "Go to chapter" can scroll the page to one
    const rowsY = React.useRef(0)
    const rowY = React.useRef(new Map<string, number>())
    const jumpToChapter = () => {
        const target = parseChapterQuery(jumpText)
        if (target === null) return toast.error(t("Enter a chapter number", "Kapitelnummer eingeben"))
        let list = chapters
        let index = findChapterIndex(list, target)
        if (index < 0 && showUnreadChapter) {
            list = allChapters
            index = findChapterIndex(list, target)
            if (index >= 0) setShowUnreadChapter(false)
        }
        if (index < 0) return toast.error(t(`Chapter ${target} not found in this source`, `Kapitel ${target} in dieser Quelle nicht gefunden`))
        setMobileVisible(visible => visibleCountFor(index, MOBILE_PAGE_SIZE, visible))
        setHighlightedChapterId(list[index].id)
    }
    // once the jumped-to row is laid out: scroll it into view, and let the mark fade after a moment
    const onRowLayout = (id: string, y: number) => {
        rowY.current.set(id, y)
        if (id === highlightedChapterId) onJumpTo(rowsY.current + y)
    }
    React.useEffect(() => {
        if (!highlightedChapterId) return
        const y = rowY.current.get(highlightedChapterId)
        if (y !== undefined) onJumpTo(rowsY.current + y)
        const timer = setTimeout(() => setHighlightedChapterId(null), 3500)
        return () => clearTimeout(timer)
    }, [highlightedChapterId, onJumpTo])

    // The header shows this as the page's main action
    const setReadAction = useSetAtom(mangaReadActionAtom)
    React.useEffect(() => {
        setReadAction(readingChapter ? {
            label: resumeChapter ? t("Resume reading", "Weiterlesen") : entry.listData?.progress ? t("Continue reading", "Weiterlesen") : t("Start reading", "Lesen beginnen"),
            detail: `${t("Chapter", "Kapitel")} ${readingChapter.chapter}${resumeChapter ? ` · ${t("Page", "Seite")} ${resumeLocation.pageIndex + 1}` : ""}`,
            onPress: () => open(readingChapter),
        } : null)
    }, [readingChapter, resumeChapter, resumeLocation, entry.listData?.progress, open, setReadAction, t])
    React.useEffect(() => () => setReadAction(null), [setReadAction])

    // "Continue reading" on the library opens the reading chapter once the saved source has answered
    const [continueIntent, setContinueIntent] = useAtom(__manga_continueIntentAtom)
    React.useEffect(() => {
        if (!continueIntent) return
        // another manga's or an expired intent never opens the reader here
        if (!isMangaContinueIntentFor(continueIntent, mediaId, Date.now())) return setContinueIntent(null)
        // wait for the saved source (server preferences) and its chapters
        if (!preferencesHydrated || (!chapterContainer && !chapterContainerError)) return
        setContinueIntent(null)
        if (readingChapter) open(readingChapter)
    }, [continueIntent, readingChapter, chapterContainer, chapterContainerError, preferencesHydrated, mediaId, open, setContinueIntent])
    React.useEffect(() => () => setContinueIntent(null), [setContinueIntent])

    const [sourceSheet, setSourceSheet] = React.useState<"menu" | "match" | null>(null)

    if (providerExtensionsLoading) return <View className="items-center py-8"><ActivityIndicator color={colors.smTextMuted} /></View>

    const extensionsReady = MENU_ENTRIES.some(e => e.id === "extensions" && e.ready)
    const multi = selectedExtension?.settings?.supportsMultiLanguage || selectedExtension?.settings?.supportsMultiScanlator
    return <View className="gap-4">
        <Tabs value={mobileTab} onValueChange={value => setMobileTab(value as "online" | "downloaded")} items={[
            { value: "online", label: t("Online reading", "Online lesen") },
            { value: "downloaded", label: `${t("Downloaded", "Geladen")}${savedChapters.length ? ` · ${savedChapters.length}` : ""}` },
        ]} />

        {mobileTab === "downloaded" && <DownloadedChapters entry={entry} chapters={savedChapters} onRead={chapter => {
            setDownloadedContainer({ mediaId: Number(entry.mediaId), provider: chapter.provider, chapters: [] })
            setSelectedChapter({ chapterId: chapter.chapterId, chapterNumber: chapter.chapterNumber, provider: chapter.provider, mediaId: Number(entry.mediaId) })
        }} />}

        {mobileTab === "online" && <View className="gap-2 pb-3" accessibilityLabel={t("Source & reading options", "Quelle & Leseoptionen")}>
            <SourceField label={t("Source", "Quelle")} accessibilityLabel={t("Source", "Quelle")} placeholder={t("Source", "Quelle")} options={providerOptions}
                value={selectedProvider || ""} disabled={sourceRefreshRunning} onValueChange={v => setSelectedProvider({ mId: mediaId, provider: v })} />
            {multi && <View className="flex-row gap-2">
                {selectedExtension?.settings?.supportsMultiLanguage && <View className="min-w-0 flex-1">
                    <SourceField label={t("Language", "Sprache")} accessibilityLabel={t("Language", "Sprache")} placeholder={t("All languages", "Alle Sprachen")}
                        options={languageOptions} value={selectedFilters.language} onValueChange={v => setSelectedLanguage({ mId: mediaId, language: v })} />
                </View>}
                {selectedExtension?.settings?.supportsMultiScanlator && <View className="min-w-0 flex-1">
                    <SourceField label={t("Translator", "Übersetzer")} accessibilityLabel={t("Translator (scanlator)", "Übersetzer (Scanlator)")} placeholder={t("All translators", "Alle Übersetzer")}
                        options={scanlatorOptions} value={selectedFilters.scanlators[0] || ""} onValueChange={v => setSelectedScanlator({ mId: mediaId, scanlators: [v] })} />
                </View>}
            </View>}
            {/* rarely needed: reloading the source and matching the title by hand wait behind one quiet button */}
            {/* `[data-manga-source-more]`: a 44dp pill at the start of the line (`.mobile-source-more`) */}
            <View className="flex-row">
                <Pressable accessibilityRole="button" accessibilityLabel={t("More source options", "Weitere Quellen-Optionen")} onPress={() => setSourceSheet("menu")}
                    className="min-h-11 flex-row items-center gap-2 rounded-full bg-sm-surface-control pl-3.5 pr-[18px] active:bg-sm-accent-soft">
                    <EllipsisVertical size={16} color={colors.smText} />
                    <Text className="text-sm font-semibold">{sourceRefreshRunning ? t("Refreshing …", "Wird aktualisiert …") : t("More", "Mehr")}</Text>
                </Pressable>
            </View>
        </View>}

        {mobileTab === "online" && !selectedExtension && <PhoneEmpty
            title={selectedProvider ? t("Saved source unavailable", "Gespeicherte Quelle nicht verfügbar") : t("No manga source available", "Keine Manga-Quelle verfügbar")}
            text={selectedProvider
                ? t(`The saved source “${selectedProvider}” is not installed. Install it again or choose another source.`, `Die gespeicherte Quelle „${selectedProvider}“ ist nicht installiert. Installiere sie wieder oder wähle eine andere.`)
                : t("Install a manga source in Extensions to load chapters.", "Installiere unter Erweiterungen eine Manga-Quelle, um Kapitel zu laden.")}>
            {/* the button appears once the Extensions screen exists (2.11); until then the hint names the place */}
            {extensionsReady && <Button leftIcon={<Puzzle size={18} color="#fff" />} onPress={() => router.push("/extensions")}>{t("Open Extensions", "Erweiterungen öffnen")}</Button>}
        </PhoneEmpty>}

        {mobileTab === "online" && !!selectedExtension && (chapterContainerLoading ? <View className="items-center py-8"><ActivityIndicator color={colors.smTextMuted} /></View>
            : chapterContainerError ? <PhoneEmpty title={t("Chapters could not be loaded", "Kapitel konnten nicht geladen werden")}
                text={t("The source did not answer. Check the connection or try again.", "Die Quelle hat nicht geantwortet. Verbindung prüfen oder erneut versuchen.")}>
                <Button leftIcon={<RefreshCw size={18} color="#fff" />} onPress={() => void refetchChapterContainer()}>{t("Try again", "Erneut versuchen")}</Button>
                <Button intent="secondary" leftIcon={<Search size={18} color={colors.smText} />} onPress={() => setSourceSheet("match")}>{t("Manual match", "Manuell zuordnen")}</Button>
            </PhoneEmpty>
                : chapterContainer?.chapters?.length === 0 ? <PhoneEmpty title={t("No chapters found", "Keine Kapitel gefunden")}
                    text={t("This source has no chapters of this manga. Try another source.", "Diese Quelle hat keine Kapitel dieses Manga. Probiere eine andere Quelle.")} />
                    : !!chapterContainer?.chapters?.length && <View className="gap-3">
                        {/* `.mobile-episode-heading` (margin .25rem 0 .5rem), the count as `h2 span` */}
                        <Text accessibilityRole="header" className="mb-2 mt-1 text-xl font-bold">
                            {t("Chapters", "Kapitel")}<Text className="text-sm font-medium text-sm-text-subtle">{"  "}{chapterContainer.chapters.length}</Text>
                        </Text>
                        {/* `.mobile-chapter-filters`: the Unread/All segment (`.mobile-source-segment`, flex 1 1 12rem up to 22rem), the order
                            button (radius sm, 600) and "Go to chapter" on a line of its own (flex-basis 100%) */}
                        <View className="flex-row flex-wrap items-center gap-2">
                            <View accessibilityLabel={t("Show chapters", "Kapitel anzeigen")} className="min-w-0 max-w-[352px] flex-row rounded-surface-sm bg-sm-surface-sunken"
                                style={{ flexGrow: 1, flexShrink: 1, flexBasis: 192 }}>
                                {([true, false] as const).map(unread => {
                                    const pressed = showUnreadChapter === unread
                                    return <Pressable key={String(unread)} accessibilityRole="button" accessibilityState={{ selected: pressed }}
                                        onPress={() => { setShowUnreadChapter(unread); setMobileVisible(MOBILE_PAGE_SIZE) }} className="min-h-12 flex-1 p-1">
                                        <View className={cn("flex-1 flex-row items-center justify-center gap-1 rounded-surface-sm", pressed && "bg-sm-surface-control")}>
                                            <Text className={cn("text-sm", pressed ? "font-[650] text-sm-text" : "font-medium text-sm-text-muted")}>{unread ? t("Unread", "Ungelesen") : t("All", "Alle")}</Text>
                                            <Text className="text-sm font-medium text-sm-text-subtle" style={{ fontVariant: ["tabular-nums"] }}>{unread ? unreadChapters.length : chapterContainer.chapters!.length}</Text>
                                        </View>
                                    </Pressable>
                                })}
                            </View>
                            {/* one button flips the order; it names the order that is shown */}
                            <Pressable accessibilityRole="button" onPress={() => { setChapterOrder(chapterOrder === "newest" ? "oldest" : "newest"); setMobileVisible(MOBILE_PAGE_SIZE) }}
                                accessibilityLabel={chapterOrder === "newest" ? t("Newest first. Tap for oldest first", "Neueste zuerst. Tippen für älteste zuerst")
                                    : t("Oldest first. Tap for newest first", "Älteste zuerst. Tippen für neueste zuerst")}
                                className="min-h-12 flex-row items-center gap-2 rounded-surface-sm bg-sm-surface-raised pl-3.5 pr-4 active:bg-sm-surface-control">
                                {chapterOrder === "newest" ? <ArrowDownWideNarrow size={18} color={colors.smTextMuted} /> : <ArrowUpNarrowWide size={18} color={colors.smTextMuted} />}
                                <Text className="text-sm font-semibold">{chapterOrder === "newest" ? t("Newest first", "Neueste zuerst") : t("Oldest first", "Älteste zuerst")}</Text>
                            </Pressable>
                            <View accessibilityRole="search" className="min-h-12 w-full flex-row items-center rounded-full bg-sm-surface-raised pl-4">
                                <Hash size={17} color={colors.smTextSubtle} />
                                <TextInput value={jumpText} onChangeText={setJumpText} placeholder={t("Go to chapter", "Zu Kapitel springen")} placeholderTextColor={colors.smTextSubtle}
                                    accessibilityLabel={t("Chapter number", "Kapitelnummer")} keyboardType="decimal-pad" returnKeyType="go" onSubmitEditing={jumpToChapter}
                                    className="min-h-12 min-w-0 flex-1 pl-2.5 pr-1 font-sans text-base text-sm-text" />
                                <Pressable accessibilityRole="button" accessibilityLabel={t("Go", "Los")} disabled={!jumpText.trim()} onPress={jumpToChapter}
                                    className="h-12 w-12 items-center justify-center rounded-full active:bg-sm-surface-control">
                                    <ArrowRight size={20} color={jumpText.trim() ? colors.smAccent : colors.smTextSubtle} />
                                </Pressable>
                            </View>
                        </View>
                        {!chapters.length && <Muted className="py-2 text-center">{t("All chapters are read.", "Alle Kapitel sind gelesen.")}</Muted>}
                        {/* `.mobile-chapter-list`: plain rows on the page with a hairline under each, no cards */}
                        <View accessibilityLabel={t("Chapters", "Kapitel")}
                            onLayout={event => { rowsY.current = event.nativeEvent.layout.y }}>
                            {chapters.slice(0, mobileVisible).map(chapter => {
                                const downloaded = isChapterDownloaded(chapter)
                                const queued = isChapterQueued(chapter)
                                const canDownload = !isChapterLocal(chapter) && !downloaded && !queued
                                const language = chapter.language ? LANGUAGES_LIST[chapter.language]?.nativeName || chapter.language : null
                                // titles that only repeat the number ("Chapter 2") do not get the number again underneath
                                const repeatsNumber = !chapter.title || chapter.title.trim().toLowerCase().replace(/^(chapter|ch\.?|kapitel)\s*/, "") === String(chapter.chapter).toLowerCase()
                                const meta = [repeatsNumber ? null : `${t("Chapter", "Kapitel")} ${chapter.chapter}`, chapter.scanlator,
                                    selectedExtension?.settings?.supportsMultiLanguage ? language : null].filter(Boolean).join(" · ")
                                const read = !isUnread(chapter)
                                return <View key={chapter.id} onLayout={event => onRowLayout(chapter.id, event.nativeEvent.layout.y)}
                                    className={cn("flex-row items-center gap-1 border-b border-sm-line", highlightedChapterId === chapter.id && "rounded-lg bg-sm-accent-soft")}>
                                    <Pressable accessibilityRole="button" onPress={() => open(chapter)} className="min-h-14 min-w-0 flex-1 justify-center gap-0.5 px-1 py-2.5 active:bg-sm-surface-raised">
                                        <Text numberOfLines={2} className={cn("text-[15px] leading-[20.25px]", read ? "font-medium text-sm-text-subtle" : "font-[550]")}>{chapter.title || `${t("Chapter", "Kapitel")} ${chapter.chapter}`}</Text>
                                        {!!meta && <Text numberOfLines={1} className="text-xs text-sm-text-subtle">{meta}</Text>}
                                    </Pressable>
                                    {canDownload && <Pressable accessibilityRole="button" disabled={isSendingDownloadRequest} onPress={() => downloadChapters([chapter])}
                                        accessibilityLabel={t(`Download chapter ${chapter.chapter}`, `Kapitel ${chapter.chapter} laden`)}
                                        className="h-12 w-12 items-center justify-center rounded-full active:bg-sm-surface-control">
                                        <Download size={20} color={colors.smTextMuted} />
                                    </Pressable>}
                                    {queued && <Text className="px-3 text-xs text-sm-text-subtle">{t("Queued", "Eingeplant")}</Text>}
                                    {downloaded && <View accessibilityLabel={t("Downloaded", "Geladen")} className="h-12 w-12 items-center justify-center">
                                        <CircleCheck size={22} color={colors.smAccent} />
                                    </View>}
                                </View>
                            })}
                        </View>
                        {/* `.mobile-chapter-more` (a raised block, radius sm) and `.mobile-chapter-download-unread` (the same, plain, in the accent) */}
                        {chapters.length > mobileVisible && <Pressable accessibilityRole="button" onPress={() => setMobileVisible(v => v + MOBILE_PAGE_SIZE)}
                            className="min-h-12 flex-row items-center justify-center gap-2 rounded-surface-sm bg-sm-surface-raised active:bg-sm-surface-control">
                            <ChevronDown size={18} color={colors.smText} />
                            <Text className="text-sm font-semibold">{t(`Show more (${chapters.length - mobileVisible})`, `Mehr anzeigen (${chapters.length - mobileVisible})`)}</Text>
                        </Pressable>}
                        {!downloadDataLoading && !!downloadableUnreadChapters.length && <Pressable accessibilityRole="button" disabled={isSendingDownloadRequest}
                            onPress={() => setConfirmUnread(true)} className={cn("min-h-12 flex-row items-center justify-center gap-2 rounded-surface-sm active:bg-sm-surface-raised", isSendingDownloadRequest && "opacity-50")}>
                            <Download size={18} color={colors.smAccent} />
                            <Text className="text-sm font-semibold text-sm-accent">{t(`Download unread (${downloadableUnreadChapters.length})`, `Ungelesene laden (${downloadableUnreadChapters.length})`)}</Text>
                        </Pressable>}
                    </View>)}

        <Sheet title={t("Source", "Quelle")} open={sourceSheet === "menu"} onOpenChange={value => { if (!value) setSourceSheet(null) }}>
            <RowGroup>
                <ActionRow icon={RotateCw} label={sourceRefreshRunning ? t("Refreshing …", "Wird aktualisiert …") : t("Reload source", "Quelle neu laden")}
                    note={t("Looks for new chapters of this manga at the source", "Sucht bei der Quelle nach neuen Kapiteln dieses Manga")}
                    disabled={isStartingSourceRefresh || !preferencesHydrated || !selectedExtension || !sourceRefreshEligible || sourceRefreshRunning}
                    onPress={() => {
                        setSourceSheet(null)
                        startSourceRefresh({ mode: "refresh_selected", mediaIds: [Number(mediaId)] }, {
                            onSuccess: () => toast.info(t("Source refresh started", "Quellen-Aktualisierung gestartet")),
                        })
                    }} />
                <ActionRow icon={Search} chevron label={t("Manual match", "Manuell zuordnen")} disabled={!selectedExtension}
                    note={t("Pick the matching title at the source yourself", "Den passenden Titel bei der Quelle selbst wählen")}
                    // one sheet at a time, as on the anime page's "More": the menu leaves as the match sheet comes in
                    onPress={() => setSourceSheet("match")} />
            </RowGroup>
        </Sheet>
        <MangaManualMappingSheet entry={entry} open={sourceSheet === "match"} onOpenChange={value => { if (!value) setSourceSheet(null) }} />

        <Dialog title={t("Download unread chapters", "Ungelesene Kapitel herunterladen")} open={confirmUnread} onOpenChange={setConfirmUnread}
            description={downloadableUnreadChapters.length === 1
                ? t("Add 1 unread chapter to the download queue?", "1 ungelesenes Kapitel zur Download-Warteschlange hinzufügen?")
                : t(`Add ${downloadableUnreadChapters.length} unread chapters to the download queue?`, `${downloadableUnreadChapters.length} ungelesene Kapitel zur Download-Warteschlange hinzufügen?`)}
            footer={<>
                <Button intent="secondary" wrapperClassName="flex-1" onPress={() => setConfirmUnread(false)}>{t("Cancel", "Abbrechen")}</Button>
                <Button wrapperClassName="flex-1" onPress={() => { setConfirmUnread(false); downloadChapters(downloadableUnreadChapters) }}>{t("Add to queue", "Zur Warteschlange")}</Button>
            </>} />
    </View>
}

/** The "Downloaded" tab: read a saved chapter with a tap, delete one with its trash button (after a question). */
function DownloadedChapters({ entry, chapters, onRead }: { entry: Manga_Entry, chapters: MangaDownloadChapterItem[], onRead: (chapter: MangaDownloadChapterItem) => void }) {
    const t = useTr()
    const { mutate: deleteChapters, isPending: isDeleting } = useDeleteMangaDownloadedChapters(String(entry.mediaId), null)
    const sorted = React.useMemo(() => chapters.slice().sort((a, b) => getChapterNumberFromChapter(a.chapterNumber) - getChapterNumberFromChapter(b.chapterNumber)), [chapters])
    const [deleting, setDeleting] = React.useState<MangaDownloadChapterItem | null>(null)

    if (!sorted.length) return <PhoneEmpty title={t("No chapters on this device yet.", "Noch keine Kapitel auf diesem Gerät.")}
        text={t("Use the download button next to a chapter in Online reading.", "Nutze den Download-Knopf neben einem Kapitel unter Online lesen.")} />

    return <View className="gap-0.5 overflow-hidden rounded-surface" accessibilityLabel={t("Downloaded chapters", "Geladene Kapitel")}>
        {sorted.map(chapter => <View key={`${chapter.provider}:${chapter.chapterId}`} className="min-h-14 flex-row items-center bg-sm-surface-raised">
            <Pressable accessibilityRole="button" disabled={!chapter.downloaded} onPress={() => onRead(chapter)}
                className={cn("min-h-14 min-w-0 flex-1 justify-center gap-0.5 px-4 py-2 active:bg-sm-surface-control", !chapter.downloaded && "opacity-70")}>
                <Text className="text-[15px]">{t("Chapter", "Kapitel")} {chapter.chapterNumber}</Text>
                <Muted numberOfLines={1}>{chapter.downloaded ? [t("Saved on this device", "Auf diesem Gerät gespeichert"), chapter.provider].join(" · ") : t("Queued", "In der Warteschlange")}</Muted>
            </Pressable>
            {chapter.downloaded && <View className="h-12 w-10 items-center justify-center"><BookOpen size={18} color={colors.smTextMuted} /></View>}
            {chapter.downloaded && <Pressable accessibilityRole="button" disabled={isDeleting} onPress={() => setDeleting(chapter)}
                accessibilityLabel={t(`Delete chapter ${chapter.chapterNumber}`, `Kapitel ${chapter.chapterNumber} löschen`)}
                className="h-12 w-12 items-center justify-center rounded-full active:bg-sm-surface-control">
                <Trash2 size={20} color={colors.smDanger} />
            </Pressable>}
        </View>)}
        <Dialog title={t("Delete chapter?", "Kapitel löschen?")} open={!!deleting} onOpenChange={value => { if (!value) setDeleting(null) }}
            description={deleting ? t(`Chapter ${deleting.chapterNumber} will be removed from this device.`, `Kapitel ${deleting.chapterNumber} wird von diesem Gerät entfernt.`) : ""}
            footer={<>
                <Button intent="secondary" wrapperClassName="flex-1" onPress={() => setDeleting(null)}>{t("Cancel", "Abbrechen")}</Button>
                <Button intent="danger" wrapperClassName="flex-1" onPress={() => {
                    if (deleting) deleteChapters({ downloadIds: [{ mediaId: entry.mediaId, provider: deleting.provider, chapterId: deleting.chapterId, chapterNumber: deleting.chapterNumber }] })
                    setDeleting(null)
                }}>{t("Delete", "Löschen")}</Button>
            </>} />
    </View>
}

/**
 * `.mobile-source-field` (mobile-anime.css): a small caption over the source's combobox – the UI select of 2.0.32
 * (`md`: 10dp inside, .875rem) at 48dp with the small corners of `.mobile-source-fields`.
 */
function SourceField({ label, ...rest }: React.ComponentProps<typeof Select> & { label: string }) {
    return <View className="gap-1">
        <Text className="px-1 text-xs font-semibold leading-[15.6px] text-sm-text-muted">{label}</Text>
        <Select {...rest} accessibilityLabel={rest.accessibilityLabel ?? label} triggerClassName="min-h-12 rounded-surface-sm pl-2.5 pr-2.5" valueClassName="text-sm" />
    </View>
}
