import { AL_MangaDetailsById_Media, HibikeManga_ChapterDetails, Manga_Entry, Manga_MediaDownloadData } from "@/api/generated/types"
import { useGetMangaSourceRefresh, useStartMangaSourceRefresh } from "@/api/hooks/manga.hooks"
import { SeaCommandInjectableItem, useSeaCommandInject } from "@/app/(main)/_features/sea-command/use-inject"
import { manga_downloadedChapterContainerAtom, MobileDownloadedChapters } from "@/app/(main)/manga/_containers/chapter-list/downloaded-chapter-list"
import { useMangaEntryDownloadedChapters } from "@/app/(main)/manga/_lib/handle-manga-downloads"
import { MangaManualMappingModal } from "@/app/(main)/manga/_containers/chapter-list/manga-manual-mapping-modal"
import { ChapterReaderDrawer } from "@/app/(main)/manga/_containers/chapter-reader/chapter-reader-drawer"
import { __manga_selectedChapterAtom } from "@/app/(main)/manga/_lib/handle-chapter-reader"
import { __manga_resumeLocationsAtom } from "@/app/(main)/manga/_lib/manga-chapter-reader.atoms"
import { __manga_continueIntentAtom, getMangaResumeChapter, isMangaContinueIntentFor } from "@/app/(main)/manga/_lib/manga-continue"
import { useHandleMangaChapters } from "@/app/(main)/manga/_lib/handle-manga-chapters"
import { useHandleDownloadMangaChapter } from "@/app/(main)/manga/_lib/handle-manga-downloads"
import { __manga_preferencesHydratedAtom } from "@/app/(main)/manga/_lib/handle-manga-selected-provider"
import { getChapterNumberFromChapter, useMangaDownloadDataUtils } from "@/app/(main)/manga/_lib/handle-manga-utils"
import { LANGUAGES_LIST } from "@/app/(main)/manga/_lib/language-map"
import { ConfirmationDialog, useConfirmationDialog } from "@/components/shared/confirmation-dialog"
import { SeaLink } from "@/components/shared/sea-link"
import { Button } from "@/components/ui/button"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { Select } from "@/components/ui/select"
import { ChapterListOrder, findChapterIndex, orderChapters, parseChapterQuery, visibleCountFor } from "@/app/(main)/manga/_lib/chapter-list-order"
import { cn } from "@/components/ui/core/styling"
import { atomWithStorage } from "jotai/utils"
import { useAtom, useAtomValue, useSetAtom } from "jotai/react"
import React from "react"
import { FaRedo } from "react-icons/fa"
import { LuArrowDownWideNarrow, LuArrowRight, LuArrowUpNarrowWide, LuDownload, LuHash, LuPuzzle, LuRefreshCw } from "react-icons/lu"
import { LuSearch } from "react-icons/lu"
import { MdOutlineOfflinePin } from "react-icons/md"
import { toast } from "sonner"
import { useTr } from "@/lib/app-language"
import { haptic } from "@/lib/feedback"
import { mobileMangaReadActionAtom } from "@/app/(main)/entry/_components/mobile-anime-header"
import { PhoneEmpty, PhoneRow, PhoneSheet } from "@/app/(main)/_features/phone-screen/phone-screen"
import { BiDotsVerticalRounded } from "react-icons/bi"
import { LuChevronDown } from "react-icons/lu"

const MOBILE_PAGE_SIZE = 30

/** Newest or oldest chapter first, remembered across sessions; unread chapters start with the next one to read */
const __manga_chapterListOrderAtom = atomWithStorage<ChapterListOrder>("sea-manga-chapter-list-order", "newest", undefined, { getOnInit: true })
const __manga_unreadChapterListOrderAtom = atomWithStorage<ChapterListOrder>("sea-manga-unread-chapter-list-order", "oldest", undefined,
    { getOnInit: true })

type ChapterListProps = {
    mediaId: string | null
    entry: Manga_Entry
    details: AL_MangaDetailsById_Media | undefined
    downloadData: Manga_MediaDownloadData | undefined
    downloadDataLoading: boolean
}

export function ChapterList(props: ChapterListProps) {

    const {
        mediaId,
        entry,
        details,
        downloadData,
        downloadDataLoading,
        ...rest
    } = props

    /**
     * Find chapter container
     */
    const {
        selectedExtension,
        providerExtensionsLoading,
        // Selected provider
        providerOptions, // For dropdown
        selectedProvider, // Current provider (id)
        setSelectedProvider,
        // Filters
        selectedFilters,
        setSelectedLanguage,
        setSelectedScanlator,
        languageOptions,
        scanlatorOptions,
        // Chapters
        chapterContainer,
        chapterContainerLoading,
        chapterContainerError,
        refetchChapterContainer,
    } = useHandleMangaChapters(mediaId)

    // Keep track of chapter numbers as integers
    // This is used to filter the chapters
    // [id]: number
    const chapterIdToNumbersMap = React.useMemo(() => {
        const map = new Map<string, number>()

        for (const chapter of chapterContainer?.chapters ?? []) {
            map.set(chapter.id, getChapterNumberFromChapter(chapter.chapter))
        }

        return map
    }, [chapterContainer?.chapters])

    const [showUnreadChapter, setShowUnreadChapter] = React.useState(false)
    const [showDownloadedChapters] = React.useState(false)

    /**
     * Set selected chapter
     */
    const setSelectedChapter = useSetAtom(__manga_selectedChapterAtom)
    const { data: sourceRefreshJob } = useGetMangaSourceRefresh()
    const { mutate: startSourceRefresh, isPending: isStartingSourceRefresh } = useStartMangaSourceRefresh()
    const preferencesHydrated = useAtomValue(__manga_preferencesHydratedAtom)
    const sourceRefreshRunning = sourceRefreshJob?.status === "running" || sourceRefreshJob?.status === "stopping"
    const sourceRefreshEligible = entry.listData?.status === "CURRENT" || entry.listData?.status === "REPEATING"
    /**
     * Download chapter
     */
    const { downloadChapters, isSendingDownloadRequest } = useHandleDownloadMangaChapter(mediaId)
    /**
     * Download data utils
     */
    const {
        isChapterQueued,
        isChapterDownloaded,
        isChapterLocal,
    } = useMangaDownloadDataUtils(downloadData, downloadDataLoading)

    const { inject, remove } = useSeaCommandInject()
    const t = useTr()
    const [mobileVisible, setMobileVisible] = React.useState(MOBILE_PAGE_SIZE)
    const [allOrder, setAllOrder] = useAtom(__manga_chapterListOrderAtom)
    const [unreadOrder, setUnreadOrder] = useAtom(__manga_unreadChapterListOrderAtom)
    const [jumpText, setJumpText] = React.useState("")
    const [highlightedChapterId, setHighlightedChapterId] = React.useState<string | null>(null)
    const chapterListRef = React.useRef<HTMLUListElement>(null)
    // Android: online chapters and chapters on this device are two tabs, like Local library / Online streaming on anime pages.
    const [mobileTab, setMobileTab] = React.useState<"online" | "downloaded">("online")
    const savedChapters = useMangaEntryDownloadedChapters()

    /**
     * Function to filter unread chapters
     */
    const retainUnreadChapters = React.useCallback((chapter: HibikeManga_ChapterDetails) => {
        if (!entry.listData || !chapterIdToNumbersMap.has(chapter.id) || !entry.listData?.progress) return true

        const chapterNumber = chapterIdToNumbersMap.get(chapter.id)
        return !!chapterNumber && chapterNumber > entry.listData?.progress
    }, [chapterIdToNumbersMap, chapterContainer, entry])

    const unreadChapters = React.useMemo(() => chapterContainer?.chapters?.filter(ch => retainUnreadChapters(ch)) ?? [], [chapterContainer, entry])
    const resumeLocations = useAtomValue(__manga_resumeLocationsAtom)
    const resumeLocation = resumeLocations[String(mediaId)]
    const resumeChapter = React.useMemo(() => getMangaResumeChapter(unreadChapters, resumeLocation, selectedProvider, Date.now()),
        [resumeLocation, selectedProvider, unreadChapters])
    const readingChapter = resumeChapter || unreadChapters[0]
    const allChapters = React.useMemo(() => orderChapters(chapterContainer?.chapters ?? [], allOrder), [chapterContainer, allOrder])
    const chapterOrder = showUnreadChapter ? unreadOrder : allOrder
    const setChapterOrder = showUnreadChapter ? setUnreadOrder : setAllOrder
    const downloadableUnreadChapters = React.useMemo(() => unreadChapters.filter(chapter => {
        return !isChapterLocal(chapter) && !isChapterDownloaded(chapter) && !isChapterQueued(chapter)
    }), [unreadChapters, downloadData, isChapterDownloaded, isChapterLocal, isChapterQueued])

    const confirmDownloadUnread = useConfirmationDialog({
        title: t("Download unread chapters", "Ungelesene Kapitel herunterladen"),
        actionIntent: "primary",
        actionText: t("Add to queue", "Zur Warteschlange"),
        description: downloadableUnreadChapters.length === 1
            ? t("Add 1 unread chapter to the download queue?", "1 ungelesenes Kapitel zur Download-Warteschlange hinzufügen?")
            : t(`Add ${downloadableUnreadChapters.length} unread chapters to the download queue?`,
                `${downloadableUnreadChapters.length} ungelesene Kapitel zur Download-Warteschlange hinzufügen?`),
        onConfirm: () => downloadChapters(downloadableUnreadChapters),
    })

    /**
     * Set "showUnreadChapter" state if there are unread chapters
     */
    React.useLayoutEffect(() => {
        setShowUnreadChapter(!!unreadChapters.length)
    }, [unreadChapters?.length])

    /**
     * Filter chapters based on state
     */
    const chapters = React.useMemo(() => {
        let d = showUnreadChapter ? orderChapters(unreadChapters, chapterOrder) : allChapters
        if (showDownloadedChapters) {
            d = d.filter(ch => isChapterDownloaded(ch) || isChapterQueued(ch))
        }
        return d
    }, [
        showUnreadChapter, unreadChapters, allChapters, chapterOrder, showDownloadedChapters, downloadData, selectedExtension,
    ])

    /**
     * "Go to chapter": finds the number in the list (the unread view falls back to all chapters), opens the page of the list
     * that holds it and marks the row
     */
    const jumpToChapter = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        // the field's own value: a keyboard may still be composing the text the state has not seen yet
        const target = parseChapterQuery(String(new FormData(event.currentTarget).get("chapter") ?? jumpText))
        ;(document.activeElement as HTMLElement | null)?.blur()
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
        haptic("tick")
    }

    // Scroll the jumped-to row into view once it is rendered, and let the mark fade after a moment
    React.useEffect(() => {
        if (!highlightedChapterId) return
        const frame = requestAnimationFrame(() => {
            chapterListRef.current?.querySelector(`[data-chapter-id="${CSS.escape(highlightedChapterId)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" })
        })
        const timer = setTimeout(() => setHighlightedChapterId(null), 3500)
        return () => {
            cancelAnimationFrame(frame)
            clearTimeout(timer)
        }
    }, [highlightedChapterId])

    // Inject chapter list command
    React.useEffect(() => {
        if (!chapterContainer?.chapters?.length) return

        const nextChapter = unreadChapters[0]
        const upcomingChapters = unreadChapters.slice(0, 10)

        const commandItems: SeaCommandInjectableItem[] = [
            // Next chapter
            ...(nextChapter ? [{
                data: nextChapter,
                id: `next-chapter-${nextChapter.id}`,
                value: `${nextChapter.chapter}`,
                heading: "Next Chapter",
                priority: 2,
                render: () => (
                    <div className="flex gap-1 items-center w-full">
                        <p className="max-w-[70%] truncate">Chapter {nextChapter.chapter}</p>
                        {nextChapter.scanlator && (
                            <p className="text-[--muted]">({nextChapter.scanlator})</p>
                        )}
                    </div>
                ),
                onSelect: ({ ctx }) => {
                    setSelectedChapter({
                        chapterId: nextChapter.id,
                        chapterNumber: nextChapter.chapter,
                        provider: nextChapter.provider,
                        mediaId: Number(mediaId),
                    })
                    ctx.close()
                },
            } as SeaCommandInjectableItem] : []),
            // Upcoming chapters
            ...upcomingChapters.map(chapter => ({
                data: chapter,
                id: `chapter-${chapter.id}`,
                value: `${chapter.chapter}`,
                heading: "Upcoming Chapters",
                priority: 1,
                render: () => (
                    <div className="flex gap-1 items-center w-full">
                        <p className="max-w-[70%] truncate">Chapter {chapter.chapter}</p>
                        {chapter.scanlator && (
                            <p className="text-[--muted]">({chapter.scanlator})</p>
                        )}
                    </div>
                ),
                onSelect: ({ ctx }) => {
                    setSelectedChapter({
                        chapterId: chapter.id,
                        chapterNumber: chapter.chapter,
                        provider: chapter.provider,
                        mediaId: Number(mediaId),
                    })
                    ctx.close()
                },
            } as SeaCommandInjectableItem)),
        ]

        inject("manga-chapters", {
            items: commandItems,
            filter: ({ item, input }) => {
                if (!input) return true
                return item.value.toLowerCase().includes(input.toLowerCase()) ||
                    (item.data.title?.toLowerCase() || "").includes(input.toLowerCase())
            },
            priority: 100,
        })

        return () => remove("manga-chapters")
    }, [chapterContainer?.chapters, unreadChapters, mediaId])

    const [downloadedChapterContainer] = useAtom(manga_downloadedChapterContainerAtom)

    // Android: the header shows this as the page's primary action.
    const setMobileReadAction = useSetAtom(mobileMangaReadActionAtom)
    React.useEffect(() => {
        setMobileReadAction(readingChapter ? {
            label: resumeChapter ? t("Resume reading", "Weiterlesen") : entry.listData?.progress ? t("Continue reading", "Weiterlesen") : t("Start reading", "Lesen beginnen"),
            detail: `${t("Chapter", "Kapitel")} ${readingChapter.chapter}${resumeChapter ? ` · ${t("Page", "Seite")} ${resumeLocation.pageIndex + 1}` : ""}`,
            onClick: () => setSelectedChapter({
                chapterId: readingChapter.id,
                chapterNumber: readingChapter.chapter,
                provider: readingChapter.provider,
                mediaId: Number(mediaId),
            }),
        } : null)
    }, [readingChapter, resumeChapter, resumeLocation, entry.listData?.progress, mediaId])
    React.useEffect(() => () => setMobileReadAction(null), [])

    // The source's "More" sheet, then the manual match it can open
    const [sourceSheet, setSourceSheet] = React.useState<"menu" | "match" | null>(null)
    const moreButton = React.useRef<HTMLButtonElement>(null)

    // Android: "Continue reading" on the manga library opens the reading chapter once the source has answered.
    const [continueIntent, setContinueIntent] = useAtom(__manga_continueIntentAtom)
    React.useEffect(() => {
        if (!continueIntent) return
        // Another manga's or an expired intent never opens the reader here
        if (!isMangaContinueIntentFor(continueIntent, mediaId, Date.now())) return setContinueIntent(null)
        // Wait for the saved source (server preferences) and its chapters
        if (!preferencesHydrated || (!chapterContainer && !chapterContainerError)) return
        setContinueIntent(null)
        if (!readingChapter) return
        setSelectedChapter({
            chapterId: readingChapter.id,
            chapterNumber: readingChapter.chapter,
            provider: readingChapter.provider,
            mediaId: Number(mediaId),
        })
    }, [continueIntent, readingChapter, chapterContainer, chapterContainerError, preferencesHydrated, mediaId])
    React.useEffect(() => () => setContinueIntent(null), [])

    if (providerExtensionsLoading) return <LoadingSpinner />

    return (
        <div
            className="space-y-4"
            data-chapter-list-container
            data-selected-filters={JSON.stringify(selectedFilters)}
            data-selected-provider={JSON.stringify(selectedProvider)}
        >

            <div className="UI-StaticTabs__root mobile-manga-tabs" role="tablist" aria-label={t("Chapters", "Kapitel")}>
                {(["online", "downloaded"] as const).map(tab => <button key={tab} type="button" role="tab" className="UI-StaticTabs__trigger"
                    data-current={mobileTab === tab} aria-selected={mobileTab === tab} data-mobile-manga-tab={tab} onClick={() => setMobileTab(tab)}>
                    {tab === "online" ? t("Online reading", "Online lesen") : `${t("Downloaded", "Geladen")}${savedChapters.length ? ` · ${savedChapters.length}` : ""}`}
                </button>)}
            </div>

            {mobileTab === "downloaded" && <MobileDownloadedChapters entry={entry} />}

            {mobileTab === "online" && <section className="mobile-episode-options mobile-chapter-options" aria-label={t("Source & reading options", "Quelle & Leseoptionen")}>
                {/* Each field carries a small caption: the chosen values alone ("MangaFire", "official") do not say what they are */}
                <div className="mobile-source-pair mobile-source-fields" role="group" aria-label={t("Source", "Quelle")}>
                    <div className="mobile-source-field">
                        <span aria-hidden>{t("Source", "Quelle")}</span>
                        <Select
                            options={providerOptions}
                            value={selectedProvider || ""}
                            onValueChange={v => setSelectedProvider({ mId: mediaId, provider: v })}
                            disabled={sourceRefreshRunning}
                            aria-label={t("Source", "Quelle")}
                        />
                    </div>
                </div>
                {(selectedExtension?.settings?.supportsMultiLanguage || selectedExtension?.settings?.supportsMultiScanlator) &&
                    <div className="mobile-source-pair mobile-source-fields mobile-chapter-filter-pair" role="group" aria-label={t("Chapter filters", "Kapitelfilter")}>
                    {selectedExtension?.settings?.supportsMultiLanguage && <div className="mobile-source-field">
                        <span aria-hidden>{t("Language", "Sprache")}</span>
                        <Select
                            options={languageOptions}
                            placeholder={t("All languages", "Alle Sprachen")}
                            value={selectedFilters.language}
                            onValueChange={v => setSelectedLanguage({ mId: mediaId, language: v })}
                            aria-label={t("Language", "Sprache")}
                        />
                    </div>}
                    {selectedExtension?.settings?.supportsMultiScanlator && <div className="mobile-source-field">
                        <span aria-hidden>{t("Translator", "Übersetzer")}</span>
                        <Select
                            options={scanlatorOptions}
                            placeholder={t("All translators", "Alle Übersetzer")}
                            value={selectedFilters.scanlators[0] || ""}
                            onValueChange={v => setSelectedScanlator({ mId: mediaId, scanlators: [v] })}
                            aria-label={t("Translator (scanlator)", "Übersetzer (Scanlator)")}
                        />
                    </div>}
                </div>}
                {/* Rarely needed: reloading the source and matching the title by hand wait behind one quiet button */}
                <div className="mobile-source-more">
                    <Button ref={moreButton} leftIcon={<BiDotsVerticalRounded />} intent="gray-basic" size="sm" aria-haspopup="dialog"
                        aria-label={t("More source options", "Weitere Quellen-Optionen")} onClick={() => setSourceSheet("menu")} data-manga-source-more>
                        {sourceRefreshRunning ? t("Refreshing …", "Wird aktualisiert …") : t("More", "Mehr")}
                    </Button>
                </div>
                <PhoneSheet title={t("Source", "Quelle")} open={sourceSheet === "menu"} onOpenChange={open => { if (!open) setSourceSheet(null) }}
                    returnFocusRef={moreButton} data-manga-source-sheet>
                    <div className="ps-rows">
                        <PhoneRow icon={<FaRedo />} data-manga-source-refresh
                            label={sourceRefreshRunning ? t("Refreshing …", "Wird aktualisiert …") : t("Reload source", "Quelle neu laden")}
                            note={t("Looks for new chapters of this manga at the source", "Sucht bei der Quelle nach neuen Kapiteln dieses Manga")}
                            disabled={isStartingSourceRefresh || !preferencesHydrated || !selectedExtension || !sourceRefreshEligible || sourceRefreshRunning}
                            onClick={() => {
                                setSourceSheet(null)
                                if (mediaId) startSourceRefresh({ mode: "refresh_selected", mediaIds: [Number(mediaId)] }, {
                                    onSuccess: () => toast.info(t("Source refresh started", "Quellen-Aktualisierung gestartet")),
                                })
                            }} />
                        <PhoneRow icon={<LuSearch />} chevron data-manga-source-match
                            label={t("Manual match", "Manuell zuordnen")}
                            note={t("Pick the matching title at the source yourself", "Den passenden Titel bei der Quelle selbst wählen")}
                            disabled={!selectedExtension}
                            onClick={() => {
                                // One sheet at a time, as on the anime page's "More"
                                setSourceSheet(null)
                                setTimeout(() => setSourceSheet("match"), 150)
                            }} />
                    </div>
                </PhoneSheet>
                <MangaManualMappingModal entry={entry} open={sourceSheet === "match"} onOpenChange={open => { if (!open) setSourceSheet(null) }} />
            </section>}

            {mobileTab === "online" && !providerExtensionsLoading && !selectedExtension && <PhoneEmpty data-manga-no-source
                title={selectedProvider ? t("Saved source unavailable", "Gespeicherte Quelle nicht verfügbar") : t("No manga source available", "Keine Manga-Quelle verfügbar")}
                text={selectedProvider
                    ? t(`The saved source “${selectedProvider}” is not installed. Install it again or choose another source.`,
                        `Die gespeicherte Quelle „${selectedProvider}“ ist nicht installiert. Installiere sie wieder oder wähle eine andere.`)
                    : t("Install a manga source in Extensions to load chapters.", "Installiere unter Erweiterungen eine Manga-Quelle, um Kapitel zu laden.")}>
                <SeaLink href="/extensions" className="ps-primary"><LuPuzzle aria-hidden />{t("Open Extensions", "Erweiterungen öffnen")}</SeaLink>
            </PhoneEmpty>}

            {mobileTab === "downloaded" ? null : chapterContainerLoading ? <LoadingSpinner /> : (
                chapterContainerError ? <PhoneEmpty title={t("Chapters could not be loaded", "Kapitel konnten nicht geladen werden")} data-manga-chapters-error
                    text={t("The source did not answer. Check the connection or try again.", "Die Quelle hat nicht geantwortet. Verbindung prüfen oder erneut versuchen.")}>
                    <button type="button" className="ps-primary" onClick={() => refetchChapterContainer()}><LuRefreshCw aria-hidden />{t("Try again", "Erneut versuchen")}</button>
                    <MangaManualMappingModal entry={entry}>
                        <button type="button" className="ps-secondary"><LuSearch aria-hidden />{t("Manual match", "Manuell zuordnen")}</button>
                    </MangaManualMappingModal>
                </PhoneEmpty> : (
                    <>

                        {chapterContainer?.chapters?.length === 0 && <PhoneEmpty title={t("No chapters found", "Keine Kapitel gefunden")}
                            text={t("This source has no chapters of this manga. Try another source.", "Diese Quelle hat keine Kapitel dieses Manga. Probiere eine andere Quelle.")} />}

                        {!!chapterContainer?.chapters?.length && (
                            <div className="mobile-chapters" data-mobile-chapters>
                                <div className="mobile-episode-heading">
                                    <h2>{t("Chapters", "Kapitel")} <span>{chapterContainer.chapters.length}</span></h2>
                                </div>
                                <div className="mobile-chapter-filters">
                                    <div className="mobile-source-segment mobile-chapter-show" role="group" aria-label={t("Show chapters", "Kapitel anzeigen")}>
                                        <button type="button" aria-pressed={showUnreadChapter} onClick={() => { setShowUnreadChapter(true); setMobileVisible(MOBILE_PAGE_SIZE) }}>
                                            {t("Unread", "Ungelesen")} <span>{unreadChapters.length}</span>
                                        </button>
                                        <button type="button" aria-pressed={!showUnreadChapter} onClick={() => { setShowUnreadChapter(false); setMobileVisible(MOBILE_PAGE_SIZE) }}>
                                            {t("All", "Alle")} <span>{chapterContainer.chapters.length}</span>
                                        </button>
                                    </div>
                                    {/* One button flips the order; it names the order that is shown */}
                                    <button type="button" className="mobile-chapter-order" data-chapter-order={chapterOrder}
                                        aria-label={chapterOrder === "newest"
                                            ? t("Newest first. Tap for oldest first", "Neueste zuerst. Tippen für älteste zuerst")
                                            : t("Oldest first. Tap for newest first", "Älteste zuerst. Tippen für neueste zuerst")}
                                        onClick={() => { setChapterOrder(chapterOrder === "newest" ? "oldest" : "newest"); setMobileVisible(MOBILE_PAGE_SIZE) }}>
                                        {chapterOrder === "newest" ? <LuArrowDownWideNarrow aria-hidden /> : <LuArrowUpNarrowWide aria-hidden />}
                                        <span aria-hidden>{chapterOrder === "newest" ? t("Newest first", "Neueste zuerst") : t("Oldest first", "Älteste zuerst")}</span>
                                    </button>
                                    <form className="mobile-chapter-jump" onSubmit={jumpToChapter} role="search" aria-label={t("Go to chapter", "Zu Kapitel springen")}>
                                        <LuHash aria-hidden />
                                        <input
                                            type="text"
                                            name="chapter"
                                            inputMode="decimal"
                                            enterKeyHint="go"
                                            autoComplete="off"
                                            value={jumpText}
                                            onChange={event => setJumpText(event.target.value)}
                                            placeholder={t("Go to chapter", "Zu Kapitel springen")}
                                            aria-label={t("Chapter number", "Kapitelnummer")}
                                        />
                                        <button type="submit" disabled={!jumpText.trim()} aria-label={t("Go", "Los")}
                                            // keeps the field focused while pressed: its blur moves the layout and the tap would miss
                                            onMouseDown={event => event.preventDefault()}>
                                            <LuArrowRight aria-hidden />
                                        </button>
                                    </form>
                                </div>
                                {!chapters.length && <p className="mobile-chapter-empty">{showDownloadedChapters
                                    ? t("No downloaded chapters here.", "Hier sind keine Kapitel geladen.")
                                    : t("All chapters are read.", "Alle Kapitel sind gelesen.")}</p>}
                                <ul className="mobile-chapter-list" ref={chapterListRef} aria-label={t("Chapters", "Kapitel")}>
                                    {chapters.slice(0, mobileVisible).map(chapter => {
                                        const downloaded = isChapterDownloaded(chapter)
                                        const queued = isChapterQueued(chapter)
                                        const canDownload = !isChapterLocal(chapter) && !downloaded && !queued
                                        const language = chapter.language ? LANGUAGES_LIST[chapter.language]?.nativeName || chapter.language : null
                                        return <li key={chapter.id} data-mobile-chapter={chapter.chapter} data-chapter-id={chapter.id} data-read={!retainUnreadChapters(chapter) || undefined}
                                            data-chapter-jumped={highlightedChapterId === chapter.id || undefined}
                                            className={cn("transition-colors duration-500", highlightedChapterId === chapter.id && "rounded-lg bg-[--sm-accent-soft]")}>
                                            <button type="button" className="mobile-chapter-open"
                                                onClick={() => setSelectedChapter({
                                                    chapterId: chapter.id,
                                                    chapterNumber: chapter.chapter,
                                                    provider: chapter.provider,
                                                    mediaId: Number(mediaId),
                                                })}>
                                                {/* Titles that only repeat the number ("Chapter 2") don't get the number again underneath. */}
                                                <span className="mobile-chapter-title">{chapter.title || `${t("Chapter", "Kapitel")} ${chapter.chapter}`}</span>
                                                <span className="mobile-chapter-meta">{[
                                                    !chapter.title || chapter.title.trim().toLowerCase().replace(/^(chapter|ch\.?|kapitel)\s*/, "") === String(chapter.chapter).toLowerCase()
                                                        ? null : `${t("Chapter", "Kapitel")} ${chapter.chapter}`,
                                                    chapter.scanlator, selectedExtension?.settings?.supportsMultiLanguage ? language : null,
                                                ].filter(Boolean).join(" · ")}</span>
                                            </button>
                                            {canDownload && <button type="button" className="mobile-chapter-action" disabled={isSendingDownloadRequest}
                                                aria-label={t(`Download chapter ${chapter.chapter}`, `Kapitel ${chapter.chapter} laden`)} onClick={() => downloadChapters([chapter])}>
                                                <LuDownload aria-hidden />
                                            </button>}
                                            {queued && <span className="mobile-chapter-state">{t("Queued", "Eingeplant")}</span>}
                                            {downloaded && <span className="mobile-chapter-state mobile-chapter-state-saved" aria-label={t("Downloaded", "Geladen")}><MdOutlineOfflinePin aria-hidden /></span>}
                                        </li>
                                    })}
                                </ul>
                                {chapters.length > mobileVisible && <button type="button" className="mobile-chapter-more" onClick={() => setMobileVisible(v => v + MOBILE_PAGE_SIZE)}>
                                    <LuChevronDown aria-hidden />{t(`Show more (${chapters.length - mobileVisible})`, `Mehr anzeigen (${chapters.length - mobileVisible})`)}
                                </button>}
                                {!downloadDataLoading && !!downloadableUnreadChapters.length && <button type="button" className="mobile-chapter-download-unread"
                                    disabled={isSendingDownloadRequest} onClick={() => confirmDownloadUnread.open()}>
                                    <LuDownload aria-hidden />{t(`Download unread (${downloadableUnreadChapters.length})`, `Ungelesene laden (${downloadableUnreadChapters.length})`)}
                                </button>}
                            </div>
                        )}
                    </>
                )
            )}

            {(chapterContainer || downloadedChapterContainer) && <ChapterReaderDrawer
                entry={entry}
                chapterContainer={chapterContainer || downloadedChapterContainer!}
                chapterIdToNumbersMap={chapterIdToNumbersMap}
            />}

            <ConfirmationDialog {...confirmDownloadUnread} />
        </div>
    )
}
